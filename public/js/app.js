/* ============================================================
   Crossroads — client application
   ============================================================ */
const API = '';
let token = localStorage.getItem('cr_token');
let me = null;
try { me = JSON.parse(localStorage.getItem('cr_user') || 'null'); } catch (e) { me = null; }
let socket = null;

const state = {
  servers: [],
  server: null,
  channels: [],
  members: [],
  channel: null,
  dm: null,
  dms: [],
  messages: [],
  pendingAttachment: null,
  typingUsers: {},
  usersCache: {},
  showMembers: true,
  replyTo: null
};

const EMOJIS = ['😀','😂','🥹','😍','😎','🤔','😴','🥳','😭','😡','👍','👎','👏','🙏','🔥','💯','✨','🎉','❤️','💜','💙','💚','😺','🐶','🍕','🍔','☕','🎮','🎵','🚀','⚡','🌟','👀','🤯','😅','🙌','🤝','💪','🧠','🦄'];

/* ---------------- DOM helpers ---------------- */
const $ = (id) => document.getElementById(id);
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"');
}
function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return 'Today at ' + time;
  if (d.toDateString() === yest.toDateString()) return 'Yesterday at ' + time;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' at ' + time;
}
function shortTime(ts) { return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
function fullTag(u) { return u ? `${u.username}#${u.discriminator}` : ''; }

function avatarHTML(user, size = 40, status = null) {
  if (!user) user = { username: '?' };
  const bg = user.avatar_url ? '#5865f2' : (user.accent_color || '#5865f2');
  const inner = user.avatar_url
    ? `<img src="${escapeHtml(user.avatar_url)}" alt="">`
    : (user.avatar ? escapeHtml(user.avatar) : escapeHtml((user.username || '?')[0].toUpperCase()));
  const dot = status ? `<span class="status-dot ${status}"></span>` : '';
  return `<div class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px;background:${bg}">${inner}${dot}</div>`;
}

/* ---------------- API ---------------- */
async function api(path, opts = {}) {
  const headers = Object.assign({ 'Authorization': 'Bearer ' + token }, opts.headers || {});
  if (opts.body && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + path, Object.assign({}, opts, { headers }));
  if (res.status === 401) { logout(); throw new Error('Session expired'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function logout() {
  localStorage.removeItem('cr_token');
  localStorage.removeItem('cr_user');
  window.location.href = '/';
}

/* ---------------- Toast ---------------- */
function toast(msg, type = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  $('toast-wrap').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 3000);
}

/* ============================================================
   INIT
   ============================================================ */
async function init() {
  if (!token) { window.location.href = '/'; return; }
  try {
    const { user } = await api('/api/me');
    me = user;
    localStorage.setItem('cr_user', JSON.stringify(me));
  } catch (e) { return; }
  renderMe();
  connectSocket();
  await loadServers();
  await loadDMs();
  showHome();
  bindGlobalEvents();
}

function renderMe() {
  $('my-avatar').outerHTML = avatarHTML(me, 32, 'online').replace('class="avatar"', 'class="avatar" id="my-avatar"');
  $('my-username').textContent = me.username;
  $('my-tag').textContent = '#' + me.discriminator;
}

/* ============================================================
   SOCKET
   ============================================================ */
function connectSocket() {
  socket = io({ auth: { token } });
  socket.on('connect', () => {
    if (state.channel) socket.emit('join_channel', state.channel.id);
    if (state.dm) socket.emit('join_dm', state.dm.id);
  });
  socket.on('message', (m) => {
    if (state.channel && m.channel_id === state.channel.id) {
      state.messages.push(m); appendMessage(m);
    }
  });
  socket.on('dm_message', (m) => {
    if (state.dm && m.dm_id === state.dm.id) { state.messages.push(m); appendMessage(m); }
    loadDMs();
  });
  socket.on('dm_notify', (data) => {
    loadDMs();
    if (!state.dm || state.dm.id !== data.dm_id) {
      toast('New message from ' + fullTag(data.message.author), '');
    }
  });
  socket.on('message_deleted', (data) => {
    const node = document.querySelector(`[data-mid="${data.id}"]`);
    if (node) node.remove();
    state.messages = state.messages.filter(x => x.id !== data.id);
  });
  socket.on('reaction', (data) => {
    const m = state.messages.find(x => x.id === data.message_id);
    if (m) { m.reactions = data.reactions; updateReactions(data.message_id, data.reactions); }
  });
  socket.on('typing', (data) => {
    if (data.username) showTyping(data.username, data.channel_id || data.dm_id);
  });
  socket.on('presence', (data) => {
    const u = state.usersCache[data.user_id];
    if (u) u.status = data.status;
    const dot = document.querySelector(`[data-uid="${data.user_id}"] .status-dot`);
    if (dot) dot.className = 'status-dot ' + data.status;
  });
}

/* ============================================================
   SERVERS RAIL
   ============================================================ */
async function loadServers() {
  const { servers } = await api('/api/servers');
  state.servers = servers;
  renderRail();
}

function renderRail() {
  const wrap = $('rail-servers');
  wrap.innerHTML = '';
  for (const s of state.servers) {
    const d = document.createElement('div');
    d.className = 'rail-item tip' + (state.server && state.server.id === s.id ? ' active' : '');
    d.dataset.tip = s.name;
    d.dataset.sid = s.id;
    if (s.icon_url) d.innerHTML = `<img src="${escapeHtml(s.icon_url)}" alt="">`;
    else if (s.icon) d.textContent = s.icon;
    else d.textContent = s.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    d.innerHTML += '<span class="pill"></span>';
    d.addEventListener('click', () => openServer(s.id));
    wrap.appendChild(d);
  }
}

/* ============================================================
   HOME / DMs
   ============================================================ */
function showHome() {
  state.server = null; state.channel = null; state.dm = null;
  renderRail();
  $('rail-home').classList.add('active');
  $('sidebar-name').textContent = 'Direct Messages';
  $('chat-hash').style.display = 'none';
  $('chat-title').textContent = 'Direct Messages';
  $('chat-topic').textContent = '';
  $('members').innerHTML = '';
  $('composer').classList.add('hidden');
  renderDMList();
  renderEmptyChat();
}

async function loadDMs() {
  const { dms } = await api('/api/dms');
  state.dms = dms;
  for (const d of dms) if (d.user) state.usersCache[d.user.id] = d.user;
  if (!state.server) renderDMList();
}

function renderDMList() {
  const list = $('channel-list');
  list.innerHTML = '';
  const cat = document.createElement('div');
  cat.className = 'channel-category';
  cat.innerHTML = '<span class="arrow">▼</span> Direct Messages';
  list.appendChild(cat);
  for (const d of state.dms) {
    const item = document.createElement('div');
    item.className = 'dm-item' + (state.dm && state.dm.id === d.id ? ' active' : '');
    item.innerHTML = `${avatarHTML(d.user, 32, d.user.status || 'offline')}<span class="dm-name">${escapeHtml(d.user ? d.user.username : 'Unknown')}</span>`;
    item.addEventListener('click', () => openDM(d));
    list.appendChild(item);
  }
  const add = document.createElement('div');
  add.className = 'dm-item';
  add.innerHTML = `<div class="avatar" style="width:32px;height:32px;font-size:18px;background:#5865f2">+</div><span class="dm-name">Start a conversation</span>`;
  add.addEventListener('click', openNewDM);
  list.appendChild(add);
}

async function openDM(d) {
  state.server = null; state.channel = null;
  if (state.dm && state.dm.id !== d.id) socket.emit('leave_dm', state.dm.id);
  state.dm = d;
  state.usersCache[d.user.id] = d.user;
  renderRail();
  $('rail-home').classList.add('active');
  $('sidebar-name').textContent = 'Direct Messages';
  renderDMList();
  $('chat-hash').style.display = 'none';
  $('chat-title').textContent = d.user.username;
  $('chat-topic').textContent = '';
  $('members').innerHTML = '';
  socket.emit('join_dm', d.id);
  const { messages } = await api('/api/dms/' + d.id + '/messages');
  state.messages = messages;
  renderMessages();
  $('composer').classList.remove('hidden');
  $('message-input').placeholder = 'Message @' + d.user.username;
  $('composer-hint').textContent = '';
  $('message-input').focus();
}

/* ============================================================
   SERVERS
   ============================================================ */
async function openServer(id) {
  const data = await api('/api/servers/' + id);
  state.server = data.server;
  state.channels = data.channels;
  state.members = data.members;
  state.dm = null;
  for (const m of data.members) state.usersCache[m.id] = m;
  renderRail();
  $('rail-home').classList.remove('active');
  $('sidebar-name').textContent = data.server.name;
  renderChannelList();
  renderMembers();
  const firstText = state.channels.find(c => c.type === 'text');
  if (firstText) openChannel(firstText.id);
  else { state.channel = null; renderEmptyChat('No text channels yet'); $('composer').classList.add('hidden'); }
}

function renderChannelList() {
  const list = $('channel-list');
  list.innerHTML = '';
  const textChannels = state.channels.filter(c => c.type === 'text');
  const voiceChannels = state.channels.filter(c => c.type === 'voice');

  const tcat = document.createElement('div');
  tcat.className = 'channel-category';
  tcat.innerHTML = '<span class="arrow">▼</span> Text Channels';
  list.appendChild(tcat);
  for (const c of textChannels) list.appendChild(channelRow(c));
  const tadd = document.createElement('div');
  tadd.className = 'channel-add';
  tadd.innerHTML = '<span class="plus">＋</span> Create Channel';
  tadd.addEventListener('click', () => openCreateChannel('text'));
  list.appendChild(tadd);

  const vcat = document.createElement('div');
  vcat.className = 'channel-category';
  vcat.innerHTML = '<span class="arrow">▼</span> Voice Channels';
  list.appendChild(vcat);
  for (const c of voiceChannels) list.appendChild(channelRow(c));
  const vadd = document.createElement('div');
  vadd.className = 'channel-add';
  vadd.innerHTML = '<span class="plus">＋</span> Create Channel';
  vadd.addEventListener('click', () => openCreateChannel('voice'));
  list.appendChild(vadd);
}

function channelRow(c) {
  const row = document.createElement('div');
  row.className = 'channel' + (state.channel && state.channel.id === c.id ? ' active' : '');
  row.dataset.cid = c.id;
  const icon = c.type === 'voice' ? '🔊' : '#';
  row.innerHTML = `<span class="hash">${icon}</span><span class="ch-name">${escapeHtml(c.name)}</span>`;
  row.addEventListener('click', () => {
    if (c.type === 'voice') { toast('Voice channels are coming soon 🎧'); return; }
    openChannel(c.id);
  });
  return row;
}

async function openChannel(cid) {
  const c = state.channels.find(x => x.id === cid);
  if (!c) return;
  if (state.channel && state.channel.id !== cid) socket.emit('leave_channel', state.channel.id);
  state.channel = c;
  state.dm = null;
  document.querySelectorAll('.channel').forEach(el => el.classList.toggle('active', el.dataset.cid === cid));
  socket.emit('join_channel', cid);
  $('chat-hash').style.display = '';
  $('chat-hash').textContent = '#';
  $('chat-title').textContent = c.name;
  $('chat-topic').textContent = c.topic || '';
  const { messages } = await api('/api/channels/' + cid + '/messages');
  state.messages = messages;
  renderMessages();
  $('composer').classList.remove('hidden');
  $('message-input').placeholder = 'Message #' + c.name;
  $('composer-hint').textContent = '';
  $('message-input').focus();
}

function renderMembers() {
  const wrap = $('members');
  if (!state.showMembers || !state.server) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = '';
  const online = state.members.filter(m => m.status !== 'offline');
  const offline = state.members.filter(m => m.status === 'offline');
  const addCat = (label, arr) => {
    if (!arr.length) return;
    const cat = document.createElement('div');
    cat.className = 'member-cat';
    cat.textContent = `${label} — ${arr.length}`;
    wrap.appendChild(cat);
    for (const m of arr) {
      const row = document.createElement('div');
      row.className = 'member' + (m.status === 'offline' ? ' offline' : '');
      row.dataset.uid = m.id;
      const crown = (state.server.owner_id === m.id) ? '<span class="owner-crown">👑</span>' : '';
      row.innerHTML = `${avatarHTML(m, 32, m.status || 'offline')}<span class="mname">${escapeHtml(m.username)}${crown}</span>`;
      row.addEventListener('click', () => openProfile(m));
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); memberContext(e, m); });
      wrap.appendChild(row);
    }
  };
  addCat('ONLINE', online);
  addCat('OFFLINE', offline);
}

