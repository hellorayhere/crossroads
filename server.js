const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { Server } = require('socket.io');

const db = require('./db');

/* Belt-and-braces schema self-heal. db.js already performs the additive
   migrations, but if a restored database ever lands without the newest message
   columns, message sending must never break. This is additive only. */
try {
  const _mcols = db.prepare('PRAGMA table_info(messages)').all().map(c => c.name);
  if (!_mcols.includes('attachment_spoiler')) db.exec('ALTER TABLE messages ADD COLUMN attachment_spoiler INTEGER DEFAULT 0');
  if (!_mcols.includes('attachment_description')) db.exec('ALTER TABLE messages ADD COLUMN attachment_description TEXT');
  if (!_mcols.includes('content_plain')) db.exec('ALTER TABLE messages ADD COLUMN content_plain TEXT');
  if (!_mcols.includes('kind')) db.exec('ALTER TABLE messages ADD COLUMN kind TEXT');
} catch (e) { console.error('[migrate] message columns:', e.message); }

const persist = require('./persist');
const { newId, newInviteCode, randomColor, randomDiscriminator } = require('./util');

/* One bad socket event (a malformed payload, a race on a deleted row) must not
   take the whole service down - Render would restart the instance and every
   live connection would drop. Log loudly and keep serving. */
process.on('uncaughtException', (err) => {
  console.error('[uncaught]', err && (err.stack || err.message || err));
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason && (reason.stack || reason.message || reason));
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'crossroads-dev-secret-change-me';
/* Stable identifier for the code that is currently running. Render injects
   RENDER_GIT_COMMIT (the deployed commit SHA) automatically, so this changes
   on every deploy. The client polls /api/version and shows a "refresh for the
   new update" prompt when the value it sees no longer matches the one the page
   was loaded with. BUILD_ID lets a non-Render host supply its own value. */
const BUILD_ID = process.env.RENDER_GIT_COMMIT || process.env.BUILD_ID || 'dev';
/* Platform administrators. Defaults to the account named "keep"; can be
   extended with a comma-separated ADMIN_USERNAMES environment variable.
   Accounts explicitly whitelisted by the owner are also treated as admins
   (see the admin_whitelist table below). */
const ADMIN_USERNAMES = new Set(
  (process.env.ADMIN_USERNAMES || 'keep')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
);
/* The platform owner. This account can never be banned, kicked, muted,
   disabled, renamed or have its sessions revoked by anyone (including other
   admins). Defaults to "keep". */
const OWNER_USERNAMES = new Set(
  (process.env.OWNER_USERNAMES || process.env.ADMIN_USERNAMES || 'keep')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
);
/* In-memory cache of whitelisted user ids, refreshed whenever the whitelist
   changes. Keeps isGlobalAdmin() cheap enough to call per request. */
let adminWhitelist = new Set();
function loadAdminWhitelist() {
  try {
    adminWhitelist = new Set(db.prepare('SELECT user_id FROM admin_whitelist').all().map(r => r.user_id));
  } catch (e) { adminWhitelist = new Set(); }
}
loadAdminWhitelist();

function isOwner(user) {
  if (!user || !user.username) return false;
  return OWNER_USERNAMES.has(String(user.username).toLowerCase());
}
function isGlobalAdmin(user) {
  if (!user || !user.username) return false;
  if (ADMIN_USERNAMES.has(String(user.username).toLowerCase())) return true;
  if (user.id && adminWhitelist.has(user.id)) return true;
  return false;
}
const UPLOAD_DIR = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 });

/* Set of user ids that currently have at least one live socket connection.
   Used to compute accurate "online" counts and to broadcast presence. */
const onlineUids = new Set();

/* Transient (in-memory) presence overrides. The database stores the status a
   user *chose*; this map stores a temporary effective status such as "offline"
   after a tab has been hidden for a while, or "idle" after inactivity. It is
   never persisted, so a refresh, reconnect or restart restores the chosen
   status automatically. */
const presenceOverrides = new Map();

/* Resolve the status other people should see for a user.
   1. A transient override (hidden tab / idle) always wins.
   2. No live socket at all means the person is genuinely offline, even if the
      database still holds the status they last chose.
   3. Otherwise fall back to the chosen status. */
function effectiveStatus(uid, dbStatus) {
  if (presenceOverrides.has(uid)) return presenceOverrides.get(uid);
  if (!onlineUids.has(uid)) return 'offline';
  return dbStatus || 'online';
}

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true }));
/* Uploads are user-supplied, so they are served with hardening headers. Media
   is shown inline; anything that could execute in a browser is forced to
   download instead. Existing files keep working — nothing is deleted. */
const DANGEROUS_EXT = new Set([
  '.exe', '.bat', '.cmd', '.com', '.msi', '.scr', '.ps1', '.vbs', '.vbe',
  '.js', '.mjs', '.jse', '.wsf', '.wsh', '.hta', '.jar', '.sh', '.bash',
  '.zsh', '.app', '.dll', '.cpl', '.pif', '.reg', '.lnk', '.iso', '.img',
  '.php', '.asp', '.aspx', '.jsp', '.cgi', '.pl', '.py', '.rb', '.lua',
  '.html', '.htm', '.xhtml', '.svg', '.svgz', '.xml', '.xhtml'
]);
app.use('/uploads', express.static(UPLOAD_DIR, {
  /* Filenames are random ids and never reused, so uploads are safe to cache
     for a year. Long-lived caching removes the re-download delay when a
     video/image is re-rendered (e.g. after a fullscreen toggle). */
  maxAge: '365d',
  immutable: true,
  setHeaders(res, filePath) {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'");
    const ext = path.extname(filePath).toLowerCase();
    if (DANGEROUS_EXT.has(ext)) {
      res.set('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
    }
  }
}));
/* A missing upload must 404, not fall through to the SPA HTML. Serving
   index.html for /uploads/... made <img> silently fail (an invisible, broken
   attachment) instead of letting the client show a clear placeholder.

   Before giving up we try the durable store: if the file exists in the data
   repo but has not been streamed down yet (cold start, or a restart mid
   transfer), fetch just that one file and serve it. This is what makes old
   images, videos and audio play immediately instead of showing "unavailable". */
const uploadMissCache = new Map(); // name -> timestamp of last confirmed miss
const UPLOAD_MISS_TTL = 5 * 60 * 1000;

app.use('/uploads', async (req, res) => {
  const raw = decodeURIComponent(req.path || '').replace(/^\/+/, '');
  const name = path.basename(raw);
  if (!persist.enabled || !name || name !== raw || name.startsWith('.')) {
    return res.status(404).type('text/plain').send('Not found');
  }
  const missedAt = uploadMissCache.get(name);
  if (missedAt && Date.now() - missedAt < UPLOAD_MISS_TTL) {
    return res.status(404).type('text/plain').send('Not found');
  }
  let ok = false;
  try { ok = await persist.fetchUpload(name); } catch (e) { ok = false; }
  if (!ok) {
    uploadMissCache.set(name, Date.now());
    return res.status(404).type('text/plain').send('Not found');
  }
  uploadMissCache.delete(name);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'");
  if (DANGEROUS_EXT.has(path.extname(name).toLowerCase())) {
    res.set('Content-Disposition', `attachment; filename="${name}"`);
  }
  res.sendFile(path.join(UPLOAD_DIR, name), {
    maxAge: '365d',
    immutable: true,
    headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }
  }, (err) => {
    if (err && !res.headersSent) res.status(404).type('text/plain').send('Not found');
  });
});
app.use(express.static(path.join(__dirname, 'public')));

/* ---------------- Health check + keep-alive ----------------
   Render's free plan stops a web service after ~15 minutes with no inbound HTTP
   traffic. The next visitor then pays a ~50 second cold start ("incoming HTTP
   request" only shows up once something finally hits the service).

   Two layers keep the instance warm:
     1. /health is a tiny endpoint that touches no database and needs no auth,
        so it is cheap enough to poll every few minutes.
     2. An in-process self-ping hits the service's own public URL on a schedule.
        Requests that arrive through Render's proxy count as inbound traffic,
        which resets the idle timer.
   A GitHub Actions cron (.github/workflows/keepalive.yml) also pings /health
   from outside, so the service can be woken even if it already fell asleep. */
const bootedAt = Date.now();
/* Keep-alive bookkeeping, surfaced on /health so the warm-up can be verified
   from a browser or a monitor without digging through logs. */
const keepAliveStats = { selfPings: 0, selfPingFails: 0, lastSelfPingAt: 0, lastSelfPingStatus: 0 };

app.get('/health', (req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.json({
    ok: true,
    service: 'crossroads',
    uptime: Math.round((Date.now() - bootedAt) / 1000),
    keepAlive: {
      enabled: !!KEEPALIVE_URL && process.env.KEEPALIVE_DISABLED !== '1',
      intervalSeconds: Math.round(KEEPALIVE_MS / 1000),
      selfPings: keepAliveStats.selfPings,
      selfPingFails: keepAliveStats.selfPingFails,
      lastSelfPingAt: keepAliveStats.lastSelfPingAt,
      lastSelfPingStatus: keepAliveStats.lastSelfPingStatus
    },
    ts: Date.now()
  });
});

app.get('/ping', (req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.type('text/plain').send('pong');
});

/* Version probe used by the client's soft-update watcher. `build` changes on
   every deploy (Render sets RENDER_GIT_COMMIT), so the client can tell when the
   running server is newer than the page the visitor is looking at. Never cached
   so a fresh deploy is detected immediately. */
app.get('/api/version', (req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.json({ build: BUILD_ID, ts: Date.now() });
});

/* Self-ping scheduler. KEEPALIVE_URL overrides the detected public URL;
   KEEPALIVE_DISABLED=1 turns it off (useful for local development). */
const KEEPALIVE_MS = Math.max(60 * 1000, parseInt(process.env.KEEPALIVE_INTERVAL_MS, 10) || 10 * 60 * 1000);
const KEEPALIVE_URL = (process.env.KEEPALIVE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');

function startKeepAlive() {
  if (process.env.KEEPALIVE_DISABLED === '1' || !KEEPALIVE_URL) return;
  const url = KEEPALIVE_URL + '/health';
  const tick = async () => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'crossroads-keepalive' } });
      clearTimeout(timer);
      keepAliveStats.selfPings++;
      keepAliveStats.lastSelfPingAt = Date.now();
      keepAliveStats.lastSelfPingStatus = r.status;
      if (!r.ok) console.log(`[keepalive] unexpected ${r.status} from ${url}`);
    } catch (e) {
      keepAliveStats.selfPingFails++;
      keepAliveStats.lastSelfPingAt = Date.now();
      console.log('[keepalive] self-ping failed:', e.message);
    }
  };
  /* Warm up shortly after boot, then on a steady interval. */
  setTimeout(tick, 8000).unref?.();
  const iv = setInterval(tick, KEEPALIVE_MS);
  if (iv.unref) iv.unref();
  console.log(`[keepalive] self-ping every ${Math.round(KEEPALIVE_MS / 60000)} min -> ${url}`);
}

/* ---------------- Uploads ---------------- */
/* Browsers and some clients send files with no extension (or a wrong one).
   Deriving the extension from the MIME type keeps the served Content-Type and
   the <video>/<img> element in agreement, which is what makes playback work. */
const MIME_EXT = {
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/ogg': '.ogv', 'video/quicktime': '.mov',
  'video/x-matroska': '.mkv', 'video/x-msvideo': '.avi',
  'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'audio/wav': '.wav', 'audio/webm': '.weba',
  'audio/mp4': '.m4a', 'audio/aac': '.aac', 'audio/flac': '.flac',
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp',
  'image/avif': '.avif', 'image/svg+xml': '.svg', 'image/bmp': '.bmp',
  'application/pdf': '.pdf', 'application/zip': '.zip'
};
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    let ext = path.extname(file.originalname || '') || '';
    if (!ext) ext = MIME_EXT[String(file.mimetype || '').toLowerCase()] || '';
    cb(null, `${newId()}${ext}`);
  }
});
/* 250 MB ceiling. Any file type is accepted now; risky extensions are still
   served as downloads (Content-Disposition: attachment) rather than executed. */
const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;
const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES }
});

/* ---------------- Helpers ---------------- */
function sign(user, sid) {
  const payload = { uid: user.id, tv: user.token_version || 0 };
  if (sid) payload.sid = sid;
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
}

/* ---------------- Device sessions ----------------
   Every sign-in creates a session row. The JWT embeds the session id so the
   Authorized Devices page can list and revoke individual devices. */
function createSession(userId, req) {
  const id = newId();
  const ua = String((req && req.headers && req.headers['user-agent']) || '').slice(0, 400);
  const ip = String((req && (req.headers['x-forwarded-for'] || req.socket && req.socket.remoteAddress)) || '')
    .split(',')[0].trim().slice(0, 80);
  const now = Date.now();
  try {
    db.prepare('INSERT INTO sessions (id, user_id, user_agent, ip, created_at, last_seen_at) VALUES (?,?,?,?,?,?)')
      .run(id, userId, ua, ip, now, now);
  } catch (e) { /* session tracking is best-effort */ }
  return id;
}

/* ---------------- Two-step login (TOTP) ----------------
   A dependency-free RFC 6238 implementation. The shared secret is stored on
   the user row; the six-digit code rotates every 30 seconds. */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpCode(secret, step) {
  const key = base32Decode(secret);
  const counter = Math.floor((step != null ? step : Date.now() / 1000) / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter % 0x100000000, 4);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0xf;
  const bin = ((hmac[off] & 0x7f) << 24) | ((hmac[off + 1] & 0xff) << 16) | ((hmac[off + 2] & 0xff) << 8) | (hmac[off + 3] & 0xff);
  return String(bin % 1000000).padStart(6, '0');
}
function verifyTotp(secret, code) {
  if (!secret || !code) return false;
  const c = String(code).replace(/\s+/g, '');
  const now = Date.now() / 1000;
  for (let d = -1; d <= 1; d++) {
    if (totpCode(secret, now + d * 30) === c) return true;
  }
  return false;
}
function newTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

/* A user may have a fixed code (test/demo accounts). When present it is shown
   and accepted instead of the rotating value, so the code never "changes". */
function userTotpCode(user, step) {
  if (!user) return null;
  if (user.twofa_fixed_code) return String(user.twofa_fixed_code);
  if (!user.twofa_secret) return null;
  return totpCode(user.twofa_secret, step);
}
function verifyUserTotp(user, code) {
  if (!user || !user.twofa_secret || !code) return false;
  const c = String(code).replace(/\s+/g, '');
  if (user.twofa_fixed_code && c === String(user.twofa_fixed_code)) return true;
  return verifyTotp(user.twofa_secret, c);
}

/* ---------------- Trusted devices (skip 2FA for 30 days) ---------------- */
const TRUST_DAYS = 30;
function hashDeviceToken(tok) {
  return crypto.createHash('sha256').update(String(tok)).digest('hex');
}
function createTrustedDevice(userId, req) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const expires = now + TRUST_DAYS * 24 * 60 * 60 * 1000;
  let label = '';
  try { label = describeDevice(req.headers['user-agent']); } catch (e) { label = ''; }
  try {
    db.prepare('INSERT INTO trusted_devices (id, user_id, token_hash, device_label, created_at, expires_at) VALUES (?,?,?,?,?,?)')
      .run(newId(), userId, hashDeviceToken(token), label, now, expires);
    /* Opportunistically prune this user's expired tokens. */
    db.prepare('DELETE FROM trusted_devices WHERE user_id = ? AND expires_at < ?').run(userId, now);
  } catch (e) { /* table should exist; ignore */ }
  return { token, expires_at: expires };
}
function isTrustedDevice(userId, token) {
  if (!token) return false;
  try {
    const row = db.prepare('SELECT * FROM trusted_devices WHERE user_id = ? AND token_hash = ?').get(userId, hashDeviceToken(token));
    if (!row) return false;
    if (row.expires_at < Date.now()) { db.prepare('DELETE FROM trusted_devices WHERE id = ?').run(row.id); return false; }
    return true;
  } catch (e) { return false; }
}

/* Badges assigned to a user, newest assignment first. Kept tiny so it can be
   embedded in every public user payload without extra round-trips. */
function badgesForUser(userId) {
  try {
    return db.prepare(`SELECT b.id, b.name, b.icon_url
                       FROM user_badges ub JOIN profile_badges b ON b.id = ub.badge_id
                       WHERE ub.user_id = ? ORDER BY ub.assigned_at DESC`).all(userId);
  } catch (e) { return []; }
}

/* Custom (server) roles a user holds, surfaced on their profile. */
function rolesForUser(userId, viewerId) {
  try {
    const rows = db.prepare(`SELECT r.id, r.name, r.color, r.color2, r.icon,
                                    s.id AS server_id, s.name AS server_name
                             FROM server_members m
                             JOIN server_roles r ON r.id = m.custom_role_id AND r.server_id = m.server_id
                             JOIN servers s ON s.id = m.server_id
                             WHERE m.user_id = ?
                             ORDER BY s.name COLLATE NOCASE ASC, r.position DESC`).all(userId);
    /* Roles are public profile flair, so show every role a user holds rather
       than hiding the ones from servers the viewer has not joined. */
    return rows;
  } catch (e) { return []; }
}

function publicUser(u, opts = {}) {
  if (!u) return null;
  /* Report the *effective* status (which may be a transient "offline" after a
     hidden tab or "idle" after inactivity) so that REST responses never snap a
     user back to the status stored in the database. `opts.self` is used for
     /api/me, where the caller always wants the status they actually chose. */
  const status = opts.self ? (u.status || 'online') : effectiveStatus(u.id, u.status);
  const out = {
    id: u.id,
    username: u.username,
    discriminator: u.discriminator,
    tag: `${u.username}#${u.discriminator}`,
    display_name: u.display_name || u.username,
    pronouns: u.pronouns || '',
    custom_status: u.custom_status || '',
    banner_color: u.banner_color || '#5865F2',
    avatar: u.avatar,
    avatar_url: u.avatar_url,
    banner: u.banner,
    banner_url: u.banner_url,
    accent_color: u.accent_color,
    bio: u.bio,
    status,
    verified: !!u.verified,
    muted: !!u.muted,
    platform_admin: isGlobalAdmin(u),
    platform_owner: isOwner(u),
    badges: badgesForUser(u.id),
    created_at: u.created_at
  };
  if (opts.self) out.twofa_enabled = !!u.twofa_enabled;
  if (opts.self) out.username_changed_at = u.username_changed_at || 0;
  return out;
}

/* A platform ban is checked on every authenticated request so a banned user is
   locked out immediately, even if they still hold a valid token. */
function isGloballyBanned(userId) {
  return !!db.prepare('SELECT 1 FROM global_bans WHERE user_id = ?').get(userId);
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token || null);
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.uid);
    if (!user) return res.status(401).json({ error: 'User not found' });
    /* Token versioning lets an admin revoke every existing session for an
       account (used by ban / force-logout / password reset actions). */
    if ((payload.tv || 0) !== (user.token_version || 0)) {
      return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    }
    if (user.disabled) return res.status(403).json({ error: 'This account has been disabled.' });
    if (user.deleted) return res.status(403).json({ error: 'This account has been deleted.' });
    if (user.deactivated) return res.status(403).json({ error: 'This account is deactivated. Sign in again to reactivate it.' });
    if (isGloballyBanned(user.id)) return res.status(403).json({ error: 'This account has been banned.' });
    /* If the token carries a session id, that session must still exist — this
       is how revoking a device on the Authorized Devices page logs it out. */
    if (payload.sid) {
      const sess = db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?').get(payload.sid, user.id);
      if (!sess) return res.status(401).json({ error: 'This device has been signed out. Please sign in again.' });
      try { db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(Date.now(), payload.sid); } catch (e) {}
      req.sessionId = payload.sid;
    }
    /* Best-effort last-seen tracking for the admin overview. */
    try { db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(Date.now(), user.id); } catch (e) {}
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

/* Only platform administrators (username "keep" by default) may pass. */
function adminOnly(req, res, next) {
  if (!isGlobalAdmin(req.user)) return res.status(403).json({ error: 'Administrator access required' });
  next();
}

/* Only the platform owner may pass (whitelist management, destructive bulk ops). */
function ownerOnly(req, res, next) {
  if (!isOwner(req.user)) return res.status(403).json({ error: 'Only the platform owner can do that' });
  next();
}

function adminAudit(req, action, targetType, targetId, detail) {
  try {
    db.prepare(`INSERT INTO admin_audit (id, actor_id, action, target_type, target_id, detail, created_at)
                VALUES (?,?,?,?,?,?,?)`)
      .run(newId(), req.user ? req.user.id : null, action, targetType || '', targetId || '', detail || '', Date.now());
  } catch (e) { /* auditing must never break the action */ }
}

function getGlobalSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM global_settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch (e) { return row.value; }
}
function setGlobalSetting(key, value) {
  db.prepare(`INSERT INTO global_settings (key, value) VALUES (?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(key, JSON.stringify(value));
}

/* ---------------- Lightweight rate limiting ----------------
   Protects the unauthenticated auth endpoints (and message sending) from
   brute-force / spam. In-memory only, so it resets on restart. */
const rateBuckets = new Map();
function rateLimit({ windowMs = 60000, max = 20, keyFn } = {}) {
  return (req, res, next) => {
    const key = (keyFn ? keyFn(req) : (req.ip || 'unknown')) + ':' + req.path;
    const now = Date.now();
    let b = rateBuckets.get(key);
    if (!b || b.reset < now) { b = { count: 0, reset: now + windowMs }; rateBuckets.set(key, b); }
    b.count++;
    if (b.count > max) {
      res.set('Retry-After', String(Math.ceil((b.reset - now) / 1000)));
      return res.status(429).json({ error: 'Too many attempts. Please wait a moment and try again.' });
    }
    next();
  };
}
/* Occasionally prune stale buckets so the map cannot grow without bound. */
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of rateBuckets) if (b.reset < now) rateBuckets.delete(k);
}, 5 * 60 * 1000).unref();

function uniqueUsernameDiscriminator(username) {
  // Generate a unique 4-digit discriminator for the username
  for (let i = 0; i < 50; i++) {
    const disc = randomDiscriminator();
    const exists = db.prepare('SELECT 1 FROM users WHERE username = ? AND discriminator = ?').get(username, disc);
    if (!exists) return disc;
  }
  // fallback: find any free discriminator
  for (let d = 1; d <= 9999; d++) {
    const disc = String(d).padStart(4, '0');
    const exists = db.prepare('SELECT 1 FROM users WHERE username = ? AND discriminator = ?').get(username, disc);
    if (!exists) return disc;
  }
  return randomDiscriminator();
}

function createDefaultChannels(serverId) {
  const now = Date.now();
  const mk = (name, position, topic = '') => {
    db.prepare('INSERT INTO channels (id, server_id, name, type, topic, position, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(newId(), serverId, name, 'text', topic, position, now);
  };
  mk('general', 0, 'Welcome to the server!');
  mk('random', 1, 'Off-topic chatter');
  db.prepare('INSERT INTO channels (id, server_id, name, type, topic, position, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(newId(), serverId, 'General Voice', 'voice', '', 2, now);
}

function getServerForUser(serverId, userId) {
  const member = db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?').get(serverId, userId);
  if (!member) return null;
  return db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
}

function memberRole(serverId, userId) {
  const row = db.prepare('SELECT role FROM server_members WHERE server_id = ? AND user_id = ?').get(serverId, userId);
  return row ? (row.role || 'member') : null;
}

/* Resolve the full set of permissions a member holds in a server. The owner
   and base admins implicitly hold every permission ('*'); a member with a
   custom role also gains whatever keys that role grants. This is what makes
   the role permission toggles actually do something. */
function memberPermissions(server, userId) {
  const perms = new Set();
  if (!server) return perms;
  if (server.owner_id === userId) { perms.add('*'); return perms; }
  let m;
  try {
    m = db.prepare('SELECT role, custom_role_id FROM server_members WHERE server_id = ? AND user_id = ?').get(server.id, userId);
  } catch (e) { m = null; }
  if (!m) return perms;
  if (m.role === 'owner' || m.role === 'admin') perms.add('*');
  if (m.custom_role_id) {
    try {
      const r = db.prepare('SELECT permissions FROM server_roles WHERE id = ? AND server_id = ?').get(m.custom_role_id, server.id);
      if (r) {
        const p = JSON.parse(r.permissions || '{}');
        for (const k of Object.keys(p)) if (p[k]) perms.add(k);
      }
    } catch (e) { /* ignore malformed role permissions */ }
  }
  return perms;
}

/* Does this member hold `key`? 'administrator' and owner/admin ('*') satisfy
   every check, matching Discord's behaviour. */
function hasPerm(server, userId, key) {
  const p = memberPermissions(server, userId);
  return p.has('*') || p.has('administrator') || p.has(key);
}

/* Owner + admins (and members whose custom role grants Administrator) can
   manage channels, invites and member roles. */
function isServerAdmin(server, userId) {
  if (!server) return false;
  if (server.owner_id === userId) return true;
  const r = memberRole(server.id, userId);
  if (r === 'owner' || r === 'admin') return true;
  return hasPerm(server, userId, 'administrator');
}

/* ---------------- Server settings / roles / bans ---------------- */

const SETTINGS_DEFAULTS = {
  verification_level: 'none',
  explicit_filter: 0,
  allow_everyone: 1,
  default_notifications: 'all',
  slow_mode: 0,
  system_channel_id: null,
  welcome_message: '',
  rules: '',
  allow_member_invites: 1,
  afk_channel_id: null,
  afk_timeout: 300,
  require_2fa: 0,
  raid_protection: 0,
  system_welcome: 1,
  default_role_id: null,
  invite_splash: 1,
  community_name: ''
};

/* Fetch a server's settings row, creating it (with defaults) on first use.
   Purely additive — never touches existing data. */
function getServerSettings(serverId) {
  let row = db.prepare('SELECT * FROM server_settings WHERE server_id = ?').get(serverId);
  if (!row) {
    db.prepare(`INSERT OR IGNORE INTO server_settings
      (server_id, verification_level, explicit_filter, allow_everyone, default_notifications, slow_mode, system_channel_id, updated_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(
        serverId, SETTINGS_DEFAULTS.verification_level, SETTINGS_DEFAULTS.explicit_filter,
        SETTINGS_DEFAULTS.allow_everyone, SETTINGS_DEFAULTS.default_notifications,
        SETTINGS_DEFAULTS.slow_mode, SETTINGS_DEFAULTS.system_channel_id, Date.now());
    row = db.prepare('SELECT * FROM server_settings WHERE server_id = ?').get(serverId);
  }
  return Object.assign({}, SETTINGS_DEFAULTS, row);
}

function listServerRoles(serverId) {
  return db.prepare('SELECT * FROM server_roles WHERE server_id = ? ORDER BY position ASC, created_at ASC').all(serverId);
}

function isBanned(serverId, userId) {
  return !!db.prepare('SELECT 1 FROM server_bans WHERE server_id = ? AND user_id = ?').get(serverId, userId);
}

function addAudit(serverId, actorId, action, targetId, detail) {
  try {
    db.prepare('INSERT INTO server_audit (id, server_id, actor_id, action, target_id, detail, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(newId(), serverId, actorId || null, action, targetId || null, detail || '', Date.now());
  } catch (e) { /* audit is best-effort */ }
}

/* Remove a member from a server (used by kick + ban). Returns true if removed. */
function removeMember(serverId, userId) {
  const info = db.prepare('DELETE FROM server_members WHERE server_id = ? AND user_id = ?').run(serverId, userId);
  return info.changes > 0;
}

/* Notify every connected client that a server's member list changed. */
function broadcastMembers(serverId) {
  io.emit('server_members_update', { server_id: serverId });
}

/* Push the current channel list for a server to every connected client so
   channel changes appear instantly everywhere (clients filter by server id). */
function broadcastChannels(serverId) {
  const channels = db.prepare('SELECT * FROM channels WHERE server_id = ? ORDER BY position ASC, created_at ASC').all(serverId);
  const categories = db.prepare('SELECT * FROM channel_categories WHERE server_id = ? ORDER BY position ASC, created_at ASC').all(serverId);
  io.emit('channels_update', { server_id: serverId, channels, categories });
}

/* Broadcast a profile change to every client so avatars / banners / names /
   statuses update live everywhere (member lists, DM lists, message authors). */
function broadcastProfile(user) {
  if (!user) return;
  io.emit('profile_update', publicUser(user));
}

/* ---------------- Voice channels (in-memory signaling state) ----------------
   Voice is ephemeral: we never persist it. `voiceStates` maps a channel id to
   a Map of userId -> { user_id, muted, deafened, speaking, joined_at }. The
   server only relays WebRTC signaling between peers; audio flows peer-to-peer. */
const voiceStates = new Map();

function voiceMembers(channelId) {
  const m = voiceStates.get(channelId);
  return m ? Array.from(m.values()) : [];
}

function voiceChannelOf(userId) {
  for (const [cid, m] of voiceStates) if (m.has(userId)) return cid;
  return null;
}

function broadcastVoiceState(channelId) {
  const ch = db.prepare('SELECT server_id FROM channels WHERE id = ?').get(channelId);
  if (!ch) return;
  io.emit('voice_state', { channel_id: channelId, server_id: ch.server_id, members: voiceMembers(channelId) });
}

function removeFromVoice(socket, channelId) {
  const m = voiceStates.get(channelId);
  if (!m || !m.has(socket.uid)) return;
  m.delete(socket.uid);
  if (!m.size) voiceStates.delete(channelId);
  socket.leave(`voice:${channelId}`);
  socket.to(`voice:${channelId}`).emit('voice_peer_left', { channel_id: channelId, user_id: socket.uid });
  broadcastVoiceState(channelId);
}

/* ---------------- Direct-message calls (in-memory signaling) ----------------
   A DM call is ephemeral like voice: we keep only the ringing/active state in
   memory and relay WebRTC offers/answers/ICE between the two participants.
   Audio is peer-to-peer, so there is no server-side media cost or delay. */
const dmCalls = new Map(); // dm_id -> call record
const DM_CALL_RING_MS = 45000;

function dmCallPublic(call) {
  if (!call) return null;
  return {
    dm_id: call.dm_id,
    caller_id: call.caller_id,
    callee_id: call.callee_id,
    state: call.state,
    started_at: call.started_at || null,
    created_at: call.created_at
  };
}

/* A call generates a "call" notification for the callee and a "call_out"
   one for the caller. Once the call is answered or over those should not sit
   in the notification centre as unread (they would leave a permanent red
   badge after every call). Mark them read and tell the clients. */
function markCallNotificationsRead(dmId) {
  if (!dmId) return;
  try {
    const rows = db.prepare(
      "SELECT id, user_id FROM notifications WHERE type IN ('call','call_out') AND read = 0 AND data LIKE ?"
    ).all('%' + dmId + '%');
    if (!rows.length) return;
    const upd = db.prepare('UPDATE notifications SET read = 1 WHERE id = ?');
    const byUser = new Map();
    for (const r of rows) {
      upd.run(r.id);
      if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
      byUser.get(r.user_id).push(r.id);
    }
    for (const [userId, ids] of byUser) io.to(`user:${userId}`).emit('notifications_read', { ids });
  } catch (e) { /* never let notification housekeeping break a call */ }
}

function endDmCall(dmId, reason, exceptUserId) {
  markCallNotificationsRead(dmId);
  const call = dmCalls.get(dmId);
  if (!call) return;
  if (call.timer) clearTimeout(call.timer);
  dmCalls.delete(dmId);
  const payload = { dm_id: dmId, reason: reason || 'ended', call: dmCallPublic(call) };
  for (const uid of [call.caller_id, call.callee_id]) {
    if (uid && uid !== exceptUserId) io.to(`user:${uid}`).emit('dm_call_ended', payload);
  }
}

/* End any call a disconnecting user is part of. */
function endCallsForUser(uid) {
  for (const [dmId, call] of Array.from(dmCalls.entries())) {
    if (call.caller_id === uid || call.callee_id === uid) endDmCall(dmId, 'disconnected', uid);
  }
}

/* ---------------- Servers: serialisation + invites ---------------- */

function serverStats(serverId) {
  const memberCount = db.prepare('SELECT COUNT(*) AS c FROM server_members WHERE server_id = ?').get(serverId).c;
  const rows = db.prepare(`SELECT u.id, u.status FROM server_members m JOIN users u ON u.id = m.user_id
    WHERE m.server_id = ?`).all(serverId);
  // A member counts as online only when they are actually connected AND have
  // not chosen the invisible/offline status.
  const onlineCount = rows.filter(r => effectiveStatus(r.id, r.status) !== 'offline' && onlineUids.has(r.id)).length;
  return { member_count: memberCount, online_count: onlineCount };
}

function publicServer(s) {
  if (!s) return null;
  const stats = serverStats(s.id);
  return Object.assign({}, s, {
    banner_url: s.banner_url || null,
    description: s.description || '',
    member_count: stats.member_count,
    online_count: stats.online_count
  });
}

/* Accepts a raw code, a short "gg/<code>" link, or a full invite URL. Returns
   just the code portion (or the input unchanged when nothing matches). */
function normalizeInviteCode(raw) {
  let v = String(raw || '').trim();
  if (!v) return '';
  // Full URL: grab the ?invite= query value or the final path segment.
  if (/^https?:\/\//i.test(v)) {
    try {
      const u = new URL(v);
      const q = u.searchParams.get('invite');
      if (q) return q.trim();
      v = u.pathname;
    } catch (e) { /* fall through */ }
  }
  // Short "gg/<code>" form (optionally with a domain prefix).
  const gg = v.match(/(?:^|\/)(?:gg|invite)\/([A-Za-z0-9_-]{4,64})\/?$/i);
  if (gg) return gg[1];
  if (v.includes('/')) v = v.split('/').filter(Boolean).pop();
  return v.trim();
}

function getInvite(code) {
  const row = db.prepare('SELECT * FROM invites WHERE code = ?').get(code);
  if (!row) return null;
  const expired = row.expires_at && Date.now() > row.expires_at;
  const maxed = row.max_uses && row.uses >= row.max_uses;
  return { invite: row, valid: !expired && !maxed, expired: !!expired, maxed: !!maxed };
}

/* Shape an invite row for the client, including a ready-to-share short link. */
function invitePublic(row) {
  if (!row) return null;
  const expired = row.expires_at && Date.now() > row.expires_at;
  const maxed = row.max_uses && row.uses >= row.max_uses;
  return {
    code: row.code,
    server_id: row.server_id,
    creator_id: row.creator_id,
    created_at: row.created_at,
    expires_at: row.expires_at || null,
    max_uses: row.max_uses || null,
    uses: row.uses || 0,
    expired: !!expired,
    maxed: !!maxed,
    valid: !expired && !maxed,
    link: `gg/${row.code}`
  };
}

/* ---------------- Relationships (friends / blocks) ---------------- */
function relationshipBetween(aId, bId) {
  const block = db.prepare('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)')
    .get(aId, bId, bId, aId);
  if (block) return 'blocked';
  const f = db.prepare('SELECT * FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)')
    .get(aId, bId, bId, aId);
  if (!f) return 'none';
  if (f.status === 'accepted') return 'friends';
  return f.requester_id === aId ? 'pending_outgoing' : 'pending_incoming';
}

/* True when either user has blocked the other. Used to hide messages and to
   forbid DMs / calls in both directions. */
function isBlockedBetween(aId, bId) {
  if (!aId || !bId) return false;
  return !!db.prepare('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)')
    .get(aId, bId, bId, aId);
}

/* Ids of everyone the given user has blocked (for filtering message history). */
function blockedIdsOf(uid) {
  return db.prepare('SELECT blocked_id FROM blocks WHERE blocker_id = ?').all(uid).map(r => r.blocked_id);
}

function friendIdsOf(uid) {
  return db.prepare(`SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS fid
    FROM friendships WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)`)
    .all(uid, uid, uid).map(r => r.fid);
}

function mutualServers(aId, bId) {
  return db.prepare(`SELECT s.* FROM servers s
    JOIN server_members m1 ON m1.server_id = s.id AND m1.user_id = ?
    JOIN server_members m2 ON m2.server_id = s.id AND m2.user_id = ?`)
    .all(aId, bId);
}

function mutualFriends(aId, bId) {
  const a = new Set(friendIdsOf(aId));
  return friendIdsOf(bId).filter(id => a.has(id) && id !== aId && id !== bId)
    .map(id => publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)))
    .filter(Boolean);
}

function groupReactions(rows, currentUserId) {
  const grouped = {};
  for (const r of rows) {
    if (!grouped[r.emoji]) grouped[r.emoji] = { emoji: r.emoji, count: 0, me: false, users: [] };
    grouped[r.emoji].count++;
    grouped[r.emoji].users.push(r.user_id);
    if (r.user_id === currentUserId) grouped[r.emoji].me = true;
  }
  return Object.values(grouped);
}

function safeParse(s, fallback) {
  try { return JSON.parse(s); } catch (e) { return fallback; }
}

function replyPreviewOf(m) {
  if (!m || !m.reply_to_id) return null;
  const orig = db.prepare('SELECT * FROM messages WHERE id = ?').get(m.reply_to_id);
  if (!orig) return null;
  const author = db.prepare('SELECT * FROM users WHERE id = ?').get(orig.user_id);
  const enc = isEncryptedContent(orig.content);
  return {
    id: orig.id,
    /* Never leak the raw E2E envelope into a reply preview. `plain` carries the
       readable mirror when we have one, so the quote shows real text. */
    content: enc ? null : orig.content,
    plain: orig.content_plain || null,
    encrypted: enc,
    attachment_url: orig.attachment_url,
    attachment_name: orig.attachment_name,
    attachment_type: orig.attachment_type,
    attachment_size: orig.attachment_size || null,
    attachment_spoiler: !!orig.attachment_spoiler,
    attachment_description: orig.attachment_description || null,
    author: publicUser(author)
  };
}

function messageWithMeta(m, currentUserId) {
  const author = db.prepare('SELECT * FROM users WHERE id = ?').get(m.user_id);
  const reactions = db.prepare('SELECT emoji, user_id FROM reactions WHERE message_id = ?').all(m.id);
  return {
    id: m.id,
    channel_id: m.channel_id,
    dm_id: m.dm_id,
    content: m.content,
    plain: m.content_plain || null,
    kind: m.kind || 'text',
    attachment_url: m.attachment_url,
    attachment_name: m.attachment_name,
    attachment_type: m.attachment_type,
    attachment_size: m.attachment_size || null,
    attachment_spoiler: !!m.attachment_spoiler,
    attachment_description: m.attachment_description || null,
    created_at: m.created_at,
    edited_at: m.edited_at,
    reply_to_id: m.reply_to_id || null,
    reply_to: replyPreviewOf(m),
    mentions: safeParse(m.mentions, []),
    pinned: !!m.pinned,
    author: publicUser(author),
    reactions: groupReactions(reactions, currentUserId)
  };
}

/* Batch version — fetches authors, reactions and replied-to messages in bulk
   so loading a channel never triggers an N+1 query storm (fixes lag). */
function messagesWithMeta(rows, currentUserId) {
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const authorIds = [...new Set(rows.map(r => r.user_id))];
  const replyIds = [...new Set(rows.map(r => r.reply_to_id).filter(Boolean))];

  const authorMap = {};
  if (authorIds.length) {
    const ph = authorIds.map(() => '?').join(',');
    for (const u of db.prepare(`SELECT * FROM users WHERE id IN (${ph})`).all(...authorIds)) authorMap[u.id] = u;
  }
  const reactMap = {};
  {
    const ph = ids.map(() => '?').join(',');
    for (const r of db.prepare(`SELECT message_id, emoji, user_id FROM reactions WHERE message_id IN (${ph})`).all(...ids)) {
      (reactMap[r.message_id] = reactMap[r.message_id] || []).push(r);
    }
  }
  const replyMap = {};
  if (replyIds.length) {
    const ph = replyIds.map(() => '?').join(',');
    const origs = db.prepare(`SELECT * FROM messages WHERE id IN (${ph})`).all(...replyIds);
    const origAuthorIds = [...new Set(origs.map(o => o.user_id))];
    const origAuthors = {};
    if (origAuthorIds.length) {
      const ph2 = origAuthorIds.map(() => '?').join(',');
      for (const u of db.prepare(`SELECT * FROM users WHERE id IN (${ph2})`).all(...origAuthorIds)) origAuthors[u.id] = u;
    }
    for (const o of origs) {
      const enc = isEncryptedContent(o.content);
      replyMap[o.id] = {
        id: o.id,
        content: enc ? null : o.content,
        plain: o.content_plain || null,
        encrypted: enc,
        attachment_url: o.attachment_url,
        attachment_name: o.attachment_name,
        attachment_type: o.attachment_type,
        author: publicUser(origAuthors[o.user_id])
      };
    }
  }
  return rows.map(m => ({
    id: m.id,
    channel_id: m.channel_id,
    dm_id: m.dm_id,
    content: m.content,
    plain: m.content_plain || null,
    kind: m.kind || 'text',
    attachment_url: m.attachment_url,
    attachment_name: m.attachment_name,
    attachment_type: m.attachment_type,
    attachment_size: m.attachment_size || null,
    attachment_spoiler: !!m.attachment_spoiler,
    attachment_description: m.attachment_description || null,
    created_at: m.created_at,
    edited_at: m.edited_at,
    reply_to_id: m.reply_to_id || null,
    reply_to: m.reply_to_id ? (replyMap[m.reply_to_id] || null) : null,
    mentions: safeParse(m.mentions, []),
    pinned: !!m.pinned,
    author: publicUser(authorMap[m.user_id]),
    reactions: groupReactions(reactMap[m.id] || [], currentUserId)
  }));
}

/* ---------------- Channel webhooks ---------------- */
function getChannelWebhook(channelId) {
  try {
    return db.prepare('SELECT * FROM channel_webhooks WHERE channel_id = ?').get(channelId) || null;
  } catch (e) { return null; }
}

function isValidWebhookUrl(raw) {
  try {
    const u = new URL(String(raw));
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname;
  } catch (e) { return false; }
}

/* Webhook avatars may be an uploaded file (/uploads/...), a remote image, or
   an inline data URI. Anything else is rejected so the field cannot be abused
   to inject arbitrary markup. */
function safeWebhookAvatar(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v.slice(0, 2000);
  if (v.startsWith('/uploads/')) return v.slice(0, 2000);
  if (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(v)) return v.slice(0, 2_000_000);
  return null;
}

/* Absolute base URL used to build the public webhook endpoint. Render sets
   RENDER_EXTERNAL_URL automatically; PUBLIC_BASE_URL can override it. */
function webhookBaseUrl(req) {
  const env = process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL;
  if (env) return String(env).replace(/\/+$/, '');
  const host = (req && req.get && req.get('host')) || 'localhost:3000';
  const fwd = req && req.get && req.get('x-forwarded-proto');
  const proto = fwd === 'https' || /onrender\.com$/i.test(host) ? 'https' : ((req && req.protocol) || 'http');
  return proto + '://' + host;
}

const webhookTokenGen = () => crypto.randomBytes(24).toString('base64url');

/* Each webhook gets its own hidden bot account so the messages it posts have a
   real author row (name + avatar) without polluting search or member lists. */
function ensureWebhookBot(wh, name, avatarUrl) {
  const display = String(name || 'Webhook').slice(0, 80);
  let bot = wh.bot_user_id ? db.prepare('SELECT * FROM users WHERE id = ?').get(wh.bot_user_id) : null;
  if (!bot) {
    let username = display.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'webhook';
    let disc = randomDiscriminator();
    for (let i = 0; i < 8; i++) {
      const clash = db.prepare('SELECT 1 FROM users WHERE LOWER(username) = LOWER(?) AND discriminator = ?').get(username, disc);
      if (!clash) break;
      disc = randomDiscriminator();
    }
    const id = 'wh_' + newId();
    db.prepare(`INSERT INTO users (id, username, discriminator, email, password_hash, display_name, avatar_url, status, created_at, is_webhook)
                VALUES (?,?,?,NULL,?,?,?,?,?,1)`)
      .run(id, username, disc, 'x' + newId(), display, avatarUrl || null, 'offline', Date.now());
    bot = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    db.prepare('UPDATE channel_webhooks SET bot_user_id = ? WHERE channel_id = ?').run(id, wh.channel_id);
  } else {
    db.prepare('UPDATE users SET display_name = ?, avatar_url = ? WHERE id = ?')
      .run(display, avatarUrl || null, bot.id);
  }
  return bot;
}

/* Create (or regenerate) the random webhook URL for a channel. */
function mintChannelWebhook(req, ch, name, avatarUrl, enabled) {
  const token = webhookTokenGen();
  const url = webhookBaseUrl(req) + '/api/webhooks/' + token;
  const now = Date.now();
  const existing = getChannelWebhook(ch.id);
  if (existing) {
    db.prepare('UPDATE channel_webhooks SET url = ?, token = ?, name = ?, avatar_url = ?, enabled = ?, updated_at = ? WHERE channel_id = ?')
      .run(url, token, name || null, avatarUrl || null, enabled ? 1 : 0, now, ch.id);
  } else {
    db.prepare('INSERT INTO channel_webhooks (channel_id, url, token, name, avatar_url, enabled, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(ch.id, url, token, name || null, avatarUrl || null, enabled ? 1 : 0, now, now);
  }
  const wh = getChannelWebhook(ch.id);
  ensureWebhookBot(wh, wh.name, wh.avatar_url);
  return getChannelWebhook(ch.id);
}

function webhookPublic(wh) {
  if (!wh) return null;
  return {
    url: wh.url, token: wh.token || null, name: wh.name || '',
    avatar_url: wh.avatar_url || null, enabled: !!wh.enabled,
    created_at: wh.created_at, updated_at: wh.updated_at, last_used_at: wh.last_used_at || null
  };
}

/* Extract readable text from the many shapes an external service may send:
   Discord/Slack style JSON, plain text, form fields, or embeds. */
function incomingWebhookText(body) {
  if (body == null) return '';
  if (typeof body === 'string') return body.trim();
  const b = body || {};
  let text = b.content || b.text || b.message || b.body || '';
  if (!text && Array.isArray(b.embeds) && b.embeds.length) {
    text = b.embeds.map(e => [e.title, e.description, e.url].filter(Boolean).join('\n')).join('\n\n');
  }
  if (!text && b.embed && typeof b.embed === 'object') {
    text = [b.embed.title, b.embed.description].filter(Boolean).join('\n');
  }
  if (!text && Array.isArray(b.attachments) && b.attachments.length) {
    text = b.attachments.map(a => a.url || a.text || '').filter(Boolean).join('\n');
  }
  if (!text && typeof b === 'object') {
    const keys = Object.keys(b);
    if (keys.length) { try { text = JSON.stringify(b); } catch (e) { text = ''; } }
  }
  return String(text || '').trim();
}

/* Insert a message into a channel on behalf of a webhook. Shared by the public
   endpoint and the in-app "Send test" button. */
function postWebhookMessage(wh, ch, rawText) {
  const text = String(rawText || '').trim().slice(0, 4000);
  if (!text) return null;
  const bot = wh.bot_user_id ? db.prepare('SELECT * FROM users WHERE id = ?').get(wh.bot_user_id) : null;
  if (!bot) return null;
  const id = newId();
  const now = Date.now();
  db.prepare(`INSERT INTO messages (id, channel_id, user_id, content, created_at, mentions)
              VALUES (?,?,?,?,?,?)`)
    .run(id, ch.id, bot.id, text, now, '[]');
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  const full = messageWithMeta(m, bot.id);
  io.to(`channel:${ch.id}`).emit('message', full);
  try { db.prepare('UPDATE channel_webhooks SET last_used_at = ? WHERE channel_id = ?').run(now, ch.id); } catch (e) {}
  return full;
}

/* ---------------- Mentions & notifications ---------------- *//* ---------------- Mentions & notifications ---------------- */
function parseMentionIds(content) {
  if (!content) return [];
  const names = new Set();
  const re = /@([a-zA-Z0-9._]+)/g;
  let mm;
  while ((mm = re.exec(content)) !== null) names.add(mm[1].toLowerCase());
  const ids = [];
  for (const name of names) {
    const u = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) ORDER BY created_at ASC LIMIT 1').get(name);
    if (u) ids.push(u.id);
  }
  return ids;
}

/* End-to-end encrypted message bodies are opaque to the server, so the client
   sends the mention list and any @everyone/@here ping it detected alongside
   the ciphertext. Plaintext messages keep the old server-side parsing. */
const E2E_PREFIX = '\u0001E2E1:';
function isEncryptedContent(content) {
  return typeof content === 'string' && content.startsWith(E2E_PREFIX);
}
function resolveMentionIds(content, mentionsIn, selfId) {
  if (Array.isArray(mentionsIn)) {
    return [...new Set(mentionsIn.filter(x => typeof x === 'string' && x && x !== selfId))];
  }
  return parseMentionIds(content).filter(uid => uid !== selfId);
}
function resolveBroadcast(content, broadcastIn) {
  if (broadcastIn === 'everyone' || broadcastIn === 'here') return broadcastIn;
  return parseBroadcastPing(content);
}

function createNotification(userId, type, data) {
  if (!userId) return null;
  const id = newId();
  const now = Date.now();
  db.prepare('INSERT INTO notifications (id, user_id, type, data, read, created_at) VALUES (?,?,?,?,0,?)')
    .run(id, userId, type, JSON.stringify(data), now);
  const notif = { id, type, data, read: false, created_at: now };
  io.to(`user:${userId}`).emit('notification', notif);
  return notif;
}

/* Detect an @everyone or @here broadcast in a message. Returns 'everyone',
   'here' or null. Word-boundary aware so "@everyoneelse" does not count. */
function parseBroadcastPing(content) {
  if (!content) return null;
  if (/(^|[^\w@])@everyone\b/i.test(content)) return 'everyone';
  if (/(^|[^\w@])@here\b/i.test(content)) return 'here';
  return null;
}

/* Very small explicit-content screen used by the server's Explicit Content
   Filter setting. It is intentionally conservative: it looks for a short list
   of unambiguous adult terms plus explicit-looking attachment filenames. It
   never deletes anything — it only refuses to accept the new message. */
const EXPLICIT_TERMS = [
  'porn', 'porno', 'pornography', 'nsfw', 'xxx', 'hentai', 'nudes', 'nude pic',
  'onlyfans', 'cumshot', 'blowjob', 'handjob', 'dildo', 'vibrator', 'orgasm',
  'masturbat', 'penetrat', 'creampie', 'anal sex', 'vagina', 'penis', 'boobs pic'
];
function explicitContentReason(content, attachmentType, attachmentName) {
  const text = String(content || '').toLowerCase();
  for (const term of EXPLICIT_TERMS) {
    if (text.includes(term)) return 'this message contains explicit language';
  }
  const fname = String(attachmentName || '').toLowerCase();
  if (fname) {
    for (const term of EXPLICIT_TERMS) {
      if (fname.includes(term)) return 'this attachment name looks explicit';
    }
  }
  /* Images and videos cannot be inspected server-side, so when the filter is on
     we ask the sender to confirm by keeping media out of the channel. */
  if (attachmentType && /^(image|video)\//i.test(attachmentType) && /nsfw|explicit|adult/i.test(fname)) {
    return 'this attachment is marked explicit';
  }
  return null;
}

/* ---------------- Auth routes ---------------- */
app.get('/api/check-username', (req, res) => {
  const username = (req.query.username || '').trim();
  if (!username) return res.json({ available: false, reason: 'Enter a username' });
  if (username.length < 2 || username.length > 32) return res.json({ available: false, reason: 'Username must be 2-32 characters' });
  if (!/^[a-zA-Z0-9._]+$/.test(username)) return res.json({ available: false, reason: 'Only letters, numbers, periods and underscores are allowed' });
  const exclude = (req.query.exclude || '').trim();
  const taken = exclude
    ? db.prepare('SELECT 1 FROM users WHERE LOWER(username) = LOWER(?) AND id != ?').get(username, exclude)
    : db.prepare('SELECT 1 FROM users WHERE LOWER(username) = LOWER(?)').get(username);
  res.json({ available: !taken, reason: taken ? 'That username is already taken' : 'Username is available' });
});

app.post('/api/register', rateLimit({ windowMs: 60000, max: 10 }), (req, res) => {
  let { username, password } = req.body || {};
  username = (username || '').trim();
  if (getGlobalSetting('registration_open', true) === false) {
    return res.status(403).json({ error: 'Registration is currently closed.' });
  }
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  if (username.length < 2 || username.length > 32) return res.status(400).json({ error: 'Username must be 2-32 characters' });
  if (!/^[a-zA-Z0-9._]+$/.test(username)) return res.status(400).json({ error: 'Username may only contain letters, numbers, periods and underscores' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const taken = db.prepare('SELECT 1 FROM users WHERE LOWER(username) = LOWER(?)').get(username);
  if (taken) return res.status(409).json({ error: 'That username is already taken' });

  const discriminator = uniqueUsernameDiscriminator(username);
  const id = newId();
  const hash = bcrypt.hashSync(password, 10);
  const now = Date.now();
  const accent = randomColor();
  db.prepare(`INSERT INTO users (id, username, discriminator, password_hash, accent_color, status, created_at)
              VALUES (?,?,?,?,?,?,?)`)
    .run(id, username, discriminator, hash, accent, 'online', now);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const sid = createSession(user.id, req);
  const token = sign(user, sid);
  res.json({ token, user: publicUser(user) });
});

app.post('/api/login', rateLimit({ windowMs: 60000, max: 15 }), (req, res) => {
  let { identifier, username, password, code, trust_device, device_token } = req.body || {};
  const login = (identifier || username || '').trim();
  if (!login || !password) return res.status(400).json({ error: 'Credentials required' });
  let user;
  if (login.includes('#')) {
    const [uname, disc] = login.split('#');
    user = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?) AND discriminator = ?').get(uname, disc);
  } else {
    user = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?) ORDER BY created_at ASC LIMIT 1').get(login);
  }
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  if (user.disabled) return res.status(403).json({ error: 'This account has been disabled.' });
  if (user.deleted) return res.status(403).json({ error: 'This account has been deleted.' });
  /* A deactivated account is reactivated simply by signing back in with the
     correct password. This is the "pause my account" path, not a ban. */
  if (user.deactivated) {
    db.prepare('UPDATE users SET deactivated = 0, deactivated_at = NULL, status = ? WHERE id = ?').run('online', user.id);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  }
  if (isGloballyBanned(user.id)) return res.status(403).json({ error: 'This account has been banned.' });
  /* Two-step login: when enabled, a valid rotating code is required unless
     this browser is a previously trusted device (still within 30 days). */
  let trustedToken = null;
  if (user.twofa_enabled) {
    const trusted = isTrustedDevice(user.id, device_token);
    if (!trusted) {
      if (!code) {
        return res.status(401).json({ twofa_required: true, error: 'Enter the 6-digit code from your authenticator or the code shown in your settings.' });
      }
      if (!verifyUserTotp(user, code)) {
        return res.status(401).json({ twofa_required: true, error: 'That code is incorrect or has expired. Try the current code.' });
      }
      if (trust_device) {
        const d = createTrustedDevice(user.id, req);
        trustedToken = d.token;
      }
    }
  }
  const sid = createSession(user.id, req);
  const token = sign(user, sid);
  const out = { token, user: publicUser(user) };
  if (trustedToken) { out.trusted_device_token = trustedToken; out.trusted_device_days = TRUST_DAYS; }
  res.json(out);
});

