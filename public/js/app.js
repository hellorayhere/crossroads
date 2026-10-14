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
  replyTo: null,
  view: 'home',
  friends: null,
  friendsTab: 'online',
  notifications: [],
  unread: 0,
  settings: {},
  mention: { active: false, query: '', items: [], sel: 0, start: 0 }
};

/* Restore the locally-mirrored settings immediately so the theme, background and
   other preferences are correct from the very first frame (before /api/settings
   responds). The server value loaded in init() stays the source of truth. */
try { Object.assign(state.settings, JSON.parse(localStorage.getItem('cr_settings') || '{}')); } catch (e) { /* ignore */ }

/* Emoji set is used only for message content and reactions (a native chat feature). */
const EMOJIS = ['\u{1F600}','\u{1F602}','\u{1F972}','\u{1F60D}','\u{1F60E}','\u{1F914}','\u{1F634}','\u{1F973}','\u{1F62D}','\u{1F621}','\u{1F44D}','\u{1F44E}','\u{1F44F}','\u{1F64F}','\u{1F525}','\u{1F4AF}','\u{2728}','\u{1F389}','\u{2764}\u{FE0F}','\u{1F49C}','\u{1F499}','\u{1F49A}','\u{1F63A}','\u{1F436}','\u{1F355}','\u{1F354}','\u{2615}','\u{1F3AE}','\u{1F3B5}','\u{1F680}','\u{26A1}','\u{1F31F}','\u{1F440}','\u{1F92F}','\u{1F605}','\u{1F64C}','\u{1F91D}','\u{1F4AA}','\u{1F9E0}','\u{1F984}'];

/* Palette used for banner / accent selection. */
const PALETTE = ['#5865F2','#3BA55D','#FAA81A','#ED4245','#EB459E','#9B59B6','#1ABC9C','#E67E22','#3498DB','#95A5A6','#2B2D31','#111214'];

/* The website background colours (dark theme). */
const BG_COLORS = [
  { id: 'graphite', label: 'Graphite', rail: '#202225', side: '#2b2d31', main: '#313338' },
  { id: 'midnight', label: 'Midnight', rail: '#181b28', side: '#20232f', main: '#24283c' },
  { id: 'ocean',    label: 'Ocean',    rail: '#152026', side: '#1b272e', main: '#1f2d36' },
  { id: 'forest',   label: 'Forest',   rail: '#16211c', side: '#1c2a24', main: '#20302a' },
  { id: 'plum',     label: 'Plum',     rail: '#1e1827', side: '#262030', main: '#2b2238' },
  { id: 'ember',    label: 'Ember',    rail: '#201814', side: '#2a1f1b', main: '#2f231f' },
  { id: 'black',    label: 'Black',    rail: '#000000', side: '#050506', main: '#0d0d0f' }
];

const SETTINGS_DEFAULTS = {
  theme: 'dark', bg: 'graphite', compact: false, showMembers: true,
  friendRequests: true, safeMode: true, dmFromMembers: true, dataPersonalisation: false, readReceipts: true,
  notifDesktop: true, notifSounds: true, notifBadge: false,
  echoCancel: true, noiseSuppress: true, inputVolume: 70,
  language: 'English, US'
};

/* ---------------- Localisation (i18n) ----------------
   A compact dictionary for the most visible interface strings. English (US)
   is the source of truth and the fallback for any missing key. */
const I18N = {
  'English, US': {},
  'English, UK': {
    'Direct Messages': 'Direct Messages', 'Friends': 'Friends', 'Text Channels': 'Text Channels',
    'Voice Channels': 'Voice Channels', 'Create Channel': 'Create Channel', 'Add Friend': 'Add Friend',
    'Send Friend Request': 'Send Friend Request', 'Online': 'Online', 'All': 'All', 'Pending': 'Pending',
    'Blocked': 'Blocked', 'Save': 'Save', 'Log Out': 'Log Out', 'Start a conversation': 'Start a conversation',
    'User Settings': 'User Settings', 'App Settings': 'App Settings', 'My Account': 'My Account',
    'Profiles': 'Profiles', 'Privacy & Safety': 'Privacy & Safety', 'Authorized Apps': 'Authorised Apps',
    'Devices': 'Devices', 'Connections': 'Connections', 'Appearance': 'Appearance',
    'Notifications': 'Notifications', 'Voice & Video': 'Voice & Video', 'Keybinds': 'Keybinds', 'Language': 'Language'
  },
  'Español': {
    'Direct Messages': 'Mensajes directos', 'Friends': 'Amigos', 'Text Channels': 'Canales de texto',
    'Voice Channels': 'Canales de voz', 'Create Channel': 'Crear canal', 'Add Friend': 'Añadir amigo',
    'Send Friend Request': 'Enviar solicitud', 'Online': 'En línea', 'All': 'Todos', 'Pending': 'Pendiente',
    'Blocked': 'Bloqueados', 'Save': 'Guardar', 'Log Out': 'Cerrar sesión', 'Start a conversation': 'Iniciar una conversación',
    'User Settings': 'Ajustes de usuario', 'App Settings': 'Ajustes de la app', 'My Account': 'Mi cuenta',
    'Profiles': 'Perfiles', 'Privacy & Safety': 'Privacidad y seguridad', 'Authorized Apps': 'Apps autorizadas',
    'Devices': 'Dispositivos', 'Connections': 'Conexiones', 'Appearance': 'Apariencia',
    'Notifications': 'Notificaciones', 'Voice & Video': 'Voz y vídeo', 'Keybinds': 'Atajos', 'Language': 'Idioma'
  },
  'Français': {
    'Direct Messages': 'Messages privés', 'Friends': 'Amis', 'Text Channels': 'Salons textuels',
    'Voice Channels': 'Salons vocaux', 'Create Channel': 'Créer un salon', 'Add Friend': 'Ajouter un ami',
    'Send Friend Request': 'Envoyer une demande', 'Online': 'En ligne', 'All': 'Tous', 'Pending': 'En attente',
    'Blocked': 'Bloqués', 'Save': 'Enregistrer', 'Log Out': 'Se déconnecter', 'Start a conversation': 'Démarrer une conversation',
    'User Settings': 'Paramètres utilisateur', 'App Settings': 'Paramètres de l’app', 'My Account': 'Mon compte',
    'Profiles': 'Profils', 'Privacy & Safety': 'Confidentialité et sécurité', 'Authorized Apps': 'Applications autorisées',
    'Devices': 'Appareils', 'Connections': 'Connexions', 'Appearance': 'Apparence',
    'Notifications': 'Notifications', 'Voice & Video': 'Voix et vidéo', 'Keybinds': 'Raccourcis', 'Language': 'Langue'
  },
  'Deutsch': {
    'Direct Messages': 'Direktnachrichten', 'Friends': 'Freunde', 'Text Channels': 'Textkanäle',
    'Voice Channels': 'Sprachkanäle', 'Create Channel': 'Kanal erstellen', 'Add Friend': 'Freund hinzufügen',
    'Send Friend Request': 'Anfrage senden', 'Online': 'Online', 'All': 'Alle', 'Pending': 'Ausstehend',
    'Blocked': 'Blockiert', 'Save': 'Speichern', 'Log Out': 'Abmelden', 'Start a conversation': 'Unterhaltung starten',
    'User Settings': 'Benutzereinstellungen', 'App Settings': 'App-Einstellungen', 'My Account': 'Mein Konto',
    'Profiles': 'Profile', 'Privacy & Safety': 'Datenschutz & Sicherheit', 'Authorized Apps': 'Autorisierte Apps',
    'Devices': 'Geräte', 'Connections': 'Verbindungen', 'Appearance': 'Erscheinungsbild',
    'Notifications': 'Benachrichtigungen', 'Voice & Video': 'Sprache & Video', 'Keybinds': 'Tastenkürzel', 'Language': 'Sprache'
  }
};

function t(key) {
  if (key == null) return '';
  const lang = setting('language') || 'English, US';
  const dict = I18N[lang] || I18N['English, US'];
  return (dict && dict[key]) || key;
}

/* Re-render the surfaces that contain translated strings. */
function applyLanguage() {
  document.documentElement.lang = ({ 'English, US': 'en-US', 'English, UK': 'en-GB', 'Español': 'es', 'Français': 'fr', 'Deutsch': 'de' })[setting('language')] || 'en';
  if (state.view === 'home') { $('sidebar-name').textContent = t('Direct Messages'); if (state.dm) { /* keep */ } renderDMList(); }
  else if (state.view === 'friends') { renderDMList(); renderFriendsView(); }
  if (state.server) renderChannelList();
  if ($('settings-nav')) openSettings(document.querySelector('#settings-nav .sn-item.active')?.dataset.sec || 'account');
}

const REL_LABEL = {
  none: 'Add Friend',
  pending_outgoing: 'Cancel Request',
  pending_incoming: 'Accept Request',
  friends: 'Friends',
  blocked: 'Blocked'
};

/* ---------------- Icon set (inline SVG, clean line style) ---------------- */
const ICONS = {
  'message-circle': '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  'plus': '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  'compass': '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
  'chevron-down': '<polyline points="6 9 12 15 18 9"/>',
  'chevron-right': '<polyline points="9 18 15 12 9 6"/>',
  'chevron-left': '<polyline points="15 18 9 12 15 6"/>',
  'caret-down': '<polyline points="6 9 12 15 18 9"/>',
  'mic': '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
  'settings': '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  'hash': '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
  'bell': '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  'users': '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  'user-group': '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  'pin': '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  'search': '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  'plus-circle': '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>',
  'smile': '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>',
  'smile-plus': '<path d="M22 11v1a10 10 0 1 1-9-10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/><line x1="16" y1="5" x2="22" y2="5"/><line x1="19" y1="2" x2="19" y2="8"/>',
  'send': '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  'reply': '<polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
  'corner-up-left': '<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>',
  'trash': '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  'check': '<polyline points="20 6 9 17 4 12"/>',
  'xmark': '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  'user-plus': '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>',
  'user-minus': '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="23" y1="11" x2="17" y2="11"/>',
  'user-check': '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/>',
  'unlock': '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  'lock': '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  'ban': '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>',
  'clock': '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  'comment': '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  'ellipsis-vertical': '<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>',
  'more-horizontal': '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  'calendar-days': '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  'note': '<path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3z"/><path d="M15 3v6h6"/>',
  'image': '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  'crown': '<path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5z"/><path d="M5 19h14"/>',
  'ghost': '<path d="M9 10h.01M15 10h.01M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z"/>',
  'server': '<rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>',
  'file': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  'plug': '<path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8zM12 17v5"/>',
  'link': '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  'mobile': '<rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
  'volume-high': '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>',
  'id-badge': '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M15 8h4M15 12h4M7 16h10"/>',
  'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  'upload': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  'pencil': '<path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
  'key': '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
  'globe': '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  'eye': '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  'shield': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  'sliders': '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  'palette': '<circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12.5" r="1.5"/><path d="M12 2a10 10 0 0 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.2 0-1 .8-1.8 1.8-1.8H16a6 6 0 0 0 6-6c0-5.5-4.5-10-10-10z"/>',
  'keyboard': '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12"/>',
  'phone': '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>',
  'at-sign': '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/>',
  'external-link': '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  'copy': '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  'share': '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
  'refresh': '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  'circle': '<circle cx="12" cy="12" r="9"/>'
};

function svgIcon(name) {
  const p = ICONS[name] || ICONS['circle'];
  return `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
}
function icon(name) { return `<i data-ic="${name}">${svgIcon(name)}</i>`; }
function hydrateIcons(root) {
  (root || document).querySelectorAll('i[data-ic]').forEach(el => {
    if (!el.querySelector('svg')) el.innerHTML = svgIcon(el.dataset.ic);
  });
}

/* ---------------- DOM helpers ---------------- */
const $ = (id) => document.getElementById(id);

/* Coalesce bursts of work (presence/profile churn) into a single re-render. */
function debounce(fn, wait) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

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
    ? `<img src="${escapeHtml(user.avatar_url)}" alt="" loading="lazy" decoding="async">`
    : (user.avatar ? escapeHtml(user.avatar) : escapeHtml((user.username || '?')[0].toUpperCase()));
  const dot = status ? `<span class="status-dot ${status}"></span>` : '';
  return `<div class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px;background:${bg}">${inner}${dot}</div>`;
}

/* ---------------- Settings helpers ---------------- */
function setting(key) { return state.settings[key] !== undefined ? state.settings[key] : SETTINGS_DEFAULTS[key]; }

/* Mirror settings into localStorage so the saved theme/background can be
   applied synchronously before the first paint (prevents the theme flash). */
function mirrorSettingsLocal() {
  try { localStorage.setItem('cr_settings', JSON.stringify(state.settings || {})); } catch (e) { /* ignore */ }
}

function applyTheme() {
  document.body.dataset.theme = setting('theme') || 'dark';
  document.body.dataset.bg = setting('bg') || 'graphite';
  document.body.classList.toggle('compact', !!setting('compact'));
  state.showMembers = setting('showMembers') !== false;
  if (state.server) renderMembers();
}
const saveTimers = {};
function saveSetting(key, value) {
  state.settings[key] = value;
  mirrorSettingsLocal();
  applyTheme();
  if (key === 'notifDesktop' && value && typeof Notification !== 'undefined' && Notification.permission === 'default') {
    try { Notification.requestPermission(); } catch (e) { /* ignore */ }
  }
  clearTimeout(saveTimers[key]);
  saveTimers[key] = setTimeout(() => {
    api('/api/settings', { method: 'PATCH', body: JSON.stringify({ [key]: value }) }).catch(() => {});
  }, 250);
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
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, type === 'alert' ? 4200 : 3000);
}

/* ---------------- Custom confirm / prompt ---------------- */
function confirmDialog(opts = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'confirm-overlay';
    wrap.innerHTML = `<div class="confirm-box">
      <h3>${escapeHtml(opts.title || 'Are you sure?')}</h3>
      ${opts.body ? `<p>${opts.body}</p>` : ''}
      <div class="confirm-actions">
        <button class="btn ghost" id="cd-cancel">${escapeHtml(opts.cancelText || 'Cancel')}</button>
        <button class="btn ${opts.danger ? 'danger' : ''}" id="cd-ok">${escapeHtml(opts.confirmText || 'Confirm')}</button>
      </div></div>`;
    document.body.appendChild(wrap);
    const done = (v) => { wrap.remove(); document.removeEventListener('keydown', esc); resolve(v); };
    const esc = (e) => { if (e.key === 'Escape') done(false); };
    wrap.querySelector('#cd-ok').addEventListener('click', () => done(true));
    wrap.querySelector('#cd-cancel').addEventListener('click', () => done(false));
    wrap.addEventListener('click', (e) => { if (e.target === wrap) done(false); });
    document.addEventListener('keydown', esc);
    wrap.querySelector('#cd-ok').focus();
  });
}

function promptDialog(opts = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'confirm-overlay';
    wrap.innerHTML = `<div class="confirm-box">
      <h3>${escapeHtml(opts.title || '')}</h3>
      ${opts.body ? `<p>${opts.body}</p>` : ''}
      <div class="field"><label>${escapeHtml(opts.label || '')}</label>
        <input id="pd-input" value="${escapeHtml(opts.value || '')}" placeholder="${escapeHtml(opts.placeholder || '')}" maxlength="${opts.maxlength || 256}"></div>
      <div class="confirm-actions">
        <button class="btn ghost" id="pd-cancel">Cancel</button>
        <button class="btn" id="pd-ok">${escapeHtml(opts.confirmText || 'Save')}</button>
      </div></div>`;
    document.body.appendChild(wrap);
    const input = wrap.querySelector('#pd-input');
    const done = (v) => { wrap.remove(); resolve(v); };
    wrap.querySelector('#pd-ok').addEventListener('click', () => done(input.value));
    wrap.querySelector('#pd-cancel').addEventListener('click', () => done(null));
    wrap.addEventListener('click', (e) => { if (e.target === wrap) done(null); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); done(input.value); }
      if (e.key === 'Escape') done(null);
    });
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
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
  try {
    const { settings } = await api('/api/settings');
    state.settings = settings || {};
  } catch (e) { state.settings = {}; }
  applyTheme();
  hydrateIcons(document);
  renderMe();
  connectSocket();
  /* Load everything in parallel so the first paint is not blocked by a chain
     of sequential round-trips. */
  await Promise.all([loadServers(), loadFriends(), loadDMs(), loadNotifications()]);
  showHome();
  bindGlobalEvents();
  applyLanguage();
}

function renderMe(u = me) {
  const slot = $('my-avatar');
  if (slot) slot.outerHTML = avatarHTML(u, 32, u.status || 'online').replace('class="avatar"', 'class="avatar" id="my-avatar"');
  $('my-username').textContent = u.display_name || u.username;
  $('my-tag').textContent = '#' + u.discriminator;
}