/* ============================================================
   MESSAGES RENDERING
   ============================================================ */
function renderEmptyChat(text) {
  $('messages').innerHTML = `<div class="empty-state"><div class="inner">
    <h2>👋 Welcome to Crossroads</h2>
    <p>${text || 'Select a server or start a direct message to begin chatting.'}</p>
    <button class="btn" id="empty-create2">Create a Server</button>
  </div></div>`;
  const b = $('empty-create2'); if (b) b.addEventListener('click', openCreateServer);
}

function renderMessages() {
  const box = $('messages');
  box.innerHTML = '';
  const inner = document.createElement('div');
  inner.className = 'messages-inner';
  inner.id = 'messages-inner';

  if (state.channel) {
    const intro = document.createElement('div');
    intro.className = 'channel-intro';
    intro.innerHTML = `<div class="big-avatar">#</div><h2>Welcome to #${escapeHtml(state.channel.name)}!</h2><p>This is the start of the #${escapeHtml(state.channel.name)} channel.</p>`;
    inner.appendChild(intro);
  } else if (state.dm) {
    const intro = document.createElement('div');
    intro.className = 'channel-intro';
    intro.innerHTML = `${avatarHTML(state.dm.user, 68)}<h2>${escapeHtml(state.dm.user.username)}</h2><p>This is the beginning of your direct message history with <b>${escapeHtml(fullTag(state.dm.user))}</b>.</p>`;
    inner.appendChild(intro);
  }
  box.appendChild(inner);

  let prev = null;
  for (const m of state.messages) {
    const grouped = prev && prev.author && m.author && prev.author.id === m.author.id && (m.created_at - prev.created_at) < 5 * 60 * 1000;
    inner.appendChild(messageNode(m, grouped));
    prev = m;
  }
  scrollToBottom();
}