/* Two-step recovery (unauthenticated, password-gated).
   Used by the "Lost your authenticator?" link on the sign-in screen. Holding
   the account password is the proof of ownership here: we mint a brand-new
   secret, turn two-step off until the owner confirms the new one, and drop any
   trusted-device tokens so an old device cannot ride along. We deliberately
   never return the *existing* secret — only the replacement. */
app.post('/api/2fa/recover', rateLimit({ windowMs: 60000, max: 8 }), (req, res) => {
  let { identifier, password } = req.body || {};
  const login = (identifier || '').trim();
  if (!login || !password) return res.status(400).json({ error: 'Username and password are required' });
  let user;
  if (login.includes('#')) {
    const [uname, disc] = login.split('#');
    user = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?) AND discriminator = ?').get(uname, disc);
  } else {
    user = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?) ORDER BY created_at ASC LIMIT 1').get(login);
  }
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  if (user.disabled) return res.status(403).json({ error: 'This account has been disabled.' });
  if (isGloballyBanned(user.id)) return res.status(403).json({ error: 'This account has been banned.' });
  const secret = newTotpSecret();
  db.prepare('UPDATE users SET twofa_secret = ?, twofa_enabled = 0 WHERE id = ?').run(secret, user.id);
  try { db.prepare('DELETE FROM trusted_devices WHERE user_id = ?').run(user.id); } catch (e) {}
  const now = Date.now() / 1000;
  const tag = `${user.username}#${user.discriminator}`;
  res.json({
    ok: true,
    secret,
    code: userTotpCode(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id), now),
    seconds: 30 - Math.floor(now % 30),
    otpauth: `otpauth://totp/Crossroads:${encodeURIComponent(tag)}?secret=${secret}&issuer=Crossroads&period=30&digits=6`
  });
});

/* Password reset (unauthenticated). Requires the exact username#tag so a user
   who has forgotten their password can regain access. */
app.post('/api/password/reset', rateLimit({ windowMs: 60000, max: 8 }), (req, res) => {
  let { identifier, new_password } = req.body || {};
  identifier = (identifier || '').trim();
  if (!identifier || !new_password) {
    return res.status(400).json({ error: 'Your username tag and a new password are required' });
  }
  if (!identifier.includes('#')) {
    return res.status(400).json({ error: 'Enter your full tag, for example username#0000' });
  }
  const [uname, disc] = identifier.split('#');
  if (!uname.trim() || !disc.trim()) {
    return res.status(400).json({ error: 'Enter your full tag, for example username#0000' });
  }
  const user = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?) AND discriminator = ?')
    .get(uname.trim(), disc.trim());
  if (!user) {
    return res.status(404).json({ error: 'No account matches that username and tag' });
  }
  if (String(new_password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (String(new_password).length > 128) {
    return res.status(400).json({ error: 'Password is too long' });
  }
  if (user.disabled) return res.status(403).json({ error: 'This account has been disabled.' });
  if (isGloballyBanned(user.id)) return res.status(403).json({ error: 'This account has been banned.' });
  const hash = bcrypt.hashSync(String(new_password), 10);
  /* Bumping token_version invalidates every existing session after a reset. */
  db.prepare('UPDATE users SET password_hash = ?, token_version = COALESCE(token_version,0) + 1 WHERE id = ?').run(hash, user.id);
  res.json({ ok: true });
});

/* ---------------- Authorized devices (sessions) ---------------- */

/* Turn a raw user-agent into a friendly device label. */
function describeDevice(ua) {
  const s = String(ua || '');
  let browser = 'Unknown browser';
  if (/Edg\//i.test(s)) browser = 'Microsoft Edge';
  else if (/OPR\/|Opera/i.test(s)) browser = 'Opera';
  else if (/Firefox\//i.test(s)) browser = 'Firefox';
  else if (/Chrome\//i.test(s)) browser = 'Chrome';
  else if (/Safari\//i.test(s)) browser = 'Safari';
  let os = 'Unknown OS';
  if (/Windows NT/i.test(s)) os = 'Windows';
  else if (/iPhone|iPad|iPod/i.test(s)) os = 'iOS';
  else if (/Android/i.test(s)) os = 'Android';
  else if (/Mac OS X|Macintosh/i.test(s)) os = 'macOS';
  else if (/Linux/i.test(s)) os = 'Linux';
  let kind = 'Desktop';
  if (/Mobile|iPhone|Android(?!.*Tablet)/i.test(s)) kind = 'Mobile';
  else if (/iPad|Tablet/i.test(s)) kind = 'Tablet';
  return { browser, os, kind, label: `${browser} on ${os}` };
}

app.get('/api/sessions', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC').all(req.user.id);
  const sessions = rows.map(r => Object.assign({
    id: r.id,
    current: r.id === req.sessionId,
    created_at: r.created_at,
    last_seen_at: r.last_seen_at,
    ip: r.ip
  }, describeDevice(r.user_agent)));
  res.json({ sessions });
});

app.delete('/api/sessions/:id', auth, (req, res) => {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Device not found' });
  db.prepare('DELETE FROM sessions WHERE id = ?').run(row.id);
  res.json({ ok: true, current: row.id === req.sessionId });
});

app.post('/api/sessions/revoke-others', auth, (req, res) => {
  const info = db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(req.user.id, req.sessionId || '');
  res.json({ ok: true, revoked: info.changes });
});

/* ---------------- Two-step login (TOTP) ---------------- */

app.get('/api/2fa/status', auth, (req, res) => {
  res.json({ enabled: !!req.user.twofa_enabled });
});

/* Return the current code so a user who is already signed in on one device can
   read it and use it to sign in on another. */
app.get('/api/2fa/code', auth, (req, res) => {
  /* Also works while a setup is in progress (secret exists but not yet
     enabled) so the live code shown in the setup panel keeps refreshing. */
  if (!req.user.twofa_secret) return res.status(400).json({ error: 'Two-step login is not set up' });
  const now = Date.now() / 1000;
  const seconds = 30 - Math.floor(now % 30);
  res.json({ code: userTotpCode(req.user, now), seconds, enabled: !!req.user.twofa_enabled });
});

/* Begin setup: generate a secret (not yet enabled) and return it + a live code. */
app.post('/api/2fa/setup', auth, (req, res) => {
  const { password } = req.body || {};
  if (!password || !bcrypt.compareSync(password, req.user.password_hash)) {
    return res.status(401).json({ error: 'Your password is incorrect' });
  }
  /* Reuse an existing secret when one is already present so re-running setup
     does not silently change the code the user already saved. A brand-new
     secret is only generated the first time. */
  let secret = req.user.twofa_secret;
  if (!secret) {
    secret = newTotpSecret();
    db.prepare('UPDATE users SET twofa_secret = ?, twofa_enabled = 0 WHERE id = ?').run(secret, req.user.id);
  }
  const now = Date.now() / 1000;
  const tag = `${req.user.username}#${req.user.discriminator}`;
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({
    secret,
    code: userTotpCode(fresh, now),
    seconds: 30 - Math.floor(now % 30),
    otpauth: `otpauth://totp/Crossroads:${encodeURIComponent(tag)}?secret=${secret}&issuer=Crossroads&period=30&digits=6`
  });
});

/* Confirm setup with a live code, which switches two-step login on. */
app.post('/api/2fa/enable', auth, (req, res) => {
  const { code } = req.body || {};
  if (!req.user.twofa_secret) return res.status(400).json({ error: 'Start setup first' });
  if (!verifyUserTotp(req.user, code)) {
    return res.status(400).json({ error: 'That code is incorrect or has expired. Enter the current code.' });
  }
  db.prepare('UPDATE users SET twofa_enabled = 1 WHERE id = ?').run(req.user.id);
  res.json({ ok: true, enabled: true });
});

app.post('/api/2fa/disable', auth, (req, res) => {
  const { password } = req.body || {};
  if (!password || !bcrypt.compareSync(password, req.user.password_hash)) {
    return res.status(401).json({ error: 'Your password is incorrect' });
  }
  db.prepare('UPDATE users SET twofa_enabled = 0, twofa_secret = NULL WHERE id = ?').run(req.user.id);
  try { db.prepare('DELETE FROM trusted_devices WHERE user_id = ?').run(req.user.id); } catch (e) {}
  res.json({ ok: true, enabled: false });
});

/* Reset the two-step code: generate a brand-new secret (for when the user has
   lost access to their authenticator). Requires the password. Two-step is
   switched off until the user confirms the new code, so they can never be
   locked out mid-reset. */
app.post('/api/2fa/reset', auth, (req, res) => {
  const { password } = req.body || {};
  if (!password || !bcrypt.compareSync(password, req.user.password_hash)) {
    return res.status(401).json({ error: 'Your password is incorrect' });
  }
  const secret = newTotpSecret();
  db.prepare('UPDATE users SET twofa_secret = ?, twofa_enabled = 0 WHERE id = ?').run(secret, req.user.id);
  try { db.prepare('DELETE FROM trusted_devices WHERE user_id = ?').run(req.user.id); } catch (e) {}
  const now = Date.now() / 1000;
  const tag = `${req.user.username}#${req.user.discriminator}`;
  res.json({
    secret,
    code: userTotpCode(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id), now),
    seconds: 30 - Math.floor(now % 30),
    otpauth: `otpauth://totp/Crossroads:${encodeURIComponent(tag)}?secret=${secret}&issuer=Crossroads&period=30&digits=6`
  });
});

app.get('/api/me', auth, (req, res) => {
  res.json({ user: publicUser(req.user, { self: true }) });
});

app.patch('/api/me', auth, (req, res) => {
  const uid = req.user.id;
  const allowed = ['bio', 'accent_color', 'avatar', 'avatar_url', 'banner', 'banner_url', 'status', 'display_name', 'pronouns', 'custom_status', 'banner_color'];
  const updates = [];
  const values = [];
  for (const key of allowed) {
    if (key in req.body) { updates.push(`${key} = ?`); values.push(req.body[key]); }
  }
  // Username change (keeps discriminator when free, otherwise assigns a new one).
  if ('username' in req.body) {
    const uname = (req.body.username || '').trim();
    if (uname && uname.toLowerCase() !== (req.user.username || '').toLowerCase()) {
      if (uname.length < 2 || uname.length > 32) return res.status(400).json({ error: 'Username must be 2-32 characters' });
      if (!/^[a-zA-Z0-9._]+$/.test(uname)) return res.status(400).json({ error: 'Username may only contain letters, numbers, periods and underscores' });
      // 24-hour cooldown between username changes.
      const USERNAME_COOLDOWN_MS = 24 * 60 * 60 * 1000;
      const lastChange = Number(req.user.username_changed_at || 0);
      if (lastChange && Date.now() - lastChange < USERNAME_COOLDOWN_MS) {
        const remain = USERNAME_COOLDOWN_MS - (Date.now() - lastChange);
        const totalMins = Math.ceil(remain / 60000);
        const hours = Math.floor(totalMins / 60);
        const mins = totalMins % 60;
        return res.status(429).json({
          error: `You can only change your username once every 24 hours. Try again in ${hours}h ${mins}m.`,
          retry_after: remain
        });
      }
      const taken = db.prepare('SELECT 1 FROM users WHERE LOWER(username) = LOWER(?) AND id != ?').get(uname, uid);
      if (taken) return res.status(409).json({ error: 'That username is already taken' });
      let disc = req.user.discriminator;
      const clash = db.prepare('SELECT 1 FROM users WHERE LOWER(username) = LOWER(?) AND discriminator = ? AND id != ?').get(uname, disc, uid);
      if (clash) disc = uniqueUsernameDiscriminator(uname);
      updates.push('username = ?'); values.push(uname);
      updates.push('discriminator = ?'); values.push(disc);
      updates.push('username_changed_at = ?'); values.push(Date.now());
    }
  }
  const statusChanged = 'status' in req.body;
  if (updates.length) {
    values.push(uid);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }
  /* A deliberate status change replaces any transient (idle/away) override. */
  if (statusChanged) presenceOverrides.delete(uid);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
  // Push the change to every client so avatars, banners, names and statuses
  // update live across member lists, DM lists, message authors and profiles.
  broadcastProfile(user);
  if (statusChanged) io.emit('presence', { user_id: uid, status: user.status });
  res.json({ user: publicUser(user, { self: true }) });
});

/* Change password (Privacy & Safety). Verifies the current password first. */
app.post('/api/me/password', auth, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user || !bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(401).json({ error: 'Your current password is incorrect' });
  }
  if (String(new_password).length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  if (String(new_password).length > 128) {
    return res.status(400).json({ error: 'New password is too long' });
  }
  if (current_password === new_password) {
    return res.status(400).json({ error: 'New password must be different from your current one' });
  }
  const hash = bcrypt.hashSync(String(new_password), 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  res.json({ ok: true });
});

/* ---------------- Self-service account controls ----------------
   Two distinct actions live in Privacy & Safety:

   * Deactivate - a reversible pause. Sessions are revoked and the profile
     goes offline, but signing back in with the correct password reactivates
     the account automatically (see /api/login).
   * Delete - a soft delete. Personal data is scrubbed, memberships and
     relationships are removed, and the account can never sign in again.
     The user row is kept (anonymised) so other people's messages, replies
     and mentions never break. Nothing belonging to other users is removed. */

app.post('/api/me/deactivate', auth, (req, res) => {
  const { password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user || !password || !bcrypt.compareSync(String(password), user.password_hash)) {
    return res.status(401).json({ error: 'Your password is incorrect' });
  }
  if (user.deleted) return res.status(400).json({ error: 'This account has been deleted' });
  db.prepare('UPDATE users SET deactivated = 1, deactivated_at = ?, status = ?, token_version = COALESCE(token_version,0) + 1 WHERE id = ?')
    .run(Date.now(), 'offline', user.id);
  try { db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id); } catch (e) {}
  try { db.prepare('DELETE FROM trusted_devices WHERE user_id = ?').run(user.id); } catch (e) {}
  presenceOverrides.delete(user.id);
  try { broadcastProfile(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)); } catch (e) {}
  io.to(`user:${user.id}`).emit('account_deactivated', {});
  res.json({ ok: true });
});

app.post('/api/me/delete', auth, (req, res) => {
  const { password, confirm } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user || !password || !bcrypt.compareSync(String(password), user.password_hash)) {
    return res.status(401).json({ error: 'Your password is incorrect' });
  }
  if (user.deleted) return res.status(400).json({ error: 'This account has already been deleted' });
  if (String(confirm || '').trim().toLowerCase() !== String(user.username || '').toLowerCase()) {
    return res.status(400).json({ error: 'Type your username exactly to confirm deletion' });
  }
  const uid = user.id;
  const now = Date.now();
  const anonName = 'deleted_' + uid.replace(/[^a-z0-9]/gi, '').slice(-10).toLowerCase();
  const anonHash = bcrypt.hashSync(newId() + ':' + newId(), 10);
  const tx = db.transaction(() => {
    try { db.prepare('DELETE FROM sessions WHERE user_id = ?').run(uid); } catch (e) {}
    try { db.prepare('DELETE FROM trusted_devices WHERE user_id = ?').run(uid); } catch (e) {}
    try { db.prepare('DELETE FROM server_members WHERE user_id = ?').run(uid); } catch (e) {}
    try { db.prepare('DELETE FROM dm_channels WHERE user1_id = ? OR user2_id = ?').run(uid, uid); } catch (e) {}
    try { db.prepare('DELETE FROM dm_hidden WHERE user_id = ?').run(uid); } catch (e) {}
    try { db.prepare('DELETE FROM friendships WHERE requester_id = ? OR addressee_id = ?').run(uid, uid); } catch (e) {}
    try { db.prepare('DELETE FROM blocks WHERE blocker_id = ? OR blocked_id = ?').run(uid, uid); } catch (e) {}
    try { db.prepare('DELETE FROM notes WHERE owner_id = ? OR target_id = ?').run(uid, uid); } catch (e) {}
    try { db.prepare('DELETE FROM notifications WHERE user_id = ?').run(uid); } catch (e) {}
    try { db.prepare('DELETE FROM invites WHERE creator_id = ?').run(uid); } catch (e) {}
    try { db.prepare('DELETE FROM user_badges WHERE user_id = ?').run(uid); } catch (e) {}
    try { db.prepare('DELETE FROM e2e_keys WHERE user_id = ?').run(uid); } catch (e) {}
    /* Hand any server this person owned to its earliest remaining member so
       nobody else's community is left without an owner. */
    try {
      const owned = db.prepare('SELECT id FROM servers WHERE owner_id = ?').all(uid);
      for (const srv of owned) {
        const heir = db.prepare('SELECT user_id FROM server_members WHERE server_id = ? ORDER BY joined_at ASC LIMIT 1').get(srv.id);
        if (heir && heir.user_id) db.prepare('UPDATE servers SET owner_id = ? WHERE id = ?').run(heir.user_id, srv.id);
      }
    } catch (e) {}
    db.prepare(`UPDATE users SET
        deleted = 1, deleted_at = ?, deactivated = 0, deactivated_at = NULL,
        username = ?, discriminator = ?, display_name = 'Deleted User',
        email = NULL, password_hash = ?, avatar = NULL, avatar_url = NULL,
        banner = NULL, banner_url = NULL, bio = '', custom_status = '',
        pronouns = '', status = 'offline', twofa_enabled = 0, twofa_secret = NULL,
        token_version = COALESCE(token_version,0) + 1
      WHERE id = ?`).run(now, anonName, '0000', anonHash, uid);
  });
  try { tx(); } catch (e) {
    console.error('[account] delete failed:', e.message);
    return res.status(500).json({ error: 'Could not delete the account. Please try again.' });
  }
  presenceOverrides.delete(uid);
  try { io.emit('user_deleted', { user_id: uid }); } catch (e) {}
  res.json({ ok: true });
});

/* ---------------- Users ---------------- */
app.get('/api/users/:id', auth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const isMe = u.id === req.user.id;
  const blocked = !isMe && isBlockedBetween(req.user.id, u.id);
  const noteRow = db.prepare('SELECT content FROM notes WHERE owner_id = ? AND target_id = ?').get(req.user.id, u.id);
  const pu = publicUser(u);
  if (blocked) {
    /* Blocked users are hidden: strip bio / mutuals / roles / note and only
       expose the bare identity so the UI can render a "blocked" card. */
    pu.server_roles = [];
    pu.bio = '';
    pu.custom_status = '';
  } else {
    pu.server_roles = rolesForUser(u.id, req.user.id);
  }
  res.json({
    user: pu,
    relationship: isMe ? 'self' : (blocked ? 'blocked' : relationshipBetween(req.user.id, u.id)),
    blocked,
    mutual_servers: (isMe || blocked) ? [] : mutualServers(req.user.id, u.id),
    mutual_friends: (isMe || blocked) ? [] : mutualFriends(req.user.id, u.id),
    note: blocked ? '' : (noteRow ? noteRow.content : '')
  });
});

app.get('/api/users', auth, (req, res) => {
  const q = (req.query.q || '').trim();
  let rows;
  if (q) {
    rows = db.prepare("SELECT * FROM users WHERE COALESCE(is_webhook,0) = 0 AND (username LIKE ? OR (username || '#' || discriminator) LIKE ?) LIMIT 25")
      .all(`%${q}%`, `%${q}%`);
  } else {
    rows = db.prepare('SELECT * FROM users WHERE id != ? AND COALESCE(is_webhook,0) = 0 ORDER BY created_at DESC LIMIT 25').all(req.user.id);
  }
  res.json({ users: rows.map(publicUser) });
});

/* ---------------- Friends & Relationships ---------------- */
app.get('/api/relationships', auth, (req, res) => {
  const uid = req.user.id;
  const friends = db.prepare(`SELECT u.* FROM friendships f
    JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
    WHERE f.status = 'accepted' AND (f.requester_id = ? OR f.addressee_id = ?)`)
    .all(uid, uid, uid).map(publicUser);
  const incoming = db.prepare(`SELECT u.* FROM friendships f JOIN users u ON u.id = f.requester_id
    WHERE f.status = 'pending' AND f.addressee_id = ?`).all(uid).map(publicUser);
  const outgoing = db.prepare(`SELECT u.* FROM friendships f JOIN users u ON u.id = f.addressee_id
    WHERE f.status = 'pending' AND f.requester_id = ?`).all(uid).map(publicUser);
  const blocked = db.prepare(`SELECT u.* FROM blocks b JOIN users u ON u.id = b.blocked_id
    WHERE b.blocker_id = ? ORDER BY b.created_at DESC`).all(uid).map(publicUser);
  res.json({ friends, incoming, outgoing, blocked });
});

app.post('/api/friends/request', auth, (req, res) => {
  const uid = req.user.id;
  let { userId, tag } = req.body || {};
  let target = null;
  if (userId) {
    target = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  } else if (tag) {
    const t = String(tag).trim();
    if (t.includes('#')) {
      const [uname, disc] = t.split('#');
      target = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?) AND discriminator = ?').get(uname, disc);
    } else {
      target = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?) ORDER BY created_at ASC LIMIT 1').get(t);
    }
  }
  if (!target) return res.status(404).json({ error: 'User not found. Check the spelling and try again.' });
  if (target.id === uid) return res.status(400).json({ error: 'You cannot add yourself' });
  if (relationshipBetween(uid, target.id) === 'blocked') return res.status(403).json({ error: 'Unable to send a friend request to this user' });
  const targetSettings = safeParse(target.settings, {});
  if (targetSettings.friendRequests === false) return res.status(403).json({ error: 'This user is not accepting friend requests right now.' });
  const existing = db.prepare('SELECT * FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)')
    .get(uid, target.id, target.id, uid);
  if (existing) {
    if (existing.status === 'accepted') return res.json({ status: 'friends' });
    if (existing.requester_id === target.id) {
      db.prepare('UPDATE friendships SET status = ? WHERE id = ?').run('accepted', existing.id);
      io.to(`user:${target.id}`).emit('friend_update', { type: 'accepted', user: publicUser(req.user) });
      createNotification(target.id, 'friend_accepted', { user: publicUser(req.user) });
      return res.json({ status: 'friends' });
    }
    return res.json({ status: 'pending_outgoing' });
  }
  db.prepare('INSERT INTO friendships (id, requester_id, addressee_id, status, created_at) VALUES (?,?,?,?,?)')
    .run(newId(), uid, target.id, 'pending', Date.now());
  io.to(`user:${target.id}`).emit('friend_update', { type: 'request', user: publicUser(req.user) });
  createNotification(target.id, 'friend_request', { user: publicUser(req.user) });
  res.json({ status: 'pending_outgoing' });
});

app.post('/api/friends/accept', auth, (req, res) => {
  const { userId } = req.body || {};
  const f = db.prepare("SELECT * FROM friendships WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'").get(userId, req.user.id);
  if (!f) return res.status(404).json({ error: 'No pending request from this user' });
  db.prepare('UPDATE friendships SET status = ? WHERE id = ?').run('accepted', f.id);
  io.to(`user:${userId}`).emit('friend_update', { type: 'accepted', user: publicUser(req.user) });
  createNotification(userId, 'friend_accepted', { user: publicUser(req.user) });
  res.json({ ok: true, status: 'friends' });
});

app.post('/api/friends/decline', auth, (req, res) => {
  const { userId } = req.body || {};
  db.prepare("DELETE FROM friendships WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'").run(userId, req.user.id);
  res.json({ ok: true });
});

app.post('/api/friends/cancel', auth, (req, res) => {
  const { userId } = req.body || {};
  db.prepare("DELETE FROM friendships WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'").run(req.user.id, userId);
  res.json({ ok: true });
});

app.delete('/api/friends/:userId', auth, (req, res) => {
  db.prepare('DELETE FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)')
    .run(req.user.id, req.params.userId, req.params.userId, req.user.id);
  io.to(`user:${req.params.userId}`).emit('friend_update', { type: 'removed', user: publicUser(req.user) });
  res.json({ ok: true });
});

app.post('/api/blocks', auth, (req, res) => {
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId required' });
  if (userId === req.user.id) return res.status(400).json({ error: 'You cannot block yourself' });
  db.prepare('DELETE FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)')
    .run(req.user.id, userId, userId, req.user.id);
  const existing = db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?').get(req.user.id, userId);
  if (!existing) db.prepare('INSERT INTO blocks (id, blocker_id, blocked_id, created_at) VALUES (?,?,?,?)').run(newId(), req.user.id, userId, Date.now());
  /* A block immediately ends any call between the two users. */
  for (const [dmId, call] of Array.from(dmCalls.entries())) {
    const pair = [call.caller_id, call.callee_id];
    if (pair.includes(req.user.id) && pair.includes(userId)) endDmCall(dmId, 'blocked');
  }
  res.json({ ok: true, status: 'blocked' });
});

app.delete('/api/blocks/:userId', auth, (req, res) => {
  db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(req.user.id, req.params.userId);
  res.json({ ok: true, status: 'none' });
});

/* ---------------- Private Notes ---------------- */
app.get('/api/notes/:userId', auth, (req, res) => {
  const n = db.prepare('SELECT content FROM notes WHERE owner_id = ? AND target_id = ?').get(req.user.id, req.params.userId);
  res.json({ note: n ? n.content : '' });
});

app.put('/api/notes/:userId', auth, (req, res) => {
  const content = String((req.body || {}).content || '').slice(0, 256);
  const existing = db.prepare('SELECT * FROM notes WHERE owner_id = ? AND target_id = ?').get(req.user.id, req.params.userId);
  if (existing) db.prepare('UPDATE notes SET content = ?, updated_at = ? WHERE id = ?').run(content, Date.now(), existing.id);
  else db.prepare('INSERT INTO notes (id, owner_id, target_id, content, updated_at) VALUES (?,?,?,?,?)').run(newId(), req.user.id, req.params.userId, content, Date.now());
  res.json({ note: content });
});

