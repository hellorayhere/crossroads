/*
 * Crossroads — durable persistence layer.
 *
 * Render's free plan has an EPHEMERAL filesystem: every deploy/restart wipes
 * the local `data/` and `uploads/` folders. To keep user data forever without
 * a paid persistent disk, we mirror the SQLite database and every uploaded
 * file into a private GitHub repository using the Git Data API.
 *
 *   - On boot:  `restore()` downloads db/crossroads.db + uploads/* into place
 *               (runs in a child process BEFORE the DB is opened).
 *   - On write: `backupDb()` / `backupUpload()` push changes back.
 *   - Runtime:  `startAutoBackup(db)` backs up on an interval and on SIGTERM.
 *
 * Configuration (environment variables):
 *   GH_DATA_TOKEN   GitHub token with `repo` scope            (required)
 *   GH_DATA_REPO    "owner/repo" of the private data repo     (required)
 *   GH_DATA_BRANCH  branch to use                             (default: main)
 *   DATA_DIR        where crossroads.db lives                 (default: ./data)
 *   UPLOAD_DIR      where uploads live                        (default: ./uploads)
 *
 * If GH_DATA_REPO / GH_DATA_TOKEN are not set the module is a no-op, so local
 * development and any future persistent-disk setup keep working unchanged.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOKEN = process.env.GH_DATA_TOKEN || '';
const REPO = process.env.GH_DATA_REPO || '';
const BRANCH = process.env.GH_DATA_BRANCH || 'main';
const API = 'https://api.github.com';

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(__dirname, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'crossroads.db');

const enabled = !!(TOKEN && REPO);
const BACKUP_INTERVAL_MS = parseInt(process.env.BACKUP_INTERVAL_MS || '60000', 10);

function headers(extra) {
  return Object.assign({
    Authorization: 'Bearer ' + TOKEN,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'crossroads-persist',
    'X-GitHub-Api-Version': '2022-11-28'
  }, extra || {});
}

async function gh(method, url, body) {
  const res = await fetch(API + url, {
    method,
    headers: headers(body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`${method} ${url} -> ${res.status} ${t.slice(0, 180)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

/* Return the tree (flat list) of the current branch head, or [] if empty. */
async function getTree() {
  let ref;
  try {
    ref = await gh('GET', `/repos/${REPO}/git/ref/heads/${BRANCH}`);
  } catch (e) {
    return { entries: [], baseCommitSha: null, baseTreeSha: null };
  }
  const commit = await gh('GET', `/repos/${REPO}/git/commits/${ref.object.sha}`);
  const tree = await gh('GET', `/repos/${REPO}/git/trees/${commit.tree.sha}?recursive=1`);
  return { entries: tree.tree || [], baseCommitSha: ref.object.sha, baseTreeSha: commit.tree.sha };
}

async function downloadBlob(sha, destPath) {
  const res = await fetch(`${API}/repos/${REPO}/git/blobs/${sha}`, {
    headers: headers({ Accept: 'application/vnd.github.raw' })
  });
  if (!res.ok) throw new Error('blob fetch ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buf);
  return buf.length;
}

/* SHA-256 of a file, or null if it does not exist. Used to skip no-op backups
   so the data repo does not accumulate thousands of identical commits. */
function hashFile(p) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  } catch (e) {
    return null;
  }
}

let lastDbHash = null;

/* Commit a set of files (path -> Buffer) in a single commit.

   IMPORTANT: GitHub's Git Data API is compare-and-swap on the branch ref. If
   two commits are built from the same base commit, the second PATCH fails with
   422 (not a fast-forward) and that file is silently lost forever. Because
   uploads and the periodic DB backup used to run concurrently, uploads were
   occasionally dropped this way (which is why some attachments later showed up
   missing/blank). Every commit now goes through a single serialized queue and
   retries from a fresh base if the ref moved underneath us. */
let commitChain = Promise.resolve();

function commitFiles(files, message) {
  const run = () => commitFilesOnce(files, message);
  const next = commitChain.then(run, run);
  /* Keep the chain alive even if this commit rejects. */
  commitChain = next.catch(() => {});
  return next;
}