function messageNode(m, grouped) {
  const node = document.createElement('div');
  node.className = 'msg-group' + (grouped ? ' compact' : '');
  node.dataset.mid = m.id;
  node.dataset.uid = m.author.id;
  const a = m.author;
  const gutter = grouped
    ? `<div class="gutter"><span class="mini-time">${shortTime(m.created_at)}</span></div>`
    : `<div class="gutter">${avatarHTML(a, 40)}</div>`;
  const head = grouped ? '' : `<div class="head"><span class="author">${escapeHtml(a.username)}</span><span class="time">${formatTime(m.created_at)}</span></div>`;
  const toolbar = `<div class="msg-toolbar">
      <button data-act="react" title="Add Reaction">😀</button>
      <button data-act="reply" title="Reply">↩</button>
      ${m.author.id === me.id ? '<button data-act="delete" title="Delete">🗑</button>' : ''}
    </div>`;
  node.innerHTML = `${toolbar}${gutter}<div class="body">${head}
    <div class="text" data-content>${formatContent(m.content)}</div>
    <div class="attachment-slot"></div>
    <div class="embed-slot"></div>
    <div class="reactions">${reactionsHTML(m.reactions)}</div>
  </div>`;

  const authorEl = node.querySelector('.author');
  if (authorEl) authorEl.addEventListener('click', () => openProfile(a));

  // attachment
  if (m.attachment_url) {
    node.querySelector('.attachment-slot').appendChild(attachmentNode(m));
  }
  // embeds for links
  const urls = extractUrls(m.content);
  if (urls.length) {
    const slot = node.querySelector('.embed-slot');
    urls.slice(0, 2).forEach(u => slot.appendChild(embedNode(u)));
  }
  // reactions
  node.querySelectorAll('.reaction').forEach(r => {
    r.addEventListener('click', () => toggleReaction(m.id, r.dataset.emoji));
  });
  // toolbar
  node.querySelectorAll('.msg-toolbar button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const act = btn.dataset.act;
      if (act === 'react') openReactionPicker(btn, m.id);
      else if (act === 'delete') deleteMessage(m.id);
      else if (act === 'reply') { state.replyTo = m; $('message-input').focus(); toast('Replying to ' + fullTag(m.author)); }
    });
  });
  return node;
}