/* ---------------- Notifications ---------------- */
app.get('/api/notifications', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(req.user.id);
  const unread = db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0').get(req.user.id).c;
  res.json({
    notifications: rows.map(n => ({ id: n.id, type: n.type, data: safeParse(n.data, {}), read: !!n.read, created_at: n.created_at })),
    unread
  });
});

app.post('/api/notifications/read', auth, (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

app.delete('/api/notifications', auth, (req, res) => {
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

app.delete('/api/notifications/:id', auth, (req, res) => {
  db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

/* ---------------- User settings (persisted per account) ---------------- */
app.get('/api/settings', auth, (req, res) => {
  res.json({ settings: safeParse(req.user.settings, {}) });
});

app.patch('/api/settings', auth, (req, res) => {
  const current = safeParse(req.user.settings, {});
  const merged = Object.assign({}, current, req.body || {});
  db.prepare('UPDATE users SET settings = ? WHERE id = ?').run(JSON.stringify(merged), req.user.id);
  res.json({ settings: merged });
});

/* ---------------- Servers ---------------- */
app.get('/api/servers', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT s.* FROM servers s
    JOIN server_members m ON m.server_id = s.id
    WHERE m.user_id = ? ORDER BY m.joined_at ASC`).all(req.user.id);
  res.json({ servers: rows.map(publicServer) });
});

app.post('/api/servers', auth, (req, res) => {
  let { name, icon, icon_url, banner_url, description } = req.body || {};
  name = (name || '').trim();
  if (!name) return res.status(400).json({ error: 'Server name required' });
  const id = newId();
  const now = Date.now();
  db.prepare('INSERT INTO servers (id, name, icon, icon_url, banner_url, description, owner_id, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, name.slice(0, 40), icon || null, icon_url || null, banner_url || null, (description || '').slice(0, 500), req.user.id, now);
  db.prepare('INSERT INTO server_members (server_id, user_id, joined_at, role) VALUES (?,?,?,?)').run(id, req.user.id, now, 'owner');
  createDefaultChannels(id);
  const srv = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
  res.json({ server: publicServer(srv) });
});

app.post('/api/servers/join', auth, (req, res) => {
  let { invite } = req.body || {};
  invite = (invite || '').trim();
  if (!invite) return res.status(400).json({ error: 'Invite code required' });
  const code = normalizeInviteCode(invite);

  // 1) New-style invite codes (16-char, may expire / be limited).
  const found = getInvite(code);
  let srv = null;
  if (found) {
    if (found.expired) return res.status(410).json({ error: 'This invite has expired' });
    if (found.maxed) return res.status(410).json({ error: 'This invite has reached its maximum uses' });
    srv = db.prepare('SELECT * FROM servers WHERE id = ?').get(found.invite.server_id);
    if (!srv) return res.status(404).json({ error: 'Invalid invite code' });
    if (isBanned(srv.id, req.user.id)) return res.status(403).json({ error: 'You are banned from this server' });
    const already = db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?').get(srv.id, req.user.id);
    if (!already) {
      db.prepare('INSERT INTO server_members (server_id, user_id, joined_at, role) VALUES (?,?,?,?)').run(srv.id, req.user.id, Date.now(), 'member');
      db.prepare('UPDATE invites SET uses = uses + 1 WHERE code = ?').run(found.invite.code);
    }
    return res.json({ server: publicServer(srv), invite: { code: found.invite.code, server_id: srv.id } });
  }

  // 2) Legacy: raw server id (or a link ending in the server id).
  srv = db.prepare('SELECT * FROM servers WHERE id = ?').get(code);
  if (!srv) return res.status(404).json({ error: 'Invalid invite code' });
  if (isBanned(srv.id, req.user.id)) return res.status(403).json({ error: 'You are banned from this server' });
  const existing = db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?').get(srv.id, req.user.id);
  if (!existing) {
    db.prepare('INSERT INTO server_members (server_id, user_id, joined_at, role) VALUES (?,?,?,?)').run(srv.id, req.user.id, Date.now(), 'member');
  }
  res.json({ server: publicServer(srv) });
});

app.get('/api/servers/:id', auth, (req, res) => {
  const srv = getServerForUser(req.params.id, req.user.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  const channels = db.prepare('SELECT * FROM channels WHERE server_id = ? ORDER BY position ASC, created_at ASC').all(srv.id);
  const categories = db.prepare('SELECT * FROM channel_categories WHERE server_id = ? ORDER BY position ASC, created_at ASC').all(srv.id);
  const members = db.prepare(`
    SELECT u.*, m.role AS member_role, m.custom_role_id AS member_custom_role, m.timeout_until AS member_timeout
    FROM users u JOIN server_members m ON m.user_id = u.id
    WHERE m.server_id = ? ORDER BY m.joined_at ASC`).all(srv.id)
    .map(u => Object.assign(publicUser(u), {
      role: u.member_role || (srv.owner_id === u.id ? 'owner' : 'member'),
      custom_role_id: u.member_custom_role || null,
      timeout_until: u.member_timeout || null
    }));
  res.json({ server: publicServer(srv), channels, categories, members, settings: getServerSettings(srv.id), roles: listServerRoles(srv.id) });
});

/* Current voice occupancy for a server (used to seed the UI on load). */
app.get('/api/servers/:id/voice', auth, (req, res) => {
  const srv = getServerForUser(req.params.id, req.user.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  const voiceChans = db.prepare("SELECT id FROM channels WHERE server_id = ? AND type = 'voice'").all(srv.id);
  const states = {};
  for (const c of voiceChans) states[c.id] = voiceMembers(c.id);
  res.json({ states });
});

app.post('/api/servers/:id/channels', auth, (req, res) => {
  const srv = getServerForUser(req.params.id, req.user.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  if (!hasPerm(srv, req.user.id, 'manage_channels')) return res.status(403).json({ error: 'You need the Manage Channels permission' });
  let { name, type, topic, category_id } = req.body || {};
  name = (name || '').trim();
  if (!name) return res.status(400).json({ error: 'Channel name required' });
  const maxPos = db.prepare('SELECT MAX(position) as p FROM channels WHERE server_id = ?').get(srv.id).p || 0;
  const id = newId();
  /* Only accept a category that actually belongs to this server. */
  let catId = null;
  if (category_id) {
    const cat = db.prepare('SELECT id FROM channel_categories WHERE id = ? AND server_id = ?').get(category_id, srv.id);
    if (cat) catId = cat.id;
  }
  db.prepare('INSERT INTO channels (id, server_id, name, type, topic, position, created_at, category_id) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, srv.id, name, type || 'text', topic || '', maxPos + 1, Date.now(), catId);
  const ch = db.prepare('SELECT * FROM channels WHERE id = ?').get(id);
  broadcastChannels(srv.id);
  res.json({ channel: ch });
});

/* Reorder channels (owner + admins only). Body: { order: [channelId, ...] }.
   The client sends the full list of channel ids in the desired order (text
   group then voice group); positions are renumbered 0..n-1. The new order is
   broadcast to everyone so it syncs in real time. Additive, never destructive. */
app.patch('/api/servers/:id/channels/order', auth, (req, res) => {
  const srv = getServerForUser(req.params.id, req.user.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  if (!hasPerm(srv, req.user.id, 'manage_channels')) return res.status(403).json({ error: 'You need the Manage Channels permission' });
  const order = (req.body && Array.isArray(req.body.order)) ? req.body.order : null;
  if (!order || !order.length) return res.status(400).json({ error: 'An order array is required' });
  const existing = db.prepare('SELECT id FROM channels WHERE server_id = ?').all(srv.id).map(r => r.id);
  const valid = new Set(existing);
  /* Entries may be plain ids or { id, category_id } objects so a drag can move a
     channel into another category at the same time as it reorders it. */
  const ids = order.map(o => (typeof o === 'string' ? o : (o && o.id)));
  for (const id of ids) if (!valid.has(id)) return res.status(400).json({ error: 'Unknown channel in order' });
  const validCats = new Set(db.prepare('SELECT id FROM channel_categories WHERE server_id = ?').all(srv.id).map(r => r.id));
  const update = db.prepare('UPDATE channels SET position = ?, category_id = ? WHERE id = ? AND server_id = ?');
  const apply = db.transaction(() => {
    order.forEach((o, i) => {
      if (typeof o === 'string') {
        update.run(i, db.prepare('SELECT category_id FROM channels WHERE id = ?').get(o).category_id, o, srv.id);
      } else {
        const cat = o.category_id && validCats.has(o.category_id) ? o.category_id : null;
        update.run(i, cat, o.id, srv.id);
      }
    });
  });
  apply();
  broadcastChannels(srv.id);
  res.json({ ok: true });
});

/* ---------------- Channel categories (owner + admins) ---------------- */
app.post('/api/servers/:id/categories', auth, (req, res) => {
  const srv = getServerForUser(req.params.id, req.user.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  if (!hasPerm(srv, req.user.id, 'manage_channels')) return res.status(403).json({ error: 'You need the Manage Channels permission' });
  const name = String((req.body && req.body.name) || '').trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: 'Category name required' });
  const maxPos = db.prepare('SELECT MAX(position) as p FROM channel_categories WHERE server_id = ?').get(srv.id).p || 0;
  const id = newId();
  db.prepare('INSERT INTO channel_categories (id, server_id, name, position, created_at) VALUES (?,?,?,?,?)')
    .run(id, srv.id, name, maxPos + 1, Date.now());
  const category = db.prepare('SELECT * FROM channel_categories WHERE id = ?').get(id);
  broadcastChannels(srv.id);
  res.json({ category });
});

/* Reorder categories (owner + admins). Body: { order: [categoryId, ...] }.
   Positions are renumbered 0..n-1 and broadcast so every client syncs. */
app.patch('/api/servers/:id/categories/order', auth, (req, res) => {
  const srv = getServerForUser(req.params.id, req.user.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  if (!hasPerm(srv, req.user.id, 'manage_channels')) return res.status(403).json({ error: 'You need the Manage Channels permission' });
  const order = (req.body && Array.isArray(req.body.order)) ? req.body.order : null;
  if (!order || !order.length) return res.status(400).json({ error: 'An order array is required' });
  const valid = new Set(db.prepare('SELECT id FROM channel_categories WHERE server_id = ?').all(srv.id).map(r => r.id));
  for (const id of order) if (!valid.has(id)) return res.status(400).json({ error: 'Unknown category in order' });
  const update = db.prepare('UPDATE channel_categories SET position = ? WHERE id = ? AND server_id = ?');
  const apply = db.transaction(() => { order.forEach((id, i) => update.run(i, id, srv.id)); });
  apply();
  broadcastChannels(srv.id);
  res.json({ ok: true });
});

app.patch('/api/servers/:id/categories/:catId', auth, (req, res) => {
  const srv = getServerForUser(req.params.id, req.user.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  if (!hasPerm(srv, req.user.id, 'manage_channels')) return res.status(403).json({ error: 'You need the Manage Channels permission' });
  const cat = db.prepare('SELECT * FROM channel_categories WHERE id = ? AND server_id = ?').get(req.params.catId, srv.id);
  if (!cat) return res.status(404).json({ error: 'Category not found' });
  if (req.body && 'name' in req.body) {
    const name = String(req.body.name || '').trim().slice(0, 40);
    if (!name) return res.status(400).json({ error: 'Category name required' });
    db.prepare('UPDATE channel_categories SET name = ? WHERE id = ?').run(name, cat.id);
  }
  broadcastChannels(srv.id);
  res.json({ category: db.prepare('SELECT * FROM channel_categories WHERE id = ?').get(cat.id) });
});

app.delete('/api/servers/:id/categories/:catId', auth, (req, res) => {
  const srv = getServerForUser(req.params.id, req.user.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  if (!hasPerm(srv, req.user.id, 'manage_channels')) return res.status(403).json({ error: 'You need the Manage Channels permission' });
  const cat = db.prepare('SELECT * FROM channel_categories WHERE id = ? AND server_id = ?').get(req.params.catId, srv.id);
  if (!cat) return res.status(404).json({ error: 'Category not found' });
  /* Channels inside the category are kept — they simply become uncategorised. */
  db.prepare('UPDATE channels SET category_id = NULL WHERE category_id = ?').run(cat.id);
  db.prepare('DELETE FROM channel_categories WHERE id = ?').run(cat.id);
  broadcastChannels(srv.id);
  res.json({ ok: true, id: cat.id });
});

/* Rename / re-topic a channel (owner + admins). */
app.patch('/api/servers/:id/channels/:cid', auth, (req, res) => {
  const srv = getServerForUser(req.params.id, req.user.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  if (!hasPerm(srv, req.user.id, 'manage_channels')) return res.status(403).json({ error: 'You need the Manage Channels permission' });
  const ch = db.prepare('SELECT * FROM channels WHERE id = ? AND server_id = ?').get(req.params.cid, srv.id);
  if (!ch) return res.status(404).json({ error: 'Channel not found' });
  const updates = [];
  const values = [];
  if ('name' in req.body && String(req.body.name || '').trim()) {
    updates.push('name = ?'); values.push(String(req.body.name).trim().toLowerCase().replace(/\s+/g, '-').slice(0, 40));
  }
  if ('topic' in req.body) { updates.push('topic = ?'); values.push(String(req.body.topic || '').slice(0, 200)); }
  if ('category_id' in req.body) {
    const cid = req.body.category_id || null;
    let ok = null;
    if (cid) {
      const cat = db.prepare('SELECT id FROM channel_categories WHERE id = ? AND server_id = ?').get(cid, srv.id);
      if (cat) ok = cat.id;
    }
    updates.push('category_id = ?'); values.push(ok);
  }
  if ('slow_mode' in req.body) {
    const n = Math.max(0, Math.min(21600, parseInt(req.body.slow_mode, 10) || 0));
    updates.push('slow_mode = ?'); values.push(n);
  }
  if ('read_only' in req.body) { updates.push('read_only = ?'); values.push(req.body.read_only ? 1 : 0); }
  if ('nsfw' in req.body) { updates.push('nsfw = ?'); values.push(req.body.nsfw ? 1 : 0); }
  if ('user_limit' in req.body) {
    const n = Math.max(0, Math.min(99, parseInt(req.body.user_limit, 10) || 0));
    updates.push('user_limit = ?'); values.push(n);
  }
  if ('bitrate' in req.body) {
    const n = Math.max(8, Math.min(384, parseInt(req.body.bitrate, 10) || 64));
    updates.push('bitrate = ?'); values.push(n);
  }
  if (updates.length) {
    values.push(ch.id);
    db.prepare(`UPDATE channels SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }
  const updated = db.prepare('SELECT * FROM channels WHERE id = ?').get(ch.id);
  broadcastChannels(srv.id);
  res.json({ channel: updated });
});

/* -------- Channel incoming webhook (manage_channels only) -------- */
function webhookChannelFor(req) {
  const srv = getServerForUser(req.params.id, req.user.id);
  if (!srv) return { error: [404, 'Server not found'] };
  if (!hasPerm(srv, req.user.id, 'manage_channels')) return { error: [403, 'You need the Manage Channels permission'] };
  const ch = db.prepare('SELECT * FROM channels WHERE id = ? AND server_id = ?').get(req.params.cid, srv.id);
  if (!ch) return { error: [404, 'Channel not found'] };
  return { srv, ch };
}

app.get('/api/servers/:id/channels/:cid/webhook', auth, (req, res) => {
  const { error, ch } = webhookChannelFor(req);
  if (error) return res.status(error[0]).json({ error: error[1] });
  res.json({ webhook: webhookPublic(getChannelWebhook(ch.id)) });
});

/* Create the webhook (mints a random URL) or regenerate its token. */
app.post('/api/servers/:id/channels/:cid/webhook', auth, (req, res) => {
  const { error, ch } = webhookChannelFor(req);
  if (error) return res.status(error[0]).json({ error: error[1] });
  const body = req.body || {};
  const name = String(body.name || '').trim().slice(0, 80) || (ch.name + ' webhook');
  const avatar_url = safeWebhookAvatar(body.avatar_url);
  const enabled = body.enabled === false || body.enabled === 0 ? 0 : 1;
  const wh = mintChannelWebhook(req, ch, name, avatar_url, enabled);
  res.json({ webhook: webhookPublic(wh) });
});

/* Update name / avatar / enabled without touching the URL. */
app.patch('/api/servers/:id/channels/:cid/webhook', auth, (req, res) => {
  const { error, ch } = webhookChannelFor(req);
  if (error) return res.status(error[0]).json({ error: error[1] });
  const wh = getChannelWebhook(ch.id);
  if (!wh) return res.status(404).json({ error: 'This channel has no webhook yet' });
  const body = req.body || {};
  const name = 'name' in body ? (String(body.name || '').trim().slice(0, 80) || null) : wh.name;
  const avatar_url = 'avatar_url' in body ? safeWebhookAvatar(body.avatar_url) : wh.avatar_url;
  const enabled = 'enabled' in body ? (body.enabled === false || body.enabled === 0 ? 0 : 1) : wh.enabled;
  db.prepare('UPDATE channel_webhooks SET name = ?, avatar_url = ?, enabled = ?, updated_at = ? WHERE channel_id = ?')
    .run(name, avatar_url, enabled, Date.now(), ch.id);
  const updated = getChannelWebhook(ch.id);
  ensureWebhookBot(updated, updated.name, updated.avatar_url);
  res.json({ webhook: webhookPublic(getChannelWebhook(ch.id)) });
});

/* In-app test: posts a message through the same path an external caller uses. */
app.post('/api/servers/:id/channels/:cid/webhook/test', auth, (req, res) => {
  const { error, ch } = webhookChannelFor(req);
  if (error) return res.status(error[0]).json({ error: error[1] });
  const wh = getChannelWebhook(ch.id);
  if (!wh || !wh.token) return res.status(400).json({ error: 'Create a webhook first' });
  if (!wh.enabled) return res.status(400).json({ error: 'This webhook is paused' });
  const msg = postWebhookMessage(wh, ch, 'This is a test message from Crossroads \u2014 your webhook is working.');
  if (!msg) return res.status(500).json({ error: 'Could not post the test message' });
  res.json({ ok: true, message_id: msg.id });
});

app.delete('/api/servers/:id/channels/:cid/webhook', auth, (req, res) => {
  const { error, ch } = webhookChannelFor(req);
  if (error) return res.status(error[0]).json({ error: error[1] });
  const wh = getChannelWebhook(ch.id);
  db.prepare('DELETE FROM channel_webhooks WHERE channel_id = ?').run(ch.id);
  if (wh && wh.bot_user_id) {
    try { db.prepare('DELETE FROM users WHERE id = ? AND is_webhook = 1').run(wh.bot_user_id); } catch (e) {}
  }
  res.json({ ok: true });
});

/* -------- Public receiver: anything POSTed here lands in the channel -------- */
/* Simple in-memory flood guard so a leaked URL cannot be used to spam a channel
   at machine speed. 30 messages per minute per token. */
const webhookHits = new Map();
function webhookRateLimited(token) {
  const now = Date.now();
  const arr = (webhookHits.get(token) || []).filter(t => now - t < 60000);
  arr.push(now);
  webhookHits.set(token, arr);
  if (webhookHits.size > 5000) webhookHits.clear();
  return arr.length > 30;
}

app.post('/api/webhooks/:token', (req, res) => {
  const token = String(req.params.token || '');
  if (!token || token.length < 16) return res.status(404).json({ error: 'Unknown webhook' });
  if (webhookRateLimited(token)) return res.status(429).json({ error: 'Too many messages, slow down' });
  const wh = db.prepare('SELECT * FROM channel_webhooks WHERE token = ?').get(token);
  if (!wh) return res.status(404).json({ error: 'Unknown webhook' });
  if (!wh.enabled) return res.status(403).json({ error: 'This webhook is paused' });
  const ch = db.prepare('SELECT * FROM channels WHERE id = ?').get(wh.channel_id);
  if (!ch) return res.status(404).json({ error: 'Channel no longer exists' });
  const text = incomingWebhookText(req.body);
  if (!text) return res.status(400).json({ error: 'No message content found' });
  const msg = postWebhookMessage(wh, ch, text);
  if (!msg) return res.status(500).json({ error: 'Could not post the message' });
  res.json({ ok: true, id: msg.id, channel_id: ch.id });
});

/* Delete a channel and all of its messages (owner + admins). */
app.delete('/api/servers/:id/channels/:cid', auth, (req, res) => {
  const srv = getServerForUser(req.params.id, req.user.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  if (!hasPerm(srv, req.user.id, 'manage_channels')) return res.status(403).json({ error: 'You need the Manage Channels permission' });
  const ch = db.prepare('SELECT * FROM channels WHERE id = ? AND server_id = ?').get(req.params.cid, srv.id);
  if (!ch) return res.status(404).json({ error: 'Channel not found' });
  const remaining = db.prepare('SELECT COUNT(*) AS c FROM channels WHERE server_id = ?').get(srv.id).c;
  if (remaining <= 1) return res.status(400).json({ error: 'A server needs at least one channel' });
  const wipe = db.transaction(() => {
    db.prepare('DELETE FROM reactions WHERE message_id IN (SELECT id FROM messages WHERE channel_id = ?)').run(ch.id);
    db.prepare('DELETE FROM messages WHERE channel_id = ?').run(ch.id);
    try {
      const wh = db.prepare('SELECT bot_user_id FROM channel_webhooks WHERE channel_id = ?').get(ch.id);
      if (wh && wh.bot_user_id) db.prepare('DELETE FROM users WHERE id = ? AND is_webhook = 1').run(wh.bot_user_id);
      db.prepare('DELETE FROM channel_webhooks WHERE channel_id = ?').run(ch.id);
    } catch (e) {}
    db.prepare('DELETE FROM channels WHERE id = ?').run(ch.id);
  });
  wipe();
  broadcastChannels(srv.id);
  res.json({ ok: true, id: ch.id });
});

/* Update a member: role (owner only), custom role, or timeout (owner + admins). */
app.patch('/api/servers/:id/members/:uid', auth, (req, res) => {
  const srv = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  if (!hasPerm(srv, req.user.id, 'manage_members')) return res.status(403).json({ error: 'You need the Manage Members permission' });
  const target = req.params.uid;
  const body0 = req.body || {};
  /* The owner cannot be demoted or timed out, but may still be given custom
     roles like any other member. */
  if (target === srv.owner_id && ('role' in body0 || 'timeout_until' in body0)) {
    return res.status(400).json({ error: 'The owner cannot be modified' });
  }
  const member = db.prepare('SELECT * FROM server_members WHERE server_id = ? AND user_id = ?').get(srv.id, target);
  if (!member) return res.status(404).json({ error: 'Member not found' });
  const iAmOwner = srv.owner_id === req.user.id;
  const body = req.body || {};
  const updates = []; const values = [];
  if ('role' in body) {
    if (!iAmOwner) return res.status(403).json({ error: 'Only the owner can change admin roles' });
    const role = body.role === 'admin' ? 'admin' : 'member';
    updates.push('role = ?'); values.push(role);
  }
  if ('custom_role_id' in body) {
    const rid = body.custom_role_id || null;
    if (rid) {
      const roleRow = db.prepare('SELECT 1 FROM server_roles WHERE id = ? AND server_id = ?').get(rid, srv.id);
      if (!roleRow) return res.status(400).json({ error: 'Role not found' });
    }
    updates.push('custom_role_id = ?'); values.push(rid);
  }
  if ('timeout_until' in body) {
    updates.push('timeout_until = ?'); values.push(body.timeout_until || null);
  }
  if (updates.length) {
    values.push(srv.id, target);
    db.prepare(`UPDATE server_members SET ${updates.join(', ')} WHERE server_id = ? AND user_id = ?`).run(...values);
  }
  broadcastMembers(srv.id);
  res.json({ ok: true });
});

/* Update server name / icon / banner / description (owner only). */
app.patch('/api/servers/:id', auth, (req, res) => {
  const srv = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  if (srv.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can edit this server' });
  const updates = [];
  const values = [];
  if ('name' in req.body && String(req.body.name || '').trim()) {
    updates.push('name = ?'); values.push(String(req.body.name).trim().slice(0, 40));
  }
  if ('icon_url' in req.body) { updates.push('icon_url = ?'); values.push(req.body.icon_url || null); }
  if ('banner_url' in req.body) { updates.push('banner_url = ?'); values.push(req.body.banner_url || null); }
  if ('description' in req.body) { updates.push('description = ?'); values.push(String(req.body.description || '').slice(0, 500)); }
  if ('banner_scale' in req.body) {
    const sc = Math.max(1, Math.min(4, parseFloat(req.body.banner_scale) || 1));
    updates.push('banner_scale = ?'); values.push(sc);
  }
  if ('banner_position' in req.body) {
    const pos = String(req.body.banner_position || '50% 50%').slice(0, 32);
    updates.push('banner_position = ?'); values.push(pos);
  }
  if (updates.length) {
    values.push(srv.id);
    db.prepare(`UPDATE servers SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }
  const updated = publicServer(db.prepare('SELECT * FROM servers WHERE id = ?').get(srv.id));
  io.emit('server_update', updated);
  res.json({ server: updated });
});

/* ---------------- Server settings (safety / moderation defaults) ---------------- */

/* Read a server's settings (any member). */
app.get('/api/servers/:id/settings', auth, (req, res) => {
  const srv = getServerForUser(req.params.id, req.user.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  res.json({ settings: getServerSettings(srv.id) });
});

/* Update a server's settings (owner + admins). */
app.patch('/api/servers/:id/settings', auth, (req, res) => {
  const srv = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  if (!hasPerm(srv, req.user.id, 'manage_server')) return res.status(403).json({ error: 'You need the Manage Server permission' });
  const cur = getServerSettings(srv.id);
  const body = req.body || {};
  const next = {
    verification_level: ['none', 'low', 'medium', 'high'].includes(body.verification_level) ? body.verification_level : cur.verification_level,
    explicit_filter: 'explicit_filter' in body ? (body.explicit_filter ? 1 : 0) : cur.explicit_filter,
    allow_everyone: 'allow_everyone' in body ? (body.allow_everyone ? 1 : 0) : cur.allow_everyone,
    default_notifications: ['all', 'mentions', 'none'].includes(body.default_notifications) ? body.default_notifications : cur.default_notifications,
    slow_mode: 'slow_mode' in body ? Math.max(0, Math.min(21600, parseInt(body.slow_mode, 10) || 0)) : cur.slow_mode,
    system_channel_id: 'system_channel_id' in body ? (body.system_channel_id || null) : cur.system_channel_id,
    welcome_message: 'welcome_message' in body ? String(body.welcome_message || '').slice(0, 2000) : cur.welcome_message,
    rules: 'rules' in body ? String(body.rules || '').slice(0, 4000) : cur.rules,
    allow_member_invites: 'allow_member_invites' in body ? (body.allow_member_invites ? 1 : 0) : cur.allow_member_invites,
    afk_channel_id: 'afk_channel_id' in body ? (body.afk_channel_id || null) : cur.afk_channel_id,
    afk_timeout: 'afk_timeout' in body ? Math.max(60, Math.min(3600, parseInt(body.afk_timeout, 10) || 300)) : cur.afk_timeout,
    require_2fa: 'require_2fa' in body ? (body.require_2fa ? 1 : 0) : cur.require_2fa,
    raid_protection: 'raid_protection' in body ? (body.raid_protection ? 1 : 0) : cur.raid_protection,
    system_welcome: 'system_welcome' in body ? (body.system_welcome ? 1 : 0) : cur.system_welcome,
    default_role_id: 'default_role_id' in body ? (body.default_role_id || null) : cur.default_role_id,
    invite_splash: 'invite_splash' in body ? (body.invite_splash ? 1 : 0) : cur.invite_splash,
    community_name: 'community_name' in body ? String(body.community_name || '').slice(0, 80) : cur.community_name
  };
  db.prepare(`UPDATE server_settings SET verification_level=?, explicit_filter=?, allow_everyone=?, default_notifications=?, slow_mode=?, system_channel_id=?,
      welcome_message=?, rules=?, allow_member_invites=?, afk_channel_id=?, afk_timeout=?, require_2fa=?, raid_protection=?, system_welcome=?, default_role_id=?, invite_splash=?, community_name=?, updated_at=?
      WHERE server_id=?`)
    .run(next.verification_level, next.explicit_filter, next.allow_everyone, next.default_notifications, next.slow_mode, next.system_channel_id,
      next.welcome_message, next.rules, next.allow_member_invites, next.afk_channel_id, next.afk_timeout, next.require_2fa, next.raid_protection,
      next.system_welcome, next.default_role_id, next.invite_splash, next.community_name, Date.now(), srv.id);
  addAudit(srv.id, req.user.id, 'settings_update', null, '');
  io.emit('server_settings_update', { server_id: srv.id, settings: getServerSettings(srv.id) });
  res.json({ settings: getServerSettings(srv.id) });
});

/* ---------------- Moderation: kick / ban / timeout ---------------- */

/* Kick a member (owner + admins). They can rejoin with a valid invite. */
app.post('/api/servers/:id/kick', auth, (req, res) => {
  const srv = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  if (!hasPerm(srv, req.user.id, 'kick_members')) return res.status(403).json({ error: 'You need the Kick Members permission' });
  const target = (req.body && req.body.user_id) || '';
  if (!target) return res.status(400).json({ error: 'user_id required' });
  if (target === srv.owner_id) return res.status(400).json({ error: 'You cannot kick the server owner' });
  const tRole = memberRole(srv.id, target);
  if (tRole === 'admin' && srv.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can kick admins' });
  if (!removeMember(srv.id, target)) return res.status(404).json({ error: 'Member not found' });
  addAudit(srv.id, req.user.id, 'kick', target, (req.body && req.body.reason) || '');
  broadcastMembers(srv.id);
  res.json({ ok: true });
});

/* Ban a member (owner + admins): removes them and blocks rejoin. */
app.post('/api/servers/:id/bans', auth, (req, res) => {
  const srv = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  if (!hasPerm(srv, req.user.id, 'ban_members')) return res.status(403).json({ error: 'You need the Ban Members permission' });
  const target = (req.body && req.body.user_id) || '';
  if (!target) return res.status(400).json({ error: 'user_id required' });
  if (target === srv.owner_id) return res.status(400).json({ error: 'You cannot ban the server owner' });
  const tRole = memberRole(srv.id, target);
  if (tRole === 'admin' && srv.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can ban admins' });
  const reason = String((req.body && req.body.reason) || '').slice(0, 300);
  db.prepare('INSERT OR REPLACE INTO server_bans (server_id, user_id, moderator_id, reason, created_at) VALUES (?,?,?,?,?)')
    .run(srv.id, target, req.user.id, reason, Date.now());
  removeMember(srv.id, target);
  addAudit(srv.id, req.user.id, 'ban', target, reason);
  broadcastMembers(srv.id);
  res.json({ ok: true });
});

/* List bans (owner + admins). */
app.get('/api/servers/:id/bans', auth, (req, res) => {
  const srv = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  if (!hasPerm(srv, req.user.id, 'ban_members')) return res.status(403).json({ error: 'You need the Ban Members permission' });
  const rows = db.prepare(`SELECT b.*, u.username, u.discriminator, u.display_name, u.avatar, u.avatar_url, u.accent_color
    FROM server_bans b LEFT JOIN users u ON u.id = b.user_id WHERE b.server_id = ? ORDER BY b.created_at DESC`).all(srv.id);
  const bans = rows.map(r => ({
    user_id: r.user_id,
    reason: r.reason || '',
    created_at: r.created_at,
    moderator_id: r.moderator_id,
    user: { id: r.user_id, username: r.username || 'Unknown', discriminator: r.discriminator || '0000', display_name: r.display_name || null, avatar: r.avatar || null, avatar_url: r.avatar_url || null, accent_color: r.accent_color || '#5865f2' }
  }));
  res.json({ bans });
});

/* Unban a user (owner + admins). */
app.delete('/api/servers/:id/bans/:uid', auth, (req, res) => {
  const srv = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  if (!hasPerm(srv, req.user.id, 'ban_members')) return res.status(403).json({ error: 'You need the Ban Members permission' });
  db.prepare('DELETE FROM server_bans WHERE server_id = ? AND user_id = ?').run(srv.id, req.params.uid);
  addAudit(srv.id, req.user.id, 'unban', req.params.uid, '');
  res.json({ ok: true });
});

/* Timeout (mute) a member for N minutes (owner + admins). */
app.post('/api/servers/:id/members/:uid/timeout', auth, (req, res) => {
  const srv = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  if (!hasPerm(srv, req.user.id, 'manage_members')) return res.status(403).json({ error: 'You need the Manage Members permission' });
  const target = req.params.uid;
  if (target === srv.owner_id) return res.status(400).json({ error: 'You cannot time out the server owner' });
  const member = db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?').get(srv.id, target);
  if (!member) return res.status(404).json({ error: 'Member not found' });
  const mins = Math.max(0, Math.min(10080, parseInt((req.body && req.body.minutes), 10) || 0));
  const until = mins > 0 ? Date.now() + mins * 60000 : null;
  db.prepare('UPDATE server_members SET timeout_until = ? WHERE server_id = ? AND user_id = ?').run(until, srv.id, target);
  addAudit(srv.id, req.user.id, mins > 0 ? 'timeout' : 'timeout_remove', target, String(mins));
  broadcastMembers(srv.id);
  res.json({ ok: true, timeout_until: until });
});

/* ---------------- Custom roles ---------------- */

/* List roles + how many members hold each (any member). */
app.get('/api/servers/:id/roles', auth, (req, res) => {
  const srv = getServerForUser(req.params.id, req.user.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  const roles = listServerRoles(srv.id).map(r => Object.assign({}, r, {
    member_count: db.prepare('SELECT COUNT(*) AS c FROM server_members WHERE server_id = ? AND custom_role_id = ?').get(srv.id, r.id).c
  }));
  res.json({ roles });
});

/* Create a custom role (owner + admins). */
app.post('/api/servers/:id/roles', auth, (req, res) => {
  const srv = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  if (!hasPerm(srv, req.user.id, 'manage_roles')) return res.status(403).json({ error: 'You need the Manage Roles permission' });
  const name = String((req.body && req.body.name) || '').trim().slice(0, 32);
  if (!name) return res.status(400).json({ error: 'Role name required' });
  const color = /^#[0-9a-fA-F]{6}$/.test((req.body && req.body.color) || '') ? req.body.color : '#5865F2';
  const color2 = /^#[0-9a-fA-F]{6}$/.test((req.body && req.body.color2) || '') ? req.body.color2 : '';
  const hoist = (req.body && req.body.hoist) ? 1 : 0;
  const mentionable = (req.body && req.body.mentionable === false) ? 0 : 1;
  const permissions = JSON.stringify((req.body && req.body.permissions) || {});
  const icon = String((req.body && req.body.icon) || '').slice(0, 500) || null;
  const maxPos = db.prepare('SELECT MAX(position) AS p FROM server_roles WHERE server_id = ?').get(srv.id).p || 0;
  const id = newId();
  db.prepare('INSERT INTO server_roles (id, server_id, name, color, color2, hoist, mentionable, permissions, icon, position, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, srv.id, name, color, color2, hoist, mentionable, permissions, icon, maxPos + 1, Date.now());
  addAudit(srv.id, req.user.id, 'role_create', id, name);
  const role = db.prepare('SELECT * FROM server_roles WHERE id = ?').get(id);
  io.emit('server_roles_update', { server_id: srv.id });
  res.json({ role: Object.assign({}, role, { member_count: 0 }) });
});

/* Update a custom role (owner + admins). */
app.patch('/api/servers/:id/roles/:rid', auth, (req, res) => {
  const srv = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  if (!hasPerm(srv, req.user.id, 'manage_roles')) return res.status(403).json({ error: 'You need the Manage Roles permission' });
  const role = db.prepare('SELECT * FROM server_roles WHERE id = ? AND server_id = ?').get(req.params.rid, srv.id);
  if (!role) return res.status(404).json({ error: 'Role not found' });
  const updates = []; const values = [];
  if (req.body && typeof req.body.name === 'string' && req.body.name.trim()) { updates.push('name = ?'); values.push(req.body.name.trim().slice(0, 32)); }
  if (req.body && /^#[0-9a-fA-F]{6}$/.test(req.body.color || '')) { updates.push('color = ?'); values.push(req.body.color); }
  if (req.body && 'color2' in req.body) { updates.push('color2 = ?'); values.push(/^#[0-9a-fA-F]{6}$/.test(req.body.color2 || '') ? req.body.color2 : ''); }
  if (req.body && 'hoist' in req.body) { updates.push('hoist = ?'); values.push(req.body.hoist ? 1 : 0); }
  if (req.body && 'mentionable' in req.body) { updates.push('mentionable = ?'); values.push(req.body.mentionable ? 1 : 0); }
  if (req.body && 'permissions' in req.body) { updates.push('permissions = ?'); values.push(JSON.stringify(req.body.permissions || {})); }
  if (req.body && 'icon' in req.body) { updates.push('icon = ?'); values.push(String(req.body.icon || '').slice(0, 500) || null); }
  if (updates.length) { values.push(role.id); db.prepare(`UPDATE server_roles SET ${updates.join(', ')} WHERE id = ?`).run(...values); }
  io.emit('server_roles_update', { server_id: srv.id });
  res.json({ role: db.prepare('SELECT * FROM server_roles WHERE id = ?').get(role.id) });
});

/* Delete a custom role (owner + admins). Members keep their membership. */
app.delete('/api/servers/:id/roles/:rid', auth, (req, res) => {
  const srv = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  if (!hasPerm(srv, req.user.id, 'manage_roles')) return res.status(403).json({ error: 'You need the Manage Roles permission' });
  db.prepare('UPDATE server_members SET custom_role_id = NULL WHERE server_id = ? AND custom_role_id = ?').run(srv.id, req.params.rid);
  db.prepare('DELETE FROM server_roles WHERE id = ? AND server_id = ?').run(req.params.rid, srv.id);
  addAudit(srv.id, req.user.id, 'role_delete', req.params.rid, '');
  io.emit('server_roles_update', { server_id: srv.id });
  broadcastMembers(srv.id);
  res.json({ ok: true });
});

/* Move a role up or down the hierarchy (owner + admins).
   Swaps its position with the neighbouring role so ordering stays stable. */
app.post('/api/servers/:id/roles/:rid/move', auth, (req, res) => {
  const srv = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  if (!hasPerm(srv, req.user.id, 'manage_roles')) return res.status(403).json({ error: 'You need the Manage Roles permission' });
  const dir = (req.body && req.body.dir === 'down') ? 'down' : 'up';
  const roles = db.prepare('SELECT id, position FROM server_roles WHERE server_id = ? ORDER BY position ASC, created_at ASC').all(srv.id);
  const idx = roles.findIndex(r => r.id === req.params.rid);
  if (idx === -1) return res.status(404).json({ error: 'Role not found' });
  const swapIdx = dir === 'up' ? idx + 1 : idx - 1; /* higher position = higher rank */
  if (swapIdx < 0 || swapIdx >= roles.length) return res.json({ ok: true, roles: listServerRoles(srv.id) });
  const a = roles[idx], b = roles[swapIdx];
  const upd = db.prepare('UPDATE server_roles SET position = ? WHERE id = ?');
  const tx = db.transaction(() => { upd.run(b.position, a.id); upd.run(a.position, b.id); });
  tx();
  io.emit('server_roles_update', { server_id: srv.id });
  broadcastMembers(srv.id);
  res.json({ ok: true, roles: listServerRoles(srv.id) });
});

/* ---------------- Server invites ---------------- */

/* How many live invite links a single server may hold at once. */
const MAX_ACTIVE_INVITES = 5;

/* Reserved words that must never become a custom invite code, so a vanity link
   can't collide with an app route or impersonate staff. */
const RESERVED_INVITE_CODES = new Set([
  'admin', 'administrator', 'api', 'app', 'assets', 'auth', 'billing', 'blog',
  'call', 'calls', 'channels', 'community', 'dashboard', 'discord', 'dm', 'dms',
  'download', 'explore', 'faq', 'friends', 'help', 'home', 'invite', 'invites',
  'join', 'login', 'logout', 'me', 'mod', 'moderator', 'new', 'notifications',
  'official', 'owner', 'password', 'profile', 'register', 'root', 'rules',
  'server', 'servers', 'settings', 'signin', 'signup', 'staff', 'support',
  'system', 'terms', 'user', 'users', 'voice', 'welcome'
]);

/* A custom invite code is 2-32 chars of letters, numbers, dash and underscore. */
function validateCustomInviteCode(raw) {
  const code = String(raw || '').trim().replace(/^gg\//i, '');
  if (!code) return { ok: false, error: 'Enter a custom invite name.' };
  if (code.length < 2) return { ok: false, error: 'Invite names need at least 2 characters.' };
  if (code.length > 32) return { ok: false, error: 'Invite names can be at most 32 characters.' };
  if (!/^[A-Za-z0-9_-]+$/.test(code)) return { ok: false, error: 'Use only letters, numbers, dashes and underscores.' };
  if (RESERVED_INVITE_CODES.has(code.toLowerCase())) return { ok: false, error: `"${code}" is reserved. Try another name.` };
  if (/^\d+$/.test(code)) return { ok: false, error: 'Invite names cannot be only numbers.' };
  return { ok: true, code };
}

/* Create an invite. Body: { expires_in: minutes|'never', max_uses: number|null,
   custom_code: 'gg/my-name' | 'my-name' } */
app.post('/api/servers/:id/invites', auth, (req, res) => {
  const srv = getServerForUser(req.params.id, req.user.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  const canManage = hasPerm(srv, req.user.id, 'manage_server') || isServerAdmin(srv, req.user.id);
  const settings = getServerSettings(srv.id);
  /* When member invites are disabled only staff may mint new links. */
  if (!canManage && !settings.allow_member_invites) {
    return res.status(403).json({ error: 'Only server admins can create invites here.' });
  }
  let { expires_in, max_uses, custom_code } = req.body || {};
  let expiresAt = null;
  if (expires_in === 'never' || expires_in === null || expires_in === undefined || expires_in === 0) {
    expiresAt = null;
  } else {
    const mins = parseInt(expires_in, 10);
    if (!isFinite(mins) || mins <= 0) return res.status(400).json({ error: 'Invalid expiry' });
    expiresAt = Date.now() + mins * 60 * 1000;
  }
  let maxUses = null;
  if (max_uses !== undefined && max_uses !== null && max_uses !== '' && max_uses !== 'unlimited') {
    const mu = parseInt(max_uses, 10);
    if (isFinite(mu) && mu > 0) maxUses = mu;
  }
  /* A server may only hold MAX_ACTIVE_INVITES live links at a time. Expired or
     fully-used links do not count, so revoking/letting one lapse frees a slot. */
  const now0 = Date.now();
  const active = db.prepare('SELECT * FROM invites WHERE server_id = ?').all(srv.id)
    .filter(r => !(r.expires_at && now0 > r.expires_at) && !(r.max_uses && r.uses >= r.max_uses));
  if (active.length >= MAX_ACTIVE_INVITES) {
    return res.status(400).json({
      error: `This server already has ${MAX_ACTIVE_INVITES} active invites. Revoke one before creating another.`
    });
  }
  let code;
  let isCustom = false;
  if (custom_code !== undefined && custom_code !== null && String(custom_code).trim() !== '') {
    if (!canManage) return res.status(403).json({ error: 'Only the owner or admins can set a custom invite link.' });
    const check = validateCustomInviteCode(custom_code);
    if (!check.ok) return res.status(400).json({ error: check.error });
    code = check.code;
    isCustom = true;
    if (db.prepare('SELECT 1 FROM invites WHERE code = ?').get(code)) {
      return res.status(409).json({ error: `gg/${code} is already taken. Try another name.` });
    }
  } else {
    code = newInviteCode();
    // Extremely unlikely collision, but guard anyway.
    while (db.prepare('SELECT 1 FROM invites WHERE code = ?').get(code)) code = newInviteCode();
  }
  const now = Date.now();
  db.prepare('INSERT INTO invites (code, server_id, creator_id, created_at, expires_at, max_uses, uses) VALUES (?,?,?,?,?,?,0)')
    .run(code, srv.id, req.user.id, now, expiresAt, maxUses);
  const row = db.prepare('SELECT * FROM invites WHERE code = ?').get(code);
  addAudit(srv.id, req.user.id, isCustom ? 'invite_custom_create' : 'invite_create', null, code);
  res.json({ invite: invitePublic(row) });
});

/* Live availability check for a custom invite name (owner/admins only). */
app.get('/api/servers/:id/invites/check', auth, (req, res) => {
  const srv = getServerForUser(req.params.id, req.user.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  if (!isServerAdmin(srv, req.user.id)) return res.status(403).json({ error: 'Only the owner or admins can set a custom invite link.' });
  const check = validateCustomInviteCode(req.query.code);
  if (!check.ok) return res.json({ available: false, error: check.error, code: String(req.query.code || '').replace(/^gg\//i, '') });
  const taken = !!db.prepare('SELECT 1 FROM invites WHERE code = ?').get(check.code);
  res.json({
    available: !taken,
    code: check.code,
    link: `gg/${check.code}`,
    error: taken ? `gg/${check.code} is already taken. Try another name.` : null
  });
});

/* List a server's invites (members can view; owner/creator can revoke). */
app.get('/api/servers/:id/invites', auth, (req, res) => {
  const srv = getServerForUser(req.params.id, req.user.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  const rows = db.prepare('SELECT * FROM invites WHERE server_id = ? ORDER BY created_at DESC').all(srv.id);
  res.json({ invites: rows.map(invitePublic) });
});

/* Revoke an invite. Allowed for the person who created it, or a server
   owner/admin. A plain member can never revoke somebody else's link. */
app.delete('/api/invites/:code', auth, (req, res) => {
  const row = db.prepare('SELECT * FROM invites WHERE code = ?').get(req.params.code);
  if (!row) return res.status(404).json({ error: 'Invite not found' });
  const srv = db.prepare('SELECT * FROM servers WHERE id = ?').get(row.server_id);
  if (!srv) return res.status(404).json({ error: 'Invite not found' });
  const isCreator = row.creator_id === req.user.id;
  if (!isCreator && !isServerAdmin(srv, req.user.id)) {
    return res.status(403).json({ error: 'Only the invite creator or a server admin can revoke this invite' });
  }
  db.prepare('DELETE FROM invites WHERE code = ?').run(row.code);
  res.json({ ok: true });
});

/* Public invite preview (used to render rich embeds + the join screen). */
app.get('/api/invites/:code', auth, (req, res) => {
  const code = normalizeInviteCode(req.params.code);
  const found = getInvite(code);
  if (!found) return res.status(404).json({ error: 'Invalid invite code' });
  const srv = db.prepare('SELECT * FROM servers WHERE id = ?').get(found.invite.server_id);
  if (!srv) return res.status(404).json({ error: 'Invalid invite code' });
  const stats = serverStats(srv.id);
  const alreadyMember = !!db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?').get(srv.id, req.user.id);
  res.json({
    invite: invitePublic(found.invite),
    valid: found.valid,
    expired: found.expired,
    maxed: found.maxed,
    already_member: alreadyMember,
    server: {
      id: srv.id,
      name: srv.name,
      icon_url: srv.icon_url || null,
      banner_url: srv.banner_url || null,
      description: srv.description || '',
      member_count: stats.member_count,
      online_count: stats.online_count
    }
  });
});

/* Leave a server (non-owners only). */
app.post('/api/servers/:id/leave', auth, (req, res) => {
  const srv = getServerForUser(req.params.id, req.user.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  if (srv.owner_id === req.user.id) return res.status(400).json({ error: 'You own this server — delete it instead.' });
  db.prepare('DELETE FROM server_members WHERE server_id = ? AND user_id = ?').run(srv.id, req.user.id);
  res.json({ ok: true });
});

/* Delete a server and all of its channels/messages (owner only). */
app.delete('/api/servers/:id', auth, (req, res) => {
  const srv = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  if (srv.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can delete this server' });
  const chans = db.prepare('SELECT id FROM channels WHERE server_id = ?').all(srv.id).map(c => c.id);
  const wipe = db.transaction(() => {
    for (const cid of chans) {
      db.prepare('DELETE FROM reactions WHERE message_id IN (SELECT id FROM messages WHERE channel_id = ?)').run(cid);
      db.prepare('DELETE FROM messages WHERE channel_id = ?').run(cid);
      try {
        const wh = db.prepare('SELECT bot_user_id FROM channel_webhooks WHERE channel_id = ?').get(cid);
        if (wh && wh.bot_user_id) db.prepare('DELETE FROM users WHERE id = ? AND is_webhook = 1').run(wh.bot_user_id);
        db.prepare('DELETE FROM channel_webhooks WHERE channel_id = ?').run(cid);
      } catch (e) {}
    }
    db.prepare('DELETE FROM channels WHERE server_id = ?').run(srv.id);
    db.prepare('DELETE FROM server_members WHERE server_id = ?').run(srv.id);
    db.prepare('DELETE FROM servers WHERE id = ?').run(srv.id);
  });
  wipe();
  res.json({ ok: true });
});

/* ---------------- Messages ---------------- */
app.get('/api/channels/:id/messages', auth, (req, res) => {
  const ch = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.id);
  if (!ch) return res.status(404).json({ error: 'Channel not found' });
  const srv = getServerForUser(ch.server_id, req.user.id);
  if (!srv) return res.status(403).json({ error: 'Not a member of this server' });
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const rows = db.prepare('SELECT * FROM messages WHERE channel_id = ? ORDER BY created_at DESC LIMIT ?').all(ch.id, limit);
  rows.reverse();
  /* Hide messages from anyone the viewer has blocked (or who blocked them). */
  const hidden = new Set(blockedIdsOf(req.user.id));
  const visible = hidden.size ? rows.filter(m => !hidden.has(m.user_id)) : rows;
  res.json({ messages: messagesWithMeta(visible, req.user.id) });
});

app.post('/api/channels/:id/messages', auth, (req, res) => {
  const ch = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.id);
  if (!ch) return res.status(404).json({ error: 'Channel not found' });
  const srv = getServerForUser(ch.server_id, req.user.id);
  if (!srv) return res.status(403).json({ error: 'Not a member of this server' });
  if (req.user.muted) return res.status(403).json({ error: 'You are muted by a platform administrator.' });
  /* Locked / read-only channels: members can read but not post. Staff with
     Manage Channels (or Administrator) can still speak so the channel is not
     a dead end for moderators. */
  const canManageHere = hasPerm(srv, req.user.id, 'manage_channels') || hasPerm(srv, req.user.id, 'manage_messages');
  if (ch.read_only && !canManageHere) {
    return res.status(403).json({ error: 'This channel is locked. Only staff can send messages here.' });
  }
  /* Slow mode: enforce the per-channel cooldown server-side so it cannot be
     bypassed by calling the API directly. Staff are exempt. */
  const slowSecs = Number(ch.slow_mode) || 0;
  if (slowSecs > 0 && !canManageHere) {
    const last = db.prepare('SELECT created_at FROM messages WHERE channel_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1').get(ch.id, req.user.id);
    if (last) {
      const waitMs = slowSecs * 1000 - (Date.now() - last.created_at);
      if (waitMs > 0) {
        return res.status(429).json({ error: `Slow mode is on. Wait ${Math.ceil(waitMs / 1000)}s before sending again.` });
      }
    }
  }
  const { content, plain: plainIn, attachment_url, attachment_name, attachment_type, attachment_size, attachment_spoiler, attachment_description, reply_to_id, mentions: mentionsIn, broadcast: broadcastIn } = req.body || {};
  if ((!content || !content.trim()) && !attachment_url) return res.status(400).json({ error: 'Message cannot be empty' });

  const sSettings = getServerSettings(srv.id);
  const encryptedBody = isEncryptedContent(content);

  /* Explicit Content Filter: when the server owner turns it on, messages that
     contain explicit language or an explicit-looking attachment are rejected
     before they are stored. Nothing is deleted — the message simply never
     enters the channel. Encrypted bodies are filtered client-side (the server
     cannot read ciphertext), so they skip the server-side text scan. */
  if (sSettings.explicit_filter && !encryptedBody) {
    const bad = explicitContentReason(content, attachment_type, attachment_name);
    if (bad) return res.status(400).json({ error: 'Blocked by the Explicit Content Filter: ' + bad });
  }

  const id = newId();
  const now = Date.now();
  const mentionIds = resolveMentionIds(content, mentionsIn, req.user.id);
  /* Only encrypted bodies need a separate readable copy. Plaintext messages
     already store their text in `content`. */
  const plainText = encryptedBody && typeof plainIn === 'string' && plainIn.trim() ? plainIn.slice(0, 4000) : null;
  db.prepare(`INSERT INTO messages (id, channel_id, user_id, content, content_plain, attachment_url, attachment_name, attachment_type, attachment_size, attachment_spoiler, attachment_description, created_at, reply_to_id, mentions)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, ch.id, req.user.id, (content || '').trim(), plainText, attachment_url || null, attachment_name || null, attachment_type || null, Number.isFinite(attachment_size) ? attachment_size : null, attachment_spoiler ? 1 : 0, attachment_description ? String(attachment_description).slice(0, 500) : null, now, reply_to_id || null, JSON.stringify(mentionIds));
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  const full = messageWithMeta(m, req.user.id);
  io.to(`channel:${ch.id}`).emit('message', full);
  const ctx = { kind: 'channel', channel_id: ch.id, server_id: ch.server_id, channel_name: ch.name };
  for (const uid of mentionIds) createNotification(uid, 'mention', Object.assign({ message: full }, ctx));
  if (reply_to_id) {
    const orig = db.prepare('SELECT * FROM messages WHERE id = ?').get(reply_to_id);
    if (orig && orig.user_id !== req.user.id) createNotification(orig.user_id, 'reply', Object.assign({ message: full }, ctx));
  }

  /* @everyone / @here. Gated by the server's "Allow @everyone / @here" setting,
     and only the owner + admins may use it (so a random member cannot spam the
     whole server). @here only reaches people who are currently online. */
  const ping = resolveBroadcast(content, broadcastIn);
  if (ping) {
    const privileged = hasPerm(srv, req.user.id, 'mention_everyone');
    if (!sSettings.allow_everyone) {
      /* Silently drop the ping; the message itself still posts. */
    } else if (!privileged) {
      /* Members without a role cannot broadcast. */
    } else {
      const members = db.prepare('SELECT user_id FROM server_members WHERE server_id = ?').all(srv.id).map(r => r.user_id);
      const targets = ping === 'here' ? members.filter(uid => onlineUids.has(uid)) : members;
      for (const uid of targets) {
        if (uid === req.user.id) continue;
        createNotification(uid, ping, Object.assign({ message: full, author_id: req.user.id }, ctx));
      }
      io.to(`channel:${ch.id}`).emit('broadcast_ping', { channel_id: ch.id, kind: ping, user_id: req.user.id });
    }
  }

  res.json({ message: full });
});

app.delete('/api/messages/:id', auth, (req, res) => {
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Message not found' });
  /* Authors may always delete their own messages. In a server channel, the
     owner / admins / anyone with Manage Messages may also delete anyone's
     message, attachment or media. DMs stay author-only. */
  let allowed = m.user_id === req.user.id;
  if (!allowed && m.channel_id) {
    const ch = db.prepare('SELECT * FROM channels WHERE id = ?').get(m.channel_id);
    if (ch) {
      const srv = db.prepare('SELECT * FROM servers WHERE id = ?').get(ch.server_id);
      if (srv && (srv.owner_id === req.user.id || isServerAdmin(srv, req.user.id) ||
          hasPerm(srv, req.user.id, 'manage_messages') || hasPerm(srv, req.user.id, 'manage_channels'))) {
        allowed = true;
      }
    }
  }
  if (!allowed) return res.status(403).json({ error: 'You do not have permission to delete this message' });
  db.prepare('DELETE FROM reactions WHERE message_id = ?').run(m.id);
  db.prepare('DELETE FROM messages WHERE id = ?').run(m.id);
  if (m.channel_id) io.to(`channel:${m.channel_id}`).emit('message_deleted', { id: m.id, channel_id: m.channel_id });
  if (m.dm_id) io.to(`dm:${m.dm_id}`).emit('message_deleted', { id: m.id, dm_id: m.dm_id });
  res.json({ ok: true });
});

/* Edit a message. Only the author may edit, and the content is re-parsed for
   mentions. edited_at is stamped so clients can show an "(edited)" marker. */
app.patch('/api/messages/:id', auth, (req, res) => {
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Message not found' });
  if (m.user_id !== req.user.id) return res.status(403).json({ error: 'You can only edit your own messages' });
  const content = (req.body && req.body.content != null) ? String(req.body.content).trim() : '';
  if (!content && !m.attachment_url) return res.status(400).json({ error: 'Message cannot be empty' });
  const now = Date.now();
  const mentionIds = resolveMentionIds(content, req.body && req.body.mentions, req.user.id);
  db.prepare('UPDATE messages SET content = ?, edited_at = ?, mentions = ? WHERE id = ?')
    .run(content, now, JSON.stringify(mentionIds), m.id);
  const updated = db.prepare('SELECT * FROM messages WHERE id = ?').get(m.id);
  const full = messageWithMeta(updated, req.user.id);
  if (m.channel_id) io.to(`channel:${m.channel_id}`).emit('message_updated', full);
  if (m.dm_id) io.to(`dm:${m.dm_id}`).emit('message_updated', full);
  res.json({ message: full });
});

/* ---------------- Reactions ---------------- */
app.post('/api/messages/:id/reactions', auth, (req, res) => {
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Message not found' });
  const { emoji } = req.body || {};
  if (!emoji) return res.status(400).json({ error: 'Emoji required' });
  const existing = db.prepare('SELECT * FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').get(m.id, req.user.id, emoji);
  if (existing) {
    db.prepare('DELETE FROM reactions WHERE id = ?').run(existing.id);
  } else {
    db.prepare('INSERT INTO reactions (id, message_id, user_id, emoji, created_at) VALUES (?,?,?,?,?)')
      .run(newId(), m.id, req.user.id, emoji, Date.now());
  }
  const full = messageWithMeta(m, req.user.id);
  const payload = { message_id: m.id, reactions: full.reactions, channel_id: m.channel_id, dm_id: m.dm_id };
  if (m.channel_id) io.to(`channel:${m.channel_id}`).emit('reaction', payload);
  if (m.dm_id) io.to(`dm:${m.dm_id}`).emit('reaction', payload);
  res.json({ reactions: full.reactions });
});

/* ---------------- Pinned messages ----------------
   Anyone who can see a channel/DM can pin and unpin its messages. */
function canAccessMessage(m, userId) {
  if (m.channel_id) {
    const ch = db.prepare('SELECT * FROM channels WHERE id = ?').get(m.channel_id);
    if (!ch) return null;
    const srv = getServerForUser(ch.server_id, userId);
    if (!srv) return null;
    return { kind: 'channel', channel_id: ch.id, server_id: ch.server_id };
  }
  if (m.dm_id) {
    const dm = db.prepare('SELECT * FROM dm_channels WHERE id = ?').get(m.dm_id);
    if (!dm || (dm.user1_id !== userId && dm.user2_id !== userId)) return null;
    return { kind: 'dm', dm_id: dm.id };
  }
  return null;
}

app.get('/api/channels/:id/pins', auth, (req, res) => {
  const ch = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.id);
  if (!ch) return res.status(404).json({ error: 'Channel not found' });
  const srv = getServerForUser(ch.server_id, req.user.id);
  if (!srv) return res.status(403).json({ error: 'Not a member of this server' });
  const rows = db.prepare('SELECT * FROM messages WHERE channel_id = ? AND pinned = 1 ORDER BY created_at DESC LIMIT 50').all(ch.id);
  res.json({ pins: messagesWithMeta(rows, req.user.id) });
});

app.get('/api/dms/:id/pins', auth, (req, res) => {
  const dm = db.prepare('SELECT * FROM dm_channels WHERE id = ?').get(req.params.id);
  if (!dm || (dm.user1_id !== req.user.id && dm.user2_id !== req.user.id)) return res.status(404).json({ error: 'DM not found' });
  const rows = db.prepare('SELECT * FROM messages WHERE dm_id = ? AND pinned = 1 ORDER BY created_at DESC LIMIT 50').all(dm.id);
  res.json({ pins: messagesWithMeta(rows, req.user.id) });
});

app.post('/api/messages/:id/pin', auth, (req, res) => {
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Message not found' });
  if (!canAccessMessage(m, req.user.id)) return res.status(403).json({ error: 'You cannot pin this message' });
  db.prepare('UPDATE messages SET pinned = 1 WHERE id = ?').run(m.id);
  const payload = { message_id: m.id, pinned: true, channel_id: m.channel_id, dm_id: m.dm_id };
  if (m.channel_id) io.to(`channel:${m.channel_id}`).emit('message_pin', payload);
  if (m.dm_id) io.to(`dm:${m.dm_id}`).emit('message_pin', payload);
  res.json({ ok: true, pinned: true });
});

app.delete('/api/messages/:id/pin', auth, (req, res) => {
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Message not found' });
  if (!canAccessMessage(m, req.user.id)) return res.status(403).json({ error: 'You cannot unpin this message' });
  db.prepare('UPDATE messages SET pinned = 0 WHERE id = ?').run(m.id);
  const payload = { message_id: m.id, pinned: false, channel_id: m.channel_id, dm_id: m.dm_id };
  if (m.channel_id) io.to(`channel:${m.channel_id}`).emit('message_pin', payload);
  if (m.dm_id) io.to(`dm:${m.dm_id}`).emit('message_pin', payload);
  res.json({ ok: true, pinned: false });
});

/* ---------------- Direct Messages ---------------- */
app.get('/api/dms', auth, (req, res) => {
  /* Most recent conversation first: order by the newest message in the thread,
     falling back to when the thread was opened for empty conversations. */
  const rows = db.prepare(`SELECT d.*,
      COALESCE((SELECT MAX(m.created_at) FROM messages m WHERE m.dm_id = d.id), d.created_at) AS last_activity
    FROM dm_channels d
    WHERE (d.user1_id = ? OR d.user2_id = ?)
      AND NOT EXISTS (SELECT 1 FROM dm_hidden h WHERE h.dm_id = d.id AND h.user_id = ?)
    ORDER BY last_activity DESC`).all(req.user.id, req.user.id, req.user.id);
  const dms = rows.map(d => {
    const otherId = d.user1_id === req.user.id ? d.user2_id : d.user1_id;
    const other = db.prepare('SELECT * FROM users WHERE id = ?').get(otherId);
    const last = db.prepare('SELECT * FROM messages WHERE dm_id = ? ORDER BY created_at DESC LIMIT 1').get(d.id);
    return { id: d.id, user: publicUser(other), last_activity: d.last_activity, last_message: last ? messageWithMeta(last, req.user.id) : null };
  });
  res.json({ dms });
});

app.post('/api/dms', auth, (req, res) => {
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId required' });
  if (userId === req.user.id) return res.status(400).json({ error: 'Cannot DM yourself' });
  const other = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!other) return res.status(404).json({ error: 'User not found' });
  const [a, b] = [req.user.id, userId].sort();
  let dm = db.prepare('SELECT * FROM dm_channels WHERE user1_id = ? AND user2_id = ?').get(a, b);
  if (!dm) {
    const id = newId();
    db.prepare('INSERT INTO dm_channels (id, user1_id, user2_id, created_at) VALUES (?,?,?,?)').run(id, a, b, Date.now());
    dm = db.prepare('SELECT * FROM dm_channels WHERE id = ?').get(id);
  }
  // Opening a conversation un-hides it for the person who opened it.
  db.prepare('DELETE FROM dm_hidden WHERE dm_id = ? AND user_id = ?').run(dm.id, req.user.id);
  res.json({ dm: { id: dm.id, user: publicUser(other) } });
});

/* Close (hide) a DM from your sidebar. It reappears when a new message arrives. */
app.post('/api/dms/:id/close', auth, (req, res) => {
  const dm = db.prepare('SELECT * FROM dm_channels WHERE id = ?').get(req.params.id);
  if (!dm || (dm.user1_id !== req.user.id && dm.user2_id !== req.user.id)) return res.status(404).json({ error: 'DM not found' });
  db.prepare('INSERT OR REPLACE INTO dm_hidden (dm_id, user_id, created_at) VALUES (?,?,?)').run(dm.id, req.user.id, Date.now());
  res.json({ ok: true });
});

app.get('/api/dms/:id/messages', auth, (req, res) => {
  const dm = db.prepare('SELECT * FROM dm_channels WHERE id = ?').get(req.params.id);
  if (!dm || (dm.user1_id !== req.user.id && dm.user2_id !== req.user.id)) return res.status(404).json({ error: 'DM not found' });
  const rows = db.prepare('SELECT * FROM messages WHERE dm_id = ? ORDER BY created_at DESC LIMIT 50').all(dm.id);
  rows.reverse();
  const otherId = dm.user1_id === req.user.id ? dm.user2_id : dm.user1_id;
  const blocked = isBlockedBetween(req.user.id, otherId);
  /* Blocked conversations are hidden entirely until the block is lifted. */
  res.json({ messages: blocked ? [] : messagesWithMeta(rows, req.user.id), blocked });
});

app.post('/api/dms/:id/messages', auth, (req, res) => {
  const dm = db.prepare('SELECT * FROM dm_channels WHERE id = ?').get(req.params.id);
  if (!dm || (dm.user1_id !== req.user.id && dm.user2_id !== req.user.id)) return res.status(404).json({ error: 'DM not found' });
  if (req.user.muted) return res.status(403).json({ error: 'You are muted by a platform administrator.' });
  const dmOtherId = dm.user1_id === req.user.id ? dm.user2_id : dm.user1_id;
  if (isBlockedBetween(req.user.id, dmOtherId)) {
    return res.status(403).json({ error: 'You cannot message this user while a block is active. Unblock them first.' });
  }
  const { content, plain: plainIn, attachment_url, attachment_name, attachment_type, attachment_size, attachment_spoiler, attachment_description, reply_to_id, mentions: mentionsIn } = req.body || {};
  if ((!content || !content.trim()) && !attachment_url) return res.status(400).json({ error: 'Message cannot be empty' });
  const id = newId();
  const now = Date.now();
  const mentionIds = resolveMentionIds(content, mentionsIn, req.user.id);
  const plainText = isEncryptedContent(content) && typeof plainIn === 'string' && plainIn.trim() ? plainIn.slice(0, 4000) : null;
  db.prepare(`INSERT INTO messages (id, dm_id, user_id, content, content_plain, attachment_url, attachment_name, attachment_type, attachment_size, attachment_spoiler, attachment_description, created_at, reply_to_id, mentions)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, dm.id, req.user.id, (content || '').trim(), plainText, attachment_url || null, attachment_name || null, attachment_type || null, Number.isFinite(attachment_size) ? attachment_size : null, attachment_spoiler ? 1 : 0, attachment_description ? String(attachment_description).slice(0, 500) : null, now, reply_to_id || null, JSON.stringify(mentionIds));
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  const full = messageWithMeta(m, req.user.id);
  // A new message un-hides the conversation for everyone in it.
  db.prepare('DELETE FROM dm_hidden WHERE dm_id = ?').run(dm.id);
  io.to(`dm:${dm.id}`).emit('dm_message', full);
  const otherId = dm.user1_id === req.user.id ? dm.user2_id : dm.user1_id;
  io.to(`user:${otherId}`).emit('dm_notify', { dm_id: dm.id, message: full });
  const ctx = { kind: 'dm', dm_id: dm.id };
  for (const uid of mentionIds) if (uid !== otherId) createNotification(uid, 'mention', Object.assign({ message: full }, ctx));
  if (reply_to_id) {
    const orig = db.prepare('SELECT * FROM messages WHERE id = ?').get(reply_to_id);
    if (orig && orig.user_id !== req.user.id) createNotification(orig.user_id, 'reply', Object.assign({ message: full }, ctx));
  }
  res.json({ message: full });
});

/* ---------------- End-to-end encryption ---------------- */
/* The server only ever sees public keys and ciphertext. Clients generate an
   ECDH P-256 keypair per device, register the public half here, and wrap each
   message's random AES-256 key for every recipient device. Decryption happens
   entirely in the browser. */

app.post('/api/e2e/keys', auth, (req, res) => {
  const { key_id, public_jwk, escrow } = req.body || {};
  if (!key_id || typeof key_id !== 'string' || key_id.length > 120) return res.status(400).json({ error: 'Invalid key id' });
  if (!public_jwk || typeof public_jwk !== 'string' || public_jwk.length > 4000) return res.status(400).json({ error: 'Invalid public key' });
  let parsed;
  try { parsed = JSON.parse(public_jwk); } catch (e) { return res.status(400).json({ error: 'Invalid public key' }); }
  if (!parsed || parsed.kty !== 'EC' || parsed.crv !== 'P-256' || !parsed.x || !parsed.y) {
    return res.status(400).json({ error: 'Only P-256 ECDH public keys are accepted' });
  }
  /* A key id belongs to exactly one account; refuse to let another account
     hijack an existing id. */
  const existing = db.prepare('SELECT user_id FROM e2e_keys WHERE key_id = ?').get(key_id);
  if (existing && existing.user_id !== req.user.id) return res.status(409).json({ error: 'Key id already registered' });
  /* Optional password-encrypted backup of the private key. We validate the
     shape/size but can never read it: the wrapping key is derived from the
     user's password in the browser. Storing it lets the owner restore the key
     on a new device and decrypt their old messages. */
  let escrowJson = null;
  if (escrow && typeof escrow === 'object') {
    if (typeof escrow.ct === 'string' && typeof escrow.iv === 'string' && typeof escrow.salt === 'string' && escrow.ct.length < 8000) {
      escrowJson = JSON.stringify({
        ct: escrow.ct, iv: escrow.iv, salt: escrow.salt,
        iter: Math.min(Math.max(parseInt(escrow.iter) || 150000, 10000), 2000000),
        kdf: 'pbkdf2-sha256'
      });
    }
  }
  if (escrowJson) {
    db.prepare(`INSERT INTO e2e_keys (key_id, user_id, public_jwk, created_at, escrow) VALUES (?,?,?,?,?)
                ON CONFLICT(key_id) DO UPDATE SET public_jwk = excluded.public_jwk, escrow = excluded.escrow`)
      .run(key_id, req.user.id, public_jwk, Date.now(), escrowJson);
  } else {
    db.prepare(`INSERT INTO e2e_keys (key_id, user_id, public_jwk, created_at) VALUES (?,?,?,?)
                ON CONFLICT(key_id) DO UPDATE SET public_jwk = excluded.public_jwk`)
      .run(key_id, req.user.id, public_jwk, Date.now());
  }
  res.json({ ok: true });
});

/* Return this user's password-encrypted key backups. The client tries each one
   with the password it just signed in with; a successful unwrap restores the
   private key so old messages become readable again. Only the owner can read
   their own escrows. */
app.get('/api/e2e/escrow', auth, (req, res) => {
  const rows = db.prepare('SELECT key_id, escrow FROM e2e_keys WHERE user_id = ? AND escrow IS NOT NULL').all(req.user.id);
  const escrows = [];
  for (const r of rows) {
    try { escrows.push({ key_id: r.key_id, escrow: JSON.parse(r.escrow) }); } catch (e) { /* skip corrupt */ }
  }
  res.json({ escrows });
});

app.get('/api/e2e/keys', auth, (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 200);
  if (!ids.length) return res.json({ keys: [] });
  const ph = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT key_id, user_id, public_jwk FROM e2e_keys WHERE user_id IN (${ph})`).all(...ids);
  res.json({ keys: rows.map(r => ({ key_id: r.key_id, user_id: r.user_id, public_jwk: r.public_jwk })) });
});

/* Key re-sharing. A device that can already read a message may extend access
   to other devices by adding freshly wrapped copies of the message key to the
   envelope. This is what lets a message become readable for everyone again
   after a member joins, rotates their key, or reads from a new browser - the
   server still never sees the key or the plaintext, it only stores the extra
   wrapped copies. Additive only: existing entries are never removed. */
/* Single message lookup. Used by reply previews when the quoted message is not
   part of the loaded page, so the quote can still show its real text. */
app.get('/api/messages/:id', auth, (req, res) => {
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Message not found' });
  if (m.channel_id) {
    const ch = db.prepare('SELECT * FROM channels WHERE id = ?').get(m.channel_id);
    if (!ch || !getServerForUser(ch.server_id, req.user.id)) return res.status(403).json({ error: 'Not allowed' });
  } else if (m.dm_id) {
    const dm = db.prepare('SELECT * FROM dm_channels WHERE id = ?').get(m.dm_id);
    if (!dm || (dm.user1_id !== req.user.id && dm.user2_id !== req.user.id)) return res.status(403).json({ error: 'Not allowed' });
  } else {
    return res.status(403).json({ error: 'Not allowed' });
  }
  res.json({ message: messageWithMeta(m, req.user.id) });
});

/* Plaintext backfill. A device that has successfully decrypted an older
   message can publish the readable text so every other device (and every
   future device) shows the real message instead of a placeholder. Additive
   only: the ciphertext in `content` is never touched and an existing
   plaintext is never overwritten. */
app.post('/api/messages/:id/plain', auth, (req, res) => {
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Message not found' });
  if (m.channel_id) {
    const ch = db.prepare('SELECT * FROM channels WHERE id = ?').get(m.channel_id);
    if (!ch || !getServerForUser(ch.server_id, req.user.id)) return res.status(403).json({ error: 'Not allowed' });
  } else if (m.dm_id) {
    const dm = db.prepare('SELECT * FROM dm_channels WHERE id = ?').get(m.dm_id);
    if (!dm || (dm.user1_id !== req.user.id && dm.user2_id !== req.user.id)) return res.status(403).json({ error: 'Not allowed' });
  } else {
    return res.status(403).json({ error: 'Not allowed' });
  }
  const text = req.body && typeof req.body.plain === 'string' ? req.body.plain : '';
  if (!text.trim()) return res.status(400).json({ error: 'plain required' });
  if (m.content_plain) return res.json({ ok: true, already: true });
  db.prepare('UPDATE messages SET content_plain = ? WHERE id = ?').run(text.slice(0, 4000), m.id);
  res.json({ ok: true });
});

app.post('/api/messages/:id/keys', auth, (req, res) => {
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Message not found' });
  /* Permission: must be able to see the conversation. */
  if (m.channel_id) {
    const ch = db.prepare('SELECT * FROM channels WHERE id = ?').get(m.channel_id);
    if (!ch || !getServerForUser(ch.server_id, req.user.id)) return res.status(403).json({ error: 'Not allowed' });
  } else if (m.dm_id) {
    const dm = db.prepare('SELECT * FROM dm_channels WHERE id = ?').get(m.dm_id);
    if (!dm || (dm.user1_id !== req.user.id && dm.user2_id !== req.user.id)) return res.status(403).json({ error: 'Not allowed' });
  } else {
    return res.status(403).json({ error: 'Not allowed' });
  }
  const PREFIX = '\u0001E2E1:';
  if (typeof m.content !== 'string' || !m.content.startsWith(PREFIX)) return res.status(400).json({ error: 'Not an encrypted message' });
  let env;
  try { env = JSON.parse(m.content.slice(PREFIX.length)); } catch (e) { return res.status(400).json({ error: 'Bad envelope' }); }
  const incoming = req.body && req.body.keys;
  if (!incoming || typeof incoming !== 'object') return res.status(400).json({ error: 'No keys supplied' });
  env.keys = env.keys || {};
  let added = 0;
  for (const [keyId, entry] of Object.entries(incoming)) {
    if (!keyId || typeof keyId !== 'string' || keyId.length > 120) continue;
    if (env.keys[keyId]) continue; /* never overwrite an existing wrap */
    if (!entry || typeof entry !== 'object') continue;
    if (typeof entry.e !== 'object' || typeof entry.i !== 'string' || typeof entry.k !== 'string') continue;
    if (entry.i.length > 200 || entry.k.length > 600 || (entry.s && String(entry.s).length > 200)) continue;
    env.keys[keyId] = { e: entry.e, i: entry.i, k: entry.k, s: entry.s, d: entry.d || 'hkdf' };
    added++;
    if (added >= 200) break;
  }
  if (!added) return res.json({ ok: true, added: 0 });
  const next = PREFIX + JSON.stringify(env);
  if (next.length > 200000) return res.status(413).json({ error: 'Envelope too large' });
  db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(next, m.id);
  res.json({ ok: true, added });
});

/* The explicit-content word list is not sensitive, and handing it to the
   browser lets the client run the same filter before encrypting (the server
   can no longer inspect ciphertext). */
app.get('/api/e2e/config', auth, (req, res) => {
  res.json({ enabled: true, explicit_terms: EXPLICIT_TERMS });
});

/* ---------------- Search ---------------- */
/* Search messages the caller is allowed to see. Scope is controlled by the
   optional query params: channel_id (one channel), server_id (all text channels
   in a server), dm_id (one conversation) or none (everything the user can see). */
app.get('/api/search', auth, (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ results: [], query: '' });
  const like = '%' + q.replace(/[\\%_]/g, m => '\\' + m) + '%';
  const limit = Math.min(parseInt(req.query.limit) || 40, 100);

  let channelIds = [];
  let dmIds = [];

  if (req.query.channel_id) {
    const ch = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.query.channel_id);
    if (!ch) return res.status(404).json({ error: 'Channel not found' });
    if (!getServerForUser(ch.server_id, req.user.id)) return res.status(403).json({ error: 'Not a member of this server' });
    channelIds = [ch.id];
  } else if (req.query.server_id) {
    const srv = getServerForUser(req.query.server_id, req.user.id);
    if (!srv) return res.status(403).json({ error: 'Not a member of this server' });
    channelIds = db.prepare("SELECT id FROM channels WHERE server_id = ? AND (type IS NULL OR type = 'text')").all(srv.id).map(r => r.id);
  } else if (req.query.dm_id) {
    const dm = db.prepare('SELECT * FROM dm_channels WHERE id = ?').get(req.query.dm_id);
    if (!dm || (dm.user1_id !== req.user.id && dm.user2_id !== req.user.id)) return res.status(404).json({ error: 'DM not found' });
    dmIds = [dm.id];
  } else {
    channelIds = db.prepare(`SELECT c.id FROM channels c
      JOIN server_members m ON m.server_id = c.server_id AND m.user_id = ?
      WHERE (c.type IS NULL OR c.type = 'text')`).all(req.user.id).map(r => r.id);
    dmIds = db.prepare('SELECT id FROM dm_channels WHERE user1_id = ? OR user2_id = ?').all(req.user.id, req.user.id).map(r => r.id);
  }

  const clauses = [];
  const params = [];
  if (channelIds.length) {
    clauses.push(`(channel_id IN (${channelIds.map(() => '?').join(',')}) AND content LIKE ? ESCAPE '\\')`);
    params.push(...channelIds, like);
  }
  if (dmIds.length) {
    clauses.push(`(dm_id IN (${dmIds.map(() => '?').join(',')}) AND content LIKE ? ESCAPE '\\')`);
    params.push(...dmIds, like);
  }
  if (!clauses.length) return res.json({ results: [], query: q });

  const rows = db.prepare(`SELECT * FROM messages WHERE ${clauses.join(' OR ')} ORDER BY created_at DESC LIMIT ?`).all(...params, limit);
  const metas = messagesWithMeta(rows, req.user.id);

  const chanCache = {};
  const dmCache = {};
  const results = metas.map(m => {
    let context = null;
    if (m.channel_id) {
      if (!chanCache[m.channel_id]) {
        const ch = db.prepare('SELECT * FROM channels WHERE id = ?').get(m.channel_id);
        const srv = ch ? db.prepare('SELECT * FROM servers WHERE id = ?').get(ch.server_id) : null;
        chanCache[m.channel_id] = {
          kind: 'channel', channel_id: m.channel_id, channel_name: ch ? ch.name : 'unknown',
          server_id: srv ? srv.id : null, server_name: srv ? srv.name : ''
        };
      }
      context = chanCache[m.channel_id];
    } else if (m.dm_id) {
      if (!dmCache[m.dm_id]) {
        const dm = db.prepare('SELECT * FROM dm_channels WHERE id = ?').get(m.dm_id);
        const otherId = dm ? (dm.user1_id === req.user.id ? dm.user2_id : dm.user1_id) : null;
        const other = otherId ? db.prepare('SELECT * FROM users WHERE id = ?').get(otherId) : null;
        dmCache[m.dm_id] = { kind: 'dm', dm_id: m.dm_id, user: publicUser(other) };
      }
      context = dmCache[m.dm_id];
    }
    return Object.assign({}, m, { context });
  });

  res.json({ results, query: q });
});

/* ---------------- Link Embeds ---------------- */
function decodeEntities(s) {
  if (!s) return s;
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&nbsp;/g, ' ');
}
function metaPick(html, prop) {
  const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, 'i');
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i');
  const m = html.match(re1) || html.match(re2);
  return m ? m[1] : null;
}
/* Giphy / Tenor page links can be resolved to the real media file through the
   provider's oEmbed endpoint. This is what lets a pasted GIF link render as an
   actual looping GIF instead of a link card. */