/* Live preview of the signed-in user's profile across the whole UI. */
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

/* Debounced re-render of the lists that react to presence / profile churn. */
const rerenderLists = debounce(() => {
  if (state.server) renderMembers();
  if (state.view === 'home') renderDMList();
  if (state.view === 'friends') renderFriendsView();
}, 120);

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
      const who = fullTag(data.message.author);
      toast('New message from ' + who, '');
      maybeDesktopNotify('New message from ' + who, data.message.content || '');
      if (setting('notifSounds') !== false) beep();
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
  socket.on('message_pin', (data) => {
    const m = state.messages.find(x => x.id === data.message_id);
    if (m) { m.pinned = !!data.pinned; updatePinIndicator(data.message_id, data.pinned); }
    if ($('pins-panel')) loadPins();
  });
  socket.on('typing', (data) => {
    if (data.username) showTyping(data.username, data.channel_id || data.dm_id);
  });
  socket.on('presence', (data) => {
    const u = state.usersCache[data.user_id];
    if (u) u.status = data.status;
    const mi = state.members.findIndex(m => m.id === data.user_id);
    if (mi >= 0) state.members[mi].status = data.status;
    state.dms.forEach(d => { if (d.user && d.user.id === data.user_id) d.user.status = data.status; });
    if (me && data.user_id === me.id) { me.status = data.status; renderMe(); }
    document.querySelectorAll(`[data-uid="${data.user_id}"] .status-dot`).forEach(dot => { dot.className = 'status-dot ' + data.status; });
    rerenderLists();
    refreshMiniProfileStatus();
  });
  /* A user changed their avatar / banner / name / custom status: refresh every
     surface that shows them, everywhere, in real time. */
  socket.on('profile_update', (u) => {
    if (!u || !u.id) return;
    state.usersCache[u.id] = Object.assign({}, state.usersCache[u.id] || {}, u);
    if (me && u.id === me.id) {
      me = Object.assign({}, me, u);
      localStorage.setItem('cr_user', JSON.stringify(me));
      renderMe();
    }
    const mi = state.members.findIndex(m => m.id === u.id);
    if (mi >= 0) state.members[mi] = Object.assign({}, state.members[mi], u);
    state.dms.forEach(d => { if (d.user && d.user.id === u.id) d.user = Object.assign({}, d.user, u); });
    state.messages.forEach(m => { if (m.author && m.author.id === u.id) m.author = Object.assign({}, m.author, u); });
    if (state.friends) {
      ['online', 'offline', 'pendingIn', 'pendingOut', 'all'].forEach(k => {
        if (Array.isArray(state.friends[k])) state.friends[k].forEach(f => { if (f.id === u.id) Object.assign(f, u); });
      });
    }
    refreshMessageAuthor(u);
    rerenderLists();
    refreshOpenProfile(u);
    refreshMiniProfileUser(u);
  });
  /* Channel list changed on the server (created / renamed / deleted). */
  socket.on('channels_update', (data) => {
    if (!data || !state.server || data.server_id !== state.server.id) return;
    state.channels = data.channels || [];
    if (state.channel && !state.channels.some(c => c.id === state.channel.id)) {
      const first = state.channels.find(c => c.type === 'text') || state.channels[0];
      state.channel = null;
      if (first) openChannel(first.id);
      else { state.messages = []; renderEmptyChat('This server has no channels yet.'); }
    } else if (state.channel) {
      const c = state.channels.find(x => x.id === state.channel.id);
      if (c) { state.channel = c; $('chat-title').textContent = c.name; $('chat-topic').textContent = c.topic || ''; }
    }
    renderChannelList();
  });
  /* Server name / icon / banner / description changed. */
  socket.on('server_update', (s) => {
    if (!s || !s.id) return;
    const idx = state.servers.findIndex(x => x.id === s.id);
    if (idx >= 0) state.servers[idx] = Object.assign({}, state.servers[idx], s);
    if (state.server && state.server.id === s.id) {
      state.server = Object.assign({}, state.server, s);
      const sn = $('sidebar-name'); if (sn) sn.textContent = s.name;
    }
    renderRail();
    const activeTab = document.querySelector('.ss-tab.active');
    if (activeTab && activeTab.dataset.tab === 'overview' && state.server && state.server.id === s.id) {
      renderServerTab('overview', state.server, state.server.owner_id === me.id);
    }
  });
  /* Member roles changed: refresh the member list + open members tab. */
  socket.on('server_members_update', (data) => {
    if (!data || !state.server || data.server_id !== state.server.id) return;
    reloadServerMembers();
  });
  socket.on('friend_update', (data) => {
    loadFriends();
    if (data.type === 'request') toast((data.user.display_name || data.user.username) + ' sent you a friend request', 'alert');
    if (data.type === 'accepted') toast('You are now friends with ' + (data.user.display_name || data.user.username), 'success');
    if (data.type === 'removed') toast((data.user.display_name || data.user.username) + ' removed you as a friend');
  });
  socket.on('notification', (n) => {
    state.notifications.unshift(n);
    state.unread++;
    renderNotifBadge();
    const info = notifInfo(n);
    toast(info.plain, 'alert');
    maybeDesktopNotify('Crossroads', info.plain);
    if (setting('notifSounds') !== false) beep();
    if ($('notif-panel')) renderNotifList();
  });
}

/* Native desktop notification (respects the "Enable desktop notifications" setting). */
function maybeDesktopNotify(title, body) {
  try {
    if (setting('notifDesktop') === false) return;
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'granted') {
      const n = new Notification(title, { body: body || '', icon: '/favicon.png', tag: 'crossroads' });
      n.onclick = () => { try { window.focus(); } catch (e) {} };
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission();
    }
  } catch (e) { /* ignore */ }
}

/* Short WebAudio blip for pings (no external asset). */
let audioCtx = null;
function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine'; o.frequency.value = 660;
    g.gain.value = 0.06;
    o.connect(g); g.connect(audioCtx.destination);
    o.start();
    o.frequency.setValueAtTime(880, audioCtx.currentTime + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.28);
    o.stop(audioCtx.currentTime + 0.3);
  } catch (e) { /* ignore */ }
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
  state.server = null; state.channel = null; state.dm = null; state.view = 'home';
  setReplyTo(null);
  renderRail();
  $('rail-home').classList.add('active');
  $('sidebar-name').textContent = t('Direct Messages');
  $('chat-hash').style.display = 'none';
  $('chat-title').textContent = t('Direct Messages');
  $('chat-topic').textContent = '';
  $('members').innerHTML = '';
  $('composer').classList.add('hidden');
  renderDMList();
  renderEmptyChat();
  animateView();
}

async function loadDMs() {
  const { dms } = await api('/api/dms');
  state.dms = dms;
  for (const d of dms) if (d.user) state.usersCache[d.user.id] = d.user;
  if (!state.server && state.view !== 'friends') renderDMList();
}

function renderDMList() {
  const list = $('channel-list');
  list.innerHTML = '';
  const friendsBtn = document.createElement('div');
  friendsBtn.className = 'dm-item friends-entry' + (state.view === 'friends' ? ' active' : '');
  friendsBtn.id = 'friends-entry';
  const pendingCount = (state.friends && state.friends.incoming) ? state.friends.incoming.length : 0;
  friendsBtn.innerHTML = `${icon('user-group')}<span class="dm-name">${t('Friends')}</span>${pendingCount ? `<span class="friend-badge">${pendingCount}</span>` : ''}`;
  friendsBtn.addEventListener('click', openFriends);
  list.appendChild(friendsBtn);

  const cat = document.createElement('div');
  cat.className = 'channel-category';
  cat.innerHTML = `${icon('caret-down')} ${t('Direct Messages')}`;
  list.appendChild(cat);
  for (const d of state.dms) {
    const item = document.createElement('div');
    item.className = 'dm-item' + (state.dm && state.dm.id === d.id ? ' active' : '');
    item.dataset.dmid = d.id;
    if (d.user) item.dataset.uid = d.user.id;
    item.innerHTML = `${avatarHTML(d.user, 32, d.user.status || 'offline')}<span class="dm-name">${escapeHtml(d.user ? (d.user.display_name || d.user.username) : 'Unknown')}</span>`;
    item.addEventListener('click', () => openDM(d));
    list.appendChild(item);
  }
  const add = document.createElement('div');
  add.className = 'dm-item';
  add.innerHTML = `<div class="avatar" style="width:32px;height:32px;font-size:14px;background:#5865f2">${icon('plus')}</div><span class="dm-name">${t('Start a conversation')}</span>`;
  add.addEventListener('click', openNewDM);
  list.appendChild(add);
}

async function openDM(d) {
  state.server = null; state.channel = null; state.view = 'home';
  setReplyTo(null);
  if (state.dm && state.dm.id !== d.id) socket.emit('leave_dm', state.dm.id);
  state.dm = d;
  state.usersCache[d.user.id] = d.user;
  renderRail();
  $('rail-home').classList.add('active');
  $('sidebar-name').textContent = 'Direct Messages';
  renderDMList();
  $('chat-hash').style.display = 'none';
  $('chat-title').textContent = d.user.display_name || d.user.username;
  $('chat-title').style.cursor = 'pointer';
  $('chat-title').onclick = () => openProfile(d.user);
  $('chat-topic').textContent = '';
  $('members').innerHTML = '';
  socket.emit('join_dm', d.id);
  const { messages } = await api('/api/dms/' + d.id + '/messages');
  state.messages = messages;
  renderMessages();
  $('composer').classList.remove('hidden');
  $('message-input').placeholder = 'Write a direct message to @' + d.user.username + '\u2026';
  $('composer-hint').textContent = '';
  $('message-input').focus();
}

/* Right-click menu for a direct message in the sidebar. */
function openDMContextMenu(x, y, dmid) {
  const d = state.dms.find(x => x.id === dmid);
  if (!d) return;
  const u = d.user || {};
  const isFriend = !!(state.friends && state.friends.friends.some(f => f.id === u.id));
  const isBlocked = !!(state.friends && state.friends.blocked.some(f => f.id === u.id));
  const items = [
    { label: 'Mark As Read', icon: 'check', onClick: () => { toast('Marked as read', 'success'); } },
    { label: 'Close DM', icon: 'xmark', onClick: () => closeDM(d) },
    { sep: true },
    { label: 'Copy User ID', icon: 'id-badge', onClick: () => { navigator.clipboard.writeText(u.id || '').then(() => toast('User ID copied', 'success')).catch(() => {}); } }
  ];
  if (isFriend) {
    items.push({ sep: true });
    items.push({ label: 'Unfriend', icon: 'user-minus', danger: true, onClick: () => friendAction('remove', u.id) });
  }
  if (isBlocked) {
    items.push({ label: 'Unblock', icon: 'unlock', onClick: () => friendAction('unblock', u.id) });
  } else {
    items.push({ label: 'Block', icon: 'ban', danger: true, onClick: () => friendAction('block', u.id) });
  }
  showContextMenu(x, y, items);
}

async function closeDM(d) {
  try {
    await api('/api/dms/' + d.id + '/close', { method: 'POST' });
    if (state.dm && state.dm.id === d.id) { state.dm = null; showHome(); }
    await loadDMs();
    toast('Conversation closed', 'success');
  } catch (e) { toast(e.message, 'error'); }
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
  setReplyTo(null);
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
  animateView();
}

function emptyFriends(msg) { return `<div class="fr-empty">${msg}</div>`; }

function friendRow(u, kind) {
  const name = escapeHtml(u.display_name || u.username);
  const status = u.status === 'offline' ? 'Offline' : statusLabel(u.status);
  let actions = '';
  if (kind === 'friend') {
    actions = `<button class="fr-act" data-fr-msg="${u.id}" title="Message">${icon('comment')}</button>
               <button class="fr-act" data-fr-act="remove" data-uid="${u.id}" title="Remove Friend">${icon('user-minus')}</button>`;
  } else if (kind === 'incoming') {
    actions = `<button class="fr-act ok" data-fr-act="accept" data-uid="${u.id}" title="Accept">${icon('check')}</button>
               <button class="fr-act no" data-fr-act="decline" data-uid="${u.id}" title="Decline">${icon('xmark')}</button>`;
  } else if (kind === 'outgoing') {
    actions = `<button class="fr-act" data-fr-act="cancel" data-uid="${u.id}" title="Cancel Request">${icon('xmark')}</button>`;
  } else if (kind === 'blocked') {
    actions = `<button class="fr-act ok" data-fr-act="unblock" data-uid="${u.id}" title="Unblock">${icon('unlock')}</button>`;
  }
  return `<div class="fr-row" data-uid="${u.id}">
    ${avatarHTML(u, 32, u.status || 'offline')}
    <div class="fr-info"><div class="fr-name">${name}<span class="fr-tag">#${u.discriminator}</span></div><div class="fr-status">${status}</div></div>
    <div class="fr-actions">${actions}</div>
  </div>`;
}

function renderFriendsView() {
  const box = $('messages');
  box.style.padding = ''; box.style.overflow = '';
  const f = state.friends || { friends: [], incoming: [], outgoing: [], blocked: [] };
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
      <h4>${t('Add Friend')}</h4>
      <p>You can add friends with their username and tag. Type a full tag like <b>test#6842</b>, or search by username to pick from the list below.</p>
      <div class="fr-add-row">
        <input id="fr-add-input" placeholder="Enter a username or tag, e.g. test#6842" autocomplete="off">
        <button class="btn" id="fr-add-btn">${t('Send Friend Request')}</button>
      </div>
      <div class="fr-add-hint" id="fr-add-hint"></div>
      <div class="fr-search-results" id="fr-search-results"></div>
    </div>`;
  } else if (tab === 'pending') {
    const inc = f.incoming.map(u => friendRow(u, 'incoming')).join('');
    const out = f.outgoing.map(u => friendRow(u, 'outgoing')).join('');
    body = `<div class="fr-cat">Incoming Requests \u2014 ${f.incoming.length}</div>${inc || emptyFriends('No incoming requests.')}
            <div class="fr-cat">Outgoing Requests \u2014 ${f.outgoing.length}</div>${out || emptyFriends('No outgoing requests.')}`;
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
        ${tabBtn('online', t('Online'), counts.online)}
        ${tabBtn('all', t('All'), counts.all)}
        ${tabBtn('pending', t('Pending'), counts.pending)}
        ${tabBtn('blocked', t('Blocked'), counts.blocked)}
      </div>
      <button class="fr-add-friend${tab === 'add' ? ' active' : ''}" data-tab="add">${icon('user-plus')} ${t('Add Friend')}</button>
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
    let searchTimer = null;
    ai.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const q = ai.value.trim();
      const res = $('fr-search-results');
      if (!q || q.length < 2) { if (res) res.innerHTML = ''; return; }
      searchTimer = setTimeout(() => searchUsersForFriend(q), 250);
    });
  }
}

function relationshipOf(uid) {
  const f = state.friends;
  if (!f) return 'none';
  if (f.friends.some(x => x.id === uid)) return 'friends';
  if (f.outgoing.some(x => x.id === uid)) return 'pending_outgoing';
  if (f.incoming.some(x => x.id === uid)) return 'pending_incoming';
  if (f.blocked.some(x => x.id === uid)) return 'blocked';
  return 'none';
}

async function searchUsersForFriend(q) {
  const box = $('fr-search-results');
  if (!box) return;
  try {
    const { users } = await api('/api/users?q=' + encodeURIComponent(q));
    const list = users.filter(u => u.id !== me.id).slice(0, 12);
    if (!list.length) { box.innerHTML = `<div class="fr-search-empty">No users match \u201c${escapeHtml(q)}\u201d.</div>`; return; }
    box.innerHTML = list.map(u => {
      const rel = relationshipOf(u.id);
      const label = REL_LABEL[rel] || 'Add Friend';
      const disabled = rel !== 'none';
      return `<div class="fr-search-row" data-uid="${u.id}">
        ${avatarHTML(u, 32, u.status || 'offline')}
        <div class="fr-search-info"><div class="fr-name">${escapeHtml(u.display_name || u.username)}<span class="fr-tag">#${escapeHtml(u.discriminator)}</span></div></div>
        <button class="btn fr-search-add" data-uid="${u.id}" ${disabled ? 'disabled' : ''}>${escapeHtml(label)}</button>
      </div>`;
    }).join('');
    box.querySelectorAll('.fr-search-add').forEach(btn => btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const u = list.find(x => x.id === btn.dataset.uid);
      if (u) { await addFriendByTag(fullTag(u)); searchUsersForFriend(q); }
    }));
  } catch (e) { /* ignore */ }
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
    if (hint) { hint.textContent = msg; hint.className = 'fr-add-hint ok'; }
    toast(msg, 'success');
    await loadFriends(); renderDMList(); refreshFriendCounts();
    const ai = $('fr-add-input'); if (ai) ai.value = '';
  } catch (e) {
    if (hint) { hint.textContent = e.message; hint.className = 'fr-add-hint bad'; }
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
    else if (act === 'remove') {
      const ok = await confirmDialog({ title: 'Remove Friend', body: 'Are you sure you want to remove this friend?', confirmText: 'Remove Friend', danger: true });
      if (!ok) return;
      await api('/api/friends/' + uid, { method: 'DELETE' });
    }
    else if (act === 'block') {
      const ok = await confirmDialog({ title: 'Block User', body: 'They will be removed from your friends and will not be able to message you.', confirmText: 'Block', danger: true });
      if (!ok) return;
      await api('/api/blocks', { method: 'POST', body: JSON.stringify({ userId: uid }) });
    }
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
  setReplyTo(null);
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
  const admin = amIAdmin();

  const tcat = document.createElement('div');
  tcat.className = 'channel-category';
  tcat.innerHTML = `${icon('caret-down')} ${t('Text Channels')}`;
  list.appendChild(tcat);
  for (const c of textChannels) list.appendChild(channelRow(c));
  if (admin) {
    const tadd = document.createElement('div');
    tadd.className = 'channel-add';
    tadd.innerHTML = `${icon('plus')} ${t('Create Channel')}`;
    tadd.addEventListener('click', () => openCreateChannel('text'));
    list.appendChild(tadd);
  }

  const vcat = document.createElement('div');
  vcat.className = 'channel-category';
  vcat.innerHTML = `${icon('caret-down')} ${t('Voice Channels')}`;
  list.appendChild(vcat);
  for (const c of voiceChannels) list.appendChild(channelRow(c));
  if (admin) {
    const vadd = document.createElement('div');
    vadd.className = 'channel-add';
    vadd.innerHTML = `${icon('plus')} ${t('Create Channel')}`;
    vadd.addEventListener('click', () => openCreateChannel('voice'));
    list.appendChild(vadd);
  }
}

function channelRow(c) {
  const row = document.createElement('div');
  row.className = 'channel' + (state.channel && state.channel.id === c.id ? ' active' : '');
  row.dataset.cid = c.id;
  const ic = c.type === 'voice' ? icon('volume-high') : icon('hash');
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
  setReplyTo(null);
  document.querySelectorAll('.channel').forEach(el => el.classList.toggle('active', el.dataset.cid === cid));
  socket.emit('join_channel', cid);
  $('chat-hash').style.display = '';
  $('chat-hash').innerHTML = icon('hash');
  $('chat-title').textContent = c.name;
  $('chat-title').style.cursor = '';
  $('chat-title').onclick = null;
  $('chat-topic').textContent = c.topic || '';
  const { messages } = await api('/api/channels/' + cid + '/messages');
  state.messages = messages;
  renderMessages();
  $('composer').classList.remove('hidden');
  $('message-input').placeholder = 'Message #' + c.name + '\u2026';
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
      const crown = (state.server.owner_id === m.id) ? `<span class="owner-crown">${icon('crown')}</span>` : '';
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
    <p>${text || 'Select a server on the left or open a direct message to begin. You can also create your own server and invite others with a short gg/ link.'}</p>
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
    intro.innerHTML = `<div class="big-avatar">${icon('hash')}</div><h2>Welcome to #${escapeHtml(state.channel.name)}</h2><p>This is the start of the #${escapeHtml(state.channel.name)} channel.</p>`;
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
    const grouped = prev && prev.author && m.author && prev.author.id === m.author.id && (m.created_at - prev.created_at) < 5 * 60 * 1000 && !m.reply_to;
    inner.appendChild(messageNode(m, grouped));
    prev = m;
  }
  scrollToBottom();
}