function appendMessage(m) {
  const inner = $('messages-inner');
  if (!inner) { renderMessages(); return; }
  const prev = state.messages[state.messages.length - 2];
  const grouped = prev && prev.author && m.author && prev.author.id === m.author.id && (m.created_at - prev.created_at) < 5 * 60 * 1000;
  inner.appendChild(messageNode(m, grouped));
  scrollToBottom();
}

function formatContent(text) {
  if (!text) return '';
  let html = escapeHtml(text);
  // mentions
  html = html.replace(/@([a-zA-Z0-9._]+)/g, (mt, name) => {
    const isMe = name.toLowerCase() === me.username.toLowerCase();
    return `<span class="mention${isMe ? ' me' : ''}">@${name}</span>`;
  });
  // channel refs
  html = html.replace(/#([a-z0-9-]+)/g, '<span class="mention">#$1</span>');
  // code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // links
  html = html.replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
  return html;
}

function extractUrls(text) {
  if (!text) return [];
  const m = text.match(/https?:\/\/[^\s<]+/g) || [];
  return m.filter(u => !/\.(png|jpe?g|gif|webp|mp4|webm|mov|mp3|wav)$/i.test(u));
}

function reactionsHTML(reactions) {
  if (!reactions || !reactions.length) return '';
  return reactions.map(r => `<div class="reaction${r.me ? ' me' : ''}" data-emoji="${escapeHtml(r.emoji)}" title="${escapeHtml((r.users || []).length)} reactions">
    <span class="emoji">${r.emoji}</span><span class="count">${r.count}</span></div>`).join('');
}

function updateReactions(mid, reactions) {
  const node = document.querySelector(`[data-mid="${mid}"] .reactions`);
  if (!node) return;
  node.innerHTML = reactionsHTML(reactions);
  node.querySelectorAll('.reaction').forEach(r => r.addEventListener('click', () => toggleReaction(mid, r.dataset.emoji)));
}

function attachmentNode(m) {
  const wrap = document.createElement('div');
  wrap.className = 'attachment';
  const t = (m.attachment_type || '').toLowerCase();
  const url = m.attachment_url;
  if (t.startsWith('image/')) {
    wrap.innerHTML = `<img src="${escapeHtml(url)}" alt="${escapeHtml(m.attachment_name || '')}">`;
    wrap.querySelector('img').addEventListener('click', () => lightbox(url, 'image'));
  } else if (t.startsWith('video/')) {
    wrap.innerHTML = `<video src="${escapeHtml(url)}" controls></video>`;
  } else if (t.startsWith('audio/')) {
    wrap.innerHTML = `<audio src="${escapeHtml(url)}" controls style="width:320px"></audio>`;
  } else {
    wrap.innerHTML = `<div class="file-card"><div class="fi">📄</div><div><a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(m.attachment_name || 'file')}</a><div class="fsize">Click to download</div></div></div>`;
  }
  return wrap;
}

function embedNode(url) {
  const wrap = document.createElement('div');
  wrap.className = 'embed';
  wrap.innerHTML = `<div class="embed-content"><div class="embed-site">loading…</div></div>`;
  api('/api/embed?url=' + encodeURIComponent(url)).then(data => {
    if (!data) return;
    const desc = data.description ? (data.description.length > 200 ? data.description.slice(0, 200) + '…' : data.description) : '';
    wrap.innerHTML = `<div class="embed-content">
        <div class="embed-site">${escapeHtml(data.site || '')}</div>
        <div class="embed-title"><a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(data.title || url)}</a></div>
        ${desc ? `<div class="embed-desc">${escapeHtml(desc)}</div>` : ''}
      </div>${data.image ? `<img class="embed-thumb" src="${escapeHtml(data.image)}" alt="" onerror="this.remove()">` : ''}`;
  }).catch(() => { wrap.remove(); });
  return wrap;
}

function scrollToBottom() {
  const box = $('messages');
  box.scrollTop = box.scrollHeight;
}

function lightbox(url, type) {
  const lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.innerHTML = `<span class="close">×</span>` + (type === 'image' ? `<img src="${escapeHtml(url)}">` : `<video src="${escapeHtml(url)}" controls autoplay></video>`);
  lb.addEventListener('click', () => lb.remove());
  document.body.appendChild(lb);
}

/* ============================================================
   COMPOSER / SENDING
   ============================================================ */
function currentTarget() {
  if (state.channel) return { kind: 'channel', id: state.channel.id, name: '#' + state.channel.name };
  if (state.dm) return { kind: 'dm', id: state.dm.id, name: '@' + state.dm.user.username };
  return null;
}

async function sendMessage() {
  const t = currentTarget();
  if (!t) return;
  const input = $('message-input');
  const content = input.value.trim();
  if (!content && !state.pendingAttachment) return;

  const payload = { content };
  if (state.pendingAttachment) {
    payload.attachment_url = state.pendingAttachment.url;
    payload.attachment_name = state.pendingAttachment.name;
    payload.attachment_type = state.pendingAttachment.type;
  }
  input.value = '';
  autoGrow(input);
  clearAttachment();
  try {
    if (t.kind === 'channel') await api('/api/channels/' + t.id + '/messages', { method: 'POST', body: JSON.stringify(payload) });
    else await api('/api/dms/' + t.id + '/messages', { method: 'POST', body: JSON.stringify(payload) });
    if (t.kind === 'dm') loadDMs();
  } catch (e) { toast(e.message, 'error'); }
}

function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, window.innerHeight * 0.5) + 'px';
}