const OEMBED_PROVIDERS = [
  { test: /(^|\.)giphy\.com$/i, endpoint: 'https://giphy.com/services/oembed?url=' },
  { test: /(^|\.)tenor\.com$/i, endpoint: 'https://tenor.com/oembed?url=' }
];

function pickMediaUrl(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const candidates = [obj.url, obj.gif, obj.mp4, obj.webm, obj.image, obj.thumbnail_url];
  for (const c of candidates) {
    if (typeof c === 'string' && /^https?:\/\//i.test(c) && /\.(gif|webp|mp4|webm|jpe?g|png)(\?|$)/i.test(c)) {
      const type = /\.(mp4|webm)(\?|$)/i.test(c) ? 'video' : 'image';
      return { url: c, type };
    }
  }
  return null;
}

async function resolveOembed(url, hostname) {
  const provider = OEMBED_PROVIDERS.find(p => p.test.test(hostname));
  if (!provider) return null;
  try {
    const r = await fetch(provider.endpoint + encodeURIComponent(url), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CrossroadsBot/1.0)', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(6000)
    });
    if (!r.ok) return null;
    const data = await r.json();
    return pickMediaUrl(data);
  } catch (e) { return null; }
}

app.get('/api/embed', auth, async (req, res) => {
  const url = req.query.url;
  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Invalid URL' });
  let hostname = '';
  try { hostname = new URL(url).hostname; } catch (e) { return res.status(400).json({ error: 'Invalid URL' }); }

  /* Fast path: known GIF providers resolve straight to the media file. */
  const media = await resolveOembed(url, hostname);
  if (media) {
    return res.json({ url, site: hostname.replace(/^www\./i, ''), title: null, description: null, image: null, media });
  }

  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CrossroadsBot/1.0; +https://crossroads.onrender.com)', 'Accept': 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(7000)
    });
    const html = (await r.text()).slice(0, 500000);
    let title = metaPick(html, 'og:title') || metaPick(html, 'twitter:title') || (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || url;
    let description = metaPick(html, 'og:description') || metaPick(html, 'twitter:description') || metaPick(html, 'description');
    let image = metaPick(html, 'og:image') || metaPick(html, 'twitter:image');
    const site = metaPick(html, 'og:site_name') || hostname;
    if (image && !/^https?:\/\//i.test(image)) { try { image = new URL(image, url).href; } catch (e) { image = null; } }
    res.json({ url, site: decodeEntities(site), title: decodeEntities(title.trim()), description: description ? decodeEntities(description.trim()) : null, image: image || null });
  } catch (e) {
    res.json({ url, site: hostname, title: url, description: null, image: null });
  }
});

