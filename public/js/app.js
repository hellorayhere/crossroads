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

/* Emoji set is used only for message content and reactions (a native chat feature). */
const EMOJIS = ['\u{1F600}','\u{1F602}','\u{1F972}','\u{1F60D}','\u{1F60E}','\u{1F914}','\u{1F634}','\u{1F973}','\u{1F62D}','\u{1F621}','\u{1F44D}','\u{1F44E}','\u{1F44F}','\u{1F64F}','\u{1F525}','\u{1F4AF}','\u{2728}','\u{1F389}','\u{2764}\u{FE0F}','\u{1F49C}','\u{1F499}','\u{1F49A}','\u{1F63A}','\u{1F436}','\u{1F355}','\u{1F354}','\u{2615}','\u{1F3AE}','\u{1F3B5}','\u{1F680}','\u{26A1}','\u{1F31F}','\u{1F440}','\u{1F92F}','\u{1F605}','\u{1F64C}','\u{1F91D}','\u{1F4AA}','\u{1F9E0}','\u{1F984}'];

/* Palette used for banner / accent selection. */
const PALETTE = ['#5865F2','#3BA55D','#FAA81A','#ED4245','#EB459E','#9B59B6','#1ABC9C','#E67E22','#3498DB','#95A5A6','#2B2D31','#111214'];

/* Relationship labels used across the friends system. */
const REL_LABEL = {
  none: 'Add Friend',
  pending_outgoing: 'Cancel Request',
  pending_incoming: 'Accept Request',
  friends: 'Friends',
  blocked: 'Blocked'
};

