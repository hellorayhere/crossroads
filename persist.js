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

const TOKEN = process.env.GH_DATA_TOKEN || '';
const REPO = process.env.GH_DATA_REPO || '';
const BRANCH = process.env.GH_DATA_BRANCH || 'main';
const API = 'https://api.github.com';

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(__dirname, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'crossroads.db');

const enabled = !!(TOKEN && REPO);
const BACKUP_INTERVAL_MS = parseInt(process.env.BACKUP_INTERVAL_MS || '20000', 10);

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

/* Commit a set of files (path -> Buffer) in a single commit. */
async function commitFiles(files, message) {
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
  if (baseCommitSha) {
    await gh('PATCH', `/repos/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: false });
  } else {
    await gh('POST', `/repos/${REPO}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha: commit.sha });
  }
}

/* ---------------------------------------------------------------- restore */

async function restore() {
  if (!enabled) {
    console.log('[persist] disabled (set GH_DATA_REPO + GH_DATA_TOKEN to enable)');
    return { db: false, uploads: 0 };
  }
  console.log(`[persist] restoring from ${REPO}@${BRANCH}`);
  let entries = [];
  try {
    ({ entries } = await getTree());
  } catch (e) {
    console.error('[persist] could not read remote tree:', e.message);
    return { db: false, uploads: 0 };
  }

  let dbOk = false;
  const dbEntry = entries.find(e => e.type === 'blob' && e.path === 'db/crossroads.db');
  if (dbEntry) {
    try {
      const n = await downloadBlob(dbEntry.sha, DB_PATH);
      dbOk = true;
      console.log(`[persist] restored database (${n} bytes)`);
    } catch (e) {
      console.error('[persist] db restore failed:', e.message);
    }
  } else {
    console.log('[persist] no remote database yet (first run)');
  }

  let count = 0;
  for (const e of entries) {
    if (e.type !== 'blob' || !e.path.startsWith('uploads/')) continue;
    const name = e.path.slice('uploads/'.length);
    if (!name || name.includes('/')) continue;
    try {
      await downloadBlob(e.sha, path.join(UPLOAD_DIR, name));
      count++;
    } catch (err) {
      console.error('[persist] upload restore failed:', name, err.message);
    }
  }
  console.log(`[persist] restored ${count} upload(s)`);
  return { db: dbOk, uploads: count };
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
    await commitFiles({ 'db/crossroads.db': buf }, `backup db (${reason}) ${new Date().toISOString()}`);
    console.log(`[persist] db backed up (${reason}, ${buf.length} bytes)`);
  } catch (e) {
    console.error('[persist] db backup failed:', e.message);
  } finally {
    backupBusy = false;
  }
}

async function backupUpload(filename) {
  if (!enabled) return;
  const local = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(local)) return;
  try {
    const buf = fs.readFileSync(local);
    await commitFiles({ ['uploads/' + filename]: buf }, `upload ${filename}`);
    console.log('[persist] upload backed up:', filename);
  } catch (e) {
    console.error('[persist] upload backup failed:', filename, e.message);
  }
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
    restore()
      .then(() => process.exit(0))
      .catch((e) => { console.error('[persist] restore error:', e.message); process.exit(1); });
  } else {
    console.log('usage: node persist.js restore');
    process.exit(0);
  }
}