/* ---------------- Upload ----------------
   Accepts any file type (images, video, audio, archives, documents…).
   Hard limit: 250 MB. */
app.post('/api/upload', auth, async (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File is too large (maximum 250 MB)' });
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    /* Mirror to the durable store before responding. Fire-and-forget could race
       a follow-up message that references the URL, and a rejected promise here
       used to surface as an unhandled rejection. Failure is non-fatal: the file
       is already on local disk and reconcileUploads() will retry at next boot. */
    try { await persist.backupUpload(req.file.filename); }
    catch (e) { console.log('[upload] backup failed (will retry):', e.message); }
    res.json({
      url: `/uploads/${req.file.filename}`,
      name: req.file.originalname,
      type: req.file.mimetype,
      size: req.file.size
    });
  });
});

/* ============================================================
   PLATFORM ADMIN API  (username "keep" only)
   Every endpoint is additive and audited. Nothing here deletes
   user content; destructive-looking actions are reversible
   (ban / mute / disable / lock) or operate on admin-created data.
   ============================================================ */
const admin = express.Router();
admin.use(auth, adminOnly);

function adminUserRow(u) {
  const servers = db.prepare('SELECT COUNT(*) c FROM server_members WHERE user_id = ?').get(u.id).c;
  const messages = db.prepare('SELECT COUNT(*) c FROM messages WHERE user_id = ?').get(u.id).c;
  const owned = db.prepare('SELECT COUNT(*) c FROM servers WHERE owner_id = ?').get(u.id).c;
  const banned = isGloballyBanned(u.id);
  let noteCount = 0;
  try { noteCount = db.prepare('SELECT COUNT(*) c FROM admin_notes WHERE user_id = ?').get(u.id).c; } catch (e) {}
  return {
    id: u.id, username: u.username, discriminator: u.discriminator,
    tag: `${u.username}#${u.discriminator}`,
    display_name: u.display_name || u.username,
    pronouns: u.pronouns || '',
    custom_status: u.custom_status || '',
    bio: u.bio || '', avatar_url: u.avatar_url || null,
    banner_url: u.banner_url || null, banner_color: u.banner_color || '#5865F2',
    accent_color: u.accent_color || '#5865F2',
    status: effectiveStatus(u.id, u.status),
    created_at: u.created_at, last_seen_at: u.last_seen_at || null,
    verified: !!u.verified, muted: !!u.muted, disabled: !!u.disabled,
    banned, platform_admin: isGlobalAdmin(u), platform_owner: isOwner(u),
    whitelisted: adminWhitelist.has(u.id), note_count: noteCount,
    badges: badgesForUser(u.id),
    servers, owned_servers: owned, messages
  };
}

