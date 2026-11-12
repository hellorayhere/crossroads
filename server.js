const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { Server } = require('socket.io');

const db = require('./db');
const persist = require('./persist');
const { newId, newInviteCode, randomColor, randomDiscriminator } = require('./util');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'crossroads-dev-secret-change-me';
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
app.use('/uploads', express.static(UPLOAD_DIR));
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
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, `${newId()}${ext}`);
  }
});
/* 50 MB ceiling so animated GIF/WebP avatars, banners and backgrounds fit. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const upload = multer({ storage, limits: { fileSize: MAX_UPLOAD_BYTES } });

/* ---------------- Helpers ---------------- */
function sign(user) {
  return jwt.sign({ uid: user.id }, JWT_SECRET, { expiresIn: '30d' });
}

function publicUser(u, opts = {}) {
  if (!u) return null;
  /* Report the *effective* status (which may be a transient "offline" after a
     hidden tab or "idle" after inactivity) so that REST responses never snap a
     user back to the status stored in the database. `opts.self` is used for
     /api/me, where the caller always wants the status they actually chose. */
  const status = opts.self ? (u.status || 'online') : effectiveStatus(u.id, u.status);
  return {
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
    created_at: u.created_at
  };
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token || null);
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.uid);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

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

/* Owner + admins can manage channels, invites and member roles. */
function isServerAdmin(server, userId) {
  if (!server) return false;
  if (server.owner_id === userId) return true;
  const r = memberRole(server.id, userId);
  return r === 'owner' || r === 'admin';
}

/* ---------------- Server settings / roles / bans ---------------- */