function replyRefHTML(r) {
  const name = r.author ? (r.author.display_name || r.author.username) : 'Unknown';
  const txt = r.content ? r.content : (r.attachment_name ? 'Attachment' : 'Message');
  const ava = r.author ? `<span class="rr-ava">${r.author.avatar_url ? `<img src="${escapeHtml(r.author.avatar_url)}" alt="">` : ''}</span>` : '';
  return `<div class="reply-ref" data-jump="${r.id}"><span class="rr-line"></span>${ava}<span class="rr-name">${escapeHtml(name)}</span><span class="rr-text">${escapeHtml(txt)}</span></div>`;
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
      <button data-act="react" title="Add Reaction">${icon('smile-plus')}</button>
      <button data-act="reply" title="Reply">${icon('reply')}</button>
      <button data-act="more" title="More">${icon('ellipsis-vertical')}</button>
    </div>`;
  node.innerHTML = `${toolbar}${gutter}<div class="body">${m.reply_to ? replyRefHTML(m.reply_to) : ''}${head}
    <div class="text" data-content>${m.pinned ? `<span class="msg-pin" title="Pinned message">${icon('pin')}</span>` : ''}${formatContent(m.content)}</div>
    <div class="attachment-slot"></div>
    <div class="embed-slot"></div>
    <div class="reactions">${reactionsHTML(m.reactions)}</div>
  </div>`;

  const authorEl = node.querySelector('.author');
  if (authorEl) authorEl.addEventListener('click', () => openProfile(a));
  const gutterAv = node.querySelector('.gutter .avatar');
  if (gutterAv) { gutterAv.style.cursor = 'pointer'; gutterAv.addEventListener('click', () => openProfile(a)); }

  const jump = node.querySelector('.reply-ref');
  if (jump) jump.addEventListener('click', () => flashMessage(jump.dataset.jump));

  if (m.attachment_url) node.querySelector('.attachment-slot').appendChild(attachmentNode(m));
  const slot = node.querySelector('.embed-slot');
  const inviteCodes = extractInviteCodes(m.content);
  if (inviteCodes.length) {
    inviteCodes.slice(0, 1).forEach(c => slot.appendChild(inviteEmbedNode(c)));
  }
  const urls = extractUrls(m.content).filter(u => !/[?&]invite=/i.test(u));
  if (urls.length) {
    urls.slice(0, 2).forEach(u => slot.appendChild(embedNode(u)));
  }
  node.querySelectorAll('.reaction').forEach(r => r.addEventListener('click', () => toggleReaction(m.id, r.dataset.emoji)));
  node.querySelectorAll('.msg-toolbar button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const act = btn.dataset.act;
      if (act === 'react') openReactionPickerAt(btn.getBoundingClientRect().left - 140, btn.getBoundingClientRect().bottom + 8, m.id);
      else if (act === 'reply') setReplyTo(m);
      else if (act === 'more') { const r = btn.getBoundingClientRect(); openMessageContextMenu(r.right - 200, r.bottom + 4, m); }
    });
  });
  return node;
}

function appendMessage(m) {
  const inner = $('messages-inner');
  if (!inner) { renderMessages(); return; }
  const prev = state.messages[state.messages.length - 2];
  const grouped = prev && prev.author && m.author && prev.author.id === m.author.id && (m.created_at - prev.created_at) < 5 * 60 * 1000 && !m.reply_to;
  inner.appendChild(messageNode(m, grouped, true));
  scrollToBottom();
}

function userByName(name) {
  const lc = (name || '').toLowerCase();
  if (me && me.username && me.username.toLowerCase() === lc) return me;
  for (const id in state.usersCache) {
    const u = state.usersCache[id];
    if (u && u.username && u.username.toLowerCase() === lc) return u;
  }
  return null;
}

function formatContent(text) {
  if (!text) return '';
  let html = escapeHtml(text);
  const links = [];
  html = html.replace(/(https?:\/\/[^\s<]+)/g, (u) => { links.push(u); return `\u0000L${links.length - 1}\u0000`; });
  html = html.replace(/(^|[\s(])(gg\/[A-Za-z0-9_-]{4,64})/g, '$1<span class="invite-code">$2</span>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/@([a-zA-Z0-9._]+)/g, (mt, name) => {
    const u = userByName(name);
    const isMe = u ? u.id === me.id : (name.toLowerCase() === (me.username || '').toLowerCase());
    const uidAttr = u ? ` data-uid="${u.id}"` : '';
    return `<span class="mention${isMe ? ' me' : ''}"${uidAttr}>@${name}</span>`;
  });
  html = html.replace(/(^|[\s(])#([a-z0-9-]+)/g, '$1<span class="mention" data-channel="$2">#$2</span>');
  html = html.replace(/\u0000L(\d+)\u0000/g, (mt, i) => `<a href="${links[i]}" target="_blank" rel="noopener">${links[i]}</a>`);
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

/* Show / hide the little pin badge on a message without a full re-render. */
function updatePinIndicator(mid, pinned) {
  const text = document.querySelector(`[data-mid="${mid}"] .text[data-content]`);
  if (!text) return;
  let badge = text.querySelector('.msg-pin');
  if (pinned && !badge) {
    text.insertAdjacentHTML('afterbegin', `<span class="msg-pin" title="Pinned message">${icon('pin')}</span>`);
  } else if (!pinned && badge) {
    badge.remove();
  }
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
    wrap.innerHTML = `<div class="file-card"><div class="fi">${icon('file')}</div><div><a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(m.attachment_name || 'file')}</a><div class="fsize">Click to download</div></div></div>`;
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
      </div>${data.image ? `<img class="embed-thumb" src="${escapeHtml(data.image)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}`;
  }).catch(() => { wrap.remove(); });
  return wrap;
}

/* Find short "gg/<code>" invite codes (and full ?invite= URLs) inside a message. */
function extractInviteCodes(text) {
  if (!text) return [];
  const found = [];
  const seen = new Set();
  const gg = text.match(/(?:^|[\s(])(?:gg|invite)\/([A-Za-z0-9_-]{4,64})/gi) || [];
  for (const raw of gg) {
    const m = raw.match(/(?:gg|invite)\/([A-Za-z0-9_-]{4,64})/i);
    if (m && !seen.has(m[1])) { seen.add(m[1]); found.push(m[1]); }
  }
  const urls = text.match(/https?:\/\/[^\s<]*[?&]invite=([A-Za-z0-9_-]{4,64})/gi) || [];
  for (const raw of urls) {
    const m = raw.match(/[?&]invite=([A-Za-z0-9_-]{4,64})/i);
    if (m && !seen.has(m[1])) { seen.add(m[1]); found.push(m[1]); }
  }
  return found;
}

/* Rich embed card for a server invite (banner, name, member counts, Join). */
function inviteEmbedNode(code) {
  const wrap = document.createElement('div');
  wrap.className = 'invite-embed';
  wrap.innerHTML = `<div class="ie-loading"><span class="ie-spinner"></span>Loading invite\u2026</div>`;
  api('/api/invites/' + encodeURIComponent(code)).then(data => {
    if (!data || !data.server) { wrap.remove(); return; }
    const s = data.server;
    const bannerStyle = s.banner_url
      ? `background-image:url('${escapeHtml(s.banner_url)}')`
      : `background:linear-gradient(135deg, var(--brand), color-mix(in srgb, var(--brand) 45%, #000))`;
    const icon = s.icon_url
      ? `<img class="ie-icon" src="${escapeHtml(s.icon_url)}" alt="">`
      : `<div class="ie-icon ie-icon-fallback">${escapeHtml((s.name || '?')[0].toUpperCase())}</div>`;
    const status = !data.valid
      ? `<span class="ie-badge bad">${data.expired ? 'Expired' : 'Max uses reached'}</span>`
      : `<span class="ie-badge ok">Invite valid</span>`;
    const joinLabel = data.already_member ? 'Open Server' : 'Join Server';
    wrap.innerHTML = `
      <div class="ie-banner" style="${bannerStyle}">
        <div class="ie-banner-shade"></div>
        <div class="ie-banner-title">You have been invited to join a server</div>
      </div>
      <div class="ie-main">
        <div class="ie-head">
          ${icon}
          <div class="ie-headtext">
            <div class="ie-name">${escapeHtml(s.name)}</div>
            <div class="ie-stats">
              <span class="ie-dot online"></span>${s.online_count} Online
              <span class="ie-dot total"></span>${s.member_count} Member${s.member_count === 1 ? '' : 's'}
            </div>
          </div>
          ${status}
        </div>
        ${s.description ? `<div class="ie-desc">${escapeHtml(s.description)}</div>` : ''}
        <button class="ie-join" ${data.valid || data.already_member ? '' : 'disabled'}>${escapeHtml(joinLabel)}</button>
      </div>`;
    const btn = wrap.querySelector('.ie-join');
    if (btn) btn.addEventListener('click', async () => {
      if (!data.valid && !data.already_member) return;
      try {
        const res = await api('/api/servers/join', { method: 'POST', body: JSON.stringify({ invite: code }) });
        await loadServers();
        openServer(res.server.id);
        toast('Joined ' + res.server.name, 'success');
      } catch (e) { toast(e.message, 'error'); }
    });
  }).catch(() => { wrap.remove(); });
  return wrap;
}

function scrollToBottom() {
  const box = $('messages');
  box.scrollTop = box.scrollHeight;
}

/* Subtle enter animation whenever the user switches server / DM / channel. */
function animateView() {
  const box = $('messages');
  if (!box) return;
  box.classList.remove('view-enter');
  void box.offsetWidth;
  box.classList.add('view-enter');
}

function flashMessage(mid) {
  const node = document.querySelector(`[data-mid="${mid}"]`);
  if (!node) { toast('Original message is not loaded'); return; }
  node.scrollIntoView({ behavior: 'smooth', block: 'center' });
  node.classList.remove('flash');
  void node.offsetWidth;
  node.classList.add('flash');
  setTimeout(() => node.classList.remove('flash'), 1500);
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
  if (state.replyTo) payload.reply_to_id = state.replyTo.id;

  input.value = '';
  autoGrow(input);
  clearAttachment();
  setReplyTo(null);
  closeMentionPop();
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

/* ---------------- Reply bar ---------------- */
function setReplyTo(m) {
  state.replyTo = m || null;
  renderReplyBar();
  if (m) { const i = $('message-input'); if (i) i.focus(); }
}
function renderReplyBar() {
  const bar = $('reply-bar');
  if (!bar) return;
  const m = state.replyTo;
  if (!m) { bar.classList.add('hidden'); $('composer-box').classList.remove('replying'); return; }
  bar.classList.remove('hidden');
  $('composer-box').classList.add('replying');
  const name = m.author.display_name || m.author.username;
  const txt = m.content ? m.content.slice(0, 120) : 'Attachment';
  bar.innerHTML = `<span class="rb-text">Replying to <b>${escapeHtml(name)}</b> \u2014 ${escapeHtml(txt)}</span><button id="rb-cancel" title="Cancel Reply">${icon('xmark')}</button>`;
  $('rb-cancel').addEventListener('click', () => setReplyTo(null));
}

/* ---------------- @ mention autocomplete ---------------- */
function mentionCandidates() {
  const map = {};
  const add = (u) => { if (u && u.id) map[u.id] = u; };
  if (state.members) state.members.forEach(add);
  if (state.dm && state.dm.user) add(state.dm.user);
  if (state.friends) state.friends.friends.forEach(add);
  Object.values(state.usersCache).forEach(add);
  return Object.values(map);
}
function updateMentionAutocomplete() {
  const ta = $('message-input');
  const caret = ta.selectionStart;
  const before = ta.value.slice(0, caret);
  const m = before.match(/(?:^|\s)@([a-zA-Z0-9._]{0,32})$/);
  if (!m) { closeMentionPop(); return; }
  const q = m[1].toLowerCase();
  const start = caret - m[1].length - 1;
  const cands = mentionCandidates().filter(u => {
    const un = (u.username || '').toLowerCase();
    const dn = (u.display_name || '').toLowerCase();
    return !q || un.includes(q) || dn.includes(q);
  }).sort((a, b) => {
    const an = (a.username || '').toLowerCase().startsWith(q) ? 0 : 1;
    const bn = (b.username || '').toLowerCase().startsWith(q) ? 0 : 1;
    return an - bn;
  }).slice(0, 8);
  if (!cands.length) { closeMentionPop(); return; }
  state.mention = { active: true, query: q, items: cands, sel: 0, start };
  renderMentionPop();
}
function renderMentionPop() {
  const old = $('mention-pop'); if (old) old.remove();
  if (!state.mention.active) return;
  const box = $('composer-box').getBoundingClientRect();
  const pop = document.createElement('div');
  pop.className = 'mention-pop';
  pop.id = 'mention-pop';
  pop.innerHTML = `<div class="mp-head">Members</div>` + state.mention.items.map((u, i) =>
    `<div class="mp-item${i === state.mention.sel ? ' sel' : ''}" data-i="${i}">${avatarHTML(u, 24, u.status || 'offline')}<div><div class="mp-name">${escapeHtml(u.display_name || u.username)}</div><div class="mp-tag">#${u.discriminator}</div></div></div>`).join('');
  document.body.appendChild(pop);
  const ph = pop.offsetHeight;
  pop.style.left = box.left + 'px';
  pop.style.top = Math.max(8, box.top - ph - 8) + 'px';
  pop.querySelectorAll('.mp-item').forEach(el => el.addEventListener('mousedown', (e) => { e.preventDefault(); insertMention(state.mention.items[+el.dataset.i]); }));
}
function insertMention(u) {
  const ta = $('message-input');
  const caret = ta.selectionStart;
  const before = ta.value.slice(0, state.mention.start);
  const after = ta.value.slice(caret);
  const insert = '@' + u.username + ' ';
  ta.value = before + insert + after;
  const pos = (before + insert).length;
  ta.setSelectionRange(pos, pos);
  closeMentionPop();
  ta.focus();
  autoGrow(ta);
}
function closeMentionPop() {
  const el = $('mention-pop'); if (el) el.remove();
  state.mention.active = false;
}

/* ---------------- Attachments ---------------- */
async function handleFile(file) {
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) { toast('File is too large (maximum 25 MB)', 'error'); return; }
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
  const thumb = (a.type || '').startsWith('image/') ? `<img src="${escapeHtml(a.url)}">` : `<div class="fi" style="width:48px;height:48px;border-radius:6px;background:#5865f2;display:grid;place-items:center;color:#fff">${icon('file')}</div>`;
  p.innerHTML = `${thumb}<span class="ap-name">${escapeHtml(a.name)}</span><button id="ap-remove">${icon('xmark')}</button>`;
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

function openReactionPickerAt(x, y, mid) {
  closePopovers();
  const picker = document.createElement('div');
  picker.className = 'emoji-picker';
  picker.id = 'reaction-picker';
  picker.style.position = 'fixed';
  picker.style.top = Math.max(8, Math.min(y, window.innerHeight - 340)) + 'px';
  picker.style.left = Math.max(8, Math.min(x, window.innerWidth - 340)) + 'px';
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
  document.querySelectorAll('.emoji-picker, .context-menu, .dropdown-menu, .notif-panel, .pins-panel').forEach(el => el.remove());
  closeMiniProfile();
  closeCustomSelects();
  closeMentionPop();
}

async function deleteMessage(mid) {
  const ok = await confirmDialog({ title: 'Delete Message', body: 'Are you sure you want to delete this message? This cannot be undone.', confirmText: 'Delete', danger: true });
  if (!ok) return;
  try {
    await api('/api/messages/' + mid, { method: 'DELETE' });
    const node = document.querySelector(`[data-mid="${mid}"]`);
    if (node) node.remove();
    state.messages = state.messages.filter(x => x.id !== mid);
  } catch (e) { toast(e.message, 'error'); }
}

/* Small anchored dropdown used by the profile "more" button. */
function dropdownMenu(anchor, items) {
  closePopovers();
  const menu = document.createElement('div');
  menu.className = 'dropdown-menu';
  const rect = anchor.getBoundingClientRect();
  menu.innerHTML = items.map((it, i) => it.sep ? '<div class="ctx-sep"></div>' : `<button data-i="${i}"${it.danger ? ' class="danger"' : ''}>${it.icon ? icon(it.icon) : ''}<span>${escapeHtml(it.label)}</span></button>`).join('');
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
    const item = items[+b.dataset.i];
    if (item && item.onClick) item.onClick();
  }));
  return menu;
}