function emitTyping() {
  const t = currentTarget();
  if (!t || !socket) return;
  const payload = { username: me.username };
  if (t.kind === 'channel') payload.channel_id = t.id; else payload.dm_id = t.id;
  socket.emit('typing', payload);
}

const typingState = {};
function showTyping(username, key) {
  const bar = $('typing-bar');
  typingState[key] = { username, time: Date.now() };
  clearTimeout(typingState[key].timer);
  typingState[key].timer = setTimeout(() => { delete typingState[key]; renderTyping(); }, 4000);
  renderTyping();
}
function renderTyping() {
  const bar = $('typing-bar');
  const names = Object.values(typingState).map(x => x.username);
  if (!names.length) { bar.innerHTML = ''; return; }
  const label = names.length === 1 ? `<b>${escapeHtml(names[0])}</b> is typing` : `<b>${names.length} people</b> are typing`;
  bar.innerHTML = `<span class="typing-dots"><span></span><span></span><span></span></span> ${label}…`;
}

/* ---------------- Attachments ---------------- */
async function handleFile(file) {
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) { toast('File too large (max 25MB)', 'error'); return; }
  const fd = new FormData();
  fd.append('file', file);
  toast('Uploading ' + file.name + '…');
  try {
    const data = await api('/api/upload', { method: 'POST', body: fd });
    state.pendingAttachment = data;
    renderAttachmentPreview();
  } catch (e) { toast(e.message, 'error'); }
}
function renderAttachmentPreview() {
  const p = $('attach-preview');
  const a = state.pendingAttachment;
  if (!a) { p.classList.add('hidden'); $('composer-box').classList.remove('attached'); return; }
  p.classList.remove('hidden');
  $('composer-box').classList.add('attached');
  const thumb = (a.type || '').startsWith('image/') ? `<img src="${escapeHtml(a.url)}">` : `<div class="fi" style="width:48px;height:48px;border-radius:6px;background:#5865f2;display:grid;place-items:center">📄</div>`;
  p.innerHTML = `${thumb}<span class="ap-name">${escapeHtml(a.name)}</span><button id="ap-remove">✕</button>`;
  $('ap-remove').addEventListener('click', clearAttachment);
}
function clearAttachment() {
  state.pendingAttachment = null;
  $('attach-preview').classList.add('hidden');
  $('composer-box').classList.remove('attached');
}

/* ---------------- Reactions ---------------- */
async function toggleReaction(mid, emoji) {
  try {
    const { reactions } = await api('/api/messages/' + mid + '/reactions', { method: 'POST', body: JSON.stringify({ emoji }) });
    const m = state.messages.find(x => x.id === mid);
    if (m) m.reactions = reactions;
    updateReactions(mid, reactions);
  } catch (e) { toast(e.message, 'error'); }
}

function openReactionPicker(anchor, mid) {
  closePopovers();
  const rect = anchor.getBoundingClientRect();
  const picker = document.createElement('div');
  picker.className = 'emoji-picker';
  picker.id = 'reaction-picker';
  picker.style.position = 'fixed';
  picker.style.bottom = 'auto';
  picker.style.right = 'auto';
  picker.style.top = Math.min(rect.bottom + 8, window.innerHeight - 340) + 'px';
  picker.style.left = Math.max(8, Math.min(rect.left - 140, window.innerWidth - 340)) + 'px';
  picker.innerHTML = `<h4>Pick a reaction</h4><div class="emoji-grid">${EMOJIS.map(e => `<button data-e="${e}">${e}</button>`).join('')}</div>`;
  picker.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { toggleReaction(mid, b.dataset.e); picker.remove(); }));
  document.body.appendChild(picker);
}

function openEmojiPickerForInput() {
  closePopovers();
  const rect = $('emoji-btn').getBoundingClientRect();
  const picker = document.createElement('div');
  picker.className = 'emoji-picker';
  picker.id = 'input-emoji-picker';
  picker.style.position = 'fixed';
  picker.style.bottom = 'auto'; picker.style.right = 'auto';
  picker.style.top = Math.max(8, rect.top - 340) + 'px';
  picker.style.left = Math.max(8, rect.left - 280) + 'px';
  picker.innerHTML = `<h4>Emoji</h4><div class="emoji-grid">${EMOJIS.map(e => `<button data-e="${e}">${e}</button>`).join('')}</div>`;
  picker.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    const ta = $('message-input');
    ta.value += b.dataset.e; ta.focus(); autoGrow(ta);
  }));
  document.body.appendChild(picker);
}

function closePopovers() {
  document.querySelectorAll('.emoji-picker, .context-menu').forEach(el => el.remove());
}

async function deleteMessage(mid) {
  if (!confirm('Delete this message?')) return;
  try {
    await api('/api/messages/' + mid, { method: 'DELETE' });
    const node = document.querySelector(`[data-mid="${mid}"]`);
    if (node) node.remove();
    state.messages = state.messages.filter(x => x.id !== mid);
  } catch (e) { toast(e.message, 'error'); }
}