async function commitFilesOnce(files, message, attempt) {
  attempt = attempt || 1;
  const { baseCommitSha, baseTreeSha } = await getTree();
  const treeEntries = [];
  for (const [repoPath, buf] of Object.entries(files)) {
    const blob = await gh('POST', `/repos/${REPO}/git/blobs`, {
      content: buf.toString('base64'),
      encoding: 'base64'
    });
    treeEntries.push({ path: repoPath, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const tree = await gh('POST', `/repos/${REPO}/git/trees`, {
    base_tree: baseTreeSha || undefined,
    tree: treeEntries
  });
  const parents = baseCommitSha ? [baseCommitSha] : [];
  const commit = await gh('POST', `/repos/${REPO}/git/commits`, {
    message,
    tree: tree.sha,
    parents
  });
  try {
    if (baseCommitSha) {
      await gh('PATCH', `/repos/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: false });
    } else {
      await gh('POST', `/repos/${REPO}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha: commit.sha });
    }
  } catch (e) {
    /* The branch moved between our read and our write (another writer, a
       manual push, or a retried request). Rebuild from the new head. */
    const conflict = /\b(409|422)\b/.test(e.message || '');
    if (conflict && attempt < 5) {
      await new Promise(r => setTimeout(r, 250 * attempt));
      return commitFilesOnce(files, message, attempt + 1);
    }
    throw e;
  }
  /* Our view of the remote tree is now stale (this commit added files). */
  treeCache = null;
  return commit.sha;
}

/* ---------------------------------------------------------------- restore */

/* Cached view of the remote tree, so an on-demand upload fetch does not need a
   fresh API round-trip per file. Invalidated whenever we push a commit. */
let treeCache = null;
let treeCacheAt = 0;
const TREE_TTL_MS = 60 * 1000;

async function remoteEntries(force) {
  if (!force && treeCache && Date.now() - treeCacheAt < TREE_TTL_MS) return treeCache;
  const { entries } = await getTree();
  treeCache = entries;
  treeCacheAt = Date.now();
  return entries;
}

function uploadNames(entries) {
  return entries
    .filter(e => e.type === 'blob' && e.path.startsWith('uploads/'))
    .map(e => ({ name: e.path.slice('uploads/'.length), sha: e.sha, size: e.size }))
    .filter(e => e.name && !e.name.includes('/'));
}

/* Download the database only. This is small (a few hundred KB) and MUST happen
   before better-sqlite3 opens the file, so it stays in the blocking child
   process. Uploads are deliberately NOT downloaded here: they can total
   hundreds of megabytes, which used to blow the parent's execFileSync timeout
   and leave every attachment 404ing. */
async function restoreDb() {
  if (!enabled) {
    console.log('[persist] disabled (set GH_DATA_REPO + GH_DATA_TOKEN to enable)');
    return { db: false };
  }
  console.log(`[persist] restoring database from ${REPO}@${BRANCH}`);
  let entries = [];
  try {
    entries = await remoteEntries(true);
  } catch (e) {
    console.error('[persist] could not read remote tree:', e.message);
    return { db: false };
  }
  const dbEntry = entries.find(e => e.type === 'blob' && e.path === 'db/crossroads.db');
  if (!dbEntry) {
    console.log('[persist] no remote database yet (first run)');
    return { db: false };
  }
  try {
    const n = await downloadBlob(dbEntry.sha, DB_PATH);
    lastDbHash = hashFile(DB_PATH);
    console.log(`[persist] restored database (${n} bytes)`);
    return { db: true };
  } catch (e) {
    console.error('[persist] db restore failed:', e.message);
    return { db: false };
  }
}

/* Restore every upload in parallel (bounded), skipping files that already
   exist locally at the right size. Runs AFTER the server starts listening so a
   cold boot is never blocked by media, and so a slow/failed transfer can only
   ever affect that one file. */
const RESTORE_CONCURRENCY = 8;

async function restoreUploads() {
  if (!enabled) return { uploads: 0, skipped: 0 };
  let entries;
  try {
    entries = await remoteEntries(true);
  } catch (e) {
    console.error('[persist] upload restore: cannot read tree:', e.message);
    return { uploads: 0, skipped: 0 };
  }
  const list = uploadNames(entries);
  let done = 0;
  let skipped = 0;
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const item = list[next++];
      const dest = path.join(UPLOAD_DIR, item.name);
      try {
        if (fs.existsSync(dest)) {
          const st = fs.statSync(dest);
          if (!item.size || st.size === item.size) { skipped++; continue; }
        }
        await downloadBlob(item.sha, dest);
        done++;
      } catch (err) {
        failed++;
        console.error('[persist] upload restore failed:', item.name, err.message);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(RESTORE_CONCURRENCY, list.length || 1) }, worker));
  console.log(`[persist] uploads ready: ${done} downloaded, ${skipped} already present, ${failed} failed (of ${list.length})`);
  return { uploads: done, skipped, failed, total: list.length };
}

/* Fetch a single upload on demand. Used by the /uploads route when a file is
   missing locally (e.g. the background restore has not reached it yet, or the
   instance was restarted mid-transfer). Returns true if the file now exists. */
