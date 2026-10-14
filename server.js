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
    email: u.email,
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

function messageWithMeta(m, currentUserId) {
  const author = db.prepare('SELECT * FROM users WHERE id = ?').get(m.user_id);
  const reactions = db.prepare('SELECT emoji, user_id FROM reactions WHERE message_id = ?').all(m.id);
  const grouped = {};
  for (const r of reactions) {
    if (!grouped[r.emoji]) grouped[r.emoji] = { emoji: r.emoji, count: 0, me: false, users: [] };
    grouped[r.emoji].count++;
    grouped[r.emoji].users.push(r.user_id);
    if (r.user_id === currentUserId) grouped[r.emoji].me = true;
  }
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
    author: publicUser(author),
    reactions: Object.values(grouped)
  };
}

/* ---------------- Auth routes ---------------- */
app.post('/api/register', (req, res) => {
  let { username, email, password } = req.body || {};
  username = (username || '').trim();
  email = (email || '').trim().toLowerCase();
  if (!username || !email || !password) return res.status(400).json({ error: 'All fields are required' });
  if (username.length < 2 || username.length > 32) return res.status(400).json({ error: 'Username must be 2-32 characters' });
  if (!/^[a-zA-Z0-9._]+$/.test(username)) return res.status(400).json({ error: 'Username may only contain letters, numbers, periods and underscores' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address' });
  const emailExists = db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
  if (emailExists) return res.status(409).json({ error: 'Email is already registered' });

  const discriminator = uniqueUsernameDiscriminator(username);
  const id = newId();
  const hash = bcrypt.hashSync(password, 10);
  const now = Date.now();
  const accent = randomColor();
  db.prepare(`INSERT INTO users (id, username, discriminator, email, password_hash, accent_color, status, created_at)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, username, discriminator, email, hash, accent, 'online', now);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const token = sign(user);
  res.json({ token, user: publicUser(user) });
});

app.post('/api/login', (req, res) => {
  let { identifier, email, username, password } = req.body || {};
  const login = (identifier || email || username || '').trim();
  if (!login || !password) return res.status(400).json({ error: 'Credentials required' });
  let user;
  if (login.includes('#')) {
    const [uname, disc] = login.split('#');
    user = db.prepare('SELECT * FROM users WHERE username = ? AND discriminator = ?').get(uname, disc);
  } else if (login.includes('@')) {
    user = db.prepare('SELECT * FROM users WHERE email = ?').get(login.toLowerCase());
  } else {
    user = db.prepare('SELECT * FROM users WHERE username = ? ORDER BY created_at ASC LIMIT 1').get(login);
  }
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid login or password' });
  }
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run('online', user.id);
  const token = sign(user);
  res.json({ token, user: publicUser(user) });
});

app.get('/api/me', auth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.patch('/api/me', auth, (req, res) => {
  const allowed = ['bio', 'accent_color', 'avatar', 'avatar_url', 'banner', 'banner_url', 'status'];
  const updates = [];
  const values = [];
  for (const key of allowed) {
    if (key in req.body) { updates.push(`${key} = ?`); values.push(req.body[key]); }
  }
  if (updates.length) {
    values.push(req.user.id);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

/* ---------------- Users ---------------- */
app.get('/api/users/:id', auth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  res.json({ user: publicUser(u) });
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

/* ---------------- Servers ---------------- */
app.get('/api/servers', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT s.* FROM servers s
    JOIN server_members m ON m.server_id = s.id
    WHERE m.user_id = ? ORDER BY m.joined_at ASC`).all(req.user.id);
  res.json({ servers: rows });
});

app.post('/api/servers', auth, (req, res) => {
  let { name, icon } = req.body || {};
  name = (name || '').trim();
  if (!name) return res.status(400).json({ error: 'Server name required' });
  const id = newId();
  const now = Date.now();
  db.prepare('INSERT INTO servers (id, name, icon, owner_id, created_at) VALUES (?,?,?,?,?)')
    .run(id, name, icon || null, req.user.id, now);
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

/* ---------------- Messages ---------------- */
app.get('/api/channels/:id/messages', auth, (req, res) => {
  const ch = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.id);
  if (!ch) return res.status(404).json({ error: 'Channel not found' });
  const srv = getServerForUser(ch.server_id, req.user.id);
  if (!srv) return res.status(403).json({ error: 'Not a member of this server' });
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const rows = db.prepare('SELECT * FROM messages WHERE channel_id = ? ORDER BY created_at DESC LIMIT ?').all(ch.id, limit);
  rows.reverse();
  res.json({ messages: rows.map(m => messageWithMeta(m, req.user.id)) });
});

app.post('/api/channels/:id/messages', auth, (req, res) => {
  const ch = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.id);
  if (!ch) return res.status(404).json({ error: 'Channel not found' });
  const srv = getServerForUser(ch.server_id, req.user.id);
  if (!srv) return res.status(403).json({ error: 'Not a member of this server' });
  const { content, attachment_url, attachment_name, attachment_type } = req.body || {};
  if ((!content || !content.trim()) && !attachment_url) return res.status(400).json({ error: 'Message cannot be empty' });
  const id = newId();
  const now = Date.now();
  db.prepare(`INSERT INTO messages (id, channel_id, user_id, content, attachment_url, attachment_name, attachment_type, created_at)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, ch.id, req.user.id, (content || '').trim(), attachment_url || null, attachment_name || null, attachment_type || null, now);
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  const full = messageWithMeta(m, req.user.id);
  io.to(`channel:${ch.id}`).emit('message', full);
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
  res.json({ messages: rows.map(m => messageWithMeta(m, req.user.id)) });
});

app.post('/api/dms/:id/messages', auth, (req, res) => {
  const dm = db.prepare('SELECT * FROM dm_channels WHERE id = ?').get(req.params.id);
  if (!dm || (dm.user1_id !== req.user.id && dm.user2_id !== req.user.id)) return res.status(404).json({ error: 'DM not found' });
  const { content, attachment_url, attachment_name, attachment_type } = req.body || {};
  if ((!content || !content.trim()) && !attachment_url) return res.status(400).json({ error: 'Message cannot be empty' });
  const id = newId();
  const now = Date.now();
  db.prepare(`INSERT INTO messages (id, dm_id, user_id, content, attachment_url, attachment_name, attachment_type, created_at)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, dm.id, req.user.id, (content || '').trim(), attachment_url || null, attachment_name || null, attachment_type || null, now);
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  const full = messageWithMeta(m, req.user.id);
  io.to(`dm:${dm.id}`).emit('dm_message', full);
  // Notify the other user
  const otherId = dm.user1_id === req.user.id ? dm.user2_id : dm.user1_id;
  io.to(`user:${otherId}`).emit('dm_notify', { dm_id: dm.id, message: full });
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

/* ---------------- Upload ---------------- */
app.post('/api/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({
    url: `/uploads/${req.file.filename}`,
    name: req.file.originalname,
    type: req.file.mimetype
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