function memberContext(e, m) {
  closePopovers();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  menu.innerHTML = `<button data-a="profile">View Profile</button><button data-a="dm">Send Message</button><button data-a="mention">Mention</button>`;
  menu.querySelectorAll('button').forEach(b => b.addEventListener('click', async () => {
    menu.remove();
    if (b.dataset.a === 'profile') openProfile(m);
    if (b.dataset.a === 'dm') startDM(m.id);
    if (b.dataset.a === 'mention') { const ta = $('message-input'); ta.value += '@' + m.username + ' '; ta.focus(); }
  }));
  document.body.appendChild(menu);
}

/* ============================================================
   MODALS
   ============================================================ */
function openModal(html, opts = {}) {
  const overlay = $('modal-overlay');
  const modal = $('modal');
  modal.className = 'modal' + (opts.wide ? ' wide' : '');
  modal.innerHTML = html;
  overlay.classList.remove('hidden');
}
function closeModal() { $('modal-overlay').classList.add('hidden'); $('modal').innerHTML = ''; }

function openCreateServer() {
  openModal(`
    <h3>Create a Server</h3>
    <p class="msub">Your server is where you and your friends hang out. Make yours and start talking.</p>
    <div class="field"><label>Server Name <span class="req">*</span></label>
      <input id="cs-name" placeholder="My Awesome Server" maxlength="40"></div>
    <div class="field"><label>Server Icon (emoji, optional)</label>
      <input id="cs-icon" placeholder="🚀" maxlength="2"></div>
    <div class="modal-actions">
      <button class="btn secondary" id="cs-cancel">Cancel</button>
      <button class="btn" id="cs-create">Create Server</button>
    </div>`);
  $('cs-cancel').addEventListener('click', closeModal);
  $('cs-create').addEventListener('click', async () => {
    const name = $('cs-name').value.trim();
    const icon = $('cs-icon').value.trim();
    if (!name) { toast('Server name required', 'error'); return; }
    try {
      const { server } = await api('/api/servers', { method: 'POST', body: JSON.stringify({ name, icon }) });
      closeModal(); await loadServers(); openServer(server.id);
      toast('Server created! 🎉', 'success');
    } catch (e) { toast(e.message, 'error'); }
  });
  $('cs-name').focus();
}

function openJoinServer(prefill) {
  openModal(`
    <h3>Join a Server</h3>
    <p class="msub">Enter an invite code or link below to join an existing server.</p>
    <div class="field"><label>Invite Code or Link</label>
      <input id="js-invite" placeholder="Paste invite code or link" value="${escapeHtml(prefill || '')}"></div>
    <div class="modal-actions">
      <button class="btn secondary" id="js-cancel">Cancel</button>
      <button class="btn" id="js-join">Join Server</button>
    </div>`);
  $('js-cancel').addEventListener('click', closeModal);
  $('js-join').addEventListener('click', async () => {
    const invite = $('js-invite').value.trim();
    if (!invite) { toast('Invite required', 'error'); return; }
    try {
      const { server } = await api('/api/servers/join', { method: 'POST', body: JSON.stringify({ invite }) });
      closeModal(); await loadServers(); openServer(server.id);
      toast('Joined ' + server.name + '!', 'success');
    } catch (e) { toast(e.message, 'error'); }
  });
  $('js-invite').focus();
}

function openCreateChannel(type) {
  openModal(`
    <h3>Create ${type === 'voice' ? 'Voice' : 'Text'} Channel</h3>
    <p class="msub">in ${escapeHtml(state.server ? state.server.name : '')}</p>
    <div class="field"><label>Channel Name <span class="req">*</span></label>
      <input id="cc-name" placeholder="${type === 'voice' ? 'Lounge' : 'new-channel'}" maxlength="40"></div>
    <div class="field"><label>Topic (optional)</label>
      <input id="cc-topic" placeholder="What's this channel about?"></div>
    <div class="modal-actions">
      <button class="btn secondary" id="cc-cancel">Cancel</button>
      <button class="btn" id="cc-create">Create Channel</button>
    </div>`);
  $('cc-cancel').addEventListener('click', closeModal);
  $('cc-create').addEventListener('click', async () => {
    const name = $('cc-name').value.trim().toLowerCase().replace(/\s+/g, '-');
    const topic = $('cc-topic').value.trim();
    if (!name) { toast('Channel name required', 'error'); return; }
    try {
      await api('/api/servers/' + state.server.id + '/channels', { method: 'POST', body: JSON.stringify({ name, type, topic }) });
      closeModal();
      const data = await api('/api/servers/' + state.server.id);
      state.channels = data.channels; renderChannelList();
      const created = data.channels.find(c => c.name === name && c.type === type);
      if (created && type === 'text') openChannel(created.id);
      toast('Channel created!', 'success');
    } catch (e) { toast(e.message, 'error'); }
  });
  $('cc-name').focus();
}