/* ---------------- DOM helpers ---------------- */
const $ = (id) => document.getElementById(id);
function icon(name, style = 'solid') { return `<i class="fa-${style} ${name}"></i>`; }

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
function statusLabel(s) { return { online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb', offline: 'Invisible' }[s] || 'Offline'; }

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
  await loadFriends();
  await loadDMs();
  showHome();
  bindGlobalEvents();
}

function renderMe(u = me) {
  const slot = $('my-avatar');
  if (slot) slot.outerHTML = avatarHTML(u, 32, u.status || 'online').replace('class="avatar"', 'class="avatar" id="my-avatar"');
  $('my-username').textContent = u.display_name || u.username;
  $('my-tag').textContent = '#' + u.discriminator;
}

/* Live preview of the signed-in user's profile across the whole UI.
   `patch` is a partial user object; it is merged over the current `me`.
   This never hits the server — it only reflects changes instantly. */
function previewSelf(patch) {
  const p = Object.assign({}, me, patch);
  renderMe(p);
  const nav = document.querySelector('#settings-nav .pnav-preview');
  if (nav) {
    const av = nav.querySelector('.pnav-avatar');
    if (av) av.innerHTML = avatarHTML(p, 40, p.status || 'online');
    const n1 = nav.querySelector('.n1');
    if (n1) n1.textContent = p.display_name || p.username;
    const n2 = nav.querySelector('.n2');
    if (n2) n2.textContent = fullTag(p);
  }
  const sa = $('sa-avatar');
  if (sa) sa.innerHTML = avatarHTML(p, 80, p.status || 'online');
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
    if (state.view === 'friends') renderFriendsView();
  });
  socket.on('friend_update', (data) => {
    loadFriends();
    if (data.type === 'request') toast((data.user.display_name || data.user.username) + ' sent you a friend request', 'success');
    if (data.type === 'accepted') toast('You are now friends with ' + (data.user.display_name || data.user.username), 'success');
    if (data.type === 'removed') toast((data.user.display_name || data.user.username) + ' removed you as a friend');
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
  const friendsBtn = document.createElement('div');
  friendsBtn.className = 'dm-item friends-entry' + (state.view === 'friends' ? ' active' : '');
  friendsBtn.id = 'friends-entry';
  const pendingCount = (state.friends && state.friends.incoming) ? state.friends.incoming.length : 0;
  friendsBtn.innerHTML = `${icon('fa-user-group')}<span class="dm-name">Friends</span>${pendingCount ? `<span class="friend-badge">${pendingCount}</span>` : ''}`;
  friendsBtn.addEventListener('click', openFriends);
  list.appendChild(friendsBtn);

  const cat = document.createElement('div');
  cat.className = 'channel-category';
  cat.innerHTML = `${icon('fa-caret-down', 'solid')} Direct Messages`;
  list.appendChild(cat);
  for (const d of state.dms) {
    const item = document.createElement('div');
    item.className = 'dm-item' + (state.dm && state.dm.id === d.id ? ' active' : '');
    item.innerHTML = `${avatarHTML(d.user, 32, d.user.status || 'offline')}<span class="dm-name">${escapeHtml(d.user ? (d.user.display_name || d.user.username) : 'Unknown')}</span>`;
    item.addEventListener('click', () => openDM(d));
    list.appendChild(item);
  }
  const add = document.createElement('div');
  add.className = 'dm-item';
  add.innerHTML = `<div class="avatar" style="width:32px;height:32px;font-size:14px;background:#5865f2">${icon('fa-plus')}</div><span class="dm-name">Start a conversation</span>`;
  add.addEventListener('click', openNewDM);
  list.appendChild(add);
}

async function openDM(d) {
  state.server = null; state.channel = null; state.view = 'home';
  if (state.dm && state.dm.id !== d.id) socket.emit('leave_dm', state.dm.id);
  state.dm = d;
  state.usersCache[d.user.id] = d.user;
  renderRail();
  $('rail-home').classList.add('active');
  $('sidebar-name').textContent = 'Direct Messages';
  renderDMList();
  $('chat-hash').style.display = 'none';
  $('chat-title').textContent = d.user.display_name || d.user.username;
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
   FRIENDS
   ============================================================ */
async function loadFriends() {
  try {
    const data = await api('/api/relationships');
    state.friends = {
      friends: data.friends || [],
      incoming: data.incoming || [],
      outgoing: data.outgoing || [],
      blocked: data.blocked || []
    };
    for (const u of [...state.friends.friends, ...state.friends.incoming, ...state.friends.outgoing, ...state.friends.blocked]) {
      state.usersCache[u.id] = u;
    }
  } catch (e) { /* ignore */ }
}

async function openFriends() {
  state.server = null; state.channel = null; state.view = 'friends';
  if (state.dm) { socket.emit('leave_dm', state.dm.id); state.dm = null; }
  renderRail();
  $('rail-home').classList.add('active');
  $('sidebar-name').textContent = 'Direct Messages';
  $('chat-hash').style.display = 'none';
  $('chat-title').textContent = 'Friends';
  $('chat-topic').textContent = '';
  $('members').innerHTML = '';
  $('composer').classList.add('hidden');
  await loadFriends();
  renderDMList();
  renderFriendsView();
}

function emptyFriends(msg) { return `<div class="fr-empty">${msg}</div>`; }

function friendRow(u, kind) {
  const name = escapeHtml(u.display_name || u.username);
  const status = u.status === 'offline' ? 'Offline' : statusLabel(u.status);
  let actions = '';
  if (kind === 'friend') {
    actions = `<button class="fr-act" data-fr-msg="${u.id}" title="Message">${icon('fa-comment')}</button>
               <button class="fr-act" data-fr-act="remove" data-uid="${u.id}" title="Remove Friend">${icon('fa-user-minus')}</button>`;
  } else if (kind === 'incoming') {
    actions = `<button class="fr-act ok" data-fr-act="accept" data-uid="${u.id}" title="Accept">${icon('fa-check')}</button>
               <button class="fr-act no" data-fr-act="decline" data-uid="${u.id}" title="Decline">${icon('fa-xmark')}</button>`;
  } else if (kind === 'outgoing') {
    actions = `<button class="fr-act" data-fr-act="cancel" data-uid="${u.id}" title="Cancel Request">${icon('fa-xmark')}</button>`;
  } else if (kind === 'blocked') {
    actions = `<button class="fr-act ok" data-fr-act="unblock" data-uid="${u.id}" title="Unblock">${icon('fa-unlock')}</button>`;
  }
  return `<div class="fr-row" data-uid="${u.id}">
    ${avatarHTML(u, 32, u.status || 'offline')}
    <div class="fr-info"><div class="fr-name">${name}<span class="fr-tag">#${u.discriminator}</span></div><div class="fr-status">${status}</div></div>
    <div class="fr-actions">${actions}</div>
  </div>`;
}

function renderFriendsView() {
  const box = $('messages');
  const f = state.friends;
  const tab = state.friendsTab;
  const counts = {
    online: f.friends.filter(x => x.status !== 'offline').length,
    all: f.friends.length,
    pending: f.incoming.length + f.outgoing.length,
    blocked: f.blocked.length
  };
  const tabBtn = (id, label, count) =>
    `<div class="fr-tab${tab === id ? ' active' : ''}" data-tab="${id}">${label}${count != null ? `<span class="fr-count">${count}</span>` : ''}</div>`;

  let body = '';
  if (tab === 'add') {
    body = `<div class="fr-add-wrap">
      <h4>Add Friend</h4>
      <p>You can add friends with their username. It is case sensitive.</p>
      <div class="fr-add-row">
        <input id="fr-add-input" placeholder="You can add friends with their username." autocomplete="off">
        <button class="btn" id="fr-add-btn">Send Friend Request</button>
      </div>
      <div class="fr-add-hint" id="fr-add-hint"></div>
    </div>`;
  } else if (tab === 'pending') {
    const inc = f.incoming.map(u => friendRow(u, 'incoming')).join('');
    const out = f.outgoing.map(u => friendRow(u, 'outgoing')).join('');
    body = `<div class="fr-cat">Incoming Requests — ${f.incoming.length}</div>${inc || emptyFriends('No incoming requests.')}
            <div class="fr-cat">Outgoing Requests — ${f.outgoing.length}</div>${out || emptyFriends('No outgoing requests.')}`;
  } else if (tab === 'blocked') {
    body = f.blocked.length ? f.blocked.map(u => friendRow(u, 'blocked')).join('') : emptyFriends('No blocked users.');
  } else {
    let list = f.friends;
    if (tab === 'online') list = list.filter(x => x.status !== 'offline');
    body = list.length ? list.map(u => friendRow(u, 'friend')).join('')
      : emptyFriends(tab === 'online' ? 'No one is online right now.' : 'No friends yet. Add some!');
  }

  box.innerHTML = `<div class="friends-view">
    <div class="fr-head">
      <div class="fr-tabs">
        ${tabBtn('online', 'Online', counts.online)}
        ${tabBtn('all', 'All', counts.all)}
        ${tabBtn('pending', 'Pending', counts.pending)}
        ${tabBtn('blocked', 'Blocked', counts.blocked)}
      </div>
      <button class="fr-add-friend${tab === 'add' ? ' active' : ''}" data-tab="add">${icon('fa-user-plus')} Add Friend</button>
    </div>
    <div class="fr-body">${body}</div>
  </div>`;

  box.querySelectorAll('.fr-tab, .fr-add-friend').forEach(el =>
    el.addEventListener('click', () => { state.friendsTab = el.dataset.tab; renderFriendsView(); }));
  box.querySelectorAll('.fr-info').forEach(el =>
    el.addEventListener('click', () => { const u = state.usersCache[el.closest('.fr-row').dataset.uid]; if (u) openProfile(u); }));
  box.querySelectorAll('[data-fr-act]').forEach(btn =>
    btn.addEventListener('click', (e) => { e.stopPropagation(); friendAction(btn.dataset.frAct, btn.dataset.uid); }));
  box.querySelectorAll('[data-fr-msg]').forEach(btn =>
    btn.addEventListener('click', (e) => { e.stopPropagation(); startDM(btn.dataset.frMsg); }));

  const ai = $('fr-add-input');
  if (ai) {
    ai.focus();
    const send = () => addFriendByTag(ai.value.trim());
    $('fr-add-btn').addEventListener('click', send);
    ai.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  }
}

function refreshFriendCounts() {
  const f = state.friends; if (!f) return;
  const counts = {
    online: f.friends.filter(x => x.status !== 'offline').length,
    all: f.friends.length,
    pending: f.incoming.length + f.outgoing.length,
    blocked: f.blocked.length
  };
  document.querySelectorAll('.fr-tab').forEach(el => {
    const c = el.querySelector('.fr-count');
    if (c && counts[el.dataset.tab] != null) c.textContent = counts[el.dataset.tab];
  });
}

async function addFriendByTag(tag) {
  const hint = $('fr-add-hint');
  if (!tag) { if (hint) hint.textContent = 'Enter a username to add a friend.'; return; }
  try {
    const res = await api('/api/friends/request', { method: 'POST', body: JSON.stringify({ tag }) });
    const msg = res.status === 'friends' ? 'You are now friends!' : 'Friend request sent!';
    if (hint) hint.textContent = msg;
    toast(msg, 'success');
    await loadFriends(); renderDMList(); refreshFriendCounts();
    const ai = $('fr-add-input'); if (ai) ai.value = '';
  } catch (e) {
    if (hint) hint.textContent = e.message;
    toast(e.message, 'error');
  }
}

const FRIEND_ACTION_MSG = {
  accept: 'Friend request accepted',
  decline: 'Friend request ignored',
  cancel: 'Friend request cancelled',
  remove: 'Friend removed',
  block: 'User blocked',
  unblock: 'User unblocked'
};

async function friendAction(act, uid) {
  try {
    if (act === 'accept') await api('/api/friends/accept', { method: 'POST', body: JSON.stringify({ userId: uid }) });
    else if (act === 'decline') await api('/api/friends/decline', { method: 'POST', body: JSON.stringify({ userId: uid }) });
    else if (act === 'cancel') await api('/api/friends/cancel', { method: 'POST', body: JSON.stringify({ userId: uid }) });
    else if (act === 'remove') { if (!confirm('Remove this friend?')) return; await api('/api/friends/' + uid, { method: 'DELETE' }); }
    else if (act === 'block') { if (!confirm('Block this user? They will be removed from your friends.')) return; await api('/api/blocks', { method: 'POST', body: JSON.stringify({ userId: uid }) }); }
    else if (act === 'unblock') await api('/api/blocks/' + uid, { method: 'DELETE' });
    await loadFriends(); renderDMList();
    if (state.view === 'friends') renderFriendsView();
    if (FRIEND_ACTION_MSG[act]) toast(FRIEND_ACTION_MSG[act], 'success');
  } catch (e) { toast(e.message, 'error'); }
}

/* ============================================================
   SERVERS
   ============================================================ */
async function openServer(id) {
  const data = await api('/api/servers/' + id);
  state.view = 'home';
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
  tcat.innerHTML = `${icon('fa-caret-down')} Text Channels`;
  list.appendChild(tcat);
  for (const c of textChannels) list.appendChild(channelRow(c));
  const tadd = document.createElement('div');
  tadd.className = 'channel-add';
  tadd.innerHTML = `${icon('fa-plus')} Create Channel`;
  tadd.addEventListener('click', () => openCreateChannel('text'));
  list.appendChild(tadd);

  const vcat = document.createElement('div');
  vcat.className = 'channel-category';
  vcat.innerHTML = `${icon('fa-caret-down')} Voice Channels`;
  list.appendChild(vcat);
  for (const c of voiceChannels) list.appendChild(channelRow(c));
  const vadd = document.createElement('div');
  vadd.className = 'channel-add';
  vadd.innerHTML = `${icon('fa-plus')} Create Channel`;
  vadd.addEventListener('click', () => openCreateChannel('voice'));
  list.appendChild(vadd);
}

function channelRow(c) {
  const row = document.createElement('div');
  row.className = 'channel' + (state.channel && state.channel.id === c.id ? ' active' : '');
  row.dataset.cid = c.id;
  const ic = c.type === 'voice' ? icon('fa-volume-high') : icon('fa-hashtag');
  row.innerHTML = `<span class="hash">${ic}</span><span class="ch-name">${escapeHtml(c.name)}</span>`;
  row.addEventListener('click', () => {
    if (c.type === 'voice') { toast('Voice channels are not available yet'); return; }
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
  $('chat-hash').innerHTML = icon('fa-hashtag');
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
    cat.textContent = `${label} \u2014 ${arr.length}`;
    wrap.appendChild(cat);
    for (const m of arr) {
      const row = document.createElement('div');
      row.className = 'member' + (m.status === 'offline' ? ' offline' : '');
      row.dataset.uid = m.id;
      const crown = (state.server.owner_id === m.id) ? `<span class="owner-crown">${icon('fa-crown')}</span>` : '';
      row.innerHTML = `${avatarHTML(m, 32, m.status || 'offline')}<span class="mname">${escapeHtml(m.display_name || m.username)}${crown}</span>`;
      row.addEventListener('click', () => openProfile(m));
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
  const box = $('messages');
  box.style.padding = ''; box.style.overflow = '';
  box.innerHTML = `<div class="empty-state"><div class="inner">
    <h2>Welcome to Crossroads</h2>
    <p>${text || 'Select a server on the left or open a direct message to begin. You can also create your own server and invite others with a link.'}</p>
    <button class="btn" id="empty-create2">Create a Server</button>
  </div></div>`;
  const b = $('empty-create2'); if (b) b.addEventListener('click', openCreateServer);
}

function renderMessages() {
  const box = $('messages');
  box.style.padding = ''; box.style.overflow = '';
  box.innerHTML = '';
  const inner = document.createElement('div');
  inner.className = 'messages-inner';
  inner.id = 'messages-inner';

  if (state.channel) {
    const intro = document.createElement('div');
    intro.className = 'channel-intro';
    intro.innerHTML = `<div class="big-avatar">${icon('fa-hashtag')}</div><h2>Welcome to #${escapeHtml(state.channel.name)}</h2><p>This is the start of the #${escapeHtml(state.channel.name)} channel.</p>`;
    inner.appendChild(intro);
  } else if (state.dm) {
    const intro = document.createElement('div');
    intro.className = 'channel-intro';
    intro.innerHTML = `${avatarHTML(state.dm.user, 68)}<h2>${escapeHtml(state.dm.user.display_name || state.dm.user.username)}</h2><p>This is the beginning of your direct message history with <b>${escapeHtml(fullTag(state.dm.user))}</b>.</p>`;
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

function messageNode(m, grouped, animate) {
  const node = document.createElement('div');
  node.className = 'msg-group' + (grouped ? ' compact' : '') + (animate ? ' fade-in' : '');
  node.dataset.mid = m.id;
  node.dataset.uid = m.author.id;
  const a = m.author;
  const gutter = grouped
    ? `<div class="gutter"><span class="mini-time">${shortTime(m.created_at)}</span></div>`
    : `<div class="gutter">${avatarHTML(a, 40)}</div>`;
  const head = grouped ? '' : `<div class="head"><span class="author">${escapeHtml(a.display_name || a.username)}</span><span class="time">${formatTime(m.created_at)}</span></div>`;
  const toolbar = `<div class="msg-toolbar">
      <button data-act="react" title="Add Reaction">${icon('fa-face-smile', 'regular')}</button>
      <button data-act="reply" title="Reply">${icon('fa-reply')}</button>
      ${m.author.id === me.id ? `<button data-act="delete" title="Delete">${icon('fa-trash')}</button>` : ''}
    </div>`;
  node.innerHTML = `${toolbar}${gutter}<div class="body">${head}
    <div class="text" data-content>${formatContent(m.content)}</div>
    <div class="attachment-slot"></div>
    <div class="embed-slot"></div>
    <div class="reactions">${reactionsHTML(m.reactions)}</div>
  </div>`;

  const authorEl = node.querySelector('.author');
  if (authorEl) authorEl.addEventListener('click', () => openProfile(a));

  if (m.attachment_url) {
    node.querySelector('.attachment-slot').appendChild(attachmentNode(m));
  }
  const urls = extractUrls(m.content);
  if (urls.length) {
    const slot = node.querySelector('.embed-slot');
    urls.slice(0, 2).forEach(u => slot.appendChild(embedNode(u)));
  }
  node.querySelectorAll('.reaction').forEach(r => {
    r.addEventListener('click', () => toggleReaction(m.id, r.dataset.emoji));
  });
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
  inner.appendChild(messageNode(m, grouped, true));
  scrollToBottom();
}

function formatContent(text) {
  if (!text) return '';
  let html = escapeHtml(text);
  html = html.replace(/@([a-zA-Z0-9._]+)/g, (mt, name) => {
    const isMe = name.toLowerCase() === me.username.toLowerCase();
    return `<span class="mention${isMe ? ' me' : ''}">@${name}</span>`;
  });
  html = html.replace(/#([a-z0-9-]+)/g, '<span class="mention">#$1</span>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
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
    wrap.innerHTML = `<div class="file-card"><div class="fi">${icon('fa-file')}</div><div><a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(m.attachment_name || 'file')}</a><div class="fsize">Click to download</div></div></div>`;
  }
  return wrap;
}

function embedNode(url) {
  const wrap = document.createElement('div');
  wrap.className = 'embed';
  wrap.innerHTML = `<div class="embed-content"><div class="embed-site">Loading preview\u2026</div></div>`;
  api('/api/embed?url=' + encodeURIComponent(url)).then(data => {
    if (!data) return;
    const desc = data.description ? (data.description.length > 200 ? data.description.slice(0, 200) + '\u2026' : data.description) : '';
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
  lb.innerHTML = `<span class="close">&times;</span>` + (type === 'image' ? `<img src="${escapeHtml(url)}">` : `<video src="${escapeHtml(url)}" controls autoplay></video>`);
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
  bar.innerHTML = `<span class="typing-dots"><span></span><span></span><span></span></span> ${label}\u2026`;
}

/* ---------------- Attachments ---------------- */
async function handleFile(file) {
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) { toast('File too large (max 25MB)', 'error'); return; }
  const fd = new FormData();
  fd.append('file', file);
  toast('Uploading ' + file.name + '\u2026');
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
  const thumb = (a.type || '').startsWith('image/') ? `<img src="${escapeHtml(a.url)}">` : `<div class="fi" style="width:48px;height:48px;border-radius:6px;background:#5865f2;display:grid;place-items:center;color:#fff">${icon('fa-file')}</div>`;
  p.innerHTML = `${thumb}<span class="ap-name">${escapeHtml(a.name)}</span><button id="ap-remove">${icon('fa-xmark')}</button>`;
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
  picker.innerHTML = `<h4>Add a reaction</h4><div class="emoji-grid">${EMOJIS.map(e => `<button data-e="${e}">${e}</button>`).join('')}</div>`;
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
  document.querySelectorAll('.emoji-picker, .context-menu, .dropdown-menu').forEach(el => el.remove());
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

/* Small anchored dropdown used by the profile "more" button and the server header. */
function dropdownMenu(anchor, items) {
  closePopovers();
  const menu = document.createElement('div');
  menu.className = 'dropdown-menu';
  const rect = anchor.getBoundingClientRect();
  menu.innerHTML = items.map(it => `<button data-a="${it.action}"${it.danger ? ' class="danger"' : ''}>${it.icon ? icon(it.icon) + ' ' : ''}${escapeHtml(it.label)}</button>`).join('');
  document.body.appendChild(menu);
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let left = rect.left;
  let top = rect.bottom + 6;
  if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
  if (top + mh > window.innerHeight - 8) top = rect.top - mh - 6;
  menu.style.left = Math.max(8, left) + 'px';
  menu.style.top = Math.max(8, top) + 'px';
  menu.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    menu.remove();
    const item = items.find(x => x.action === b.dataset.a);
    if (item && item.onClick) item.onClick();
  }));
  return menu;
}

/* ============================================================
   MODALS
   ============================================================ */
function openModal(html, opts = {}) {
  const overlay = $('modal-overlay');
  const modal = $('modal');
  modal.className = opts.modalClass ? opts.modalClass : ('modal' + (opts.wide ? ' wide' : ''));
  modal.innerHTML = html;
  overlay.classList.remove('hidden');
}
function closeModal() { modalCloseGuard = null; $('modal-overlay').classList.add('hidden'); $('modal').innerHTML = ''; $('modal').className = 'modal'; }

/* When set, this function runs instead of closing the modal. It lets a panel
   (e.g. My Account) intercept the close and warn about unsaved changes. */
let modalCloseGuard = null;
function requestCloseModal() {
  if (typeof modalCloseGuard === 'function') { modalCloseGuard(); return; }
  closeModal();
}

/* Small "unsaved changes" confirmation shown above the settings modal. */
function showUnsavedDialog({ onSave, onDiscard }) {
  const existing = $('confirm-overlay');
  if (existing) existing.remove();
  const wrap = document.createElement('div');
  wrap.className = 'confirm-overlay';
  wrap.id = 'confirm-overlay';
  wrap.innerHTML = `
    <div class="confirm-box">
      <h3>Careful — you have unsaved changes!</h3>
      <p>Would you like to save your changes before leaving?</p>
      <div class="confirm-actions">
        <button class="btn" id="cu-save">Save Changes</button>
        <button class="btn secondary" id="cu-discard">Discard</button>
        <button class="btn ghost" id="cu-cancel">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  $('cu-cancel').addEventListener('click', close);
  $('cu-discard').addEventListener('click', () => { close(); if (onDiscard) onDiscard(); });
  $('cu-save').addEventListener('click', async () => {
    const btn = $('cu-save');
    btn.disabled = true; btn.textContent = 'Saving…';
    let ok = false;
    try { ok = await (onSave ? onSave() : true); } catch (e) { ok = false; }
    if (ok) close(); else { btn.disabled = false; btn.textContent = 'Save Changes'; }
  });
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
}

function openCreateServer() {
  openModal(`
    <h3>Create a Server</h3>
    <p class="msub">Your server is where you and your friends hang out. Make yours and start talking.</p>
    <div class="field"><label>Server Name <span class="req">*</span></label>
      <input id="cs-name" placeholder="My Server" maxlength="40"></div>
    <div class="field"><label>Server Icon (optional)</label>
      <input type="file" id="cs-icon-file" accept="image/*">
      <div class="hint">Upload an image to use as your server icon.</div></div>
    <div class="modal-actions">
      <button class="btn secondary" id="cs-cancel">Cancel</button>
      <button class="btn" id="cs-create">Create Server</button>
    </div>`);
  let iconUrl = null;
  $('cs-icon-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    try { const d = await api('/api/upload', { method: 'POST', body: fd }); iconUrl = d.url; toast('Icon uploaded', 'success'); }
    catch (err) { toast(err.message, 'error'); }
  });
  $('cs-cancel').addEventListener('click', closeModal);
  $('cs-create').addEventListener('click', async () => {
    const name = $('cs-name').value.trim();
    if (!name) { toast('Server name required', 'error'); return; }
    try {
      const { server } = await api('/api/servers', { method: 'POST', body: JSON.stringify({ name, icon_url: iconUrl }) });
      closeModal(); await loadServers(); openServer(server.id);
      toast('Server created', 'success');
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
      toast('Joined ' + server.name, 'success');
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
      <input id="cc-topic" placeholder="What is this channel about?"></div>
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
      toast('Channel created', 'success');
    } catch (e) { toast(e.message, 'error'); }
  });
  $('cc-name').focus();
}

async function openNewDM() {
  openModal(`
    <h3>Start a Conversation</h3>
    <p class="msub">Search for a user by username or tag (for example name#1234).</p>
    <div class="field"><label>Find a user</label>
      <input id="dm-search" placeholder="Search users" autocomplete="off"></div>
    <div id="dm-results" style="max-height:280px;overflow-y:auto;margin-top:8px"></div>
    <div class="modal-actions"><button class="btn secondary" id="dm-cancel">Close</button></div>`);
  $('dm-cancel').addEventListener('click', closeModal);
  const doSearch = async (q) => {
    const { users } = await api('/api/users?q=' + encodeURIComponent(q || ''));
    const box = $('dm-results');
    box.innerHTML = users.filter(u => u.id !== me.id).map(u => `
      <div class="member" data-uid="${u.id}" style="border-radius:6px">
        ${avatarHTML(u, 36, u.status || 'offline')}
        <div><div class="mname">${escapeHtml(u.display_name || u.username)}<span class="mtag">#${u.discriminator}</span></div></div>
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

/* ============================================================
   PROFILE MODAL (three-panel, mirrors the reference layout)
   ============================================================ */
async function openProfile(user, opts = {}) {
  const isMe = user.id === me.id;
  let relationship = isMe ? 'self' : 'none';
  let mutualServers = [];
  let mutualFriends = [];
  let note = '';
  try {
    const data = await api('/api/users/' + user.id);
    user = Object.assign({}, user, data.user);
    relationship = data.relationship || relationship;
    mutualServers = data.mutual_servers || [];
    mutualFriends = data.mutual_friends || [];
    note = data.note || '';
  } catch (e) { /* fall back to the object we were given */ }

  if (isMe) return renderOwnProfile(user);
  return renderOtherProfile(user, { relationship, mutualServers, mutualFriends, note });
}

/* ---------- Your own profile (unchanged three-panel feel, cleaned up) ---------- */
function renderOwnProfile(user) {
  const displayName = user.display_name || user.username;
  const bannerColor = user.banner_color || user.accent_color || '#5865F2';
  const bannerStyle = user.banner_url
    ? `background-image:url('${escapeHtml(user.banner_url)}')`
    : `background:${bannerColor}`;
  const memberSince = new Date(user.created_at).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
  const swatches = PALETTE.map(c => `<span class="pnav-swatch${bannerColor.toLowerCase() === c.toLowerCase() ? ' sel' : ''}" data-color="${c}" style="background:${c}"></span>`).join('');

  openModal(`
    <div class="profile-topbar">
      <div class="pt-title">${icon('fa-id-badge')} Your Profile</div>
      <button class="pt-close" id="pf-x">${icon('fa-xmark')}</button>
    </div>
    <div class="profile-body-grid">
      <div class="profile-nav">
        <div class="pnav-item">
          <div class="pnav-label">Avatar &amp; Description</div>
          <div class="pnav-preview">
            <div class="pnav-avatar">${avatarHTML(user, 40)}</div>
            <div class="pnav-text">
              <div class="n1">${escapeHtml(displayName)}</div>
              <div class="n2">${escapeHtml(user.bio || 'No description yet')}</div>
            </div>
          </div>
        </div>
        <div class="pnav-item">
          <div class="pnav-label">Banner Color</div>
          <div class="pnav-swatches" id="pf-swatches">${swatches}</div>
        </div>
        <div class="pnav-item">
          <div class="pnav-label">Display Name Style</div>
          <div class="pnav-namestyle" style="color:${escapeHtml(bannerColor)}">${escapeHtml(displayName)}</div>
        </div>
      </div>

      <div class="profile-content">
        <div class="profile-tabs">
          <div class="profile-tab active">Board</div>
        </div>
        <div class="profile-hero" style="${bannerStyle}">
          <button class="hero-edit" id="pf-banner">${icon('fa-image')} Change Banner</button>
        </div>
        <div class="profile-idcard">
          <div class="pic-avatar">${avatarHTML(user, 96, user.status || 'offline')}</div>
          <div class="pic-name">${escapeHtml(displayName)}</div>
          <div class="pic-tag">${escapeHtml(fullTag(user))}</div>
          <div class="pic-status"><span class="dot" style="background:${user.status === 'offline' ? '#80848e' : '#23a55a'}"></span>${escapeHtml(user.custom_status || statusLabel(user.status))}</div>
          ${user.pronouns ? `<div class="pic-date">${escapeHtml(user.pronouns)}</div>` : ''}
          <div class="pic-date">Member since ${memberSince}</div>
        </div>
        <div class="profile-actions-row">
          <button class="pa primary" id="pf-edit">Edit Profile</button>
          <button class="pa" id="pf-share">Share Profile</button>
        </div>
        <div class="profile-section-block">
          <h5>About Me</h5>
          <p>${escapeHtml(user.bio || 'You have not written a description yet.')}</p>
        </div>
        <div class="profile-section-block">
          <h5>Note</h5>
          <div class="profile-note"><span>${icon('fa-note-sticky')} Add a note</span><span class="pn-right">Private to only</span></div>
        </div>
      </div>
    </div>`, { modalClass: 'profile-modal' });

  $('pf-x').addEventListener('click', closeModal);
  $('pf-edit').addEventListener('click', () => openSettings('account'));
  $('pf-banner').addEventListener('click', () => openSettings('account'));
  $('pf-share').addEventListener('click', async () => {
    const link = location.origin + '/app.html';
    try { await navigator.clipboard.writeText(link); toast('Profile link copied', 'success'); }
    catch (e) { prompt('Copy your profile link:', link); }
  });
  document.querySelectorAll('#pf-swatches .pnav-swatch').forEach(sw => {
    sw.addEventListener('click', async () => {
      const color = sw.dataset.color;
      document.querySelectorAll('#pf-swatches .pnav-swatch').forEach(x => x.classList.toggle('sel', x === sw));
      const hero = document.querySelector('.profile-hero');
      if (hero && !user.banner_url) hero.style.background = color;
      const nameStyle = document.querySelector('.pnav-namestyle');
      if (nameStyle) nameStyle.style.color = color;
      try {
        const { user: updated } = await api('/api/me', { method: 'PATCH', body: JSON.stringify({ banner_color: color }) });
        me = updated; localStorage.setItem('cr_user', JSON.stringify(me)); renderMe();
        user.banner_color = color;
      } catch (e) { toast(e.message, 'error'); }
    });
  });
}

/* ---------- Someone else's profile (matches the reference layout) ---------- */
function renderOtherProfile(user, ctx) {
  const displayName = user.display_name || user.username;
  const accountCreated = new Date(user.created_at).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  const rel = ctx.relationship;
  const mutualServers = ctx.mutualServers || [];
  const mutualFriends = ctx.mutualFriends || [];
  const note = ctx.note || '';

  let addBtn;
  if (rel === 'friends') addBtn = `<button class="op-add friends" id="pf-add">${icon('fa-check')} <span>Friends</span></button>`;
  else if (rel === 'pending_outgoing') addBtn = `<button class="op-add pending" id="pf-add">${icon('fa-clock')} <span>Request Sent</span></button>`;
  else if (rel === 'pending_incoming') addBtn = `<button class="op-add accept" id="pf-add">${icon('fa-user-check')} <span>Accept Request</span></button>`;
  else if (rel === 'blocked') addBtn = `<button class="op-add blocked" id="pf-add" disabled>${icon('fa-ban')} <span>Blocked</span></button>`;
  else addBtn = `<button class="op-add" id="pf-add">${icon('fa-user-plus')} <span>Add Friend</span></button>`;

  const moreItems = [];
  if (rel === 'friends') moreItems.push({ action: 'remove', label: 'Remove Friend', icon: 'fa-user-minus', danger: true });
  if (rel === 'pending_outgoing') moreItems.push({ action: 'cancel', label: 'Cancel Request', icon: 'fa-xmark' });
  if (rel === 'pending_incoming') moreItems.push({ action: 'accept', label: 'Accept Request', icon: 'fa-check' });
  if (rel === 'blocked') moreItems.push({ action: 'unblock', label: 'Unblock', icon: 'fa-unlock' });
  else moreItems.push({ action: 'block', label: 'Block', icon: 'fa-ban', danger: true });
  moreItems.push({ action: 'dm', label: 'Message', icon: 'fa-comment' });

  openModal(`
    <div class="profile-topbar">
      <div class="pt-title">${icon('fa-id-badge')} ${escapeHtml(displayName)}</div>
      <button class="pt-close" id="pf-x">${icon('fa-xmark')}</button>
    </div>
    <div class="oprofile-body">
      <div class="oprofile-left">
        <div class="op-avatar">${avatarHTML(user, 120, user.status || 'offline')}</div>
        <div class="op-name">${escapeHtml(displayName)}</div>
        <div class="op-sub">${escapeHtml(user.custom_status || fullTag(user))}</div>
        <div class="op-actions">
          ${addBtn}
          <button class="op-more" id="pf-more" title="More Options">${icon('fa-ellipsis-vertical')}</button>
        </div>
        <div class="op-section">
          <div class="op-label">${icon('fa-calendar-days')} Member Since</div>
          <div class="op-dates"><div class="op-date">${accountCreated}</div></div>
        </div>
        <div class="op-section">
          <div class="op-label">${icon('fa-note-sticky')} Note</div>
          <div class="op-note" id="pf-note">
            ${note ? `<div class="op-note-text">${escapeHtml(note)}</div>` : `<div class="op-note-empty">${icon('fa-plus')} Click to add a note</div>`}
            <div class="op-note-hint">Note only visible to you</div>
          </div>
        </div>
      </div>
      <div class="oprofile-right">
        <div class="op-tabs">
          <div class="op-tab active" data-tab="activity">Activity</div>
          <div class="op-tab" data-tab="friends">${mutualFriends.length ? `${mutualFriends.length} Mutual Friend${mutualFriends.length > 1 ? 's' : ''}` : 'No Mutual Friends'}</div>
          <div class="op-tab" data-tab="servers">${mutualServers.length} Mutual Server${mutualServers.length === 1 ? '' : 's'}</div>
        </div>
        <div class="op-content" id="op-content"></div>
        <div class="op-footer">
          <button class="op-message" id="pf-dm">${icon('fa-comment')} Message</button>
        </div>
      </div>
    </div>`, { modalClass: 'oprofile-modal' });

  const renderTab = (tab) => {
    const content = $('op-content');
    if (tab === 'friends') {
      content.innerHTML = mutualFriends.length
        ? mutualFriends.map(u => `<div class="op-list-row">${avatarHTML(u, 32, u.status || 'offline')}<div><div class="olr-name">${escapeHtml(u.display_name || u.username)}</div><div class="olr-tag">${escapeHtml(fullTag(u))}</div></div></div>`).join('')
        : `<div class="op-empty"><div class="op-empty-ico">${icon('fa-user-group')}</div><h4>No Mutual Friends</h4><p>You and ${escapeHtml(displayName)} do not have any friends in common.</p></div>`;
    } else if (tab === 'servers') {
      content.innerHTML = mutualServers.length
        ? mutualServers.map(s => `<div class="op-list-row"><div class="op-server-ico">${s.icon_url ? `<img src="${escapeHtml(s.icon_url)}" alt="">` : escapeHtml((s.name || '?')[0].toUpperCase())}</div><div><div class="olr-name">${escapeHtml(s.name)}</div><div class="olr-tag">Mutual Server</div></div></div>`).join('')
        : `<div class="op-empty"><div class="op-empty-ico">${icon('fa-server')}</div><h4>No Mutual Servers</h4><p>You and ${escapeHtml(displayName)} are not in any servers together.</p></div>`;
    } else {
      content.innerHTML = `<div class="op-empty"><div class="op-empty-ico">${icon('fa-ghost')}</div><h4>${escapeHtml(displayName)} doesn't have any activity to share here</h4><p>When they start playing a game or listening to music, it will show up here.</p></div>`;
    }
  };
  renderTab('activity');

  $('pf-x').addEventListener('click', closeModal);
  document.querySelectorAll('.op-tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.op-tab').forEach(x => x.classList.toggle('active', x === t));
    renderTab(t.dataset.tab);
  }));
  $('pf-dm').addEventListener('click', () => { closeModal(); startDM(user.id); });
  $('pf-add').addEventListener('click', async () => {
    if (rel === 'friends') { closeModal(); startDM(user.id); return; }
    if (rel === 'pending_incoming') { await friendAction('accept', user.id); closeModal(); openProfile(user); return; }
    if (rel === 'pending_outgoing') { await friendAction('cancel', user.id); closeModal(); openProfile(user); return; }
    if (rel === 'blocked') return;
    try {
      const res = await api('/api/friends/request', { method: 'POST', body: JSON.stringify({ userId: user.id }) });
      toast(res.status === 'friends' ? 'You are now friends' : 'Friend request sent', 'success');
      await loadFriends(); renderDMList();
      closeModal(); openProfile(user);
    } catch (e) { toast(e.message, 'error'); }
  });
  $('pf-more').addEventListener('click', (e) => {
    e.stopPropagation();
    dropdownMenu($('pf-more'), moreItems.map(it => Object.assign({}, it, {
      onClick: async () => {
        if (it.action === 'dm') { closeModal(); startDM(user.id); return; }
        await friendAction(it.action, user.id);
        closeModal(); openProfile(user);
      }
    })));
  });
  $('pf-note').addEventListener('click', () => openNoteEditor(user, note));
}

function openNoteEditor(user, current) {
  openModal(`
    <h3>Note</h3>
    <p class="msub">Notes are only visible to you. Use them to remember details about ${escapeHtml(user.display_name || user.username)}.</p>
    <div class="field"><textarea id="note-text" maxlength="256" placeholder="Click to add a note">${escapeHtml(current || '')}</textarea></div>
    <div class="modal-actions">
      <button class="btn secondary" id="note-cancel">Cancel</button>
      <button class="btn" id="note-save">Save Note</button>
    </div>`);
  $('note-cancel').addEventListener('click', () => { closeModal(); openProfile(user); });
  $('note-save').addEventListener('click', async () => {
    try {
      await api('/api/notes/' + user.id, { method: 'PUT', body: JSON.stringify({ content: $('note-text').value.trim() }) });
      toast('Note saved', 'success');
      closeModal(); openProfile(user);
    } catch (e) { toast(e.message, 'error'); }
  });
  $('note-text').focus();
}

/* ============================================================
   SETTINGS MODAL (Discord-style two-panel)
   ============================================================ */
const SETTINGS_NAV = [
  { cat: 'User Settings' },
  { id: 'account', label: 'My Account' },
  { id: 'profiles', label: 'Profiles' },
  { id: 'privacy', label: 'Privacy & Safety' },
  { id: 'apps', label: 'Authorized Apps' },
  { id: 'devices', label: 'Devices' },
  { id: 'connections', label: 'Connections' },
  { cat: 'App Settings' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'voice', label: 'Voice & Video' },
  { id: 'keybinds', label: 'Keybinds' },
  { id: 'language', label: 'Language' }
];

let settingsUploads = { avatar_url: null, banner_url: null };
let settingsDirty = false;
let settingsSaveFn = null;

function openSettings(section) {
  const u = me;
  settingsDirty = false;
  settingsSaveFn = null;
  const nav = SETTINGS_NAV.map(item => {
    if (item.cat) return `<div class="sn-cat">${item.cat}</div>`;
    return `<div class="sn-item" data-sec="${item.id}">${item.label} <span class="chev">${icon('fa-chevron-right')}</span></div>`;
  }).join('') + `<div class="sn-item sn-danger" id="sn-logout">Log Out</div>`;

  openModal(`
    <div class="settings-body">
      <div class="settings-nav" id="settings-nav">
        <div class="pnav-item" style="margin-bottom:14px">
          <div class="pnav-preview">
            <div class="pnav-avatar">${avatarHTML(u, 40, u.status || 'online')}</div>
            <div class="pnav-text">
              <div class="n1">${escapeHtml(u.display_name || u.username)}</div>
              <div class="n2">${escapeHtml(fullTag(u))}</div>
            </div>
          </div>
        </div>
        ${nav}
      </div>
      <div class="settings-panel" id="settings-panel"></div>
    </div>
    <div class="settings-footer">
      <button class="btn secondary" id="set-logout">Log Out</button>
      <div style="flex:1"></div>
      <button class="btn" id="set-done">Done</button>
    </div>`, { modalClass: 'settings-modal' });

  const discardThen = (after) => {
    settingsDirty = false;
    previewSelf();                 // revert any live preview back to saved values
    if (after) after(); else closeModal();
  };
  const saveThen = async (after) => {
    const ok = settingsSaveFn ? await settingsSaveFn() : true;
    if (ok) { settingsDirty = false; if (after) after(); else closeModal(); }
    return ok;
  };
  const guardLogout = () => {
    if (settingsDirty) showUnsavedDialog({ onSave: () => saveThen(logout), onDiscard: () => discardThen(logout) });
    else logout();
  };

  modalCloseGuard = () => {
    if (!settingsDirty) { closeModal(); return; }
    showUnsavedDialog({
      onSave: () => saveThen(closeModal),
      onDiscard: () => discardThen(closeModal)
    });
  };

  $('set-done').addEventListener('click', requestCloseModal);
  $('set-logout').addEventListener('click', guardLogout);
  $('sn-logout').addEventListener('click', guardLogout);
  document.querySelectorAll('#settings-nav .sn-item[data-sec]').forEach(el => {
    el.addEventListener('click', () => renderSettings(el.dataset.sec));
  });
  renderSettings(section || 'account');
}

function renderSettings(section) {
  document.querySelectorAll('#settings-nav .sn-item[data-sec]').forEach(el => el.classList.toggle('active', el.dataset.sec === section));
  const panel = $('settings-panel');
  panel.innerHTML = settingsPanelHTML(section);
  if (section === 'account') wireAccountPanel();
  if (section === 'profiles') wireProfilesPanel();
  if (section === 'privacy' || section === 'appearance' || section === 'notifications') wireToggles();
}

function settingsPanelHTML(section) {
  const u = me;
  switch (section) {
    case 'account':
      return `
        <h4>My Account</h4>
        <div class="settings-avatar-row">
          <div id="sa-avatar">${avatarHTML(u, 80, u.status || 'online')}</div>
          <div class="sa-actions">
            <button id="sa-upload">Change Avatar</button>
            <button class="ghost" id="sa-remove">Remove Avatar</button>
            <input type="file" id="sa-file" accept="image/*" class="hidden">
          </div>
        </div>
        <div class="field"><label>Username</label>
          <input id="set-username" maxlength="32" value="${escapeHtml(u.username)}" autocomplete="off">
          <div class="hint" id="username-hint">Your unique tag is #${escapeHtml(u.discriminator)}</div>
        </div>
        <div class="field"><label>Display Name</label><input id="set-display" maxlength="32" value="${escapeHtml(u.display_name || u.username)}"></div>
        <div class="field"><label>Pronouns</label><input id="set-pronouns" maxlength="24" value="${escapeHtml(u.pronouns || '')}" placeholder="For example they/them"></div>
        <div class="field"><label>Custom Status</label><input id="set-custom" maxlength="128" value="${escapeHtml(u.custom_status || '')}" placeholder="What are you up to?"></div>
        <div class="field"><label>About Me</label><textarea id="set-bio" maxlength="190" placeholder="Tell people about yourself">${escapeHtml(u.bio || '')}</textarea></div>
        <div class="field"><label>Profile Banner</label>
          <div class="banner-editor" id="banner-editor" style="${u.banner_url ? `background-image:url('${escapeHtml(u.banner_url)}')` : `background:${escapeHtml(u.banner_color || u.accent_color || '#5865F2')}`}">
            <button class="banner-edit-btn" id="set-banner-file-btn">${icon('fa-image')} Upload Banner</button>
          </div>
          <input type="file" id="set-banner-file" accept="image/*" class="hidden">
          <div class="color-row" id="banner-color-row" style="margin-top:10px">${PALETTE.map(c => `<span class="swatch${(u.banner_color || '#5865F2').toLowerCase() === c.toLowerCase() ? ' sel' : ''}" data-color="${c}" style="background:${c}"></span>`).join('')}</div>
          <div class="hint">Recommended size 600x240. Pick a color or upload an image.</div>
          <button class="btn secondary" id="set-banner-remove" style="margin-top:8px;padding:6px 12px;font-size:13px">Remove Banner</button>
        </div>
        <div class="field"><label>Accent Color</label>
          <div class="color-row" id="accent-row">${PALETTE.map(c => `<span class="swatch${(u.accent_color || '#5865F2').toLowerCase() === c.toLowerCase() ? ' sel' : ''}" data-color="${c}" style="background:${c}"></span>`).join('')}</div>
        </div>
        <div class="field"><label>Status</label>
          <select id="set-status">
            <option value="online">Online</option>
            <option value="idle">Idle</option>
            <option value="dnd">Do Not Disturb</option>
            <option value="offline">Invisible</option>
          </select></div>
        <div class="modal-actions" style="justify-content:flex-start">
          <button class="btn" id="set-save">Save Changes</button>
        </div>`;
    case 'profiles':
      return `
        <h4>Profiles</h4>
        <p style="color:var(--text-muted);font-size:14px;margin-bottom:18px;line-height:1.5">Personalise how your name and banner appear across Crossroads.</p>
        <div class="field"><label>Display Name Style</label>
          <div class="pnav-namestyle" id="prof-namestyle" style="color:${escapeHtml(u.banner_color || '#5865F2')}">${escapeHtml(u.display_name || u.username)}</div></div>
        <div class="field"><label>Banner Color</label>
          <div class="color-row" id="prof-banner-row">${PALETTE.map(c => `<span class="swatch${(u.banner_color || '#5865F2').toLowerCase() === c.toLowerCase() ? ' sel' : ''}" data-color="${c}" style="background:${c}"></span>`).join('')}</div>
        </div>
        <div class="modal-actions" style="justify-content:flex-start"><button class="btn" id="prof-save">Save Changes</button></div>`;
    case 'privacy':
      return `
        <h4>Privacy & Safety</h4>
        <div class="set-row"><div><div class="sr-title">Keep me safe</div><div class="sr-desc">Scan and blur media from unverified sources.</div></div><div class="toggle on" data-toggle></div></div>
        <div class="set-row"><div><div class="sr-title">Allow direct messages from server members</div><div class="sr-desc">Members of servers you share can start a conversation with you.</div></div><div class="toggle on" data-toggle></div></div>
        <div class="set-row"><div><div class="sr-title">Allow data personalisation</div><div class="sr-desc">Use my activity to improve recommendations.</div></div><div class="toggle" data-toggle></div></div>
        <div class="set-row"><div><div class="sr-title">Show my read receipts</div><div class="sr-desc">Let others know when you have read their messages.</div></div><div class="toggle on" data-toggle></div></div>`;
    case 'apps':
      return `<h4>Authorized Apps</h4><div class="empty-panel">${icon('fa-plug')}<h5>No authorized apps</h5><p>When you connect an application to your account, it will appear here.</p></div>`;
    case 'devices':
      return `<h4>Devices</h4><div class="empty-panel">${icon('fa-mobile-screen')}<h5>No other devices</h5><p>You are only signed in on this device right now.</p></div>`;
    case 'connections':
      return `<h4>Connections</h4><div class="empty-panel">${icon('fa-link')}<h5>No connections</h5><p>Connect accounts such as GitHub or Twitch to display them on your profile.</p></div>`;
    case 'appearance':
      return `
        <h4>Appearance</h4>
        <div class="set-row"><div><div class="sr-title">Dark theme</div><div class="sr-desc">Crossroads is optimised for a dark interface.</div></div><div class="toggle on" data-toggle></div></div>
        <div class="set-row"><div><div class="sr-title">Compact message display</div><div class="sr-desc">Reduce the spacing between messages.</div></div><div class="toggle" data-toggle></div></div>
        <div class="set-row"><div><div class="sr-title">Show member list</div><div class="sr-desc">Display the member list beside channels.</div></div><div class="toggle on" data-toggle></div></div>`;
    case 'notifications':
      return `
        <h4>Notifications</h4>
        <div class="set-row"><div><div class="sr-title">Enable desktop notifications</div><div class="sr-desc">Receive a notification when you are mentioned.</div></div><div class="toggle on" data-toggle></div></div>
        <div class="set-row"><div><div class="sr-title">Notification sounds</div><div class="sr-desc">Play a sound for incoming messages.</div></div><div class="toggle on" data-toggle></div></div>
        <div class="set-row"><div><div class="sr-title">Unread badge on app icon</div><div class="sr-desc">Show a badge for unread messages.</div></div><div class="toggle" data-toggle></div></div>`;
    case 'voice':
      return `
        <h4>Voice & Video</h4>
        <div class="field"><label>Input Device</label><select><option>Default</option><option>System Microphone</option></select></div>
        <div class="field"><label>Output Device</label><select><option>Default</option><option>System Speakers</option></select></div>
        <div class="field"><label>Input Volume</label><input type="range" min="0" max="100" value="70" style="padding:0"></div>
        <div class="set-row"><div><div class="sr-title">Echo cancellation</div><div class="sr-desc">Reduce echo picked up by your microphone.</div></div><div class="toggle on" data-toggle></div></div>
        <div class="set-row"><div><div class="sr-title">Noise suppression</div><div class="sr-desc">Filter background noise during calls.</div></div><div class="toggle on" data-toggle></div></div>`;
    case 'keybinds':
      return `
        <h4>Keybinds</h4>
        <div class="kb-row"><span>Mark channel as read</span><span class="kb-key">Shift + Esc</span></div>
        <div class="kb-row"><span>Search</span><span class="kb-key">Ctrl + F</span></div>
        <div class="kb-row"><span>New direct message</span><span class="kb-key">Ctrl + K</span></div>
        <div class="kb-row"><span>Close modal or menu</span><span class="kb-key">Esc</span></div>
        <div class="kb-row"><span>Send message</span><span class="kb-key">Enter</span></div>`;
    case 'language':
      return `
        <h4>Language</h4>
        <div class="field"><label>Display Language</label>
          <select><option>English, US</option><option>English, UK</option><option>Espa\u00f1ol</option><option>Fran\u00e7ais</option><option>Deutsch</option></select></div>
        <p style="color:var(--text-muted);font-size:13px;line-height:1.5">Additional languages are being prepared and will appear here as they become available.</p>`;
    default:
      return `<h4>Settings</h4>`;
  }
}

function wireAccountPanel() {
  const u = me;
  settingsUploads = { avatar_url: u.avatar_url || null, banner_url: u.banner_url || null };
  $('set-status').value = u.status || 'online';

  const markDirty = () => { settingsDirty = true; };

  // ---- Avatar (real-time preview + saved on Save Changes) ----
  $('sa-upload').addEventListener('click', () => $('sa-file').click());
  $('sa-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    try {
      const d = await api('/api/upload', { method: 'POST', body: fd });
      settingsUploads.avatar_url = d.url;
      previewSelf({ avatar_url: d.url });
      markDirty();
      toast('Avatar ready — remember to save', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });
  $('sa-remove').addEventListener('click', () => {
    settingsUploads.avatar_url = null;
    previewSelf({ avatar_url: null });
    markDirty();
  });

  // ---- Profile banner (image + colour) ----
  let bannerColor = u.banner_color || '#5865F2';
  const editor = $('banner-editor');
  const paintBanner = () => {
    // NOTE: set longhands (backgroundImage / backgroundColor) individually — assigning the
    // `background` shorthand afterwards would reset and wipe the image we just set.
    if (settingsUploads.banner_url) {
      editor.style.backgroundImage = `url('${settingsUploads.banner_url}')`;
      editor.style.backgroundColor = 'transparent';
    } else {
      editor.style.backgroundImage = 'none';
      editor.style.backgroundColor = bannerColor;
    }
    previewSelf({ banner_url: settingsUploads.banner_url, banner_color: bannerColor });
  };
  $('set-banner-file-btn').addEventListener('click', () => $('set-banner-file').click());
  $('set-banner-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    try {
      const d = await api('/api/upload', { method: 'POST', body: fd });
      settingsUploads.banner_url = d.url; paintBanner(); markDirty();
      toast('Banner ready — remember to save', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });
  $('set-banner-remove').addEventListener('click', () => { settingsUploads.banner_url = null; paintBanner(); markDirty(); });
  document.querySelectorAll('#banner-color-row .swatch').forEach(sw => sw.addEventListener('click', () => {
    bannerColor = sw.dataset.color;
    settingsUploads.banner_url = null;
    document.querySelectorAll('#banner-color-row .swatch').forEach(x => x.classList.toggle('sel', x === sw));
    paintBanner(); markDirty();
  }));

  // ---- Accent colour ----
  let accent = u.accent_color || '#5865F2';
  document.querySelectorAll('#accent-row .swatch').forEach(sw => sw.addEventListener('click', () => {
    accent = sw.dataset.color;
    document.querySelectorAll('#accent-row .swatch').forEach(x => x.classList.toggle('sel', x === sw));
    markDirty();
  }));

  // ---- Username availability ----
  const unameInput = $('set-username');
  const hint = $('username-hint');
  let usernameOk = true;
  let t = null;
  unameInput.addEventListener('input', () => {
    markDirty();
    clearTimeout(t);
    const val = unameInput.value.trim();
    if (!val || val.toLowerCase() === (u.username || '').toLowerCase()) {
      usernameOk = true; hint.textContent = `Your unique tag is #${u.discriminator}`; hint.className = 'hint'; return;
    }
    t = setTimeout(async () => {
      try {
        const res = await api('/api/check-username?username=' + encodeURIComponent(val) + '&exclude=' + me.id);
        usernameOk = res.available;
        hint.textContent = res.reason;
        hint.className = 'hint ' + (res.available ? 'ok' : 'bad');
      } catch (e) { /* ignore */ }
    }, 350);
  });

  // ---- Live preview for text fields ----
  $('set-display').addEventListener('input', () => { markDirty(); previewSelf({ display_name: $('set-display').value.trim() || null }); });
  $('set-pronouns').addEventListener('input', markDirty);
  $('set-custom').addEventListener('input', markDirty);
  $('set-bio').addEventListener('input', markDirty);
  $('set-status').addEventListener('change', () => { markDirty(); previewSelf({ status: $('set-status').value }); });

  // ---- Save ----
  const doSave = async () => {
    const body = {
      display_name: $('set-display').value.trim() || null,
      pronouns: $('set-pronouns').value.trim(),
      custom_status: $('set-custom').value.trim(),
      bio: $('set-bio').value.trim(),
      accent_color: accent,
      banner_color: bannerColor,
      avatar_url: settingsUploads.avatar_url,
      banner_url: settingsUploads.banner_url,
      status: $('set-status').value
    };
    const newUsername = unameInput.value.trim();
    if (newUsername && newUsername.toLowerCase() !== (u.username || '').toLowerCase()) {
      if (!usernameOk) { toast('Please choose an available username', 'error'); return false; }
      body.username = newUsername;
    }
    try {
      const { user } = await api('/api/me', { method: 'PATCH', body: JSON.stringify(body) });
      me = user; localStorage.setItem('cr_user', JSON.stringify(me));
      settingsDirty = false;
      previewSelf();            // refresh bottom-left panel + settings preview with saved values
      renderRail(); renderMembers();
      toast('Profile updated', 'success');
      return true;
    } catch (e) { toast(e.message, 'error'); return false; }
  };
  settingsSaveFn = doSave;
  $('set-save').addEventListener('click', doSave);
}

function wireProfilesPanel() {
  let color = me.banner_color || '#5865F2';
  document.querySelectorAll('#prof-banner-row .swatch').forEach(sw => sw.addEventListener('click', () => {
    color = sw.dataset.color;
    settingsDirty = true;
    document.querySelectorAll('#prof-banner-row .swatch').forEach(x => x.classList.toggle('sel', x === sw));
    $('prof-namestyle').style.color = color;
  }));
  const doSave = async () => {
    try {
      const { user } = await api('/api/me', { method: 'PATCH', body: JSON.stringify({ banner_color: color }) });
      me = user; localStorage.setItem('cr_user', JSON.stringify(me));
      settingsDirty = false;
      toast('Profile style saved', 'success');
      return true;
    } catch (e) { toast(e.message, 'error'); return false; }
  };
  settingsSaveFn = doSave;
  $('prof-save').addEventListener('click', doSave);
}

function wireToggles() {
  document.querySelectorAll('#settings-panel .toggle').forEach(t => t.addEventListener('click', () => t.classList.toggle('on')));
}

/* ============================================================
   SERVER MENU
   ============================================================ */
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
      try { await navigator.clipboard.writeText(link); toast('Invite link copied', 'success'); }
      catch (err) { prompt('Copy this invite link:', link); }
    }
    if (a === 'channel') openCreateChannel('text');
    if (a === 'settings') openServerSettings();
    if (a === 'leave') {
      if (!confirm('Leave ' + state.server.name + '?')) return;
      toast('Leaving servers is not available yet');
    }
    if (a === 'delete') {
      if (!confirm('Delete ' + state.server.name + '? This cannot be undone.')) return;
      toast('Deleting servers is not available yet');
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
  $('btn-settings').addEventListener('click', () => openSettings('account'));
  $('btn-mic').addEventListener('click', () => toast('Voice settings are not available yet'));
  $('hdr-members').addEventListener('click', () => { state.showMembers = !state.showMembers; renderMembers(); });
  $('hdr-pins').addEventListener('click', () => toast('Pinned messages are not available yet'));
  $('hdr-search').addEventListener('click', () => toast('Search is not available yet'));
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

  const chat = $('chat');
  chat.addEventListener('dragover', (e) => { e.preventDefault(); });
  chat.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });

  input.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) if (it.type.startsWith('image/')) { handleFile(it.getAsFile()); }
  });

  $('modal-overlay').addEventListener('click', (e) => { if (e.target.id === 'modal-overlay') requestCloseModal(); });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.emoji-picker') && !e.target.closest('.context-menu') &&
        !e.target.closest('.msg-toolbar') && !e.target.closest('#emoji-btn')) closePopovers();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const cu = $('confirm-overlay');
    if (cu) { cu.remove(); return; }
    closePopovers();
    if (!$('modal-overlay').classList.contains('hidden')) requestCloseModal();
  });
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
    toast('Joined ' + server.name, 'success');
  } catch (e) { openJoinServer(invite); }
}

/* ---------------- Start ---------------- */
init().then(handleInviteParam).catch(err => { console.error(err); toast(err.message, 'error'); });