/* ---- Overview ---- */
admin.get('/overview', (req, res) => {
  const now = Date.now();
  const DAY = 86400000;
  const count = (sql, ...p) => db.prepare(sql).get(...p).c;
  const mem = process.memoryUsage();
  let dbBytes = 0;
  try { dbBytes = fs.statSync(path.join(process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data'), 'crossroads.db')).size; } catch (e) {}

  /* 7-day message activity, oldest -> newest, used for the dashboard chart. */
  const activity = [];
  for (let i = 6; i >= 0; i--) {
    const start = now - (i + 1) * DAY;
    const end = now - i * DAY;
    activity.push({
      day: new Date(end).toISOString().slice(0, 10),
      messages: count('SELECT COUNT(*) c FROM messages WHERE created_at > ? AND created_at <= ?', start, end),
      users: count('SELECT COUNT(*) c FROM users WHERE created_at > ? AND created_at <= ?', start, end)
    });
  }

  const topServers = db.prepare(`
    SELECT s.id, s.name, s.icon_url,
           (SELECT COUNT(*) FROM server_members m WHERE m.server_id = s.id) AS members,
           (SELECT COUNT(*) FROM messages msg WHERE msg.channel_id IN (SELECT id FROM channels c WHERE c.server_id = s.id)) AS messages
    FROM servers s ORDER BY messages DESC, members DESC LIMIT 5`).all();

  const recentUsers = db.prepare('SELECT id, username, discriminator, display_name, avatar_url, created_at, status FROM users ORDER BY created_at DESC LIMIT 5').all()
    .map(u => ({ ...u, tag: `${u.username}#${u.discriminator}`, status: effectiveStatus(u.id, u.status) }));

  const recentAudit = db.prepare(`SELECT a.action, a.target_type, a.target_id, a.detail, a.created_at,
                                         u.username AS actor_name, u.discriminator AS actor_disc
                                  FROM admin_audit a LEFT JOIN users u ON u.id = a.actor_id
                                  ORDER BY a.created_at DESC LIMIT 6`).all();

  res.json({
    users: count('SELECT COUNT(*) c FROM users'),
    servers: count('SELECT COUNT(*) c FROM servers'),
    channels: count('SELECT COUNT(*) c FROM channels'),
    messages: count('SELECT COUNT(*) c FROM messages'),
    dms: count('SELECT COUNT(DISTINCT dm_id) c FROM messages WHERE dm_id IS NOT NULL'),
    reactions: count('SELECT COUNT(*) c FROM reactions'),
    attachments: count('SELECT COUNT(*) c FROM messages WHERE attachment_url IS NOT NULL'),
    online: onlineUids.size,
    bans: count('SELECT COUNT(*) c FROM global_bans'),
    muted: count('SELECT COUNT(*) c FROM users WHERE muted = 1'),
    disabled: count('SELECT COUNT(*) c FROM users WHERE disabled = 1'),
    verified: count('SELECT COUNT(*) c FROM users WHERE verified = 1'),
    whitelisted: count('SELECT COUNT(*) c FROM admin_whitelist'),
    notes: count('SELECT COUNT(*) c FROM admin_notes'),
    locked_servers: count('SELECT COUNT(*) c FROM servers WHERE locked = 1'),
    featured_servers: count('SELECT COUNT(*) c FROM servers WHERE featured = 1'),
    new_users_1h: count('SELECT COUNT(*) c FROM users WHERE created_at > ?', now - 3600000),
    new_users_24h: count('SELECT COUNT(*) c FROM users WHERE created_at > ?', now - DAY),
    new_users_7d: count('SELECT COUNT(*) c FROM users WHERE created_at > ?', now - 7 * DAY),
    messages_1h: count('SELECT COUNT(*) c FROM messages WHERE created_at > ?', now - 3600000),
    messages_24h: count('SELECT COUNT(*) c FROM messages WHERE created_at > ?', now - DAY),
    messages_7d: count('SELECT COUNT(*) c FROM messages WHERE created_at > ?', now - 7 * DAY),
    avg_messages_per_user: (() => { const u = count('SELECT COUNT(*) c FROM users'); return u ? Math.round(count('SELECT COUNT(*) c FROM messages') / u) : 0; })(),
    active_announcements: count('SELECT COUNT(*) c FROM global_messages WHERE active = 1'),
    settings: {
      registration_open: getGlobalSetting('registration_open', true),
      maintenance_mode: getGlobalSetting('maintenance_mode', false),
      maintenance_message: getGlobalSetting('maintenance_message', ''),
      motd: getGlobalSetting('motd', '')
    },
    activity,
    top_servers: topServers,
    recent_users: recentUsers,
    recent_audit: recentAudit,
    system: {
      uptime_seconds: Math.floor((Date.now() - bootedAt) / 1000),
      node: process.version,
      memory_mb: Math.round(mem.rss / 1048576),
      heap_mb: Math.round(mem.heapUsed / 1048576),
      db_mb: +(dbBytes / 1048576).toFixed(2),
      pid: process.pid,
      platform: process.platform,
      version: '1.1.0'
    },
    uptime_seconds: Math.floor((Date.now() - bootedAt) / 1000),
    version: '1.1.0'
  });
});

/* ---- Users ---- */
admin.get('/users', (req, res) => {
  const q = (req.query.q || '').trim();
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const rows = q
    ? db.prepare(`SELECT * FROM users WHERE username LIKE ? OR display_name LIKE ? OR id = ?
                  ORDER BY created_at ASC LIMIT ? OFFSET ?`).all(`%${q}%`, `%${q}%`, q, limit, offset)
    : db.prepare('SELECT * FROM users ORDER BY created_at ASC LIMIT ? OFFSET ?').all(limit, offset);
  const total = q
    ? db.prepare('SELECT COUNT(*) c FROM users WHERE username LIKE ? OR display_name LIKE ? OR id = ?').get(`%${q}%`, `%${q}%`, q).c
    : db.prepare('SELECT COUNT(*) c FROM users').get().c;
  res.json({ users: rows.map(adminUserRow), total });
});

/* Generic, audited user action endpoint. */
admin.post('/users/:id/action', (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  const { action, value } = req.body || {};
  if (!action) return res.status(400).json({ error: 'Action required' });
  /* Never let an admin lock themselves out of the panel. */
  if (target.id === req.user.id && ['ban', 'disable', 'mute', 'force_logout', 'kick', 'reset_password'].includes(action)) {
    return res.status(400).json({ error: 'You cannot apply that action to your own account.' });
  }
  /* The platform owner is protected: no admin (including the owner's own
     account) may ban, kick, mute, disable, revoke sessions, reset the
     password, rename or strip panel access from the owner. */
  if (isOwner(target)) {
    const ownerBlocked = ['ban', 'kick', 'disable', 'mute', 'force_logout', 'reset_password',
      'set_username', 'set_discriminator', 'unwhitelist'];
    if (ownerBlocked.includes(action)) {
      return res.status(403).json({ error: 'The platform owner account is protected and cannot be moderated.' });
    }
  }
  /* Whitelist changes are owner-only. */
  if (['whitelist', 'unwhitelist'].includes(action) && !isOwner(req.user)) {
    return res.status(403).json({ error: 'Only the platform owner can manage panel access' });
  }
  let detail = '';
  switch (action) {
    case 'set_username': {
      const uname = String(value || '').trim();
      /* Admin rename intentionally has NO length / character ceiling. */
      if (!uname) return res.status(400).json({ error: 'Username required' });
      let disc = target.discriminator;
      const clash = db.prepare('SELECT 1 FROM users WHERE LOWER(username)=LOWER(?) AND discriminator=? AND id!=?').get(uname, disc, target.id);
      if (clash) disc = uniqueUsernameDiscriminator(uname);
      db.prepare('UPDATE users SET username=?, discriminator=? WHERE id=?').run(uname, disc, target.id);
      detail = `username -> ${uname}#${disc}`;
      break;
    }
    case 'set_discriminator': {
      const disc = String(value || '').trim();
      if (!/^\d{1,8}$/.test(disc)) return res.status(400).json({ error: 'Discriminator must be 1-8 digits' });
      db.prepare('UPDATE users SET discriminator=? WHERE id=?').run(disc, target.id);
      detail = `discriminator -> ${disc}`;
      break;
    }
    case 'set_display_name': {
      db.prepare('UPDATE users SET display_name=? WHERE id=?').run(String(value || '').slice(0, 200), target.id);
      detail = 'display name changed';
      break;
    }
    case 'set_bio': {
      db.prepare('UPDATE users SET bio=? WHERE id=?').run(String(value || ''), target.id);
      detail = 'bio changed';
      break;
    }
    case 'clear_bio': {
      db.prepare("UPDATE users SET bio='' WHERE id=?").run(target.id);
      detail = 'bio cleared';
      break;
    }
    case 'set_accent': {
      const c = String(value || '');
      if (!/^#[0-9a-fA-F]{6}$/.test(c)) return res.status(400).json({ error: 'Invalid colour' });
      db.prepare('UPDATE users SET accent_color=? WHERE id=?').run(c, target.id);
      detail = `accent -> ${c}`;
      break;
    }
    case 'verify': case 'unverify': {
      db.prepare('UPDATE users SET verified=? WHERE id=?').run(action === 'verify' ? 1 : 0, target.id);
      detail = action;
      break;
    }
    case 'mute': case 'unmute': {
      db.prepare('UPDATE users SET muted=? WHERE id=?').run(action === 'mute' ? 1 : 0, target.id);
      detail = action;
      break;
    }
    case 'disable': case 'enable': {
      db.prepare('UPDATE users SET disabled=? WHERE id=?').run(action === 'disable' ? 1 : 0, target.id);
      if (action === 'disable') db.prepare('UPDATE users SET token_version=COALESCE(token_version,0)+1 WHERE id=?').run(target.id);
      detail = action;
      break;
    }
    case 'ban': {
      db.prepare(`INSERT INTO global_bans (user_id, username, reason, moderator_id, created_at)
                  VALUES (?,?,?,?,?)
                  ON CONFLICT(user_id) DO UPDATE SET reason=excluded.reason, moderator_id=excluded.moderator_id, created_at=excluded.created_at`)
        .run(target.id, target.username, String(value || '').slice(0, 500), req.user.id, Date.now());
      db.prepare('UPDATE users SET token_version=COALESCE(token_version,0)+1 WHERE id=?').run(target.id);
      detail = `banned: ${value || 'no reason'}`;
      break;
    }
    case 'unban': {
      db.prepare('DELETE FROM global_bans WHERE user_id=?').run(target.id);
      detail = 'unbanned';
      break;
    }
    case 'force_logout': {
      db.prepare('UPDATE users SET token_version=COALESCE(token_version,0)+1 WHERE id=?').run(target.id);
      detail = 'all sessions revoked';
      break;
    }
    case 'reset_password': {
      const pw = String(value || '');
      if (pw.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
      db.prepare('UPDATE users SET password_hash=?, token_version=COALESCE(token_version,0)+1 WHERE id=?')
        .run(bcrypt.hashSync(pw, 10), target.id);
      detail = 'password reset';
      break;
    }
    case 'warn': {
      createNotification(target.id, 'system', { title: 'Warning from staff', content: String(value || '').slice(0, 1000) });
      detail = `warned: ${value || ''}`;
      break;
    }
    case 'message': {
      createNotification(target.id, 'system', { title: 'Message from staff', content: String(value || '').slice(0, 1000) });
      detail = 'direct message sent';
      break;
    }
    /* ---------------- Extended moderation & profile commands ---------------- */
    case 'kick': {
      /* Sign the user out everywhere and remove them from every server they
         do not own. Reversible (they can rejoin); nothing is deleted. */
      db.prepare('UPDATE users SET token_version=COALESCE(token_version,0)+1 WHERE id=?').run(target.id);
      const owned = db.prepare('SELECT COUNT(*) c FROM servers WHERE owner_id=?').get(target.id).c;
      const removed = db.prepare("DELETE FROM server_members WHERE user_id=? AND role!='owner'").run(target.id).changes;
      createNotification(target.id, 'system', { title: 'You were removed from servers', content: String(value || 'A staff member removed you from your servers.').slice(0, 1000) });
      detail = `kicked: removed from ${removed} server(s)${owned ? `, owns ${owned}` : ''}`;
      break;
    }
    case 'set_pronouns': {
      db.prepare('UPDATE users SET pronouns=? WHERE id=?').run(String(value || '').slice(0, 40), target.id);
      detail = 'pronouns changed';
      break;
    }
    case 'set_custom_status': {
      db.prepare('UPDATE users SET custom_status=? WHERE id=?').run(String(value || '').slice(0, 128), target.id);
      detail = 'custom status changed';
      break;
    }
    case 'set_status': {
      const st = String(value || '').toLowerCase();
      if (!['online', 'idle', 'dnd', 'invisible'].includes(st)) return res.status(400).json({ error: 'Invalid status' });
      db.prepare('UPDATE users SET status=? WHERE id=?').run(st, target.id);
      detail = `status -> ${st}`;
      break;
    }
    case 'set_banner_color': {
      const c = String(value || '');
      if (!/^#[0-9a-fA-F]{6}$/.test(c)) return res.status(400).json({ error: 'Invalid colour' });
      db.prepare('UPDATE users SET banner_color=? WHERE id=?').run(c, target.id);
      detail = `banner colour -> ${c}`;
      break;
    }
    case 'clear_avatar': {
      db.prepare('UPDATE users SET avatar=NULL, avatar_url=NULL WHERE id=?').run(target.id);
      detail = 'avatar cleared';
      break;
    }
    case 'clear_banner': {
      db.prepare('UPDATE users SET banner=NULL, banner_url=NULL WHERE id=?').run(target.id);
      detail = 'banner cleared';
      break;
    }
    case 'randomize_discriminator': {
      let disc = randomDiscriminator();
      for (let i = 0; i < 25; i++) {
        const clash = db.prepare('SELECT 1 FROM users WHERE username=? AND discriminator=? AND id!=?').get(target.username, disc, target.id);
        if (!clash) break;
        disc = randomDiscriminator();
      }
      db.prepare('UPDATE users SET discriminator=? WHERE id=?').run(disc, target.id);
      detail = `discriminator randomized -> ${disc}`;
      break;
    }
    case 'whitelist': {
      db.prepare(`INSERT INTO admin_whitelist (user_id, added_by, created_at) VALUES (?,?,?)
                  ON CONFLICT(user_id) DO NOTHING`).run(target.id, req.user.id, Date.now());
      loadAdminWhitelist();
      createNotification(target.id, 'system', { title: 'Admin console access granted', content: 'You can now open the Admin Panel from Settings \u2192 Language.' });
      detail = 'granted admin console access';
      break;
    }
    case 'unwhitelist': {
      db.prepare('DELETE FROM admin_whitelist WHERE user_id=?').run(target.id);
      loadAdminWhitelist();
      detail = 'revoked admin console access';
      break;
    }
    case 'add_note': {
      const content = String(value || '').trim();
      if (!content) return res.status(400).json({ error: 'Note content required' });
      db.prepare('INSERT INTO admin_notes (id, user_id, author_id, content, created_at) VALUES (?,?,?,?,?)')
        .run(newId(), target.id, req.user.id, content.slice(0, 2000), Date.now());
      detail = 'staff note added';
      break;
    }
    case 'clear_notes': {
      const n = db.prepare('DELETE FROM admin_notes WHERE user_id=?').run(target.id).changes;
      detail = `cleared ${n} staff note(s)`;
      break;
    }
    default:
      return res.status(400).json({ error: 'Unknown action' });
  }
  adminAudit(req, `user.${action}`, 'user', target.id, detail);
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(target.id);
  broadcastProfile(fresh);
  res.json({ ok: true, user: adminUserRow(fresh) });
});

/* ---- Servers ---- */
admin.get('/servers', (req, res) => {
  const q = (req.query.q || '').trim();
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const rows = q
    ? db.prepare(`SELECT * FROM servers WHERE name LIKE ? OR id = ? ORDER BY created_at ASC LIMIT ?`).all(`%${q}%`, q, limit)
    : db.prepare('SELECT * FROM servers ORDER BY created_at ASC LIMIT ?').all(limit);
  const out = rows.map(s => {
    const owner = db.prepare('SELECT username, discriminator FROM users WHERE id = ?').get(s.owner_id);
    return {
      id: s.id, name: s.name, description: s.description || '', icon_url: s.icon_url || null,
      owner_id: s.owner_id,
      owner_tag: owner ? `${owner.username}#${owner.discriminator}` : 'unknown',
      members: db.prepare('SELECT COUNT(*) c FROM server_members WHERE server_id = ?').get(s.id).c,
      channels: db.prepare('SELECT COUNT(*) c FROM channels WHERE server_id = ?').get(s.id).c,
      messages: db.prepare('SELECT COUNT(*) c FROM messages WHERE channel_id IN (SELECT id FROM channels WHERE server_id = ?)').get(s.id).c,
      locked: !!s.locked, featured: !!s.featured, created_at: s.created_at
    };
  });
  res.json({ servers: out, total: out.length });
});

admin.post('/servers/:id/action', (req, res) => {
  const srv = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  const { action, value } = req.body || {};
  let detail = '';
  switch (action) {
    case 'lock': case 'unlock': {
      db.prepare('UPDATE servers SET locked=? WHERE id=?').run(action === 'lock' ? 1 : 0, srv.id);
      detail = action; break;
    }
    case 'feature': case 'unfeature': {
      db.prepare('UPDATE servers SET featured=? WHERE id=?').run(action === 'feature' ? 1 : 0, srv.id);
      detail = action; break;
    }
    case 'rename': {
      const name = String(value || '').trim();
      if (!name) return res.status(400).json({ error: 'Name required' });
      db.prepare('UPDATE servers SET name=? WHERE id=?').run(name.slice(0, 200), srv.id);
      detail = `renamed -> ${name}`; break;
    }
    case 'set_description': {
      db.prepare('UPDATE servers SET description=? WHERE id=?').run(String(value || '').slice(0, 2000), srv.id);
      detail = 'description changed'; break;
    }
    case 'transfer_owner': {
      const uid = String(value || '');
      const member = db.prepare('SELECT 1 FROM server_members WHERE server_id=? AND user_id=?').get(srv.id, uid);
      if (!member) return res.status(400).json({ error: 'New owner must be a member of the server' });
      db.prepare('UPDATE servers SET owner_id=? WHERE id=?').run(uid, srv.id);
      db.prepare("UPDATE server_members SET role='owner' WHERE server_id=? AND user_id=?").run(srv.id, uid);
      db.prepare("UPDATE server_members SET role='admin' WHERE server_id=? AND user_id=?").run(srv.id, srv.owner_id);
      detail = `owner -> ${uid}`; break;
    }
    case 'announce': {
      const content = String(value || '').trim();
      if (!content) return res.status(400).json({ error: 'Message required' });
      const ch = db.prepare("SELECT id FROM channels WHERE server_id=? AND type='text' ORDER BY position ASC LIMIT 1").get(srv.id);
      if (!ch) return res.status(400).json({ error: 'Server has no text channel' });
      const id = newId();
      db.prepare(`INSERT INTO messages (id, channel_id, user_id, content, created_at) VALUES (?,?,?,?,?)`)
        .run(id, ch.id, req.user.id, content, Date.now());
      const m = db.prepare('SELECT * FROM messages WHERE id=?').get(id);
      io.to(`channel:${ch.id}`).emit('message', messageWithMeta(m, req.user.id));
      detail = 'announcement posted'; break;
    }
    case 'set_icon_url': {
      const url = String(value || '').trim();
      if (url && !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Icon URL must start with http(s)://' });
      db.prepare('UPDATE servers SET icon_url=? WHERE id=?').run(url || null, srv.id);
      detail = url ? `icon -> ${url.slice(0, 120)}` : 'icon cleared'; break;
    }
    case 'set_banner_url': {
      const url = String(value || '').trim();
      if (url && !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Banner URL must start with http(s)://' });
      db.prepare('UPDATE servers SET banner_url=? WHERE id=?').run(url || null, srv.id);
      detail = url ? 'banner updated' : 'banner cleared'; break;
    }
    case 'clear_description': {
      db.prepare("UPDATE servers SET description='' WHERE id=?").run(srv.id);
      detail = 'description cleared'; break;
    }
    case 'create_invite': {
      const code = newInviteCode();
      db.prepare('INSERT INTO invites (code, server_id, creator_id, created_at) VALUES (?,?,?,?)')
        .run(code, srv.id, req.user.id, Date.now());
      detail = `invite created -> ${code}`;
      adminAudit(req, 'server.create_invite', 'server', srv.id, code);
      return res.json({ ok: true, code });
    }
    case 'set_slowmode_all': {
      const secs = Math.max(0, Math.min(21600, parseInt(value, 10) || 0));
      const n = db.prepare('UPDATE channels SET slow_mode=? WHERE server_id=?').run(secs, srv.id).changes;
      detail = `slow mode ${secs}s on ${n} channel(s)`; break;
    }
    default:
      return res.status(400).json({ error: 'Unknown action' });
  }
  adminAudit(req, `server.${action}`, 'server', srv.id, detail);
  broadcastChannels(srv.id);
  broadcastMembers(srv.id);
  res.json({ ok: true });
});

/* ---- Global announcements ---- */
admin.get('/announcements', (req, res) => {
  res.json({ announcements: db.prepare('SELECT * FROM global_messages ORDER BY created_at DESC LIMIT 200').all() });
});

admin.post('/announcements', (req, res) => {
  const { title, content, level, expires_at } = req.body || {};
  if (!content || !String(content).trim()) return res.status(400).json({ error: 'Message content required' });
  const id = newId();
  const now = Date.now();
  db.prepare(`INSERT INTO global_messages (id, author_id, title, content, level, active, created_at, expires_at)
              VALUES (?,?,?,?,?,1,?,?)`)
    .run(id, req.user.id, String(title || '').slice(0, 200), String(content).slice(0, 5000),
      ['info', 'success', 'warning', 'critical'].includes(level) ? level : 'info',
      now, expires_at ? Number(expires_at) : null);
  const row = db.prepare('SELECT * FROM global_messages WHERE id=?').get(id);
  io.emit('global_announcement', row);
  adminAudit(req, 'announcement.create', 'announcement', id, String(title || content).slice(0, 200));
  res.json({ ok: true, announcement: row });
});

admin.post('/announcements/:id/action', (req, res) => {
  const row = db.prepare('SELECT * FROM global_messages WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Announcement not found' });
  const { action } = req.body || {};
  if (action === 'activate' || action === 'deactivate') {
    db.prepare('UPDATE global_messages SET active=? WHERE id=?').run(action === 'activate' ? 1 : 0, row.id);
    adminAudit(req, `announcement.${action}`, 'announcement', row.id, '');
    return res.json({ ok: true });
  }
  return res.status(400).json({ error: 'Unknown action' });
});

/* ---- Bans list ---- */
admin.get('/bans', (req, res) => {
  res.json({ bans: db.prepare('SELECT * FROM global_bans ORDER BY created_at DESC').all() });
});

/* ---- Admin console whitelist (owner only) ---- */
admin.get('/whitelist', (req, res) => {
  const rows = db.prepare(`SELECT w.user_id, w.created_at, u.username, u.discriminator, u.display_name, u.avatar_url,
                                  a.username AS added_by_name
                           FROM admin_whitelist w
                           LEFT JOIN users u ON u.id = w.user_id
                           LEFT JOIN users a ON a.id = w.added_by
                           ORDER BY w.created_at ASC`).all();
  res.json({
    whitelist: rows.map(r => ({
      user_id: r.user_id,
      tag: r.username ? `${r.username}#${r.discriminator}` : r.user_id,
      display_name: r.display_name || r.username || r.user_id,
      avatar_url: r.avatar_url || null,
      added_by: r.added_by_name || 'owner',
      created_at: r.created_at
    })),
    owner: { id: req.user.id, tag: `${req.user.username}#${req.user.discriminator}` }
  });
});

admin.post('/whitelist', ownerOnly, (req, res) => {
  const uid = String((req.body || {}).user_id || '').trim();
  const target = db.prepare('SELECT * FROM users WHERE id = ? OR LOWER(username) = LOWER(?)').get(uid, uid);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (isOwner(target)) return res.status(400).json({ error: 'The owner already has full access' });
  db.prepare(`INSERT INTO admin_whitelist (user_id, added_by, created_at) VALUES (?,?,?)
              ON CONFLICT(user_id) DO NOTHING`).run(target.id, req.user.id, Date.now());
  loadAdminWhitelist();
  adminAudit(req, 'whitelist.add', 'user', target.id, `${target.username}#${target.discriminator}`);
  createNotification(target.id, 'system', { title: 'Admin console access granted', content: 'You can now open the Admin Panel from Settings \u2192 Language.' });
  res.json({ ok: true, user_id: target.id });
});

admin.delete('/whitelist/:id', ownerOnly, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (isOwner(target)) return res.status(400).json({ error: 'The owner cannot be removed' });
  db.prepare('DELETE FROM admin_whitelist WHERE user_id=?').run(target.id);
  loadAdminWhitelist();
  adminAudit(req, 'whitelist.remove', 'user', target.id, `${target.username}#${target.discriminator}`);
  res.json({ ok: true });
});

/* ---- Private staff notes for a user ---- */
admin.get('/users/:id/notes', (req, res) => {
  const rows = db.prepare(`SELECT n.*, u.username AS author_name, u.discriminator AS author_disc
                           FROM admin_notes n LEFT JOIN users u ON u.id = n.author_id
                           WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT 100`).all(req.params.id);
  res.json({ notes: rows });
});

/* ---- Profile badges ----
   Admins create a badge (name + custom image), then assign it to any user.
   Assigned badges are embedded in publicUser and shown under the username. */
admin.get('/badges', (req, res) => {
  const badges = db.prepare(`SELECT b.*,
      (SELECT COUNT(*) FROM user_badges ub WHERE ub.badge_id = b.id) AS assigned_count
      FROM profile_badges b ORDER BY b.created_at DESC`).all();
  res.json({ badges });
});

admin.post('/badges', (req, res) => {
  const name = String((req.body && req.body.name) || '').trim().slice(0, 40);
  const icon_url = String((req.body && req.body.icon_url) || '').trim().slice(0, 500);
  if (!name) return res.status(400).json({ error: 'Badge name required' });
  if (!icon_url) return res.status(400).json({ error: 'Badge image required' });
  const id = newId();
  db.prepare('INSERT INTO profile_badges (id, name, icon_url, created_at) VALUES (?,?,?,?)')
    .run(id, name, icon_url, Date.now());
  adminAudit(req, 'badge.create', 'badge', id, name);
  res.json({ badge: db.prepare('SELECT * FROM profile_badges WHERE id = ?').get(id) });
});

admin.patch('/badges/:id', (req, res) => {
  const b = db.prepare('SELECT * FROM profile_badges WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Badge not found' });
  const updates = []; const values = [];
  if (req.body && typeof req.body.name === 'string' && req.body.name.trim()) {
    updates.push('name = ?'); values.push(req.body.name.trim().slice(0, 40));
  }
  if (req.body && typeof req.body.icon_url === 'string' && req.body.icon_url.trim()) {
    updates.push('icon_url = ?'); values.push(req.body.icon_url.trim().slice(0, 500));
  }
  if (updates.length) {
    values.push(b.id);
    db.prepare(`UPDATE profile_badges SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }
  adminAudit(req, 'badge.update', 'badge', b.id, '');
  res.json({ badge: db.prepare('SELECT * FROM profile_badges WHERE id = ?').get(b.id) });
});

admin.delete('/badges/:id', (req, res) => {
  db.prepare('DELETE FROM user_badges WHERE badge_id = ?').run(req.params.id);
  const n = db.prepare('DELETE FROM profile_badges WHERE id = ?').run(req.params.id).changes;
  adminAudit(req, 'badge.delete', 'badge', req.params.id, '');
  res.json({ ok: true, deleted: n });
});

admin.get('/users/:id/badges', (req, res) => {
  const badges = db.prepare('SELECT * FROM profile_badges ORDER BY created_at DESC').all();
  const assigned = db.prepare('SELECT badge_id FROM user_badges WHERE user_id = ?')
    .all(req.params.id).map(r => r.badge_id);
  res.json({ badges, assigned });
});

admin.post('/users/:id/badges', (req, res) => {
  const uid = req.params.id;
  const badgeId = String((req.body && req.body.badge_id) || '');
  const assigned = !!(req.body && req.body.assigned);
  const badge = db.prepare('SELECT * FROM profile_badges WHERE id = ?').get(badgeId);
  if (!badge) return res.status(404).json({ error: 'Badge not found' });
  if (assigned) {
    db.prepare('INSERT OR IGNORE INTO user_badges (user_id, badge_id, assigned_at) VALUES (?,?,?)')
      .run(uid, badgeId, Date.now());
  } else {
    db.prepare('DELETE FROM user_badges WHERE user_id = ? AND badge_id = ?').run(uid, badgeId);
  }
  adminAudit(req, assigned ? 'badge.assign' : 'badge.unassign', 'user', uid, badge.name);
  res.json({ ok: true, badges: badgesForUser(uid) });
});

/* ---- Bulk / platform-wide operations ---- */
admin.post('/bulk', ownerOnly, (req, res) => {
  const { action } = req.body || {};
  let detail = '';
  switch (action) {
    case 'clear_bans': {
      const n = db.prepare('DELETE FROM global_bans').run().changes;
      detail = `cleared ${n} global ban(s)`; break;
    }
    case 'force_logout_all': {
      /* Revoke every session except the owner's. */
      const owners = [...OWNER_USERNAMES];
      const rows = db.prepare('SELECT id, username FROM users').all().filter(u => !owners.includes(String(u.username).toLowerCase()));
      const stmt = db.prepare('UPDATE users SET token_version=COALESCE(token_version,0)+1 WHERE id=?');
      for (const u of rows) stmt.run(u.id);
      detail = `revoked sessions for ${rows.length} user(s)`; break;
    }
    case 'deactivate_announcements': {
      const n = db.prepare('UPDATE global_messages SET active=0 WHERE active=1').run().changes;
      detail = `deactivated ${n} announcement(s)`; break;
    }
    case 'verify_all': {
      const n = db.prepare('UPDATE users SET verified=1 WHERE verified=0').run().changes;
      detail = `verified ${n} user(s)`; break;
    }
    case 'unmute_all': {
      const n = db.prepare('UPDATE users SET muted=0 WHERE muted=1').run().changes;
      detail = `unmuted ${n} user(s)`; break;
    }
    case 'unlock_all_servers': {
      const n = db.prepare('UPDATE servers SET locked=0 WHERE locked=1').run().changes;
      detail = `unlocked ${n} server(s)`; break;
    }
    default:
      return res.status(400).json({ error: 'Unknown bulk action' });
  }
  adminAudit(req, `bulk.${action}`, 'platform', '', detail);
  res.json({ ok: true, detail });
});

/* ---- Audit log CSV export ---- */
admin.get('/audit/export', (req, res) => {
  const rows = db.prepare(`SELECT a.created_at, u.username AS actor, u.discriminator AS disc, a.action,
                                  a.target_type, a.target_id, a.detail
                           FROM admin_audit a LEFT JOIN users u ON u.id = a.actor_id
                           ORDER BY a.created_at DESC LIMIT 5000`).all();
  const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const csv = ['timestamp,admin,action,target_type,target_id,detail']
    .concat(rows.map(r => [new Date(r.created_at).toISOString(), r.actor ? `${r.actor}#${r.disc}` : 'system', r.action, r.target_type, r.target_id, r.detail].map(esc).join(',')))
    .join('\n');
  adminAudit(req, 'audit.export', 'platform', '', `${rows.length} rows`);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="crossroads-audit-${Date.now()}.csv"`);
  res.send(csv);
});

/* ---- Audit log ---- */
admin.get('/audit', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
  const rows = db.prepare(`SELECT a.*, u.username AS actor_name, u.discriminator AS actor_disc
                           FROM admin_audit a LEFT JOIN users u ON u.id = a.actor_id
                           ORDER BY a.created_at DESC LIMIT ?`).all(limit);
  res.json({ audit: rows });
});

/* ---- Platform settings ---- */
admin.get('/settings', (req, res) => {
  res.json({
    registration_open: getGlobalSetting('registration_open', true),
    maintenance_mode: getGlobalSetting('maintenance_mode', false),
    maintenance_message: getGlobalSetting('maintenance_message', ''),
    motd: getGlobalSetting('motd', ''),
    max_upload_mb: getGlobalSetting('max_upload_mb', 50),
    read_only_mode: getGlobalSetting('read_only_mode', false),
    require_verify: getGlobalSetting('require_verify', false),
    allow_gifs: getGlobalSetting('allow_gifs', true),
    slow_mode_global: getGlobalSetting('slow_mode_global', 0),
    invites_enabled: getGlobalSetting('invites_enabled', true)
  });
});

admin.patch('/settings', (req, res) => {
  const allowed = ['registration_open', 'maintenance_mode', 'maintenance_message', 'motd', 'max_upload_mb',
    'read_only_mode', 'require_verify', 'allow_gifs', 'slow_mode_global', 'invites_enabled'];
  for (const k of allowed) {
    if (k in (req.body || {})) setGlobalSetting(k, req.body[k]);
  }
  adminAudit(req, 'settings.update', 'platform', '', JSON.stringify(req.body || {}).slice(0, 500));
  /* Push the new state to every connected client so toggles take effect
     immediately instead of on the next reload. */
  try {
    io.emit('platform_settings', {
      maintenance_mode: getGlobalSetting('maintenance_mode', false),
      maintenance_message: getGlobalSetting('maintenance_message', ''),
      motd: getGlobalSetting('motd', ''),
      read_only_mode: getGlobalSetting('read_only_mode', false)
    });
  } catch (e) {}
  res.json({ ok: true });
});

/* ---- Live broadcast ------------------------------------------------------
   Sends an ephemeral system notice to every connected client. Nothing is
   stored, so this cannot clutter or damage any existing data. */
admin.post('/broadcast', (req, res) => {
  const text = String((req.body || {}).text || '').trim().slice(0, 500);
  const kind = ['info', 'success', 'warning', 'danger'].includes((req.body || {}).kind) ? req.body.kind : 'info';
  if (!text) return res.status(400).json({ error: 'Message text is required' });
  const payload = { text, kind, at: Date.now(), from: req.user.username };
  try { io.emit('system_notice', payload); } catch (e) { console.error('[admin] broadcast emit:', e.message); }
  adminAudit(req, 'broadcast.send', 'platform', '', text);
  res.json({ ok: true, delivered: io.engine.clientsCount || 0 });
});

/* ---- Storage & health ---------------------------------------------------- */
admin.get('/storage', (req, res) => {
  const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
  let dbBytes = 0;
  try { dbBytes = fs.statSync(path.join(dataDir, 'crossroads.db')).size; } catch (e) {}
  let uploadFiles = 0, uploadBytes = 0;
  try {
    for (const f of fs.readdirSync(UPLOAD_DIR)) {
      try { const st = fs.statSync(path.join(UPLOAD_DIR, f)); if (st.isFile()) { uploadFiles++; uploadBytes += st.size; } } catch (e) {}
    }
  } catch (e) {}
  const count = (sql) => { try { return db.prepare(sql).get().c; } catch (e) { return 0; } };
  res.json({
    db_bytes: dbBytes,
    upload_files: uploadFiles,
    upload_bytes: uploadBytes,
    messages: count('SELECT COUNT(*) c FROM messages'),
    users: count('SELECT COUNT(*) c FROM users'),
    servers: count('SELECT COUNT(*) c FROM servers'),
    channels: count('SELECT COUNT(*) c FROM channels'),
    uptime_sec: Math.round(process.uptime()),
    memory_mb: Math.round(process.memoryUsage().rss / 1048576),
    online: io.engine.clientsCount || 0
  });
});

/* ---- Export (safe, no password hashes) ---- */
admin.get('/export', (req, res) => {
  const users = db.prepare('SELECT id, username, discriminator, display_name, bio, status, created_at, verified, muted, disabled FROM users').all();
  const servers = db.prepare('SELECT id, name, owner_id, created_at, locked, featured FROM servers').all();
  const bans = db.prepare('SELECT * FROM global_bans').all();
  const settings = db.prepare('SELECT * FROM global_settings').all();
  adminAudit(req, 'export.download', 'platform', '', `${users.length} users`);
  res.set('Content-Disposition', `attachment; filename="crossroads-export-${Date.now()}.json"`);
  res.json({ exported_at: Date.now(), users, servers, bans, settings });
});

app.use('/api/admin', admin);

/* Public (authenticated) endpoint so every client can show active announcements. */
app.get('/api/global-messages', auth, (req, res) => {
  const now = Date.now();
  const rows = db.prepare(`SELECT * FROM global_messages
                           WHERE active = 1 AND (expires_at IS NULL OR expires_at > ?)
                           ORDER BY created_at DESC LIMIT 10`).all(now);
  res.json({ announcements: rows, maintenance: getGlobalSetting('maintenance_mode', false), motd: getGlobalSetting('motd', '') });
});

/* Unknown API paths must answer with JSON, never the SPA HTML. The HTML
   fallback used to hand a 200 text/html page back to fetch(), which the
   client parsed as an empty object - so a mistyped endpoint looked like a
   silent success instead of a clear 404. */
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

/* ---------------- SPA fallback ---------------- */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ---------------- Error handler ----------------
   Always answer API calls with JSON so the client can show the real reason
   instead of a generic "Request failed" banner. */
app.use((err, req, res, next) => {
  console.error('[error]', req.method, req.originalUrl, err && err.stack ? err.stack : err);
  if (res.headersSent) return next(err);
  const status = err && (err.status || err.statusCode) ? (err.status || err.statusCode) : 500;
  if (req.originalUrl && req.originalUrl.startsWith('/api/')) {
    return res.status(status).json({ error: (err && err.message) ? String(err.message) : 'Something went wrong' });
  }
  res.status(status).send('Something went wrong');
});

/* ---------------- Socket.io ---------------- */
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    const payload = jwt.verify(token, JWT_SECRET);
    const u = db.prepare('SELECT id, token_version, disabled FROM users WHERE id = ?').get(payload.uid);
    if (!u) return next(new Error('unauthorized'));
    if ((payload.tv || 0) !== (u.token_version || 0)) return next(new Error('unauthorized'));
    if (u.disabled) return next(new Error('unauthorized'));
    if (isGloballyBanned(u.id)) return next(new Error('unauthorized'));
    socket.uid = payload.uid;
    next();
  } catch (e) {
    next(new Error('unauthorized'));
  }
});

io.on('connection', (socket) => {
  const uid = socket.uid;
  socket.join(`user:${uid}`);
  onlineUids.add(uid);
  // Announce the user's chosen status (online / idle / dnd / invisible). We do
  // NOT overwrite it here so a chosen status survives refreshes and reconnects.
  const row = db.prepare('SELECT status FROM users WHERE id = ?').get(uid);
  const currentStatus = effectiveStatus(uid, row && row.status);
  io.emit('presence', { user_id: uid, status: currentStatus });

  /* Transient presence: lets a client show "offline" after its tab has been
     hidden for a while, or "idle" after inactivity, without overwriting the
     status the user actually chose in their settings. */
  socket.on('set_presence', ({ status } = {}) => {
    if (!['online', 'idle', 'dnd', 'offline'].includes(status)) return;
    presenceOverrides.set(uid, status);
    io.emit('presence', { user_id: uid, status });
  });

  socket.on('join_channel', (channelId) => {
    if (channelId) socket.join(`channel:${channelId}`);
  });
  socket.on('leave_channel', (channelId) => {
    if (channelId) socket.leave(`channel:${channelId}`);
  });
  socket.on('join_dm', (dmId) => {
    if (dmId) socket.join(`dm:${dmId}`);
  });
  socket.on('leave_dm', (dmId) => {
    if (dmId) socket.leave(`dm:${dmId}`);
  });
  socket.on('typing', ({ channel_id, dm_id, username }) => {
    if (channel_id) socket.to(`channel:${channel_id}`).emit('typing', { channel_id, username });
    if (dm_id) socket.to(`dm:${dm_id}`).emit('typing', { dm_id, username });
  });

  /* ---------------- Voice signaling ---------------- */
  socket.on('voice_join', ({ channel_id }) => {
    if (!channel_id) return;
    const ch = db.prepare('SELECT * FROM channels WHERE id = ?').get(channel_id);
    if (!ch || ch.type !== 'voice') return;
    if (!getServerForUser(ch.server_id, uid)) return;
    // Only one voice channel per user at a time.
    const prev = voiceChannelOf(uid);
    if (prev && prev !== channel_id) removeFromVoice(socket, prev);
    let m = voiceStates.get(channel_id);
    if (!m) { m = new Map(); voiceStates.set(channel_id, m); }
    const existing = Array.from(m.keys()).filter(id => id !== uid);
    m.set(uid, { user_id: uid, muted: false, deafened: false, speaking: false, joined_at: Date.now() });
    socket.join(`voice:${channel_id}`);
    // The newcomer receives the list of existing peers and offers to each of them.
    socket.emit('voice_joined', { channel_id, peers: existing });
    // Existing peers are told a new peer arrived so they can prepare to answer.
    socket.to(`voice:${channel_id}`).emit('voice_peer_joined', { channel_id, user_id: uid });
    broadcastVoiceState(channel_id);
  });

  socket.on('voice_leave', ({ channel_id }) => {
    if (channel_id) removeFromVoice(socket, channel_id);
  });

  socket.on('voice_update', ({ channel_id, muted, deafened, speaking }) => {
    const m = voiceStates.get(channel_id);
    if (!m || !m.has(uid)) return;
    const st = m.get(uid);
    if (typeof muted === 'boolean') st.muted = muted;
    if (typeof deafened === 'boolean') st.deafened = deafened;
    if (typeof speaking === 'boolean') st.speaking = speaking;
    broadcastVoiceState(channel_id);
  });

  /* Relay a WebRTC offer/answer/ICE candidate to a single peer. */
  socket.on('voice_signal', ({ to, data }) => {
    if (!to || !data) return;
    io.to(`user:${to}`).emit('voice_signal', { from: uid, data });
  });

  /* ---------------- Direct-message call signaling ---------------- */
  const dmFor = (dmId) => {
    if (!dmId) return null;
    const dm = db.prepare('SELECT * FROM dm_channels WHERE id = ?').get(dmId);
    if (!dm || (dm.user1_id !== uid && dm.user2_id !== uid)) return null;
    return dm;
  };
  const otherOf = (dm) => (dm.user1_id === uid ? dm.user2_id : dm.user1_id);

  socket.on('dm_call_start', ({ dm_id } = {}) => {
    const dm = dmFor(dm_id);
    if (!dm) return;
    const otherId = otherOf(dm);
    if (isBlockedBetween(uid, otherId)) {
      return socket.emit('dm_call_error', { dm_id, error: 'You cannot call this user while a block is active.' });
    }
    const existing = dmCalls.get(dm_id);
    if (existing) {
      /* Re-ring the same pair instead of stacking calls; anything else means
         the line is busy. */
      if (existing.caller_id === uid) {
        return socket.emit('dm_call_ringing', { dm_id, call: dmCallPublic(existing) });
      }
      return socket.emit('dm_call_error', { dm_id, error: 'This conversation already has an active call.' });
    }
    const call = {
      dm_id,
      caller_id: uid,
      callee_id: otherId,
      state: 'ringing',
      created_at: Date.now(),
      started_at: null,
      timer: null
    };
    call.timer = setTimeout(() => {
      const cur = dmCalls.get(dm_id);
      if (cur && cur.state === 'ringing') endDmCall(dm_id, 'no_answer');
    }, DM_CALL_RING_MS);
    dmCalls.set(dm_id, call);
    const caller = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
    const callerPublic = publicUser(caller);
    const callee = db.prepare('SELECT * FROM users WHERE id = ?').get(otherId);
    const calleePublic = callee ? publicUser(callee) : null;
    socket.emit('dm_call_ringing', { dm_id, call: dmCallPublic(call) });
    io.to(`user:${otherId}`).emit('dm_call_incoming', { dm_id, call: dmCallPublic(call), caller: callerPublic });
    /* Drop a permanent "X started a call" event into the conversation so both
       people see it in the message history, not just as a transient toast. */
    try {
      const evtId = newId();
      db.prepare(`INSERT INTO messages (id, dm_id, user_id, content, content_plain, kind, created_at)
                  VALUES (?,?,?,?,?,?,?)`)
        .run(evtId, dm_id, uid, '', 'started', 'call', Date.now());
      const evt = db.prepare('SELECT * FROM messages WHERE id = ?').get(evtId);
      const evtFull = messageWithMeta(evt, uid);
      db.prepare('DELETE FROM dm_hidden WHERE dm_id = ?').run(dm_id);
      io.to(`dm:${dm_id}`).emit('dm_message', evtFull);
      io.to(`user:${otherId}`).emit('dm_notify', { dm_id, message: evtFull });
    } catch (e) { console.error('[dm call event]', e.message); }
    /* Red notification + badge even when the callee is browsing a server. */
    createNotification(otherId, 'call', { dm_id, caller: callerPublic, call: dmCallPublic(call) });
    /* The caller also gets a record of the outgoing call, so both sides see
       the call in their notification centre and unread badge. */
    if (calleePublic) {
      createNotification(uid, 'call_out', { dm_id, callee: calleePublic, call: dmCallPublic(call) });
    }
  });

  socket.on('dm_call_accept', ({ dm_id } = {}) => {
    const call = dmCalls.get(dm_id);
    if (!call || call.callee_id !== uid) return;
    if (call.timer) { clearTimeout(call.timer); call.timer = null; }
    call.state = 'active';
    call.started_at = Date.now();
    markCallNotificationsRead(dm_id);
    const payload = { dm_id, call: dmCallPublic(call) };
    io.to(`user:${call.caller_id}`).emit('dm_call_accepted', payload);
    io.to(`user:${call.callee_id}`).emit('dm_call_accepted', payload);
  });

  socket.on('dm_call_decline', ({ dm_id } = {}) => {
    const call = dmCalls.get(dm_id);
    if (!call || call.callee_id !== uid) return;
    if (call.timer) clearTimeout(call.timer);
    dmCalls.delete(dm_id);
    markCallNotificationsRead(dm_id);
    io.to(`user:${call.caller_id}`).emit('dm_call_declined', { dm_id, call: dmCallPublic(call) });
    socket.emit('dm_call_ended', { dm_id, reason: 'declined', call: dmCallPublic(call) });
  });

  socket.on('dm_call_end', ({ dm_id } = {}) => {
    const call = dmCalls.get(dm_id);
    if (!call || (call.caller_id !== uid && call.callee_id !== uid)) return;
    endDmCall(dm_id, 'ended', uid);
  });

  socket.on('dm_call_signal', ({ dm_id, to, data } = {}) => {
    const call = dmCalls.get(dm_id);
    if (!call || !to || !data) return;
    if (call.caller_id !== uid && call.callee_id !== uid) return;
    if (to !== call.caller_id && to !== call.callee_id) return;
    io.to(`user:${to}`).emit('dm_call_signal', { dm_id, from: uid, data });
  });

  socket.on('disconnect', () => {
    endCallsForUser(uid);
    const vc = voiceChannelOf(uid);
    if (vc) removeFromVoice(socket, vc);
    // Only mark the user offline once every tab/socket has closed.
    const remaining = io.sockets.adapter.rooms.get(`user:${uid}`);
    if (!remaining || remaining.size === 0) {
      onlineUids.delete(uid);
      presenceOverrides.delete(uid);
      io.emit('presence', { user_id: uid, status: 'offline' });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Crossroads running on http://localhost:${PORT}`);
  if (persist.enabled) {
    console.log(`[persist] durable storage active -> ${process.env.GH_DATA_REPO}`);
    persist.startAutoBackup(db);
    /* Pull the uploaded media in the background, in parallel, AFTER we are
       already serving traffic. This is what used to be done inside the blocking
       DB-restore child and timed out, leaving every attachment 404. */
    persist.restoreUploads()
      /* Repair any upload that a previous failed/raced backup left out of the
         data repo, so it survives the next restart. Runs after the restore so
         we never read a half-written file. */
      .then(() => persist.reconcileUploads())
      .catch(e => console.error('[persist] upload restore error:', e.message));
  } else {
    console.log('[persist] durable storage disabled (no GH_DATA_REPO set)');
  }
  startKeepAlive();
});