/* ---------------- Context menu ---------------- */
function showContextMenu(x, y, items) {
  closePopovers();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.innerHTML = items.map((it, i) => it.sep ? '<div class="ctx-sep"></div>'
    : `<button data-i="${i}"${it.danger ? ' class="danger"' : ''}>${it.icon ? icon(it.icon) : ''}<span>${escapeHtml(it.label)}</span></button>`).join('');
  document.body.appendChild(menu);
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = Math.max(8, Math.min(x, window.innerWidth - mw - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, window.innerHeight - mh - 8)) + 'px';
  menu.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    const it = items[+b.dataset.i];
    menu.remove();
    if (it && it.onClick) it.onClick();
  }));
}

function openMessageContextMenu(x, y, m) {
  const items = [
    { label: 'Add Reaction', icon: 'smile-plus', onClick: () => openReactionPickerAt(x, y, m.id) },
    { label: 'Reply', icon: 'reply', onClick: () => setReplyTo(m) },
    { label: m.pinned ? 'Unpin Message' : 'Pin Message', icon: 'pin', onClick: () => togglePin(m) },
    { label: 'Copy Text', icon: 'copy', onClick: () => { navigator.clipboard.writeText(m.content || '').then(() => toast('Copied to clipboard', 'success')).catch(() => {}); } },
    { label: 'Copy Message Link', icon: 'link', onClick: () => { navigator.clipboard.writeText(location.origin + '/app.html?msg=' + m.id).then(() => toast('Message link copied', 'success')).catch(() => {}); } }
  ];
  if (m.author.id === me.id) {
    items.push({ sep: true });
    items.push({ label: 'Delete Message', icon: 'trash', danger: true, onClick: () => deleteMessage(m.id) });
  }
  showContextMenu(x, y, items);
}

async function togglePin(m) {
  try {
    if (m.pinned) {
      await api('/api/messages/' + m.id + '/pin', { method: 'DELETE' });
      m.pinned = false;
      toast('Message unpinned', 'success');
    } else {
      await api('/api/messages/' + m.id + '/pin', { method: 'POST' });
      m.pinned = true;
      toast('Message pinned to this conversation', 'success');
    }
    updatePinIndicator(m.id, m.pinned);
    if ($('pins-panel')) loadPins();
  } catch (e) { toast(e.message, 'error'); }
}

/* ============================================================
   NOTIFICATIONS
   ============================================================ */
async function loadNotifications() {
  try {
    const { notifications, unread } = await api('/api/notifications');
    state.notifications = notifications || [];
    state.unread = unread || 0;
    renderNotifBadge();
  } catch (e) { /* ignore */ }
}

function renderNotifBadge() {
  const b = $('notif-badge');
  if (!b) return;
  if (state.unread > 0) { b.classList.remove('hidden'); b.textContent = state.unread > 99 ? '99+' : state.unread; }
  else b.classList.add('hidden');
}

function notifInfo(n) {
  const d = n.data || {};
  const u = d.user || (d.message && d.message.author);
  const name = u ? (u.display_name || u.username) : 'Someone';
  const where = d.kind === 'channel' ? `in #${d.channel_name || 'a channel'}` : (d.kind === 'dm' ? 'in a direct message' : '');
  const preview = d.message && d.message.content ? d.message.content : '';
  let ico = 'bell', plain = 'New notification', html = 'New notification';
  if (n.type === 'friend_request') { ico = 'user-plus'; plain = `${name} sent you a friend request`; html = `<b>${escapeHtml(name)}</b> sent you a friend request`; }
  else if (n.type === 'friend_accepted') { ico = 'user-check'; plain = `${name} accepted your friend request`; html = `<b>${escapeHtml(name)}</b> accepted your friend request`; }
  else if (n.type === 'mention') { ico = 'at-sign'; plain = `${name} mentioned you ${where}`; html = `<b>${escapeHtml(name)}</b> mentioned you ${escapeHtml(where)}`; }
  else if (n.type === 'reply') { ico = 'reply'; plain = `${name} replied to you ${where}`; html = `<b>${escapeHtml(name)}</b> replied to you ${escapeHtml(where)}`; }
  return { ico, plain, html, preview, user: u, where };
}

function renderNotifList() {
  const list = $('notif-list');
  if (!list) return;
  if (!state.notifications.length) {
    list.innerHTML = `<div class="notif-empty"><div class="ne-ico">${icon('bell')}</div>No notifications yet.</div>`;
    return;
  }
  list.innerHTML = state.notifications.map((n, i) => {
    const info = notifInfo(n);
    const ava = info.user ? avatarHTML(info.user, 36, info.user.status || 'offline') : `<div class="avatar" style="width:36px;height:36px;font-size:15px;background:var(--brand)">${icon('bell')}</div>`;
    return `<div class="notif-item${n.read ? '' : ' unread'}" data-i="${i}">
      <div class="ni-ava">${ava}</div>
      <div class="ni-body">
        <div class="ni-title">${info.html}</div>
        ${info.preview ? `<div class="ni-preview">${escapeHtml(info.preview)}</div>` : ''}
        <div class="ni-time">${formatTime(n.created_at)}</div>
      </div>
      <span class="ni-ico">${icon(info.ico)}</span>
    </div>`;
  }).join('');
  list.querySelectorAll('.notif-item').forEach(el => el.addEventListener('click', () => {
    const n = state.notifications[+el.dataset.i];
    if (n) goToNotification(n);
  }));
}

async function markAllRead() {
  try { await api('/api/notifications/read', { method: 'POST' }); } catch (e) { /* ignore */ }
  state.unread = 0;
  state.notifications.forEach(n => { n.read = true; });
  renderNotifBadge();
  renderNotifList();
}

function openNotifPanel() {
  const existing = $('notif-panel');
  if (existing) { existing.remove(); return; }
  closePopovers();
  const panel = document.createElement('div');
  panel.className = 'notif-panel';
  panel.id = 'notif-panel';
  panel.innerHTML = `<div class="np-head"><h4>Notifications</h4><button id="np-read">Mark all as read</button></div><div class="notif-list" id="notif-list"></div>`;
  document.body.appendChild(panel);
  const r = $('hdr-notifs').getBoundingClientRect();
  panel.style.top = (r.bottom + 8) + 'px';
  panel.style.left = Math.max(8, Math.min(r.right - 380, window.innerWidth - 388)) + 'px';
  renderNotifList();
  $('np-read').addEventListener('click', markAllRead);
  if (state.unread > 0) {
    api('/api/notifications/read', { method: 'POST' }).catch(() => {});
    state.unread = 0;
    renderNotifBadge();
  }
}

async function goToNotification(n) {
  const d = n.data || {};
  const panel = $('notif-panel'); if (panel) panel.remove();
  const u = d.user || (d.message && d.message.author);
  if (n.type === 'friend_request' || n.type === 'friend_accepted') {
    if (u) openProfile(u);
    return;
  }
  try {
    if (d.kind === 'channel' && d.server_id) {
      await openServer(d.server_id);
      await openChannel(d.channel_id);
    } else if (d.kind === 'dm' && d.dm_id) {
      await loadDMs();
      const dm = state.dms.find(x => x.id === d.dm_id);
      if (dm) await openDM(dm);
    }
    const mid = d.message && d.message.id;
    if (mid) setTimeout(() => flashMessage(mid), 350);
  } catch (e) { /* ignore */ }
}

/* ============================================================
   PINNED MESSAGES
   ============================================================ */
function openPinsPanel() {
  const existing = $('pins-panel');
  if (existing) { existing.remove(); return; }
  if (!state.channel && !state.dm) { toast('Open a channel or direct message first'); return; }
  closePopovers();
  const panel = document.createElement('div');
  panel.className = 'pins-panel';
  panel.id = 'pins-panel';
  panel.innerHTML = `<div class="np-head"><h4>${icon('pin')} Pinned Messages</h4><button id="pins-close">Close</button></div>
    <div class="pins-list" id="pins-list"><div class="notif-empty">Loading pins\u2026</div></div>`;
  document.body.appendChild(panel);
  const r = $('hdr-pins').getBoundingClientRect();
  panel.style.top = (r.bottom + 8) + 'px';
  panel.style.left = Math.max(8, Math.min(r.right - 400, window.innerWidth - 408)) + 'px';
  $('pins-close').addEventListener('click', () => panel.remove());
  loadPins();
}

async function loadPins() {
  const list = $('pins-list');
  if (!list) return;
  try {
    let pins = [];
    if (state.channel) { const res = await api('/api/channels/' + state.channel.id + '/pins'); pins = res.pins || []; }
    else if (state.dm) { const res = await api('/api/dms/' + state.dm.id + '/pins'); pins = res.pins || []; }
    renderPinsList(pins);
  } catch (e) {
    list.innerHTML = `<div class="notif-empty">${escapeHtml(e.message)}</div>`;
  }
}

function renderPinsList(pins) {
  const list = $('pins-list');
  if (!list) return;
  if (!pins || !pins.length) {
    list.innerHTML = `<div class="notif-empty"><div class="ne-ico">${icon('pin')}</div>No pinned messages yet.<br><span class="pin-hint">Right-click a message and choose Pin Message.</span></div>`;
    hydrateIcons(list);
    return;
  }
  list.innerHTML = pins.map(m => {
    const a = m.author || {};
    const name = escapeHtml(a.display_name || a.username || 'Unknown');
    const body = m.content ? formatContent(m.content) : (m.attachment_name ? `<span class="pin-attach">${escapeHtml(m.attachment_name)}</span>` : '<em>(no text)</em>');
    return `<div class="pin-item" data-mid="${m.id}">
      <div class="pin-ava">${avatarHTML(a, 36, a.status || 'offline')}</div>
      <div class="pin-body">
        <div class="pin-head"><span class="pin-author">${name}</span><span class="pin-time">${formatTime(m.created_at)}</span></div>
        <div class="pin-text">${body}</div>
      </div>
      <button class="pin-unpin" data-unpin="${m.id}" title="Unpin">${icon('xmark')}</button>
    </div>`;
  }).join('');
  hydrateIcons(list);
  list.querySelectorAll('.pin-item').forEach(el => el.addEventListener('click', (e) => {
    if (e.target.closest('[data-unpin]')) return;
    flashMessage(el.dataset.mid);
    const panel = $('pins-panel'); if (panel) panel.remove();
  }));
  list.querySelectorAll('[data-unpin]').forEach(btn => btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await api('/api/messages/' + btn.dataset.unpin + '/pin', { method: 'DELETE' });
      const m = state.messages.find(x => x.id === btn.dataset.unpin);
      if (m) { m.pinned = false; updatePinIndicator(m.id, false); }
      toast('Message unpinned', 'success');
      loadPins();
    } catch (err) { toast(err.message, 'error'); }
  }));
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
  hydrateIcons(modal);
}
function closeModal() { modalCloseGuard = null; $('modal-overlay').classList.add('hidden'); $('modal').innerHTML = ''; $('modal').className = 'modal'; }

let modalCloseGuard = null;
function requestCloseModal() {
  if (typeof modalCloseGuard === 'function') { modalCloseGuard(); return; }
  closeModal();
}

