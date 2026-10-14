const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { Server } = require('socket.io');

const db = require('./db');
const { newId, randomColor, randomDiscriminator } = require('./util');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'crossroads-dev-secret-change-me';
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 });

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

/* ---------------- Uploads ---------------- */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, `${newId()}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

/* ---------------- Helpers ---------------- */
function sign(user) {
  return jwt.sign({ uid: user.id }, JWT_SECRET, { expiresIn: '30d' });
}

function publicUser(u) {
  if (!u) return null;
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
    status: u.status,
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
    created_at: m.created_at,
    edited_at: m.edited_at,
    reply_to_id: m.reply_to_id || null,
    reply_to: replyPreviewOf(m),
    mentions: safeParse(m.mentions, []),
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
    created_at: m.created_at,
    edited_at: m.edited_at,
    reply_to_id: m.reply_to_id || null,
    reply_to: m.reply_to_id ? (replyMap[m.reply_to_id] || null) : null,
    mentions: safeParse(m.mentions, []),
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
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run('online', user.id);
  const token = sign(user);
  res.json({ token, user: publicUser(user) });
});

app.get('/api/me', auth, (req, res) => {
  res.json({ user: publicUser(req.user) });
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
  if (updates.length) {
    values.push(uid);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
  res.json({ user: publicUser(user) });
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
    rows = db.prepare('SELECT * FROM users WHERE username LIKE ? OR (username || "#" || discriminator) LIKE ? LIMIT 25')
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
  res.json({ servers: rows });
});

app.post('/api/servers', auth, (req, res) => {
  let { name, icon, icon_url } = req.body || {};
  name = (name || '').trim();
  if (!name) return res.status(400).json({ error: 'Server name required' });
  const id = newId();
  const now = Date.now();
  db.prepare('INSERT INTO servers (id, name, icon, icon_url, owner_id, created_at) VALUES (?,?,?,?,?,?)')
    .run(id, name, icon || null, icon_url || null, req.user.id, now);
  db.prepare('INSERT INTO server_members (server_id, user_id, joined_at) VALUES (?,?,?)').run(id, req.user.id, now);
  createDefaultChannels(id);
  const srv = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
  res.json({ server: srv });
});

app.post('/api/servers/join', auth, (req, res) => {
  let { invite } = req.body || {};
  invite = (invite || '').trim();
  if (!invite) return res.status(400).json({ error: 'Invite code required' });
  // Accept full URL or raw id
  let code = invite;
  if (invite.includes('/')) code = invite.split('/').filter(Boolean).pop();
  const srv = db.prepare('SELECT * FROM servers WHERE id = ?').get(code);
  if (!srv) return res.status(404).json({ error: 'Invalid invite code' });
  const existing = db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?').get(srv.id, req.user.id);
  if (!existing) {
    db.prepare('INSERT INTO server_members (server_id, user_id, joined_at) VALUES (?,?,?)').run(srv.id, req.user.id, Date.now());
  }
  res.json({ server: srv });
});

app.get('/api/servers/:id', auth, (req, res) => {
  const srv = getServerForUser(req.params.id, req.user.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  const channels = db.prepare('SELECT * FROM channels WHERE server_id = ? ORDER BY position ASC, created_at ASC').all(srv.id);
  const members = db.prepare(`
    SELECT u.* FROM users u JOIN server_members m ON m.user_id = u.id
    WHERE m.server_id = ? ORDER BY m.joined_at ASC`).all(srv.id).map(publicUser);
  res.json({ server: srv, channels, members });
});

app.post('/api/servers/:id/channels', auth, (req, res) => {
  const srv = getServerForUser(req.params.id, req.user.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  let { name, type, topic } = req.body || {};
  name = (name || '').trim();
  if (!name) return res.status(400).json({ error: 'Channel name required' });
  const maxPos = db.prepare('SELECT MAX(position) as p FROM channels WHERE server_id = ?').get(srv.id).p || 0;
  const id = newId();
  db.prepare('INSERT INTO channels (id, server_id, name, type, topic, position, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, srv.id, name, type || 'text', topic || '', maxPos + 1, Date.now());
  const ch = db.prepare('SELECT * FROM channels WHERE id = ?').get(id);
  res.json({ channel: ch });
});

/* Update server name / icon (owner only). */
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
  if (updates.length) {
    values.push(srv.id);
    db.prepare(`UPDATE servers SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }
  res.json({ server: db.prepare('SELECT * FROM servers WHERE id = ?').get(srv.id) });
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
  const { content, attachment_url, attachment_name, attachment_type, reply_to_id } = req.body || {};
  if ((!content || !content.trim()) && !attachment_url) return res.status(400).json({ error: 'Message cannot be empty' });
  const id = newId();
  const now = Date.now();
  const mentionIds = parseMentionIds(content).filter(uid => uid !== req.user.id);
  db.prepare(`INSERT INTO messages (id, channel_id, user_id, content, attachment_url, attachment_name, attachment_type, created_at, reply_to_id, mentions)
              VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, ch.id, req.user.id, (content || '').trim(), attachment_url || null, attachment_name || null, attachment_type || null, now, reply_to_id || null, JSON.stringify(mentionIds));
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  const full = messageWithMeta(m, req.user.id);
  io.to(`channel:${ch.id}`).emit('message', full);
  const ctx = { kind: 'channel', channel_id: ch.id, server_id: ch.server_id, channel_name: ch.name };
  for (const uid of mentionIds) createNotification(uid, 'mention', Object.assign({ message: full }, ctx));
  if (reply_to_id) {
    const orig = db.prepare('SELECT * FROM messages WHERE id = ?').get(reply_to_id);
    if (orig && orig.user_id !== req.user.id) createNotification(orig.user_id, 'reply', Object.assign({ message: full }, ctx));
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

/* ---------------- Direct Messages ---------------- */
app.get('/api/dms', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM dm_channels WHERE user1_id = ? OR user2_id = ? ORDER BY created_at DESC').all(req.user.id, req.user.id);
  const dms = rows.map(d => {
    const otherId = d.user1_id === req.user.id ? d.user2_id : d.user1_id;
    const other = db.prepare('SELECT * FROM users WHERE id = ?').get(otherId);
    const last = db.prepare('SELECT * FROM messages WHERE dm_id = ? ORDER BY created_at DESC LIMIT 1').get(d.id);
    return { id: d.id, user: publicUser(other), last_message: last ? messageWithMeta(last, req.user.id) : null };
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
  res.json({ dm: { id: dm.id, user: publicUser(other) } });
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
  const { content, attachment_url, attachment_name, attachment_type, reply_to_id } = req.body || {};
  if ((!content || !content.trim()) && !attachment_url) return res.status(400).json({ error: 'Message cannot be empty' });
  const id = newId();
  const now = Date.now();
  const mentionIds = parseMentionIds(content).filter(uid => uid !== req.user.id);
  db.prepare(`INSERT INTO messages (id, dm_id, user_id, content, attachment_url, attachment_name, attachment_type, created_at, reply_to_id, mentions)
              VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, dm.id, req.user.id, (content || '').trim(), attachment_url || null, attachment_name || null, attachment_type || null, now, reply_to_id || null, JSON.stringify(mentionIds));
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  const full = messageWithMeta(m, req.user.id);
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
app.get('/api/embed', auth, async (req, res) => {
  const url = req.query.url;
  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Invalid URL' });
  let hostname = '';
  try { hostname = new URL(url).hostname; } catch (e) { return res.status(400).json({ error: 'Invalid URL' }); }
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
   Hard limit: 25 MB. */
app.post('/api/upload', auth, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File is too large (maximum 25 MB)' });
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
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
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run('online', uid);
  io.emit('presence', { user_id: uid, status: 'online' });

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

  socket.on('disconnect', () => {
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run('offline', uid);
    io.emit('presence', { user_id: uid, status: 'offline' });
  });
});

server.listen(PORT, () => {
  console.log(`Crossroads running on http://localhost:${PORT}`);
});