const fetching = new Map();
async function fetchUpload(name) {
  if (!enabled || !name || name.includes('/') || name.includes('..')) return false;
  if (fetching.has(name)) return fetching.get(name);
  const job = (async () => {
    const dest = path.join(UPLOAD_DIR, name);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return true;
    let entries;
    try { entries = await remoteEntries(); } catch (e) { return false; }
    let entry = entries.find(e => e.type === 'blob' && e.path === 'uploads/' + name);
    if (!entry) {
      /* Maybe the file was just uploaded and our tree cache is stale. */
      try { entries = await remoteEntries(true); } catch (e) { return false; }
      entry = entries.find(e => e.type === 'blob' && e.path === 'uploads/' + name);
    }
    if (!entry) return false;
    try {
      await downloadBlob(entry.sha, dest);
      console.log('[persist] fetched upload on demand:', name);
      return true;
    } catch (e) {
      console.error('[persist] on-demand fetch failed:', name, e.message);
      return false;
    }
  })();
  fetching.set(name, job);
  try { return await job; } finally { fetching.delete(name); }
}

/* Backwards-compatible full restore (db + uploads). */
async function restore() {
  const { db: dbOk } = await restoreDb();
  const up = await restoreUploads();
  return { db: dbOk, uploads: up.uploads };
}

/* ---------------------------------------------------------------- backup */

let backupBusy = false;

async function backupDb(db, reason) {
  if (!enabled) return;
  if (backupBusy) { console.log('[persist] backup skipped (busy)'); return; }
  backupBusy = true;
  try {
    if (db) {
      try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (e) {}
    }
    if (!fs.existsSync(DB_PATH)) return;
    const buf = fs.readFileSync(DB_PATH);
    const h = crypto.createHash('sha256').update(buf).digest('hex');
    if (h === lastDbHash) return; // nothing changed since the last backup
    await commitFiles({ 'db/crossroads.db': buf }, `backup db (${reason}) ${new Date().toISOString()}`);
    lastDbHash = h;
    console.log(`[persist] db backed up (${reason}, ${buf.length} bytes)`);
  } catch (e) {
    console.error('[persist] db backup failed:', e.message);
  } finally {
    backupBusy = false;
  }
}

async function backupUpload(filename) {
  if (!enabled) return false;
  const local = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(local)) return false;
  try {
    const buf = fs.readFileSync(local);
    if (!buf.length) {
      console.error('[persist] refusing to back up empty upload:', filename);
      return false;
    }
    await commitFiles({ ['uploads/' + filename]: buf }, `upload ${filename}`);
    console.log('[persist] upload backed up:', filename);
    return true;
  } catch (e) {
    console.error('[persist] upload backup failed:', filename, e.message);
    return false;
  }
}

/* After a restore, make sure every file we have locally is also in the data
   repo. This repairs uploads that were dropped by an earlier failed/raced
   backup, so a future restart cannot lose them. */
async function reconcileUploads() {
  if (!enabled) return { checked: 0, uploaded: 0 };
  let names = [];
  try { names = fs.readdirSync(UPLOAD_DIR).filter(n => n && !n.startsWith('.')); } catch (e) { return { checked: 0, uploaded: 0 }; }
  if (!names.length) return { checked: 0, uploaded: 0 };
  let entries = [];
  try { ({ entries } = await getTree()); } catch (e) { return { checked: names.length, uploaded: 0 }; }
  const remote = new Set(entries.filter(e => e.type === 'blob').map(e => e.path));
  let uploaded = 0;
  for (const name of names) {
    if (remote.has('uploads/' + name)) continue;
    const local = path.join(UPLOAD_DIR, name);
    try {
      const buf = fs.readFileSync(local);
      if (!buf.length) continue;
      await commitFiles({ ['uploads/' + name]: buf }, `reconcile upload ${name}`);
      uploaded++;
    } catch (e) {
      console.error('[persist] reconcile failed for', name, e.message);
    }
  }
  if (uploaded) console.log(`[persist] reconciled ${uploaded} missing upload(s)`);
  return { checked: names.length, uploaded };
}

/* ---------------------------------------------------------------- runtime */

let dbRef = null;
let timer = null;

function startAutoBackup(db) {
  dbRef = db;
  if (!enabled) return;
  if (timer) return;
  timer = setInterval(() => backupDb(dbRef, 'interval'), BACKUP_INTERVAL_MS);
  if (timer.unref) timer.unref();

  const shutdown = async (sig) => {
    console.log(`[persist] received ${sig} — running final backup`);
    try { await backupDb(dbRef, 'shutdown'); } catch (e) {}
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = {
  enabled,
  restore,
  restoreDb,
  restoreUploads,
  fetchUpload,
  reconcileUploads,
  backupDb,
  backupUpload,
  startAutoBackup,
  DB_PATH,
  DATA_DIR,
  UPLOAD_DIR
};

/* Allow `node persist.js restore` (used by db.js before opening the DB). */
if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'restore') {
    const onlyDb = process.argv.includes('--db-only');
    (onlyDb ? restoreDb() : restore())
      .then(() => process.exit(0))
      .catch((e) => { console.error('[persist] restore error:', e.message); process.exit(1); });
  } else {
    console.log('usage: node persist.js restore');
    process.exit(0);
  }
}