function showUnsavedDialog({ onSave, onDiscard }) {
  const existing = $('confirm-overlay');
  if (existing) existing.remove();
  const wrap = document.createElement('div');
  wrap.className = 'confirm-overlay';
  wrap.id = 'confirm-overlay';
  wrap.innerHTML = `
    <div class="confirm-box">
      <h3>Careful \u2014 you have unsaved changes!</h3>
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
    btn.disabled = true; btn.textContent = 'Saving\u2026';
    let ok = false;
    try { ok = await (onSave ? onSave() : true); } catch (e) { ok = false; }
    if (ok) close(); else { btn.disabled = false; btn.textContent = 'Save Changes'; }
  });
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
}

/* ---------------- Dropzone helper ---------------- */
function dropzoneHTML(id, label, sub) {
  return `<div class="dropzone" id="${id}" data-label="${escapeHtml(label)}" data-sub="${escapeHtml(sub)}">
    <div class="dz-ico">${icon('image')}</div>
    <div class="dz-title">${escapeHtml(label)}</div>
    <div class="dz-sub">${escapeHtml(sub)}</div>
  </div>`;
}
function dzClear(dz) {
  dz.classList.remove('has-preview');
  dz.innerHTML = `<div class="dz-ico">${icon('image')}</div><div class="dz-title">${escapeHtml(dz.dataset.label)}</div><div class="dz-sub">${escapeHtml(dz.dataset.sub)}</div>`;
}
function dzSetPreview(dz, url, onClear) {
  dz.classList.add('has-preview');
  dz.innerHTML = `<img class="dz-preview" src="${escapeHtml(url)}" alt=""><button class="dz-clear" type="button">${icon('xmark')}</button>`;
  dz.querySelector('.dz-clear').addEventListener('click', (e) => { e.stopPropagation(); dzClear(dz); if (onClear) onClear(); });
}
function wireDropzone(dz, input, onFile) {
  dz.addEventListener('click', (e) => { if (e.target.closest('.dz-clear')) return; input.click(); });
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('drag'); const f = e.dataTransfer.files[0]; if (f) onFile(f); });
  input.addEventListener('change', (e) => { const f = e.target.files[0]; if (f) onFile(f); e.target.value = ''; });
}
async function uploadImage(file, filename) {
  if (file.size > 25 * 1024 * 1024) throw new Error('Image is too large (maximum 25 MB)');
  const fd = new FormData();
  fd.append('file', file, filename || file.name || 'upload.png');
  return api('/api/upload', { method: 'POST', body: fd });
}

/* ---------------- Image scaler / cropper ----------------
   Lets the user zoom and reposition an avatar or banner before it is uploaded.
   The visible area is exported to a canvas at the target resolution. */
function openImageEditor(file, opts = {}) {
  const isBanner = opts.kind === 'banner';
  const cw = isBanner ? 420 : 260;
  const ch = isBanner ? Math.round(420 * 240 / 600) : 260;
  const outW = isBanner ? 600 : 512;
  const outH = isBanner ? 240 : 512;
  const isGif = /gif/i.test(file.type) || /\.gif$/i.test(file.name || '');

  const url = URL.createObjectURL(file);
  const wrap = document.createElement('div');
  wrap.className = 'img-editor-overlay';
  wrap.innerHTML = `
    <div class="img-editor">
      <h3>${escapeHtml(opts.title || 'Adjust Image')}</h3>
      <p class="ie-sub">Drag the image to reposition it, then use the slider to zoom. ${isBanner ? 'This is how your banner will appear.' : 'This is how your avatar will appear.'}</p>
      <div class="img-editor-stage" id="ie-stage" style="width:${cw}px;height:${ch}px;border-radius:${isBanner ? '12px' : '50%'}">
        <img id="ie-img" alt="" draggable="false">
      </div>
      <div class="img-editor-zoom">
        <span>Zoom</span>
        <input type="range" id="ie-zoom" min="1" max="3" step="0.01" value="1">
        <span id="ie-zoom-val">100%</span>
      </div>
      <div class="modal-actions">
        <button class="btn secondary" id="ie-cancel">Cancel</button>
        <button class="btn" id="ie-save">Save</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  const stage = wrap.querySelector('#ie-stage');
  const el = wrap.querySelector('#ie-img');
  const zoom = wrap.querySelector('#ie-zoom');
  const zoomVal = wrap.querySelector('#ie-zoom-val');
  let baseScale = 1, scale = 1, ox = 0, oy = 0, ready = false;
  let dragging = false, startX = 0, startY = 0, startOx = 0, startOy = 0;

  function render() {
    if (!ready) return;
    const dispW = el.naturalWidth * baseScale * scale;
    const dispH = el.naturalHeight * baseScale * scale;
    const maxOx = Math.max(0, (dispW - cw) / 2);
    const maxOy = Math.max(0, (dispH - ch) / 2);
    ox = Math.min(maxOx, Math.max(-maxOx, ox));
    oy = Math.min(maxOy, Math.max(-maxOy, oy));
    el.style.width = dispW + 'px';
    el.style.height = dispH + 'px';
    el.style.left = ((cw - dispW) / 2 + ox) + 'px';
    el.style.top = ((ch - dispH) / 2 + oy) + 'px';
  }

  el.addEventListener('load', () => {
    baseScale = Math.max(cw / el.naturalWidth, ch / el.naturalHeight);
    ready = true;
    render();
  });
  el.src = url;

  stage.addEventListener('pointerdown', (e) => {
    if (!ready) return;
    dragging = true; startX = e.clientX; startY = e.clientY; startOx = ox; startOy = oy;
    try { stage.setPointerCapture(e.pointerId); } catch (err) {}
    stage.classList.add('grabbing');
  });
  stage.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    ox = startOx + (e.clientX - startX);
    oy = startOy + (e.clientY - startY);
    render();
  });
  const endDrag = () => { dragging = false; stage.classList.remove('grabbing'); };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('wheel', (e) => {
    if (!ready) return;
    e.preventDefault();
    scale = Math.min(3, Math.max(1, scale - e.deltaY * 0.0015));
    zoom.value = scale;
    zoomVal.textContent = Math.round(scale * 100) + '%';
    render();
  }, { passive: false });
  zoom.addEventListener('input', () => {
    scale = parseFloat(zoom.value);
    zoomVal.textContent = Math.round(scale * 100) + '%';
    render();
  });

  const cleanup = () => { try { URL.revokeObjectURL(url); } catch (e) {} wrap.remove(); };
  const done = (blob, filename) => { cleanup(); if (opts.onSave) opts.onSave(blob, filename); };
  wrap.querySelector('#ie-cancel').addEventListener('click', cleanup);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) cleanup(); });

  wrap.querySelector('#ie-save').addEventListener('click', () => {
    if (!ready) return;
    // Keep the original animated GIF when it has not been scaled or moved.
    if (isGif && scale === 1 && ox === 0 && oy === 0) { done(file, file.name); return; }
    const canvas = document.createElement('canvas');
    canvas.width = outW; canvas.height = outH;
    const ctx = canvas.getContext('2d');
    const totalScale = baseScale * scale;
    const dispW = el.naturalWidth * totalScale;
    const dispH = el.naturalHeight * totalScale;
    const tlX = (cw - dispW) / 2 + ox;
    const tlY = (ch - dispH) / 2 + oy;
    const sx = (-tlX) / totalScale;
    const sy = (-tlY) / totalScale;
    const sw = cw / totalScale;
    const sh = ch / totalScale;
    try {
      ctx.drawImage(el, sx, sy, sw, sh, 0, 0, outW, outH);
    } catch (err) { toast('Could not process this image', 'error'); return; }
    canvas.toBlob((blob) => {
      if (!blob) { toast('Could not process this image', 'error'); return; }
      done(blob, (isBanner ? 'banner' : 'avatar') + '.png');
    }, 'image/png');
  });
}