async function openNewDM() {
  openModal(`
    <h3>Start a Conversation</h3>
    <p class="msub">Search for a user by username or tag (e.g. name#1234).</p>
    <div class="field"><label>Find a user</label>
      <input id="dm-search" placeholder="Search users…" autocomplete="off"></div>
    <div id="dm-results" style="max-height:280px;overflow-y:auto;margin-top:8px"></div>
    <div class="modal-actions"><button class="btn secondary" id="dm-cancel">Close</button></div>`);
  $('dm-cancel').addEventListener('click', closeModal);
  const doSearch = async (q) => {
    const { users } = await api('/api/users?q=' + encodeURIComponent(q || ''));
    const box = $('dm-results');
    box.innerHTML = users.filter(u => u.id !== me.id).map(u => `
      <div class="member" data-uid="${u.id}" style="border-radius:6px">
        ${avatarHTML(u, 36, u.status || 'offline')}
        <div><div class="mname">${escapeHtml(u.username)}<span class="mtag">#${u.discriminator}</span></div></div>
      </div>`).join('') || '<p style="color:var(--text-muted);font-size:14px;padding:8px">No users found.</p>';
    box.querySelectorAll('.member').forEach(row => row.addEventListener('click', () => {
      const u = users.find(x => x.id === row.dataset.uid);
      closeModal(); startDM(u.id);
    }));
  };
  $('dm-search').addEventListener('input', (e) => doSearch(e.target.value));
  doSearch('');
  $('dm-search').focus();
}

async function startDM(userId) {
  try {
    const { dm } = await api('/api/dms', { method: 'POST', body: JSON.stringify({ userId }) });
    await loadDMs();
    const found = state.dms.find(d => d.id === dm.id) || dm;
    openDM(found);
  } catch (e) { toast(e.message, 'error'); }
}

function openProfile(user, opts = {}) {
  const isMe = user.id === me.id;
  const bannerStyle = user.banner_url ? `background-image:url('${escapeHtml(user.banner_url)}')` : `background:${user.accent_color || '#5865F2'}`;
  const memberSince = new Date(user.created_at).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
  openModal(`
    <div class="profile-card">
      <div class="profile-banner" style="${bannerStyle}">${isMe ? '<span class="edit-banner" id="edit-banner-btn">Change Banner</span>' : ''}</div>
      <div class="profile-body">
        <div class="profile-avatar" id="profile-avatar-slot" style="display:inline-block">${avatarHTML(user, 80, user.status || 'offline')}</div>
        <div class="profile-name">${escapeHtml(user.username)}</div>
        <div class="profile-tag">${escapeHtml(fullTag(user))}</div>
        ${user.bio ? `<div class="profile-section"><h5>About Me</h5><p>${escapeHtml(user.bio)}</p></div>` : ''}
        <div class="profile-section"><h5>Member Since</h5><p>${memberSince}</p></div>
        <div class="profile-section"><h5>Accent Color</h5><div class="profile-accent" style="background:${user.accent_color || '#5865F2'}"></div></div>
      </div>
    </div>
    <div class="modal-actions">
      ${isMe ? '<button class="btn" id="pf-edit">Edit Profile</button>' : '<button class="btn" id="pf-dm">Send Message</button><button class="btn secondary" id="pf-close">Close</button>'}
    </div>`, { wide: false });
  if (isMe) {
    $('pf-edit').addEventListener('click', openSettings);
    $('edit-banner-btn').addEventListener('click', () => openSettings());
  } else {
    $('pf-dm').addEventListener('click', () => { closeModal(); startDM(user.id); });
    $('pf-close').addEventListener('click', closeModal);
  }
}

function openSettings() {
  const u = me;
  openModal(`
    <h3>My Account</h3>
    <p class="msub">${escapeHtml(fullTag(u))}</p>
    <div class="field"><label>Display Tag (read-only)</label><input value="${escapeHtml(fullTag(u))}" disabled></div>
    <div class="field"><label>Avatar Emoji</label><input id="set-avatar" maxlength="2" value="${escapeHtml(u.avatar || '')}" placeholder="😎"></div>
    <div class="field"><label>Avatar Image</label>
      <input type="file" id="set-avatar-file" accept="image/*">
      <div class="hint">Upload a profile picture (overrides emoji).</div></div>
    <div class="field"><label>Banner Image</label>
      <input type="file" id="set-banner-file" accept="image/*">
      <div class="hint">Upload a banner for your profile.</div></div>
    <div class="field"><label>Accent Color</label><input type="color" id="set-accent" value="${u.accent_color || '#5865F2'}" style="height:44px;padding:4px"></div>
    <div class="field"><label>About Me</label><textarea id="set-bio" maxlength="190" placeholder="Tell people about yourself">${escapeHtml(u.bio || '')}</textarea></div>
    <div class="field"><label>Status</label>
      <select id="set-status">
        <option value="online">Online</option>
        <option value="idle">Idle</option>
        <option value="dnd">Do Not Disturb</option>
        <option value="offline">Invisible</option>
      </select></div>
    <div class="modal-actions">
      <button class="btn secondary" id="set-logout">Log Out</button>
      <button class="btn secondary" id="set-cancel">Cancel</button>
      <button class="btn" id="set-save">Save Changes</button>
    </div>`);
  $('set-status').value = u.status || 'online';
  $('set-cancel').addEventListener('click', closeModal);
  $('set-logout').addEventListener('click', logout);

  let newAvatarUrl = u.avatar_url, newBannerUrl = u.banner_url;
  $('set-avatar-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    try { const d = await api('/api/upload', { method: 'POST', body: fd }); newAvatarUrl = d.url; toast('Avatar uploaded', 'success'); } catch (err) { toast(err.message, 'error'); }
  });
  $('set-banner-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    try { const d = await api('/api/upload', { method: 'POST', body: fd }); newBannerUrl = d.url; toast('Banner uploaded', 'success'); } catch (err) { toast(err.message, 'error'); }
  });
  $('set-save').addEventListener('click', async () => {
    const body = {
      avatar: $('set-avatar').value.trim() || null,
      avatar_url: newAvatarUrl || null,
      banner_url: newBannerUrl || null,
      accent_color: $('set-accent').value,
      bio: $('set-bio').value.trim(),
      status: $('set-status').value
    };
    try {
      const { user } = await api('/api/me', { method: 'PATCH', body: JSON.stringify(body) });
      me = user; localStorage.setItem('cr_user', JSON.stringify(me));
      renderMe(); closeModal(); toast('Profile updated!', 'success');
    } catch (e) { toast(e.message, 'error'); }
  });
}