const SETTINGS_DEFAULTS = {
  verification_level: 'none',
  explicit_filter: 0,
  allow_everyone: 1,
  default_notifications: 'all',
  slow_mode: 0,
  system_channel_id: null
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
  return {
    id: orig.id,
    content: orig.content,
    attachment_url: orig.attachment_url,
    attachment_name: orig.attachment_name,
    attachment_type: orig.attachment_type,
    attachment_size: orig.attachment_size || null,
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
    attachment_url: m.attachment_url,
    attachment_name: m.attachment_name,
    attachment_type: m.attachment_type,
    attachment_size: m.attachment_size || null,
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
      replyMap[o.id] = {
        id: o.id,
        content: o.content,
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
    attachment_url: m.attachment_url,
    attachment_name: m.attachment_name,
    attachment_type: m.attachment_type,
    attachment_size: m.attachment_size || null,
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

/* ---------------- Mentions & notifications ---------------- */
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

app.post('/api/register', (req, res) => {
  let { username, password } = req.body || {};
  username = (username || '').trim();
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
  const token = sign(user);
  res.json({ token, user: publicUser(user) });
});

app.post('/api/login', (req, res) => {
  let { identifier, username, password } = req.body || {};
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
  const token = sign(user);
  res.json({ token, user: publicUser(user) });
});

/* Password reset (unauthenticated). Requires the exact username#tag so a user
   who has forgotten their password can regain access. */
app.post('/api/password/reset', (req, res) => {
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
  const hash = bcrypt.hashSync(String(new_password), 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  res.json({ ok: true });
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
      const taken = db.prepare('SELECT 1 FROM users WHERE LOWER(username) = LOWER(?) AND id != ?').get(uname, uid);
      if (taken) return res.status(409).json({ error: 'That username is already taken' });
      let disc = req.user.discriminator;
      const clash = db.prepare('SELECT 1 FROM users WHERE LOWER(username) = LOWER(?) AND discriminator = ? AND id != ?').get(uname, disc, uid);
      if (clash) disc = uniqueUsernameDiscriminator(uname);
      updates.push('username = ?'); values.push(uname);
      updates.push('discriminator = ?'); values.push(disc);
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

/* ---------------- Users ---------------- */
app.get('/api/users/:id', auth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const isMe = u.id === req.user.id;
  const noteRow = db.prepare('SELECT content FROM notes WHERE owner_id = ? AND target_id = ?').get(req.user.id, u.id);
  res.json({
    user: publicUser(u),
    relationship: isMe ? 'self' : relationshipBetween(req.user.id, u.id),
    mutual_servers: isMe ? [] : mutualServers(req.user.id, u.id),
    mutual_friends: isMe ? [] : mutualFriends(req.user.id, u.id),
    note: noteRow ? noteRow.content : ''
  });
});

app.get('/api/users', auth, (req, res) => {
  const q = (req.query.q || '').trim();
  let rows;
  if (q) {
    rows = db.prepare("SELECT * FROM users WHERE username LIKE ? OR (username || '#' || discriminator) LIKE ? LIMIT 25")
      .all(`%${q}%`, `%${q}%`);
  } else {
    rows = db.prepare('SELECT * FROM users WHERE id != ? ORDER BY created_at DESC LIMIT 25').all(req.user.id);
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
  if (!isServerAdmin(srv, req.user.id)) return res.status(403).json({ error: 'Only the owner and admins can manage channels' });
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
  if (!isServerAdmin(srv, req.user.id)) return res.status(403).json({ error: 'Only the owner and admins can manage channels' });
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
  if (!isServerAdmin(srv, req.user.id)) return res.status(403).json({ error: 'Only the owner and admins can manage channels' });
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

app.patch('/api/servers/:id/categories/:catId', auth, (req, res) => {
  const srv = getServerForUser(req.params.id, req.user.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  if (!isServerAdmin(srv, req.user.id)) return res.status(403).json({ error: 'Only the owner and admins can manage channels' });
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
  if (!isServerAdmin(srv, req.user.id)) return res.status(403).json({ error: 'Only the owner and admins can manage channels' });
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
  if (!isServerAdmin(srv, req.user.id)) return res.status(403).json({ error: 'Only the owner and admins can manage channels' });
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
  if (updates.length) {
    values.push(ch.id);
    db.prepare(`UPDATE channels SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }
  const updated = db.prepare('SELECT * FROM channels WHERE id = ?').get(ch.id);
  broadcastChannels(srv.id);
  res.json({ channel: updated });
});

/* Delete a channel and all of its messages (owner + admins). */
app.delete('/api/servers/:id/channels/:cid', auth, (req, res) => {
  const srv = getServerForUser(req.params.id, req.user.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  if (!isServerAdmin(srv, req.user.id)) return res.status(403).json({ error: 'Only the owner and admins can manage channels' });
  const ch = db.prepare('SELECT * FROM channels WHERE id = ? AND server_id = ?').get(req.params.cid, srv.id);
  if (!ch) return res.status(404).json({ error: 'Channel not found' });
  const remaining = db.prepare('SELECT COUNT(*) AS c FROM channels WHERE server_id = ?').get(srv.id).c;
  if (remaining <= 1) return res.status(400).json({ error: 'A server needs at least one channel' });
  const wipe = db.transaction(() => {
    db.prepare('DELETE FROM reactions WHERE message_id IN (SELECT id FROM messages WHERE channel_id = ?)').run(ch.id);
    db.prepare('DELETE FROM messages WHERE channel_id = ?').run(ch.id);
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
  if (!isServerAdmin(srv, req.user.id)) return res.status(403).json({ error: 'Only the owner and admins can manage members' });
  const target = req.params.uid;
  if (target === srv.owner_id) return res.status(400).json({ error: 'The owner cannot be modified' });
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
  if (!isServerAdmin(srv, req.user.id)) return res.status(403).json({ error: 'Only the owner and admins can edit settings' });
  const cur = getServerSettings(srv.id);
  const body = req.body || {};
  const next = {
    verification_level: ['none', 'low', 'medium', 'high'].includes(body.verification_level) ? body.verification_level : cur.verification_level,
    explicit_filter: 'explicit_filter' in body ? (body.explicit_filter ? 1 : 0) : cur.explicit_filter,
    allow_everyone: 'allow_everyone' in body ? (body.allow_everyone ? 1 : 0) : cur.allow_everyone,
    default_notifications: ['all', 'mentions', 'none'].includes(body.default_notifications) ? body.default_notifications : cur.default_notifications,
    slow_mode: 'slow_mode' in body ? Math.max(0, Math.min(21600, parseInt(body.slow_mode, 10) || 0)) : cur.slow_mode,
    system_channel_id: 'system_channel_id' in body ? (body.system_channel_id || null) : cur.system_channel_id
  };
  db.prepare(`UPDATE server_settings SET verification_level=?, explicit_filter=?, allow_everyone=?, default_notifications=?, slow_mode=?, system_channel_id=?, updated_at=? WHERE server_id=?`)
    .run(next.verification_level, next.explicit_filter, next.allow_everyone, next.default_notifications, next.slow_mode, next.system_channel_id, Date.now(), srv.id);
  addAudit(srv.id, req.user.id, 'settings_update', null, '');
  io.emit('server_settings_update', { server_id: srv.id, settings: getServerSettings(srv.id) });
  res.json({ settings: getServerSettings(srv.id) });
});

/* ---------------- Moderation: kick / ban / timeout ---------------- */

/* Kick a member (owner + admins). They can rejoin with a valid invite. */
app.post('/api/servers/:id/kick', auth, (req, res) => {
  const srv = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  if (!isServerAdmin(srv, req.user.id)) return res.status(403).json({ error: 'Only the owner and admins can kick members' });
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
  if (!isServerAdmin(srv, req.user.id)) return res.status(403).json({ error: 'Only the owner and admins can ban members' });
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
  if (!isServerAdmin(srv, req.user.id)) return res.status(403).json({ error: 'Only the owner and admins can view bans' });
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
  if (!isServerAdmin(srv, req.user.id)) return res.status(403).json({ error: 'Only the owner and admins can manage bans' });
  db.prepare('DELETE FROM server_bans WHERE server_id = ? AND user_id = ?').run(srv.id, req.params.uid);
  addAudit(srv.id, req.user.id, 'unban', req.params.uid, '');
  res.json({ ok: true });
});

/* Timeout (mute) a member for N minutes (owner + admins). */
app.post('/api/servers/:id/members/:uid/timeout', auth, (req, res) => {
  const srv = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  if (!isServerAdmin(srv, req.user.id)) return res.status(403).json({ error: 'Only the owner and admins can time out members' });
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
  if (!isServerAdmin(srv, req.user.id)) return res.status(403).json({ error: 'Only the owner and admins can manage roles' });
  const name = String((req.body && req.body.name) || '').trim().slice(0, 32);
  if (!name) return res.status(400).json({ error: 'Role name required' });
  const color = /^#[0-9a-fA-F]{6}$/.test((req.body && req.body.color) || '') ? req.body.color : '#5865F2';
  const maxPos = db.prepare('SELECT MAX(position) AS p FROM server_roles WHERE server_id = ?').get(srv.id).p || 0;
  const id = newId();
  db.prepare('INSERT INTO server_roles (id, server_id, name, color, position, created_at) VALUES (?,?,?,?,?,?)')
    .run(id, srv.id, name, color, maxPos + 1, Date.now());
  addAudit(srv.id, req.user.id, 'role_create', id, name);
  const role = db.prepare('SELECT * FROM server_roles WHERE id = ?').get(id);
  io.emit('server_roles_update', { server_id: srv.id });
  res.json({ role: Object.assign({}, role, { member_count: 0 }) });
});

/* Update a custom role (owner + admins). */
app.patch('/api/servers/:id/roles/:rid', auth, (req, res) => {
  const srv = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  if (!isServerAdmin(srv, req.user.id)) return res.status(403).json({ error: 'Only the owner and admins can manage roles' });
  const role = db.prepare('SELECT * FROM server_roles WHERE id = ? AND server_id = ?').get(req.params.rid, srv.id);
  if (!role) return res.status(404).json({ error: 'Role not found' });
  const updates = []; const values = [];
  if (req.body && typeof req.body.name === 'string' && req.body.name.trim()) { updates.push('name = ?'); values.push(req.body.name.trim().slice(0, 32)); }
  if (req.body && /^#[0-9a-fA-F]{6}$/.test(req.body.color || '')) { updates.push('color = ?'); values.push(req.body.color); }
  if (updates.length) { values.push(role.id); db.prepare(`UPDATE server_roles SET ${updates.join(', ')} WHERE id = ?`).run(...values); }
  io.emit('server_roles_update', { server_id: srv.id });
  res.json({ role: db.prepare('SELECT * FROM server_roles WHERE id = ?').get(role.id) });
});

/* Delete a custom role (owner + admins). Members keep their membership. */
app.delete('/api/servers/:id/roles/:rid', auth, (req, res) => {
  const srv = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  if (!isServerAdmin(srv, req.user.id)) return res.status(403).json({ error: 'Only the owner and admins can manage roles' });
  db.prepare('UPDATE server_members SET custom_role_id = NULL WHERE server_id = ? AND custom_role_id = ?').run(srv.id, req.params.rid);
  db.prepare('DELETE FROM server_roles WHERE id = ? AND server_id = ?').run(req.params.rid, srv.id);
  addAudit(srv.id, req.user.id, 'role_delete', req.params.rid, '');
  io.emit('server_roles_update', { server_id: srv.id });
  broadcastMembers(srv.id);
  res.json({ ok: true });
});

/* ---------------- Server invites ---------------- */

/* How many live invite links a single server may hold at once. */
const MAX_ACTIVE_INVITES = 5;

/* Create an invite. Body: { expires_in: minutes|'never', max_uses: number|null } */
app.post('/api/servers/:id/invites', auth, (req, res) => {
  const srv = getServerForUser(req.params.id, req.user.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  let { expires_in, max_uses } = req.body || {};
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
  let code = newInviteCode();
  // Extremely unlikely collision, but guard anyway.
  while (db.prepare('SELECT 1 FROM invites WHERE code = ?').get(code)) code = newInviteCode();
  const now = Date.now();
  db.prepare('INSERT INTO invites (code, server_id, creator_id, created_at, expires_at, max_uses, uses) VALUES (?,?,?,?,?,?,0)')
    .run(code, srv.id, req.user.id, now, expiresAt, maxUses);
  const row = db.prepare('SELECT * FROM invites WHERE code = ?').get(code);
  res.json({ invite: invitePublic(row) });
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
  res.json({ messages: messagesWithMeta(rows, req.user.id) });
});

app.post('/api/channels/:id/messages', auth, (req, res) => {
  const ch = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.id);
  if (!ch) return res.status(404).json({ error: 'Channel not found' });
  const srv = getServerForUser(ch.server_id, req.user.id);
  if (!srv) return res.status(403).json({ error: 'Not a member of this server' });
  const { content, attachment_url, attachment_name, attachment_type, attachment_size, reply_to_id } = req.body || {};
  if ((!content || !content.trim()) && !attachment_url) return res.status(400).json({ error: 'Message cannot be empty' });

  const sSettings = getServerSettings(srv.id);

  /* Explicit Content Filter: when the server owner turns it on, messages that
     contain explicit language or an explicit-looking attachment are rejected
     before they are stored. Nothing is deleted — the message simply never
     enters the channel. */
  if (sSettings.explicit_filter) {
    const bad = explicitContentReason(content, attachment_type, attachment_name);
    if (bad) return res.status(400).json({ error: 'Blocked by the Explicit Content Filter: ' + bad });
  }

  const id = newId();
  const now = Date.now();
  const mentionIds = parseMentionIds(content).filter(uid => uid !== req.user.id);
  db.prepare(`INSERT INTO messages (id, channel_id, user_id, content, attachment_url, attachment_name, attachment_type, attachment_size, created_at, reply_to_id, mentions)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, ch.id, req.user.id, (content || '').trim(), attachment_url || null, attachment_name || null, attachment_type || null, Number.isFinite(attachment_size) ? attachment_size : null, now, reply_to_id || null, JSON.stringify(mentionIds));
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
  const ping = parseBroadcastPing(content);
  if (ping) {
    const privileged = srv.owner_id === req.user.id || isServerAdmin(srv, req.user.id);
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
  if (m.user_id !== req.user.id) return res.status(403).json({ error: 'You can only delete your own messages' });
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
  const mentionIds = parseMentionIds(content).filter(uid => uid !== req.user.id);
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
  res.json({ messages: messagesWithMeta(rows, req.user.id) });
});

app.post('/api/dms/:id/messages', auth, (req, res) => {
  const dm = db.prepare('SELECT * FROM dm_channels WHERE id = ?').get(req.params.id);
  if (!dm || (dm.user1_id !== req.user.id && dm.user2_id !== req.user.id)) return res.status(404).json({ error: 'DM not found' });
  const { content, attachment_url, attachment_name, attachment_type, attachment_size, reply_to_id } = req.body || {};
  if ((!content || !content.trim()) && !attachment_url) return res.status(400).json({ error: 'Message cannot be empty' });
  const id = newId();
  const now = Date.now();
  const mentionIds = parseMentionIds(content).filter(uid => uid !== req.user.id);
  db.prepare(`INSERT INTO messages (id, dm_id, user_id, content, attachment_url, attachment_name, attachment_type, attachment_size, created_at, reply_to_id, mentions)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, dm.id, req.user.id, (content || '').trim(), attachment_url || null, attachment_name || null, attachment_type || null, Number.isFinite(attachment_size) ? attachment_size : null, now, reply_to_id || null, JSON.stringify(mentionIds));
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
   Accepts images (including animated GIF/WebP), video, audio and documents.
   Hard limit: 50 MB (animated avatars / banners / backgrounds). */
app.post('/api/upload', auth, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File is too large (maximum 50 MB)' });
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    persist.backupUpload(req.file.filename);
    res.json({
      url: `/uploads/${req.file.filename}`,
      name: req.file.originalname,
      type: req.file.mimetype,
      size: req.file.size
    });
  });
});

/* ---------------- SPA fallback ---------------- */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ---------------- Socket.io ---------------- */
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    const payload = jwt.verify(token, JWT_SECRET);
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

  socket.on('disconnect', () => {
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
  } else {
    console.log('[persist] durable storage disabled (no GH_DATA_REPO set)');
  }
  startKeepAlive();
});