/* ---------------- Create / join server ---------------- */
function openCreateServer() {
  openModal(`
    <h3>Create a Server</h3>
    <p class="msub">Your server is where you and your friends hang out. Make yours and start talking.</p>
    <div class="field"><label>Server Name <span class="req">*</span></label>
      <input id="cs-name" placeholder="e.g. Pixel Lounge, Study Group, Game Night\u2026" maxlength="40"></div>
    <div class="field"><label>Server Icon <span style="color:var(--text-muted);text-transform:none;font-weight:500">(optional)</span></label>
      ${dropzoneHTML('cs-icon-dz', 'Upload Image', 'PNG, JPG or GIF \u2014 up to 25 MB')}
      <input type="file" id="cs-icon-file" accept="image/*" class="hidden"></div>
    <div class="modal-actions">
      <button class="btn secondary" id="cs-cancel">Cancel</button>
      <button class="btn" id="cs-create">Create Server</button>
    </div>`);
  let iconUrl = null;
  const dz = $('cs-icon-dz');
  wireDropzone(dz, $('cs-icon-file'), async (f) => {
    try { const d = await uploadImage(f); iconUrl = d.url; dzSetPreview(dz, d.url, () => { iconUrl = null; }); toast('Icon ready', 'success'); }
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
    <p class="msub">Enter an invite code or link below to join an existing server. Invites look like <b>gg/AbC123xYz</b>.</p>
    <div class="field"><label>Invite Code or Link</label>
      <input id="js-invite" placeholder="Paste an invite code like gg/AbC123xYz\u2026 or a full link" value="${escapeHtml(prefill || '')}"></div>
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
      <input id="cc-name" placeholder="${type === 'voice' ? 'e.g. Lounge, Game Night\u2026' : 'e.g. general-chat, announcements\u2026'}" maxlength="40"></div>
    <div class="field"><label>Topic (optional)</label>
      <input id="cc-topic" placeholder="Give this channel a short purpose or topic\u2026"></div>
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
      <input id="dm-search" placeholder="Search for friends by name or tag\u2026" autocomplete="off"></div>
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
   PROFILE MODALS
   ============================================================ */
async function openProfile(user, opts = {}) {
  const isMe = user.id === me.id;
  state.openProfileId = user.id;
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

/* ---------- Your own profile ---------- */
function renderOwnProfile(user) {
  const displayName = user.display_name || user.username;
  const bannerColor = user.banner_color || user.accent_color || '#5865F2';
  const bannerStyle = user.banner_url
    ? `background-image:url('${escapeHtml(user.banner_url)}')`
    : `background:${bannerColor}`;
  const memberSince = new Date(user.created_at).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
  const swatches = PALETTE.map(c => `<span class="pnav-swatch${bannerColor.toLowerCase() === c.toLowerCase() ? ' sel' : ''}" data-color="${c}" style="background:${c}"></span>`).join('');
  const statusColor = { online: '#23a55a', idle: '#f0b232', dnd: '#f23f43', offline: '#80848e' }[user.status || 'online'] || '#23a55a';

  openModal(`
    <div class="profile-topbar">
      <div class="pt-title">Your Profile</div>
      <button class="pt-close" id="pf-x">${icon('xmark')}</button>
    </div>
    <div class="profile-body-grid">
      <div class="profile-nav">
        <div class="pnav-item">
          <div class="pnav-label">Preview</div>
          <div class="pnav-preview">
            <div class="pnav-avatar">${avatarHTML(user, 40, user.status || 'online')}</div>
            <div class="pnav-text">
              <div class="n1">${escapeHtml(displayName)}</div>
              <div class="n2">${escapeHtml(fullTag(user))}</div>
            </div>
          </div>
        </div>
        <div class="pnav-item">
          <div class="pnav-label">Banner Color</div>
          <div class="pnav-swatches" id="pf-swatches">${swatches}</div>
        </div>
        <div class="pnav-item">
          <div class="pnav-label">Status</div>
          <div class="pnav-status-pill"><span class="dot" style="background:${statusColor}"></span><span>${escapeHtml(user.custom_status || statusLabel(user.status))}</span></div>
        </div>
        <div class="pnav-item">
          <div class="pnav-label">Member Since</div>
          <div class="pnav-meta">${escapeHtml(memberSince)}</div>
        </div>
      </div>

      <div class="profile-content">
        <div class="profile-tabs"><div class="profile-tab active">Board</div></div>
        <div class="profile-hero" style="${bannerStyle}">
          <button class="hero-edit" id="pf-banner">${icon('image')} Change Banner</button>
        </div>
        <div class="profile-idcard">
          <div class="pic-avatar">${avatarHTML(user, 96, user.status || 'offline')}</div>
          <div class="pic-name">${escapeHtml(displayName)}</div>
          <div class="pic-tag">${escapeHtml(fullTag(user))}</div>
          <div class="pic-status"><span class="dot ${user.status || 'online'}"></span>${escapeHtml(user.custom_status || statusLabel(user.status))}</div>
          ${user.pronouns ? `<div class="pic-date">${escapeHtml(user.pronouns)}</div>` : ''}
          <div class="pic-date">Member since ${memberSince}</div>
        </div>
        <div class="profile-actions-row">
          <button class="pa primary" id="pf-edit">Edit Profile</button>
          <button class="pa" id="pf-avatar">Change Avatar</button>
        </div>
        <div class="profile-section-block">
          <h5>About Me</h5>
          <p>${escapeHtml(user.bio || 'You have not written a description yet.')}</p>
        </div>
      </div>
    </div>`, { modalClass: 'profile-modal' });

  $('pf-x').addEventListener('click', closeModal);
  $('pf-edit').addEventListener('click', () => openSettings('account'));
  $('pf-banner').addEventListener('click', () => openSettings('account'));
  $('pf-avatar').addEventListener('click', () => openSettings('account'));
  document.querySelectorAll('#pf-swatches .pnav-swatch').forEach(sw => {
    sw.addEventListener('click', async () => {
      const color = sw.dataset.color;
      document.querySelectorAll('#pf-swatches .pnav-swatch').forEach(x => x.classList.toggle('sel', x === sw));
      const hero = document.querySelector('.profile-hero');
      if (hero && !user.banner_url) hero.style.background = color;
      try {
        const { user: updated } = await api('/api/me', { method: 'PATCH', body: JSON.stringify({ banner_color: color }) });
        me = updated; localStorage.setItem('cr_user', JSON.stringify(me)); renderMe();
        user.banner_color = color;
      } catch (e) { toast(e.message, 'error'); }
    });
  });
}

/* ---------- Someone else's profile (banner sits on top of the avatar) ---------- */
function renderOtherProfile(user, ctx) {
  const displayName = user.display_name || user.username;
  const accountCreated = new Date(user.created_at).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  const rel = ctx.relationship;
  const mutualServers = ctx.mutualServers || [];
  const mutualFriends = ctx.mutualFriends || [];
  const note = ctx.note || '';

  const bannerStyle = user.banner_url
    ? `background-image:url('${escapeHtml(user.banner_url)}')`
    : `background:${user.banner_color || user.accent_color || '#5865F2'}`;

  let addBtn;
  if (rel === 'friends') addBtn = `<button class="op-add friends" id="pf-add">${icon('check')} <span>Friends</span></button>`;
  else if (rel === 'pending_outgoing') addBtn = `<button class="op-add pending" id="pf-add">${icon('clock')} <span>Request Sent</span></button>`;
  else if (rel === 'pending_incoming') addBtn = `<button class="op-add accept" id="pf-add">${icon('user-check')} <span>Accept Request</span></button>`;
  else if (rel === 'blocked') addBtn = `<button class="op-add blocked" id="pf-add" disabled>${icon('ban')} <span>Blocked</span></button>`;
  else addBtn = `<button class="op-add" id="pf-add">${icon('user-plus')} <span>Add Friend</span></button>`;

  const moreItems = [];
  if (rel === 'friends') moreItems.push({ action: 'remove', label: 'Remove Friend', icon: 'user-minus', danger: true });
  if (rel === 'pending_outgoing') moreItems.push({ action: 'cancel', label: 'Cancel Request', icon: 'xmark' });
  if (rel === 'pending_incoming') moreItems.push({ action: 'accept', label: 'Accept Request', icon: 'check' });
  if (rel === 'blocked') moreItems.push({ action: 'unblock', label: 'Unblock', icon: 'unlock' });
  else moreItems.push({ action: 'block', label: 'Block', icon: 'ban', danger: true });
  moreItems.push({ action: 'dm', label: 'Message', icon: 'comment' });

  openModal(`
    <div class="oprofile-banner" style="${bannerStyle}">
      <button class="ob-close" id="pf-x">${icon('xmark')}</button>
    </div>
    <div class="oprofile-body">
      <div class="oprofile-left">
        <div class="op-avatar">${avatarHTML(user, 120, user.status || 'offline')}</div>
        <div class="op-name">${escapeHtml(displayName)}</div>
        <div class="op-sub">${escapeHtml(user.custom_status || fullTag(user))}</div>
        <div class="op-actions">
          ${addBtn}
          <button class="op-more" id="pf-more" title="More Options">${icon('ellipsis-vertical')}</button>
        </div>
        <div class="op-section">
          <div class="op-label">${icon('calendar-days')} Member Since</div>
          <div class="op-dates"><div class="op-date">${accountCreated}</div></div>
        </div>
        <div class="op-section">
          <div class="op-label">${icon('note')} Note</div>
          <div class="op-note" id="pf-note">
            ${note ? `<div class="op-note-text">${escapeHtml(note)}</div>` : `<div class="op-note-empty">${icon('plus')} Click to add a note</div>`}
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
          <button class="op-message" id="pf-dm">${icon('comment')} Message</button>
        </div>
      </div>
    </div>`, { modalClass: 'oprofile-modal' });

  const renderTab = (tab) => {
    const content = $('op-content');
    if (tab === 'friends') {
      content.innerHTML = mutualFriends.length
        ? mutualFriends.map(u => `<div class="op-list-row">${avatarHTML(u, 32, u.status || 'offline')}<div><div class="olr-name">${escapeHtml(u.display_name || u.username)}</div><div class="olr-tag">${escapeHtml(fullTag(u))}</div></div></div>`).join('')
        : `<div class="op-empty"><div class="op-empty-ico">${icon('user-group')}</div><h4>No Mutual Friends</h4><p>You and ${escapeHtml(displayName)} do not have any friends in common.</p></div>`;
    } else if (tab === 'servers') {
      content.innerHTML = mutualServers.length
        ? mutualServers.map(s => `<div class="op-list-row"><div class="op-server-ico">${s.icon_url ? `<img src="${escapeHtml(s.icon_url)}" alt="">` : escapeHtml((s.name || '?')[0].toUpperCase())}</div><div><div class="olr-name">${escapeHtml(s.name)}</div><div class="olr-tag">Mutual Server</div></div></div>`).join('')
        : `<div class="op-empty"><div class="op-empty-ico">${icon('server')}</div><h4>No Mutual Servers</h4><p>You and ${escapeHtml(displayName)} are not in any servers together.</p></div>`;
    } else {
      content.innerHTML = `<div class="op-empty"><div class="op-empty-ico">${icon('ghost')}</div><h4>${escapeHtml(displayName)} doesn't have any activity to share here</h4><p>When they start playing a game or listening to music, it will show up here.</p></div>`;
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
    <div class="field"><textarea id="note-text" maxlength="256" placeholder="Jot down something you want to remember about this person\u2026">${escapeHtml(current || '')}</textarea></div>
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
   SETTINGS MODAL
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
    if (item.cat) return `<div class="sn-cat">${t(item.cat)}</div>`;
    return `<div class="sn-item" data-sec="${item.id}">${t(item.label)} <span class="chev">${icon('chevron-right')}</span></div>`;
  }).join('');

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
      <button class="btn secondary" id="set-logout">${t('Log Out')}</button>
      <div style="flex:1"></div>
      <button class="btn" id="set-done">${t('Save')}</button>
    </div>`, { modalClass: 'settings-modal' });

  const discardThen = (after) => {
    settingsDirty = false;
    previewSelf();
    if (after) after(); else closeModal();
  };
  const saveThen = async (after) => {
    const ok = settingsSaveFn ? await settingsSaveFn() : true;
    if (ok) { settingsDirty = false; if (after) after(); else closeModal(); }
    return ok;
  };
  const guardLogout = () => {
    const doLogout = async () => {
      const ok = await confirmDialog({ title: 'Log Out', body: 'Are you sure you want to log out of Crossroads?', confirmText: 'Log Out', danger: true });
      if (ok) logout();
    };
    if (settingsDirty) showUnsavedDialog({ onSave: () => saveThen(doLogout), onDiscard: () => discardThen(doLogout) });
    else doLogout();
  };

  modalCloseGuard = () => {
    if (!settingsDirty) { closeModal(); return; }
    showUnsavedDialog({ onSave: () => saveThen(closeModal), onDiscard: () => discardThen(closeModal) });
  };

  $('set-done').addEventListener('click', async () => {
    if (settingsDirty && settingsSaveFn) {
      const ok = await settingsSaveFn();
      if (!ok) return;
      settingsDirty = false;
    }
    closeModal();
  });
  $('set-logout').addEventListener('click', guardLogout);
  document.querySelectorAll('#settings-nav .sn-item[data-sec]').forEach(el => {
    el.addEventListener('click', () => renderSettings(el.dataset.sec));
  });
  renderSettings(section || 'account');
}

function renderSettings(section) {
  document.querySelectorAll('#settings-nav .sn-item[data-sec]').forEach(el => el.classList.toggle('active', el.dataset.sec === section));
  const panel = $('settings-panel');
  panel.innerHTML = settingsPanelHTML(section);
  hydrateIcons(panel);
  if (section === 'account') wireAccountPanel();
  if (section === 'profiles') wireProfilesPanel();
  if (section === 'privacy') wirePrivacyPanel();
  if (section === 'privacy' || section === 'appearance' || section === 'notifications' || section === 'voice') wireToggles();
  if (section === 'appearance') wireAppearance();
  if (section === 'language') wireLanguage();
}

function wirePrivacyPanel() {
  const btn = $('pw-save');
  if (!btn) return;
  const doSave = async () => {
    const cur = $('pw-current').value;
    const np = $('pw-new').value;
    const cf = $('pw-confirm').value;
    if (!cur || !np || !cf) { toast('Please fill in all password fields', 'error'); return; }
    if (np.length < 6) { toast('New password must be at least 6 characters', 'error'); return; }
    if (np !== cf) { toast('New passwords do not match', 'error'); return; }
    btn.disabled = true;
    try {
      await api('/api/me/password', { method: 'POST', body: JSON.stringify({ current_password: cur, new_password: np }) });
      $('pw-current').value = ''; $('pw-new').value = ''; $('pw-confirm').value = '';
      toast('Password updated successfully', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { btn.disabled = false; }
  };
  btn.addEventListener('click', doSave);
  ['pw-current', 'pw-new', 'pw-confirm'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSave(); } });
  });
}

function toggleRow(key, title, desc) {
  const on = setting(key);
  return `<div class="set-row"><div><div class="sr-title">${escapeHtml(title)}</div><div class="sr-desc">${escapeHtml(desc)}</div></div><div class="toggle${on ? ' on' : ''}" data-toggle="${key}"></div></div>`;
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
        <div class="field"><label>Pronouns</label><input id="set-pronouns" maxlength="24" value="${escapeHtml(u.pronouns || '')}" placeholder="e.g. she/her, he/him, they/them"></div>
        <div class="field"><label>Custom Status</label><input id="set-custom" maxlength="128" value="${escapeHtml(u.custom_status || '')}" placeholder="What are you up to right now?"></div>
        <div class="field"><label>About Me</label><textarea id="set-bio" maxlength="190" placeholder="Share a little about yourself \u2014 your hobbies, interests, or what you are working on\u2026">${escapeHtml(u.bio || '')}</textarea></div>
        <div class="field"><label>Profile Banner</label>
          <div class="banner-editor" id="banner-editor" style="${u.banner_url ? `background-image:url('${escapeHtml(u.banner_url)}')` : `background:${escapeHtml(u.banner_color || u.accent_color || '#5865F2')}`}">
            <button class="banner-edit-btn" id="set-banner-file-btn">${icon('image')} Upload Banner</button>
          </div>
          <input type="file" id="set-banner-file" accept="image/*" class="hidden">
          <div class="color-row" id="banner-color-row" style="margin-top:10px">${PALETTE.map(c => `<span class="swatch${(u.banner_color || '#5865F2').toLowerCase() === c.toLowerCase() ? ' sel' : ''}" data-color="${c}" style="background:${c}"></span>`).join('')}</div>
          <div class="hint">Recommended size 600x240. Pick a color or upload an image (GIF supported, up to 25 MB).</div>
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
        <div class="field"><label>Banner Color</label>
          <div class="color-row" id="prof-banner-row">${PALETTE.map(c => `<span class="swatch${(u.banner_color || '#5865F2').toLowerCase() === c.toLowerCase() ? ' sel' : ''}" data-color="${c}" style="background:${c}"></span>`).join('')}</div>
          <div class="hint">Used for your banner whenever you have not uploaded a banner image.</div>
        </div>
        <div class="modal-actions" style="justify-content:flex-start"><button class="btn" id="prof-save">Save Changes</button></div>`;
    case 'privacy':
      return `
        <h4>Privacy &amp; Safety</h4>
        ${toggleRow('friendRequests', 'Allow friend requests', 'Let other people send you friend requests. Turn this off to only be added by people you choose to add first.')}
        ${toggleRow('safeMode', 'Keep me safe', 'Scan and blur media from unverified sources.')}
        ${toggleRow('dmFromMembers', 'Allow direct messages from server members', 'Members of servers you share can start a conversation with you.')}
        ${toggleRow('dataPersonalisation', 'Allow data personalisation', 'Use my activity to improve recommendations.')}
        ${toggleRow('readReceipts', 'Show my read receipts', 'Let others know when you have read their messages.')}
        <div class="pw-section">
          <div class="pw-head">
            <div>
              <h5>Change Password</h5>
              <p class="pw-sub">Keep your account secure by updating your password regularly. You will stay signed in on this device.</p>
            </div>
          </div>
          <div class="field"><label>Current Password</label>
            <input type="password" id="pw-current" autocomplete="current-password" placeholder="Enter your current password"></div>
          <div class="field"><label>New Password</label>
            <input type="password" id="pw-new" autocomplete="new-password" placeholder="Create a new password (at least 6 characters)"></div>
          <div class="field"><label>Confirm New Password</label>
            <input type="password" id="pw-confirm" autocomplete="new-password" placeholder="Re-enter your new password to confirm"></div>
          <div class="pw-actions"><button class="btn" id="pw-save">Update Password</button></div>
        </div>`;
    case 'apps':
      return `<h4>Authorized Apps</h4><div class="empty-panel"><div class="ep-ico">${icon('plug')}</div><h5>No authorized apps</h5><p>When you connect an application to your account, it will appear here.</p></div>`;
    case 'devices':
      return `<h4>Devices</h4><div class="empty-panel"><div class="ep-ico">${icon('mobile')}</div><h5>No other devices</h5><p>You are only signed in on this device right now.</p></div>`;
    case 'connections':
      return `<h4>Connections</h4><div class="empty-panel"><div class="ep-ico">${icon('link')}</div><h5>No connections</h5><p>Connect accounts such as GitHub or Twitch to display them on your profile.</p></div>`;
    case 'appearance':
      return `
        <h4>Appearance</h4>
        <div class="field"><label>Theme</label>
          <div class="theme-grid" id="theme-grid">
            ${themeCard('dark', 'Dark', ['#202225', '#2b2d31', '#313338'])}
            ${themeCard('light', 'Light', ['#e3e5e8', '#f2f3f5', '#ffffff'])}
          </div>
        </div>
        <div class="field"><label>Background Color</label>
          <div class="theme-grid" id="bg-grid">
            ${BG_COLORS.map(b => themeCard(b.id, b.label, [b.rail, b.side, b.main], true)).join('')}
          </div>
          <div class="hint">These background colors apply to the dark theme.</div>
        </div>
        ${toggleRow('compact', 'Compact message display', 'Reduce the spacing between messages.')}
        ${toggleRow('showMembers', 'Show member list', 'Display the member list beside channels.')}`;
    case 'notifications':
      return `
        <h4>Notifications</h4>
        ${toggleRow('notifDesktop', 'Enable desktop notifications', 'Receive a notification when you are mentioned or messaged.')}
        ${toggleRow('notifSounds', 'Notification sounds', 'Play a sound for incoming pings and messages.')}
        ${toggleRow('notifBadge', 'Unread badge on app icon', 'Show a badge for unread messages.')}`;
    case 'voice':
      return `
        <h4>Voice &amp; Video</h4>
        <div class="field"><label>Input Device</label><select><option>Default</option><option>System Microphone</option></select></div>
        <div class="field"><label>Output Device</label><select><option>Default</option><option>System Speakers</option></select></div>
        <div class="field"><label>Input Volume</label><input type="range" id="voice-volume" min="0" max="100" value="${Number(setting('inputVolume')) || 70}" style="padding:0"></div>
        ${toggleRow('echoCancel', 'Echo cancellation', 'Reduce echo picked up by your microphone.')}
        ${toggleRow('noiseSuppress', 'Noise suppression', 'Filter background noise during calls.')}`;
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
          <select id="lang-select">
            <option>English, US</option><option>English, UK</option><option>Espa\u00f1ol</option>
            <option>Fran\u00e7ais</option><option>Deutsch</option>
          </select></div>
        <p style="color:var(--text-muted);font-size:13px;line-height:1.5">Additional languages are being prepared and will appear here as they become available.</p>`;
    default:
      return `<h4>Settings</h4>`;
  }
}

function themeCard(id, label, colors, isBg) {
  const sel = isBg ? (setting('bg') === id) : (setting('theme') === id);
  const attr = isBg ? `data-bg="${id}"` : `data-theme="${id}"`;
  return `<div class="theme-card${sel ? ' sel' : ''}" ${attr}>
    <div class="tc-preview">
      <div class="tc-rail" style="background:${colors[0]}"></div>
      <div class="tc-side" style="background:${colors[1]}"></div>
      <div class="tc-main" style="background:${colors[2]}"></div>
    </div>
    <div class="tc-label"><span>${escapeHtml(label)}</span><span class="tc-check">${icon('check')}</span></div>
  </div>`;
}

function wireAccountPanel() {
  const u = me;
  settingsUploads = { avatar_url: u.avatar_url || null, banner_url: u.banner_url || null };
  $('set-status').value = u.status || 'online';

  const markDirty = () => { settingsDirty = true; };

  $('sa-upload').addEventListener('click', () => $('sa-file').click());
  $('sa-file').addEventListener('change', (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    openImageEditor(f, { kind: 'avatar', title: 'Adjust Avatar', onSave: async (blob, filename) => {
      try {
        const d = await uploadImage(blob, filename);
        settingsUploads.avatar_url = d.url;
        previewSelf({ avatar_url: d.url });
        markDirty();
        toast('Avatar ready \u2014 remember to save', 'success');
      } catch (err) { toast(err.message, 'error'); }
    } });
  });
  $('sa-remove').addEventListener('click', () => {
    settingsUploads.avatar_url = null;
    previewSelf({ avatar_url: null });
    markDirty();
  });

  let bannerColor = u.banner_color || '#5865F2';
  const editor = $('banner-editor');
  const paintBanner = () => {
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
  $('set-banner-file').addEventListener('change', (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    openImageEditor(f, { kind: 'banner', title: 'Adjust Banner', onSave: async (blob, filename) => {
      try {
        const d = await uploadImage(blob, filename);
        settingsUploads.banner_url = d.url; paintBanner(); markDirty();
        toast('Banner ready \u2014 remember to save', 'success');
      } catch (err) { toast(err.message, 'error'); }
    } });
  });
  $('set-banner-remove').addEventListener('click', () => { settingsUploads.banner_url = null; paintBanner(); markDirty(); });
  document.querySelectorAll('#banner-color-row .swatch').forEach(sw => sw.addEventListener('click', () => {
    bannerColor = sw.dataset.color;
    settingsUploads.banner_url = null;
    document.querySelectorAll('#banner-color-row .swatch').forEach(x => x.classList.toggle('sel', x === sw));
    paintBanner(); markDirty();
  }));

  let accent = u.accent_color || '#5865F2';
  document.querySelectorAll('#accent-row .swatch').forEach(sw => sw.addEventListener('click', () => {
    accent = sw.dataset.color;
    document.querySelectorAll('#accent-row .swatch').forEach(x => x.classList.toggle('sel', x === sw));
    markDirty();
  }));

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

  $('set-display').addEventListener('input', () => { markDirty(); previewSelf({ display_name: $('set-display').value.trim() || null }); });
  $('set-pronouns').addEventListener('input', markDirty);
  $('set-custom').addEventListener('input', markDirty);
  $('set-bio').addEventListener('input', markDirty);
  $('set-status').addEventListener('change', () => { markDirty(); previewSelf({ status: $('set-status').value }); });

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
      previewSelf();
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
  document.querySelectorAll('#settings-panel .toggle[data-toggle]').forEach(t => {
    t.addEventListener('click', () => {
      const key = t.dataset.toggle;
      const val = !t.classList.contains('on');
      t.classList.toggle('on', val);
      saveSetting(key, val);
    });
  });
}

function wireAppearance() {
  document.querySelectorAll('#theme-grid .theme-card').forEach(card => card.addEventListener('click', () => {
    saveSetting('theme', card.dataset.theme);
    document.querySelectorAll('#theme-grid .theme-card').forEach(c => c.classList.toggle('sel', c === card));
  }));
  document.querySelectorAll('#bg-grid .theme-card').forEach(card => card.addEventListener('click', () => {
    saveSetting('bg', card.dataset.bg);
    document.querySelectorAll('#bg-grid .theme-card').forEach(c => c.classList.toggle('sel', c === card));
  }));
}

function wireLanguage() {
  const sel = $('lang-select');
  if (!sel) return;
  sel.value = setting('language') || 'English, US';
  sel.addEventListener('change', () => {
    saveSetting('language', sel.value);
    applyLanguage();
    toast('Language updated', 'success');
  });
  const vol = $('voice-volume');
  if (vol) vol.addEventListener('change', () => saveSetting('inputVolume', Number(vol.value)));
}

/* ============================================================
   SERVER MENU
   ============================================================ */
function serverMenu(e) {
  if (!state.server) return;
  const rect = $('sidebar-header').getBoundingClientRect();
  const isOwner = state.server.owner_id === me.id;
  const items = [
    { label: 'Invite People', icon: 'user-plus', onClick: () => openInviteModal() },
    { label: 'Create Channel', icon: 'plus', onClick: () => openCreateChannel('text') },
    { label: 'Server Settings', icon: 'settings', onClick: openServerSettings }
  ];
  if (isOwner) items.push({ label: 'Delete Server', icon: 'trash', danger: true, onClick: () => deleteServer() });
  else items.push({ label: 'Leave Server', icon: 'log-out', danger: true, onClick: () => leaveServer() });
  showContextMenu(rect.left, rect.bottom + 4, items);
}

async function leaveServer() {
  const ok = await confirmDialog({ title: 'Leave Server', body: `Are you sure you want to leave <b>${escapeHtml(state.server.name)}</b>? You will need a new invite to rejoin.`, confirmText: 'Leave Server', danger: true });
  if (!ok) return;
  try {
    await api('/api/servers/' + state.server.id + '/leave', { method: 'POST' });
    toast('You left ' + state.server.name, 'success');
    await loadServers(); showHome();
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteServer() {
  const ok = await confirmDialog({ title: 'Delete Server', body: `This will permanently delete <b>${escapeHtml(state.server.name)}</b> and all of its channels and messages. This cannot be undone.`, confirmText: 'Delete Server', danger: true });
  if (!ok) return;
  try {
    await api('/api/servers/' + state.server.id, { method: 'DELETE' });
    toast('Server deleted', 'success');
    await loadServers(); showHome();
  } catch (e) { toast(e.message, 'error'); }
}

/* ============================================================
   SERVER SETTINGS + INVITES
   ============================================================ */
const INVITE_EXPIRY_OPTIONS = [
  { value: '30', label: '30 minutes' },
  { value: '60', label: '1 hour' },
  { value: '360', label: '6 hours' },
  { value: '720', label: '12 hours' },
  { value: '1440', label: '1 day' },
  { value: '10080', label: '7 days' },
  { value: '43200', label: '30 days' },
  { value: 'never', label: 'Never' }
];

function inviteExpiryLabel(inv) {
  if (inv.maxed) return 'Max uses reached';
  if (!inv.expires_at) return inv.expired ? 'Expired' : 'Never expires';
  const ms = inv.expires_at - Date.now();
  if (ms <= 0) return 'Expired';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `Expires in ${mins} minute${mins === 1 ? '' : 's'}`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `Expires in ${hrs} hour${hrs === 1 ? '' : 's'}`;
  const days = Math.round(hrs / 24);
  return `Expires in ${days} day${days === 1 ? '' : 's'}`;
}

function invitePreviewCardHTML(s) {
  const bannerStyle = s.banner_url
    ? `background-image:url('${escapeHtml(s.banner_url)}')`
    : `background:linear-gradient(135deg, var(--brand), color-mix(in srgb, var(--brand) 40%, #000))`;
  const iconHtml = s.icon_url
    ? `<img class="ipc-icon" src="${escapeHtml(s.icon_url)}" alt="">`
    : `<div class="ipc-icon ipc-icon-fallback">${escapeHtml((s.name || '?')[0].toUpperCase())}</div>`;
  const members = s.member_count || 0;
  return `<div class="invite-preview-card" style="${bannerStyle}">
      <div class="ipc-shade"></div>
      <div class="ipc-body">
        ${iconHtml}
        <div class="ipc-text">
          <div class="ipc-name">${escapeHtml(s.name)}</div>
          <div class="ipc-stats"><span class="ipc-dot online"></span>${s.online_count || 0} Online <span class="ipc-dot total"></span>${members} Member${members === 1 ? '' : 's'}</div>
        </div>
      </div>
    </div>`;
}

function invitePanelHTML(s) {
  const usesOptions = [
    { value: 'unlimited', label: 'No limit', sub: 'Anyone with the link can join' },
    { value: '1', label: '1 use' },
    { value: '5', label: '5 uses' },
    { value: '10', label: '10 uses' },
    { value: '25', label: '25 uses' },
    { value: '50', label: '50 uses' },
    { value: '100', label: '100 uses' }
  ];
  return `
    ${invitePreviewCardHTML(s)}
    <div class="invite-controls">
      <div class="field"><label>Expire After</label>
        ${customSelect('inv-expiry', INVITE_EXPIRY_OPTIONS, '10080')}
      </div>
      <div class="field"><label>Max Number of Uses</label>
        ${customSelect('inv-uses', usesOptions, 'unlimited')}
      </div>
      <button class="btn inv-generate" id="inv-generate">${icon('link')} Generate New Link</button>
    </div>
    <div class="invite-result" id="inv-result"></div>
    <div class="invite-list-head"><span>Active Invites</span><span class="inv-count" id="inv-count"></span></div>
    <div class="invite-list" id="inv-list"><div class="inv-empty">Loading invites\u2026</div></div>`;
}

function wireInvitePanel(s) {
  wireCustomSelects(document.querySelector('.invite-panel') || document.querySelector('.invite-modal-body') || document);
  const gen = $('inv-generate');
  if (gen) gen.addEventListener('click', async () => {
    gen.disabled = true;
    try {
      const { invite } = await api('/api/servers/' + s.id + '/invites', { method: 'POST', body: JSON.stringify({ expires_in: csValue('inv-expiry'), max_uses: csValue('inv-uses') }) });
      showInviteResult(invite);
      loadInviteList(s);
    } catch (e) { toast(e.message, 'error'); }
    finally { gen.disabled = false; }
  });
  loadInviteList(s);
}

function showInviteResult(invite) {
  const box = $('inv-result');
  if (!box) return;
  const link = 'gg/' + invite.code;
  box.innerHTML = `
    <div class="invite-result-card">
      <div class="irc-label">${icon('check')} Your invite link is ready</div>
      <div class="irc-link-row">
        <div class="irc-link">${escapeHtml(link)}</div>
        <button class="irc-copy" id="irc-copy">${icon('copy')} Copy</button>
      </div>
      <div class="irc-meta">${escapeHtml(inviteExpiryLabel(invite))}${invite.max_uses ? ` \u00b7 ${invite.max_uses} max uses` : ''}</div>
    </div>`;
  hydrateIcons(box);
  $('irc-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(link); toast('Invite copied: ' + link, 'success'); }
    catch (e) { promptDialog({ title: 'Invite Link', body: 'Copy your invite link below.', label: 'Invite link', value: link, confirmText: 'Done' }); }
  });
}

async function loadInviteList(s) {
  const list = $('inv-list');
  if (!list) return;
  try {
    const { invites } = await api('/api/servers/' + s.id + '/invites');
    const active = invites.filter(i => i.valid).length;
    const countEl = $('inv-count');
    if (countEl) countEl.textContent = active + ' active';
    if (!invites.length) { list.innerHTML = `<div class="inv-empty">No invites yet \u2014 generate one above to get started.</div>`; return; }
    list.innerHTML = invites.map(inv => `
      <div class="invite-row${inv.valid ? '' : ' inactive'}">
        <div class="ir-ico">${icon(inv.valid ? 'link' : (inv.expired ? 'clock' : 'xmark'))}</div>
        <div class="ir-main">
          <div class="ir-code">gg/${escapeHtml(inv.code)}</div>
          <div class="ir-meta">${escapeHtml(inviteExpiryLabel(inv))} \u00b7 ${inv.max_uses ? `${inv.uses}/${inv.max_uses} uses` : `${inv.uses} use${inv.uses === 1 ? '' : 's'}`}</div>
        </div>
        <button class="ir-btn ir-copy" data-copy="${escapeHtml(inv.code)}" title="Copy link">${icon('copy')}</button>
        <button class="ir-btn ir-revoke" data-revoke="${escapeHtml(inv.code)}" title="Revoke">${icon('trash')}</button>
      </div>`).join('');
    hydrateIcons(list);
    list.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
      const link = 'gg/' + b.dataset.copy;
      try { await navigator.clipboard.writeText(link); toast('Invite copied', 'success'); } catch (e) { toast(link); }
    }));
    list.querySelectorAll('[data-revoke]').forEach(b => b.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Revoke Invite', body: `Revoke <b>gg/${escapeHtml(b.dataset.revoke)}</b>? Anyone using it will no longer be able to join.`, confirmText: 'Revoke', danger: true });
      if (!ok) return;
      try { await api('/api/invites/' + b.dataset.revoke, { method: 'DELETE' }); toast('Invite revoked', 'success'); loadInviteList(s); }
      catch (e) { toast(e.message, 'error'); }
    }));
  } catch (e) { list.innerHTML = `<div class="inv-empty">Could not load invites.</div>`; }
}