function serverMenu(e) {
  if (!state.server) return;
  closePopovers();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  const rect = $('sidebar-header').getBoundingClientRect();
  menu.style.left = rect.left + 'px';
  menu.style.top = (rect.bottom + 4) + 'px';
  const isOwner = state.server.owner_id === me.id;
  menu.innerHTML = `
    <button data-a="invite">Invite People</button>
    <button data-a="channel">Create Channel</button>
    <button data-a="settings">Server Settings</button>
    <button data-a="leave" class="danger">Leave Server</button>
    ${isOwner ? '<button data-a="delete" class="danger">Delete Server</button>' : ''}`;
  menu.querySelectorAll('button').forEach(b => b.addEventListener('click', async () => {
    menu.remove();
    const a = b.dataset.a;
    if (a === 'invite') {
      const link = `${location.origin}/app.html?invite=${state.server.id}`;
      try { await navigator.clipboard.writeText(link); toast('Invite link copied! 📋', 'success'); }
      catch (err) { prompt('Copy this invite link:', link); }
    }
    if (a === 'channel') openCreateChannel('text');
    if (a === 'settings') openServerSettings();
    if (a === 'leave') {
      if (!confirm('Leave ' + state.server.name + '?')) return;
      toast('Leaving is not supported in this demo yet');
    }
    if (a === 'delete') {
      if (!confirm('Delete ' + state.server.name + '? This cannot be undone.')) return;
      toast('Deleting is not supported in this demo yet');
    }
  }));
  document.body.appendChild(menu);
}

function openServerSettings() {
  const s = state.server;
  openModal(`
    <h3>Server Settings</h3>
    <p class="msub">${escapeHtml(s.name)}</p>
    <div class="field"><label>Server Name</label><input value="${escapeHtml(s.name)}" disabled></div>
    <div class="field"><label>Invite Link</label><input value="${location.origin}/app.html?invite=${s.id}" readonly></div>
    <div class="field"><label>Members</label><input value="${state.members.length} members" disabled></div>
    <div class="modal-actions"><button class="btn" id="ss-close">Done</button></div>`);
  $('ss-close').addEventListener('click', closeModal);
}

/* ============================================================
   GLOBAL EVENTS
   ============================================================ */
function bindGlobalEvents() {
  $('rail-home').addEventListener('click', showHome);
  $('rail-add').addEventListener('click', openCreateServer);
  $('rail-explore').addEventListener('click', () => openJoinServer());
  $('sidebar-header').addEventListener('click', serverMenu);
  $('user-panel-me').addEventListener('click', () => openProfile(me));
  $('btn-settings').addEventListener('click', openSettings);
  $('btn-mic').addEventListener('click', () => toast('Voice features coming soon 🎤'));
  $('hdr-members').addEventListener('click', () => { state.showMembers = !state.showMembers; renderMembers(); });
  $('hdr-pins').addEventListener('click', () => toast('Pinned messages coming soon 📌'));
  $('hdr-search').addEventListener('click', () => toast('Search coming soon 🔍'));
  const ec = $('empty-create'); if (ec) ec.addEventListener('click', openCreateServer);

  const input = $('message-input');
  let typingSent = 0;
  input.addEventListener('input', () => {
    autoGrow(input);
    const now = Date.now();
    if (now - typingSent > 2000) { typingSent = now; emitTyping(); }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  $('send-btn').addEventListener('click', sendMessage);
  $('attach-btn').addEventListener('click', () => $('file-input').click());
  $('emoji-btn').addEventListener('click', openEmojiPickerForInput);
  $('file-input').addEventListener('change', (e) => { handleFile(e.target.files[0]); e.target.value = ''; });

  // drag & drop
  const chat = $('chat');
  chat.addEventListener('dragover', (e) => { e.preventDefault(); });
  chat.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });

  // paste image
  input.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) if (it.type.startsWith('image/')) { handleFile(it.getAsFile()); }
  });

  $('modal-overlay').addEventListener('click', (e) => { if (e.target.id === 'modal-overlay') closeModal(); });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.emoji-picker') && !e.target.closest('.context-menu') &&
        !e.target.closest('.msg-toolbar') && !e.target.closest('#emoji-btn')) closePopovers();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closePopovers(); closeModal(); } });
}

/* ---------------- Invite handling ---------------- */
async function handleInviteParam() {
  const params = new URLSearchParams(location.search);
  const invite = params.get('invite');
  if (!invite) return;
  history.replaceState({}, '', location.pathname);
  if (state.servers.some(s => s.id === invite)) { openServer(invite); return; }
  try {
    const { server } = await api('/api/servers/join', { method: 'POST', body: JSON.stringify({ invite }) });
    await loadServers(); openServer(server.id);
    toast('Joined ' + server.name + '!', 'success');
  } catch (e) { openJoinServer(invite); }
}

/* ---------------- Start ---------------- */
init().then(handleInviteParam).catch(err => { console.error(err); toast(err.message, 'error'); });