function openInviteModal() {
  const s = state.server;
  if (!s) return;
  openModal(`
    <div class="invite-modal-header">
      <div>
        <h3>Invite friends to ${escapeHtml(s.name)}</h3>
        <p class="msub">Pick how long your invite stays valid, then share the short link.</p>
      </div>
      <button class="imh-close" id="inv-x">${icon('xmark')}</button>
    </div>
    <div class="invite-modal-body" id="invite-panel-root">${invitePanelHTML(s)}</div>`, { modalClass: 'invite-modal' });
  $('inv-x').addEventListener('click', closeModal);
  wireInvitePanel(s);
}

function openServerSettings() {
  const s = state.server;
  if (!s) return;
  const isOwner = s.owner_id === me.id;
  openModal(`
    <div class="ss-modal-head">
      <h3>Server Settings</h3>
      <button class="ss-close" id="ss-close-x">${icon('xmark')}</button>
    </div>
    <div class="ss-tabs">
      <button class="ss-tab active" data-tab="overview">${icon('server')} Overview</button>
      <button class="ss-tab" data-tab="invites">${icon('link')} Invites</button>
      <button class="ss-tab" data-tab="members">${icon('users')} Members</button>
    </div>
    <div class="ss-body" id="ss-body"></div>`, { modalClass: 'ss-modal' });
  $('ss-close-x').addEventListener('click', closeModal);
  const showTab = (tab) => {
    document.querySelectorAll('.ss-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    renderServerTab(tab, state.server, isOwner);
  };
  document.querySelectorAll('.ss-tab').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));
  showTab('overview');
}

function renderServerTab(tab, s, isOwner) {
  const body = $('ss-body');
  if (!body) return;
  if (tab === 'invites') {
    body.innerHTML = `<div class="invite-panel">${invitePanelHTML(s)}</div>`;
    hydrateIcons(body);
    wireInvitePanel(s);
    return;
  }
  if (tab === 'members') {
    const members = state.members || [];
    const iAmOwner = s.owner_id === me.id;
    body.innerHTML = `
      <div class="ss-section-title">Members \u2014 ${members.length}</div>
      <div class="ss-members">${members.map(m => {
        const isOwner = m.id === s.owner_id;
        const role = isOwner ? 'owner' : (m.role || 'member');
        const badge = isOwner ? '<span class="role-badge owner">Owner</span>' : (role === 'admin' ? '<span class="role-badge admin">Admin</span>' : '');
        let action = '';
        if (iAmOwner && !isOwner) {
          action = role === 'admin'
            ? `<button class="ss-member-role-btn" data-demote="${m.id}">Demote</button>`
            : `<button class="ss-member-role-btn promote" data-promote="${m.id}">Make Admin</button>`;
        }
        return `<div class="ss-member-row">
          ${avatarHTML(m, 36, m.status || 'offline')}
          <div class="ss-member-info">
            <div class="ss-member-name">${escapeHtml(m.display_name || m.username)}${badge}</div>
            <div class="ss-member-tag">${escapeHtml(fullTag(m))}</div>
          </div>
          ${action}
        </div>`;
      }).join('') || '<div class="inv-empty">No members.</div>'}</div>`;
    hydrateIcons(body);
    body.querySelectorAll('[data-promote]').forEach(b => b.addEventListener('click', () => setMemberRole(s, b.dataset.promote, 'admin')));
    body.querySelectorAll('[data-demote]').forEach(b => b.addEventListener('click', () => setMemberRole(s, b.dataset.demote, 'member')));
    return;
  }
  // Overview
  const bannerStyle = s.banner_url
    ? `background-image:url('${escapeHtml(s.banner_url)}')`
    : `background:linear-gradient(135deg, var(--brand), color-mix(in srgb, var(--brand) 40%, #000))`;
  const created = new Date(s.created_at).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
  body.innerHTML = `
    <div class="ss-banner" id="ss-banner" style="${bannerStyle}">
      <div class="ss-banner-shade"></div>
      <div class="ss-banner-actions">
        <button class="ss-banner-btn" id="ss-banner-upload">${icon('image')} ${s.banner_url ? 'Change Banner' : 'Upload Banner'}</button>
        ${s.banner_url ? `<button class="ss-banner-btn ghost" id="ss-banner-remove">${icon('trash')} Remove</button>` : ''}
      </div>
      <input type="file" id="ss-banner-file" accept="image/*" class="hidden">
    </div>
    <div class="ss-overview">
      <div class="ss-icon-col">
        <div class="ss-icon-drop" id="ss-icon-drop" title="Upload server icon">
          ${s.icon_url ? `<img src="${escapeHtml(s.icon_url)}" alt="">` : `<span class="ss-icon-fallback">${escapeHtml((s.name || '?')[0].toUpperCase())}</span>`}
          <div class="ss-icon-overlay">${icon('upload')}</div>
        </div>
        <div class="ss-icon-hint">${isOwner ? `Click to ${s.icon_url ? 'change' : 'upload'} icon` : 'Server icon'}</div>
        <input type="file" id="ss-icon-file" accept="image/*" class="hidden">
      </div>
      <div class="ss-fields">
        <div class="field"><label>Server Name</label><input id="ss-name" value="${escapeHtml(s.name)}" maxlength="40" ${isOwner ? '' : 'disabled'} placeholder="Give your server a memorable name"></div>
        <div class="field"><label>Server Description</label>
          <div class="ss-desc-wrap">
            <textarea id="ss-desc" maxlength="500" ${isOwner ? '' : 'disabled'} placeholder="Tell people what your server is about, who it is for, and what to expect when they join\u2026">${escapeHtml(s.description || '')}</textarea>
            <div class="ss-desc-count" id="ss-desc-count">${(s.description || '').length}/500</div>
          </div>
        </div>
        <div class="ss-stats">
          <div class="ss-stat"><div class="ss-stat-num">${s.member_count || 0}</div><div class="ss-stat-lbl">Members</div></div>
          <div class="ss-stat"><div class="ss-stat-num">${s.online_count || 0}</div><div class="ss-stat-lbl">Online</div></div>
          <div class="ss-stat"><div class="ss-stat-num">${(state.channels || []).length}</div><div class="ss-stat-lbl">Channels</div></div>
          <div class="ss-stat"><div class="ss-stat-num small">${escapeHtml(created)}</div><div class="ss-stat-lbl">Created</div></div>
        </div>
        ${isOwner ? `<div class="ss-actions"><button class="btn" id="ss-save">${icon('check')} Save Changes</button></div>` : `<div class="ss-note">Only the server owner can edit these settings.</div>`}
      </div>
    </div>`;
  hydrateIcons(body);

  const descEl = $('ss-desc');
  const descCount = $('ss-desc-count');
  if (descEl && descCount) descEl.addEventListener('input', () => { descCount.textContent = descEl.value.length + '/500'; });

  let iconUrl = s.icon_url || null;
  let bannerUrl = s.banner_url || null;
  const iconDrop = $('ss-icon-drop');
  if (isOwner && iconDrop) {
    iconDrop.addEventListener('click', () => $('ss-icon-file').click());
    $('ss-icon-file').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const d = await uploadImage(f); iconUrl = d.url;
        iconDrop.innerHTML = `<img src="${escapeHtml(d.url)}" alt=""><div class="ss-icon-overlay">${icon('upload')}</div>`;
        hydrateIcons(iconDrop);
        toast('Icon ready \u2014 remember to save', 'success');
      } catch (err) { toast(err.message, 'error'); }
      e.target.value = '';
    });
  }
  const bannerEl = $('ss-banner');
  if (isOwner && bannerEl) {
    $('ss-banner-upload').addEventListener('click', () => $('ss-banner-file').click());
    $('ss-banner-file').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const d = await uploadImage(f); bannerUrl = d.url;
        bannerEl.style.background = `url('${d.url}') center/cover`;
        toast('Banner ready \u2014 remember to save', 'success');
      } catch (err) { toast(err.message, 'error'); }
      e.target.value = '';
    });
    const rm = $('ss-banner-remove');
    if (rm) rm.addEventListener('click', () => {
      bannerUrl = null;
      bannerEl.style.background = 'linear-gradient(135deg, var(--brand), color-mix(in srgb, var(--brand) 40%, #000))';
      rm.remove();
      toast('Banner removed \u2014 remember to save', 'success');
    });
  }
  const save = $('ss-save');
  if (save) save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      const { server } = await api('/api/servers/' + s.id, { method: 'PATCH', body: JSON.stringify({ name: $('ss-name').value.trim(), description: $('ss-desc').value.trim(), icon_url: iconUrl, banner_url: bannerUrl }) });
      state.server = server;
      const sn = $('sidebar-name'); if (sn) sn.textContent = server.name;
      await loadServers();
      toast('Server updated', 'success');
      renderServerTab('overview', server, isOwner);
    } catch (e) { toast(e.message, 'error'); save.disabled = false; }
  });
}

/* ============================================================
   REALTIME REFRESH HELPERS
   ============================================================ */
/* Re-paint the avatar + author name on every rendered message from a user. */
function refreshMessageAuthor(u) {
  document.querySelectorAll(`.msg-group[data-uid="${u.id}"]`).forEach(node => {
    const av = node.querySelector('.gutter .avatar');
    if (av) av.outerHTML = avatarHTML(u, 40);
    const author = node.querySelector('.author');
    if (author) author.textContent = u.display_name || u.username;
  });
}

/* If a profile modal is open for this user, rebuild it with fresh data. */
function refreshOpenProfile(u) {
  if (!state.openProfileId || state.openProfileId !== u.id) return;
  const overlay = $('modal-overlay');
  if (!overlay || overlay.classList.contains('hidden')) return;
  if (!document.querySelector('.profile-modal, .oprofile-modal')) return;
  if (u.id === me.id) renderOwnProfile(Object.assign({}, me, u));
  else openProfile(u);
}

/* Reload the member list for the current server (after a role change etc.). */
async function reloadServerMembers() {
  if (!state.server) return;
  try {
    const data = await api('/api/servers/' + state.server.id);
    state.server = Object.assign({}, state.server, data.server);
    if (data.channels) state.channels = data.channels;
    state.members = data.members || [];
    renderMembers();
    const activeTab = document.querySelector('.ss-tab.active');
    if (activeTab && activeTab.dataset.tab === 'members') renderServerTab('members', state.server, state.server.owner_id === me.id);
  } catch (e) { /* ignore */ }
}

/* Owner-only: promote a member to admin or demote them back. */
async function setMemberRole(s, uid, role) {
  try {
    await api('/api/servers/' + s.id + '/members/' + uid, { method: 'PATCH', body: JSON.stringify({ role }) });
    toast(role === 'admin' ? 'Member promoted to admin' : 'Admin demoted to member', 'success');
    reloadServerMembers();
  } catch (e) { toast(e.message, 'error'); }
}

/* ============================================================
   CHANNEL MANAGEMENT (owner / admins)
   ============================================================ */
function amIAdmin() {
  const s = state.server;
  if (!s) return false;
  if (s.owner_id === me.id) return true;
  const m = state.members.find(x => x.id === me.id);
  return !!(m && (m.role === 'owner' || m.role === 'admin'));
}

function copyChannelLink(c) {
  const link = location.origin + '/app.html?invite=' + (state.server ? state.server.id : '') + '#ch-' + c.id;
  navigator.clipboard.writeText(link).then(() => toast('Channel link copied', 'success')).catch(() => toast('#' + c.name));
}

function openChannelContextMenu(x, y, cid) {
  const c = state.channels.find(ch => ch.id === cid);
  if (!c) return;
  const items = [];
  if (amIAdmin()) {
    items.push({ label: 'New Text Channel', icon: 'plus', onClick: () => openCreateChannel('text') });
    items.push({ label: 'New Voice Channel', icon: 'volume-high', onClick: () => openCreateChannel('voice') });
    items.push({ sep: true });
    items.push({ label: 'Rename Channel', icon: 'pencil', onClick: () => renameChannel(c) });
    items.push({ label: 'Edit Channel Topic', icon: 'note', onClick: () => editChannelTopic(c) });
    items.push({ label: 'Copy Channel Link', icon: 'link', onClick: () => copyChannelLink(c) });
    items.push({ sep: true });
    items.push({ label: 'Delete Channel', icon: 'trash', danger: true, onClick: () => deleteChannel(c) });
  } else {
    items.push({ label: 'Copy Channel Link', icon: 'link', onClick: () => copyChannelLink(c) });
  }
  showContextMenu(x, y, items);
}

async function renameChannel(c) {
  const name = await promptDialog({ title: 'Rename Channel', body: 'Give this channel a new name.', label: 'Channel name', value: c.name, confirmText: 'Rename', maxlength: 40 });
  if (name === null) return;
  const clean = name.trim();
  if (!clean) { toast('Channel name cannot be empty', 'error'); return; }
  try {
    await api('/api/servers/' + state.server.id + '/channels/' + c.id, { method: 'PATCH', body: JSON.stringify({ name: clean }) });
    toast('Channel renamed', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

async function editChannelTopic(c) {
  const topic = await promptDialog({ title: 'Edit Channel Topic', body: 'Set a short topic that appears under the channel name.', label: 'Topic', value: c.topic || '', confirmText: 'Save Topic', maxlength: 200, placeholder: 'What is this channel about?' });
  if (topic === null) return;
  try {
    await api('/api/servers/' + state.server.id + '/channels/' + c.id, { method: 'PATCH', body: JSON.stringify({ topic }) });
    toast('Channel topic updated', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteChannel(c) {
  const ok = await confirmDialog({ title: 'Delete Channel', body: `Delete <b>#${escapeHtml(c.name)}</b>? Every message in this channel will be permanently removed.`, confirmText: 'Delete Channel', danger: true });
  if (!ok) return;
  try {
    await api('/api/servers/' + state.server.id + '/channels/' + c.id, { method: 'DELETE' });
    toast('Channel deleted', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

/* ============================================================
   CUSTOM SELECT (website-aligned dropdowns)
   ============================================================ */
function customSelect(id, options, selected) {
  const cur = options.find(o => String(o.value) === String(selected)) || options[0];
  return `<div class="cs-wrap" data-cs="${id}" data-value="${escapeHtml(String(cur.value))}">
    <button type="button" class="cs-trigger" data-cs-trigger>
      <span class="cs-trigger-label">${escapeHtml(cur.label)}</span>
      <span class="cs-caret">${icon('chevron-down')}</span>
    </button>
    <div class="cs-menu hidden" data-cs-menu>
      ${options.map(o => `<div class="cs-option${String(o.value) === String(cur.value) ? ' sel' : ''}" data-value="${escapeHtml(String(o.value))}"><span>${escapeHtml(o.label)}</span>${o.sub ? `<span class="cs-sub">${escapeHtml(o.sub)}</span>` : ''}<span class="cs-check">${icon('check')}</span></div>`).join('')}
    </div>
  </div>`;
}

function closeCustomSelects(except) {
  document.querySelectorAll('[data-cs-menu]').forEach(m => { if (m !== except) m.classList.add('hidden'); });
  document.querySelectorAll('.cs-trigger').forEach(t => { if (!except || !except.parentElement.contains(t)) t.classList.remove('open'); });
}

function wireCustomSelects(root) {
  (root || document).querySelectorAll('[data-cs]').forEach(wrap => {
    const trigger = wrap.querySelector('[data-cs-trigger]');
    const menu = wrap.querySelector('[data-cs-menu]');
    if (!trigger || !menu) return;
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !menu.classList.contains('hidden');
      closeCustomSelects();
      if (!isOpen) { menu.classList.remove('hidden'); trigger.classList.add('open'); }
    });
    menu.querySelectorAll('.cs-option').forEach(opt => opt.addEventListener('click', (e) => {
      e.stopPropagation();
      wrap.dataset.value = opt.dataset.value;
      const label = opt.querySelector('span');
      wrap.querySelector('.cs-trigger-label').textContent = label ? label.textContent : opt.dataset.value;
      menu.querySelectorAll('.cs-option').forEach(o => o.classList.toggle('sel', o === opt));
      menu.classList.add('hidden');
      trigger.classList.remove('open');
    }));
  });
}

function csValue(id) {
  const w = document.querySelector(`[data-cs="${id}"]`);
  return w ? w.dataset.value : null;
}

/* ============================================================
   MINI PROFILE (bottom-left user panel)
   ============================================================ */
function positionMiniProfile(wrap) {
  const panel = $('user-panel-me');
  if (!panel) return;
  const rect = panel.getBoundingClientRect();
  const w = wrap.offsetWidth, h = wrap.offsetHeight;
  let left = rect.left;
  let top = rect.top - h - 8;
  if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
  if (left < 8) left = 8;
  if (top < 8) top = rect.bottom + 8;
  wrap.style.left = left + 'px';
  wrap.style.top = top + 'px';
}

function closeMiniProfile() {
  const el = $('mini-profile');
  if (el) el.remove();
}

function updateMiniProfileDom(u) {
  const wrap = $('mini-profile');
  if (!wrap) return;
  const av = wrap.querySelector('.mini-avatar-wrap');
  if (av) av.innerHTML = avatarHTML(u, 64, u.status || 'online');
  const nm = wrap.querySelector('.mini-name');
  if (nm) nm.textContent = u.display_name || u.username;
  const tg = wrap.querySelector('.mini-tag');
  if (tg) tg.textContent = fullTag(u);
  const inp = wrap.querySelector('#mini-status-input');
  if (inp && document.activeElement !== inp) inp.value = u.custom_status || '';
  wrap.querySelectorAll('.mini-status-opt').forEach(o => o.classList.toggle('sel', o.dataset.status === (u.status || 'online')));
  const banner = wrap.querySelector('.mini-banner');
  if (banner) {
    if (u.banner_url) { banner.style.background = `url('${u.banner_url}') center/cover no-repeat`; }
    else { banner.style.background = u.banner_color || u.accent_color || '#5865F2'; }
  }
}

function refreshMiniProfileStatus() { updateMiniProfileDom(me); }
function refreshMiniProfileUser(u) { if (u.id === me.id) updateMiniProfileDom(Object.assign({}, me, u)); }

async function saveMiniStatus(text) {
  try {
    const { user } = await api('/api/me', { method: 'PATCH', body: JSON.stringify({ custom_status: text }) });
    me = user; localStorage.setItem('cr_user', JSON.stringify(me));
    state.usersCache[me.id] = Object.assign({}, state.usersCache[me.id] || {}, me);
    toast(text ? 'Custom status updated' : 'Custom status cleared', 'success');
    updateMiniProfileDom(me);
    if (state.openProfileId === me.id) refreshOpenProfile(me);
  } catch (e) { toast(e.message, 'error'); }
}

async function setMyStatus(status) {
  try {
    const { user } = await api('/api/me', { method: 'PATCH', body: JSON.stringify({ status }) });
    me = user; localStorage.setItem('cr_user', JSON.stringify(me));
    state.usersCache[me.id] = Object.assign({}, state.usersCache[me.id] || {}, me);
    renderMe();
    updateMiniProfileDom(me);
  } catch (e) { toast(e.message, 'error'); }
}

function openMiniProfile() {
  closeMiniProfile();
  const u = Object.assign({}, me, state.usersCache[me.id] || {});
  const wrap = document.createElement('div');
  wrap.className = 'mini-profile';
  wrap.id = 'mini-profile';
  const bannerStyle = u.banner_url
    ? `background-image:url('${escapeHtml(u.banner_url)}')`
    : `background:${escapeHtml(u.banner_color || u.accent_color || '#5865F2')}`;
  const statuses = [
    { id: 'online', label: 'Online' },
    { id: 'idle', label: 'Idle' },
    { id: 'dnd', label: 'Do Not Disturb' },
    { id: 'offline', label: 'Invisible' }
  ];
  wrap.innerHTML = `
    <div class="mini-banner" style="${bannerStyle}"></div>
    <div class="mini-body">
      <div class="mini-avatar-wrap">${avatarHTML(u, 64, u.status || 'online')}</div>
      <div class="mini-name">${escapeHtml(u.display_name || u.username)}</div>
      <div class="mini-tag">${escapeHtml(fullTag(u))}</div>
      <div class="mini-divider"></div>
      <div class="mini-label">Custom Status</div>
      <input class="mini-status-input" id="mini-status-input" maxlength="128" placeholder="What are you up to?" value="${escapeHtml(u.custom_status || '')}">
      <div class="mini-status-row">
        <button class="mini-status-save" id="mini-status-save">Set Status</button>
        <button class="mini-status-clear" id="mini-status-clear">Clear</button>
      </div>
      <div class="mini-divider"></div>
      <div class="mini-label">Status</div>
      <div class="mini-statuses" id="mini-statuses">
        ${statuses.map(s => `<div class="mini-status-opt${(u.status || 'online') === s.id ? ' sel' : ''}" data-status="${s.id}"><span class="ms-dot ${s.id}"></span><span>${s.label}</span><span class="ms-check">${icon('check')}</span></div>`).join('')}
      </div>
      <div class="mini-actions">
        <button class="primary" id="mini-edit">${icon('pencil')} Edit Profile</button>
        <button id="mini-settings">${icon('settings')} Settings</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  hydrateIcons(wrap);
  positionMiniProfile(wrap);

  const save = () => saveMiniStatus(($('mini-status-input').value || '').trim());
  $('mini-status-save').addEventListener('click', save);
  $('mini-status-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  $('mini-status-clear').addEventListener('click', () => { $('mini-status-input').value = ''; saveMiniStatus(''); });
  wrap.querySelectorAll('.mini-status-opt').forEach(opt => opt.addEventListener('click', () => setMyStatus(opt.dataset.status)));
  $('mini-edit').addEventListener('click', () => { closeMiniProfile(); openSettings('account'); });
  $('mini-settings').addEventListener('click', () => { closeMiniProfile(); openSettings('account'); });
}

/* ============================================================
   GLOBAL EVENTS
   ============================================================ */
function bindGlobalEvents() {
  $('rail-home').addEventListener('click', showHome);
  $('rail-add').addEventListener('click', openCreateServer);
  $('rail-explore').addEventListener('click', () => openJoinServer());
  $('sidebar-header').addEventListener('click', serverMenu);
  $('user-panel-me').addEventListener('click', (e) => {
    e.stopPropagation();
    if ($('mini-profile')) closeMiniProfile(); else openMiniProfile();
  });
  $('btn-settings').addEventListener('click', () => openSettings('account'));
  $('btn-mic').addEventListener('click', () => openSettings('voice'));
  $('hdr-notifs').addEventListener('click', (e) => { e.stopPropagation(); openNotifPanel(); });
  $('hdr-members').addEventListener('click', () => { saveSetting('showMembers', !state.showMembers); });
  $('hdr-pins').addEventListener('click', (e) => { e.stopPropagation(); openPinsPanel(); });
  $('hdr-search').addEventListener('click', () => toast('Search is not available yet'));
  const ec = $('empty-create'); if (ec) ec.addEventListener('click', openCreateServer);

  const input = $('message-input');
  let typingSent = 0;
  input.addEventListener('input', () => {
    autoGrow(input);
    updateMentionAutocomplete();
    const now = Date.now();
    if (now - typingSent > 2000) { typingSent = now; emitTyping(); }
  });
  input.addEventListener('keydown', (e) => {
    if (state.mention.active) {
      const len = state.mention.items.length;
      if (e.key === 'ArrowDown') { e.preventDefault(); state.mention.sel = (state.mention.sel + 1) % len; renderMentionPop(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); state.mention.sel = (state.mention.sel - 1 + len) % len; renderMentionPop(); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(state.mention.items[state.mention.sel]); return; }
      if (e.key === 'Escape') { e.preventDefault(); closeMentionPop(); return; }
    }
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

  /* Mentions inside messages: click to open a profile. */
  $('messages').addEventListener('click', (e) => {
    const men = e.target.closest('.mention');
    if (!men) return;
    if (men.dataset.uid) {
      const u = state.usersCache[men.dataset.uid] || (me.id === men.dataset.uid ? me : null);
      if (u) openProfile(u);
    } else if (men.dataset.channel && state.channels) {
      const c = state.channels.find(x => x.name === men.dataset.channel);
      if (c) openChannel(c.id);
    }
  });

  /* Disable the native right-click menu and show a custom one. */
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const dmEl = e.target.closest('.dm-item');
    if (dmEl && dmEl.dataset.dmid) { openDMContextMenu(e.clientX, e.clientY, dmEl.dataset.dmid); return; }
    const chEl = e.target.closest('.channel');
    if (chEl && chEl.dataset.cid && state.server) { openChannelContextMenu(e.clientX, e.clientY, chEl.dataset.cid); return; }
    const msg = e.target.closest('.msg-group');
    if (msg) {
      const m = state.messages.find(x => x.id === msg.dataset.mid);
      if (m) { openMessageContextMenu(e.clientX, e.clientY, m); return; }
    }
    showContextMenu(e.clientX, e.clientY, [
      { label: 'Back', icon: 'chevron-left', onClick: () => history.back() },
      { label: 'Reload', icon: 'refresh', onClick: () => location.reload() },
      { sep: true },
      { label: 'Select All', icon: 'check', onClick: () => { try { document.execCommand('selectAll'); } catch (err) {} } },
      { label: 'Copy', icon: 'copy', onClick: () => { const s = String(window.getSelection()); if (s) navigator.clipboard.writeText(s).catch(() => {}); } }
    ]);
  });

  $('modal-overlay').addEventListener('click', (e) => { if (e.target.id === 'modal-overlay') requestCloseModal(); });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.emoji-picker') && !e.target.closest('.context-menu') && !e.target.closest('.dropdown-menu') &&
        !e.target.closest('.msg-toolbar') && !e.target.closest('#emoji-btn') && !e.target.closest('.notif-panel') &&
        !e.target.closest('#hdr-notifs') && !e.target.closest('.mention-pop') && !e.target.closest('#sidebar-header')) {
      closePopovers();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const cu = $('confirm-overlay');
    if (cu) { cu.remove(); return; }
    if ($('mention-pop')) { closeMentionPop(); return; }
    closePopovers();
    if (!$('modal-overlay').classList.contains('hidden')) requestCloseModal();
  });
}

/* ---------------- Invite handling ---------------- */
async function handleInviteParam() {
  const params = new URLSearchParams(location.search);
  const invite = params.get('invite');
  const msg = params.get('msg');
  if (msg) {
    history.replaceState({}, '', location.pathname);
    setTimeout(() => flashMessage(msg), 500);
    return;
  }
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
