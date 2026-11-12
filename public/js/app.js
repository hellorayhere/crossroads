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
  /* Discord-style unread counters. dmUnread maps a DM id to a count of unread
     messages, mentionUnread maps a channel id to a count of unread @mentions
     and replies. Both are cleared the moment the user opens that conversation. */
  dmUnread: {},
  mentionUnread: {},
  settings: {},
  serverSettings: null,
  roles: [],
  /* Channel categories (Discord-style collapsible groups). Visible to every
     member, not just admins. collapsedCats remembers which groups are folded. */
  categories: [],
  collapsedCats: {},
  mention: { active: false, query: '', items: [], sel: 0, start: 0 }
};

/* Restore the locally-mirrored settings immediately so the theme, background and
   other preferences are correct from the very first frame (before /api/settings
   responds). The server value loaded in init() stays the source of truth. */
try { Object.assign(state.settings, JSON.parse(localStorage.getItem('cr_settings') || '{}')); } catch (e) { /* ignore */ }

/* Emoji set is used only for message content and reactions (a native chat feature). */
const EMOJI_CATEGORIES = [
  { id: 'smileys', label: 'Smileys & Emotion', icon: '\u{1F600}', emojis: [
    '\u{1F600}','\u{1F603}','\u{1F604}','\u{1F601}','\u{1F606}','\u{1F605}','\u{1F602}','\u{1F923}',
    '\u{1F642}','\u{1F643}','\u{1F609}','\u{1F60A}','\u{1F970}','\u{1F60D}','\u{1F929}','\u{1F618}',
    '\u{1F617}','\u{1F61A}','\u{1F619}','\u{1F60B}','\u{1F61B}','\u{1F61C}','\u{1F92A}','\u{1F928}',
    '\u{1F9D0}','\u{1F913}','\u{1F60E}','\u{1F973}','\u{1F60F}','\u{1F612}','\u{1F61E}','\u{1F614}',
    '\u{1F61F}','\u{1F641}','\u{2639}\u{FE0F}','\u{1F623}','\u{1F616}','\u{1F62B}','\u{1F629}','\u{1F97A}',
    '\u{1F622}','\u{1F62D}','\u{1F624}','\u{1F621}','\u{1F620}','\u{1F92C}','\u{1F92F}','\u{1F631}',
    '\u{1F630}','\u{1F975}','\u{1F976}','\u{1F628}','\u{1F627}','\u{1F626}','\u{1F625}','\u{1F917}',
    '\u{1F914}','\u{1F92D}','\u{1F92B}','\u{1F925}','\u{1F610}','\u{1F611}','\u{1F636}','\u{1F644}',
    '\u{1F62F}','\u{1F626}','\u{1F627}','\u{1F62E}','\u{1F632}','\u{1F971}','\u{1F634}','\u{1F924}',
    '\u{1F62A}','\u{1F635}','\u{1F910}','\u{1F974}','\u{1F922}','\u{1F92E}','\u{1F927}','\u{1F637}',
    '\u{1F912}','\u{1F915}'
  ] },
  { id: 'people', label: 'People & Hands', icon: '\u{1F44D}', emojis: [
    '\u{1F44D}','\u{1F44E}','\u{1F44C}','\u{270C}\u{FE0F}','\u{1F91E}','\u{1F91F}','\u{1F918}','\u{1F919}',
    '\u{1F448}','\u{1F449}','\u{1F446}','\u{1F447}','\u{261D}\u{FE0F}','\u{270B}','\u{1F91A}','\u{1F590}\u{FE0F}',
    '\u{1F596}','\u{1F44B}','\u{1F91D}','\u{1F64F}','\u{1F4AA}','\u{1F9BE}','\u{1FAF6}','\u{1F44F}',
    '\u{1F64C}','\u{1F450}','\u{1F932}','\u{1F91C}','\u{1F91B}','\u{270A}','\u{1F44A}','\u{1FAE1}',
    '\u{1FAE0}','\u{1F9B5}','\u{1F9B6}','\u{1F463}','\u{1F440}','\u{1F441}\u{FE0F}','\u{1F9E0}','\u{1FAC0}'
  ] },
  { id: 'nature', label: 'Animals & Nature', icon: '\u{1F436}', emojis: [
    '\u{1F436}','\u{1F431}','\u{1F42D}','\u{1F439}','\u{1F430}','\u{1F98A}','\u{1F43B}','\u{1F43C}',
    '\u{1F428}','\u{1F42F}','\u{1F981}','\u{1F42E}','\u{1F437}','\u{1F438}','\u{1F435}','\u{1F414}',
    '\u{1F427}','\u{1F426}','\u{1F424}','\u{1F984}','\u{1F41D}','\u{1F98B}','\u{1F422}','\u{1F40D}',
    '\u{1F419}','\u{1F980}','\u{1F42C}','\u{1F433}','\u{1F988}','\u{1F335}','\u{1F332}','\u{1F333}',
    '\u{1F334}','\u{1F331}','\u{1F33F}','\u{1F340}','\u{1F341}','\u{1F342}','\u{1F338}','\u{1F33C}',
    '\u{1F33B}','\u{1F31E}','\u{1F31D}','\u{2B50}','\u{1F31F}','\u{2728}','\u{26A1}','\u{1F525}',
    '\u{1F308}','\u{2600}\u{FE0F}','\u{1F319}','\u{2744}\u{FE0F}'
  ] },
  { id: 'food', label: 'Food & Drink', icon: '\u{1F354}', emojis: [
    '\u{1F34F}','\u{1F34E}','\u{1F350}','\u{1F34A}','\u{1F34B}','\u{1F34C}','\u{1F349}','\u{1F347}',
    '\u{1F353}','\u{1FAD0}','\u{1F352}','\u{1F351}','\u{1F96D}','\u{1F34D}','\u{1F965}','\u{1F95D}',
    '\u{1F345}','\u{1F951}','\u{1F966}','\u{1F955}','\u{1F33D}','\u{1F336}\u{FE0F}','\u{1F952}','\u{1F96C}',
    '\u{1F354}','\u{1F35F}','\u{1F355}','\u{1F32D}','\u{1F96A}','\u{1F32E}','\u{1F32F}','\u{1F35C}',
    '\u{1F35D}','\u{1F363}','\u{1F364}','\u{1F366}','\u{1F369}','\u{1F36A}','\u{1F382}','\u{1F370}',
    '\u{1F36B}','\u{1F36C}','\u{1F36D}','\u{2615}','\u{1F375}','\u{1F9CB}','\u{1F37A}','\u{1F37B}','\u{1F942}'
  ] },
  { id: 'objects', label: 'Objects & Activities', icon: '\u{1F3AE}', emojis: [
    '\u{1F3AE}','\u{1F579}\u{FE0F}','\u{1F3A7}','\u{1F3A4}','\u{1F3B8}','\u{1F3B9}','\u{1F941}','\u{1F3BA}',
    '\u{1F3BB}','\u{1F3AC}','\u{1F4F7}','\u{1F4F8}','\u{1F4F1}','\u{1F4BB}','\u{1F5A5}\u{FE0F}','\u{2328}\u{FE0F}',
    '\u{1F5B1}\u{FE0F}','\u{1F5A8}\u{FE0F}','\u{1F4BE}','\u{1F4BF}','\u{1F4C0}','\u{1F389}','\u{1F38A}','\u{1F381}',
    '\u{1F3C6}','\u{1F947}','\u{1F948}','\u{1F949}','\u{26BD}','\u{1F3C0}','\u{1F3C8}','\u{26BE}',
    '\u{1F3BE}','\u{1F3D0}','\u{1F3B1}','\u{1F3AF}','\u{1F3B2}','\u{1F0CF}','\u{1F004}','\u{1F3A8}','\u{1F58C}\u{FE0F}'
  ] },
  { id: 'symbols', label: 'Symbols & Hearts', icon: '\u{2764}\u{FE0F}', emojis: [
    '\u{2764}\u{FE0F}','\u{1F9E1}','\u{1F49B}','\u{1F49A}','\u{1F499}','\u{1F49C}','\u{1F5A4}','\u{1F90D}',
    '\u{1F90E}','\u{1F494}','\u{2763}\u{FE0F}','\u{1F495}','\u{1F49E}','\u{1F493}','\u{1F497}','\u{1F496}',
    '\u{1F498}','\u{1F49D}','\u{1F4AF}','\u{1F4A2}','\u{1F4A5}','\u{1F4AB}','\u{1F4A6}','\u{1F4A8}',
    '\u{1F4AC}','\u{1F5E8}\u{FE0F}','\u{1F534}','\u{1F7E0}','\u{1F7E1}','\u{1F7E2}','\u{1F535}','\u{1F7E3}',
    '\u{26AB}','\u{26AA}','\u{1F7E5}','\u{1F7E7}','\u{1F7E8}','\u{1F7E9}','\u{1F7E6}','\u{1F7EA}','\u{2B1B}','\u{2B1C}',
    '\u{2705}','\u{274C}','\u{2753}','\u{2757}','\u{203C}\u{FE0F}','\u{2049}\u{FE0F}','\u{2795}','\u{2796}','\u{2716}\u{FE0F}'
  ] }
];
const EMOJIS = EMOJI_CATEGORIES.flatMap(c => c.emojis);

/* Palette used for banner / accent selection. */
const PALETTE = ['#5865F2','#3BA55D','#FAA81A','#ED4245','#EB459E','#9B59B6','#1ABC9C','#E67E22','#3498DB','#95A5A6','#2B2D31','#111214'];
/* Accent palette = the standard swatches plus pure black, so a user can make
   the whole profile black with one click (the custom picker covers everything else). */
const ACCENT_PALETTE = PALETTE.concat(['#000000']);

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
  echoCancel: true, noiseSuppress: true, autoGain: true, inputVolume: 70,
  outputVolume: 100, micDeviceId: '', speakerDeviceId: '', voiceLowLatency: true,
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
  },
  'Italiano': {
    'Direct Messages': 'Messaggi diretti', 'Friends': 'Amici', 'Text Channels': 'Canali di testo',
    'Voice Channels': 'Canali vocali', 'Create Channel': 'Crea canale', 'Add Friend': 'Aggiungi amico',
    'Send Friend Request': 'Invia richiesta', 'Online': 'In linea', 'All': 'Tutti', 'Pending': 'In sospeso',
    'Blocked': 'Bloccati', 'Save': 'Salva', 'Log Out': 'Disconnetti', 'Start a conversation': 'Inizia una conversazione',
    'User Settings': 'Impostazioni utente', 'App Settings': "Impostazioni dell'app", 'My Account': 'Il mio account',
    'Profiles': 'Profili', 'Privacy & Safety': 'Privacy e sicurezza', 'Authorized Devices': 'Dispositivi autorizzati',
    'Devices': 'Dispositivi', 'Connections': 'Connessioni', 'Appearance': 'Aspetto',
    'Notifications': 'Notifiche', 'Voice & Video': 'Voce e video', 'Keybinds': 'Scorciatoie', 'Language': 'Lingua'
  },
  'Português, BR': {
    'Direct Messages': 'Mensagens diretas', 'Friends': 'Amigos', 'Text Channels': 'Canais de texto',
    'Voice Channels': 'Canais de voz', 'Create Channel': 'Criar canal', 'Add Friend': 'Adicionar amigo',
    'Send Friend Request': 'Enviar pedido', 'Online': 'On-line', 'All': 'Todos', 'Pending': 'Pendente',
    'Blocked': 'Bloqueados', 'Save': 'Salvar', 'Log Out': 'Sair', 'Start a conversation': 'Iniciar uma conversa',
    'User Settings': 'Configurações do usuário', 'App Settings': 'Configurações do app', 'My Account': 'Minha conta',
    'Profiles': 'Perfis', 'Privacy & Safety': 'Privacidade e segurança', 'Authorized Devices': 'Dispositivos autorizados',
    'Devices': 'Dispositivos', 'Connections': 'Conexões', 'Appearance': 'Aparência',
    'Notifications': 'Notificações', 'Voice & Video': 'Voz e vídeo', 'Keybinds': 'Atalhos', 'Language': 'Idioma'
  },
  'Português, PT': {
    'Direct Messages': 'Mensagens diretas', 'Friends': 'Amigos', 'Text Channels': 'Canais de texto',
    'Voice Channels': 'Canais de voz', 'Create Channel': 'Criar canal', 'Add Friend': 'Adicionar amigo',
    'Send Friend Request': 'Enviar pedido', 'Online': 'Online', 'All': 'Todos', 'Pending': 'Pendente',
    'Blocked': 'Bloqueados', 'Save': 'Guardar', 'Log Out': 'Terminar sessão', 'Start a conversation': 'Iniciar uma conversa',
    'User Settings': 'Definições do utilizador', 'App Settings': 'Definições da app', 'My Account': 'A minha conta',
    'Profiles': 'Perfis', 'Privacy & Safety': 'Privacidade e segurança', 'Authorized Devices': 'Dispositivos autorizados',
    'Devices': 'Dispositivos', 'Connections': 'Ligações', 'Appearance': 'Aspeto',
    'Notifications': 'Notificações', 'Voice & Video': 'Voz e vídeo', 'Keybinds': 'Atalhos', 'Language': 'Idioma'
  },
  'Nederlands': {
    'Direct Messages': 'Directe berichten', 'Friends': 'Vrienden', 'Text Channels': 'Tekstkanalen',
    'Voice Channels': 'Spraakkanalen', 'Create Channel': 'Kanaal maken', 'Add Friend': 'Vriend toevoegen',
    'Send Friend Request': 'Verzoek sturen', 'Online': 'Online', 'All': 'Alle', 'Pending': 'In afwachting',
    'Blocked': 'Geblokkeerd', 'Save': 'Opslaan', 'Log Out': 'Afmelden', 'Start a conversation': 'Begin een gesprek',
    'User Settings': 'Gebruikersinstellingen', 'App Settings': 'App-instellingen', 'My Account': 'Mijn account',
    'Profiles': 'Profielen', 'Privacy & Safety': 'Privacy en veiligheid', 'Authorized Devices': 'Geautoriseerde apparaten',
    'Devices': 'Apparaten', 'Connections': 'Verbindingen', 'Appearance': 'Weergave',
    'Notifications': 'Meldingen', 'Voice & Video': 'Spraak en video', 'Keybinds': 'Sneltoetsen', 'Language': 'Taal'
  },
  'Polski': {
    'Direct Messages': 'Wiadomości prywatne', 'Friends': 'Znajomi', 'Text Channels': 'Kanały tekstowe',
    'Voice Channels': 'Kanały głosowe', 'Create Channel': 'Utwórz kanał', 'Add Friend': 'Dodaj znajomego',
    'Send Friend Request': 'Wyślij zaproszenie', 'Online': 'Online', 'All': 'Wszyscy', 'Pending': 'Oczekujące',
    'Blocked': 'Zablokowani', 'Save': 'Zapisz', 'Log Out': 'Wyloguj', 'Start a conversation': 'Rozpocznij rozmowę',
    'User Settings': 'Ustawienia użytkownika', 'App Settings': 'Ustawienia aplikacji', 'My Account': 'Moje konto',
    'Profiles': 'Profile', 'Privacy & Safety': 'Prywatność i bezpieczeństwo', 'Authorized Devices': 'Autoryzowane urządzenia',
    'Devices': 'Urządzenia', 'Connections': 'Połączenia', 'Appearance': 'Wygląd',
    'Notifications': 'Powiadomienia', 'Voice & Video': 'Głos i wideo', 'Keybinds': 'Skróty', 'Language': 'Język'
  },
  'Русский': {
    'Direct Messages': 'Личные сообщения', 'Friends': 'Друзья', 'Text Channels': 'Текстовые каналы',
    'Voice Channels': 'Голосовые каналы', 'Create Channel': 'Создать канал', 'Add Friend': 'Добавить друга',
    'Send Friend Request': 'Отправить запрос', 'Online': 'В сети', 'All': 'Все', 'Pending': 'Ожидание',
    'Blocked': 'Заблокированные', 'Save': 'Сохранить', 'Log Out': 'Выйти', 'Start a conversation': 'Начать разговор',
    'User Settings': 'Настройки пользователя', 'App Settings': 'Настройки приложения', 'My Account': 'Мой аккаунт',
    'Profiles': 'Профили', 'Privacy & Safety': 'Конфиденциальность и безопасность', 'Authorized Devices': 'Авторизованные устройства',
    'Devices': 'Устройства', 'Connections': 'Подключения', 'Appearance': 'Внешний вид',
    'Notifications': 'Уведомления', 'Voice & Video': 'Голос и видео', 'Keybinds': 'Горячие клавиши', 'Language': 'Язык'
  },
  'Українська': {
    'Direct Messages': 'Особисті повідомлення', 'Friends': 'Друзі', 'Text Channels': 'Текстові канали',
    'Voice Channels': 'Голосові канали', 'Create Channel': 'Створити канал', 'Add Friend': 'Додати друга',
    'Send Friend Request': 'Надіслати запит', 'Online': 'У мережі', 'All': 'Усі', 'Pending': 'Очікує',
    'Blocked': 'Заблоковані', 'Save': 'Зберегти', 'Log Out': 'Вийти', 'Start a conversation': 'Почати розмову',
    'User Settings': 'Налаштування користувача', 'App Settings': 'Налаштування застосунку', 'My Account': 'Мій акаунт',
    'Profiles': 'Профілі', 'Privacy & Safety': 'Приватність і безпека', 'Authorized Devices': 'Авторизовані пристрої',
    'Devices': 'Пристрої', 'Connections': "З'єднання", 'Appearance': 'Вигляд',
    'Notifications': 'Сповіщення', 'Voice & Video': 'Голос і відео', 'Keybinds': 'Гарячі клавіші', 'Language': 'Мова'
  },
  'Türkçe': {
    'Direct Messages': 'Doğrudan Mesajlar', 'Friends': 'Arkadaşlar', 'Text Channels': 'Metin Kanalları',
    'Voice Channels': 'Ses Kanalları', 'Create Channel': 'Kanal Oluştur', 'Add Friend': 'Arkadaş Ekle',
    'Send Friend Request': 'İstek Gönder', 'Online': 'Çevrimiçi', 'All': 'Tümü', 'Pending': 'Beklemede',
    'Blocked': 'Engellenenler', 'Save': 'Kaydet', 'Log Out': 'Çıkış Yap', 'Start a conversation': 'Sohbet başlat',
    'User Settings': 'Kullanıcı Ayarları', 'App Settings': 'Uygulama Ayarları', 'My Account': 'Hesabım',
    'Profiles': 'Profiller', 'Privacy & Safety': 'Gizlilik ve Güvenlik', 'Authorized Devices': 'Yetkili Cihazlar',
    'Devices': 'Cihazlar', 'Connections': 'Bağlantılar', 'Appearance': 'Görünüm',
    'Notifications': 'Bildirimler', 'Voice & Video': 'Ses ve Video', 'Keybinds': 'Kısayollar', 'Language': 'Dil'
  },
  'العربية': {
    'Direct Messages': 'الرسائل المباشرة', 'Friends': 'الأصدقاء', 'Text Channels': 'قنوات نصية',
    'Voice Channels': 'قنوات صوتية', 'Create Channel': 'إنشاء قناة', 'Add Friend': 'إضافة صديق',
    'Send Friend Request': 'إرسال طلب', 'Online': 'متصل', 'All': 'الكل', 'Pending': 'قيد الانتظار',
    'Blocked': 'المحظورون', 'Save': 'حفظ', 'Log Out': 'تسجيل الخروج', 'Start a conversation': 'ابدأ محادثة',
    'User Settings': 'إعدادات المستخدم', 'App Settings': 'إعدادات التطبيق', 'My Account': 'حسابي',
    'Profiles': 'الملفات الشخصية', 'Privacy & Safety': 'الخصوصية والأمان', 'Authorized Devices': 'الأجهزة المصرح بها',
    'Devices': 'الأجهزة', 'Connections': 'الاتصالات', 'Appearance': 'المظهر',
    'Notifications': 'الإشعارات', 'Voice & Video': 'الصوت والفيديو', 'Keybinds': 'اختصارات', 'Language': 'اللغة'
  },
  'हिन्दी': {
    'Direct Messages': 'सीधे संदेश', 'Friends': 'मित्र', 'Text Channels': 'टेक्स्ट चैनल',
    'Voice Channels': 'वॉइस चैनल', 'Create Channel': 'चैनल बनाएँ', 'Add Friend': 'मित्र जोड़ें',
    'Send Friend Request': 'अनुरोध भेजें', 'Online': 'ऑनलाइन', 'All': 'सभी', 'Pending': 'लंबित',
    'Blocked': 'अवरुद्ध', 'Save': 'सहेजें', 'Log Out': 'साइन आउट', 'Start a conversation': 'बातचीत शुरू करें',
    'User Settings': 'उपयोगकर्ता सेटिंग्स', 'App Settings': 'ऐप सेटिंग्स', 'My Account': 'मेरा खाता',
    'Profiles': 'प्रोफ़ाइल', 'Privacy & Safety': 'गोपनीयता और सुरक्षा', 'Authorized Devices': 'अधिकृत डिवाइस',
    'Devices': 'डिवाइस', 'Connections': 'कनेक्शन', 'Appearance': 'रूप',
    'Notifications': 'सूचनाएँ', 'Voice & Video': 'आवाज़ और वीडियो', 'Keybinds': 'शॉर्टकट', 'Language': 'भाषा'
  },
  '日本語': {
    'Direct Messages': 'ダイレクトメッセージ', 'Friends': 'フレンド', 'Text Channels': 'テキストチャンネル',
    'Voice Channels': 'ボイスチャンネル', 'Create Channel': 'チャンネルを作成', 'Add Friend': 'フレンドを追加',
    'Send Friend Request': 'フレンド申請を送信', 'Online': 'オンライン', 'All': 'すべて', 'Pending': '保留中',
    'Blocked': 'ブロック中', 'Save': '保存', 'Log Out': 'ログアウト', 'Start a conversation': '会話を始める',
    'User Settings': 'ユーザー設定', 'App Settings': 'アプリ設定', 'My Account': 'マイアカウント',
    'Profiles': 'プロフィール', 'Privacy & Safety': 'プライバシーと安全', 'Authorized Devices': '認証済みデバイス',
    'Devices': 'デバイス', 'Connections': '連携', 'Appearance': '外観',
    'Notifications': '通知', 'Voice & Video': '音声とビデオ', 'Keybinds': 'キーバインド', 'Language': '言語'
  },
  '한국어': {
    'Direct Messages': '다이렉트 메시지', 'Friends': '친구', 'Text Channels': '텍스트 채널',
    'Voice Channels': '음성 채널', 'Create Channel': '채널 만들기', 'Add Friend': '친구 추가',
    'Send Friend Request': '친구 요청 보내기', 'Online': '온라인', 'All': '전체', 'Pending': '대기 중',
    'Blocked': '차단됨', 'Save': '저장', 'Log Out': '로그아웃', 'Start a conversation': '대화 시작하기',
    'User Settings': '사용자 설정', 'App Settings': '앱 설정', 'My Account': '내 계정',
    'Profiles': '프로필', 'Privacy & Safety': '개인정보 및 보안', 'Authorized Devices': '승인된 기기',
    'Devices': '기기', 'Connections': '연결', 'Appearance': '화면',
    'Notifications': '알림', 'Voice & Video': '음성 및 비디오', 'Keybinds': '단축키', 'Language': '언어'
  },
  '中文, 简体': {
    'Direct Messages': '私信', 'Friends': '好友', 'Text Channels': '文字频道',
    'Voice Channels': '语音频道', 'Create Channel': '创建频道', 'Add Friend': '添加好友',
    'Send Friend Request': '发送好友请求', 'Online': '在线', 'All': '全部', 'Pending': '待处理',
    'Blocked': '已屏蔽', 'Save': '保存', 'Log Out': '退出登录', 'Start a conversation': '开始对话',
    'User Settings': '用户设置', 'App Settings': '应用设置', 'My Account': '我的账户',
    'Profiles': '个人资料', 'Privacy & Safety': '隐私与安全', 'Authorized Devices': '已授权设备',
    'Devices': '设备', 'Connections': '连接', 'Appearance': '外观',
    'Notifications': '通知', 'Voice & Video': '语音与视频', 'Keybinds': '快捷键', 'Language': '语言'
  },
  '中文, 繁體': {
    'Direct Messages': '私訊', 'Friends': '好友', 'Text Channels': '文字頻道',
    'Voice Channels': '語音頻道', 'Create Channel': '建立頻道', 'Add Friend': '新增好友',
    'Send Friend Request': '傳送好友邀請', 'Online': '線上', 'All': '全部', 'Pending': '待處理',
    'Blocked': '已封鎖', 'Save': '儲存', 'Log Out': '登出', 'Start a conversation': '開始對話',
    'User Settings': '使用者設定', 'App Settings': '應用程式設定', 'My Account': '我的帳戶',
    'Profiles': '個人檔案', 'Privacy & Safety': '隱私與安全', 'Authorized Devices': '已授權裝置',
    'Devices': '裝置', 'Connections': '連結', 'Appearance': '外觀',
    'Notifications': '通知', 'Voice & Video': '語音與視訊', 'Keybinds': '快速鍵', 'Language': '語言'
  },
  'Bahasa Indonesia': {
    'Direct Messages': 'Pesan Langsung', 'Friends': 'Teman', 'Text Channels': 'Saluran Teks',
    'Voice Channels': 'Saluran Suara', 'Create Channel': 'Buat Saluran', 'Add Friend': 'Tambah Teman',
    'Send Friend Request': 'Kirim Permintaan', 'Online': 'Daring', 'All': 'Semua', 'Pending': 'Tertunda',
    'Blocked': 'Diblokir', 'Save': 'Simpan', 'Log Out': 'Keluar', 'Start a conversation': 'Mulai percakapan',
    'User Settings': 'Pengaturan Pengguna', 'App Settings': 'Pengaturan Aplikasi', 'My Account': 'Akun Saya',
    'Profiles': 'Profil', 'Privacy & Safety': 'Privasi & Keamanan', 'Authorized Devices': 'Perangkat Resmi',
    'Devices': 'Perangkat', 'Connections': 'Koneksi', 'Appearance': 'Tampilan',
    'Notifications': 'Notifikasi', 'Voice & Video': 'Suara & Video', 'Keybinds': 'Pintasan', 'Language': 'Bahasa'
  },
  'Tiếng Việt': {
    'Direct Messages': 'Tin nhắn riêng', 'Friends': 'Bạn bè', 'Text Channels': 'Kênh văn bản',
    'Voice Channels': 'Kênh thoại', 'Create Channel': 'Tạo kênh', 'Add Friend': 'Thêm bạn',
    'Send Friend Request': 'Gửi lời mời', 'Online': 'Trực tuyến', 'All': 'Tất cả', 'Pending': 'Đang chờ',
    'Blocked': 'Đã chặn', 'Save': 'Lưu', 'Log Out': 'Đăng xuất', 'Start a conversation': 'Bắt đầu trò chuyện',
    'User Settings': 'Cài đặt người dùng', 'App Settings': 'Cài đặt ứng dụng', 'My Account': 'Tài khoản của tôi',
    'Profiles': 'Hồ sơ', 'Privacy & Safety': 'Quyền riêng tư & An toàn', 'Authorized Devices': 'Thiết bị được ủy quyền',
    'Devices': 'Thiết bị', 'Connections': 'Kết nối', 'Appearance': 'Giao diện',
    'Notifications': 'Thông báo', 'Voice & Video': 'Thoại & Video', 'Keybinds': 'Phím tắt', 'Language': 'Ngôn ngữ'
  },
  'Ελληνικά': {
    'Direct Messages': 'Άμεσα μηνύματα', 'Friends': 'Φίλοι', 'Text Channels': 'Κανάλια κειμένου',
    'Voice Channels': 'Κανάλια φωνής', 'Create Channel': 'Δημιουργία καναλιού', 'Add Friend': 'Προσθήκη φίλου',
    'Send Friend Request': 'Αποστολή αιτήματος', 'Online': 'Σε σύνδεση', 'All': 'Όλα', 'Pending': 'Σε αναμονή',
    'Blocked': 'Αποκλεισμένοι', 'Save': 'Αποθήκευση', 'Log Out': 'Αποσύνδεση', 'Start a conversation': 'Ξεκινήστε συνομιλία',
    'User Settings': 'Ρυθμίσεις χρήστη', 'App Settings': 'Ρυθμίσεις εφαρμογής', 'My Account': 'Ο λογαριασμός μου',
    'Profiles': 'Προφίλ', 'Privacy & Safety': 'Απόρρητο & Ασφάλεια', 'Authorized Devices': 'Εξουσιοδοτημένες συσκευές',
    'Devices': 'Συσκευές', 'Connections': 'Συνδέσεις', 'Appearance': 'Εμφάνιση',
    'Notifications': 'Ειδοποιήσεις', 'Voice & Video': 'Φωνή & Βίντεο', 'Keybinds': 'Συντομεύσεις', 'Language': 'Γλώσσα'
  },
  'עברית': {
    'Direct Messages': 'הודעות ישירות', 'Friends': 'חברים', 'Text Channels': 'ערוצי טקסט',
    'Voice Channels': 'ערוצי קול', 'Create Channel': 'צור ערוץ', 'Add Friend': 'הוסף חבר',
    'Send Friend Request': 'שלח בקשת חברות', 'Online': 'מקוון', 'All': 'הכול', 'Pending': 'ממתין',
    'Blocked': 'חסומים', 'Save': 'שמור', 'Log Out': 'התנתק', 'Start a conversation': 'התחל שיחה',
    'User Settings': 'הגדרות משתמש', 'App Settings': 'הגדרות האפליקציה', 'My Account': 'החשבון שלי',
    'Profiles': 'פרופילים', 'Privacy & Safety': 'פרטיות ובטיחות', 'Authorized Devices': 'מכשירים מורשים',
    'Devices': 'מכשירים', 'Connections': 'חיבורים', 'Appearance': 'מראה',
    'Notifications': 'התראות', 'Voice & Video': 'קול ווידאו', 'Keybinds': 'קיצורי דרך', 'Language': 'שפה'
  }
};

/* Full list of selectable display languages: [label, html lang code]. The first
   five have complete nav dictionaries; the rest fall back to English for any
   string that has not been translated yet, which keeps the UI readable. */
const LANGUAGES = [
  ['English, US', 'en-US'], ['English, UK', 'en-GB'],
  ['Español', 'es'], ['Français', 'fr'], ['Deutsch', 'de'],
  ['Italiano', 'it'], ['Português, BR', 'pt-BR'], ['Português, PT', 'pt-PT'],
  ['Nederlands', 'nl'], ['Svenska', 'sv'], ['Norsk', 'no'], ['Dansk', 'da'], ['Suomi', 'fi'],
  ['Polski', 'pl'], ['Čeština', 'cs'], ['Slovenčina', 'sk'], ['Magyar', 'hu'], ['Română', 'ro'],
  ['Български', 'bg'], ['Українська', 'uk'], ['Русский', 'ru'],
  ['Ελληνικά', 'el'], ['Türkçe', 'tr'],
  ['العربية', 'ar'], ['עברית', 'he'], ['فارسی', 'fa'],
  ['हिन्दी', 'hi'], ['বাংলা', 'bn'], ['தமிழ்', 'ta'],
  ['తెలుగు', 'te'], ['മലയാളം', 'ml'], ['ไทย', 'th'],
  ['Tiếng Việt', 'vi'], ['Bahasa Indonesia', 'id'], ['Bahasa Melayu', 'ms'],
  ['日本語', 'ja'], ['한국어', 'ko'],
  ['中文, 简体', 'zh-CN'], ['中文, 繁體', 'zh-TW'],
  ['Filipino', 'fil'], ['Kiswahili', 'sw'], ['Afrikaans', 'af'], ['Català', 'ca'],
  ['Eesti', 'et'], ['Latviešu', 'lv'], ['Lietuvių', 'lt'], ['Hrvatski', 'hr'],
  ['Srpski', 'sr'], ['Slovenščina', 'sl']
];
const LANG_CODE = Object.fromEntries(LANGUAGES);

function t(key) {
  if (key == null) return '';
  const lang = setting('language') || 'English, US';
  const dict = I18N[lang] || I18N['English, US'];
  return (dict && dict[key]) || key;
}

/* Re-render the surfaces that contain translated strings. */
function applyLanguageLite() {
  const code = LANG_CODE[setting('language')] || 'en';
  document.documentElement.lang = code;
  const rtl = /^(ar|he|fa|ur|yi)/i.test(code);
  document.documentElement.dir = rtl ? 'rtl' : 'ltr';
  document.documentElement.classList.toggle('rtl', rtl);
  if (state.view === 'home' && !state.server) { const sn = $('sidebar-name'); if (sn) sn.textContent = t('Direct Messages'); renderDMList(); }
  else if (state.view === 'friends') { renderDMList(); renderFriendsView(); }
  if (state.server) renderChannelList();
}
function applyLanguage() {
  applyLanguageLite();
  /* Re-render the settings chrome so nav labels pick up the new language.
     Only do this when settings is actually open (openSettings resets pending). */
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
  /* Direct Messages: rounded speech bubble with a typing indicator. Reads
     much more clearly at 19px than the old plain outline bubble. */
  'message-dots': '<path d="M20.5 11.6c0 1.2-.3 2.3-.9 3.3a8 8 0 0 1-7.1 4.2c-1.2 0-2.4-.3-3.4-.8L3.5 20.5l1.8-5.3a7.9 7.9 0 0 1-.8-3.6 8 8 0 0 1 4.2-7.1c1-.6 2.1-.9 3.3-.9h.5a8 8 0 0 1 8 8v.5z"/><circle cx="8.9" cy="11.6" r="1.05" fill="currentColor" stroke="none"/><circle cx="12.3" cy="11.6" r="1.05" fill="currentColor" stroke="none"/><circle cx="15.7" cy="11.6" r="1.05" fill="currentColor" stroke="none"/>',
  'plus': '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  'minus': '<line x1="5" y1="12" x2="19" y2="12"/>',
  'compass': '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
  'chevron-up': '<polyline points="18 15 12 9 6 15"/>',
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
  'circle-info': '<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="8" r=".6" fill="currentColor" stroke="none"/>',
  'circle-exclamation': '<circle cx="12" cy="12" r="9"/><line x1="12" y1="7" x2="12" y2="13"/><circle cx="12" cy="16.4" r=".6" fill="currentColor" stroke="none"/>',
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
  'folder': '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  'megaphone': '<path d="M3 11l18-8-3 18-6-5-3 3v-5z"/>',
  'image': '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  'film': '<rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/>',
  'crown': '<path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5z"/><path d="M5 19h14"/>',
  'ghost': '<path d="M9 10h.01M15 10h.01M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z"/>',
  'server': '<rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>',
  'file': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  'plug': '<path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8zM12 17v5"/>',
  'link': '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  'mobile': '<rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
  'tablet': '<rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
  'monitor': '<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
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
  'play': '<polygon points="6 4 20 12 6 20 6 4"/>',
  'pause': '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  'volume-x': '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>',
  'volume-1': '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>',
  'maximize': '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/>',
  'minimize': '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M16 3v3a2 2 0 0 0 2 2h3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/><path d="M8 21v-3a2 2 0 0 0-2-2H3"/>',
  'mic-off': '<line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><path d="M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2"/><path d="M19 10v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
  'headphones': '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>',
  'headphones-off': '<line x1="1" y1="1" x2="23" y2="23"/><path d="M3 18v-6a9 9 0 0 1 13.7-7.7"/><path d="M21 18v-6a9 9 0 0 0-3.4-7"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>',
  'phone-off': '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/><line x1="23" y1="1" x2="1" y2="23"/>',
  'signal': '<path d="M2 20h.01M7 20v-4M12 20v-8M17 20V8M22 20V4"/>',
  'screen-share': '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  'grid': '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  'arrow-up': '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>',
  'arrow-down': '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>',
  'grip': '<circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/>',
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

/* Turn plain text (About Me / notes) into safe HTML with clickable links.
   Handles full URLs, bare domains, and "gg/code" server invites. */
function linkifyBio(text) {
  if (!text) return '';
  let html = escapeHtml(text);
  const tokens = [];
  const stash = (anchorHtml) => { tokens.push(anchorHtml); return '\u0000' + (tokens.length - 1) + '\u0000'; };

  // 1. Full URLs (with protocol) — keep trailing punctuation outside the link.
  html = html.replace(/(https?:\/\/[^\s<]+)/g, (u) => {
    let trail = '';
    let url = u;
    while (/[.,!?;:)\]]$/.test(url)) { trail = url.slice(-1) + trail; url = url.slice(0, -1); }
    return stash(`<a class="bio-link" href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`) + trail;
  });

  // 2. Server invite codes: gg/xxxx or invite/xxxx
  html = html.replace(/(^|[\s(])((?:gg|invite)\/([A-Za-z0-9_-]{4,64}))/g, (m, pre, full, code) =>
    pre + stash(`<a class="bio-link" href="/app.html?invite=${code}" target="_blank" rel="noopener noreferrer">${full}</a>`));

  // 3. Bare domains (www.example.com or example.com/path)
  html = html.replace(/(^|[\s(])((?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]{2,})+(?:\/[^\s<)]*)?)/gi, (m, pre, url) =>
    pre + stash(`<a class="bio-link" href="https://${url}" target="_blank" rel="noopener noreferrer">${url}</a>`));

  // 4. Line breaks
  html = html.replace(/\n/g, '<br>');

  // 5. Restore link placeholders
  html = html.replace(/\u0000(\d+)\u0000/g, (m, i) => tokens[Number(i)] || '');
  return html;
}

/* Bios support the full Discord markdown set (bold, italic, underline,
   strikethrough, spoilers, code, quotes, headings and lists) while preserving
   the author's line breaks. */
function formatBio(text) {
  if (!text) return '';
  let html = formatContent(text);
  html = html.replace(/\n/g, '<br>');
  return html;
}

/* ---------- Colour helpers (hex <-> hsl) for the custom colour wheel ---------- */
function hexToRgb(hex) {
  hex = String(hex || '').replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const n = parseInt(hex, 16);
  if (isNaN(n)) return { r: 88, g: 101, b: 242 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex(r, g, b) {
  const h = (x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b);
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2; const d = max - min;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}
function hslToRgb(h, s, l) {
  h /= 360; s /= 100; l /= 100;
  if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return { r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255), g: Math.round(hue2rgb(p, q, h) * 255), b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255) };
}
function hslToHex(h, s, l) { const { r, g, b } = hslToRgb(h, s, l); return rgbToHex(r, g, b); }
function hexToHsl(hex) { const { r, g, b } = hexToRgb(hex); return rgbToHsl(r, g, b); }

/* Custom HSV colour wheel. root = element containing .cw-wheel/.cw-cursor/
   .cw-light-range/.cw-hex-input/.cw-preview. onChange(hex) fires on every change. */
function setupColorWheel(root, initialHex, onChange) {
  if (!root) return null;
  const wheel = root.querySelector('.cw-wheel');
  const cursor = root.querySelector('.cw-cursor');
  const lightEl = root.querySelector('.cw-light-range');
  const hexEl = root.querySelector('.cw-hex-input');
  const preview = root.querySelector('.cw-preview');
  const start = hexToHsl(initialHex || '#5865F2');
  let h = start.h, s = start.s, l = start.l;

  const render = (emit) => {
    const hex = hslToHex(h, s, l);
    if (preview) preview.style.background = hex;
    if (hexEl && document.activeElement !== hexEl) hexEl.value = hex.toUpperCase();
    if (cursor) {
      const rad = h * Math.PI / 180;
      const r = (s / 100) * 50;
      cursor.style.left = (50 + r * Math.cos(rad)) + '%';
      cursor.style.top = (50 + r * Math.sin(rad)) + '%';
      cursor.style.background = hex;
    }
    if (lightEl && document.activeElement !== lightEl) lightEl.value = Math.round(l);
    if (emit && onChange) onChange(hex);
  };

  const pick = (ev) => {
    const rect = wheel.getBoundingClientRect();
    const dx = ev.clientX - (rect.left + rect.width / 2);
    const dy = ev.clientY - (rect.top + rect.height / 2);
    let ang = Math.atan2(dy, dx) * 180 / Math.PI;
    ang = (ang % 360 + 360) % 360;
    const dist = Math.sqrt(dx * dx + dy * dy);
    s = Math.min(1, dist / (rect.width / 2)) * 100;
    h = ang;
    render(true);
  };

  let dragging = false;
  wheel.addEventListener('pointerdown', (e) => { dragging = true; try { wheel.setPointerCapture(e.pointerId); } catch (_) {} pick(e); });
  wheel.addEventListener('pointermove', (e) => { if (dragging) pick(e); });
  const stop = (e) => { dragging = false; try { wheel.releasePointerCapture(e.pointerId); } catch (_) {} };
  wheel.addEventListener('pointerup', stop);
  wheel.addEventListener('pointercancel', stop);
  if (lightEl) lightEl.addEventListener('input', () => { l = Number(lightEl.value); render(true); });
  if (hexEl) {
    const applyHex = () => {
      const v = hexEl.value.trim();
      if (/^#?[0-9a-fA-F]{6}$/.test(v) || /^#?[0-9a-fA-F]{3}$/.test(v)) {
        const hsl = hexToHsl(v.startsWith('#') ? v : '#' + v);
        h = hsl.h; s = hsl.s; l = hsl.l; render(true);
      } else { render(false); }
    };
    hexEl.addEventListener('change', applyHex);
    hexEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyHex(); } });
  }
  render(false);
  return { get: () => hslToHex(h, s, l), set: (hex) => { const hsl = hexToHsl(hex); h = hsl.h; s = hsl.s; l = hsl.l; render(false); } };
}

/* Decide a readable ink (text) colour for a given accent background, so a light
   accent (e.g. yellow) gets dark text and a dark accent (e.g. black) gets light text. */
function accentInk(hex) {
  const { r, g, b } = hexToRgb(hex);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const light = lum > 0.62;
  return {
    ink: light ? '#0b0b0e' : '#ffffff',
    ink2: light ? 'rgba(11,11,14,.66)' : 'rgba(255,255,255,.78)',
    edge: light ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.18)',
    shade: light ? '#ffffff' : '#000000'
  };
}

/* Apply an accent colour (and its matching ink/edge variables) to a container. */
function applyAccent(el, hex) {
  if (!el) return;
  const c = (hex && /^#[0-9a-fA-F]{3,8}$/.test(hex)) ? hex : '#5865F2';
  const k = accentInk(c);
  el.style.setProperty('--accent', c);
  el.style.setProperty('--accent-ink', k.ink);
  el.style.setProperty('--accent-ink-2', k.ink2);
  el.style.setProperty('--accent-edge', k.edge);
  el.style.setProperty('--accent-shade', k.shade);
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
/* Copy helper with a graceful fallback for browsers/contexts without the
   async clipboard API. */
function fallbackCopyText(t, done) {
  try {
    const ta = document.createElement('textarea');
    ta.value = t; ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    document.execCommand('copy'); ta.remove(); done();
  } catch (e) { toast('Could not copy', 'error'); }
}
function copyToClipboard(text, label) {
  const t = String(text == null ? '' : text);
  if (!t) return;
  const done = () => toast((label || 'Copied') + (label && label.endsWith(':') ? ' ' : ': ') + t, 'success');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).then(done).catch(() => fallbackCopyText(t, done));
  } else fallbackCopyText(t, done);
}
/* Make an element click-to-copy. */
function makeCopyable(el, text, label) {
  if (!el) return;
  el.style.cursor = 'pointer';
  el.title = 'Click to copy';
  el.addEventListener('click', (e) => { e.stopPropagation(); copyToClipboard(typeof text === 'function' ? text() : text, label); });
}
function statusLabel(s) { return { online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb', offline: 'Invisible' }[s] || 'Offline'; }

function avatarHTML(user, size = 40, status = null) {
  if (!user) user = { username: '?' };
  /* When an image is present, use a neutral dark placeholder (never the blurple
     default) so no coloured flash appears before the picture paints. */
  const bg = user.avatar_url ? '#2b2d31' : (user.accent_color || '#5865f2');
  const inner = user.avatar_url
    ? `<img src="${escapeHtml(user.avatar_url)}" alt="" loading="eager" decoding="async" fetchpriority="high">`
    : (user.avatar ? escapeHtml(user.avatar) : escapeHtml((user.username || '?')[0].toUpperCase()));
  const dot = status ? `<span class="status-dot ${status}"></span>` : '';
  /* Use background-color (not the `background` shorthand) so the stylesheet's
     `background-clip: padding-box` is not reset. That clip is what keeps the
     avatar's colour from bleeding under a transparent border and forming a
     coloured ring around the profile picture. */
  return `<div class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px;background-color:${bg};background-clip:padding-box">${inner}${dot}</div>`;
}

/* Role icons can be a custom uploaded image (URL) or a legacy short glyph. */
function roleIconHTML(icon, cls = 'role-ico-img') {
  if (!icon) return '';
  if (/^(https?:)?\/\//i.test(icon) || icon.startsWith('/uploads/') || icon.startsWith('data:')) {
    return `<img class="${cls}" src="${escapeHtml(icon)}" alt="" loading="lazy">`;
  }
  return `<span class="role-ico">${escapeHtml(icon)}</span>`;
}

/* Render a user's profile badges as small image+name chips. Badges are
   assigned by platform admins and arrive on the public user payload. */
function badgeChips(user, opts = {}) {
  const list = (user && user.badges) || [];
  if (!list.length) return '';
  const cls = opts.compact ? 'badge-chip compact' : 'badge-chip';
  return `<span class="badge-row">${list.map(b => `<span class="${cls}" title="${escapeHtml(b.name)}"><img src="${escapeHtml(b.icon_url)}" alt="${escapeHtml(b.name)}" loading="lazy"><span class="badge-chip-name">${escapeHtml(b.name)}</span></span>`).join('')}</span>`;
}

function serverRolePills(user) {
  const list = (user && user.server_roles) || [];
  if (!list.length) return '';
  return `<div class="profile-roles">${list.map(r => `<span class="profile-role-pill" style="color:${escapeHtml(r.color || '#99aab5')};border-color:${escapeHtml(r.color || '#99aab5')}66;background:${escapeHtml(r.color || '#99aab5')}1f" title="${escapeHtml(r.server_name || '')}">${roleIconHTML(r.icon, 'role-tag-ico')}${escapeHtml(r.name)}<span class="prs-srv">${escapeHtml(r.server_name || '')}</span></span>`).join('')}</div>`;
}

/* ---------------- Settings helpers ---------------- */
function setting(key) { return state.settings[key] !== undefined ? state.settings[key] : SETTINGS_DEFAULTS[key]; }

/* Mirror settings into localStorage so the saved theme/background can be
   applied synchronously before the first paint (prevents the theme flash). */
function mirrorSettingsLocal() {
  try { localStorage.setItem('cr_settings', JSON.stringify(state.settings || {})); } catch (e) { /* ignore */ }
}

/* ---------------- Client-side custom background ----------------
   Purely local: the chosen image/GIF lives in localStorage on this device and
   is never uploaded to the server. A fixed layer sits behind #app; when it is
   active the panels turn translucent so the artwork (including animated GIFs)
   shows through while text stays readable. */
const CUSTOM_BG_KEY = 'cr_custom_bg';
function getCustomBg() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_BG_KEY) || 'null'); } catch (e) { return null; }
}
function setCustomBg(cfg) {
  try {
    if (cfg && cfg.url) localStorage.setItem(CUSTOM_BG_KEY, JSON.stringify(cfg));
    else localStorage.removeItem(CUSTOM_BG_KEY);
  } catch (e) {
    return false;
  }
  applyCustomBg();
  return true;
}
function cbNum(v, def, min, max) {
  const n = Number(v);
  if (!isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}
/* Adjustments are stored alongside the image so they survive a reload:
   scale (1 = fit), opacity (0-1), blur (px) and background position. */
const CB_FITS = ['cover', 'contain', 'stretch', 'tile'];
function cbOptions(cfg) {
  cfg = cfg || {};
  const fit = CB_FITS.includes(cfg.fit) ? cfg.fit : 'cover';
  /* Legacy configs stored a single `position` string - map it onto x/y. */
  let x = cfg.x, y = cfg.y;
  if (x == null || y == null) {
    const pos = typeof cfg.position === 'string' ? cfg.position : 'center center';
    const [px, py] = pos.split(' ');
    const map = { left: 0, center: 50, right: 100, top: 0, bottom: 100 };
    x = x == null ? (map[px] != null ? map[px] : 50) : x;
    y = y == null ? (map[py] != null ? map[py] : 50) : y;
  }
  return {
    scale: cbNum(cfg.scale, 1, 1, 3),
    opacity: cbNum(cfg.opacity, 1, 0.05, 1),
    blur: cbNum(cfg.blur, 0, 0, 30),
    brightness: cbNum(cfg.brightness, 1, 0.4, 1.6),
    fit,
    x: cbNum(x, 50, 0, 100),
    y: cbNum(y, 50, 0, 100)
  };
}
function cbSizeValue(fit) {
  if (fit === 'contain') return 'contain';
  if (fit === 'stretch') return '100% 100%';
  if (fit === 'tile') return 'auto';
  return 'cover';
}
function applyCustomBg() {
  const layer = document.getElementById('app-bg-layer');
  if (!layer) return;
  const cfg = getCustomBg();
  if (cfg && cfg.url) {
    const o = cbOptions(cfg);
    layer.style.backgroundImage = `url("${String(cfg.url).replace(/"/g, '%22')}")`;
    layer.style.backgroundSize = cbSizeValue(o.fit);
    layer.style.backgroundPosition = `${o.x}% ${o.y}%`;
    layer.style.backgroundRepeat = o.fit === 'tile' ? 'repeat' : 'no-repeat';
    /* Zoom with transform (not background-size) so the artwork always keeps
       covering the viewport, whatever its aspect ratio. */
    layer.style.transform = `scale(${o.scale})`;
    layer.style.transformOrigin = `${o.x}% ${o.y}%`;
    const filters = [];
    if (o.blur > 0) filters.push(`blur(${o.blur}px)`);
    if (o.brightness !== 1) filters.push(`brightness(${o.brightness})`);
    layer.style.filter = filters.join(' ');
    layer.style.opacity = String(o.opacity);
    document.body.classList.add('has-custom-bg');
    document.body.style.setProperty('--cb-img-opacity', String(o.opacity));
  } else {
    layer.style.backgroundImage = '';
    layer.style.transform = '';
    layer.style.filter = '';
    layer.style.opacity = '';
    document.body.classList.remove('has-custom-bg');
    document.body.style.removeProperty('--cb-img-opacity');
  }
}
/* Merge a partial adjustment into the saved config without losing the image. */
function updateCustomBgOptions(patch) {
  const cfg = getCustomBg();
  if (!cfg || !cfg.url) return false;
  return setCustomBg(Object.assign({}, cfg, patch));
}

function applyTheme() {
  document.body.dataset.theme = setting('theme') || 'dark';
  document.body.dataset.bg = setting('bg') || 'graphite';
  document.body.classList.toggle('compact', !!setting('compact'));
  state.showMembers = setting('showMembers') !== false;
  applyCustomBg();
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

/* ---------------- API ----------------
   Render's free plan stops the service when it has been idle, so the very first
   request after a quiet spell can fail with a network error or a 502/503 while
   the instance boots. Boot-time calls pass `retries` so they wait out the cold
   start instead of showing an error to the visitor. */
async function api(path, opts = {}) {
  const headers = Object.assign({ 'Authorization': 'Bearer ' + token }, opts.headers || {});
  if (opts.body && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const init = Object.assign({}, opts, { headers });
  const tries = Number.isFinite(opts.retries) ? opts.retries : 0;
  delete init.retries;
  let lastErr = null;
  for (let i = 0; i <= tries; i++) {
    try {
      const res = await fetch(API + path, init);
      if (res.status === 401) { logout(); throw new Error('Session expired'); }
      if ((res.status === 502 || res.status === 503 || res.status === 504) && i < tries) {
        await new Promise(r => setTimeout(r, 1200 * (i + 1)));
        continue;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { const err = new Error(data.error || 'Request failed'); err.status = res.status; throw err; }
      return data;
    } catch (e) {
      lastErr = e;
      /* Only retry transient failures (network / 5xx). A 4xx will never
         succeed on a retry, so fail fast instead of stalling the UI. */
      const retriable = !e.status || e.status >= 500;
      if (e.message === 'Session expired' || i >= tries || !retriable) throw e;
      await new Promise(r => setTimeout(r, 900 * (i + 1)));
    }
  }
  throw lastErr || new Error('Request failed');
}

function logout() {
  localStorage.removeItem('cr_token');
  localStorage.removeItem('cr_user');
  window.location.href = '/';
}

/* ============================================================
   END-TO-END ENCRYPTION
   ------------------------------------------------------------
   Every device generates its own ECDH P-256 keypair. The public half is
   registered with the server; the private half never leaves this browser.
   A message is encrypted once with a random AES-256-GCM key, and that key is
   then wrapped (ECIES: ephemeral ECDH + AES-GCM) for every recipient device.
   The server stores only ciphertext and wrapped keys, so it can never read a
   message. Legacy plaintext messages still render normally.
   ============================================================ */
const E2E_PREFIX = '\u0001E2E1:';
const e2e = { ready: null, priv: null, pub: null, keyId: null, config: null };

function e2eB64e(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function e2eB64d(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function e2eStorageKey() { return 'cr_e2e_' + (me && me.id ? me.id : 'anon'); }
function e2eSupported() { return !!(window.crypto && window.crypto.subtle && window.isSecureContext !== false); }

async function e2eInit() {
  if (e2e.ready) return e2e.ready;
  e2e.ready = (async () => {
    if (!e2eSupported() || !me) { e2e.ready = null; return false; }
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(e2eStorageKey()) || 'null'); } catch (e) { saved = null; }
    try {
      if (saved && saved.priv && saved.pub && saved.keyId) {
        e2e.priv = await crypto.subtle.importKey('jwk', saved.priv, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
        e2e.pub = saved.pub;
        e2e.keyId = saved.keyId;
      } else {
        const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
        const privJwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
        const pubJwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
        e2e.keyId = 'k_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        e2e.priv = kp.privateKey;
        e2e.pub = pubJwk;
        localStorage.setItem(e2eStorageKey(), JSON.stringify({ priv: privJwk, pub: pubJwk, keyId: e2e.keyId }));
      }
      /* Register (or refresh) this device's public key. */
      await api('/api/e2e/keys', { method: 'POST', body: JSON.stringify({ key_id: e2e.keyId, public_jwk: JSON.stringify(e2e.pub) }) });
      return true;
    } catch (err) {
      console.warn('[e2e] init failed', err);
      e2e.ready = null;   /* allow a later retry */
      return false;
    }
  })();
  return e2e.ready;
}

async function e2eConfig() {
  if (e2e.config) return e2e.config;
  try { e2e.config = await api('/api/e2e/config'); } catch (e) { e2e.config = { enabled: false, explicit_terms: [] }; }
  return e2e.config;
}

/* HKDF-SHA-256: turn raw ECDH shared bits into a uniformly-random 256-bit key.
   Raw ECDH output is not uniformly distributed, so we always run it through
   HKDF before using it as an AES key (defence against biased key material). */
async function e2eHkdf(bits, salt, info) {
  const base = await crypto.subtle.importKey('raw', bits, { name: 'HKDF' }, false, ['deriveBits']);
  return crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode(info) },
    base, 256
  );
}

/* Wrap a raw 32-byte AES key for one recipient public key.
   v2: ECDH -> HKDF-SHA-256 (random salt) -> AES-256-GCM with AAD binding the
   recipient key id, so a wrapped key can never be replayed onto another device. */
async function e2eWrapKey(pubJwk, rawKey, keyId) {
  const pub = await crypto.subtle.importKey('jwk', pubJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, eph.privateKey, 256);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const kekBits = await e2eHkdf(bits, salt, 'crossroads-e2e-kek-v2');
  const kek = await crypto.subtle.importKey('raw', kekBits, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode('E2E1|v2|' + keyId);
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, kek, rawKey);
  const ephPub = await crypto.subtle.exportKey('jwk', eph.publicKey);
  return { e: ephPub, i: e2eB64e(iv), k: e2eB64e(wrapped), s: e2eB64e(salt), d: 'hkdf' };
}

async function e2eFetchKeys(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return [];
  const data = await api('/api/e2e/keys?ids=' + encodeURIComponent(unique.join(',')));
  return data.keys || [];
}

/* Encrypt a message for the given recipients. Returns { content, encrypted }.
   If any recipient has no registered key we fall back to plaintext so nobody
   is ever locked out of a conversation. */
async function e2eEncrypt(content, recipientIds) {
  if (!content) return { content, encrypted: false };
  const ok = await e2eInit();
  if (!ok) return { content, encrypted: false };
  const ids = [...new Set((recipientIds || []).filter(Boolean))];
  if (!ids.includes(me.id)) ids.push(me.id);
  let keys;
  try { keys = await e2eFetchKeys(ids); } catch (e) { return { content, encrypted: false }; }
  const byUser = {};
  for (const k of keys) (byUser[k.user_id] = byUser[k.user_id] || []).push(k);
  for (const id of ids) if (!byUser[id] || !byUser[id].length) return { content, encrypted: false };
  try {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aad = new TextEncoder().encode('E2E1|v2');
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, new TextEncoder().encode(content));
    const wrapped = {};
    for (const k of keys) wrapped[k.key_id] = await e2eWrapKey(JSON.parse(k.public_jwk), raw, k.key_id);
    const env = { v: 2, iv: e2eB64e(iv), ct: e2eB64e(ct), keys: wrapped };
    return { content: E2E_PREFIX + JSON.stringify(env), encrypted: true };
  } catch (e) {
    console.warn('[e2e] encrypt failed', e);
    return { content, encrypted: false };
  }
}

async function e2eDecrypt(content) {
  if (typeof content !== 'string' || !content.startsWith(E2E_PREFIX)) return content;
  const ok = await e2eInit();
  if (!ok) return null;
  try {
    const env = JSON.parse(content.slice(E2E_PREFIX.length));
    const entry = env.keys && env.keys[e2e.keyId];
    if (!entry) return null;
    const ephPub = await crypto.subtle.importKey('jwk', entry.e, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: ephPub }, e2e.priv, 256);
    /* v2 uses HKDF + AAD; v1 (legacy) uses the raw ECDH bits directly. */
    const isV2 = Number(env.v) >= 2;
    const kekBits = (isV2 && entry.s)
      ? await e2eHkdf(bits, e2eB64d(entry.s), 'crossroads-e2e-kek-v2')
      : bits;
    const kek = await crypto.subtle.importKey('raw', kekBits, { name: 'AES-GCM' }, false, ['decrypt']);
    const wrapAad = isV2 ? new TextEncoder().encode('E2E1|v2|' + e2e.keyId) : undefined;
    const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: e2eB64d(entry.i), additionalData: wrapAad }, kek, e2eB64d(entry.k));
    const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
    const msgAad = isV2 ? new TextEncoder().encode('E2E1|v2') : undefined;
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: e2eB64d(env.iv), additionalData: msgAad }, key, e2eB64d(env.ct));
    return new TextDecoder().decode(pt);
  } catch (e) {
    return null;
  }
}

/* Decrypt in place so every downstream render path sees plaintext. */
async function e2eDecryptMessage(m) {
  if (!m) return m;
  if (typeof m.content === 'string' && m.content.startsWith(E2E_PREFIX)) {
    m.encrypted = true;
    const pt = await e2eDecrypt(m.content);
    if (pt == null) { m.content = ''; m.decrypt_failed = true; }
    else m.content = pt;
  }
  if (m.reply_to) await e2eDecryptMessage(m.reply_to);
  return m;
}
async function e2eDecryptAll(list) {
  if (!Array.isArray(list)) return list;
  for (const m of list) await e2eDecryptMessage(m);
  return list;
}

/* Recipient ids for the conversation currently open. */
function e2eRecipients() {
  if (state.channel) return (state.members || []).map(x => x.id);
  if (state.dm && state.dm.user) return [me.id, state.dm.user.id];
  return [me.id];
}

/* Mention ids / broadcast ping computed locally (the server cannot parse
   ciphertext). Mirrors the server's @username and @everyone/@here rules. */
function e2eMentionIds(text) {
  if (!text) return [];
  const cands = mentionCandidates();
  const ids = new Set();
  const re = /@([a-zA-Z0-9._]+)/g;
  let mm;
  while ((mm = re.exec(text)) !== null) {
    const name = mm[1].toLowerCase();
    if (name === 'everyone' || name === 'here') continue;
    const u = cands.find(x => (x.username || '').toLowerCase() === name);
    if (u && u.id !== me.id) ids.add(u.id);
  }
  return [...ids];
}
function e2eBroadcast(text) {
  if (!text) return null;
  if (/@everyone\b/i.test(text)) return 'everyone';
  if (/@here\b/i.test(text)) return 'here';
  return null;
}

/* Client-side equivalent of the server's explicit-content filter, used only
   for encrypted bodies (the server cannot scan ciphertext). */
async function e2eExplicitCheck(text) {
  if (!text) return null;
  if (!state.serverSettings || !state.serverSettings.explicit_filter) return null;
  const cfg = await e2eConfig();
  const low = text.toLowerCase();
  for (const term of (cfg.explicit_terms || [])) {
    if (term && low.includes(String(term).toLowerCase())) return 'this message contains explicit language';
  }
  return null;
}

/* ---------------- Notices (removed) ----------------
   The grey notification strip at the bottom of the chat column has been
   removed entirely. `toast()` is kept as a no-op so the many call sites that
   report success/failure keep working without spamming the interface. */
let _toastEl = null, _toastTimer = 0;
/* A single, quiet toast that matches the rest of the surface: no bright
   colours, no bounce. Errors are the only thing worth interrupting for, and
   they are marked by a small muted dot rather than a loud red bar. */
function toast(msg, kind) {
  if (!msg) return;
  /* Show every kind of toast. Previously only errors/alerts were displayed,
     which silently swallowed all of the app's success confirmations. */
  try {
    if (!_toastEl) {
      _toastEl = document.createElement('div');
      _toastEl.className = 'toast';
      _toastEl.innerHTML = '<span class="toast-dot"></span><span class="toast-msg"></span>';
      document.body.appendChild(_toastEl);
    }
    _toastEl.classList.toggle('is-alert', kind === 'alert');
    _toastEl.querySelector('.toast-msg').textContent = String(msg);
    _toastEl.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => _toastEl && _toastEl.classList.remove('show'), 4200);
  } catch (e) { /* ignore */ }
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
        <input id="pd-input" type="${opts.input === 'password' ? 'password' : 'text'}" value="${escapeHtml(opts.value || '')}" placeholder="${escapeHtml(opts.placeholder || '')}" maxlength="${opts.maxlength || 256}"></div>
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

/* Dedicated, purpose-built dialog for resetting the two-step code.
   Resolves with the account password (string) or null if cancelled. */
function twoFactorResetDialog() {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'confirm-overlay tfr-overlay';
    wrap.innerHTML = `
      <div class="confirm-box tfr-box">
        <div class="tfr-icon">${icon('shield')}</div>
        <h3>Reset your two-step code?</h3>
        <p class="tfr-sub">This turns two-step login <b>off</b> and generates a brand-new code. Your old authenticator entry will stop working immediately.</p>
        <ul class="tfr-list">
          <li>${icon('lock')}<span>You must enter your account password</span></li>
          <li>${icon('refresh')}<span>The previous code is invalidated right away</span></li>
          <li>${icon('mobile')}<span>Set up the new code to turn two-step back on</span></li>
        </ul>
        <div class="field tfr-field">
          <label for="tfr-pw">Account password <span class="req">*</span></label>
          <div class="tfr-pw-wrap">
            <input id="tfr-pw" type="password" placeholder="Enter your password" autocomplete="current-password" maxlength="128">
            <button type="button" class="tfr-eye" id="tfr-eye" aria-label="Show password" title="Show password">${icon('eye')}</button>
          </div>
          <div class="tfr-error" id="tfr-error" role="alert"></div>
        </div>
        <div class="confirm-actions">
          <button class="btn ghost" id="tfr-cancel">Cancel</button>
          <button class="btn danger" id="tfr-ok">Reset code</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const input = wrap.querySelector('#tfr-pw');
    const eye = wrap.querySelector('#tfr-eye');
    const errEl = wrap.querySelector('#tfr-error');
    const okBtn = wrap.querySelector('#tfr-ok');
    let done = false;
    const finish = (v) => { if (done) return; done = true; wrap.remove(); resolve(v); };
    const submit = () => {
      const pw = input.value;
      if (!pw) { errEl.textContent = 'Please enter your account password.'; input.focus(); return; }
      finish(pw);
    };
    okBtn.addEventListener('click', submit);
    wrap.querySelector('#tfr-cancel').addEventListener('click', () => finish(null));
    wrap.addEventListener('click', (e) => { if (e.target === wrap) finish(null); });
    eye.addEventListener('click', () => {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      eye.classList.toggle('on', !showing);
      eye.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
      input.focus();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') finish(null);
    });
    setTimeout(() => input.focus(), 40);
  });
}

/* ============================================================
   INIT
   ============================================================ */
/* ============================================================
   PRESENCE CONTROLLER
   ------------------------------------------------------------
   The status a user picks in settings is the "chosen" status and is stored in
   the database. Two things can temporarily override what other people see:
     • tab hidden for 3 minutes  -> offline
     • no activity for 5 minutes -> idle
   Both are sent to the server as transient overrides (never persisted), and
   are cleared the moment the user comes back / becomes active, restoring the
   chosen status exactly as it was.
   ============================================================ */
const TAB_OFFLINE_MS = 3 * 60 * 1000;
const IDLE_MS = 5 * 60 * 1000;
/* One low-frequency tick drives everything. Browsers throttle (and after a
   while freeze) timers in hidden tabs, so a single 3-minute setTimeout can be
   delayed by minutes or never fire at all. Comparing timestamps on a short
   interval is reliable even when the tab is in the background. */
const PRESENCE_TICK_MS = 10 * 1000;

let myChosenStatus = (me && me.status) || 'online';
let tabAwayOffline = false;
let userIsIdle = false;
let hiddenAt = 0;
let lastActivityAt = Date.now();
let lastPushedStatus = null;
let presenceReady = false;
let presenceTicks = 0;

function computeEffectiveStatus() {
  if (tabAwayOffline) return 'offline';
  if (userIsIdle && (myChosenStatus === 'online' || myChosenStatus === 'idle')) return 'idle';
  return myChosenStatus;
}

function pushPresence(force) {
  if (!socket || !socket.connected) return;
  const status = computeEffectiveStatus();
  if (!force && status === lastPushedStatus) return;
  lastPushedStatus = status;
  socket.emit('set_presence', { status });
}

/* Called on every tick and on visibility / activity changes. */
function presenceTick() {
  const now = Date.now();
  presenceTicks++;

  if (document.hidden) {
    if (!hiddenAt) hiddenAt = now;
    if (!tabAwayOffline && now - hiddenAt >= TAB_OFFLINE_MS) {
      tabAwayOffline = true;
      pushPresence();
    }
    return;
  }

  /* Back in view: the away override no longer applies. */
  if (hiddenAt) { hiddenAt = 0; lastActivityAt = now; }
  if (tabAwayOffline) { tabAwayOffline = false; pushPresence(); }

  /* Idle only downgrades online/idle; a chosen dnd/offline is left alone. */
  if (!userIsIdle && (myChosenStatus === 'online' || myChosenStatus === 'idle') &&
      now - lastActivityAt >= IDLE_MS) {
    userIsIdle = true;
    pushPresence();
  } else if (userIsIdle && now - lastActivityAt < IDLE_MS) {
    /* Activity resumed (even if the event listener was missed) — clear idle. */
    userIsIdle = false;
    pushPresence();
  }

  /* Re-assert the effective status about once a minute so a server restart or
     a dropped/restored socket can never leave a stale status behind. */
  if (presenceTicks % 6 === 0) pushPresence(true);
}

function resetIdleTimer() {
  lastActivityAt = Date.now();
  if (userIsIdle) { userIsIdle = false; pushPresence(); }
}

function markActivity() {
  if (document.hidden) return;
  lastActivityAt = Date.now();
  if (userIsIdle) { userIsIdle = false; pushPresence(); }
}

function initPresence() {
  if (presenceReady) return;
  presenceReady = true;

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
    } else {
      /* Returning counts as activity, and clears any away/idle override. */
      hiddenAt = 0;
      lastActivityAt = Date.now();
      userIsIdle = false;
      tabAwayOffline = false;
      pushPresence();
    }
    presenceTick();
  });

  ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel', 'pointerdown']
    .forEach(evt => window.addEventListener(evt, markActivity, { passive: true }));

  window.addEventListener('focus', () => { presenceTick(); });
  window.addEventListener('pageshow', () => { presenceTick(); });

  setInterval(presenceTick, PRESENCE_TICK_MS);
  presenceTick();
}

/* Called whenever the user deliberately changes their status. */
function setChosenStatus(status) {
  if (!['online', 'idle', 'dnd', 'offline'].includes(status)) return;
  myChosenStatus = status;
  userIsIdle = false;
  tabAwayOffline = false;
  hiddenAt = document.hidden ? Date.now() : 0;
  lastActivityAt = Date.now();
  pushPresence(true);
}

/* The free Render plan stops the service when it is idle, so the first request
   can take up to a minute. Tell the visitor what is happening instead of
   leaving a generic spinner, and keep retrying until the instance answers. */
let wakeHintTimer = null;
function showWakeHint() {
  const sub = document.querySelector('#boot-gate .bg-sub');
  if (sub) sub.textContent = 'Waking up the server\u2026 this can take up to a minute.';
  const gate = document.getElementById('boot-gate');
  if (gate) gate.classList.add('waking');
}
function clearWakeHint() {
  if (wakeHintTimer) { clearTimeout(wakeHintTimer); wakeHintTimer = null; }
  const gate = document.getElementById('boot-gate');
  if (gate) gate.classList.remove('waking');
}

async function init() {
  if (!token) { window.location.href = '/'; return; }
  /* After 4 seconds without a response, assume a cold start is in progress. */
  wakeHintTimer = setTimeout(showWakeHint, 4000);
  let meData = null;
  try {
    meData = await api('/api/me', { retries: 8 });
  } catch (e) {
    /* A real 401 logs the user out via api(); a network failure means the
       instance never woke up, so show a retry instead of bouncing to login. */
    if (e.message !== 'Session expired') {
      clearWakeHint();
      const sub = document.querySelector('#boot-gate .bg-sub');
      if (sub) sub.textContent = 'The server is taking too long to respond. Reloading\u2026';
      setTimeout(() => location.reload(), 2500);
      return;
    }
    return;
  }
  clearWakeHint();
  me = meData.user;
  /* Spin up end-to-end encryption for this device (non-blocking). */
  e2eInit().catch(() => {});
  myChosenStatus = me.status || 'online';
  try { localStorage.setItem('cr_user', JSON.stringify(me)); } catch (err) { /* ignore */ }
  try {
    const { settings } = await api('/api/settings', { retries: 4 });
    state.settings = settings || {};
  } catch (e) { state.settings = {}; }
  applyTheme();
  hydrateIcons(document);
  renderMe();
  connectSocket();
  initPresence();
  loadGlobalMessages();
  /* Load everything in parallel so the first paint is not blocked by a chain
     of sequential round-trips. */
  await Promise.all([loadServers(), loadFriends(), loadDMs(), loadNotifications()]);
  const restored = await restoreLastLocation();
  if (!restored) showHome();
  updateTitle();
  bindGlobalEvents();
  applyLanguage();
  revealApp();
  /* Watch for a newer deploy and offer a soft refresh. */
  startUpdateWatcher();
}

/* Remove the boot gate once the app has real data to show. */
function revealApp() {
  document.documentElement.classList.remove('booting');
  const gate = document.getElementById('boot-gate');
  if (gate) {
    gate.classList.add('done');
    setTimeout(() => gate.remove(), 260);
  }
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
  /* Only redraw the DM sidebar when we are actually in the DM view - `home`
     is also the view name used while inside a server. */
  if (state.view === 'home' && !state.server) renderDMList();
  if (state.view === 'friends') renderFriendsView();
}, 120);

/* ============================================================
   GLOBAL ANNOUNCEMENTS
   ============================================================ */
async function loadGlobalMessages() {
  try {
    const d = await api('/api/global-messages');
    showGlobalBanner(d);
  } catch (e) { /* announcements are non-critical */ }
}

function showGlobalBanner(d) {
  const existing = document.querySelector('.global-banner');
  if (existing) existing.remove();
  const ann = (d.announcements || [])[0];
  const dismissed = sessionStorage.getItem('cr_ann_dismissed');
  let title = '', content = '', level = 'info', key = '';
  if (ann) {
    if (dismissed === ann.id) {
      if (!d.maintenance) return;
    } else {
      title = ann.title || 'Announcement';
      content = ann.content || '';
      level = ann.level || 'info';
      key = ann.id;
    }
  }
  if (!content && d.maintenance) {
    title = 'Maintenance in progress';
    content = d.maintenance_message || 'Some features may be temporarily unavailable.';
    level = 'warning';
    key = 'maintenance';
  }
  if (!content) return;
  const el = document.createElement('div');
  el.className = 'global-banner ' + level;
  el.innerHTML = `<div><b>${escapeHtml(title)}</b><span>${escapeHtml(content)}</span></div><button title="Dismiss">${icon('xmark')}</button>`;
  document.body.appendChild(el);
  hydrateIcons(el);
  el.querySelector('button').addEventListener('click', () => {
    if (key) sessionStorage.setItem('cr_ann_dismissed', key);
    el.remove();
  });
}

/* ============================================================
   SOCKET
   ============================================================ */
function connectSocket() {
  socket = io({ auth: { token } });
  socket.on('connect', () => {
    if (state.channel) socket.emit('join_channel', state.channel.id);
    if (state.dm) socket.emit('join_dm', state.dm.id);
    /* Re-assert our effective presence after a reconnect (the server keeps
       overrides in memory only). Force it so a fresh socket always re-sends. */
    lastPushedStatus = null;
    pushPresence(true);
  });
  socket.on('message', async (m) => {
    await e2eDecryptMessage(m);
    if (state.channel && m.channel_id === state.channel.id) {
      state.messages.push(m); appendMessage(m);
    }
  });
  socket.on('dm_message', async (m) => {
    await e2eDecryptMessage(m);
    if (state.dm && m.dm_id === state.dm.id) { state.messages.push(m); appendMessage(m); }
    scheduleDMsReload();
  });
  socket.on('dm_notify', async (data) => {
    scheduleDMsReload();
    if (!state.dm || state.dm.id !== data.dm_id) {
      const who = fullTag(data.message.author);
      bumpDmUnread(data.dm_id);
      await e2eDecryptMessage(data.message);
      maybeDesktopNotify('New message from ' + who, data.message.content || '');
      if (setting('notifSounds') !== false) playPing();
    }
  });
  socket.on('message_deleted', (data) => {
    const node = document.querySelector(`[data-mid="${data.id}"]`);
    if (node) node.remove();
    state.messages = state.messages.filter(x => x.id !== data.id);
  });
  socket.on('message_updated', async (m) => {
    await e2eDecryptMessage(m);
    const idx = state.messages.findIndex(x => x.id === m.id);
    if (idx >= 0) state.messages[idx] = m;
    updateMessageNode(m);
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
    /* Categories are broadcast alongside channels - without this the sidebar
       kept a stale category list, so create / rename / delete looked broken. */
    if (Array.isArray(data.categories)) state.categories = data.categories;
    /* If the voice channel we're connected to was deleted, disconnect. */
    if (voice.channel && !state.channels.some(c => c.id === voice.channel.id)) leaveVoiceChannel();
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
      updateTitle();
    }
    renderRail();
    const activeTab = document.querySelector('.ss-nav-item.active');
    if (activeTab && activeTab.dataset.tab === 'overview' && state.server && state.server.id === s.id) {
      renderServerTab('overview', state.server, state.server.owner_id === me.id);
    }
  });
  /* Member roles changed: refresh the member list + open members tab. */
  socket.on('server_members_update', (data) => {
    if (!data || !state.server || data.server_id !== state.server.id) return;
    scheduleMembersReload();
  });
  /* Server safety settings changed. */
  socket.on('server_settings_update', (data) => {
    if (!data || !state.server || data.server_id !== state.server.id) return;
    state.serverSettings = data.settings || state.serverSettings;
    if (document.querySelector('.ss-nav-item.active')?.dataset.tab === 'safety') renderServerTab('safety', state.server, state.server.owner_id === me.id);
  });
  /* Custom roles changed. */
  socket.on('server_roles_update', (data) => {
    if (!data || !state.server || data.server_id !== state.server.id) return;
    refreshRoles().then(() => {
      const t = document.querySelector('.ss-nav-item.active')?.dataset.tab;
      if (t === 'roles') renderServerTab('roles', state.server, state.server.owner_id === me.id);
      else renderMembers();
    });
  });
  socket.on('friend_update', (data) => {
    loadFriends();
    if (data.type === 'request') toast((data.user.display_name || data.user.username) + ' sent you a friend request', 'alert');
    if (data.type === 'accepted') toast('You are now friends with ' + (data.user.display_name || data.user.username), 'success');
    if (data.type === 'removed') toast((data.user.display_name || data.user.username) + ' removed you as a friend');
  });
  socket.on('global_announcement', (ann) => {
    sessionStorage.removeItem('cr_ann_dismissed');
    showGlobalBanner({ announcements: [ann] });
  });
  socket.on('notification', (n) => {
    state.notifications.unshift(n);
    state.unread++;
    renderNotifBadge();
    const info = notifInfo(n);
    /* @mentions and replies also light up a red badge on the channel and the
       server icon, exactly like Discord. */
    const d = n.data || {};
    if ((n.type === 'mention' || n.type === 'reply') && d.channel_id) bumpMentionUnread(d.channel_id);
    maybeDesktopNotify('Crossroads', info.plain);
    if (setting('notifSounds') !== false) {
      if (PING_NOTIF_TYPES.includes(n.type)) playPing(); else beep();
    }
    if ($('notif-panel')) renderNotifList();
  });

  /* ---------------- Voice signaling ---------------- */
  socket.on('voice_joined', ({ peers }) => {
    (peers || []).forEach(uid => createVoicePeer(uid, true));
    renderVoicePanel();
  });
  socket.on('voice_peer_joined', ({ user_id }) => {
    if (user_id && me && user_id !== me.id && !voice.peers[user_id]) createVoicePeer(user_id, false);
  });
  socket.on('voice_peer_left', ({ user_id }) => {
    if (user_id) destroyVoicePeer(user_id);
    renderVoiceMembersInList();
  });
  socket.on('voice_signal', ({ from, data }) => handleVoiceSignal(from, data));
  socket.on('voice_state', (data) => {
    if (!data || !data.channel_id) return;
    voice.states[data.channel_id] = data.members || [];
    renderVoiceMembersInList();
    renderVoicePanel();
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
/* Real ping sound (public/sounds/ping.mp3) for mentions, @everyone/@here and
   friend requests. Falls back to the synthesised beep if playback is blocked
   (e.g. before the user has interacted with the page). */
let pingEl = null;
function playPing() {
  try {
    if (!pingEl) {
      pingEl = new Audio('/sounds/ping.mp3');
      pingEl.preload = 'auto';
      pingEl.volume = 0.85;
    }
    try { pingEl.currentTime = 0; } catch (e) { /* not seekable yet */ }
    const p = pingEl.play();
    if (p && typeof p.catch === 'function') p.catch(() => beep());
  } catch (e) { beep(); }
}
/* Browsers block audio until a gesture; prime the element on first click/key. */
function unlockPingAudio() {
  try {
    if (!pingEl) { pingEl = new Audio('/sounds/ping.mp3'); pingEl.preload = 'auto'; pingEl.volume = 0.85; }
    const wasMuted = pingEl.muted;
    pingEl.muted = true;
    const p = pingEl.play();
    if (p && typeof p.then === 'function') p.then(() => { pingEl.pause(); pingEl.currentTime = 0; pingEl.muted = wasMuted; }).catch(() => { pingEl.muted = wasMuted; });
    else { pingEl.pause(); pingEl.currentTime = 0; pingEl.muted = wasMuted; }
  } catch (e) { /* ignore */ }
  document.removeEventListener('pointerdown', unlockPingAudio);
  document.removeEventListener('keydown', unlockPingAudio);
}
document.addEventListener('pointerdown', unlockPingAudio, { once: true });
document.addEventListener('keydown', unlockPingAudio, { once: true });

const PING_NOTIF_TYPES = ['mention', 'reply', 'everyone', 'here', 'friend_request'];
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
  const { servers } = await api('/api/servers', { retries: 3 });
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
    const mentions = serverMentionCount(s.id);
    if (mentions) d.innerHTML += `<span class="badge">${mentions > 99 ? '99+' : mentions}</span>`;
    d.addEventListener('click', () => openServer(s.id));
    d.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, [
        { label: 'Open Server', icon: 'server', onClick: () => openServer(s.id) },
        { sep: true },
        { label: 'Copy Server ID', icon: 'id-badge', onClick: () => copyToClipboard(s.id, 'Server ID') },
        { label: 'Copy Server Name', icon: 'copy', onClick: () => copyToClipboard(s.name, 'Server name') }
      ]);
    });
    wrap.appendChild(d);
  }
}

/* ============================================================
   HOME / DMs
   ============================================================ */
/* Remember where the user was so a refresh (or tabbing away and coming back)
   returns them to the same server/channel or DM instead of the DM landing page. */
const LAST_LOCATION_KEY = 'cr_last_location';
function saveLastLocation(extra) {
  try {
    const loc = Object.assign({ serverId: null, channelId: null, dmId: null }, extra || {});
    localStorage.setItem(LAST_LOCATION_KEY, JSON.stringify(loc));
  } catch (e) { /* private mode / quota - ignore */ }
}
function readLastLocation() {
  try {
    const raw = localStorage.getItem(LAST_LOCATION_KEY);
    if (!raw) return null;
    const loc = JSON.parse(raw);
    return (loc && (loc.serverId || loc.dmId)) ? loc : null;
  } catch (e) { return null; }
}
/* Restore the saved view once the sidebar data has loaded. Falls back to the
   DM landing page if the server/DM no longer exists (kicked, left, deleted). */
async function restoreLastLocation() {
  const loc = readLastLocation();
  if (!loc) return false;
  if (loc.serverId) {
    const srv = (state.servers || []).find(s => s.id === loc.serverId);
    if (!srv) { saveLastLocation(); return false; }
    try {
      await openServer(loc.serverId, loc.channelId || null);
      return true;
    } catch (e) { saveLastLocation(); return false; }
  }
  if (loc.dmId) {
    const dm = (state.dms || []).find(d => d.id === loc.dmId);
    if (!dm) { saveLastLocation(); return false; }
    try {
      await openDM(dm);
      return true;
    } catch (e) { saveLastLocation(); return false; }
  }
  return false;
}

function showHome() {
  state.server = null; state.channel = null; state.dm = null; state.view = 'home';
  setReplyTo(null);
  renderRail();
  $('rail-home').classList.add('active');
  $('sidebar-name').textContent = t('Direct Messages');
  syncSidebarBanner();
  $('chat-hash').style.display = 'none';
  $('chat-title').textContent = t('Direct Messages');
  $('chat-topic').textContent = '';
  closeMembersPanel();
  $('composer').classList.add('hidden');
  renderDMList();
  renderEmptyChat();
  updateTitle();
  animateView();
  saveLastLocation();
}

async function loadDMs() {
  const { dms } = await api('/api/dms', { retries: 3 });
  state.dms = dms;
  for (const d of dms) if (d.user) state.usersCache[d.user.id] = d.user;
  if (!state.server && state.view !== 'friends') renderDMList();
}
/* Bursts of DM activity (several messages at once) should trigger a single
   refresh instead of one full /api/dms round-trip per message. */
const scheduleDMsReload = debounce(() => { loadDMs().catch(() => {}); }, 350);

/* ---------------- Discord-style unread badges ---------------- */
function dmUnreadCount(dmId) { return state.dmUnread[dmId] || 0; }
function channelMentionCount(chId) { return state.mentionUnread[chId] || 0; }
function serverMentionCount(serverId) {
  let n = 0;
  for (const [cid, c] of Object.entries(state.mentionUnread)) {
    const ch = (state.channels || []).find(x => x.id === cid);
    if (ch && ch.server_id === serverId) n += c;
  }
  return n;
}
function badgeHTML(count) {
  if (!count) return '';
  return `<span class="unread-badge">${count > 99 ? '99+' : count}</span>`;
}
function bumpDmUnread(dmId) {
  if (!dmId) return;
  state.dmUnread[dmId] = (state.dmUnread[dmId] || 0) + 1;
  if (!state.server && state.view !== 'friends') renderDMList();
  renderRail();
}
function bumpMentionUnread(channelId) {
  if (!channelId) return;
  /* Never badge the channel the user is looking at right now. */
  if (state.channel && state.channel.id === channelId) return;
  state.mentionUnread[channelId] = (state.mentionUnread[channelId] || 0) + 1;
  if (state.server) renderChannelList();
  renderRail();
}
function clearDmUnread(dmId) {
  if (state.dmUnread[dmId]) {
    delete state.dmUnread[dmId];
    if (!state.server && state.view !== 'friends') renderDMList();
    renderRail();
  }
}
function clearChannelUnread(channelId) {
  if (state.mentionUnread[channelId]) {
    delete state.mentionUnread[channelId];
    if (state.server) renderChannelList();
    renderRail();
  }
}

function renderDMList() {
  const list = $('channel-list');
  list.innerHTML = '';

  /* 2020 Discord put a "Find or start a conversation" field at the very top of
     the DM sidebar. It filters the DM rows below it as you type. */
  const search = document.createElement('div');
  search.className = 'dm-search';
  search.innerHTML = `<input id="dm-search-input" placeholder="${t('Find or start a conversation')}" autocomplete="off" spellcheck="false">`;
  list.appendChild(search);
  const searchInput = search.querySelector('input');
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    list.querySelectorAll('.dm-item[data-dmid]').forEach(row => {
      const hay = row.dataset.name || '';
      row.style.display = (!q || hay.includes(q)) ? '' : 'none';
    });
  });

  const friendsBtn = document.createElement('div');
  friendsBtn.className = 'dm-item friends-entry' + (state.view === 'friends' ? ' active' : '');
  friendsBtn.id = 'friends-entry';
  const pendingCount = (state.friends && state.friends.incoming) ? state.friends.incoming.length : 0;
  friendsBtn.innerHTML = `<span class="dm-name">${t('Friends')}</span>${pendingCount ? `<span class="friend-badge">${pendingCount}</span>` : ''}`;
  friendsBtn.addEventListener('click', openFriends);
  list.appendChild(friendsBtn);

  const cat = document.createElement('div');
  cat.className = 'channel-category dm-cat';
  cat.innerHTML = `<span class="cat-caret">${icon('caret-down')}</span><span class="cat-ic">${icon('message-dots')}</span><span class="cat-name">${t('Direct Messages')}</span><button class="cat-add" id="dm-cat-add" title="${t('Start a conversation')}">${icon('plus')}</button>`;
  cat.querySelector('#dm-cat-add').addEventListener('click', (e) => { e.stopPropagation(); openNewDM(); });
  list.appendChild(cat);

  for (const d of state.dms) {
    const item = document.createElement('div');
    item.className = 'dm-item' + (state.dm && state.dm.id === d.id ? ' active' : '');
    item.dataset.dmid = d.id;
    if (d.user) item.dataset.uid = d.user.id;
    item.dataset.name = (d.user ? (d.user.display_name || d.user.username) : 'unknown').toLowerCase();
    item.innerHTML = `${avatarHTML(d.user, 32, d.user.status || 'offline')}<span class="dm-name">${escapeHtml(d.user ? (d.user.display_name || d.user.username) : 'Unknown')}</span>${badgeHTML(dmUnreadCount(d.id))}`;
    item.addEventListener('click', () => openDM(d));
    list.appendChild(item);
  }
  if (!state.dms.length) {
    /* Intentionally no empty-state copy here — the + button in the
       "Direct Messages" header is the single, always-visible way to start one. */
  }
  /* The "Start a conversation" row was removed on request; the always-visible
     + button in the "Direct Messages" header is the way to start one. */
}

/* ------------------------------------------------------------
   Window title: "crossroads - <server>" in a server, and
   "crossroads - direct messages" in DMs.
   ------------------------------------------------------------ */
const APP_TITLE = 'crossroads';
function updateTitle() {
  let suffix = '';
  if (state.server && state.server.name) suffix = state.server.name;
  else if (state.dm) suffix = 'direct messages';
  else if (state.view === 'friends') suffix = 'friends';
  else if (state.view === 'home') suffix = 'direct messages';
  document.title = suffix ? APP_TITLE + ' - ' + suffix : APP_TITLE;
}

async function openDM(d) {
  state.server = null; state.channel = null; state.view = 'home';
  setReplyTo(null);
  if (state.dm && state.dm.id !== d.id) socket.emit('leave_dm', state.dm.id);
  state.dm = d;
  state.usersCache[d.user.id] = d.user;
  clearDmUnread(d.id);
  renderRail();
  $('rail-home').classList.add('active');
  $('sidebar-name').textContent = 'Direct Messages';
  syncSidebarBanner();
  renderDMList();
  $('chat-hash').style.display = 'none';
  $('chat-title').textContent = d.user.display_name || d.user.username;
  $('chat-title').style.cursor = 'pointer';
  $('chat-title').onclick = () => openProfile(d.user);
  $('chat-topic').textContent = '';
  closeMembersPanel();
  socket.emit('join_dm', d.id);
  const { messages } = await api('/api/dms/' + d.id + '/messages');
  await e2eDecryptAll(messages);
  state.messages = messages;
  renderMessages();
  $('composer').classList.remove('hidden');
  $('message-input').placeholder = 'Write a direct message to @' + d.user.username + '\u2026';
  $('composer-hint').textContent = '';
  $('message-input').focus();
  updateTitle();
  saveLastLocation({ serverId: null, channelId: null, dmId: d.id });
}

/* Right-click menu for a direct message in the sidebar. */
function openDMContextMenu(x, y, dmid) {
  const d = state.dms.find(x => x.id === dmid);
  if (!d) return;
  const u = d.user || {};
  const isFriend = !!(state.friends && state.friends.friends.some(f => f.id === u.id));
  const isBlocked = !!(state.friends && state.friends.blocked.some(f => f.id === u.id));
  const items = [
    { label: 'Open Profile', icon: 'id-badge', onClick: () => openProfile(u) },
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
  } catch (e) { toast(e.message, 'error'); }
}

/* ============================================================
   FRIENDS
   ============================================================ */
async function loadFriends() {
  try {
    const data = await api('/api/relationships', { retries: 3 });
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
  syncSidebarBanner();
  $('chat-hash').style.display = 'none';
  $('chat-title').textContent = 'Friends';
  $('chat-topic').textContent = '';
  closeMembersPanel();
  $('composer').classList.add('hidden');
  await loadFriends();
  renderDMList();
  renderFriendsView();
  updateTitle();
  animateView();
}

function emptyFriends(msg, ic) {
  /* The friends tabs are deliberately icon-free, so empty states are plain
     text too. `ic` is accepted for call-site compatibility and ignored. */
  return `<div class="fr-empty"><div class="fr-empty-txt">${msg}</div></div>`;
}

function friendRow(u, kind) {
  const raw = (u.display_name || u.username || '');
  const name = escapeHtml(raw);
  const disc = escapeHtml(String(u.discriminator == null ? '' : u.discriminator));
  const status = u.status === 'offline' ? 'Offline' : statusLabel(u.status);
  const statusClass = u.status || 'offline';
  const sub = kind === 'incoming' ? 'Incoming request'
            : kind === 'outgoing' ? 'Request sent'
            : kind === 'blocked' ? 'Blocked'
            : status;
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
  const always = kind === 'friend' ? '' : ' always';
  return `<div class="fr-row ${statusClass}${always}" data-uid="${u.id}" data-name="${escapeHtml(raw.toLowerCase())}" data-tag="${disc}">
    <div class="fr-avatar">${avatarHTML(u, 44, u.status || 'offline')}</div>
    <div class="fr-info">
      <div class="fr-name">${name}<span class="fr-tag">#${disc}</span></div>
      <div class="fr-status ${statusClass}"><span class="fr-dot"></span>${sub}</div>
    </div>
    <div class="fr-actions">${actions}</div>
  </div>`;
}

function renderFriendsView() {
  const box = $('messages');
  box.style.padding = ''; box.style.overflow = '';
  const f = state.friends || { friends: [], incoming: [], outgoing: [], blocked: [] };
  const tab = state.friendsTab || 'online';
  const counts = {
    online: f.friends.filter(x => x.status !== 'offline').length,
    all: f.friends.length,
    pending: f.incoming.length + f.outgoing.length,
    blocked: f.blocked.length
  };

  const HEADINGS = {
    online: ['Online', 'Friends who are around right now.'],
    all: ['All Friends', 'Everyone in your network.'],
    pending: ['Pending', 'Requests waiting to be accepted or sent.'],
    blocked: ['Blocked', 'People who can no longer reach you.'],
    add: ['Add Friend', 'Send a request using a full username and tag.']
  };

  let body = '';
  if (tab === 'add') {
    body = `<div class="fr-add-wrap">
      <div class="fr-add-hero">
        <div class="fr-add-hero-txt">
          <h3>Add Friend</h3>
          <p>You can add friends with their Discord tag. It's the fastest way to grow your circle on Crossroads.</p>
        </div>
      </div>

      <div class="fr-add-card">
        <div class="fr-add-card-head">
          <span class="fr-add-eyebrow">ADD FRIEND</span>
        </div>
        <p class="fr-add-lead">Add friends by entering their <b>full tag</b> \u2014 a username followed by the four-digit number after the <b>#</b>. For example, <b>test#6842</b>.</p>
        <div class="fr-add-row">
          <span class="fr-add-hash">#</span>
          <input id="fr-add-input" placeholder="username#0000" autocomplete="off" spellcheck="false">
          <button class="btn fr-add-send" id="fr-add-btn">${t('Send Friend Request')}</button>
        </div>
        <div class="fr-add-hint" id="fr-add-hint"></div>
        <div class="fr-add-yourtag">
          <div class="fr-add-yourtag-l"><span class="fr-add-yourtag-label">Your tag</span><b id="fr-my-tag">${escapeHtml(fullTag(me))}</b></div>
          <button class="fr-add-copy" id="fr-copy-tag" type="button">${icon('copy')} Copy</button>
        </div>
      </div>

      <div class="fr-add-steps">
        <div class="fr-step"><span class="fr-step-n">1</span><div class="fr-step-t"><h5>Find their tag</h5><p>Ask a friend for their username and the four-digit number after the #.</p></div></div>
        <div class="fr-step"><span class="fr-step-n">2</span><div class="fr-step-t"><h5>Type it exactly</h5><p>Usernames are case-sensitive, and the tag is always four digits.</p></div></div>
        <div class="fr-step"><span class="fr-step-n">3</span><div class="fr-step-t"><h5>Send the request</h5><p>They'll see it under Pending and can accept it in one click.</p></div></div>
      </div>

      <div class="fr-add-tip">${icon('circle-info')} <span>Tip: start typing a username below \u2014 matching people appear instantly so you can add them without guessing the tag.</span></div>
      <div class="fr-search-results" id="fr-search-results"></div>
    </div>`;
  } else if (tab === 'pending') {
    const inc = f.incoming.map(u => friendRow(u, 'incoming')).join('');
    const out = f.outgoing.map(u => friendRow(u, 'outgoing')).join('');
    body = `<div class="fr-cat">Incoming \u2014 ${f.incoming.length}</div>${inc || emptyFriends('No incoming requests.', 'user-plus')}
            <div class="fr-cat">Outgoing \u2014 ${f.outgoing.length}</div>${out || emptyFriends('No outgoing requests.', 'clock')}`;
  } else if (tab === 'blocked') {
    body = f.blocked.length ? f.blocked.map(u => friendRow(u, 'blocked')).join('') : emptyFriends('No blocked users.', 'ban');
  } else {
    let list = f.friends;
    if (tab === 'online') list = list.filter(x => x.status !== 'offline');
    body = list.length ? list.map(u => friendRow(u, 'friend')).join('')
      : emptyFriends(tab === 'online' ? 'No one is online right now.' : 'No friends yet. Add some!', tab === 'online' ? 'clock' : 'user-plus');
  }

  const heading = HEADINGS[tab] || HEADINGS.all;

  /* 2020 Discord friends page: a horizontal tab strip along the top (Online /
     All / Pending / Blocked) with the green "Add Friend" button at the end, an
     "Active Now" shelf of live friends, then the plain list underneath. */
  const activeNow = (f.friends || []).filter(x => x.status && x.status !== 'offline').slice(0, 10);
  const activeHTML = (tab === 'online' || tab === 'all') ? `
    <section class="fv-active">
      <h4 class="fv-active-head">Active Now<span class="fv-active-count">${activeNow.length}</span></h4>
      ${activeNow.length
        ? `<div class="fv-active-row">${activeNow.map(u => `
            <div class="fv-card" data-uid="${escapeHtml(u.id)}">
              <div class="fv-card-ava">${avatarHTML(u, 56, u.status || 'offline')}</div>
              <div class="fv-card-name">${escapeHtml(u.display_name || u.username)}</div>
              <div class="fv-card-sub">${escapeHtml(statusLabel(u.status))}</div>
            </div>`).join('')}</div>`
        : `<div class="fv-active-empty">It's quiet for now\u2026 when a friend starts an activity, they'll show up here.</div>`}
    </section>` : '';

  const tabBtn = (id, label, count) =>
    `<button class="fv-tab${tab === id ? ' active' : ''}" data-tab="${id}">${label}${count ? `<span class="fv-tab-badge">${count}</span>` : ''}</button>`;

  box.innerHTML = `<div class="friends-view">
    <header class="fv-top">
      <nav class="fv-tabs">
        ${tabBtn('online', t('Online'), 0)}
        ${tabBtn('all', t('All'), 0)}
        ${tabBtn('pending', t('Pending'), counts.pending)}
        ${tabBtn('blocked', t('Blocked'), 0)}
      </nav>
      ${tab !== 'add' ? `<label class="fv-search">${icon('search')}<input id="fr-filter" placeholder="Search" autocomplete="off" spellcheck="false"></label>` : ''}
      <button class="fv-add-tab${tab === 'add' ? ' active' : ''}" data-tab="add">${t('Add Friend')}</button>
    </header>
    <div class="fr-body">
      ${activeHTML}
      ${tab !== 'add' ? `<div class="fv-list-head">${heading[0]} \u2014 ${tab === 'online' ? counts.online : tab === 'all' ? counts.all : tab === 'pending' ? counts.pending : counts.blocked}</div>` : ''}
      ${body}
    </div>
  </div>`;

  box.querySelectorAll('.fv-tab, .fv-add-tab').forEach(el =>
    el.addEventListener('click', () => { state.friendsTab = el.dataset.tab; renderFriendsView(); }));
  box.querySelectorAll('.fv-card').forEach(el =>
    el.addEventListener('click', () => { const u = state.usersCache[el.dataset.uid]; if (u) openProfile(u); }));
  box.querySelectorAll('.fr-info').forEach(el =>
    el.addEventListener('click', () => { const u = state.usersCache[el.closest('.fr-row').dataset.uid]; if (u) openProfile(u); }));
  box.querySelectorAll('[data-fr-act]').forEach(btn =>
    btn.addEventListener('click', (e) => { e.stopPropagation(); friendAction(btn.dataset.frAct, btn.dataset.uid); }));
  box.querySelectorAll('[data-fr-msg]').forEach(btn =>
    btn.addEventListener('click', (e) => { e.stopPropagation(); startDM(btn.dataset.frMsg); }));

  const filter = $('fr-filter');
  if (filter) filter.addEventListener('input', () => filterFriendRows(filter.value));

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

  const copyBtn = $('fr-copy-tag');
  if (copyBtn) copyBtn.addEventListener('click', () => {
    const tag = fullTag(me);
    const reset = () => { copyBtn.innerHTML = `${icon('copy')} Copy`; hydrateIcons(copyBtn); };
    navigator.clipboard.writeText(tag).then(() => {
      copyBtn.innerHTML = `${icon('check')} Copied`;
      hydrateIcons(copyBtn);
      toast('Copied ' + tag, 'success');
      setTimeout(reset, 1600);
    }).catch(() => toast('Could not copy your tag', 'error'));
  });
}

/* Client-side filter for the visible friend rows (name or tag). */
function filterFriendRows(q) {
  const query = (q || '').trim().toLowerCase();
  document.querySelectorAll('.fr-body .fr-row').forEach(row => {
    const hay = (row.dataset.name || '') + '#' + (row.dataset.tag || '');
    row.style.display = (!query || hay.includes(query)) ? '' : 'none';
  });
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
  document.querySelectorAll('.fr-nav-item').forEach(el => {
    const c = el.querySelector('.fr-nav-count');
    if (c && counts[el.dataset.tab] != null) c.textContent = counts[el.dataset.tab];
  });
}

async function addFriendByTag(tag) {
  const hint = $('fr-add-hint');
  const clean = (tag || '').trim();
  if (!clean) {
    if (hint) { hint.textContent = 'Enter a full username and tag, for example test#6842.'; hint.className = 'fr-add-hint bad'; }
    return;
  }
  if (!/^[^#\s]+#\d{2,8}$/.test(clean)) {
    if (hint) { hint.textContent = 'Include the tag after the #, for example test#6842.'; hint.className = 'fr-add-hint bad'; }
    return;
  }
  try {
    const res = await api('/api/friends/request', { method: 'POST', body: JSON.stringify({ tag: clean }) });
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
async function openServer(id, preferredChannelId) {
  const data = await api('/api/servers/' + id);
  state.view = 'home';
  state.server = data.server;
  state.channels = data.channels;
  state.categories = data.categories || [];
  state.members = data.members;
  state.serverSettings = data.settings || null;
  state.roles = data.roles || [];
  state.dm = null;
  setReplyTo(null);
  for (const m of data.members) state.usersCache[m.id] = m;
  renderRail();
  $('rail-home').classList.remove('active');
  $('sidebar-name').textContent = data.server.name;
  syncSidebarBanner(true);
  renderChannelList();
  /* Honour the member-list preference the user last chose. It is persisted in
     settings and mirrored onto state.showMembers by applyTheme(), so switching
     servers, opening a DM and coming back all keep the same collapsed/expanded
     state instead of force-reopening the panel. */
  state.showMembers = setting('showMembers') !== false;
  renderMembers();
  /* Re-open the channel the user was last on, if it still exists. */
  const wanted = preferredChannelId && state.channels.find(c => c.id === preferredChannelId && c.type === 'text');
  const firstText = wanted || state.channels.find(c => c.type === 'text');
  if (firstText) openChannel(firstText.id);
  else { state.channel = null; renderEmptyChat('No text channels yet'); $('composer').classList.add('hidden'); }
  updateTitle();
  animateView();
  /* Seed current voice occupancy in the background so opening a server never
     waits on a second round-trip before the channel list appears. */
  api('/api/servers/' + id + '/voice').then((v) => {
    if (!state.server || state.server.id !== id) return;
    voice.states = v.states || {};
    renderVoicePanel();
    renderChannelList();
  }).catch(() => { /* voice occupancy is optional */ });
}

/* Show the server's banner directly under the server name in the sidebar. */
function syncSidebarBanner(animate) {
  const el = $('sidebar-banner');
  if (!el) return;
  const s = state.server;
  if (s && s.banner_url) {
    el.style.backgroundImage = `url("${s.banner_url}")`;
    el.classList.remove('hidden');
    if (animate) { el.classList.remove('reveal'); void el.offsetWidth; el.classList.add('reveal'); }
  } else {
    el.style.backgroundImage = '';
    el.classList.add('hidden');
    el.classList.remove('reveal');
  }
}

function createChannelBtn(type, catId) {
  const el = document.createElement('div');
  el.className = 'channel-add';
  el.innerHTML = `${icon('plus')} ${t('Create Channel')}`;
  el.addEventListener('click', () => openCreateChannel(type, catId || null));
  return el;
}

function createCategoryBtn() {
  const el = document.createElement('div');
  el.className = 'channel-add';
  el.innerHTML = `${icon('plus')} ${t('Create Category')}`;
  el.addEventListener('click', () => createCategory());
  return el;
}

/* Render the channel list. Categories are collapsible groups that every member
   sees (not just admins). Channels with no category float above the first
   group, exactly like Discord. When a server has no categories we keep the
   classic Text / Voice split so nothing regresses. */
function renderChannelList() {
  const list = $('channel-list');
  if (!list) return;
  list.innerHTML = '';
  const admin = amIAdmin();
  const cats = (state.categories || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
  const chans = (state.channels || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));

  const appendChannel = (c) => {
    if (c.type === 'voice') {
      const wrap = document.createElement('div');
      wrap.className = 'voice-chan-wrap';
      wrap.dataset.cid = c.id;
      wrap.appendChild(channelRow(c));
      const mem = voiceMembersNode(c.id);
      if (mem) wrap.appendChild(mem);
      list.appendChild(wrap);
    } else {
      list.appendChild(channelRow(c));
    }
  };

  if (!cats.length) {
    const textChannels = chans.filter(c => c.type === 'text');
    const voiceChannels = chans.filter(c => c.type === 'voice');
    const tcat = document.createElement('div');
    tcat.className = 'channel-category';
    tcat.innerHTML = `${icon('caret-down')} ${t('Text Channels')}`;
    list.appendChild(tcat);
    for (const c of textChannels) appendChannel(c);
    if (admin) list.appendChild(createChannelBtn('text', null));
    const vcat = document.createElement('div');
    vcat.className = 'channel-category';
    vcat.innerHTML = `${icon('caret-down')} ${t('Voice Channels')}`;
    list.appendChild(vcat);
    for (const c of voiceChannels) appendChannel(c);
    if (admin) list.appendChild(createChannelBtn('voice', null));
    if (admin) list.appendChild(createCategoryBtn());
    return;
  }

  const catIds = new Set(cats.map(c => c.id));
  const uncategorised = chans.filter(c => !c.category_id || !catIds.has(c.category_id));
  for (const c of uncategorised) appendChannel(c);
  if (admin && uncategorised.length) list.appendChild(createChannelBtn('text', null));

  for (const cat of cats) {
    const collapsed = !!state.collapsedCats[cat.id];
    const header = document.createElement('div');
    header.className = 'channel-category' + (collapsed ? ' collapsed' : '');
    header.dataset.cat = cat.id;
    header.innerHTML = (admin ? `<span class="cat-grip" title="Drag to reorder category">${icon('grip')}</span>` : '') +
      `<span class="cat-caret">${icon(collapsed ? 'chevron-right' : 'caret-down')}</span>` +
      `<span class="cat-name">${escapeHtml(cat.name)}</span>` +
      (admin ? `<span class="cat-actions"><span class="cat-add" title="Create channel">${icon('plus')}</span></span>` : '');
    header.addEventListener('click', (e) => {
      if (e.target.closest('.cat-add') || e.target.closest('.cat-grip')) return;
      state.collapsedCats[cat.id] = !collapsed;
      renderChannelList();
    });
    const addBtn = header.querySelector('.cat-add');
    if (addBtn) addBtn.addEventListener('click', (e) => { e.stopPropagation(); openCreateChannel('text', cat.id); });
    header.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); openCategoryContextMenu(e.clientX, e.clientY, cat.id); });
    if (admin) { wireCategoryDrop(header, cat.id); wireCategoryDrag(header, cat); }
    list.appendChild(header);
    if (!collapsed) {
      const inCat = chans.filter(c => c.category_id === cat.id);
      for (const c of inCat) appendChannel(c);
      if (admin) list.appendChild(createChannelBtn('text', cat.id));
    }
  }
  if (admin) list.appendChild(createCategoryBtn());
}

let dragChannelId = null;

function channelRow(c) {
  const row = document.createElement('div');
  row.className = 'channel' + (state.channel && state.channel.id === c.id ? ' active' : '') +
    (c.type === 'voice' && voice.channel && voice.channel.id === c.id ? ' voice-active' : '');
  row.dataset.cid = c.id;
  row.dataset.ctype = c.type;
  row.dataset.cat = c.category_id || '';
  const admin = amIAdmin();
  const ic = c.type === 'voice' ? icon('volume-high') : icon('hash');
  const grip = admin ? `<span class="ch-grip" title="Drag to reorder or move between categories">${icon('grip')}</span>` : '';
  row.innerHTML = `${grip}<span class="hash">${ic}</span><span class="ch-name">${escapeHtml(c.name)}</span>${c.read_only ? `<span class="ch-lock" title="Locked channel">${icon('lock')}</span>` : ''}${c.nsfw ? `<span class="ch-nsfw" title="Age-restricted">18+</span>` : ''}${badgeHTML(channelMentionCount(c.id))}`;
  if (admin) { row.classList.add('draggable'); row.draggable = true; wireChannelDrag(row, c); }
  row.addEventListener('click', () => {
    if (c.type === 'voice') { joinVoiceChannel(c.id); return; }
    openChannel(c.id);
  });
  return row;
}

function clearDropMarks() {
  document.querySelectorAll('.channel.dragging, .channel.drop-before, .channel.drop-after, .channel-category.drop-into, .channel-category.dragging, .channel-category.drop-before, .channel-category.drop-after')
    .forEach(el => el.classList.remove('dragging', 'drop-before', 'drop-after', 'drop-into'));
}

/* Drag a channel onto another channel (reorder / move into its category) or
   onto a category header (append to that category). Works across types. */
function wireChannelDrag(row, c) {
  row.addEventListener('dragstart', (e) => {
    dragChannelId = c.id;
    row.classList.add('dragging');
    try { e.dataTransfer.setData('text/plain', c.id); e.dataTransfer.effectAllowed = 'move'; } catch (err) { /* ignore */ }
  });
  row.addEventListener('dragend', () => { dragChannelId = null; clearDropMarks(); });
  row.addEventListener('dragover', (e) => {
    if (!dragChannelId || dragChannelId === c.id) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const rect = row.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    row.classList.toggle('drop-after', after);
    row.classList.toggle('drop-before', !after);
  });
  row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after'));
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const after = row.classList.contains('drop-after');
    row.classList.remove('drop-before', 'drop-after');
    if (!dragChannelId || dragChannelId === c.id) return;
    applyChannelMove(dragChannelId, c.category_id || null, c.id, after);
  });
}

function wireCategoryDrop(el, catId) {
  el.addEventListener('dragover', (e) => {
    if (!dragChannelId || dragCategoryId) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    el.classList.add('drop-into');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-into'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('drop-into');
    if (!dragChannelId) return;
    applyChannelMove(dragChannelId, catId || null, null, false);
  });
}

/* ---------- Category drag & drop (reorder the category headers) ---------- */
let dragCategoryId = null;

function wireCategoryDrag(header, cat) {
  header.classList.add('draggable-cat');
  header.draggable = true;
  header.addEventListener('dragstart', (e) => {
    dragCategoryId = cat.id;
    header.classList.add('dragging');
    try { e.dataTransfer.setData('text/plain', cat.id); e.dataTransfer.effectAllowed = 'move'; } catch (err) { /* ignore */ }
  });
  header.addEventListener('dragend', () => { dragCategoryId = null; clearDropMarks(); });
  header.addEventListener('dragover', (e) => {
    if (!dragCategoryId || dragCategoryId === cat.id) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const rect = header.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    header.classList.toggle('drop-after', after);
    header.classList.toggle('drop-before', !after);
  });
  header.addEventListener('dragleave', () => header.classList.remove('drop-before', 'drop-after'));
  header.addEventListener('drop', (e) => {
    if (!dragCategoryId || dragCategoryId === cat.id) return;
    e.preventDefault();
    e.stopPropagation();
    const after = header.classList.contains('drop-after');
    header.classList.remove('drop-before', 'drop-after');
    applyCategoryMove(dragCategoryId, cat.id, after);
  });
}

/* Move a category to a new position and persist the full order. */
async function applyCategoryMove(dragId, targetId, after) {
  if (!state.server) return;
  let ordered = (state.categories || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
  const dragged = ordered.find(c => c.id === dragId);
  if (!dragged) return;
  ordered = ordered.filter(c => c.id !== dragId);
  let insertAt;
  if (targetId) {
    const ti = ordered.findIndex(c => c.id === targetId);
    insertAt = ti < 0 ? ordered.length : (after ? ti + 1 : ti);
  } else {
    insertAt = ordered.length;
  }
  ordered.splice(insertAt, 0, dragged);
  ordered.forEach((c, i) => { c.position = i; });
  state.categories = ordered;
  renderChannelList();
  try {
    await api('/api/servers/' + state.server.id + '/categories/order', {
      method: 'PATCH', body: JSON.stringify({ order: ordered.map(c => c.id) })
    });
  } catch (e) { toast(e.message, 'error'); }
}

async function moveCategoryBy(cat, dir) {
  const ordered = (state.categories || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
  const idx = ordered.findIndex(c => c.id === cat.id);
  const j = idx + dir;
  if (j < 0 || j >= ordered.length) return;
  await applyCategoryMove(cat.id, ordered[j].id, dir > 0);
}

/* Move a channel to a new category and/or position, optimistically updating the
   UI then persisting the full ordering (with category ids) to the server. */
async function applyChannelMove(dragId, targetCategoryId, targetId, after) {
  const dragged = state.channels.find(x => x.id === dragId);
  if (!dragged || !state.server) return;
  const cat = targetCategoryId || null;
  let ordered = state.channels.slice().sort((a, b) => (a.position || 0) - (b.position || 0));
  ordered = ordered.filter(x => x.id !== dragId);
  dragged.category_id = cat;
  let insertAt;
  if (targetId) {
    const ti = ordered.findIndex(x => x.id === targetId);
    insertAt = ti < 0 ? ordered.length : (after ? ti + 1 : ti);
  } else {
    let last = -1;
    ordered.forEach((x, i) => { if ((x.category_id || null) === cat) last = i; });
    insertAt = last >= 0 ? last + 1 : ordered.length;
  }
  ordered.splice(insertAt, 0, dragged);
  ordered.forEach((x, i) => { x.position = i; });
  state.channels = ordered;
  renderChannelList();
  const order = ordered.map(x => ({ id: x.id, category_id: x.category_id || null }));
  try {
    await api('/api/servers/' + state.server.id + '/channels/order', { method: 'PATCH', body: JSON.stringify({ order }) });
  } catch (e) { toast(e.message, 'error'); }
}

async function moveChannelBy(c, dir) {
  const sameCat = state.channels
    .filter(x => (x.category_id || null) === (c.category_id || null))
    .sort((a, b) => (a.position || 0) - (b.position || 0));
  const idx = sameCat.findIndex(x => x.id === c.id);
  const j = idx + dir;
  if (j < 0 || j >= sameCat.length) return;
  await applyChannelMove(c.id, c.category_id || null, sameCat[j].id, dir > 0);
}

async function openChannel(cid) {
  const c = state.channels.find(x => x.id === cid);
  if (!c) return;
  if (state.channel && state.channel.id !== cid) socket.emit('leave_channel', state.channel.id);
  state.channel = c;
  state.dm = null;
  clearChannelUnread(cid);
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
  await e2eDecryptAll(messages);
  state.messages = messages;
  renderMessages();
  $('composer').classList.remove('hidden');
  const locked = !!c.read_only && !can('manage_channels') && !can('manage_messages');
  $('message-input').disabled = locked;
  $('message-input').placeholder = locked ? 'This channel is locked \u2014 only staff can send messages' : ('Message #' + c.name + '\u2026');
  $('composer-hint').textContent = locked ? 'You can read this channel but cannot post.' : '';
  if (!locked) $('message-input').focus();
  saveLastLocation({ serverId: state.server ? state.server.id : null, channelId: cid, dmId: null });
}

/* ============================================================
   VOICE CHANNELS (WebRTC full-mesh, signaled over Socket.IO)
   ============================================================ */
const voice = {
  channel: null,
  joining: false,
  localStream: null,   /* processed stream actually sent to peers */
  rawStream: null,     /* raw microphone stream (stopped on leave) */
  peers: {},           /* uid -> { pc, audioEl, pendingIce, remoteSet, ... } */
  states: {},          /* channelId -> [ { user_id, muted, deafened, speaking } ] */
  muted: false,
  deafened: false,
  speaking: false,
  mutedBeforeDeafen: false,
  audioCtx: null,
  analyser: null,
  rafId: null,
  gain: null,
  micTest: null
};

/* Public STUN + TURN. TURN matters: without a relay, two peers behind
   symmetric NAT (mobile hotspots, corporate wifi) can never connect, which is
   exactly the "I joined but hear nobody" symptom. */
const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
];

/* Audio elements live off-screen instead of inside a display:none wrapper -
   some browsers refuse to play media whose container is not rendered. */
function ensureVoiceAudioContainer() {
  let d = $('voice-audio');
  if (!d) {
    d = document.createElement('div');
    d.id = 'voice-audio';
    document.body.appendChild(d);
  }
  return d;
}

function voiceConstraints() {
  return {
    audio: {
      /* `ideal`, not `exact`: a saved device id can go stale when the user
         switches browser, unplugs a headset, or the OS rotates the id. With
         `exact` that stale id throws OverconstrainedError and voice refuses to
         join at all - which is exactly the "I joined but have no audio" bug. */
      deviceId: setting('micDeviceId') ? { ideal: setting('micDeviceId') } : undefined,
      echoCancellation: setting('echoCancel') !== false,
      noiseSuppression: setting('noiseSuppress') !== false,
      autoGainControl: setting('autoGain') !== false,
      channelCount: 1,
      sampleRate: 48000
    },
    video: false
  };
}

/* Acquire a microphone with graceful degradation. Some devices reject the
   full constraint set (sampleRate/channelCount/echoCancellation) or a pinned
   device id; rather than failing the whole join we retry with simpler
   constraints before giving up. Permission denials are never retried. */
async function acquireMic() {
  const base = voiceConstraints();
  const relaxed = {
    audio: {
      echoCancellation: base.audio.echoCancellation,
      noiseSuppression: base.audio.noiseSuppression,
      autoGainControl: base.audio.autoGainControl,
      channelCount: 1,
      sampleRate: 48000
    },
    video: false
  };
  const attempts = [base, relaxed, { audio: true, video: false }];
  let lastErr = null;
  for (const c of attempts) {
    try { return await navigator.mediaDevices.getUserMedia(c); }
    catch (e) {
      lastErr = e;
      /* The user said no (or the page is insecure): retrying cannot help. */
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw e;
    }
  }
  throw lastErr;
}

/* Route the raw microphone through a gain node so the Input Volume slider and
   the speaking meter both work on the exact same signal we transmit. */
function buildProcessedMic(raw) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return { stream: raw };
  try {
    if (!voice.audioCtx || voice.audioCtx.state === 'closed') voice.audioCtx = new Ctx();
    const ctx = voice.audioCtx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const src = ctx.createMediaStreamSource(raw);
    const gain = ctx.createGain();
    const vol = Number(setting('inputVolume'));
    gain.gain.value = isFinite(vol) ? Math.max(0, Math.min(2, vol / 100)) : 0.7;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.55;
    const dest = ctx.createMediaStreamDestination();
    src.connect(gain);
    gain.connect(dest);
    gain.connect(analyser);
    voice.gain = gain;
    voice.analyser = analyser;
    return { stream: dest.stream };
  } catch (e) {
    return { stream: raw };
  }
}

async function joinVoiceChannel(cid) {
  const c = state.channels.find(x => x.id === cid);
  if (!c) return;
  /* Clicking the channel you're already in disconnects you. */
  if (voice.channel && voice.channel.id === cid) { leaveVoiceChannel(); return; }
  if (voice.joining) return;
  voice.joining = true;
  try {
    if (voice.channel) leaveVoiceChannel();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('This browser does not support voice channels', 'error');
      return;
    }
    const raw = await acquireMic();
    voice.rawStream = raw;
    const built = buildProcessedMic(raw);
    voice.localStream = built.stream;
    voice.channel = c;
    voice.muted = false;
    voice.deafened = false;
    voice.speaking = false;
    voice.peers = {};
    ensureVoiceAudioContainer();
    socket.emit('voice_join', { channel_id: cid });
    startSpeakingDetection();
    renderVoicePanel();
    renderChannelList();
  } catch (e) {
    const name = e && e.name;
    const msg = name === 'NotAllowedError'
      ? 'Microphone permission was blocked - allow it in your browser to join voice'
      : name === 'NotFoundError'
        ? 'No microphone was found - plug one in to join voice'
        : name === 'NotReadableError'
          ? 'Your microphone is busy in another app - close it and try again'
          : 'Could not access your microphone - check your device and try again';
    toast(msg, 'error');
  } finally {
    voice.joining = false;
  }
}

function leaveVoiceChannel() {
  const cid = voice.channel && voice.channel.id;
  if (cid) socket.emit('voice_leave', { channel_id: cid });
  Object.keys(voice.peers).forEach(uid => destroyVoicePeer(uid));
  voice.peers = {};
  stopSpeakingDetection();
  if (voice.rawStream) { try { voice.rawStream.getTracks().forEach(t => t.stop()); } catch (e) {} }
  if (voice.localStream && voice.localStream !== voice.rawStream) {
    try { voice.localStream.getTracks().forEach(t => t.stop()); } catch (e) {}
  }
  voice.rawStream = null;
  voice.localStream = null;
  voice.channel = null;
  voice.muted = false;
  voice.deafened = false;
  voice.speaking = false;
  renderVoicePanel();
  if (state.server) renderChannelList();
}

function applyOutputDevice(el) {
  if (!el || typeof el.setSinkId !== 'function') return;
  const id = setting('speakerDeviceId');
  if (!id) return;
  el.setSinkId(id).catch(() => {});
}

/* Push low-latency Opus settings onto every audio sender. */
function tuneAudioSenders(pc) {
  try {
    pc.getSenders().forEach(s => {
      if (!s.track || s.track.kind !== 'audio') return;
      try {
        const p = s.getParameters();
        if (!p.encodings || !p.encodings.length) p.encodings = [{}];
        p.encodings[0].maxBitrate = 96000;
        p.encodings[0].networkPriority = 'high';
        p.encodings[0].priority = 'high';
        p.degradationPreference = 'maintain-fidelity';
        const pr = s.setParameters(p);
        if (pr && pr.catch) pr.catch(() => {});
      } catch (e) { /* older browsers ignore these */ }
    });
  } catch (e) { /* ignore */ }
}

function createVoicePeer(uid, initiator) {
  if (voice.peers[uid]) return voice.peers[uid];
  const pc = new RTCPeerConnection({
    iceServers: ICE_SERVERS,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
    iceCandidatePoolSize: 4
  });
  ensureVoiceAudioContainer();
  const audioEl = document.createElement('audio');
  audioEl.autoplay = true;
  audioEl.setAttribute('playsinline', '');
  audioEl.dataset.uid = uid;
  $('voice-audio').appendChild(audioEl);

  const peer = {
    pc, audioEl,
    pendingIce: [],
    remoteSet: false,
    makingOffer: false,
    ignoreOffer: false,
    /* Exactly one side of every pair drives the initial offer: the person who
       just joined (the "initiator"). The peers who were already in the channel
       only answer. Both sides offering at the same time caused a glare race
       that could leave the connection half-negotiated and silent. */
    shouldInitiate: !!initiator,
    /* Deterministic, symmetric politeness so any later glare (ICE restart)
       still resolves the same way on both ends. */
    polite: String((me && me.id) || '') < String(uid),
    restartTimer: 0
  };
  voice.peers[uid] = peer;

  if (voice.localStream) {
    voice.localStream.getTracks().forEach(t => {
      try { pc.addTrack(t, voice.localStream); } catch (e) {}
    });
  }

  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit('voice_signal', { to: uid, data: { type: 'ice', candidate: e.candidate } });
  };

  pc.ontrack = (e) => {
    const stream = (e.streams && e.streams[0]) || new MediaStream([e.track]);
    peer.remoteStream = stream;
    if (audioEl.srcObject !== stream) audioEl.srcObject = stream;
    audioEl.muted = voice.deafened;
    applyOutputDevice(audioEl);
    const tryPlay = () => {
      const p = audioEl.play();
      if (p && p.catch) p.catch(() => { peer.playTimer = setTimeout(tryPlay, 400); });
    };
    tryPlay();
    try {
      e.track.onunmute = () => { if (audioEl.paused) tryPlay(); };
    } catch (err) {}
  };

  /* Modern negotiation: the browser tells us when an offer is needed (e.g. the
     mic track was added). Only the designated initiator acts on it - the other
     side waits for the offer and answers, which removes the initial glare. */
  pc.onnegotiationneeded = async () => {
    if (!peer.shouldInitiate || peer.ignoreOffer) return;
    if (pc.signalingState !== 'stable') return;
    try {
      peer.makingOffer = true;
      await pc.setLocalDescription();
      if (pc.localDescription) {
        socket.emit('voice_signal', { to: uid, data: { type: pc.localDescription.type, sdp: pc.localDescription } });
      }
    } catch (e) { /* ignore */ } finally { peer.makingOffer = false; }
  };

  const recover = () => {
    if (peer.restartTimer) return;
    peer.restartTimer = setTimeout(async () => {
      peer.restartTimer = 0;
      if (!voice.peers[uid]) return;
      if (pc.signalingState !== 'stable') return;
      try {
        peer.makingOffer = true;
        if (typeof pc.restartIce === 'function') pc.restartIce();
        await pc.setLocalDescription();
        if (pc.localDescription) {
          socket.emit('voice_signal', { to: uid, data: { type: pc.localDescription.type, sdp: pc.localDescription } });
        }
      } catch (e) { /* ignore */ } finally { peer.makingOffer = false; }
    }, 1500);
  };

  pc.oniceconnectionstatechange = () => {
    const st = pc.iceConnectionState;
    if (st === 'failed') recover();
    else if (st === 'disconnected') recover();
    else if (st === 'connected' || st === 'completed') { tuneAudioSenders(pc); }
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') recover();
    else if (pc.connectionState === 'closed') destroyVoicePeer(uid);
    else if (pc.connectionState === 'connected') tuneAudioSenders(pc);
  };

  /* The initial offer is produced by onnegotiationneeded (fired because the
     local mic tracks were just added). We deliberately do NOT fire a second
     offer here - doing so raced with onnegotiationneeded and produced glare. */
  return peer;
}

function flushIce(peer) {
  const q = peer.pendingIce.splice(0);
  q.forEach(c => { peer.pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}); });
}

async function handleVoiceSignal(from, data) {
  if (!from || !data || !voice.channel) return;
  let peer = voice.peers[from];
  if (!peer) peer = createVoicePeer(from, false);
  const pc = peer.pc;
  try {
    if (data.type === 'offer' || data.type === 'answer') {
      const desc = new RTCSessionDescription(data.sdp);
      const collision = desc.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
      peer.ignoreOffer = !peer.polite && collision;
      if (peer.ignoreOffer) return;
      if (collision) {
        /* Polite peer rolls back and accepts the remote offer. */
        await Promise.all([
          pc.setLocalDescription({ type: 'rollback' }).catch(() => {}),
          pc.setRemoteDescription(desc)
        ]);
      } else {
        await pc.setRemoteDescription(desc);
      }
      peer.remoteSet = true;
      /* An answer means the current negotiation succeeded - clear any stale
         "ignore" flag so a later ICE restart can still negotiate. */
      if (desc.type === 'answer') peer.ignoreOffer = false;
      flushIce(peer);
      if (desc.type === 'offer') {
        await pc.setLocalDescription();
        if (pc.localDescription) {
          socket.emit('voice_signal', { to: from, data: { type: 'answer', sdp: pc.localDescription } });
        }
      }
      tuneAudioSenders(pc);
    } else if (data.type === 'ice' && data.candidate) {
      if (!peer.remoteSet) { peer.pendingIce.push(data.candidate); return; }
      try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (e) { /* stale */ }
    }
  } catch (e) { /* transient signaling errors are expected during glare */ }
}

function destroyVoicePeer(uid) {
  const peer = voice.peers[uid];
  if (!peer) return;
  if (peer.restartTimer) clearTimeout(peer.restartTimer);
  if (peer.playTimer) clearTimeout(peer.playTimer);
  try { peer.pc.close(); } catch (e) {}
  if (peer.audioEl) { try { peer.audioEl.srcObject = null; } catch (e) {} peer.audioEl.remove(); }
  delete voice.peers[uid];
}

function startSpeakingDetection() {
  try {
    if (!voice.localStream) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!voice.audioCtx || voice.audioCtx.state === 'closed') voice.audioCtx = new Ctx();
    if (!voice.analyser) {
      const src = voice.audioCtx.createMediaStreamSource(voice.localStream);
      const analyser = voice.audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.55;
      src.connect(analyser);
      voice.analyser = analyser;
    }
    const analyser = voice.analyser;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (!voice.analyser) return;
      analyser.getByteFrequencyData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i];
      const avg = sum / buf.length;
      const speaking = avg > 14 && !voice.muted;
      if (speaking !== voice.speaking) {
        voice.speaking = speaking;
        if (voice.channel) socket.emit('voice_update', { channel_id: voice.channel.id, speaking });
        renderVoicePanel();
      }
      voice.rafId = requestAnimationFrame(tick);
    };
    tick();
  } catch (e) { /* audio analysis is best-effort */ }
}

function stopSpeakingDetection() {
  if (voice.rafId) cancelAnimationFrame(voice.rafId);
  voice.rafId = null;
  voice.analyser = null;
  voice.gain = null;
  if (voice.audioCtx) { try { voice.audioCtx.close(); } catch (e) {} voice.audioCtx = null; }
}

/* Apply the current mute state to the transmitted track *and* the gain node -
   belt and braces, because some browsers ignore `track.enabled` on the
   destination stream produced by a MediaStreamAudioDestinationNode. */
function applyMicState() {
  const on = !voice.muted;
  if (voice.localStream) {
    try { voice.localStream.getAudioTracks().forEach(t => { t.enabled = on; }); } catch (e) {}
  }
  if (voice.rawStream) {
    try { voice.rawStream.getAudioTracks().forEach(t => { t.enabled = on; }); } catch (e) {}
  }
  if (voice.gain) {
    const vol = Number(setting('inputVolume'));
    const base = isFinite(vol) ? Math.max(0, Math.min(2, vol / 100)) : 0.7;
    try { voice.gain.gain.value = on ? base : 0; } catch (e) {}
  }
}

function toggleVoiceMute() {
  if (!voice.channel) return;
  voice.muted = !voice.muted;
  applyMicState();
  if (voice.muted) voice.speaking = false;
  socket.emit('voice_update', { channel_id: voice.channel.id, muted: voice.muted, speaking: voice.speaking });
  renderVoicePanel();
  if (state.server) renderChannelList();
}

function toggleVoiceDeafen() {
  if (!voice.channel) return;
  voice.deafened = !voice.deafened;
  if (voice.deafened) {
    voice.mutedBeforeDeafen = voice.muted;
    voice.muted = true;
  } else {
    voice.muted = !!voice.mutedBeforeDeafen;
  }
  applyMicState();
  Object.values(voice.peers).forEach(p => { if (p.audioEl) p.audioEl.muted = voice.deafened; });
  socket.emit('voice_update', { channel_id: voice.channel.id, muted: voice.muted, deafened: voice.deafened, speaking: voice.speaking });
  renderVoicePanel();
  if (state.server) renderChannelList();
}

function renderVoicePanel() {
  const sidebar = $('sidebar');
  if (!sidebar) return;
  let panel = $('voice-panel');
  if (!voice.channel) { if (panel) panel.remove(); return; }
  const c = voice.channel;
  const count = (voice.states[c.id] || []).length;

  /* Build the panel exactly once and then patch it in place. Rebuilding the
     innerHTML on every voice_state event (which fires on each speaking change,
     many times a second) used to destroy the disconnect button between
     mousedown and mouseup, so hanging up silently did nothing. */
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'voice-panel';
    panel.id = 'voice-panel';
    panel.innerHTML = `
      <div class="vp-top">
        <div class="vp-signal">${icon('signal')}</div>
        <div class="vp-info">
          <div class="vp-title"></div>
          <div class="vp-sub"></div>
        </div>
        <button class="vp-disconnect" id="vp-disconnect" title="Disconnect">${icon('phone-off')}</button>
      </div>
      <div class="vp-actions">
        <button class="vp-act" id="vp-mute"></button>
        <button class="vp-act" id="vp-deafen"></button>
        <button class="vp-act" id="vp-settings" title="Voice Settings">${icon('settings')}</button>
      </div>`;
    const userPanel = sidebar.querySelector('.user-panel');
    if (userPanel) sidebar.insertBefore(panel, userPanel); else sidebar.appendChild(panel);
    hydrateIcons(panel);
    /* Bound once: these handlers now survive every state update. */
    $('vp-disconnect').addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); leaveVoiceChannel(); });
    $('vp-mute').addEventListener('click', toggleVoiceMute);
    $('vp-deafen').addEventListener('click', toggleVoiceDeafen);
    $('vp-settings').addEventListener('click', () => openSettings('voice'));
  }

  const sig = panel.querySelector('.vp-signal');
  if (sig) sig.classList.toggle('speaking', !!voice.speaking);
  const title = panel.querySelector('.vp-title');
  if (title) title.textContent = c.name;
  const sub = panel.querySelector('.vp-sub');
  if (sub) sub.textContent = 'Voice' + (count ? ' \u00b7 ' + count + (count === 1 ? ' person' : ' people') : '');
  const muteBtn = panel.querySelector('#vp-mute');
  if (muteBtn) {
    muteBtn.classList.toggle('off', !!voice.muted);
    muteBtn.title = voice.muted ? 'Unmute' : 'Mute';
    const want = voice.muted ? 'mic-off' : 'mic';
    if (muteBtn.dataset.ic !== want) { muteBtn.dataset.ic = want; muteBtn.innerHTML = icon(want); }
  }
  const deafBtn = panel.querySelector('#vp-deafen');
  if (deafBtn) {
    deafBtn.classList.toggle('off', !!voice.deafened);
    deafBtn.title = voice.deafened ? 'Undeafen' : 'Deafen';
    const want = voice.deafened ? 'headphones-off' : 'headphones';
    if (deafBtn.dataset.ic !== want) { deafBtn.dataset.ic = want; deafBtn.innerHTML = icon(want); }
  }
}

/* Build the little list of connected members shown under a voice channel row. */
function voiceMembersNode(cid) {
  const members = voice.states[cid] || [];
  if (!members.length) return null;
  const box = document.createElement('div');
  box.className = 'voice-members';
  box.innerHTML = members.map(m => {
    const u = state.usersCache[m.user_id] || { id: m.user_id, username: 'User', accent_color: '#5865f2' };
    const name = escapeHtml(u.display_name || u.username);
    const speaking = (m.speaking && !m.muted) ? ' speaking' : '';
    const icons = (m.muted ? `<span class="vm-ic">${icon('mic-off')}</span>` : '') +
                  (m.deafened ? `<span class="vm-ic">${icon('headphones-off')}</span>` : '');
    return `<div class="voice-member${speaking}" data-uid="${m.user_id}">
      <span class="vm-ava">${avatarHTML(u, 22, null)}</span>
      <span class="vm-name">${name}</span>${icons}
    </div>`;
  }).join('');
  hydrateIcons(box);
  box.querySelectorAll('.voice-member').forEach(el => el.addEventListener('click', () => {
    const u = state.usersCache[el.dataset.uid];
    if (u) openProfile(u);
  }));
  return box;
}

function renderVoiceMembersInList() {
  if (!state.server) return;
  document.querySelectorAll('.voice-chan-wrap').forEach(wrap => {
    const old = wrap.querySelector('.voice-members');
    if (old) old.remove();
    const node = voiceMembersNode(wrap.dataset.cid);
    if (node) wrap.appendChild(node);
  });
}

function renderMembers() {
  const wrap = $('members');
  if (!state.server) { wrap.classList.add('closed'); wrap.innerHTML = ''; return; }
  wrap.classList.toggle('closed', !state.showMembers);
  wrap.innerHTML = '';
  const roles = state.roles || [];
  const hoisted = roles.filter(r => r.hoist).sort((a, b) => (b.position || 0) - (a.position || 0));
  const roleById = {};
  roles.forEach(r => { roleById[r.id] = r; });
  const placed = new Set();

  const makeRow = (m) => {
    const row = document.createElement('div');
    row.className = 'member' + (m.status === 'offline' ? ' offline' : '');
    row.dataset.uid = m.id;
    const crown = (state.server.owner_id === m.id) ? `<span class="owner-crown">${icon('crown')}</span>` : '';
    const role = state.server.owner_id === m.id ? 'owner' : (m.role || 'member');
    const roleTag = role === 'admin' ? '<span class="member-role-tag admin">ADMIN</span>' : '';
    const crole = (m.custom_role_id && roleById[m.custom_role_id]) || null;
    const croleTag = crole ? `<span class="member-role-tag" style="color:${crole.color};border-color:${crole.color}">${roleIconHTML(crole.icon, 'role-tag-ico')}${escapeHtml(crole.name)}</span>` : '';
    row.innerHTML = `${avatarHTML(m, 36, m.status || 'offline')}<div class="member-body"><span class="mname">${escapeHtml(m.display_name || m.username)}${crown}${roleTag}${croleTag}${badgeChips(m, { compact: true })}</span></div>`;
    row.addEventListener('click', () => openProfile(m));
    return row;
  };
  const addCat = (label, arr, color) => {
    if (!arr.length) return;
    const cat = document.createElement('div');
    cat.className = 'member-cat';
    cat.innerHTML = `${color ? `<span class="member-cat-dot" style="background:${color}"></span>` : ''}<span>${escapeHtml(label)}</span><span class="member-cat-count">${arr.length}</span>`;
    wrap.appendChild(cat);
    arr.forEach(m => wrap.appendChild(makeRow(m)));
  };

  /* Display-role groups come first and are kept separate from the
     online/offline grouping, so a hoisted role reads as its own section. */
  for (const r of hoisted) {
    const group = state.members
      .filter(m => m.custom_role_id === r.id)
      .sort((a, b) => (a.status === 'offline' ? 1 : 0) - (b.status === 'offline' ? 1 : 0));
    if (!group.length) continue;
    group.forEach(m => placed.add(m.id));
    addCat(r.name, group, r.color);
  }

  const rest = state.members.filter(m => !placed.has(m.id));
  const online = rest.filter(m => m.status !== 'offline');
  const offline = rest.filter(m => m.status === 'offline');
  addCat('ONLINE', online);
  addCat('OFFLINE', offline);
}

/* Collapse the member list with a slide animation. */
function closeMembersPanel() {
  const wrap = $('members');
  if (wrap) { wrap.classList.add('closed'); wrap.innerHTML = ''; }
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
  node.className = 'msg-group' + (grouped ? ' compact' : '');
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
  /* A message that is nothing but a GIF link should show only the GIF. */
  const failed = !!m.decrypt_failed;
  const bodyText = failed ? '' : (isEmbeddableMediaUrl((extractUrls(m.content || '')[0] || ''))
    ? stripEmbeddableUrls(m.content)
    : m.content);
  /* Discord enlarges messages that are nothing but emoji ("jumbo" emoji). */
  const emojiOnly = isEmojiOnly(bodyText || '');
  const nEmoji = emojiOnly ? emojiCount(bodyText || '') : 0;
  const jumboCls = emojiOnly ? (nEmoji <= 3 ? ' jumbo' : (nEmoji <= 6 ? ' jumbo lg' : '')) : '';
  node.innerHTML = `${toolbar}${gutter}<div class="body">${m.reply_to ? replyRefHTML(m.reply_to) : ''}${head}
    <div class="text" data-content>${m.encrypted ? `<span class="msg-lock" title="End-to-end encrypted">${icon('lock')}</span>` : ''}${m.pinned ? `<span class="msg-pin" title="Pinned message">${icon('pin')}</span>` : ''}${failed ? `<span class="text-body msg-undecryptable">${icon('lock')} Unable to decrypt this message</span>` : `<span class="text-body${jumboCls}">${formatContent(bodyText)}</span>`}${m.edited_at ? `<span class="msg-edited" title="Edited ${escapeHtml(formatTime(m.edited_at))}">(edited)</span>` : ''}</div>
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
  const allUrls = extractUrls(m.content).filter(u => !/[?&]invite=/i.test(u));
  const mediaLinks = allUrls.filter(isEmbeddableMediaUrl);
  const plainUrls = allUrls.filter(u => !isEmbeddableMediaUrl(u));
  /* Media links render as the actual GIF/video - never as a bare URL. */
  mediaLinks.slice(0, 3).forEach(u => {
    const direct = directMediaFromUrl(u);
    if (direct && direct.type !== 'defer') slot.appendChild(mediaEmbedNode(direct));
    else slot.appendChild(embedNode(u));
  });
  if (plainUrls.length) {
    plainUrls.slice(0, 2).forEach(u => slot.appendChild(embedNode(u)));
  }
  node.querySelectorAll('.reaction').forEach(r => r.addEventListener('click', () => toggleReaction(m.id, r.dataset.emoji)));
  node.querySelectorAll('.msg-toolbar button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const act = btn.dataset.act;
      if (act === 'react') openReactionPickerAt(btn.getBoundingClientRect().left - 140, btn.getBoundingClientRect().bottom + 8, m.id);
      else if (act === 'reply') setReplyTo(m);
      else if (act === 'more') {
        /* Shift + click the ⋯ button on your own message = instant delete. */
        if (e.shiftKey && me && m.author && m.author.id === me.id) { deleteMessage(m.id, true); return; }
        const r = btn.getBoundingClientRect(); openMessageContextMenu(r.right - 200, r.bottom + 4, m);
      }
    });
  });
  return node;
}

function appendMessage(m) {
  const inner = $('messages-inner');
  if (!inner) { renderMessages(); return; }
  const prev = state.messages[state.messages.length - 2];
  const grouped = prev && prev.author && m.author && prev.author.id === m.author.id && (m.created_at - prev.created_at) < 5 * 60 * 1000 && !m.reply_to;
  const node = messageNode(m, grouped, true);
  inner.appendChild(node);
  typewriterMessage(node, m);
  scrollToBottom();
}

/* Typewriter reveal for a freshly added message: the text types out
   character-by-character (like the reference clip) with a blinking caret,
   then settles into its fully formatted form. Long messages reveal in small
   chunks so the whole animation stays around a second. */
function typewriterMessage(node, m) {
  if (!node || !m || !m.content) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const body = node.querySelector('.text-body');
  if (!body) return;
  const raw = m.content;
  if (raw.length > 800) return;                 /* don't animate novels */
  const html = body.innerHTML;
  body.textContent = '';
  const cursor = document.createElement('span');
  cursor.className = 'type-cursor';
  body.appendChild(cursor);
  const maxSteps = 55;
  const chunk = Math.max(1, Math.ceil(raw.length / maxSteps));
  const speed = raw.length <= maxSteps ? 22 : 15;
  let i = 0;
  const step = () => {
    if (!body.isConnected) { body.innerHTML = html; return; }
    if (i >= raw.length) { cursor.remove(); body.innerHTML = html; return; }
    cursor.insertAdjacentText('beforebegin', raw.slice(i, i + chunk));
    i += chunk;
    setTimeout(step, speed);
  };
  step();
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

/* ------------------------------------------------------------
   Emoji rendering
   Discord renders emoji with Twemoji, so we do the same: every emoji
   glyph becomes an <img> from the Twemoji SVG set. This gives identical
   artwork across platforms (Windows/Android/Linux) instead of whatever
   the OS font happens to draw.
   ------------------------------------------------------------ */
const EMOJI_RE = /(?:\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u{1F3FB}-\u{1F3FF})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u{1F3FB}-\u{1F3FF})?)*)|(?:[\u{1F1E6}-\u{1F1FF}]{2})|(?:[0-9#*]\uFE0F?\u20E3)/gu;
const TWEMOJI_BASE = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.0.3/assets/svg/';

/* Twemoji filenames are lowercase hex code points joined by "-". Variation
   selectors are dropped unless the sequence contains a ZWJ (matches Twemoji). */
function twemojiUrl(e) {
  const hasZWJ = e.indexOf('\u200D') >= 0;
  let cps = Array.from(e).map(c => c.codePointAt(0)).filter(c => c !== 0xFE0E);
  if (!hasZWJ) cps = cps.filter(c => c !== 0xFE0F);
  return TWEMOJI_BASE + cps.map(c => c.toString(16)).join('-') + '.svg';
}

function emojiImg(e) {
  return `<img class="emoji" src="${twemojiUrl(e)}" alt="${escapeHtml(e)}" draggable="false" loading="lazy">`;
}

/* Replace every emoji in an already-escaped HTML string with a Twemoji image. */
function emojify(html) {
  if (!html) return html;
  EMOJI_RE.lastIndex = 0;
  if (!EMOJI_RE.test(html)) return html;
  EMOJI_RE.lastIndex = 0;
  return html.replace(EMOJI_RE, (m) => emojiImg(m));
}

function emojiCount(text) {
  if (!text) return 0;
  EMOJI_RE.lastIndex = 0;
  const m = text.match(EMOJI_RE);
  return m ? m.length : 0;
}

/* True when a message contains nothing but emoji + whitespace. */
function isEmojiOnly(text) {
  if (!text || !text.trim()) return false;
  EMOJI_RE.lastIndex = 0;
  const stripped = text.replace(EMOJI_RE, '').replace(/\s+/g, '');
  return stripped === '';
}

function formatContent(text) {
  if (!text) return '';
  let html = escapeHtml(text);

  /* --- 1. Pull out the pieces that must never be touched by inline markdown --- */
  const codeBlocks = [];
  html = html.replace(/```([\s\S]*?)```/g, (m, code) => {
    codeBlocks.push(code.replace(/^\n/, ''));
    return `\u0000C${codeBlocks.length - 1}\u0000`;
  });
  const inlineCode = [];
  html = html.replace(/`([^`\n]+)`/g, (m, code) => {
    inlineCode.push(code);
    return `\u0000I${inlineCode.length - 1}\u0000`;
  });
  const links = [];
  html = html.replace(/(https?:\/\/[^\s<]+)/g, (u) => { links.push(u); return `\u0000L${links.length - 1}\u0000`; });

  /* --- 2. Inline markdown (Discord-style) --- */
  function renderInline(s) {
    // Spoilers ||hidden||
    s = s.replace(/\|\|([\s\S]+?)\|\|/g, '<span class="spoiler">$1</span>');
    // Bold + italic, bold, italic
    s = s.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    // Underline __text__ (before single-underscore italic)
    s = s.replace(/__([^_\n]+)__/g, '<u>$1</u>');
    // Italic _text_
    s = s.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?]|$)/g, '$1<em>$2</em>');
    // Strikethrough ~~text~~
    s = s.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
    // Invite codes gg/xxxx
    s = s.replace(/(^|[\s(])(gg\/[A-Za-z0-9_-]{4,64})/g, '$1<span class="invite-code">$2</span>');
    // @mentions
    s = s.replace(/@([a-zA-Z0-9._]+)/g, (mt, name) => {
      const u = userByName(name);
      const isMe = u ? u.id === me.id : (name.toLowerCase() === (me.username || '').toLowerCase());
      const uidAttr = u ? ` data-uid="${u.id}"` : '';
      const special = /^(everyone|here)$/i.test(name) ? ' special' : '';
      return `<span class="mention${isMe ? ' me' : ''}${special}"${uidAttr}>@${name}</span>`;
    });
    // #channel links
    s = s.replace(/(^|[\s(])#([a-z0-9-]+)/g, '$1<span class="mention" data-channel="$2">#$2</span>');
    // Bare domains (Discord auto-links these too): example.com/path, www.example.com
    s = s.replace(/(^|[\s(])((?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/[^\s<)]*)?)/gi,
      (m, pre, url) => `${pre}<a href="https://${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
    // Emoji -> Twemoji images (last, so markdown markers never touch them).
    return emojify(s);
  }

  /* --- 3. Block-level markdown, line by line --- */
  const lines = html.split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Blockquote  > text
    if (/^\s*&gt;\s?/.test(line)) {
      const q = [];
      while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) { q.push(renderInline(lines[i].replace(/^\s*&gt;\s?/, ''))); i++; }
      blocks.push(`<blockquote class="md-quote">${q.join('\n')}</blockquote>`);
      continue;
    }
    // Heading  # / ## / ###
    const h = line.match(/^\s*(#{1,3})\s+(.+)$/);
    if (h) { blocks.push(`<div class="md-h md-h${h[1].length}">${renderInline(h[2])}</div>`); i++; continue; }
    // Unordered list  - / * / +
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { items.push(`<li>${renderInline(lines[i].replace(/^\s*[-*+]\s+/, ''))}</li>`); i++; }
      blocks.push(`<ul class="md-ul">${items.join('')}</ul>`);
      continue;
    }
    // Ordered list  1. 2. 3.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(`<li>${renderInline(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>`); i++; }
      blocks.push(`<ol class="md-ol">${items.join('')}</ol>`);
      continue;
    }
    // Plain line
    blocks.push(renderInline(line));
    i++;
  }
  let result = blocks.join('\n');

  /* --- 4. Restore extracted pieces --- */
  result = result.replace(/\u0000L(\d+)\u0000/g, (mt, idx) => `<a href="${links[idx]}" target="_blank" rel="noopener">${links[idx]}</a>`);
  result = result.replace(/\u0000I(\d+)\u0000/g, (mt, idx) => `<code>${inlineCode[idx]}</code>`);
  result = result.replace(/\u0000C(\d+)\u0000/g, (mt, idx) => `<pre class="md-pre"><code>${codeBlocks[idx]}</code></pre>`);
  return result;
}

function extractUrls(text) {
  if (!text) return [];
  const m = text.match(/https?:\/\/[^\s<]+/g) || [];
  return m.filter(u => !/\.(png|jpe?g|gif|webp|mp4|webm|mov|mp3|wav)$/i.test(u));
}

function reactionsHTML(reactions) {
  if (!reactions || !reactions.length) return '';
  return reactions.map(r => `<div class="reaction${r.me ? ' me' : ''}" data-emoji="${escapeHtml(r.emoji)}" title="${escapeHtml((r.users || []).length)} reactions">
    <span class="emoji">${emojify(escapeHtml(r.emoji))}</span><span class="count">${r.count}</span></div>`).join('');
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

/* Custom video player.
   Collapsed: poster frame + large centred play button (screenshot 1).
   Playing:    control bar with play/pause, time, seek, volume, fullscreen (screenshot 2). */
function videoPlayerNode(url, name) {
  const player = document.createElement('div');
  player.className = 'vp';
  player.innerHTML = `
    <video class="vp-video" src="${escapeHtml(url)}" preload="metadata" playsinline></video>
    <button class="vp-big-play" type="button" aria-label="Play video">${icon('play')}</button>
    <div class="vp-controls">
      <button class="vp-btn vp-toggle" type="button" aria-label="Play">${icon('play')}</button>
      <div class="vp-time"><span class="vp-cur">0:00</span> / <span class="vp-dur">0:00</span></div>
      <input class="vp-seek" type="range" min="0" max="1000" value="0" step="1" aria-label="Seek">
      <div class="vp-vol-wrap">
        <button class="vp-btn vp-mute" type="button" aria-label="Mute">${icon('volume-high')}</button>
        <input class="vp-vol" type="range" min="0" max="1" step="0.01" value="1" aria-label="Volume">
      </div>
      <button class="vp-btn vp-fs" type="button" aria-label="Fullscreen">${icon('maximize')}</button>
    </div>`;

  const video = player.querySelector('.vp-video');
  const bigPlay = player.querySelector('.vp-big-play');
  const toggle = player.querySelector('.vp-toggle');
  const cur = player.querySelector('.vp-cur');
  const dur = player.querySelector('.vp-dur');
  const seek = player.querySelector('.vp-seek');
  const muteBtn = player.querySelector('.vp-mute');
  const vol = player.querySelector('.vp-vol');
  const fsBtn = player.querySelector('.vp-fs');

  const fmt = (s) => {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + ':' + String(sec).padStart(2, '0');
  };
  const setPlayIcon = (playing) => {
    toggle.innerHTML = playing ? icon('pause') : icon('play');
    toggle.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  };
  const setVolIcon = () => {
    const v = video.muted ? 0 : video.volume;
    muteBtn.innerHTML = v === 0 ? icon('volume-x') : (v < 0.5 ? icon('volume-1') : icon('volume-high'));
    muteBtn.setAttribute('aria-label', v === 0 ? 'Unmute' : 'Mute');
  };

  const start = () => { player.classList.add('playing'); video.play().catch(() => {}); };
  bigPlay.addEventListener('click', start);
  toggle.addEventListener('click', () => { if (video.paused) start(); else video.pause(); });
  video.addEventListener('click', () => { if (video.paused) start(); else video.pause(); });

  video.addEventListener('play', () => { setPlayIcon(true); player.classList.add('playing'); });
  video.addEventListener('pause', () => setPlayIcon(false));
  video.addEventListener('ended', () => { setPlayIcon(false); player.classList.remove('playing'); });
  video.addEventListener('loadedmetadata', () => {
    dur.textContent = fmt(video.duration);
    /* Nudge to the first frame so the collapsed state shows a real thumbnail. */
    try { if (!video.currentTime) video.currentTime = 0.01; } catch (e) { /* ignore */ }
  });
  video.addEventListener('timeupdate', () => {
    cur.textContent = fmt(video.currentTime);
    if (video.duration) seek.value = Math.round((video.currentTime / video.duration) * 1000);
  });
  seek.addEventListener('input', () => { if (video.duration) video.currentTime = (seek.value / 1000) * video.duration; });
  muteBtn.addEventListener('click', () => { video.muted = !video.muted; setVolIcon(); });
  vol.addEventListener('input', () => { video.volume = Number(vol.value); video.muted = Number(vol.value) === 0; setVolIcon(); });
  fsBtn.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (player.requestFullscreen) player.requestFullscreen().catch(() => {});
    else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
  });
  player.addEventListener('fullscreenchange', () => { fsBtn.innerHTML = document.fullscreenElement ? icon('minimize') : icon('maximize'); });

  setPlayIcon(false);
  setVolIcon();
  return player;
}

function attachmentNode(m) {
  const wrap = document.createElement('div');
  wrap.className = 'attachment';
  const t = (m.attachment_type || '').toLowerCase();
  const url = m.attachment_url;
  const sizeText = fmtBytes(m.attachment_size);
  const isGif = t === 'image/gif' || /\.gif(\?|$)/i.test(url || '');
  if (t.startsWith('image/')) {
    /* Images and GIFs render as bare media directly under the message. */
    wrap.classList.add('media');
    if (isGif) wrap.classList.add('gif');
    wrap.innerHTML = `<img src="${escapeHtml(url)}" alt="${escapeHtml(m.attachment_name || '')}" loading="lazy" decoding="async">`;
    wrap.querySelector('img').addEventListener('click', () => lightbox(url, 'image', m.attachment_name || '', sizeText));
    if (sizeText) wrap.insertAdjacentHTML('beforeend', `<span class="att-size">${sizeText}</span>`);
  } else if (t.startsWith('video/')) {
    /* Videos show a poster frame with a centred play button; pressing play
       reveals a full custom control bar (seek, volume, fullscreen). */
    wrap.classList.add('video-attachment');
    wrap.appendChild(videoPlayerNode(url, m.attachment_name || ''));
    if (sizeText) wrap.insertAdjacentHTML('beforeend', `<span class="att-size">${sizeText}</span>`);
  } else if (t.startsWith('audio/')) {
    wrap.classList.add('media');
    wrap.innerHTML = `<audio src="${escapeHtml(url)}" controls style="width:320px"></audio>`;
    if (sizeText) wrap.insertAdjacentHTML('beforeend', `<span class="att-size">${sizeText}</span>`);
  } else {
    const meta = [sizeText, 'Click to download'].filter(Boolean).join(' \u2022 ');
    wrap.innerHTML = `<div class="file-card"><div class="fi">${icon('file')}</div><div class="fc-meta"><a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(m.attachment_name || 'file')}</a><div class="fsize">${escapeHtml(meta)}</div></div></div>`;
  }
  return wrap;
}

/* Human-readable byte size, e.g. 812 B, 314 KB, 2.4 MB, 1.1 GB. */
function fmtBytes(n) {
  if (n === null || n === undefined || n === '' || isNaN(n)) return '';
  n = Number(n);
  if (!isFinite(n) || n <= 0) return '';
  if (n < 1024) return n + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
  return (n < 10 ? n.toFixed(1) : Math.round(n)) + ' ' + units[i];
}

/* ------------------------------------------------------------
   Direct media links (Giphy / Tenor / plain files)
   ------------------------------------------------------------
   Pasting a Giphy or Tenor page link used to produce a boring link card.
   We resolve the underlying GIF/MP4 so the media renders inline, instantly,
   with no visible URL left in the message. */
const MEDIA_HOSTS = /(^|\.)(giphy\.com|gph\.is|tenor\.com|media\.tenor\.com|media\.giphy\.com|i\.giphy\.com)$/i;

function directMediaFromUrl(url) {
  if (!url) return null;
  let u;
  try { u = new URL(url, location.origin); } catch (e) { return null; }
  if (!/^https?:$/i.test(u.protocol)) return null;
  const host = u.hostname.replace(/^www\./i, '').toLowerCase();
  const path = u.pathname || '';
  /* Plain media files. */
  if (/\.(gif|webp|png|jpe?g|avif)$/i.test(path)) return { type: 'image', url: u.href };
  if (/\.(mp4|webm|mov|m4v)$/i.test(path)) return { type: 'video', url: u.href };
  if (host === 'media.giphy.com' || host === 'i.giphy.com') return { type: 'image', url: u.href };
  if (host === 'media.tenor.com') return { type: 'image', url: u.href };
  if (host === 'giphy.com') {
    const m = path.match(/-([A-Za-z0-9]{5,})$/) || path.match(/\/([A-Za-z0-9]{5,})\/?$/);
    const id = m && m[1];
    if (id) return { type: 'image', url: 'https://media.giphy.com/media/' + id + '/giphy.gif' };
  }
  if (host === 'tenor.com') {
    /* Tenor's CDN path is not derivable from the page slug, so let the server
       resolve it through oEmbed (handled in embedNode). */
    return { type: 'defer', url: u.href };
  }
  return null;
}

function isEmbeddableMediaUrl(url) {
  try {
    const u = new URL(url, location.origin);
    if (!/^https?:$/i.test(u.protocol)) return false;
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    if (MEDIA_HOSTS.test(host)) return true;
    return /\.(gif|webp|mp4|webm|mov|m4v)$/i.test(u.pathname || '');
  } catch (e) { return false; }
}

/* Remove embedded media URLs from the rendered text so only the media shows. */
function stripEmbeddableUrls(text) {
  if (!text) return text;
  let out = text;
  extractUrls(text).forEach(u => {
    if (isEmbeddableMediaUrl(u)) out = out.split(u).join('');
  });
  return out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function mediaEmbedNode(media) {
  const wrap = document.createElement('div');
  wrap.className = 'embed-media-wrap';
  if (media.type === 'video') {
    wrap.appendChild(videoPlayerNode(media.url, ''));
    return wrap;
  }
  const img = document.createElement('img');
  img.className = 'embed-media';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.alt = '';
  img.src = media.url;
  img.addEventListener('click', () => lightbox(media.url, 'image', '', ''));
  img.addEventListener('error', () => { wrap.remove(); });
  wrap.appendChild(img);
  return wrap;
}

function embedNode(url) {
  const wrap = document.createElement('div');
  wrap.className = 'embed';
  wrap.innerHTML = `<div class="embed-content"><div class="embed-site">Loading preview\u2026</div></div>`;
  api('/api/embed?url=' + encodeURIComponent(url)).then(data => {
    if (!data) return;
    /* The server resolved a real GIF/MP4 for us (Giphy/Tenor oEmbed). */
    if (data.media && data.media.url) {
      const node = mediaEmbedNode({ type: data.media.type || 'image', url: data.media.url });
      wrap.replaceWith(node);
      return;
    }
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

/* Discord switches channels instantly - the new view just paints. This is
   intentionally a no-op so every call site keeps working without any fade. */
function animateView() { /* no animation on purpose */ }

/* Re-trigger a CSS entrance animation on an element that already exists. */
function replayAnim(el, cls) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
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

/* Full-screen media viewer.
   Images: click once to open, click the image again to zoom in, click again to
   zoom back out. The wheel zooms around the cursor and dragging pans while
   zoomed. Videos keep native controls. */
function lightbox(url, type, name, sizeText) {
  const lb = document.createElement('div');
  lb.className = 'lightbox';
  const isImage = type === 'image';
  const media = isImage
    ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(name || '')}" draggable="false">`
    : `<video src="${escapeHtml(url)}" controls autoplay></video>`;
  const meta = [name, sizeText].filter(Boolean).join(' \u00b7 ');
  lb.innerHTML = `<div class="lb-bar">
      <span class="lb-name">${escapeHtml(meta)}</span>
      <span class="lb-zoom-val" id="lb-zoom-val">100%</span>
      <a class="lb-dl" href="${escapeHtml(url)}" download="${escapeHtml(name || '')}" title="Download">${icon('download')}</a>
      <button class="lb-close" title="Close (Esc)">${icon('xmark')}</button>
    </div>
    <div class="lb-stage">${media}</div>
    ${isImage ? '<div class="lb-hint">Click the image to zoom \u00b7 Scroll to zoom \u00b7 Drag to pan</div>' : ''}`;
  hydrateIcons(lb);
  const close = () => { document.removeEventListener('keydown', onKey); lb.remove(); };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (isImage && (e.key === '+' || e.key === '=')) zoomBy(1.35);
    if (isImage && e.key === '-') zoomBy(1 / 1.35);
    if (isImage && e.key === '0') resetZoom();
  };
  document.addEventListener('keydown', onKey);
  lb.addEventListener('click', (e) => {
    if (!e.target.closest('.lb-stage img, .lb-stage video, .lb-bar, .lb-hint')) close();
  });
  lb.querySelector('.lb-close').addEventListener('click', close);
  document.body.appendChild(lb);

  if (!isImage) return;
  const img = lb.querySelector('.lb-stage img');
  const stage = lb.querySelector('.lb-stage');
  const valEl = lb.querySelector('#lb-zoom-val');
  let scale = 1, tx = 0, ty = 0;
  const MIN = 1, MAX = 8;

  const paint = () => {
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    img.classList.toggle('zoomed', scale > 1.001);
    stage.classList.toggle('can-pan', scale > 1.001);
    if (valEl) valEl.textContent = Math.round(scale * 100) + '%';
  };
  const clampPan = () => {
    if (scale <= 1.001) { tx = 0; ty = 0; return; }
    const r = img.getBoundingClientRect();
    const baseW = r.width / scale, baseH = r.height / scale;
    const maxX = Math.max(0, (baseW * scale - stage.clientWidth) / 2);
    const maxY = Math.max(0, (baseH * scale - stage.clientHeight) / 2);
    tx = Math.max(-maxX, Math.min(maxX, tx));
    ty = Math.max(-maxY, Math.min(maxY, ty));
  };
  const resetZoom = () => { scale = 1; tx = 0; ty = 0; paint(); };
  function zoomBy(factor, cx, cy) {
    const next = Math.max(MIN, Math.min(MAX, scale * factor));
    if (Math.abs(next - scale) < 0.001) { paint(); return; }
    if (cx != null && cy != null) {
      /* Keep the point under the cursor anchored while zooming. */
      const r = stage.getBoundingClientRect();
      const ox = cx - r.left - r.width / 2;
      const oy = cy - r.top - r.height / 2;
      const k = next / scale;
      tx = ox - (ox - tx) * k;
      ty = oy - (oy - ty) * k;
    }
    scale = next;
    clampPan();
    paint();
  }

  img.addEventListener('click', (e) => {
    e.stopPropagation();
    if (scale > 1.001) resetZoom();
    else zoomBy(2.2, e.clientX, e.clientY);
  });
  img.addEventListener('dblclick', (e) => { e.preventDefault(); e.stopPropagation(); });
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX, e.clientY);
  }, { passive: false });

  let dragging = false, sx = 0, sy = 0, stx = 0, sty = 0, moved = false;
  img.addEventListener('pointerdown', (e) => {
    if (scale <= 1.001) return;
    dragging = true; moved = false;
    sx = e.clientX; sy = e.clientY; stx = tx; sty = ty;
    img.setPointerCapture && img.setPointerCapture(e.pointerId);
    stage.classList.add('dragging');
  });
  img.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    tx = stx + (e.clientX - sx);
    ty = sty + (e.clientY - sy);
    if (Math.abs(e.clientX - sx) > 3 || Math.abs(e.clientY - sy) > 3) moved = true;
    clampPan();
    paint();
  });
  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    stage.classList.remove('dragging');
    if (img.releasePointerCapture && e && e.pointerId != null) { try { img.releasePointerCapture(e.pointerId); } catch (err) {} }
  };
  img.addEventListener('pointerup', endDrag);
  img.addEventListener('pointercancel', endDrag);
  img.addEventListener('pointerleave', endDrag);
  /* A drag should not be interpreted as a zoom click. */
  img.addEventListener('click', (e) => { if (moved) { e.stopImmediatePropagation(); moved = false; } }, true);

  paint();
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

  const explicitErr = await e2eExplicitCheck(content);
  if (explicitErr) { toast('Message blocked: ' + explicitErr, 'error'); return; }
  const enc = await e2eEncrypt(content, e2eRecipients());

  const payload = { content: enc.content };
  if (enc.encrypted) {
    /* The server cannot read ciphertext, so mentions and @everyone/@here
       pings are resolved here and sent alongside the encrypted body. */
    payload.mentions = e2eMentionIds(content);
    payload.broadcast = e2eBroadcast(content);
  }
  if (state.pendingAttachment) {
    payload.attachment_url = state.pendingAttachment.url;
    payload.attachment_name = state.pendingAttachment.name;
    payload.attachment_type = state.pendingAttachment.type;
    payload.attachment_size = state.pendingAttachment.size;
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
/* Open the OS file picker filtered to a given accept type. Used by the
   "Images" / "Videos & GIFs" options in the upload menu. */
function pickFile(accept) {
  const inp = $('file-input');
  if (!inp) return;
  inp.setAttribute('accept', accept);
  inp.click();
}
async function handleFile(file) {
  if (!file) return;
  if (file.size > 250 * 1024 * 1024) { toast('File is too large (maximum 250 MB)', 'error'); return; }
  const fd = new FormData();
  fd.append('file', file);
  /* Inline progress in the composer instead of a floating toast. */
  showUploadProgress(file.name);
  try {
    const data = await api('/api/upload', { method: 'POST', body: fd });
    state.pendingAttachment = data;
    renderAttachmentPreview();
  } catch (e) { clearAttachment(); toast(e.message, 'error'); }
}
function showUploadProgress(name) {
  const p = $('attach-preview');
  if (!p) return;
  p.classList.remove('hidden');
  $('composer-box').classList.add('attached');
  p.innerHTML = `<div class="ap-uploading"><span class="ap-spin" aria-hidden="true"></span><span class="ap-name">Uploading ${escapeHtml(name)}\u2026</span></div>`;
}
function renderAttachmentPreview() {
  const p = $('attach-preview');
  const a = state.pendingAttachment;
  if (!a) { p.classList.add('hidden'); $('composer-box').classList.remove('attached'); return; }
  p.classList.remove('hidden');
  $('composer-box').classList.add('attached');
  const type = (a.type || '').toLowerCase();
  const isGif = type === 'image/gif' || /\.gif(\?|$)/i.test(a.url || '');
  const isImage = type.startsWith('image/');
  const isVideo = type.startsWith('video/');
  let thumb;
  if (isImage) {
    thumb = `<div class="ap-thumb"><img src="${escapeHtml(a.url)}" alt="${escapeHtml(a.name || '')}">${isGif ? '<span class="ap-badge">GIF</span>' : ''}</div>`;
  } else if (isVideo) {
    thumb = `<div class="ap-thumb"><video src="${escapeHtml(a.url)}" muted playsinline preload="metadata"></video><span class="ap-badge">VIDEO</span></div>`;
  } else {
    thumb = `<div class="ap-file">${icon('file')}</div>`;
  }
  const sizeText = fmtBytes(a.size);
  const sub = [sizeText, isGif ? 'GIF' : (isImage ? 'Image' : (isVideo ? 'Video' : 'File'))].filter(Boolean).join(' \u2022 ');
  p.innerHTML = `${thumb}<div class="ap-meta"><span class="ap-name">${escapeHtml(a.name || 'file')}</span>${sub ? `<span class="ap-sub">${escapeHtml(sub)}</span>` : ''}</div><button id="ap-remove" title="Remove">${icon('xmark')}</button>`;
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

function emojiPickerMarkup(title) {
  return `<div class="ep-top">
      <div class="ep-title">${title}</div>
      <label class="ep-search">${icon('search')}<input id="ep-search" placeholder="Search emoji" autocomplete="off" spellcheck="false"></label>
    </div>
    <div class="ep-tabs">
      ${EMOJI_CATEGORIES.map((c, i) => `<button class="ep-tab${i === 0 ? ' active' : ''}" data-cat="${c.id}" title="${escapeHtml(c.label)}">${c.icon}</button>`).join('')}
    </div>
    <div class="ep-scroll" id="ep-scroll">
      ${EMOJI_CATEGORIES.map(c => `<div class="ep-cat" data-cat="${c.id}">
        <div class="ep-cat-label">${escapeHtml(c.label)}</div>
        <div class="ep-grid">${c.emojis.map(e => `<button class="ep-emoji" data-e="${e}" title="${e}">${emojiImg(e)}</button>`).join('')}</div>
      </div>`).join('')}
    </div>`;
}

function mountEmojiPicker(picker, onPick) {
  picker.innerHTML = emojiPickerMarkup(picker.dataset.title || 'Add Reaction');
  const search = picker.querySelector('#ep-search');
  const scroll = picker.querySelector('#ep-scroll');
  const tabs = picker.querySelectorAll('.ep-tab');
  const cats = picker.querySelectorAll('.ep-cat');
  picker.querySelectorAll('.ep-emoji').forEach(b => b.addEventListener('click', () => onPick(b.dataset.e)));
  tabs.forEach(tab => tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.toggle('active', t === tab));
    const target = picker.querySelector(`.ep-cat[data-cat="${tab.dataset.cat}"]`);
    if (target && scroll) scroll.scrollTo({ top: target.offsetTop - 6, behavior: 'smooth' });
  }));
  if (search) search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    cats.forEach(cat => {
      const labelMatch = cat.querySelector('.ep-cat-label').textContent.toLowerCase().includes(q);
      let any = false;
      cat.querySelectorAll('.ep-emoji').forEach(b => {
        const match = !q || labelMatch || b.dataset.e.includes(q);
        b.style.display = match ? '' : 'none';
        if (match) any = true;
      });
      cat.style.display = any ? '' : 'none';
    });
  });
}

function openReactionPickerAt(x, y, mid) {
  closePopovers();
  const picker = document.createElement('div');
  picker.className = 'emoji-picker';
  picker.id = 'reaction-picker';
  picker.dataset.title = 'Add Reaction';
  picker.style.position = 'fixed';
  picker.style.top = Math.max(8, Math.min(y, window.innerHeight - 440)) + 'px';
  picker.style.left = Math.max(8, Math.min(x, window.innerWidth - 372)) + 'px';
  document.body.appendChild(picker);
  mountEmojiPicker(picker, (e) => { toggleReaction(mid, e); picker.remove(); });
}

function openEmojiPickerForInput() {
  closePopovers();
  const rect = $('emoji-btn').getBoundingClientRect();
  const picker = document.createElement('div');
  picker.className = 'emoji-picker';
  picker.id = 'input-emoji-picker';
  picker.dataset.title = 'Emoji';
  picker.style.position = 'fixed';
  picker.style.top = Math.max(8, rect.top - 440) + 'px';
  picker.style.left = Math.max(8, rect.left - 320) + 'px';
  document.body.appendChild(picker);
  mountEmojiPicker(picker, (e) => {
    const ta = $('message-input');
    ta.value += e; ta.focus(); autoGrow(ta);
  });
}

function closePopovers() {
  document.querySelectorAll('.emoji-picker, .context-menu, .dropdown-menu, .notif-panel, .pins-panel').forEach(el => el.remove());
  closeMiniProfile();
  closeCustomSelects();
  closeMentionPop();
}

async function deleteMessage(mid, instant) {
  if (!instant) {
    const ok = await confirmDialog({ title: 'Delete Message', body: 'Are you sure you want to delete this message? This cannot be undone.', confirmText: 'Delete', danger: true });
    if (!ok) return;
  }
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
    items.push({ label: 'Edit Message', icon: 'pencil', onClick: () => editMessage(m) });
    items.push({ label: 'Delete Message', icon: 'trash', danger: true, onClick: () => deleteMessage(m.id) });
  }
  showContextMenu(x, y, items);
}

/* Refresh an existing message node in place after it is edited. */
function updateMessageNode(m) {
  const node = document.querySelector(`[data-mid="${m.id}"]`);
  if (!node) return;
  const body = node.querySelector('.text-body');
  if (body && m.decrypt_failed) {
    body.innerHTML = icon('lock') + ' Unable to decrypt this message';
    body.className = 'text-body msg-undecryptable';
  } else if (body) {
    body.innerHTML = formatContent(m.content);
    /* Recompute the jumbo-emoji treatment after an edit. */
    const onlyEmoji = isEmojiOnly(m.content || '');
    const cnt = onlyEmoji ? emojiCount(m.content || '') : 0;
    body.className = 'text-body' + (onlyEmoji ? (cnt <= 3 ? ' jumbo' : (cnt <= 6 ? ' jumbo lg' : '')) : '');
  }
  const text = node.querySelector('.text');
  if (!text) return;
  let ed = text.querySelector('.msg-edited');
  if (m.edited_at) {
    if (!ed) { ed = document.createElement('span'); ed.className = 'msg-edited'; text.appendChild(ed); }
    ed.textContent = '(edited)';
    ed.title = 'Edited ' + formatTime(m.edited_at);
  } else if (ed) {
    ed.remove();
  }
}

/* Inline editor for your own messages. */
function editMessage(m) {
  const node = document.querySelector(`[data-mid="${m.id}"]`);
  if (!node) return;
  const textEl = node.querySelector('.text');
  if (!textEl || node.querySelector('.msg-edit-box')) return;
  textEl.style.display = 'none';
  const box = document.createElement('div');
  box.className = 'msg-edit-box';
  box.innerHTML = `<textarea class="msg-edit-input" rows="1"></textarea>
    <div class="msg-edit-actions">
      <span class="msg-edit-hint">Esc to cancel · Enter to save</span>
      <button class="btn secondary msg-edit-cancel">Cancel</button>
      <button class="btn msg-edit-save">Save</button>
    </div>`;
  textEl.after(box);
  const ta = box.querySelector('.msg-edit-input');
  ta.value = m.content || '';
  const autoGrow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(220, ta.scrollHeight) + 'px'; };
  autoGrow();
  ta.focus();
  try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) {}
  ta.addEventListener('input', autoGrow);
  const cancel = () => { box.remove(); textEl.style.display = ''; };
  const save = async () => {
    const val = ta.value.trim();
    if (!val) { toast('Message cannot be empty', 'error'); return; }
    if (val === (m.content || '').trim()) { cancel(); return; }
    try {
      const enc = await e2eEncrypt(val, e2eRecipients());
      const body = { content: enc.content };
      if (enc.encrypted) { body.mentions = e2eMentionIds(val); body.broadcast = e2eBroadcast(val); }
      const { message } = await api('/api/messages/' + m.id, { method: 'PATCH', body: JSON.stringify(body) });
      await e2eDecryptMessage(message);
      const idx = state.messages.findIndex(x => x.id === m.id);
      if (idx >= 0) state.messages[idx] = message;
      m.content = message.content; m.edited_at = message.edited_at;
      box.remove(); textEl.style.display = '';
      updateMessageNode(message);
    } catch (e) { toast(e.message, 'error'); }
  };
  box.querySelector('.msg-edit-cancel').addEventListener('click', cancel);
  box.querySelector('.msg-edit-save').addEventListener('click', save);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
  });
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
    const { notifications, unread } = await api('/api/notifications', { retries: 3 });
    state.notifications = notifications || [];
    /* Notification payloads can carry an encrypted message preview. */
    for (const n of state.notifications) {
      if (n.data && n.data.message) await e2eDecryptMessage(n.data.message);
    }
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
  else if (n.type === 'everyone') { ico = 'megaphone'; plain = `${name} pinged @everyone ${where}`; html = `<b>${escapeHtml(name)}</b> pinged <b>@everyone</b> ${escapeHtml(where)}`; }
  else if (n.type === 'here') { ico = 'megaphone'; plain = `${name} pinged @here ${where}`; html = `<b>${escapeHtml(name)}</b> pinged <b>@here</b> ${escapeHtml(where)}`; }
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
  /* Viewing a notification clears its red badge immediately. */
  if (d.channel_id) clearChannelUnread(d.channel_id);
  if (d.dm_id) clearDmUnread(d.dm_id);
  n.read = true;
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
   SEARCH
   ============================================================ */
let searchTimer = null;
let searchScope = 'all'; /* 'all' | 'server' | 'channel' | 'dm' */

function openSearch() {
  const existing = $('search-overlay');
  if (existing) { existing.remove(); return; }
  closePopovers();
  searchScope = 'all';
  const overlay = document.createElement('div');
  overlay.className = 'search-overlay';
  overlay.id = 'search-overlay';
  overlay.innerHTML = `
    <div class="search-panel" role="dialog" aria-label="Search">
      <div class="search-bar">
        <span class="search-ico">${icon('search')}</span>
        <input id="search-input" type="text" placeholder="Search messages\u2026" autocomplete="off" spellcheck="false">
        <button class="search-clear hidden" id="search-clear" title="Clear">${icon('xmark')}</button>
        <button class="search-esc" id="search-esc" title="Close (Esc)">Esc</button>
      </div>
      <div class="search-scopes" id="search-scopes"></div>
      <div class="search-results" id="search-results"></div>
    </div>`;
  document.body.appendChild(overlay);
  hydrateIcons(overlay);

  const input = $('search-input');
  input.focus();
  input.addEventListener('input', () => {
    $('search-clear').classList.toggle('hidden', !input.value);
    clearTimeout(searchTimer);
    const v = input.value.trim();
    if (!v) { renderSearchHint(); return; }
    searchTimer = setTimeout(() => runSearch(v), 220);
  });
  $('search-clear').addEventListener('click', () => {
    input.value = ''; $('search-clear').classList.add('hidden'); input.focus(); renderSearchHint();
  });
  $('search-esc').addEventListener('click', closeSearch);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeSearch(); });
  document.addEventListener('keydown', searchKeyHandler);
  renderSearchScopes();
  renderSearchHint();
}

function closeSearch() {
  const el = $('search-overlay'); if (el) el.remove();
  document.removeEventListener('keydown', searchKeyHandler);
  clearTimeout(searchTimer);
}

function searchKeyHandler(e) {
  if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
}

function renderSearchScopes() {
  const box = $('search-scopes');
  if (!box) return;
  const scopes = [{ id: 'all', label: 'All', icon: 'search' }];
  if (state.server) scopes.push({ id: 'server', label: state.server.name, icon: 'server' });
  if (state.channel) scopes.push({ id: 'channel', label: '#' + state.channel.name, icon: 'hash' });
  if (state.dm) scopes.push({ id: 'dm', label: '@' + state.dm.user.username, icon: 'at-sign' });
  if (!scopes.some(s => s.id === searchScope)) searchScope = 'all';
  box.innerHTML = scopes.map(s =>
    `<button class="search-scope${searchScope === s.id ? ' active' : ''}" data-scope="${s.id}">${icon(s.icon)}<span>${escapeHtml(s.label)}</span></button>`
  ).join('');
  hydrateIcons(box);
  box.querySelectorAll('.search-scope').forEach(b => b.addEventListener('click', () => {
    searchScope = b.dataset.scope;
    renderSearchScopes();
    const v = $('search-input').value.trim();
    if (v) runSearch(v); else renderSearchHint();
  }));
}

function renderSearchHint() {
  const box = $('search-results');
  if (!box) return;
  box.innerHTML = `<div class="search-hint"><div class="sh-ico">${icon('search')}</div>Search across your servers and direct messages.<br><span>Start typing to see results.</span></div>`;
  hydrateIcons(box);
}

async function runSearch(q) {
  const box = $('search-results');
  if (!box) return;
  box.innerHTML = `<div class="search-loading">${icon('search')}<span>Searching\u2026</span></div>`;
  hydrateIcons(box);
  const params = new URLSearchParams({ q });
  if (searchScope === 'server' && state.server) params.set('server_id', state.server.id);
  else if (searchScope === 'channel' && state.channel) params.set('channel_id', state.channel.id);
  else if (searchScope === 'dm' && state.dm) params.set('dm_id', state.dm.id);
  try {
    const { results } = await api('/api/search?' + params.toString());
    await e2eDecryptAll(results || []);
    renderSearchResults(results || [], q);
  } catch (e) {
    box.innerHTML = `<div class="search-empty">${escapeHtml(e.message)}</div>`;
  }
}

function renderSearchResults(hits, q) {
  const box = $('search-results');
  if (!box) return;
  if (!hits.length) {
    box.innerHTML = `<div class="search-empty"><div class="sh-ico">${icon('search')}</div>No results for \u201c${escapeHtml(q)}\u201d.<br><span>Try a different search term or scope.</span></div>`;
    hydrateIcons(box);
    return;
  }
  const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
  const hl = (s) => escapeHtml(s || '').replace(re, '<mark>$1</mark>');
  box.innerHTML = `<div class="search-count">${hits.length} result${hits.length === 1 ? '' : 's'}</div>` + hits.map(m => {
    const a = m.author || {};
    const name = escapeHtml(a.display_name || a.username || 'Unknown');
    const ctx = m.context || {};
    let where, wicon;
    if (ctx.kind === 'dm') {
      const u = ctx.user || {};
      where = '@' + escapeHtml(u.username || 'direct message');
      wicon = icon('at-sign');
    } else {
      where = (ctx.server_name ? escapeHtml(ctx.server_name) + ' \u203a ' : '') + '#' + escapeHtml(ctx.channel_name || '');
      wicon = icon('hash');
    }
    const body = m.content ? hl(m.content) : (m.attachment_name ? `<span class="sr-attach">${escapeHtml(m.attachment_name)}</span>` : '<em>(no text)</em>');
    return `<div class="search-hit" data-mid="${m.id}" data-kind="${ctx.kind || ''}" data-server="${ctx.server_id || ''}" data-channel="${ctx.channel_id || ''}" data-dm="${ctx.dm_id || ''}">
      <div class="sr-ava">${avatarHTML(a, 36, a.status || 'offline')}</div>
      <div class="sr-body">
        <div class="sr-head"><span class="sr-author">${name}</span><span class="sr-where">${wicon}${where}</span><span class="sr-time">${formatTime(m.created_at)}</span></div>
        <div class="sr-text">${body}</div>
      </div>
    </div>`;
  }).join('');
  hydrateIcons(box);
  box.querySelectorAll('.search-hit').forEach(el => el.addEventListener('click', () => jumpToSearchResult(el.dataset)));
}

async function jumpToSearchResult(ds) {
  closeSearch();
  try {
    if (ds.kind === 'channel' && ds.server) {
      if (!state.server || state.server.id !== ds.server) await openServer(ds.server);
      await openChannel(ds.channel);
    } else if (ds.kind === 'dm' && ds.dm) {
      await loadDMs();
      let dm = state.dms.find(x => x.id === ds.dm);
      if (!dm) { await loadDMs(); dm = state.dms.find(x => x.id === ds.dm); }
      if (dm) await openDM(dm);
    }
    setTimeout(() => flashMessage(ds.mid), 400);
  } catch (e) { toast(e.message, 'error'); }
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
    await e2eDecryptAll(pins);
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
let modalAnimTimer = null;
function openModal(html, opts = {}) {
  clearTimeout(modalAnimTimer);
  const overlay = $('modal-overlay');
  const modal = $('modal');
  modal.className = opts.modalClass ? opts.modalClass : ('modal' + (opts.wide ? ' wide' : ''));
  modal.innerHTML = html;
  overlay.classList.remove('hidden', 'closing');
  modal.classList.remove('closing');
  /* Restart the entrance animation every time the dialog opens. */
  modal.classList.remove('modal-in');
  void modal.offsetWidth;
  modal.classList.add('modal-in');
  hydrateIcons(modal);
}
function closeModal() {
  modalCloseGuard = null;
  const overlay = $('modal-overlay');
  const modal = $('modal');
  const clearVars = () => ['--accent','--accent-ink','--accent-ink-2','--accent-edge','--accent-shade'].forEach(v => modal.style.removeProperty(v));
  if (overlay.classList.contains('hidden')) { modal.innerHTML = ''; modal.className = 'modal'; clearVars(); return; }
  overlay.classList.add('closing');
  modal.classList.remove('modal-in');
  modal.classList.add('closing');
  clearTimeout(modalAnimTimer);
  modalAnimTimer = setTimeout(() => {
    overlay.classList.add('hidden');
    overlay.classList.remove('closing');
    modal.classList.remove('closing');
    modal.innerHTML = '';
    modal.className = 'modal';
    clearVars();
  }, 170);
}

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
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
function isAnimatedImage(file) {
  if (!file) return false;
  return /gif/i.test(file.type || '') || /\.gif$/i.test(file.name || '') ||
         /webp/i.test(file.type || '') || /\.webp$/i.test(file.name || '');
}
async function uploadImage(file, filename) {
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Image is too large (maximum 50 MB)');
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
  const isGif = isAnimatedImage(file);

  /* Animated GIF/WebP must NOT go through the canvas cropper: drawing a frame
     to a canvas flattens it into a static PNG. Upload the original file so the
     animation survives, and tell the user why there is no crop step. */
  if (isGif) {
    if (file.size > MAX_IMAGE_BYTES) {
      toast('That GIF is too large (maximum 50 MB)', 'error');
      return;
    }
    toast('Animated ' + (isBanner ? 'banner' : 'avatar') + ' \u2014 animation preserved', 'success');
    Promise.resolve(opts.onSave(file, file.name || (isBanner ? 'banner.gif' : 'avatar.gif')))
      .catch((err) => toast(err.message || 'Upload failed', 'error'));
    return;
  }

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
  const templates = [
    { id: 'friends', label: 'Friends', icon: 'users', desc: 'A place for me and my friends to hang out.' },
    { id: 'community', label: 'Community', icon: 'globe', desc: 'A community space to share ideas and chat.' },
    { id: 'study', label: 'Study Group', icon: 'note', desc: 'A focused space for studying and sharing resources.' },
    { id: 'gaming', label: 'Gaming', icon: 'play', desc: 'Game nights, clips and squad talk.' }
  ];
  openModal(`
    <div class="cs-head">
      <div>
        <h3>Create a Server</h3>
        <p class="msub">Your server is a private space for you and your people. Set it up now — you can change everything later.</p>
      </div>
    </div>
    <div class="cs-grid">
      <div class="cs-preview">
        <div class="cs-preview-label">Live Preview</div>
        <div class="cs-preview-card">
          <div class="cs-preview-ico" id="cs-preview-ico"></div>
          <div class="cs-preview-meta">
            <div class="cs-preview-name" id="cs-preview-name">Your Server</div>
            <div class="cs-preview-sub" id="cs-preview-sub">Private · Invite only</div>
          </div>
        </div>
        <div class="cs-preview-desc empty" id="cs-preview-desc">Add a short description so people know what this space is for.</div>
        <div class="cs-preview-note">New servers are private. Share an invite link to let people in.</div>
      </div>
      <div class="cs-fields">
        <div class="cs-section-title">Basics</div>
        <div class="field"><label>Server Name <span class="req">*</span></label>
          <input id="cs-name" placeholder="e.g. Pixel Lounge, Study Group, Game Night…" maxlength="40">
          <div class="hint">This is how the server appears in the sidebar.</div></div>
        <div class="field"><label>Description <span class="opt">(optional)</span></label>
          <textarea id="cs-desc" rows="3" maxlength="500" placeholder="What is this server about? Who is it for?"></textarea></div>
        <div class="cs-section-title">Style</div>
        <div class="field"><label>Server Type</label>
          <div class="cs-types" id="cs-types">${templates.map((t, i) => `<button type="button" class="cs-type${i === 0 ? ' sel' : ''}" data-id="${t.id}">${t.label}</button>`).join('')}</div>
          <div class="hint" id="cs-type-hint">${escapeHtml(templates[0].desc)}</div></div>
        <div class="field"><label>Server Icon <span class="opt">(optional)</span></label>
          ${dropzoneHTML('cs-icon-dz', 'Upload Image', 'PNG, JPG or GIF — up to 25 MB')}
          <input type="file" id="cs-icon-file" accept="image/*" class="hidden"></div>
      </div>
    </div>
    <div class="modal-actions cs-actions">
      <span class="cs-foot-hint">Only people you invite can join.</span>
      <div style="flex:1"></div>
      <button class="btn secondary" id="cs-cancel">Cancel</button>
      <button class="btn" id="cs-create">Create Server</button>
    </div>`, { modalClass: 'modal create-server-modal' });
  let iconUrl = null;
  const nameInput = $('cs-name');
  const descInput = $('cs-desc');
  const previewName = $('cs-preview-name');
  const previewIco = $('cs-preview-ico');
  const previewSub = $('cs-preview-sub');
  const previewDesc = $('cs-preview-desc');
  const typeHint = $('cs-type-hint');
  let selectedType = templates[0].label;
  const syncPreview = () => {
    previewName.textContent = nameInput.value.trim() || 'Your Server';
    previewIco.innerHTML = iconUrl ? `<img src="${escapeHtml(iconUrl)}" alt="">` : '';
    if (previewSub) previewSub.textContent = selectedType + ' · Private';
    const d = descInput.value.trim();
    if (previewDesc) {
      previewDesc.textContent = d || 'Add a short description so people know what this space is for.';
      previewDesc.classList.toggle('empty', !d);
    }
  };
  nameInput.addEventListener('input', syncPreview);
  $('cs-types').querySelectorAll('.cs-type').forEach(btn => btn.addEventListener('click', () => {
    $('cs-types').querySelectorAll('.cs-type').forEach(b => b.classList.toggle('sel', b === btn));
    const t = templates.find(x => x.id === btn.dataset.id);
    if (t) {
      selectedType = t.label;
      if (typeHint) typeHint.textContent = t.desc;
      if (!descInput.value.trim() || descInput.dataset.auto === '1') { descInput.value = t.desc; descInput.dataset.auto = '1'; }
    }
    syncPreview();
  }));
  descInput.addEventListener('input', () => { descInput.dataset.auto = '0'; syncPreview(); });
  const dz = $('cs-icon-dz');
  wireDropzone(dz, $('cs-icon-file'), async (f) => {
    try { const d = await uploadImage(f); iconUrl = d.url; dzSetPreview(dz, d.url, () => { iconUrl = null; syncPreview(); }); syncPreview(); }
    catch (err) { toast(err.message, 'error'); }
  });
  $('cs-cancel').addEventListener('click', closeModal);
  $('cs-create').addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) { toast('Server name required', 'error'); nameInput.focus(); return; }
    const description = descInput.value.trim();
    try {
      const { server } = await api('/api/servers', { method: 'POST', body: JSON.stringify({ name, icon_url: iconUrl, description }) });
      closeModal(); await loadServers(); openServer(server.id);
      toast('Server created', 'success');
    } catch (e) { toast(e.message, 'error'); }
  });
  syncPreview();
  nameInput.focus();
}

function openJoinServer(prefill) {
  openModal(`
    <div class="js-head">
      <h3>Join a Server</h3>
      <p class="msub">Paste an invite below to hop straight into an existing community.</p>
    </div>
    <div class="field">
      <label>Invite Code or Link</label>
      <input id="js-invite" placeholder="gg/AbC123xYz or a full invite link" value="${escapeHtml(prefill || '')}">
      <div class="hint">Invites look like <b>gg/AbC123xYz</b>. Ask a member of the server to share one with you.</div>
    </div>
    <div class="js-details">
      <div class="js-detail">
        <div class="js-detail-txt"><strong>Jump right in</strong><p>You will land in the server's text and voice channels instantly.</p></div>
      </div>
      <div class="js-detail">
        <div class="js-detail-txt"><strong>Meet the community</strong><p>See members, roles and conversations as they happen in real time.</p></div>
      </div>
      <div class="js-detail">
        <div class="js-detail-txt"><strong>Come and go freely</strong><p>You can leave a server at any time from its settings.</p></div>
      </div>
    </div>
    <p class="js-alt">No invite yet? <a id="js-create" role="button" tabindex="0">Create your own server</a> instead.</p>
    <div class="modal-actions">
      <button class="btn secondary" id="js-cancel">Cancel</button>
      <button class="btn" id="js-join">Join Server</button>
    </div>`, { modalClass: 'join-modal' });
  hydrateIcons($('modal'));
  $('js-cancel').addEventListener('click', closeModal);
  const jsCreate = $('js-create');
  if (jsCreate) jsCreate.addEventListener('click', () => { closeModal(); openCreateServer(); });
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

function openCreateChannel(type, categoryId) {
  const cats = (state.categories || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
  const catOpts = `<option value="">No category</option>` +
    cats.map(k => `<option value="${k.id}"${categoryId === k.id ? ' selected' : ''}>${escapeHtml(k.name)}</option>`).join('');
  openModal(`
    <h3>Create ${type === 'voice' ? 'Voice' : 'Text'} Channel</h3>
    <p class="msub">in ${escapeHtml(state.server ? state.server.name : '')}</p>
    <div class="field"><label>Channel Name <span class="req">*</span></label>
      <input id="cc-name" placeholder="${type === 'voice' ? 'e.g. Lounge, Game Night\u2026' : 'e.g. general-chat, announcements\u2026'}" maxlength="40"></div>
    <div class="field"><label>Topic (optional)</label>
      <input id="cc-topic" placeholder="Give this channel a short purpose or topic\u2026"></div>
    ${cats.length ? `<div class="field"><label>Category</label>
      <select id="cc-cat">${catOpts}</select></div>` : ''}
    <div class="modal-actions">
      <button class="btn secondary" id="cc-cancel">Cancel</button>
      <button class="btn" id="cc-create">Create Channel</button>
    </div>`);
  $('cc-cancel').addEventListener('click', closeModal);
  $('cc-create').addEventListener('click', async () => {
    const name = $('cc-name').value.trim().toLowerCase().replace(/\s+/g, '-');
    const topic = $('cc-topic').value.trim();
    const catId = $('cc-cat') ? ($('cc-cat').value || null) : (categoryId || null);
    if (!name) { toast('Channel name required', 'error'); return; }
    try {
      await api('/api/servers/' + state.server.id + '/channels', { method: 'POST', body: JSON.stringify({ name, type, topic, category_id: catId }) });
      closeModal();
      const data = await api('/api/servers/' + state.server.id);
      state.channels = data.channels; state.categories = data.categories || state.categories; renderChannelList();
      const created = data.channels.find(c => c.name === name && c.type === type);
      if (created && type === 'text') openChannel(created.id);
      toast('Channel created', 'success');
    } catch (e) { toast(e.message, 'error'); }
  });
  $('cc-name').focus();
}

/* ---------- Category management (owner / admins) ---------- */
async function createCategory() {
  const name = await promptDialog({ title: 'Create Category', body: 'Group related channels under a collapsible header.', label: 'Category name', value: '', confirmText: 'Create Category', maxlength: 40, placeholder: 'e.g. Text Channels, Voice, Staff' });
  if (name === null) return;
  const clean = name.trim();
  if (!clean) { toast('Category name cannot be empty', 'error'); return; }
  try {
    const r = await api('/api/servers/' + state.server.id + '/categories', { method: 'POST', body: JSON.stringify({ name: clean }) });
    if (r && r.category) {
      /* The socket broadcast may already have delivered this category, so
         only append when it is genuinely new (avoids duplicates). */
      const exists = (state.categories || []).some(k => k.id === r.category.id);
      if (!exists) state.categories = (state.categories || []).concat([r.category]);
      renderChannelList();
    }
    toast('Category created', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

async function renameCategory(cat) {
  const name = await promptDialog({ title: 'Rename Category', label: 'Category name', value: cat.name, confirmText: 'Rename', maxlength: 40 });
  if (name === null) return;
  const clean = name.trim();
  if (!clean) { toast('Category name cannot be empty', 'error'); return; }
  try {
    const r = await api('/api/servers/' + state.server.id + '/categories/' + cat.id, { method: 'PATCH', body: JSON.stringify({ name: clean }) });
    const fresh = (r && r.category) || Object.assign({}, cat, { name: clean });
    state.categories = (state.categories || []).map(k => k.id === cat.id ? fresh : k);
    renderChannelList();
    toast('Category renamed', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteCategory(cat) {
  const count = state.channels.filter(c => c.category_id === cat.id).length;
  const ok = await confirmDialog({ title: 'Delete Category', body: `Delete <b>${escapeHtml(cat.name)}</b>? ${count ? `Its ${count} channel${count === 1 ? '' : 's'} will move to the top of the list and stay intact.` : 'This category is empty.'}`, confirmText: 'Delete Category', danger: true });
  if (!ok) return;
  try {
    await api('/api/servers/' + state.server.id + '/categories/' + cat.id, { method: 'DELETE' });
    state.categories = (state.categories || []).filter(k => k.id !== cat.id);
    state.channels = (state.channels || []).map(c => c.category_id === cat.id ? Object.assign({}, c, { category_id: null }) : c);
    delete state.collapsedCats[cat.id];
    renderChannelList();
    toast('Category deleted', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

function openCategoryContextMenu(x, y, catId) {
  const cat = (state.categories || []).find(k => k.id === catId);
  if (!cat) return;
  const items = [];
  if (amIAdmin()) {
    items.push({ label: 'Create Channel Here', icon: 'plus', onClick: () => openCreateChannel('text', cat.id) });
    items.push({ sep: true });
    items.push({ label: 'Move Up', icon: 'chevron-up', onClick: () => moveCategoryBy(cat, -1) });
    items.push({ label: 'Move Down', icon: 'chevron-down', onClick: () => moveCategoryBy(cat, 1) });
    items.push({ sep: true });
    items.push({ label: 'Rename Category', icon: 'pencil', onClick: () => renameCategory(cat) });
    items.push({ label: 'Delete Category', icon: 'trash', danger: true, onClick: () => deleteCategory(cat) });
  } else {
    items.push({ label: cat.name, icon: 'folder', onClick: () => {} });
  }
  showContextMenu(x, y, items);
}

/* ---------- Full channel editor (owner / admins) ---------- */
function openEditChannel(c) {
  if (!amIAdmin()) return;
  const cats = (state.categories || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
  const catOpts = `<option value="">No category</option>` +
    cats.map(k => `<option value="${k.id}"${(c.category_id || '') === k.id ? ' selected' : ''}>${escapeHtml(k.name)}</option>`).join('');
  const slow = c.slow_mode || 0;
  const isVoice = c.type === 'voice';
  const toggleRow = (id, checked, title, desc) => `
    <label class="ec-toggle" for="${id}">
      <span class="ec-toggle-text"><span class="ec-toggle-title">${title}</span><span class="ec-toggle-desc">${desc}</span></span>
      <span class="re-switch"><input type="checkbox" id="${id}"${checked ? ' checked' : ''}><span class="re-switch-track"></span></span>
    </label>`;
  const slowPresets = [[0, 'Off'], [5, '5 seconds'], [10, '10 seconds'], [30, '30 seconds'], [60, '1 minute'], [300, '5 minutes'], [600, '10 minutes'], [3600, '1 hour'], [21600, '6 hours']];
  const hasPreset = slowPresets.some(([v]) => v === slow);
  const slowOpts = slowPresets.map(([v, l]) => `<option value="${v}"${slow === v ? ' selected' : ''}>${l}</option>`).join('') +
    (hasPreset ? '' : `<option value="${slow}" selected>${slow} seconds (custom)</option>`);
  openModal(`
    <div class="ec-head">
      <div class="ec-head-icon">${icon(isVoice ? 'volume-high' : 'hash')}</div>
      <div><h3>Edit Channel</h3><p class="msub">#${escapeHtml(c.name)} \u00b7 ${isVoice ? 'Voice' : 'Text'} channel</p></div>
    </div>
    <div class="ec-grid">
      <div class="ec-col">
        <div class="ec-section-title">General</div>
        <div class="field"><label>Channel Name <span class="req">*</span></label>
          <input id="ec-name" value="${escapeHtml(c.name)}" maxlength="40"></div>
        <div class="field"><label>Topic</label>
          <input id="ec-topic" value="${escapeHtml(c.topic || '')}" placeholder="What is this channel about?" maxlength="200"></div>
        <div class="field"><label>Category</label>
          <select id="ec-cat">${catOpts}</select></div>
        ${isVoice ? '' : `<div class="field"><label>Slow Mode</label>
          <select id="ec-slow">${slowOpts}</select>
          <div class="hint">Members must wait this long between messages. Staff are exempt.</div></div>`}
      </div>
      <div class="ec-col">
        <div class="ec-section-title">${isVoice ? 'Voice Settings' : 'Permissions & Access'}</div>
        ${isVoice ? `
          <div class="field"><label>User Limit</label>
            <input id="ec-userlimit" type="number" min="0" max="99" value="${c.user_limit || 0}">
            <div class="hint">0 = unlimited. Maximum people who can join at once.</div></div>
          <div class="field"><label>Bitrate (kbps)</label>
            <input id="ec-bitrate" type="number" min="8" max="384" value="${c.bitrate || 64}">
            <div class="hint">Higher is clearer audio but uses more bandwidth.</div></div>
          <div class="ec-toggles">${toggleRow('ec-nsfw', !!c.nsfw, 'Age-restricted channel', 'Marks the channel as NSFW. Members see a warning before joining.')}</div>
        ` : `
          <div class="ec-toggles">
            ${toggleRow('ec-readonly', !!c.read_only, 'Lock channel', 'Members can read this channel but cannot send messages. Staff can still post.')}
            ${toggleRow('ec-nsfw', !!c.nsfw, 'Age-restricted channel', 'Marks the channel as NSFW. Members see a warning before opening it.')}
          </div>
        `}
        <div class="ec-idbox">
          <div><div class="ec-idlabel">Channel ID</div><code class="ec-idval">${escapeHtml(c.id)}</code></div>
          <button class="btn secondary ec-copyid" id="ec-copyid">${icon('copy')} Copy</button>
        </div>
        <div class="ec-reorder">
          <span class="ec-reorder-label">Position</span>
          <button class="btn secondary" id="ec-up">${icon('chevron-up')} Move up</button>
          <button class="btn secondary" id="ec-down">${icon('chevron-down')} Move down</button>
        </div>
      </div>
    </div>
    <div class="modal-actions ec-actions">
      <button class="btn danger ghost" id="ec-delete">${icon('trash')} Delete Channel</button>
      <span style="flex:1"></span>
      <button class="btn secondary" id="ec-cancel">Cancel</button>
      <button class="btn" id="ec-save">${icon('check')} Save Changes</button>
    </div>`, { modalClass: 'modal channel-edit-modal' });
  $('ec-cancel').addEventListener('click', closeModal);
  $('ec-copyid').addEventListener('click', () => copyToClipboard(c.id, 'Channel ID'));
  $('ec-delete').addEventListener('click', () => { closeModal(); deleteChannel(c); });
  $('ec-up').addEventListener('click', async () => { await moveChannelBy(c, -1); closeModal(); });
  $('ec-down').addEventListener('click', async () => { await moveChannelBy(c, 1); closeModal(); });
  $('ec-save').addEventListener('click', async () => {
    const name = $('ec-name').value.trim().toLowerCase().replace(/\s+/g, '-');
    if (!name) { toast('Channel name required', 'error'); return; }
    const payload = {
      name,
      topic: $('ec-topic').value.trim(),
      category_id: $('ec-cat').value || null,
      read_only: !!($('ec-readonly') && $('ec-readonly').checked),
      nsfw: !!($('ec-nsfw') && $('ec-nsfw').checked)
    };
    if (isVoice) {
      payload.user_limit = Math.max(0, Math.min(99, parseInt($('ec-userlimit').value, 10) || 0));
      payload.bitrate = Math.max(8, Math.min(384, parseInt($('ec-bitrate').value, 10) || 64));
    } else {
      payload.slow_mode = Math.max(0, Math.min(21600, parseInt($('ec-slow').value, 10) || 0));
    }
    try {
      await api('/api/servers/' + state.server.id + '/channels/' + c.id, { method: 'PATCH', body: JSON.stringify(payload) });
      closeModal();
      toast('Channel updated', 'success');
    } catch (e) { toast(e.message, 'error'); }
  });
  $('ec-name').focus();
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

  /* Cache the caller's own server roles so a later refreshOpenProfile() rebuild
     (triggered by a status update) keeps the role pills on the profile. */
  if (isMe && Array.isArray(user.server_roles)) me.server_roles = user.server_roles;

  if (isMe) return renderOwnProfile(user);
  return renderOtherProfile(user, { relationship, mutualServers, mutualFriends, note });
}

/* ---------- Your own profile ---------- */
function renderOwnProfile(user) {
  const displayName = user.display_name || user.username;
  const bannerColor = user.banner_color || user.accent_color || '#5865F2';
  const bannerStyle = user.banner_url
    ? `background-image:url('${escapeHtml(user.banner_url)}');background-color:${escapeHtml(bannerColor)};background-size:cover;background-position:center`
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
              <div class="n2">${escapeHtml(fullTag(user))}${badgeChips(user)}</div>
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
          <div class="pic-name">${escapeHtml(displayName)}${badgeChips(user)}</div>
          <div class="pic-tag">${escapeHtml(fullTag(user))}</div>
          ${serverRolePills(user)}
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
          <p class="bio-md">${user.bio ? formatBio(user.bio) : 'You have not written a description yet.'}</p>
        </div>
      </div>
    </div>`, { modalClass: 'profile-modal' });

  const _pm = $('modal'); applyAccent(_pm, user.accent_color);
  $('pf-x').addEventListener('click', closeModal);
  $('pf-edit').addEventListener('click', () => openSettings('account'));
  $('pf-banner').addEventListener('click', () => openSettings('account'));
  $('pf-avatar').addEventListener('click', () => openSettings('account'));
  makeCopyable(document.querySelector('.profile-content .pic-name'), displayName, 'Display name');
  makeCopyable(document.querySelector('.profile-content .pic-tag'), fullTag(user), 'Username');
  makeCopyable(document.querySelector('.pnav-text .n1'), displayName, 'Display name');
  makeCopyable(document.querySelector('.pnav-text .n2'), fullTag(user), 'Username');
  document.querySelectorAll('#pf-swatches .pnav-swatch').forEach(sw => {
    sw.addEventListener('click', async () => {
      const color = sw.dataset.color;
      document.querySelectorAll('#pf-swatches .pnav-swatch').forEach(x => x.classList.toggle('sel', x === sw));
      const hero = document.querySelector('.profile-hero');
      if (hero) { hero.style.backgroundImage = 'none'; hero.style.background = color; }
      try {
        const { user: updated } = await api('/api/me', { method: 'PATCH', body: JSON.stringify({ banner_color: color, banner_url: null }) });
        me = updated; localStorage.setItem('cr_user', JSON.stringify(me)); renderMe();
        user.banner_color = color; user.banner_url = null;
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

  /* Discord tints the banner with the profile's accent colour. `banner_color`
     defaults to blurple for every account, so preferring it here meant the
     accent never showed - only honour it when it was deliberately changed. */
  const accent = user.accent_color || '#5865F2';
  const customBanner = user.banner_color && String(user.banner_color).toLowerCase() !== '#5865f2'
    ? user.banner_color : null;
  const tint = customBanner || accent;
  const bannerStyle = user.banner_url
    ? `background-image:url('${escapeHtml(user.banner_url)}');background-color:${escapeHtml(tint)};background-size:cover;background-position:center`
    : `background:linear-gradient(180deg, ${escapeHtml(tint)} 0%, color-mix(in srgb, ${escapeHtml(tint)} 70%, #000) 100%)`;

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

  const mutualServersHTML = mutualServers.length ? `
    <div class="dp-section">
      <div class="dp-mutual-label">Mutual Servers \u2014 ${mutualServers.length}</div>
      <div class="dp-mutual">${mutualServers.slice(0, 8).map(sv => `
        <div class="dp-server-ico" data-srv="${escapeHtml(sv.id)}" title="${escapeHtml(sv.name || '')}">${sv.icon_url ? `<img src="${escapeHtml(sv.icon_url)}" alt="">` : escapeHtml((sv.name || '?')[0].toUpperCase())}</div>`).join('')}</div>
    </div>` : '';

  const mutualFriendsHTML = mutualFriends.length ? `
    <div class="dp-section">
      <div class="dp-mutual-label">Mutual Friends \u2014 ${mutualFriends.length}</div>
      ${mutualFriends.slice(0, 4).map(u => `<div class="dp-friend-row" data-uid="${escapeHtml(u.id)}">${avatarHTML(u, 24, u.status || 'offline')}<div><div class="dp-friend-name">${escapeHtml(u.display_name || u.username)}</div><div class="dp-friend-tag">${escapeHtml(fullTag(u))}</div></div></div>`).join('')}
    </div>` : '';

  openModal(`
    <div class="oprofile-banner" style="${bannerStyle}"></div>
    <div class="dp-body">
      <div class="dp-head">
        <div class="dp-avatar">${avatarHTML(user, 104, user.status || 'offline')}</div>
        <div class="dp-identity">
          <div class="dp-name">${escapeHtml(displayName)}${badgeChips(user)}</div>
          <div class="dp-handle">${escapeHtml(fullTag(user))}${user.pronouns ? ` <span class="dp-pronoun">\u00b7 ${escapeHtml(user.pronouns)}</span>` : ''}</div>
          ${serverRolePills(user)}
          ${user.custom_status ? `<div class="dp-custom">${escapeHtml(user.custom_status)}</div>` : ''}
        </div>
        <div class="dp-actions">
          <button class="dp-btn primary" id="pf-dm">${icon('comment')} <span>Message</span></button>
          ${addBtn.replace('op-add', 'dp-btn')}
          <button class="dp-more" id="pf-more-2" title="More Options">${icon('ellipsis-vertical')}</button>
        </div>
      </div>
      <div class="dp-scroll">
      <div class="dp-divider"></div>
      <div class="dp-grid">
        <div class="dp-col">
          <div class="dp-section">
            <div class="dp-label">Member Since</div>
            <div class="dp-value">${accountCreated}</div>
          </div>
          ${user.bio ? `<div class="dp-section">
            <div class="dp-label">About Me</div>
            <div class="dp-bio">${formatBio(user.bio)}</div>
          </div>` : ''}
          <div class="dp-section">
            <div class="dp-label">Note</div>
            <div class="dp-note" id="pf-note">
              ${note ? `<div class="dp-note-text">${escapeHtml(note)}</div>` : `<div class="dp-note-empty">${icon('plus')} Click to add a note</div>`}
              <div class="dp-note-hint">Note only visible to you</div>
            </div>
          </div>
        </div>
        <div class="dp-col">
          ${mutualServersHTML || `<div class="dp-section"><div class="dp-label">Mutual Servers</div><div class="dp-value dp-dim">No servers in common</div></div>`}
          ${mutualFriendsHTML || `<div class="dp-section"><div class="dp-label">Mutual Friends</div><div class="dp-value dp-dim">No friends in common</div></div>`}
        </div>
      </div>
      </div>
    </div>`, { modalClass: 'oprofile-modal' });

  applyAccent($('modal'), accent);

  makeCopyable(document.querySelector('.dp-name'), displayName, 'Display name');
  makeCopyable(document.querySelector('.dp-handle'), fullTag(user), 'Username');

  document.querySelectorAll('.dp-server-ico').forEach(el => el.addEventListener('click', () => {
    closeModal();
    openServer(el.dataset.srv);
  }));
  document.querySelectorAll('.dp-friend-row').forEach(el => el.addEventListener('click', () => {
    const u = mutualFriends.find(x => String(x.id) === el.dataset.uid);
    if (u) { closeModal(); openProfile(u); }
  }));

  /* The top-right 3-dots and close button were removed from this popout; the
     overlay click / Escape still close it, and "More Options" lives in the
     action row. Guard the handlers so nothing breaks. */
  const pfX = $('pf-x');
  if (pfX) pfX.addEventListener('click', closeModal);
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
  const openMoreMenu = (e) => {
    e.stopPropagation();
    dropdownMenu(e.currentTarget || $('pf-more'), moreItems.map(it => Object.assign({}, it, {
      onClick: async () => {
        if (it.action === 'dm') { closeModal(); startDM(user.id); return; }
        await friendAction(it.action, user.id);
        closeModal(); openProfile(user);
      }
    })));
  };
  const pfMore = $('pf-more');
  if (pfMore) pfMore.addEventListener('click', openMoreMenu);
  const more2 = $('pf-more-2');
  if (more2) more2.addEventListener('click', openMoreMenu);
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
  { id: 'apps', label: 'Authorized Devices' },
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
let settingsSection = 'account';
/* Settings chosen in this session that have not been written to the server yet.
   Toggles, theme cards and selects stage their value here instead of PATCHing
   immediately, so the Discard / Save Changes controls actually mean something. */
let settingsPending = {};
let settingsSnapshot = {};

/* Central place that flips the dirty flag and keeps the footer buttons in sync. */
function setSettingsDirty(v) {
  settingsDirty = !!v;
  const discard = $('set-discard');
  const save = $('set-done');
  const note = $('set-dirty-note');
  if (discard) discard.disabled = !settingsDirty;
  if (save) save.disabled = !settingsDirty;
  if (note) note.hidden = !settingsDirty;
}

/* Stage a preference change. The value is applied to the live UI right away so
   the user sees the effect, but it is only written to the server when they hit
   Save Changes. Discard restores the snapshot taken when settings opened. */
function stageSetting(key, value) {
  settingsPending[key] = value;
  state.settings[key] = value;
  mirrorSettingsLocal();
  applyTheme();
  setSettingsDirty(true);
}

/* Write every staged preference to the server in one request. */
async function flushSettings() {
  const keys = Object.keys(settingsPending);
  if (!keys.length) return true;
  const patch = {};
  for (const k of keys) patch[k] = settingsPending[k];
  try {
    await api('/api/settings', { method: 'PATCH', body: JSON.stringify(patch) });
  } catch (e) {
    toast(e.message, 'error');
    return false;
  }
  if (patch.notifDesktop && typeof Notification !== 'undefined' && Notification.permission === 'default') {
    try { Notification.requestPermission(); } catch (e) { /* ignore */ }
  }
  settingsPending = {};
  return true;
}

function openSettings(section) {
  const u = me;
  settingsDirty = false;
  settingsSaveFn = null;
  settingsSection = section || 'account';
  settingsPending = {};
  settingsSnapshot = JSON.parse(JSON.stringify(state.settings || {}));
  const nav = SETTINGS_NAV.map(item => {
    if (item.cat) return `<div class="sn-cat">${t(item.cat)}</div>`;
    return `<div class="sn-item" data-sec="${item.id}">${t(item.label)} <span class="chev">${icon('chevron-right')}</span></div>`;
  }).join('') + (isPlatformAdmin()
    ? `<div class="sn-item sn-admin" data-sec="admin">Admin Panel <span class="adm-staff-pill">STAFF</span> <span class="chev">${icon('chevron-right')}</span></div>`
    : '');

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
      <span class="settings-dirty-note" id="set-dirty-note" hidden>Unsaved changes</span>
      <button class="btn secondary" id="set-discard" disabled>${t('Discard')}</button>
      <button class="btn" id="set-done" disabled>${t('Save Changes')}</button>
    </div>`, { modalClass: 'settings-modal' });

  /* Discard throws away every unsaved edit: uploads are reset to what is
     stored on the server, staged preferences roll back to the snapshot taken
     when settings opened, and the panel is rebuilt from the saved profile. */
  const discardChanges = () => {
    settingsUploads = { avatar_url: me.avatar_url || null, banner_url: me.banner_url || null };
    settingsPending = {};
    state.settings = JSON.parse(JSON.stringify(settingsSnapshot || {}));
    mirrorSettingsLocal();
    applyTheme();
    setSettingsDirty(false);
    previewSelf();
    renderSettings(settingsSection);
  };
  const discardThen = (after) => {
    discardChanges();
    if (after) after(); else closeModal();
  };
  const saveThen = async (after) => {
    const ok = settingsSaveFn ? await settingsSaveFn() : true;
    if (ok) {
      const ok2 = await flushSettings();
      if (!ok2) return false;
      setSettingsDirty(false);
      if (after) after(); else closeModal();
    }
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
    if (!settingsDirty) { closeModal(); return; }
    const ok = settingsSaveFn ? await settingsSaveFn() : true;
    if (!ok) return;
    const ok2 = await flushSettings();
    if (!ok2) return;
    setSettingsDirty(false);
    toast('Settings saved', 'success');
    closeModal();
  });
  $('set-discard').addEventListener('click', () => {
    if (!settingsDirty) return;
    discardChanges();
    toast('Changes discarded');
  });
  $('set-logout').addEventListener('click', guardLogout);
  document.querySelectorAll('#settings-nav .sn-item[data-sec]').forEach(el => {
    el.addEventListener('click', () => {
      const sec = el.dataset.sec;
      if (sec === settingsSection) return;
      if (settingsDirty) {
        showUnsavedDialog({
          onSave: () => saveThen(() => renderSettings(sec)),
          onDiscard: () => discardThen(() => renderSettings(sec))
        });
      } else {
        renderSettings(sec);
      }
    });
  });
  renderSettings(section || 'account');
}

function renderSettings(section) {
  settingsSection = section;
  /* The Admin Panel lives in its own full-width modal, so hand off cleanly. */
  if (section === 'admin') { closeModal(); setTimeout(() => openAdminPanel('dashboard'), 60); return; }
  /* Each panel owns its own save routine (or none, when it only stages
     preferences). Reset it so a previous panel's saver can never fire against
     DOM that is no longer on screen. */
  settingsSaveFn = null;
  document.querySelectorAll('#settings-nav .sn-item[data-sec]').forEach(el => el.classList.toggle('active', el.dataset.sec === section));
  const panel = $('settings-panel');
  panel.innerHTML = settingsPanelHTML(section);
  replayAnim(panel, 'anim-in');
  hydrateIcons(panel);
  if (section === 'account') wireAccountPanel();
  if (section === 'profiles') wireProfilesPanel();
  if (section === 'privacy') { wirePrivacyPanel(); wireTwoFactor(); }
  if (section === 'apps') wireDevicesPanel();
  if (section === 'privacy' || section === 'appearance' || section === 'notifications' || section === 'voice') wireToggles();
  if (section === 'appearance') wireAppearance();
  if (section === 'voice') wireVoicePanel();
  if (section === 'language') wireLanguage();
}

/* Authorized Devices: list every session (device) signed in to this account and
   let the user revoke any of them. Data comes from /api/sessions. */
async function wireDevicesPanel() {
  const listEl = $('dev-list');
  if (!listEl) return;
  const deviceIcon = (kind) => kind === 'Mobile' ? 'mobile' : (kind === 'Tablet' ? 'tablet' : 'monitor');
  const fmt = (ts) => {
    if (!ts) return 'Unknown';
    const d = new Date(ts);
    return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) + ' \u00b7 ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  const render = (sessions) => {
    if (!sessions.length) { listEl.innerHTML = '<div class="dev-loading">No active devices.</div>'; return; }
    listEl.innerHTML = sessions.map(s => `
      <div class="dev-row${s.current ? ' current' : ''}">
        <div class="dev-ico">${icon(deviceIcon(s.kind))}</div>
        <div class="dev-info">
          <div class="dev-name">${escapeHtml(s.label)}${s.current ? '<span class="dev-badge">This device</span>' : ''}</div>
          <div class="dev-meta">${escapeHtml(s.os)} \u00b7 ${escapeHtml(s.browser)}${s.ip ? ' \u00b7 ' + escapeHtml(s.ip) : ''}</div>
          <div class="dev-meta">Last active ${fmt(s.last_seen_at)} \u00b7 Signed in ${fmt(s.created_at)}</div>
        </div>
        <div class="dev-actions">
          ${s.current
            ? '<span class="dev-current-tag">Active</span>'
            : `<button class="ss-icon-btn ban" data-revoke="${s.id}" title="Sign out this device">${icon('xmark')}</button>`}
        </div>
      </div>`).join('');
    hydrateIcons(listEl);
    listEl.querySelectorAll('[data-revoke]').forEach(b => b.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Sign out device', body: 'This device will be signed out immediately and will need to sign in again.', confirmText: 'Sign out', danger: true });
      if (!ok) return;
      try {
        await api('/api/sessions/' + b.dataset.revoke, { method: 'DELETE' });
        toast('Device signed out', 'success');
        load();
      } catch (e) { toast(e.message, 'error'); }
    }));
  };
  const load = async () => {
    try {
      const { sessions } = await api('/api/sessions');
      render(sessions || []);
    } catch (e) { listEl.innerHTML = '<div class="dev-loading">' + escapeHtml(e.message) + '</div>'; }
  };
  const revokeOthers = $('dev-revoke-others');
  if (revokeOthers) revokeOthers.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Sign out other devices', body: 'Every other device will be signed out. This device stays signed in.', confirmText: 'Sign out others', danger: true });
    if (!ok) return;
    try {
      const r = await api('/api/sessions/revoke-others', { method: 'POST' });
      toast(r.revoked ? `Signed out ${r.revoked} device(s)` : 'No other devices to sign out', 'success');
      load();
    } catch (e) { toast(e.message, 'error'); }
  });
  load();
}

/* Two-step login: enable/disable + live rotating code display. */
async function wireTwoFactor() {
  const body = $('twofa-body');
  const statusEl = $('twofa-status');
  if (!body) return;
  let enabled = false;
  let codeTimer = null;
  let setupSecret = null;

  const stopTimer = () => { if (codeTimer) { clearInterval(codeTimer); codeTimer = null; } };

  const showEnabled = (codeInfo) => {
    statusEl.textContent = 'On';
    statusEl.className = 'twofa-status on';
    body.innerHTML = `
      <div class="twofa-code-box">
        <div class="twofa-code-label">Current sign-in code</div>
        <div class="twofa-code" id="twofa-code">${codeInfo ? codeInfo.code : '\u2022\u2022\u2022\u2022\u2022\u2022'}</div>
        <div class="twofa-code-hint">Refreshes in <span id="twofa-secs">${codeInfo ? codeInfo.seconds : 30}</span>s \u00b7 use this code on any device when signing in</div>
      </div>
      <div class="twofa-actions">
        <button class="btn secondary" id="twofa-reset">Reset code</button>
        <button class="btn secondary" id="twofa-disable">Turn off two-step login</button>
      </div>
      <div class="twofa-trust-note">Signed in with a trusted device? You can trust this browser for 30 days the next time you enter a code at sign-in.</div>`;
    const refresh = async () => {
      try {
        const c = await api('/api/2fa/code');
        const codeEl = $('twofa-code'); const secsEl = $('twofa-secs');
        if (codeEl) codeEl.textContent = c.code;
        if (secsEl) secsEl.textContent = String(c.seconds);
      } catch (e) { /* ignore */ }
    };
    stopTimer();
    refresh();
    codeTimer = setInterval(refresh, 5000);
    $('twofa-reset').addEventListener('click', async () => {
      const pw = await twoFactorResetDialog();
      if (pw == null) return;
      try {
        const d = await api('/api/2fa/reset', { method: 'POST', body: JSON.stringify({ password: pw }) });
        stopTimer();
        showSetup(d);
        toast('Old code invalidated \u2014 new two-step code generated', 'success');
      } catch (e) { toast(e.message, 'error'); }
    });
    $('twofa-disable').addEventListener('click', async () => {
      const pw = await promptDialog({ title: 'Turn off two-step login', body: 'Enter your password to confirm.', input: 'password', placeholder: 'Password', confirmText: 'Turn off' });
      if (pw == null) return;
      try {
        await api('/api/2fa/disable', { method: 'POST', body: JSON.stringify({ password: pw }) });
        toast('Two-step login turned off', 'success');
        stopTimer();
        render();
      } catch (e) { toast(e.message, 'error'); }
    });
  };

  const showDisabled = () => {
    statusEl.textContent = 'Off';
    statusEl.className = 'twofa-status';
    body.innerHTML = `
      <p class="twofa-desc">Two-step login is currently off. Turn it on to require a rotating 6-digit code at sign-in.</p>
      <div class="twofa-actions">
        <button class="btn" id="twofa-start">Set up two-step login</button>
        <button class="btn secondary" id="twofa-reset-off">Reset two-step code</button>
      </div>`;
    $('twofa-start').addEventListener('click', async () => {
      const pw = await promptDialog({ title: 'Set up two-step login', body: 'Enter your password to begin.', input: 'password', placeholder: 'Password', confirmText: 'Continue' });
      if (pw == null) return;
      try {
        const d = await api('/api/2fa/setup', { method: 'POST', body: JSON.stringify({ password: pw }) });
        setupSecret = d.secret;
        showSetup(d);
      } catch (e) { toast(e.message, 'error'); }
    });
    /* The custom reset dialog is available even when two-step is off, so the
       "Reset your two-step code?" UI is always reachable. */
    $('twofa-reset-off').addEventListener('click', async () => {
      const pw = await twoFactorResetDialog();
      if (pw == null) return;
      try {
        const d = await api('/api/2fa/reset', { method: 'POST', body: JSON.stringify({ password: pw }) });
        stopTimer();
        showSetup(d);
        toast('Old code invalidated \u2014 new two-step code generated', 'success');
      } catch (e) { toast(e.message, 'error'); }
    });
  };

  const showSetup = (d) => {
    statusEl.textContent = 'Setup';
    statusEl.className = 'twofa-status';
    body.innerHTML = `
      <p class="twofa-desc">Add this secret to your authenticator app, or simply use the live code below. Then enter the current 6-digit code to finish.</p>
      <div class="twofa-secret"><span class="twofa-secret-label">Secret</span><code id="twofa-secret">${escapeHtml(d.secret)}</code></div>
      <div class="twofa-code-box small">
        <div class="twofa-code-label">Current code</div>
        <div class="twofa-code" id="twofa-code">${d.code}</div>
        <div class="twofa-code-hint">Refreshes in <span id="twofa-secs">${d.seconds}</span>s</div>
      </div>
      <div class="field"><label>Enter the 6-digit code</label>
        <input id="twofa-input" inputmode="numeric" maxlength="6" placeholder="000000" autocomplete="one-time-code"></div>
      <div class="twofa-actions">
        <button class="btn secondary" id="twofa-cancel">Cancel</button>
        <button class="btn" id="twofa-confirm">Enable two-step login</button>
      </div>`;
    const refresh = async () => {
      try {
        const c = await api('/api/2fa/code');
        const codeEl = $('twofa-code'); const secsEl = $('twofa-secs');
        if (codeEl) codeEl.textContent = c.code;
        if (secsEl) secsEl.textContent = String(c.seconds);
      } catch (e) { /* ignore */ }
    };
    stopTimer();
    codeTimer = setInterval(refresh, 5000);
    $('twofa-cancel').addEventListener('click', () => { stopTimer(); render(); });
    $('twofa-confirm').addEventListener('click', async () => {
      const code = ($('twofa-input').value || '').trim();
      if (!/^\d{6}$/.test(code)) { toast('Enter the 6-digit code', 'error'); return; }
      try {
        await api('/api/2fa/enable', { method: 'POST', body: JSON.stringify({ code }) });
        toast('Two-step login enabled', 'success');
        stopTimer();
        render();
      } catch (e) { toast(e.message, 'error'); }
    });
  };

  const render = async () => {
    try {
      const s = await api('/api/2fa/status');
      enabled = !!s.enabled;
      if (enabled) {
        let info = null;
        try { info = await api('/api/2fa/code'); } catch (e) { /* ignore */ }
        showEnabled(info);
      } else {
        showDisabled();
      }
    } catch (e) {
      body.innerHTML = '<div class="dev-loading">' + escapeHtml(e.message) + '</div>';
    }
  };
  render();
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
    case 'account': {
      const accent = u.accent_color || '#5865F2';
      const bannerColor = u.banner_color || '#5865F2';
      return `
        <h4>My Account</h4>
        <div class="acct-stack">

          <section class="acct-card">
            <div class="acct-card-head">
              <div><h5>Profile Picture</h5><p class="acct-card-sub">This is shown next to your name everywhere on Crossroads.</p></div>
            </div>
            <div class="settings-avatar-row">
              <div id="sa-avatar">${avatarHTML(u, 80, u.status || 'online')}</div>
              <div class="sa-actions">
                <button id="sa-upload">Change Avatar</button>
                <button class="ghost" id="sa-remove">Remove Avatar</button>
                <input type="file" id="sa-file" accept="image/*" class="hidden">
              </div>
            </div>
          </section>

          <section class="acct-card">
            <div class="acct-card-head">
              <div><h5>Identity</h5><p class="acct-card-sub">How you appear across the app.</p></div>
            </div>
            <div class="field"><label>Username</label>
              <input id="set-username" maxlength="32" value="${escapeHtml(u.username)}" autocomplete="off">
              <div class="hint" id="username-hint">Your unique tag is #${escapeHtml(u.discriminator)}</div>
            </div>
            <div class="field"><label>Display Name</label><input id="set-display" maxlength="32" value="${escapeHtml(u.display_name || u.username)}"></div>
            <div class="field"><label>Pronouns</label><input id="set-pronouns" maxlength="24" value="${escapeHtml(u.pronouns || '')}" placeholder="e.g. she/her, he/him, they/them"></div>
            <div class="field"><label>Custom Status</label><input id="set-custom" maxlength="128" value="${escapeHtml(u.custom_status || '')}" placeholder="What are you up to right now?"></div>
          </section>

          <section class="acct-card">
            <div class="acct-card-head">
              <div><h5>About Me</h5><p class="acct-card-sub">Paste a link or a server invite (gg/code) and it becomes clickable on your profile.</p></div>
            </div>
            <div class="field">
              <textarea id="set-bio" maxlength="190" placeholder="Share a little about yourself — your hobbies, interests, or a link to your favourite place…">${escapeHtml(u.bio || '')}</textarea>
              <div class="hint">Links like https://example.com or gg/AbC123 are turned into blue links automatically.</div>
            </div>
          </section>

          <section class="acct-card">
            <div class="acct-card-head">
              <div><h5>Profile Banner</h5><p class="acct-card-sub">Pick a colour or upload an image (GIF supported, up to 25 MB).</p></div>
            </div>
            <div class="banner-editor" id="banner-editor" style="${u.banner_url ? `background-image:url('${escapeHtml(u.banner_url)}')` : `background:${escapeHtml(bannerColor)}`}">
              <button class="banner-edit-btn" id="set-banner-file-btn">${icon('image')} Upload Banner</button>
            </div>
            <input type="file" id="set-banner-file" accept="image/*" class="hidden">
            <div class="color-row" id="banner-color-row" style="margin-top:12px">${PALETTE.map(c => `<span class="swatch${bannerColor.toLowerCase() === c.toLowerCase() ? ' sel' : ''}" data-color="${c}" style="background:${c}"></span>`).join('')}</div>
          </section>

          <section class="acct-card">
            <div class="acct-card-head">
              <div><h5>Accent Color</h5><p class="acct-card-sub">Tints your entire profile — banner, card background and highlights.</p></div>
            </div>
            <div class="color-row" id="accent-row">${ACCENT_PALETTE.map(c => `<span class="swatch${accent.toLowerCase() === c.toLowerCase() ? ' sel' : ''}" data-color="${c}" style="background:${c}"></span>`).join('')}</div>
            <div class="cc-row">
              <label class="cc-label" for="accent-custom">Custom colour</label>
              <span class="cc-picker">
                <input type="color" id="accent-custom" value="${escapeHtml(accent)}" aria-label="Custom accent colour">
                <span class="cc-hex" id="accent-custom-hex">${escapeHtml(accent.toUpperCase())}</span>
              </span>
            </div>
            <div class="cw" id="accent-wheel">
              <div class="cw-wheel"><div class="cw-cursor"></div></div>
              <div class="cw-side">
                <div class="cw-preview" style="background:${escapeHtml(accent)}"></div>
                <label class="cw-field"><span>Brightness</span><input type="range" class="cw-light-range" min="0" max="100" value="${Math.round(hexToHsl(accent).l)}"></label>
                <label class="cw-field"><span>Hex code</span><input type="text" class="cw-hex-input" maxlength="7" value="${escapeHtml(accent.toUpperCase())}" placeholder="#5865F2"></label>
              </div>
            </div>
            <div class="accent-preview" id="accent-preview">
              <div class="ap-hero"></div>
              <div class="ap-row">
                <div class="ap-avatar">${avatarHTML(u, 46, u.status || 'online')}</div>
                <div class="ap-meta">
                  <div class="ap-name">${escapeHtml(u.display_name || u.username)}</div>
                  <div class="ap-tag">${escapeHtml(fullTag(u))}</div>
                </div>
                <div class="ap-btn">Edit Profile</div>
              </div>
            </div>
          </section>

          <section class="acct-card">
            <div class="acct-card-head">
              <div><h5>Status</h5><p class="acct-card-sub">Let people know whether you are around.</p></div>
            </div>
            <div class="field"><label>Presence</label>
              <select id="set-status">
                <option value="online">Online</option>
                <option value="idle">Idle</option>
                <option value="dnd">Do Not Disturb</option>
                <option value="offline">Invisible</option>
              </select></div>
          </section>

        </div>`;
    }
    case 'profiles': {
      const pBanner = u.banner_url ? `background-image:url('${escapeHtml(u.banner_url)}');background-color:${escapeHtml(u.banner_color || '#5865F2')};background-size:cover;background-position:center` : `background:${escapeHtml(u.banner_color || '#5865F2')}`;
      const pAccent = u.accent_color || '#5865F2';
      const pSince = new Date(u.created_at || Date.now()).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
      const pBadges = (u.badges || []).length;
      return `
        <h4>Profiles</h4>
        <p style="color:var(--text-muted);font-size:14px;margin-bottom:18px;line-height:1.5">Design how you appear across Crossroads. Changes preview live and save with the button below.</p>
        <div class="prof-revamp">
          <div class="prof-preview-card" id="prof-preview-card">
            <div class="prof-preview-banner" id="prof-preview-banner" style="${pBanner}"></div>
            <div class="prof-preview-body">
              <div class="prof-preview-avatar" id="prof-preview-avatar">${avatarHTML(u, 76, u.status || 'online')}</div>
              <div class="prof-preview-name" id="prof-preview-name">${escapeHtml(u.display_name || u.username)}</div>
              <div class="prof-preview-tag" id="prof-preview-tag">${escapeHtml(fullTag(u))}</div>
              <div class="prof-preview-status" id="prof-preview-status">${escapeHtml(u.custom_status || '')}</div>
              <div class="prof-preview-bio" id="prof-preview-bio">${escapeHtml(u.bio || 'No bio yet.')}</div>
            </div>
          </div>
          <div class="prof-fields">
            <section class="acct-card">
              <div class="acct-card-head"><div><h5>Identity</h5><p class="acct-card-sub">Your public name and details.</p></div></div>
              <div class="field"><label>Display Name</label><input id="prof-display" maxlength="32" value="${escapeHtml(u.display_name || '')}" placeholder="${escapeHtml(u.username)}"></div>
              <div class="field"><label>Pronouns</label><input id="prof-pronouns" maxlength="40" value="${escapeHtml(u.pronouns || '')}" placeholder="e.g. they/them"></div>
              <div class="field"><label>Custom Status</label><input id="prof-custom" maxlength="128" value="${escapeHtml(u.custom_status || '')}" placeholder="What are you up to?"></div>
              <div class="field"><label>About Me</label><textarea id="prof-bio" maxlength="190" rows="3" placeholder="Tell people a little about yourself\u2026">${escapeHtml(u.bio || '')}</textarea><div class="hint"><span id="prof-bio-count">${(u.bio || '').length}</span>/190</div></div>
            </section>
            <section class="acct-card">
              <div class="acct-card-head"><div><h5>Banner</h5><p class="acct-card-sub">Upload an image or pick a solid colour.</p></div></div>
              <div class="prof-banner-preview" id="prof-banner-preview" style="${pBanner}">
                <div class="prof-banner-btns">
                  <button class="btn secondary" id="prof-banner-upload">${icon('image')} Upload</button>
                  <button class="btn secondary" id="prof-banner-remove">${icon('trash')} Remove</button>
                </div>
              </div>
              <input type="file" id="prof-banner-file" accept="image/*,image/gif" class="hidden">
              <div class="color-row" id="prof-banner-row" style="margin-top:12px">${PALETTE.map(c => `<span class="swatch${(u.banner_color || '#5865F2').toLowerCase() === c.toLowerCase() ? ' sel' : ''}" data-color="${c}" style="background:${c}"></span>`).join('')}</div>
            </section>
            <section class="acct-card">
              <div class="acct-card-head"><div><h5>Accent Color</h5><p class="acct-card-sub">Tints your profile card and highlights.</p></div></div>
              <div class="color-row" id="prof-accent-row">${ACCENT_PALETTE.map(c => `<span class="swatch${pAccent.toLowerCase() === c.toLowerCase() ? ' sel' : ''}" data-color="${c}" style="background:${c}"></span>`).join('')}</div>
              <div class="cc-row">
                <label class="cc-label" for="prof-accent-custom">Custom colour</label>
                <span class="cc-picker"><input type="color" id="prof-accent-custom" value="${escapeHtml(pAccent)}" aria-label="Custom accent colour"><span class="cc-hex" id="prof-accent-hex">${escapeHtml(pAccent.toUpperCase())}</span></span>
              </div>
            </section>
            <section class="acct-card">
              <div class="acct-card-head"><div><h5>Avatar</h5><p class="acct-card-sub">This is how you appear in chats and member lists.</p></div></div>
              <div class="prof-avatar-row">
                <div class="prof-avatar-big" id="prof-avatar-big">${avatarHTML(u, 80, u.status || 'online')}</div>
                <div class="prof-avatar-btns">
                  <button class="btn secondary" id="prof-avatar-upload">${icon('image')} Upload Avatar</button>
                  <button class="btn secondary" id="prof-avatar-remove">${icon('trash')} Remove</button>
                </div>
              </div>
              <input type="file" id="prof-avatar-file" accept="image/*" class="hidden">
            </section>
            <section class="acct-card">
              <div class="acct-card-head"><div><h5>Profile Details</h5><p class="acct-card-sub">Account information at a glance.</p></div></div>
              <div class="prof-detail-grid">
                <div class="prof-detail"><span>Username</span><b>${escapeHtml(fullTag(u))}</b></div>
                <div class="prof-detail"><span>User ID</span><b class="prof-copyable" id="prof-copy-id">${escapeHtml(u.id)}</b></div>
                <div class="prof-detail"><span>Member Since</span><b>${escapeHtml(pSince)}</b></div>
                <div class="prof-detail"><span>Badges</span><b>${pBadges}</b></div>
              </div>
            </section>
          </div>
        </div>`;
    }
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
        </div>
        <div class="pw-section twofa-section" id="twofa-section">
          <div class="pw-head">
            <div>
              <h5>Two-Step Login</h5>
              <p class="pw-sub">Add a second step to sign-in. When enabled, you will need a 6-digit code from your authenticator app (or the code shown below on a signed-in device) in addition to your password.</p>
            </div>
            <span class="twofa-status" id="twofa-status">Checking\u2026</span>
          </div>
          <div id="twofa-body"><div class="dev-loading">Loading\u2026</div></div>
        </div>`;
    case 'apps':
      return `
        <h4>Authorized Devices</h4>
        <p class="set-sub">These are the devices currently signed in to your account. If you see something you do not recognise, sign that device out and change your password.</p>
        <div class="dev-list" id="dev-list"><div class="dev-loading">Loading devices\u2026</div></div>
        <div class="ss-actions" style="margin-top:16px"><button class="btn secondary" id="dev-revoke-others">${icon('xmark')} Sign out all other devices</button></div>`;
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
        <div class="field cb-field">
          <label>Custom Background</label>
          <p class="cb-desc">Add a personal image or animated GIF behind the whole app. Stored only on this device — 1920×1080 (1080p) looks best.</p>
          <div class="cb-preview" id="cb-preview"><div class="cb-preview-img" id="cb-preview-img"></div><span class="cb-preview-empty">${icon('image')} No custom background</span></div>
          <div class="cb-row">
            <input id="cb-url" placeholder="Paste an image or GIF URL (https://…)" autocomplete="off" spellcheck="false">
            <button class="btn" id="cb-apply-url">Apply</button>
          </div>
          <div class="cb-actions">
            <button class="btn ghost" id="cb-upload">${icon('upload')} Upload image / GIF</button>
            <button class="btn ghost" id="cb-remove">${icon('trash')} Remove</button>
            <input type="file" id="cb-file" accept="image/*" class="hidden">
          </div>
          <div class="cb-controls" id="cb-controls">
            <div class="cb-ctl cb-ctl-wide">
              <div class="cb-ctl-head"><label for="cb-scale">Scale</label><span class="cb-val" id="cb-scale-val">100%</span></div>
              <div class="cb-zoom">
                <button class="cb-zoom-btn" id="cb-zoom-out" type="button" title="Zoom out" aria-label="Zoom out">${icon('minus')}</button>
                <input type="range" id="cb-scale" min="100" max="300" step="5" value="100" aria-label="Background scale">
                <button class="cb-zoom-btn" id="cb-zoom-in" type="button" title="Zoom in" aria-label="Zoom in">${icon('plus')}</button>
                <button class="cb-zoom-btn cb-fit-btn" id="cb-fit-toggle" type="button" title="Toggle fill / fit">Fill</button>
              </div>
            </div>
            <div class="cb-ctl">
              <div class="cb-ctl-head"><label for="cb-fit">Sizing</label></div>
              <select id="cb-fit" aria-label="Background sizing">
                <option value="cover">Fill (crop to fit)</option>
                <option value="contain">Fit (show all)</option>
                <option value="stretch">Stretch</option>
                <option value="tile">Tile</option>
              </select>
            </div>
            <div class="cb-ctl">
              <div class="cb-ctl-head"><label for="cb-opacity">Transparency</label><span class="cb-val" id="cb-opacity-val">0%</span></div>
              <input type="range" id="cb-opacity" min="0" max="90" step="5" value="0" aria-label="Background transparency">
            </div>
            <div class="cb-ctl">
              <div class="cb-ctl-head"><label for="cb-blur">Blur</label><span class="cb-val" id="cb-blur-val">0px</span></div>
              <input type="range" id="cb-blur" min="0" max="30" step="1" value="0" aria-label="Background blur">
            </div>
            <div class="cb-ctl">
              <div class="cb-ctl-head"><label for="cb-brightness">Brightness</label><span class="cb-val" id="cb-brightness-val">100%</span></div>
              <input type="range" id="cb-brightness" min="40" max="160" step="5" value="100" aria-label="Background brightness">
            </div>
            <div class="cb-ctl">
              <div class="cb-ctl-head"><label for="cb-x">Horizontal offset</label><span class="cb-val" id="cb-x-val">50%</span></div>
              <input type="range" id="cb-x" min="0" max="100" step="1" value="50" aria-label="Background horizontal offset">
            </div>
            <div class="cb-ctl">
              <div class="cb-ctl-head"><label for="cb-y">Vertical offset</label><span class="cb-val" id="cb-y-val">50%</span></div>
              <input type="range" id="cb-y" min="0" max="100" step="1" value="50" aria-label="Background vertical offset">
            </div>
            <div class="cb-quick">
              <button class="cb-quick-btn" data-cb-align="50,50" type="button">Center</button>
              <button class="cb-quick-btn" data-cb-align="50,0" type="button">Top</button>
              <button class="cb-quick-btn" data-cb-align="50,100" type="button">Bottom</button>
              <button class="cb-quick-btn" data-cb-align="0,50" type="button">Left</button>
              <button class="cb-quick-btn" data-cb-align="100,50" type="button">Right</button>
            </div>
            <button class="btn ghost cb-reset" id="cb-reset">${icon('refresh')} Reset adjustments</button>
          </div>
          <div class="cb-hint" id="cb-hint"></div>
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
        <h4>Voice & Video</h4>
        <div class="vs-grid">
          <div class="vs-block">
            <div class="vs-label">Input Device</div>
            <select id="vs-mic" class="vs-select"><option value="">Default microphone</option></select>
            <div class="vs-label">Input Volume <span class="vs-val" id="vs-vol-val">${Number(setting('inputVolume')) || 70}%</span></div>
            <input type="range" id="vs-vol" class="vs-range" min="0" max="200" step="1" value="${Number(setting('inputVolume')) || 70}">
            <div class="vs-meter" id="vs-meter"><div class="vs-meter-fill" id="vs-meter-fill"></div></div>
            <button class="btn ghost vs-btn" id="vs-test">${icon('mic')} Let's Check</button>
            <div class="vs-hint" id="vs-hint">Speak while testing to confirm your mic is working.</div>
          </div>
          <div class="vs-block">
            <div class="vs-label">Output Device</div>
            <select id="vs-spk" class="vs-select"><option value="">Default speakers</option></select>
            <div class="vs-label">Output Volume <span class="vs-val" id="vs-out-val">${Number(setting('outputVolume')) || 100}%</span></div>
            <input type="range" id="vs-out" class="vs-range" min="0" max="100" step="1" value="${Number(setting('outputVolume')) || 100}">
            <button class="btn ghost vs-btn" id="vs-test-out">${icon('volume-high')} Test Output</button>
            <div class="vs-hint" id="vs-out-hint">Plays a short tone on the selected speaker.</div>
          </div>
        </div>
        <div class="vs-section">
          ${toggleRow('echoCancel', 'Echo cancellation', 'Reduce echo picked up by your microphone.')}
          ${toggleRow('noiseSuppress', 'Noise suppression', 'Filter background noise during calls.')}
          ${toggleRow('autoGain', 'Automatic gain control', 'Keep your volume steady as you move around.')}
        </div>
        <div class="vs-section">
          ${toggleRow('voiceLowLatency', 'Low-latency audio', 'Prioritise speed over quality for voice chat.')}
        </div>`;
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
            ${LANGUAGES.map(([name]) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}
          </select></div>
        <p style="color:var(--text-muted);font-size:13px;line-height:1.5">Choose the language used across the interface. Some newer translations are still being completed and fall back to English where needed.</p>
        ${isPlatformAdmin() ? `
        <div class="admin-entry">
          <div class="admin-entry-ico">CR</div>
          <div class="admin-entry-txt">
            <div class="admin-entry-title">Admin Panel</div>
            <div class="admin-entry-sub">Platform-wide moderation, user management, announcements and system controls.</div>
          </div>
          <button class="btn admin-entry-btn" id="open-admin-panel">Open Admin Panel</button>
        </div>` : ''}`;
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

  const markDirty = () => setSettingsDirty(true);

  $('sa-upload').addEventListener('click', () => $('sa-file').click());
  $('sa-file').addEventListener('change', (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    openImageEditor(f, { kind: 'avatar', title: 'Adjust Avatar', onSave: async (blob, filename) => {
      try {
        const d = await uploadImage(blob, filename);
        settingsUploads.avatar_url = d.url;
        previewSelf({ avatar_url: d.url });
        markDirty();
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
      editor.style.background = bannerColor;
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
      } catch (err) { toast(err.message, 'error'); }
    } });
  });
  document.querySelectorAll('#banner-color-row .swatch').forEach(sw => sw.addEventListener('click', () => {
    bannerColor = sw.dataset.color;
    settingsUploads.banner_url = null;
    document.querySelectorAll('#banner-color-row .swatch').forEach(x => x.classList.toggle('sel', x === sw));
    paintBanner(); markDirty();
  }));

  let accent = u.accent_color || '#5865F2';
  const accentCustom = $('accent-custom');
  const accentCustomHex = $('accent-custom-hex');
  const accentPreview = $('accent-preview');
  const syncAccentControls = (hex) => {
    document.querySelectorAll('#accent-row .swatch').forEach(x => x.classList.toggle('sel', (x.dataset.color || '').toLowerCase() === hex.toLowerCase()));
    if (accentCustom && accentCustom.value.toLowerCase() !== hex.toLowerCase()) accentCustom.value = hex;
    if (accentCustomHex) accentCustomHex.textContent = hex.toUpperCase();
    applyAccent(accentPreview, hex);
  };
  const accentWheel = setupColorWheel($('accent-wheel'), accent, (hex) => {
    accent = hex;
    syncAccentControls(hex);
    previewSelf({ accent_color: hex });
    markDirty();
  });
  document.querySelectorAll('#accent-row .swatch').forEach(sw => sw.addEventListener('click', () => {
    accent = sw.dataset.color;
    document.querySelectorAll('#accent-row .swatch').forEach(x => x.classList.toggle('sel', x === sw));
    if (accentWheel) accentWheel.set(accent);
    syncAccentControls(accent);
    previewSelf({ accent_color: accent });
    markDirty();
  }));
  if (accentCustom) accentCustom.addEventListener('input', () => {
    accent = accentCustom.value;
    if (accentWheel) accentWheel.set(accent);
    syncAccentControls(accent);
    previewSelf({ accent_color: accent });
    markDirty();
  });
  syncAccentControls(accent);

  const unameInput = $('set-username');
  const hint = $('username-hint');
  let usernameOk = true;
  let t = null;
  /* 24-hour username-change cooldown. */
  const USERNAME_COOLDOWN_MS = 24 * 60 * 60 * 1000;
  const lastChange = Number(u.username_changed_at || 0);
  const cooldownLeft = lastChange ? Math.max(0, USERNAME_COOLDOWN_MS - (Date.now() - lastChange)) : 0;
  if (cooldownLeft > 0 && unameInput) {
    unameInput.disabled = true;
    unameInput.title = 'You can only change your username once every 24 hours.';
    const updateCooldownHint = () => {
      const left = Math.max(0, USERNAME_COOLDOWN_MS - (Date.now() - lastChange));
      if (left <= 0) { unameInput.disabled = false; unameInput.title = ''; hint.textContent = `Your unique tag is #${u.discriminator}`; hint.className = 'hint'; return; }
      const h = Math.floor(left / 3600000);
      const m = Math.floor((left % 3600000) / 60000);
      const s = Math.floor((left % 60000) / 1000);
      hint.textContent = `Username locked \u2014 you can change it again in ${h}h ${m}m ${s}s.`;
      hint.className = 'hint bad';
      setTimeout(updateCooldownHint, 1000);
    };
    updateCooldownHint();
  }
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
      myChosenStatus = me.status || myChosenStatus; userIsIdle = false; tabAwayOffline = false; resetIdleTimer();
      previewSelf();
      renderRail(); renderMembers();
      toast('Profile updated', 'success');
      return true;
    } catch (e) { toast(e.message, 'error'); return false; }
  };
  settingsSaveFn = doSave;
}

function wireProfilesPanel() {
  let bannerColor = me.banner_color || '#5865F2';
  let accent = me.accent_color || '#5865F2';
  let avatarUrl = me.avatar_url || null;
  let bannerUrl = me.banner_url || null;

  const previewCard = $('prof-preview-card');
  const previewBanner = $('prof-preview-banner');
  const bannerPreview = $('prof-banner-preview');

  const paintBanner = () => {
    [previewBanner, bannerPreview].forEach(el => {
      if (!el) return;
      if (bannerUrl) {
        el.style.backgroundImage = `url('${bannerUrl}')`;
        el.style.backgroundColor = bannerColor;
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
      } else {
        el.style.backgroundImage = 'none';
        el.style.background = bannerColor;
      }
    });
  };
  const paintAvatar = () => {
    const p = Object.assign({}, me, { avatar_url: avatarUrl });
    const big = $('prof-avatar-big'); if (big) big.innerHTML = avatarHTML(p, 80, me.status || 'online');
    const pv = $('prof-preview-avatar'); if (pv) pv.innerHTML = avatarHTML(p, 76, me.status || 'online');
  };
  const syncBannerSwatches = () => document.querySelectorAll('#prof-banner-row .swatch').forEach(x => x.classList.toggle('sel', (x.dataset.color || '').toLowerCase() === bannerColor.toLowerCase()));
  const syncAccentSwatches = () => {
    document.querySelectorAll('#prof-accent-row .swatch').forEach(x => x.classList.toggle('sel', (x.dataset.color || '').toLowerCase() === accent.toLowerCase()));
    const inp = $('prof-accent-custom'); if (inp && inp.value.toLowerCase() !== accent.toLowerCase()) inp.value = accent;
    const hex = $('prof-accent-hex'); if (hex) hex.textContent = accent.toUpperCase();
    applyAccent(previewCard, accent);
  };

  document.querySelectorAll('#prof-banner-row .swatch').forEach(sw => sw.addEventListener('click', () => {
    bannerColor = sw.dataset.color; bannerUrl = null; syncBannerSwatches(); paintBanner(); setSettingsDirty(true);
  }));
  document.querySelectorAll('#prof-accent-row .swatch').forEach(sw => sw.addEventListener('click', () => {
    accent = sw.dataset.color; syncAccentSwatches(); setSettingsDirty(true);
  }));
  const accentCustom = $('prof-accent-custom');
  if (accentCustom) accentCustom.addEventListener('input', () => { accent = accentCustom.value; syncAccentSwatches(); setSettingsDirty(true); });

  const bindUpload = (btnId, fileId, kind, onDone) => {
    const btn = $(btnId), file = $(fileId);
    if (!btn || !file) return;
    btn.addEventListener('click', () => file.click());
    file.addEventListener('change', (e) => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      openImageEditor(f, { kind, title: kind === 'avatar' ? 'Adjust Avatar' : 'Adjust Banner', onSave: async (blob, filename) => {
        try { const d = await uploadImage(blob, filename); onDone(d.url); setSettingsDirty(true); }
        catch (err) { toast(err.message, 'error'); }
      } });
    });
  };
  bindUpload('prof-avatar-upload', 'prof-avatar-file', 'avatar', (url) => { avatarUrl = url; paintAvatar(); });
  bindUpload('prof-banner-upload', 'prof-banner-file', 'banner', (url) => { bannerUrl = url; paintBanner(); });
  const avRm = $('prof-avatar-remove'); if (avRm) avRm.addEventListener('click', () => { avatarUrl = null; paintAvatar(); setSettingsDirty(true); });
  const bnRm = $('prof-banner-remove'); if (bnRm) bnRm.addEventListener('click', () => { bannerUrl = null; paintBanner(); setSettingsDirty(true); });

  const bindPreview = (id, fn) => { const el = $(id); if (el) el.addEventListener('input', () => { fn(el.value); setSettingsDirty(true); }); };
  bindPreview('prof-display', (v) => { const n = $('prof-preview-name'); if (n) n.textContent = v.trim() || me.username; });
  bindPreview('prof-custom', (v) => { const s = $('prof-preview-status'); if (s) s.textContent = v.trim(); });
  bindPreview('prof-bio', (v) => { const b = $('prof-preview-bio'); if (b) b.textContent = v.trim() || 'No bio yet.'; const c = $('prof-bio-count'); if (c) c.textContent = v.length; });
  const copyId = $('prof-copy-id'); if (copyId) makeCopyable(copyId, me.id, 'User ID');

  paintBanner(); paintAvatar(); syncBannerSwatches(); syncAccentSwatches();

  const doSave = async () => {
    try {
      const body = {
        display_name: ($('prof-display').value.trim() || null),
        pronouns: $('prof-pronouns').value.trim(),
        custom_status: $('prof-custom').value.trim(),
        bio: $('prof-bio').value.trim(),
        banner_color: bannerColor,
        accent_color: accent,
        avatar_url: avatarUrl,
        banner_url: bannerUrl
      };
      const { user } = await api('/api/me', { method: 'PATCH', body: JSON.stringify(body) });
      me = user; localStorage.setItem('cr_user', JSON.stringify(me));
      toast('Profile saved', 'success');
      return true;
    } catch (e) { toast(e.message, 'error'); return false; }
  };
  settingsSaveFn = doSave;
}

function wireToggles() {
  document.querySelectorAll('#settings-panel .toggle[data-toggle]').forEach(t => {
    t.addEventListener('click', () => {
      const key = t.dataset.toggle;
      const val = !t.classList.contains('on');
      t.classList.toggle('on', val);
      /* Stage the change instead of writing it straight away. The footer
         Discard / Save Changes controls now reflect that something changed. */
      stageSetting(key, val);
    });
  });
}

/* ============================================================
   VOICE & VIDEO SETTINGS
   ------------------------------------------------------------
   Real device enumeration, a live microphone level meter, an output test
   tone and settings that are actually applied to the call (constraints,
   gain, sink id). Everything is staged so Save Changes still works.
   ============================================================ */
let vsMeterRaf = 0;
let vsTestStream = null;
let vsTestCtx = null;

function stopMicTest() {
  if (vsMeterRaf) cancelAnimationFrame(vsMeterRaf);
  vsMeterRaf = 0;
  if (vsTestStream) { try { vsTestStream.getTracks().forEach(t => t.stop()); } catch (e) {} }
  vsTestStream = null;
  if (vsTestCtx) { try { vsTestCtx.close(); } catch (e) {} }
  vsTestCtx = null;
  const fill = $('vs-meter-fill');
  if (fill) fill.style.width = '0%';
  const btn = $('vs-test');
  if (btn) btn.classList.remove('testing');
}

async function refreshVoiceDevices() {
  const micSel = $('vs-mic');
  const spkSel = $('vs-spk');
  if (!micSel || !spkSel) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  let devices = [];
  try { devices = await navigator.mediaDevices.enumerateDevices(); } catch (e) { return; }
  const mics = devices.filter(d => d.kind === 'audioinput');
  const spks = devices.filter(d => d.kind === 'audiooutput');
  const curMic = setting('micDeviceId') || '';
  const curSpk = setting('speakerDeviceId') || '';
  micSel.innerHTML = `<option value="">Default microphone</option>` +
    mics.map((d, i) => `<option value="${escapeHtml(d.deviceId)}">${escapeHtml(d.label || ('Microphone ' + (i + 1)))}</option>`).join('');
  spkSel.innerHTML = `<option value="">Default speakers</option>` +
    spks.map((d, i) => `<option value="${escapeHtml(d.deviceId)}">${escapeHtml(d.label || ('Speaker ' + (i + 1)))}</option>`).join('');
  if (curMic && mics.some(d => d.deviceId === curMic)) micSel.value = curMic;
  if (curSpk && spks.some(d => d.deviceId === curSpk)) spkSel.value = curSpk;
  if (!spks.length) {
    spkSel.innerHTML = `<option value="">Default speakers</option>`;
    const hint = $('vs-out-hint');
    if (hint) hint.textContent = 'This browser cannot list output devices - the system default will be used.';
  }
}

async function startMicTest() {
  const btn = $('vs-test');
  const hint = $('vs-hint');
  const fill = $('vs-meter-fill');
  if (!fill) return;
  if (vsTestStream) { stopMicTest(); if (hint) hint.textContent = 'Test stopped.'; return; }
  try {
    const stream = await acquireMic();
    vsTestStream = stream;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    vsTestCtx = new Ctx();
    const src = vsTestCtx.createMediaStreamSource(stream);
    const an = vsTestCtx.createAnalyser();
    an.fftSize = 512;
    an.smoothingTimeConstant = 0.6;
    src.connect(an);
    const buf = new Uint8Array(an.frequencyBinCount);
    const vol = Number(setting('inputVolume'));
    const mult = isFinite(vol) ? Math.max(0, Math.min(2, vol / 100)) : 0.7;
    if (btn) btn.classList.add('testing');
    if (hint) hint.textContent = 'Listening\u2026 speak normally.';
    const tick = () => {
      if (!vsTestStream) return;
      an.getByteFrequencyData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i];
      const level = Math.min(100, Math.round((sum / buf.length) * 2.4 * mult));
      fill.style.width = level + '%';
      fill.classList.toggle('hot', level > 82);
      vsMeterRaf = requestAnimationFrame(tick);
    };
    tick();
    /* Auto-stop after 20s so we never hold the mic open silently. */
    setTimeout(() => { if (vsTestStream) { stopMicTest(); if (hint) hint.textContent = 'Test finished.'; } }, 20000);
  } catch (e) {
    if (hint) hint.textContent = (e && e.name === 'NotAllowedError')
      ? 'Microphone permission was blocked. Allow it in your browser and try again.'
      : 'Could not open the selected microphone.';
    stopMicTest();
  }
}

function playOutputTest() {
  const hint = $('vs-out-hint');
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    const ctx = new Ctx();
    const dest = ctx.createMediaStreamDestination();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const vol = Number(setting('outputVolume'));
    const amp = (isFinite(vol) ? Math.max(0, Math.min(100, vol)) : 100) / 100 * 0.18;
    osc.type = 'sine';
    osc.frequency.value = 660;
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(dest);
    /* Two short beeps, like Discord's output test. */
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(amp, t + 0.03);
    gain.gain.setValueAtTime(amp, t + 0.22);
    gain.gain.linearRampToValueAtTime(0, t + 0.28);
    gain.gain.linearRampToValueAtTime(amp, t + 0.42);
    gain.gain.setValueAtTime(amp, t + 0.62);
    gain.gain.linearRampToValueAtTime(0, t + 0.7);
    osc.start(t);
    osc.stop(t + 0.75);
    const el = new Audio();
    el.srcObject = dest.stream;
    el.autoplay = true;
    applyOutputDevice(el);
    el.volume = 1;
    el.play().catch(() => {});
    setTimeout(() => { try { el.pause(); el.srcObject = null; } catch (e) {} try { ctx.close(); } catch (e) {} }, 1200);
    if (hint) hint.textContent = 'Played a test tone.';
  } catch (e) {
    if (hint) hint.textContent = 'Could not play the test tone.';
  }
}

function wireVoicePanel() {
  refreshVoiceDevices();
  const micSel = $('vs-mic');
  const spkSel = $('vs-spk');
  const vol = $('vs-vol');
  const volVal = $('vs-vol-val');
  const out = $('vs-out');
  const outVal = $('vs-out-val');

  if (micSel) micSel.addEventListener('change', () => {
    stageSetting('micDeviceId', micSel.value || '');
    if (vsTestStream) { stopMicTest(); startMicTest(); }
  });
  if (spkSel) spkSel.addEventListener('change', () => {
    stageSetting('speakerDeviceId', spkSel.value || '');
    Object.values(voice.peers).forEach(p => applyOutputDevice(p.audioEl));
  });
  if (vol) vol.addEventListener('input', () => {
    const n = Number(vol.value) || 0;
    if (volVal) volVal.textContent = n + '%';
    stageSetting('inputVolume', n);
    applyMicState();
  });
  if (out) out.addEventListener('input', () => {
    const n = Number(out.value) || 0;
    if (outVal) outVal.textContent = n + '%';
    stageSetting('outputVolume', n);
    Object.values(voice.peers).forEach(p => { if (p.audioEl) p.audioEl.volume = Math.max(0, Math.min(1, n / 100)); });
  });
  const testBtn = $('vs-test');
  if (testBtn) testBtn.addEventListener('click', startMicTest);
  const testOut = $('vs-test-out');
  if (testOut) testOut.addEventListener('click', playOutputTest);

  /* Device labels are only exposed after permission, so ask once and refresh. */
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia && !navigator.mediaDevices.__crProbed) {
    navigator.mediaDevices.__crProbed = true;
    navigator.mediaDevices.getUserMedia({ audio: true }).then(st => {
      st.getTracks().forEach(t => t.stop());
      refreshVoiceDevices();
    }).catch(() => {});
  }
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', refreshVoiceDevices);
  }
}

function wireAppearance() {
  document.querySelectorAll('#theme-grid .theme-card').forEach(card => card.addEventListener('click', () => {
    stageSetting('theme', card.dataset.theme);
    document.querySelectorAll('#theme-grid .theme-card').forEach(c => c.classList.toggle('sel', c === card));
  }));
  document.querySelectorAll('#bg-grid .theme-card').forEach(card => card.addEventListener('click', () => {
    stageSetting('bg', card.dataset.bg);
    document.querySelectorAll('#bg-grid .theme-card').forEach(c => c.classList.toggle('sel', c === card));
  }));

  /* ---- Custom background (client-side only) ---- */
  const cbPreview = $('cb-preview');
  const cbPreviewImg = $('cb-preview-img');
  const cbHint = $('cb-hint');
  const cbUrl = $('cb-url');
  const cbEmpty = cbPreview ? cbPreview.querySelector('.cb-preview-empty') : null;
  const cbInputs = {
    scale: $('cb-scale'), opacity: $('cb-opacity'), blur: $('cb-blur'),
    brightness: $('cb-brightness'), x: $('cb-x'), y: $('cb-y'), fit: $('cb-fit')
  };
  const cbVals = {
    scale: $('cb-scale-val'), opacity: $('cb-opacity-val'), blur: $('cb-blur-val'),
    brightness: $('cb-brightness-val'), x: $('cb-x-val'), y: $('cb-y-val')
  };
  const cbControls = $('cb-controls');

  /* Paint the little preview with the exact same scale / transparency / blur /
     position as the real background, so what you see is what you get. */
  const paintCbPreview = () => {
    if (!cbPreview || !cbPreviewImg) return;
    const cfg = getCustomBg();
    const has = !!(cfg && cfg.url);
    cbPreview.classList.toggle('has', has);
    if (cbEmpty) cbEmpty.style.display = has ? 'none' : '';
    if (has) {
      const o = cbOptions(cfg);
      cbPreviewImg.style.backgroundImage = `url("${String(cfg.url).replace(/"/g, '%22')}")`;
      cbPreviewImg.style.backgroundSize = cbSizeValue(o.fit);
      cbPreviewImg.style.backgroundRepeat = o.fit === 'tile' ? 'repeat' : 'no-repeat';
      cbPreviewImg.style.backgroundPosition = `${o.x}% ${o.y}%`;
      cbPreviewImg.style.transform = `scale(${o.scale})`;
      cbPreviewImg.style.transformOrigin = `${o.x}% ${o.y}%`;
      cbPreviewImg.style.opacity = String(o.opacity);
      const pf = [];
      if (o.blur > 0) pf.push(`blur(${o.blur}px)`);
      if (o.brightness !== 1) pf.push(`brightness(${o.brightness})`);
      cbPreviewImg.style.filter = pf.join(' ');
    } else {
      cbPreviewImg.style.backgroundImage = '';
      cbPreviewImg.style.transform = '';
      cbPreviewImg.style.opacity = '';
      cbPreviewImg.style.filter = '';
    }
    /* Sync the sliders to whatever is stored. */
    const o = cbOptions(cfg || {});
    if (cbInputs.scale) cbInputs.scale.value = String(Math.round(o.scale * 100));
    if (cbInputs.opacity) cbInputs.opacity.value = String(Math.round((1 - o.opacity) * 100));
    if (cbInputs.blur) cbInputs.blur.value = String(Math.round(o.blur));
    if (cbInputs.brightness) cbInputs.brightness.value = String(Math.round(o.brightness * 100));
    if (cbInputs.x) cbInputs.x.value = String(Math.round(o.x));
    if (cbInputs.y) cbInputs.y.value = String(Math.round(o.y));
    if (cbInputs.fit) cbInputs.fit.value = o.fit;
    if (cbVals.scale) cbVals.scale.textContent = Math.round(o.scale * 100) + '%';
    if (cbVals.opacity) cbVals.opacity.textContent = Math.round((1 - o.opacity) * 100) + '%';
    if (cbVals.blur) cbVals.blur.textContent = Math.round(o.blur) + 'px';
    if (cbVals.brightness) cbVals.brightness.textContent = Math.round(o.brightness * 100) + '%';
    if (cbVals.x) cbVals.x.textContent = Math.round(o.x) + '%';
    if (cbVals.y) cbVals.y.textContent = Math.round(o.y) + '%';
    const fitBtn = $('cb-fit-toggle');
    if (fitBtn) fitBtn.textContent = o.fit === 'contain' ? 'Fit' : (o.fit === 'tile' ? 'Tile' : (o.fit === 'stretch' ? 'Stretch' : 'Fill'));
    if (cbControls) cbControls.classList.toggle('disabled', !has);
  };
  const cbMsg = (text, kind) => {
    if (!cbHint) return;
    cbHint.textContent = text;
    cbHint.className = 'cb-hint' + (kind ? ' ' + kind : '');
  };
  paintCbPreview();

  const applyUrl = () => {
    const v = (cbUrl && cbUrl.value || '').trim();
    if (!v) { cbMsg('Paste an image or GIF URL first.', 'bad'); return; }
    if (!/^(https?:\/\/|data:image\/)/i.test(v)) { cbMsg('Use a full https:// image or GIF URL.', 'bad'); return; }
    if (setCustomBg(Object.assign({ url: v }, cbOptions(getCustomBg() || {}), { blur: 0 }))) {
      cbMsg('Custom background applied.', 'ok');
      if (cbUrl) cbUrl.value = '';
      paintCbPreview();
    } else {
      cbMsg('Could not save that background on this device.', 'bad');
    }
  };
  const applyUrlBtn = $('cb-apply-url');
  if (applyUrlBtn) applyUrlBtn.addEventListener('click', applyUrl);
  if (cbUrl) cbUrl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyUrl(); } });

  const uploadBtn = $('cb-upload');
  const fileInput = $('cb-file');
  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      if (!/^image\//.test(f.type)) { cbMsg('Please choose an image or GIF file.', 'bad'); return; }
      if (f.size > MAX_IMAGE_BYTES) { cbMsg('That file is too large (maximum 50 MB).', 'bad'); return; }
      const prevOpts = cbOptions(getCustomBg() || {});
      /* Newly picked images are shown exactly as chosen: no forced blur. The
         Blur slider is there if the user wants it. */
      prevOpts.blur = 0;

      const applyCfg = (url) => {
        if (setCustomBg(Object.assign({ url }, prevOpts))) {
          cbMsg(`Applied ${f.name} \u2014 animated GIFs play automatically.`, 'ok');
          paintCbPreview();
        } else {
          cbMsg('Could not save that background.', 'bad');
        }
      };

      /* Upload the file so the browser never has to hold a multi-megabyte
         data URL (localStorage caps out around 5 MB). This is what lets big
         animated GIF backgrounds up to 50 MB actually work and stay animated. */
      cbMsg('Uploading\u2026', 'ok');
      uploadImage(f, f.name || 'background.gif')
        .then((d) => applyCfg(d.url))
        .catch((err) => {
          /* Offline / not signed in: fall back to an inline data URL, but only
             for files small enough to fit in localStorage. */
          if (f.size > 4 * 1024 * 1024) {
            cbMsg(err.message || 'Upload failed \u2014 that file is too large to store locally.', 'bad');
            return;
          }
          const reader = new FileReader();
          reader.onload = () => applyCfg(reader.result);
          reader.onerror = () => cbMsg('Could not read that file.', 'bad');
          reader.readAsDataURL(f);
        });
    });
  }

  const removeBtn = $('cb-remove');
  if (removeBtn) removeBtn.addEventListener('click', () => {
    setCustomBg(null);
    paintCbPreview();
    cbMsg('Custom background removed.', 'ok');
  });

  /* ---- Adjustments: scale / transparency / blur / position ---- */
  const applyAdjust = (patch, label) => {
    if (!updateCustomBgOptions(patch)) { cbMsg('Add a background image first.', 'bad'); return; }
    paintCbPreview();
    if (label) cbMsg(label, 'ok');
  };
  if (cbInputs.scale) {
    cbInputs.scale.addEventListener('input', () => {
      const v = Number(cbInputs.scale.value) || 100;
      if (cbVals.scale) cbVals.scale.textContent = v + '%';
      applyAdjust({ scale: v / 100 });
    });
  }
  if (cbInputs.opacity) {
    cbInputs.opacity.addEventListener('input', () => {
      const t = Number(cbInputs.opacity.value) || 0;
      if (cbVals.opacity) cbVals.opacity.textContent = t + '%';
      applyAdjust({ opacity: 1 - t / 100 });
    });
  }
  if (cbInputs.blur) {
    cbInputs.blur.addEventListener('input', () => {
      const b = Number(cbInputs.blur.value) || 0;
      if (cbVals.blur) cbVals.blur.textContent = b + 'px';
      applyAdjust({ blur: b });
    });
  }
  if (cbInputs.brightness) {
    cbInputs.brightness.addEventListener('input', () => {
      const b = Number(cbInputs.brightness.value) || 100;
      if (cbVals.brightness) cbVals.brightness.textContent = b + '%';
      applyAdjust({ brightness: b / 100 });
    });
  }
  const bindOffset = (key) => {
    const el = cbInputs[key]; if (!el) return;
    el.addEventListener('input', () => {
      const v = Number(el.value);
      if (cbVals[key]) cbVals[key].textContent = v + '%';
      const patch = {}; patch[key] = v; applyAdjust(patch);
    });
  };
  bindOffset('x'); bindOffset('y');
  if (cbInputs.fit) cbInputs.fit.addEventListener('change', () => applyAdjust({ fit: cbInputs.fit.value }));

  /* Zoom buttons: 5% steps, clamped to the slider range. */
  const nudgeZoom = (delta) => {
    if (!cbInputs.scale) return;
    const v = Math.min(300, Math.max(100, Number(cbInputs.scale.value) + delta));
    cbInputs.scale.value = String(v);
    if (cbVals.scale) cbVals.scale.textContent = v + '%';
    applyAdjust({ scale: v / 100 });
  };
  const zin = $('cb-zoom-in'), zout = $('cb-zoom-out');
  if (zin) zin.addEventListener('click', () => nudgeZoom(10));
  if (zout) zout.addEventListener('click', () => nudgeZoom(-10));

  /* Fill / Fit quick toggle. */
  const fitBtn = $('cb-fit-toggle');
  if (fitBtn) fitBtn.addEventListener('click', () => {
    const cur = cbOptions(getCustomBg() || {}).fit;
    applyAdjust({ fit: cur === 'cover' ? 'contain' : 'cover' });
  });

  /* One-click alignment presets. */
  document.querySelectorAll('#cb-controls [data-cb-align]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [x, y] = btn.dataset.cbAlign.split(',').map(Number);
      applyAdjust({ x, y });
    });
  });

  const resetBtn = $('cb-reset');
  if (resetBtn) resetBtn.addEventListener('click', () => {
    applyAdjust({ scale: 1, opacity: 1, blur: 0, brightness: 1, fit: 'cover', x: 50, y: 50 }, 'Adjustments reset.');
  });
}

function wireLanguage() {
  const adminBtn = $('open-admin-panel');
  if (adminBtn) adminBtn.addEventListener('click', () => { closeModal(); setTimeout(() => openAdminPanel('dashboard'), 60); });
  const sel = $('lang-select');
  if (!sel) return;
  sel.value = setting('language') || 'English, US';
  sel.addEventListener('change', () => {
    stageSetting('language', sel.value);
    applyLanguageLite();
  });
  const vol = $('voice-volume');
  if (vol) vol.addEventListener('change', () => stageSetting('inputVolume', Number(vol.value)));
}

/* ============================================================
   PLATFORM ADMIN PANEL  (visible only to "keep")
   ============================================================ */
let adminTab = 'dashboard';
const ADMIN_TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'grid' },
  { id: 'users', label: 'Users', icon: 'users' },
  { id: 'servers', label: 'Servers', icon: 'server' },
  { id: 'badges', label: 'Profile Badges', icon: 'id-badge' },
  { id: 'announcements', label: 'Announcements', icon: 'megaphone' },
  { id: 'staff', label: 'Staff Access', icon: 'key', ownerOnly: true },
  { id: 'system', label: 'System', icon: 'sliders' },
  { id: 'audit', label: 'Audit Log', icon: 'note' }
];

function openAdminPanel(tab) {
  if (!isPlatformAdmin()) { toast('Administrator access required', 'error'); return; }
  adminTab = tab || 'dashboard';
  const tabs = ADMIN_TABS.filter(t => !t.ownerOnly || isPlatformOwner());
  if (!tabs.some(t => t.id === adminTab)) adminTab = 'dashboard';
  openModal(`
    <div class="adm-shell">
      <aside class="adm-side">
        <div class="adm-brand">
          <div class="adm-brand-ico">CR</div>
          <div>
            <div class="adm-brand-title">Crossroads</div>
            <div class="adm-brand-sub">Admin Console</div>
          </div>
        </div>
        <div class="adm-nav-label">Manage</div>
        <nav class="adm-nav">
          ${tabs.map(t => `<button class="adm-nav-item${t.id === adminTab ? ' active' : ''}" data-adm-tab="${t.id}">${icon(t.icon)}<span>${t.label}</span></button>`).join('')}
        </nav>
        <div class="adm-side-foot">
          <div class="adm-me">
            <div class="adm-me-name">${escapeHtml(me.display_name || me.username)}${isPlatformOwner() ? ' <span class="adm-badge admin">OWNER</span>' : ' <span class="adm-badge blue">STAFF</span>'}</div>
            <div class="adm-me-tag">${escapeHtml(fullTag(me))}</div>
          </div>
          <button class="adm-close" id="adm-close">${icon('xmark')} Close console</button>
        </div>
      </aside>
      <section class="adm-main">
        <header class="adm-head">
          <div>
            <h3 id="adm-title">Dashboard</h3>
            <p id="adm-sub">Platform overview and quick actions</p>
          </div>
          <div class="adm-head-actions">
            <span class="adm-live"><span class="adm-live-dot"></span>Live</span>
            <button class="adm-refresh" id="adm-refresh">${icon('refresh')} Refresh</button>
          </div>
        </header>
        <div class="adm-body" id="adm-body"></div>
      </section>
    </div>`, { modalClass: 'adm-modal' });
  $('adm-close').addEventListener('click', closeModal);
  $('adm-refresh').addEventListener('click', () => renderAdminTab(adminTab));
  document.querySelectorAll('[data-adm-tab]').forEach(b => b.addEventListener('click', () => renderAdminTab(b.dataset.admTab)));
  renderAdminTab(adminTab);
}

function admLoading() { return `<div class="adm-loading"><div class="adm-spinner"></div>Loading…</div>`; }

async function renderAdminTab(tab) {
  adminTab = tab;
  document.querySelectorAll('[data-adm-tab]').forEach(b => b.classList.toggle('active', b.dataset.admTab === tab));
  const meta = ADMIN_TABS.find(t => t.id === tab) || ADMIN_TABS[0];
  const title = $('adm-title'), sub = $('adm-sub'), body = $('adm-body');
  if (!body) return;
  title.textContent = meta.label;
  sub.textContent = {
    dashboard: 'Platform overview, activity and quick actions',
    users: 'Search, inspect and moderate every account',
    servers: 'Manage every server on the platform',
    badges: 'Create custom image badges and assign them to users',
    announcements: 'Send global messages to all users',
    staff: 'Grant or revoke admin console access',
    system: 'Registration, maintenance and platform settings',
    audit: 'Every administrator action, newest first'
  }[tab] || '';
  body.innerHTML = admLoading();
  try {
    if (tab === 'dashboard') return await admRenderDashboard(body);
    if (tab === 'users') return await admRenderUsers(body);
    if (tab === 'servers') return await admRenderServers(body);
    if (tab === 'badges') return await admRenderBadges(body);
    if (tab === 'announcements') return await admRenderAnnouncements(body);
    if (tab === 'staff') return await admRenderStaff(body);
    if (tab === 'system') return await admRenderSystem(body);
    if (tab === 'audit') return await admRenderAudit(body);
  } catch (e) {
    body.innerHTML = `<div class="adm-error">${icon('circle-exclamation')} ${escapeHtml(e.message)}</div>`;
  }
}

function admStat(label, value, tone) {
  return `<div class="adm-stat${tone ? ' ' + tone : ''}"><div class="adm-stat-val">${value}</div><div class="adm-stat-label">${escapeHtml(label)}</div></div>`;
}

/* A richer stat tile used by the redesigned dashboard. */
function admTile(iconName, label, value, sub, tone) {
  return `<div class="adm-tile${tone ? ' ' + tone : ''}">
    <div class="adm-tile-top"><span class="adm-tile-ico">${icon(iconName)}</span><span class="adm-tile-label">${escapeHtml(label)}</span></div>
    <div class="adm-tile-val">${value}</div>
    ${sub ? `<div class="adm-tile-sub">${sub}</div>` : ''}
  </div>`;
}

function admAgo(ts) {
  if (!ts) return '—';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

function admDuration(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

async function admRenderDashboard(body) {
  const o = await api('/api/admin/overview');
  const s = o.system || {};
  const maxMsg = Math.max(1, ...o.activity.map(a => a.messages));
  const total7 = o.activity.reduce((n, a) => n + a.messages, 0);
  const hour = new Date().getHours();
  const greet = hour < 5 ? 'Working late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const pct = (a, b) => b ? Math.round((a / b) * 100) : 0;

  body.innerHTML = `
  <div class="adm-dash">

    <div class="adm-hero">
      <div class="adm-hero-main">
        <div class="adm-hero-eyebrow">Platform overview</div>
        <div class="adm-hero-title">${greet}, ${escapeHtml((me.display_name || me.username).split(' ')[0])}</div>
        <div class="adm-hero-sub">${o.users} accounts · ${o.servers} servers · ${o.messages.toLocaleString()} messages · ${o.online} online right now</div>
      </div>
      <div class="adm-hero-badges">
        <span class="adm-pill ${o.settings.registration_open ? 'ok' : 'bad'}"><span class="adm-live-dot"></span>Registration ${o.settings.registration_open ? 'open' : 'closed'}</span>
        <span class="adm-pill ${o.settings.maintenance_mode ? 'bad' : 'ok'}">Maintenance ${o.settings.maintenance_mode ? 'on' : 'off'}</span>
        <span class="adm-pill">v${escapeHtml(s.version || '1.1.0')}</span>
        <span class="adm-pill">Uptime ${admDuration(o.uptime_seconds)}</span>
      </div>
    </div>

    <div class="adm-tiles">
      ${admTile('users', 'Total users', o.users.toLocaleString(), `+${o.new_users_24h} today · +${o.new_users_7d} this week`)}
      ${admTile('signal', 'Online now', o.online.toLocaleString(), `${pct(o.online, o.users)}% of all accounts`, 'green')}
      ${admTile('server', 'Servers', o.servers.toLocaleString(), `${o.channels} channels · ${o.locked_servers} locked`)}
      ${admTile('comment', 'Messages', o.messages.toLocaleString(), `${o.messages_24h} in 24h · ${o.messages_1h} in 1h`, 'blue')}
      ${admTile('ban', 'Global bans', o.bans.toLocaleString(), `${o.muted} muted · ${o.disabled} disabled`, o.bans ? 'red' : '')}
      ${admTile('user-check', 'Verified', o.verified.toLocaleString(), `${o.whitelisted} whitelisted staff`, 'green')}
      ${admTile('key', 'Staff access', o.whitelisted.toLocaleString(), `${o.notes} staff note${o.notes === 1 ? '' : 's'}`, 'blue')}
      ${admTile('megaphone', 'Announcements', o.active_announcements.toLocaleString(), `${o.featured_servers} featured server${o.featured_servers === 1 ? '' : 's'}`, 'amber')}
    </div>

    <div class="adm-grid-2">
      <div class="adm-card">
        <div class="adm-card-head">
          <div class="adm-card-title">Message activity</div>
          <div class="adm-card-meta">${total7.toLocaleString()} messages · last 7 days</div>
        </div>
        <div class="adm-chart">
          ${o.activity.map(a => `
            <div class="adm-bar-col" title="${a.day}: ${a.messages} messages, ${a.users} new users">
              <div class="adm-bar-val">${a.messages || ''}</div>
              <div class="adm-bar-track"><div class="adm-bar" style="height:${Math.max(3, Math.round((a.messages / maxMsg) * 100))}%"></div></div>
              <div class="adm-bar-day">${new Date(a.day + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' })}</div>
            </div>`).join('')}
        </div>
        <div class="adm-chart-foot">
          <span><b>${o.messages_24h}</b> today</span>
          <span><b>${o.avg_messages_per_user}</b> avg / user</span>
          <span><b>${o.attachments}</b> attachments</span>
          <span><b>${o.reactions}</b> reactions</span>
          <span><b>${o.dms}</b> DM threads</span>
        </div>
      </div>

      <div class="adm-card">
        <div class="adm-card-head"><div class="adm-card-title">Platform health</div><div class="adm-card-meta">live</div></div>
        <div class="adm-kv"><span>Registration</span><b class="${o.settings.registration_open ? 'ok' : 'bad'}">${o.settings.registration_open ? 'Open' : 'Closed'}</b></div>
        <div class="adm-kv"><span>Maintenance mode</span><b class="${o.settings.maintenance_mode ? 'bad' : 'ok'}">${o.settings.maintenance_mode ? 'On' : 'Off'}</b></div>
        <div class="adm-kv"><span>New users (24h / 7d)</span><b>${o.new_users_24h} / ${o.new_users_7d}</b></div>
        <div class="adm-kv"><span>Messages (24h / 7d)</span><b>${o.messages_24h} / ${o.messages_7d}</b></div>
        <div class="adm-kv"><span>Active announcements</span><b>${o.active_announcements}</b></div>
        <div class="adm-kv"><span>Locked servers</span><b>${o.locked_servers}</b></div>
        <div class="adm-kv"><span>Node runtime</span><b>${escapeHtml(s.node || '—')}</b></div>
        <div class="adm-kv"><span>Memory (RSS / heap)</span><b>${s.memory_mb} MB / ${s.heap_mb} MB</b></div>
        <div class="adm-kv"><span>Database size</span><b>${s.db_mb} MB</b></div>
        <div class="adm-kv"><span>Process</span><b>PID ${s.pid} · ${escapeHtml(s.platform || '')}</b></div>
      </div>
    </div>

    <div class="adm-grid-3">
      <div class="adm-card">
        <div class="adm-card-head"><div class="adm-card-title">Quick actions</div></div>
        <div class="adm-quick-grid">
          <button class="adm-quick-btn" data-quick="broadcast">${icon('megaphone')}<span>Global message</span></button>
          <button class="adm-quick-btn" data-quick="users">${icon('users')}<span>Manage users</span></button>
          <button class="adm-quick-btn" data-quick="servers">${icon('server')}<span>Manage servers</span></button>
          <button class="adm-quick-btn" data-quick="registration">${icon('lock')}<span>${o.settings.registration_open ? 'Close' : 'Open'} registration</span></button>
          <button class="adm-quick-btn" data-quick="maintenance">${icon('sliders')}<span>${o.settings.maintenance_mode ? 'Disable' : 'Enable'} maintenance</span></button>
          <button class="adm-quick-btn" data-quick="export">${icon('download')}<span>Export data</span></button>
          <button class="adm-quick-btn" data-quick="audit">${icon('note')}<span>Audit log</span></button>
          ${isPlatformOwner() ? `<button class="adm-quick-btn" data-quick="staff">${icon('key')}<span>Staff access</span></button>` : ''}
        </div>
      </div>

      <div class="adm-card">
        <div class="adm-card-head"><div class="adm-card-title">Top servers</div><div class="adm-card-meta">by messages</div></div>
        <div class="adm-list">
          ${o.top_servers.length ? o.top_servers.map((sv, i) => `
            <div class="adm-list-row">
              <span class="adm-rank">${i + 1}</span>
              <div class="adm-srv-ico">${sv.icon_url ? `<img src="${escapeHtml(sv.icon_url)}" alt="">` : escapeHtml((sv.name || '?')[0].toUpperCase())}</div>
              <div class="adm-list-main"><div class="adm-list-title">${escapeHtml(sv.name)}</div><div class="adm-list-sub">${sv.members} members</div></div>
              <div class="adm-list-val">${sv.messages}</div>
            </div>`).join('') : '<div class="adm-empty-sm">No servers yet.</div>'}
        </div>
      </div>

      <div class="adm-card">
        <div class="adm-card-head"><div class="adm-card-title">Recent signups</div><div class="adm-card-meta">newest first</div></div>
        <div class="adm-list">
          ${o.recent_users.length ? o.recent_users.map(u => `
            <div class="adm-list-row">
              ${avatarHTML({ id: u.id, username: u.username, avatar_url: u.avatar_url, discriminator: u.discriminator, display_name: u.display_name }, 28, u.status)}
              <div class="adm-list-main"><div class="adm-list-title">${escapeHtml(u.display_name || u.username)}</div><div class="adm-list-sub">${escapeHtml(u.tag)}</div></div>
              <div class="adm-list-val sm">${admAgo(u.created_at)}</div>
            </div>`).join('') : '<div class="adm-empty-sm">No users yet.</div>'}
        </div>
      </div>
    </div>

    <div class="adm-grid-2">
      <div class="adm-card">
        <div class="adm-card-head"><div class="adm-card-title">Recent admin activity</div><button class="adm-link" data-quick="audit">View all</button></div>
        <div class="adm-timeline">
          ${o.recent_audit.length ? o.recent_audit.map(a => `
            <div class="adm-tl-row">
              <span class="adm-tl-dot"></span>
              <div class="adm-tl-main">
                <div class="adm-tl-title"><b>${escapeHtml(a.actor_name ? a.actor_name + '#' + a.actor_disc : 'system')}</b> · ${escapeHtml(a.action)}</div>
                <div class="adm-tl-sub">${escapeHtml(a.detail || (a.target_type + ' ' + a.target_id))}</div>
              </div>
              <div class="adm-tl-time">${admAgo(a.created_at)}</div>
            </div>`).join('') : '<div class="adm-empty-sm">No admin actions recorded yet.</div>'}
        </div>
      </div>

      <div class="adm-card">
        <div class="adm-card-head"><div class="adm-card-title">Platform snapshot</div></div>
        <div class="adm-snap">
          <div><b>${o.users}</b><span>Accounts</span></div>
          <div><b>${o.servers}</b><span>Servers</span></div>
          <div><b>${o.channels}</b><span>Channels</span></div>
          <div><b>${o.messages.toLocaleString()}</b><span>Messages</span></div>
          <div><b>${o.reactions}</b><span>Reactions</span></div>
          <div><b>${o.attachments}</b><span>Files</span></div>
        </div>
        <div class="adm-note">${icon('circle-info')} All moderation actions are reversible and recorded in the audit log. No user content is deleted by this console.</div>
      </div>
    </div>
  </div>`;

  body.querySelectorAll('[data-quick]').forEach(b => b.addEventListener('click', async () => {
    const q = b.dataset.quick;
    if (q === 'broadcast') return admAnnouncementDialog();
    if (q === 'users') return renderAdminTab('users');
    if (q === 'servers') return renderAdminTab('servers');
    if (q === 'staff') return renderAdminTab('staff');
    if (q === 'audit') return renderAdminTab('audit');
    if (q === 'registration') {
      await api('/api/admin/settings', { method: 'PATCH', body: JSON.stringify({ registration_open: !o.settings.registration_open }) });
      toast('Registration ' + (!o.settings.registration_open ? 'opened' : 'closed'), 'success');
      return renderAdminTab('dashboard');
    }
    if (q === 'maintenance') {
      await api('/api/admin/settings', { method: 'PATCH', body: JSON.stringify({ maintenance_mode: !o.settings.maintenance_mode }) });
      toast('Maintenance mode ' + (!o.settings.maintenance_mode ? 'enabled' : 'disabled'), 'success');
      return renderAdminTab('dashboard');
    }
    if (q === 'export') return admExport();
  }));
}
async function admRenderUsers(body) {
  const q = sessionStorage.getItem('adm-user-q') || '';
  const data = await api('/api/admin/users?limit=300&q=' + encodeURIComponent(q));
  body.innerHTML = `
    <div class="adm-toolbar">
      <div class="adm-search">${icon('search')}<input id="adm-user-search" placeholder="Search by username or ID…" value="${escapeHtml(q)}"></div>
      <div class="adm-count">${data.total} account${data.total === 1 ? '' : 's'}</div>
    </div>
    <div class="adm-table-wrap">
      <table class="adm-table">
        <thead><tr><th>User</th><th>Status</th><th>Servers</th><th>Messages</th><th>Flags</th><th></th></tr></thead>
        <tbody>${data.users.map(u => `
          <tr>
            <td><div class="adm-user-cell">${avatarHTML({ id: u.id, username: u.username, avatar_url: u.avatar_url, discriminator: u.discriminator, display_name: u.display_name }, 30, u.status)}
              <div><div class="adm-user-name">${escapeHtml(u.display_name || u.username)}${u.verified ? '<span class="adm-badge verified">✓</span>' : ''}${u.platform_admin ? '<span class="adm-badge admin">ADMIN</span>' : ''}${badgeChips(u, { compact: true })}</div>
              <div class="adm-user-tag">${escapeHtml(u.tag)}</div></div></div></td>
            <td><span class="adm-dot ${u.status}"></span>${escapeHtml(u.status)}</td>
            <td>${u.servers}</td><td>${u.messages}</td>
            <td><div class="adm-flags">${u.banned ? '<span class="adm-badge red">BANNED</span>' : ''}${u.muted ? '<span class="adm-badge amber">MUTED</span>' : ''}${u.disabled ? '<span class="adm-badge red">DISABLED</span>' : ''}</div></td>
            <td><button class="adm-manage" data-manage-user="${u.id}">Manage</button></td>
          </tr>`).join('') || '<tr><td colspan="6" class="adm-empty">No users found.</td></tr>'}
        </tbody>
      </table>
    </div>`;
  const input = $('adm-user-search');
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { sessionStorage.setItem('adm-user-q', input.value.trim()); renderAdminTab('users'); }, 300);
  });
  body.querySelectorAll('[data-manage-user]').forEach(b => b.addEventListener('click', () => {
    const u = data.users.find(x => x.id === b.dataset.manageUser);
    if (u) openAdminUser(u);
  }));
}

async function openAdminUser(u) {
  let notes = [];
  try { notes = (await api('/api/admin/users/' + u.id + '/notes')).notes; } catch (e) {}
  let allBadges = [], assignedBadges = [];
  try { const bd = await api('/api/admin/users/' + u.id + '/badges'); allBadges = bd.badges || []; assignedBadges = bd.assigned || []; } catch (e) {}
  const ownerBlocked = u.platform_owner;
  const disabledAttr = ownerBlocked ? 'disabled title="The owner account is protected"' : '';
  openModal(`
    <div class="adm-user-modal">
      <div class="adm-user-head">
        ${avatarHTML({ id: u.id, username: u.username, avatar_url: u.avatar_url, discriminator: u.discriminator, display_name: u.display_name }, 64, u.status)}
        <div>
          <h3>${escapeHtml(u.display_name || u.username)} ${u.verified ? '<span class="adm-badge verified">✓</span>' : ''}</h3>
          <div class="adm-user-tag">${escapeHtml(u.tag)} · ${escapeHtml(u.id)}</div>
          ${badgeChips(u)}
          <div class="adm-flags">
            ${u.platform_owner ? '<span class="adm-badge admin">OWNER</span>' : ''}
            ${u.platform_admin && !u.platform_owner ? '<span class="adm-badge admin">STAFF</span>' : ''}
            ${u.whitelisted ? '<span class="adm-badge blue">WHITELISTED</span>' : ''}
            ${u.banned ? '<span class="adm-badge red">BANNED</span>' : ''}
            ${u.muted ? '<span class="adm-badge amber">MUTED</span>' : ''}
            ${u.disabled ? '<span class="adm-badge red">DISABLED</span>' : ''}
          </div>
        </div>
      </div>
      ${ownerBlocked ? `<div class="adm-protect">${icon('lock')} This is the platform owner. Bans, kicks, mutes, disables, password resets and renames are blocked on this account.</div>` : ''}
      <div class="adm-user-stats">
        <div><b>${u.servers}</b><span>Servers</span></div>
        <div><b>${u.owned_servers}</b><span>Owned</span></div>
        <div><b>${u.messages}</b><span>Messages</span></div>
        <div><b>${u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</b><span>Joined</span></div>
      </div>
      <div class="adm-user-meta">
        <div><span>Pronouns</span><b>${escapeHtml(u.pronouns || '—')}</b></div>
        <div><span>Status</span><b>${escapeHtml(u.custom_status || u.status || '—')}</b></div>
        <div><span>Last seen</span><b>${u.last_seen_at ? admAgo(u.last_seen_at) : '—'}</b></div>
        <div><span>Staff notes</span><b>${u.note_count || 0}</b></div>
      </div>

      <div class="adm-section-title">Account</div>
      <div class="adm-action-grid">
        <button class="adm-action" data-ua="set_username">${icon('pencil')} Change username</button>
        <button class="adm-action" data-ua="set_display_name">${icon('id-badge')} Change display name</button>
        <button class="adm-action" data-ua="set_discriminator">${icon('hash')} Change discriminator</button>
        <button class="adm-action" data-ua="randomize_discriminator">${icon('refresh')} Randomize tag</button>
        <button class="adm-action" data-ua="set_pronouns">${icon('users')} Set pronouns</button>
        <button class="adm-action" data-ua="set_custom_status">${icon('comment')} Set custom status</button>
        <button class="adm-action" data-ua="set_status">${icon('signal')} Set presence</button>
        <button class="adm-action" data-ua="set_bio">${icon('note')} Edit bio</button>
        <button class="adm-action" data-ua="clear_bio">${icon('trash')} Clear bio</button>
        <button class="adm-action" data-ua="set_accent">${icon('palette')} Set accent colour</button>
        <button class="adm-action" data-ua="set_banner_color">${icon('image')} Set banner colour</button>
        <button class="adm-action" data-ua="clear_avatar">${icon('user-minus')} Clear avatar</button>
        <button class="adm-action" data-ua="clear_banner">${icon('image')} Clear banner</button>
        <button class="adm-action" data-ua="reset_password">${icon('key')} Reset password</button>
        <button class="adm-action" data-ua="force_logout">${icon('log-out')} Force logout</button>
      </div>

      <div class="adm-section-title">Moderation</div>
      <div class="adm-action-grid">
        <button class="adm-action ${u.verified ? 'on' : ''}" data-ua="${u.verified ? 'unverify' : 'verify'}">${icon('user-check')} ${u.verified ? 'Remove verification' : 'Verify user'}</button>
        <button class="adm-action ${u.muted ? 'on' : ''}" data-ua="${u.muted ? 'unmute' : 'mute'}" ${disabledAttr}>${icon('mic-off')} ${u.muted ? 'Unmute' : 'Mute'}</button>
        <button class="adm-action ${u.disabled ? 'on' : ''}" data-ua="${u.disabled ? 'enable' : 'disable'}" ${disabledAttr}>${icon('lock')} ${u.disabled ? 'Enable account' : 'Disable account'}</button>
        <button class="adm-action" data-ua="kick" ${disabledAttr}>${icon('log-out')} Kick from servers</button>
        <button class="adm-action danger" data-ua="${u.banned ? 'unban' : 'ban'}" ${disabledAttr}>${icon('ban')} ${u.banned ? 'Unban user' : 'Ban user'}</button>
        <button class="adm-action" data-ua="warn">${icon('circle-exclamation')} Send warning</button>
        <button class="adm-action" data-ua="message">${icon('comment')} Direct message</button>
      </div>

      <div class="adm-section-title">Profile badges</div>
      <div class="adm-badge-assign">
        ${allBadges.length ? allBadges.map(b => `
          <label class="adm-badge-assign-row">
            <img src="${escapeHtml(b.icon_url)}" alt="${escapeHtml(b.name)}">
            <span class="aba-name">${escapeHtml(b.name)}</span>
            <input type="checkbox" data-badge="${b.id}" ${assignedBadges.includes(b.id) ? 'checked' : ''}>
          </label>`).join('') : `<div class="adm-badge-empty">No badges yet. Create them in the Profile Badges tab.</div>`}
      </div>

      <div class="adm-section-title">Staff access</div>
      <div class="adm-action-grid">
        ${u.platform_owner
          ? `<div class="adm-note" style="grid-column:1/-1">${icon('crown')} The owner always has full access.</div>`
          : (isPlatformOwner()
            ? `<button class="adm-action ${u.whitelisted ? 'on' : ''}" data-ua="${u.whitelisted ? 'unwhitelist' : 'whitelist'}">${icon('key')} ${u.whitelisted ? 'Revoke panel access' : 'Whitelist for panel'}</button>`
            : `<div class="adm-note" style="grid-column:1/-1">${icon('lock')} Only the owner can manage staff access.</div>`)}
        <button class="adm-action" data-ua="add_note">${icon('note')} Add staff note</button>
        <button class="adm-action" data-ua="clear_notes">${icon('trash')} Clear staff notes</button>
      </div>

      <div class="adm-section-title">Staff notes</div>
      <div class="adm-notes">
        ${notes.length ? notes.map(n => `
          <div class="adm-note-row">
            <div class="adm-note-head"><b>${escapeHtml(n.author_name ? n.author_name + '#' + n.author_disc : 'staff')}</b> · ${admAgo(n.created_at)}</div>
            <div class="adm-note-body">${escapeHtml(n.content)}</div>
          </div>`).join('') : '<div class="adm-empty-sm">No staff notes yet.</div>'}
      </div>

      <div class="modal-actions"><button class="btn secondary" id="adm-user-back">Back to users</button></div>
    </div>`, { modalClass: 'adm-user-modal-wrap' });
  $('adm-user-back').addEventListener('click', () => openAdminPanel('users'));
  document.querySelectorAll('[data-ua]').forEach(b => b.addEventListener('click', () => admUserAction(u, b.dataset.ua)));
  document.querySelectorAll('[data-badge]').forEach(cb => cb.addEventListener('change', async () => {
    cb.disabled = true;
    try {
      await api('/api/admin/users/' + u.id + '/badges', { method: 'POST', body: JSON.stringify({ badge_id: cb.dataset.badge, assigned: cb.checked }) });
      toast(cb.checked ? 'Badge assigned' : 'Badge removed', 'success');
    } catch (e) { cb.checked = !cb.checked; toast(e.message, 'error'); }
    cb.disabled = false;
  }));
}
async function admUserAction(u, action) {
  const needsValue = ['set_username', 'set_display_name', 'set_discriminator', 'set_bio', 'set_pronouns',
    'set_custom_status', 'set_banner_color', 'set_accent', 'add_note', 'reset_password', 'warn', 'message', 'ban', 'kick'].includes(action);
  const labels = {
    set_username: ['Change username', 'New username (no length limit)', u.username],
    set_display_name: ['Change display name', 'New display name', u.display_name || u.username],
    set_discriminator: ['Change discriminator', 'New discriminator (digits)', u.discriminator],
    set_bio: ['Edit bio', 'New bio (Markdown supported)', u.bio || ''],
    set_pronouns: ['Set pronouns', 'Pronouns (e.g. they/them)', u.pronouns || ''],
    set_custom_status: ['Set custom status', 'Custom status text', u.custom_status || ''],
    set_banner_color: ['Set banner colour', 'Hex colour (#5865F2)', u.banner_color || '#5865F2'],
    set_accent: ['Set accent colour', 'Hex colour (#5865F2)', u.accent_color || '#5865F2'],
    add_note: ['Add staff note', 'Private note (only staff can see this)', ''],
    reset_password: ['Reset password', 'New password (min 6 characters)', ''],
    warn: ['Send warning', 'Warning message', ''],
    message: ['Direct message', 'Message to send', ''],
    ban: ['Ban user', 'Reason for the ban', ''],
    kick: ['Kick from servers', 'Reason (sent to the user)', '']
  };
  if (needsValue) {
    const [title, label, val] = labels[action];
    admPrompt({ title, label, value: val, danger: ['ban', 'reset_password', 'kick'].includes(action) }, async (value) => {
      await api('/api/admin/users/' + u.id + '/action', { method: 'POST', body: JSON.stringify({ action, value }) });
      toast('Action applied: ' + action.replace(/_/g, ' '), 'success');
      openAdminPanel('users');
    });
    return;
  }
  const confirmText = {
    verify: 'Verify this user?', unverify: 'Remove verification?', mute: 'Mute this user platform-wide?',
    unmute: 'Unmute this user?', disable: 'Disable this account? They will be signed out.',
    enable: 'Re-enable this account?', unban: 'Lift the global ban?', force_logout: 'Sign this user out of every device?',
    randomize_discriminator: 'Generate a new random discriminator for this user?',
    clear_avatar: 'Remove this user\'s avatar?', clear_banner: 'Remove this user\'s banner?',
    clear_bio: 'Clear this user\'s bio?', clear_notes: 'Delete all staff notes for this user?',
    whitelist: 'Grant this user access to the admin console?', unwhitelist: 'Revoke this user\'s admin console access?'
  }[action];
  if (confirmText) {
    const ok = await confirmDialog({ title: 'Confirm action', body: escapeHtml(confirmText), confirmText: 'Confirm', danger: ['disable', 'mute', 'unban', 'clear_avatar', 'clear_banner', 'clear_bio', 'clear_notes', 'unwhitelist'].includes(action) });
    if (!ok) return;
  }
  try {
    await api('/api/admin/users/' + u.id + '/action', { method: 'POST', body: JSON.stringify({ action }) });
    toast('Action applied: ' + action.replace(/_/g, ' '), 'success');
    openAdminPanel('users');
  } catch (e) { toast(e.message, 'error'); }
}

/* ---- Profile badges ---- */
async function admRenderBadges(body) {
  const data = await api('/api/admin/badges');
  body.innerHTML = `
    <div class="adm-toolbar">
      <div class="adm-count">${data.badges.length} badge${data.badges.length === 1 ? '' : 's'}</div>
      <button class="btn" id="adm-new-badge">${icon('plus')} New Badge</button>
    </div>
    ${data.badges.length ? `<div class="adm-badge-grid">${data.badges.map(b => `
      <div class="adm-badge-card">
        <img src="${escapeHtml(b.icon_url)}" alt="${escapeHtml(b.name)}">
        <div class="adm-badge-info"><b>${escapeHtml(b.name)}</b><span>${b.assigned_count} member${b.assigned_count === 1 ? '' : 's'}</span></div>
        <div class="adm-badge-actions">
          <button data-edit-badge="${b.id}" title="Edit">${icon('pencil')}</button>
          <button class="danger" data-del-badge="${b.id}" title="Delete">${icon('trash')}</button>
        </div>
      </div>`).join('')}</div>`
      : `<div class="adm-badge-empty">${icon('id-badge')}<div style="margin-top:8px">No profile badges yet. Create one with a custom image and a name.</div></div>`}
    <div class="adm-note" style="margin-top:16px">${icon('circle-info')} Assign badges to a user from <b>Users &rarr; Manage</b>. Badges show under the username on profiles and in the member list.</div>`;
  hydrateIcons(body);
  const nb = $('adm-new-badge');
  if (nb) nb.addEventListener('click', () => admBadgeDialog(null));
  body.querySelectorAll('[data-edit-badge]').forEach(b => b.addEventListener('click', () => {
    const badge = data.badges.find(x => x.id === b.dataset.editBadge);
    if (badge) admBadgeDialog(badge);
  }));
  body.querySelectorAll('[data-del-badge]').forEach(b => b.addEventListener('click', async () => {
    const badge = data.badges.find(x => x.id === b.dataset.delBadge);
    const ok = await confirmDialog({ title: 'Delete Badge', body: `Delete <b>${escapeHtml(badge ? badge.name : 'this badge')}</b>? It will be removed from every user who has it.`, confirmText: 'Delete', danger: true });
    if (!ok) return;
    try { await api('/api/admin/badges/' + b.dataset.delBadge, { method: 'DELETE' }); toast('Badge deleted', 'success'); renderAdminTab('badges'); }
    catch (e) { toast(e.message, 'error'); }
  }));
}

function admBadgeDialog(badge) {
  const wrap = document.createElement('div');
  wrap.className = 'confirm-overlay';
  wrap.innerHTML = `<div class="confirm-box">
    <h3>${badge ? 'Edit Badge' : 'New Profile Badge'}</h3>
    <p>Badges appear under a user's username on their profile and in the member list.</p>
    <div class="field"><label>Badge Name</label><input id="ab-name" maxlength="40" value="${escapeHtml(badge ? badge.name : '')}" placeholder="e.g. Founder, Verified, Artist"></div>
    <div class="field"><label>Badge Image</label>
      <div class="re-icon-picker">
        <div class="re-icon-preview" id="ab-preview">${badge && badge.icon_url ? `<img src="${escapeHtml(badge.icon_url)}" alt="">` : icon('image')}</div>
        <div class="re-icon-actions">
          <button type="button" class="re-icon-btn" id="ab-upload">${icon('upload')} Upload image</button>
        </div>
        <input type="file" id="ab-file" accept="image/*" hidden>
      </div>
    </div>
    <div class="field"><label>Give to user <span class="opt">username or tag</span></label>
      <input id="ab-user" placeholder="e.g. alex or alex#1234" autocomplete="off">
      <div class="ab-user-hint" id="ab-user-hint"></div>
    </div>
    <div class="confirm-actions"><button class="btn ghost" id="ab-cancel">Cancel</button><button class="btn" id="ab-save">${badge ? 'Save Changes' : 'Create Badge'}</button></div>
  </div>`;
  document.body.appendChild(wrap);
  hydrateIcons(wrap);
  let iconUrl = badge ? badge.icon_url : '';
  const preview = wrap.querySelector('#ab-preview');
  const file = wrap.querySelector('#ab-file');
  const setPreview = () => {
    preview.innerHTML = iconUrl ? `<img src="${escapeHtml(iconUrl)}" alt="">` : icon('image');
    if (!iconUrl) hydrateIcons(preview);
  };
  wrap.querySelector('#ab-upload').addEventListener('click', () => file.click());
  file.addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const d = await uploadImage(f); iconUrl = d.url; setPreview(); }
    catch (err) { toast(err.message, 'error'); }
    e.target.value = '';
  });
  /* Optional: give this badge to a user by username / tag. */
  const userInput = wrap.querySelector('#ab-user');
  const userHint = wrap.querySelector('#ab-user-hint');
  let resolvedUser = null;
  let lookupTimer = null;
  const lookupUser = async () => {
    const q = userInput.value.trim().replace(/^@/, '');
    resolvedUser = null;
    if (!q) { userHint.textContent = ''; userHint.className = 'ab-user-hint'; return; }
    try {
      const d = await api('/api/admin/users?q=' + encodeURIComponent(q) + '&limit=10');
      const users = d.users || [];
      const norm = q.toLowerCase();
      const exact = users.find(u => (u.tag || '').toLowerCase() === norm || (u.username || '').toLowerCase() === norm || u.id === q);
      resolvedUser = exact || (users.length === 1 ? users[0] : null);
      if (resolvedUser) {
        userHint.textContent = 'Will give to ' + (resolvedUser.tag || resolvedUser.username);
        userHint.className = 'ab-user-hint ok';
      } else if (users.length) {
        userHint.textContent = 'Multiple matches \u2014 type the full tag (name#1234).';
        userHint.className = 'ab-user-hint warn';
      } else {
        userHint.textContent = 'No user found with that username.';
        userHint.className = 'ab-user-hint bad';
      }
    } catch (e) { userHint.textContent = e.message; userHint.className = 'ab-user-hint bad'; }
  };
  userInput.addEventListener('input', () => { clearTimeout(lookupTimer); lookupTimer = setTimeout(lookupUser, 350); });
  const done = () => wrap.remove();
  wrap.querySelector('#ab-cancel').addEventListener('click', done);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) done(); });
  wrap.querySelector('#ab-save').addEventListener('click', async () => {
    const name = wrap.querySelector('#ab-name').value.trim();
    if (!name) { toast('Badge name required', 'error'); return; }
    if (!iconUrl) { toast('Badge image required', 'error'); return; }
    const wantedUser = userInput.value.trim();
    if (wantedUser && !resolvedUser) { await lookupUser(); }
    if (wantedUser && !resolvedUser) { toast('User not found \u2014 check the username or tag', 'error'); return; }
    try {
      let savedBadge = badge;
      if (badge) {
        const r = await api('/api/admin/badges/' + badge.id, { method: 'PATCH', body: JSON.stringify({ name, icon_url: iconUrl }) });
        savedBadge = (r && r.badge) || badge;
      } else {
        const r = await api('/api/admin/badges', { method: 'POST', body: JSON.stringify({ name, icon_url: iconUrl }) });
        savedBadge = r && r.badge;
      }
      if (resolvedUser && savedBadge) {
        await api('/api/admin/users/' + resolvedUser.id + '/badges', { method: 'POST', body: JSON.stringify({ badge_id: savedBadge.id, assigned: true }) });
      }
      done();
      toast(resolvedUser ? 'Badge saved and given to ' + (resolvedUser.username || 'user') : (badge ? 'Badge updated' : 'Badge created'), 'success');
      renderAdminTab('badges');
    } catch (e) { toast(e.message, 'error'); }
  });
}

async function admRenderServers(body) {
  const data = await api('/api/admin/servers?limit=300');
  body.innerHTML = `
    <div class="adm-toolbar"><div class="adm-count">${data.total} server${data.total === 1 ? '' : 's'}</div></div>
    <div class="adm-table-wrap"><table class="adm-table">
      <thead><tr><th>Server</th><th>Owner</th><th>Members</th><th>Messages</th><th>Flags</th><th></th></tr></thead>
      <tbody>${data.servers.map(s => `
        <tr>
          <td><div class="adm-user-cell"><div class="adm-srv-ico">${s.icon_url ? `<img src="${escapeHtml(s.icon_url)}" alt="">` : escapeHtml((s.name || '?')[0].toUpperCase())}</div>
            <div><div class="adm-user-name">${escapeHtml(s.name)}</div><div class="adm-user-tag">${escapeHtml(s.id)}</div></div></div></td>
          <td>${escapeHtml(s.owner_tag)}</td><td>${s.members}</td><td>${s.messages}</td>
          <td><div class="adm-flags">${s.locked ? '<span class="adm-badge red">LOCKED</span>' : ''}${s.featured ? '<span class="adm-badge blue">FEATURED</span>' : ''}</div></td>
          <td><button class="adm-manage" data-manage-srv="${s.id}">Manage</button></td>
        </tr>`).join('') || '<tr><td colspan="6" class="adm-empty">No servers found.</td></tr>'}</tbody>
    </table></div>`;
  body.querySelectorAll('[data-manage-srv]').forEach(b => b.addEventListener('click', () => {
    const s = data.servers.find(x => x.id === b.dataset.manageSrv);
    if (s) openAdminServer(s);
  }));
}

async function openAdminServer(s) {
  openModal(`
    <div class="adm-user-modal">
      <div class="adm-user-head">
        <div class="adm-srv-ico lg">${s.icon_url ? `<img src="${escapeHtml(s.icon_url)}" alt="">` : escapeHtml((s.name || '?')[0].toUpperCase())}</div>
        <div><h3>${escapeHtml(s.name)}</h3><div class="adm-user-tag">Owner: ${escapeHtml(s.owner_tag)} · ${escapeHtml(s.id)}</div>
        <div class="adm-flags">${s.locked ? '<span class="adm-badge red">LOCKED</span>' : ''}${s.featured ? '<span class="adm-badge blue">FEATURED</span>' : ''}</div></div>
      </div>
      <div class="adm-user-stats"><div><b>${s.members}</b><span>Members</span></div><div><b>${s.channels}</b><span>Channels</span></div><div><b>${s.messages}</b><span>Messages</span></div><div><b>${new Date(s.created_at).toLocaleDateString()}</b><span>Created</span></div></div>
      <div class="adm-section-title">Server controls</div>
      <div class="adm-action-grid">
        <button class="adm-action ${s.locked ? 'on' : ''}" data-sa="${s.locked ? 'unlock' : 'lock'}">${icon('lock')} ${s.locked ? 'Unlock server' : 'Lock server'}</button>
        <button class="adm-action ${s.featured ? 'on' : ''}" data-sa="${s.featured ? 'unfeature' : 'feature'}">${icon('crown')} ${s.featured ? 'Unfeature' : 'Feature server'}</button>
        <button class="adm-action" data-sa="rename">${icon('pencil')} Rename server</button>
        <button class="adm-action" data-sa="set_description">${icon('note')} Edit description</button>
        <button class="adm-action" data-sa="clear_description">${icon('trash')} Clear description</button>
        <button class="adm-action" data-sa="transfer_owner">${icon('user-check')} Transfer ownership</button>
        <button class="adm-action" data-sa="announce">${icon('megaphone')} Post announcement</button>
      </div>
      <div class="adm-section-title">Appearance &amp; access</div>
      <div class="adm-action-grid">
        <button class="adm-action" data-sa="set_icon_url">${icon('image')} Set icon URL</button>
        <button class="adm-action" data-sa="set_banner_url">${icon('image')} Set banner URL</button>
        <button class="adm-action" data-sa="set_slowmode_all">${icon('clock')} Slow mode (all)</button>
        <button class="adm-action" data-sa="create_invite">${icon('link')} Create invite</button>
      </div>
      <div class="modal-actions"><button class="btn secondary" id="adm-srv-back">Back to servers</button></div>
    </div>`, { modalClass: 'adm-user-modal-wrap' });
  $('adm-srv-back').addEventListener('click', () => openAdminPanel('servers'));
  document.querySelectorAll('[data-sa]').forEach(b => b.addEventListener('click', () => admServerAction(s, b.dataset.sa)));
}

async function admServerAction(s, action) {
  const prompts = {
    rename: ['Rename server', 'New server name', s.name],
    set_description: ['Edit description', 'New description', s.description || ''],
    set_icon_url: ['Set icon URL', 'Image URL (https://…)', s.icon_url || ''],
    set_banner_url: ['Set banner URL', 'Image URL (https://…)', s.banner_url || ''],
    set_slowmode_all: ['Slow mode (all channels)', 'Seconds between messages (0 to disable)', '0'],
    transfer_owner: ['Transfer ownership', 'New owner user ID', s.owner_id],
    announce: ['Post announcement', 'Message to post in this server', '']
  };
  if (prompts[action]) {
    const [title, label, val] = prompts[action];
    admPrompt({ title, label, value: val }, async (value) => {
      await api('/api/admin/servers/' + s.id + '/action', { method: 'POST', body: JSON.stringify({ action, value }) });
      toast('Server updated', 'success');
      openAdminPanel('servers');
    });
    return;
  }
  if (action === 'create_invite') {
    try {
      const r = await api('/api/admin/servers/' + s.id + '/action', { method: 'POST', body: JSON.stringify({ action }) });
      const link = location.origin + '/app.html?invite=' + r.code;
      try { await navigator.clipboard.writeText(link); toast('Invite created and copied: ' + r.code, 'success'); }
      catch (e) { toast('Invite created: ' + r.code, 'success'); }
    } catch (e) { toast(e.message, 'error'); }
    return;
  }
  const ok = await confirmDialog({ title: 'Confirm action', body: escapeHtml(`Apply "${action.replace(/_/g, ' ')}" to ${s.name}?`), confirmText: 'Confirm', danger: ['lock', 'clear_description'].includes(action) });
  if (!ok) return;
  try {
    await api('/api/admin/servers/' + s.id + '/action', { method: 'POST', body: JSON.stringify({ action }) });
    toast('Server updated', 'success');
    openAdminPanel('servers');
  } catch (e) { toast(e.message, 'error'); }
}

async function admRenderAnnouncements(body) {
  const data = await api('/api/admin/announcements');
  body.innerHTML = `
    <div class="adm-card">
      <div class="adm-card-title">New global message</div>
      <div class="adm-form">
        <div class="field"><label>Title</label><input id="ann-title" placeholder="Optional headline"></div>
        <div class="field"><label>Message</label><textarea id="ann-content" rows="4" placeholder="This appears to every user in the app."></textarea></div>
        <div class="field"><label>Level</label><select id="ann-level"><option value="info">Info</option><option value="success">Success</option><option value="warning">Warning</option><option value="critical">Critical</option></select></div>
        <div class="adm-form-actions"><button class="btn" id="ann-send">${icon('megaphone')} Send to everyone</button></div>
      </div>
    </div>
    <div class="adm-section-title">Recent announcements</div>
    <div class="adm-ann-list">${data.announcements.map(a => `
      <div class="adm-ann ${a.active ? '' : 'inactive'}">
        <div class="adm-ann-main"><div class="adm-ann-title">${escapeHtml(a.title || 'Announcement')} <span class="adm-badge ${a.level}">${escapeHtml(a.level)}</span> ${a.active ? '' : '<span class="adm-badge">INACTIVE</span>'}</div>
        <div class="adm-ann-content">${escapeHtml(a.content)}</div>
        <div class="adm-ann-meta">${new Date(a.created_at).toLocaleString()}${a.expires_at ? ' · expires ' + new Date(a.expires_at).toLocaleString() : ''}</div></div>
        <button class="adm-manage" data-ann-toggle="${a.id}" data-active="${a.active}">${a.active ? 'Deactivate' : 'Activate'}</button>
      </div>`).join('') || '<div class="adm-empty">No announcements yet.</div>'}</div>`;
  $('ann-send').addEventListener('click', async () => {
    const content = $('ann-content').value.trim();
    if (!content) { toast('Message content required', 'error'); return; }
    try {
      await api('/api/admin/announcements', { method: 'POST', body: JSON.stringify({ title: $('ann-title').value.trim(), content, level: $('ann-level').value }) });
      toast('Global message sent', 'success');
      renderAdminTab('announcements');
    } catch (e) { toast(e.message, 'error'); }
  });
  body.querySelectorAll('[data-ann-toggle]').forEach(b => b.addEventListener('click', async () => {
    await api('/api/admin/announcements/' + b.dataset.annToggle + '/action', { method: 'POST', body: JSON.stringify({ action: b.dataset.active === '1' ? 'deactivate' : 'activate' }) });
    renderAdminTab('announcements');
  }));
}

async function admAnnouncementDialog() {
  admPrompt({ title: 'Global message', label: 'Message to send to every user', value: '', multiline: true }, async (value) => {
    await api('/api/admin/announcements', { method: 'POST', body: JSON.stringify({ title: '', content: value, level: 'info' }) });
    toast('Global message sent', 'success');
    openAdminPanel('announcements');
  });
}

async function admRenderStaff(body) {
  if (!isPlatformOwner()) { body.innerHTML = `<div class="adm-error">${icon('lock')} Only the platform owner can manage staff access.</div>`; return; }
  const data = await api('/api/admin/whitelist');
  body.innerHTML = `
    <div class="adm-card">
      <div class="adm-card-head"><div class="adm-card-title">Owner</div></div>
      <div class="adm-staff-row owner">
        <div class="adm-staff-ico">${icon('crown')}</div>
        <div class="adm-staff-main"><div class="adm-staff-name">${escapeHtml(data.owner.tag)}</div><div class="adm-staff-sub">Full, permanent access · cannot be removed</div></div>
        <span class="adm-badge admin">OWNER</span>
      </div>
    </div>

    <div class="adm-card">
      <div class="adm-card-head">
        <div class="adm-card-title">Whitelisted staff</div>
        <div class="adm-card-meta">${data.whitelist.length} account${data.whitelist.length === 1 ? '' : 's'}</div>
      </div>
      <p class="adm-muted">Whitelisted accounts can open this console and use every moderation tool. Only you (the owner) can grant or revoke access. The owner account is always protected from bans and kicks.</p>
      <div class="adm-staff-add">
        <div class="adm-search">${icon('search')}<input id="staff-add-input" placeholder="Username or user ID to whitelist…"></div>
        <button class="btn" id="staff-add-btn">${icon('user-plus')} Grant access</button>
      </div>
      <div class="adm-list" style="margin-top:14px">
        ${data.whitelist.length ? data.whitelist.map(w => `
          <div class="adm-staff-row">
            ${avatarHTML({ id: w.user_id, username: w.display_name, avatar_url: w.avatar_url }, 34, 'offline')}
            <div class="adm-staff-main"><div class="adm-staff-name">${escapeHtml(w.display_name)}</div><div class="adm-staff-sub">${escapeHtml(w.tag)} · added by ${escapeHtml(w.added_by)} · ${admAgo(w.created_at)}</div></div>
            <button class="adm-manage danger" data-staff-remove="${w.user_id}">Revoke</button>
          </div>`).join('') : '<div class="adm-empty-sm">No staff whitelisted yet. Use the field above to grant access.</div>'}
      </div>
    </div>`;

  const grant = async () => {
    const v = ($('staff-add-input').value || '').trim();
    if (!v) { toast('Enter a username or user ID', 'error'); return; }
    try {
      await api('/api/admin/whitelist', { method: 'POST', body: JSON.stringify({ user_id: v }) });
      toast('Access granted', 'success');
      renderAdminTab('staff');
    } catch (e) { toast(e.message, 'error'); }
  };
  $('staff-add-btn').addEventListener('click', grant);
  $('staff-add-input').addEventListener('keydown', e => { if (e.key === 'Enter') grant(); });
  body.querySelectorAll('[data-staff-remove]').forEach(b => b.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Revoke access', body: 'Remove this account from the admin console whitelist?', confirmText: 'Revoke', danger: true });
    if (!ok) return;
    try {
      await api('/api/admin/whitelist/' + b.dataset.staffRemove, { method: 'DELETE' });
      toast('Access revoked', 'success');
      renderAdminTab('staff');
    } catch (e) { toast(e.message, 'error'); }
  }));
}

async function admRenderSystem(body) {
  const s = await api('/api/admin/settings');
  body.innerHTML = `
    <div class="adm-card">
      <div class="adm-card-title">Registration & access</div>
      <div class="adm-toggle-row"><div><b>Open registration</b><span>Allow new accounts to be created.</span></div><div class="toggle${s.registration_open ? ' on' : ''}" data-adm-toggle="registration_open"></div></div>
      <div class="adm-toggle-row"><div><b>Maintenance mode</b><span>Show a maintenance banner across the app.</span></div><div class="toggle${s.maintenance_mode ? ' on' : ''}" data-adm-toggle="maintenance_mode"></div></div>
      <div class="field"><label>Maintenance message</label><input id="sys-maint" value="${escapeHtml(s.maintenance_message || '')}" placeholder="We'll be right back…"></div>
      <div class="field"><label>Message of the day</label><input id="sys-motd" value="${escapeHtml(s.motd || '')}" placeholder="Optional banner text for everyone"></div>
      <div class="field"><label>Max upload size (MB)</label><input id="sys-upload" type="number" min="1" max="500" value="${Number(s.max_upload_mb) || 50}"></div>
      <div class="adm-form-actions"><button class="btn" id="sys-save">Save settings</button></div>
    </div>
    <div class="adm-card">
      <div class="adm-card-title">Data</div>
      <p class="adm-muted">Download a JSON snapshot of users, servers, bans and settings. Password hashes are never included.</p>
      <div class="adm-form-actions">
        <button class="btn secondary" id="sys-export">${icon('download')} Export data (JSON)</button>
        <button class="btn secondary" id="sys-audit-export">${icon('download')} Export audit log (CSV)</button>
      </div>
    </div>
    ${isPlatformOwner() ? `
    <div class="adm-card">
      <div class="adm-card-title">Bulk operations</div>
      <p class="adm-muted">Owner-only, platform-wide actions. Every one is recorded in the audit log.</p>
      <div class="adm-action-grid">
        <button class="adm-action" data-bulk="clear_bans">${icon('ban')} Clear all global bans</button>
        <button class="adm-action" data-bulk="force_logout_all">${icon('log-out')} Sign out everyone</button>
        <button class="adm-action" data-bulk="deactivate_announcements">${icon('megaphone')} Deactivate announcements</button>
        <button class="adm-action" data-bulk="verify_all">${icon('user-check')} Verify all users</button>
        <button class="adm-action" data-bulk="unmute_all">${icon('mic-off')} Unmute everyone</button>
        <button class="adm-action" data-bulk="unlock_all_servers">${icon('unlock')} Unlock all servers</button>
      </div>
    </div>` : ''}`;
  let pending = { registration_open: s.registration_open, maintenance_mode: s.maintenance_mode };
  body.querySelectorAll('[data-adm-toggle]').forEach(t => t.addEventListener('click', () => {
    const k = t.dataset.admToggle;
    pending[k] = !pending[k];
    t.classList.toggle('on', pending[k]);
  }));
  $('sys-save').addEventListener('click', async () => {
    try {
      await api('/api/admin/settings', { method: 'PATCH', body: JSON.stringify({
        registration_open: pending.registration_open,
        maintenance_mode: pending.maintenance_mode,
        maintenance_message: $('sys-maint').value,
        motd: $('sys-motd').value,
        max_upload_mb: Number($('sys-upload').value) || 50
      }) });
      toast('Platform settings saved', 'success');
    } catch (e) { toast(e.message, 'error'); }
  });
  $('sys-export').addEventListener('click', admExport);
  $('sys-audit-export').addEventListener('click', () => {
    const token = localStorage.getItem('cr_token') || '';
    const a = document.createElement('a');
    a.href = '/api/admin/audit/export?token=' + encodeURIComponent(token);
    a.download = 'crossroads-audit-' + Date.now() + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
  });
  body.querySelectorAll('[data-bulk]').forEach(b => b.addEventListener('click', async () => {
    const action = b.dataset.bulk;
    const ok = await confirmDialog({ title: 'Confirm bulk action', body: escapeHtml(`Run "${action.replace(/_/g, ' ')}" across the whole platform?`), confirmText: 'Run', danger: true });
    if (!ok) return;
    try {
      const r = await api('/api/admin/bulk', { method: 'POST', body: JSON.stringify({ action }) });
      toast(r.detail || 'Done', 'success');
    } catch (e) { toast(e.message, 'error'); }
  }));
}

async function admExport() {
  try {
    const data = await api('/api/admin/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'crossroads-export-' + Date.now() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Export downloaded', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

async function admRenderAudit(body) {
  const data = await api('/api/admin/audit?limit=300');
  body.innerHTML = `<div class="adm-table-wrap"><table class="adm-table">
    <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
    <tbody>${data.audit.map(a => `<tr>
      <td class="adm-nowrap">${new Date(a.created_at).toLocaleString()}</td>
      <td>${escapeHtml(a.actor_name ? a.actor_name + '#' + a.actor_disc : 'system')}</td>
      <td><span class="adm-badge blue">${escapeHtml(a.action)}</span></td>
      <td class="adm-nowrap">${escapeHtml(a.target_type || '')} ${escapeHtml(a.target_id || '')}</td>
      <td class="adm-detail">${escapeHtml(a.detail || '')}</td>
    </tr>`).join('') || '<tr><td colspan="5" class="adm-empty">No admin actions recorded yet.</td></tr>'}</tbody>
  </table></div>`;
}

/* Small professional prompt used by the admin panel. */
function admPrompt({ title, label, value, danger, multiline }, onConfirm) {
  openModal(`
    <div class="adm-prompt">
      <h3>${escapeHtml(title)}</h3>
      <div class="field"><label>${escapeHtml(label)}</label>
        ${multiline ? `<textarea id="admp-val" rows="4">${escapeHtml(value || '')}</textarea>` : `<input id="admp-val" value="${escapeHtml(value || '')}" autocomplete="off">`}
      </div>
      <div class="modal-actions">
        <button class="btn secondary" id="admp-cancel">Cancel</button>
        <button class="btn ${danger ? 'danger' : ''}" id="admp-ok">Confirm</button>
      </div>
    </div>`, { modalClass: 'adm-prompt-wrap' });
  const input = $('admp-val');
  input.focus(); if (input.select) input.select();
  $('admp-cancel').addEventListener('click', () => openAdminPanel(adminTab));
  $('admp-ok').addEventListener('click', async () => {
    const v = input.value;
    if (!String(v).trim() && !multiline) { toast('A value is required', 'error'); return; }
    try { await onConfirm(v); } catch (e) { toast(e.message, 'error'); }
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !multiline) { e.preventDefault(); $('admp-ok').click(); } });
}

/* ============================================================
   SERVER MENU
   ============================================================ */
function serverMenu(e) {
  if (!state.server) return;
  const rect = $('sidebar-header').getBoundingClientRect();
  const isOwner = state.server.owner_id === me.id;
  const admin = amIAdmin();
  const items = [
    { label: 'Invite People', icon: 'user-plus', onClick: () => openInviteModal() },
    { label: 'Copy Server ID', icon: 'id-badge', onClick: () => copyToClipboard(state.server.id, 'Server ID') }
  ];
  /* Management entries are only shown to the owner and server admins. */
  if (admin) {
    items.push({ label: 'Create Channel', icon: 'plus', onClick: () => openCreateChannel('text') });
    items.push({ label: 'Server Settings', icon: 'settings', onClick: openServerSettings });
  }
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
  const srv = state.server;
  if (!srv) return;
  if (srv.owner_id !== me.id) { toast('Only the server owner can delete this server', 'error'); return; }
  openModal(`
    <h3>Delete Server</h3>
    <p class="msub">This will permanently delete <b>${escapeHtml(srv.name)}</b> and all of its channels and messages. This action cannot be undone.</p>
    <div class="field"><label>Type the server name to confirm</label>
      <input id="ds-confirm" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(srv.name)}">
      <div class="hint">Enter <b>${escapeHtml(srv.name)}</b> exactly to enable deletion.</div></div>
    <div class="modal-actions">
      <button class="btn secondary" id="ds-cancel">Cancel</button>
      <button class="btn danger" id="ds-delete" disabled>Delete Server</button>
    </div>`);
  const input = $('ds-confirm');
  const btn = $('ds-delete');
  const sync = () => { btn.disabled = input.value.trim() !== srv.name; };
  input.addEventListener('input', sync);
  $('ds-cancel').addEventListener('click', closeModal);
  btn.addEventListener('click', async () => {
    if (input.value.trim() !== srv.name) return;
    btn.disabled = true;
    try {
      await api('/api/servers/' + srv.id, { method: 'DELETE' });
      closeModal();
      toast('Server deleted', 'success');
      await loadServers(); showHome();
    } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
  });
  input.focus();
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

/* Can the signed-in user revoke this invite? Only its creator, or a server
   owner/admin. Mirrors the check enforced by DELETE /api/invites/:code. */
function canRevokeInvite(inv, s) {
  if (!inv || !s) return false;
  if (inv.creator_id === me.id) return true;
  if (s.owner_id === me.id) return true;
  const mine = (state.members || []).find(m => m.id === me.id);
  const role = mine && (mine.member_role || mine.role);
  return role === 'owner' || role === 'admin';
}

async function loadInviteList(s) {
  const list = $('inv-list');
  if (!list) return;
  try {
    const { invites } = await api('/api/servers/' + s.id + '/invites');
    const active = invites.filter(i => i.valid).length;
    const countEl = $('inv-count');
    if (countEl) countEl.textContent = active + ' / 5 active';
    if (!invites.length) { list.innerHTML = `<div class="inv-empty">No invites yet \u2014 generate one above to get started.</div>`; return; }
    list.innerHTML = invites.map(inv => `
      <div class="invite-row${inv.valid ? '' : ' inactive'}">
        <div class="ir-ico">${icon(inv.valid ? 'link' : (inv.expired ? 'clock' : 'xmark'))}</div>
        <div class="ir-main">
          <div class="ir-code">gg/${escapeHtml(inv.code)}</div>
          <div class="ir-meta">${escapeHtml(inviteExpiryLabel(inv))} \u00b7 ${inv.max_uses ? `${inv.uses}/${inv.max_uses} uses` : `${inv.uses} use${inv.uses === 1 ? '' : 's'}`}</div>
        </div>
        <button class="ir-btn ir-copy" data-copy="${escapeHtml(inv.code)}" title="Copy link">${icon('copy')}</button>
        ${canRevokeInvite(inv, s) ? `<button class="ir-btn ir-revoke" data-revoke="${escapeHtml(inv.code)}" title="Revoke">${icon('trash')}</button>` : `<button class="ir-btn ir-locked" disabled title="Only the invite creator or a server admin can revoke this">${icon('lock')}</button>`}
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
  /* Defence in depth: never open management UI for a regular member, even if
     something tries to call this directly. */
  if (!amIAdmin()) { toast('Only server owners and admins can open Server Settings', 'error'); return; }
  const isOwner = s.owner_id === me.id;
  const tabs = [
    { id: 'overview', label: 'Overview', icon: 'server', group: 'Server' },
    { id: 'roles', label: 'Roles', icon: 'shield', group: 'Server' },
    { id: 'members', label: 'Members', icon: 'users', group: 'Server' },
    { id: 'moderation', label: 'Moderation', icon: 'ban', group: 'Safety' },
    { id: 'safety', label: 'Safety', icon: 'lock', group: 'Safety' },
    { id: 'invites', label: 'Invites', icon: 'link', group: 'Access' }
  ];
  const groups = [...new Set(tabs.map(t => t.group))];
  openModal(`
    <div class="ss-shell">
      <aside class="ss-side">
        <div class="ss-side-brand">
          <div class="ss-side-icon">${s.icon_url ? `<img src="${escapeHtml(s.icon_url)}" alt="">` : escapeHtml((s.name || '?')[0].toUpperCase())}</div>
          <div class="ss-side-name"><span>${escapeHtml(s.name)}</span><small>Server Settings</small></div>
        </div>
        <nav class="ss-nav">
          ${groups.map(g => `
            <div class="ss-nav-group">${g}</div>
            ${tabs.filter(t => t.group === g).map(t => `<button class="ss-nav-item${t.id === 'overview' ? ' active' : ''}" data-tab="${t.id}">${icon(t.icon)}<span>${t.label}</span></button>`).join('')}
          `).join('')}
        </nav>
        <div class="ss-side-foot">Signed in as <b>${escapeHtml(me.display_name || me.username)}</b></div>
      </aside>
      <section class="ss-main">
        <header class="ss-main-head">
          <div>
            <h3 id="ss-title">Overview</h3>
            <p class="ss-main-sub" id="ss-sub">Manage how your server looks and who can join.</p>
          </div>
          <button class="ss-close" id="ss-close-x" title="Close">${icon('xmark')}</button>
        </header>
        <div class="ss-body" id="ss-body"></div>
      </section>
    </div>`, { modalClass: 'ss-modal' });
  $('ss-close-x').addEventListener('click', closeModal);
  const subtitles = {
    overview: 'Manage how your server looks and who can join.',
    roles: 'Create roles, set their colour and decide how they appear.',
    members: 'Review everyone in the server and assign roles.',
    moderation: 'Bans and recent moderation actions.',
    safety: 'Control who can join and how the server behaves.',
    invites: 'Share invite links and track how people get in.'
  };
  const showTab = (tab) => {
    document.querySelectorAll('.ss-nav-item').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    const t = tabs.find(x => x.id === tab);
    const titleEl = $('ss-title'), subEl = $('ss-sub');
    if (titleEl && t) titleEl.textContent = t.label;
    if (subEl) subEl.textContent = subtitles[tab] || '';
    renderServerTab(tab, state.server, isOwner);
  };
  document.querySelectorAll('.ss-nav-item').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));
  showTab('overview');
}

function renderServerTab(tab, s, isOwner) {
  const body = $('ss-body');
  if (!body) return;
  replayAnim(body, 'anim-in');
  if (tab === 'invites') {
    body.innerHTML = `<div class="invite-panel">${invitePanelHTML(s)}</div>`;
    hydrateIcons(body);
    wireInvitePanel(s);
    return;
  }
  if (tab === 'members') {
    const members = state.members || [];
    const iAmOwner = s.owner_id === me.id;
    const admin = amIAdmin();
    const roles = state.roles || [];
    body.innerHTML = `
      <div class="ss-section-title">Members \u2014 ${members.length}</div>
      <div class="ss-members">${members.map(m => {
        const isOwner = m.id === s.owner_id;
        const role = isOwner ? 'owner' : (m.role || 'member');
        const badge = isOwner ? '<span class="role-badge owner">Owner</span>' : (role === 'admin' ? '<span class="role-badge admin">Admin</span>' : '');
        const crole = (m.custom_role_id && roles.find(r => r.id === m.custom_role_id)) || null;
        const croleBadge = crole ? `<span class="role-badge custom" style="background:${crole.color}22;color:${crole.color};border-color:${crole.color}66">${escapeHtml(crole.name)}</span>` : '';
        let actions = '';
        if (admin && !isOwner) {
          const roleBtn = iAmOwner
            ? (role === 'admin'
                ? `<button class="ss-member-role-btn" data-demote="${m.id}">Demote</button>`
                : `<button class="ss-member-role-btn promote" data-promote="${m.id}">Make Admin</button>`)
            : '';
          const roleSelect = roles.length
            ? `<select class="ss-role-select" data-role-for="${m.id}">
                 <option value="">No role</option>
                 ${roles.map(r => `<option value="${r.id}"${m.custom_role_id === r.id ? ' selected' : ''}>${escapeHtml(r.name)}</option>`).join('')}
               </select>`
            : '';
          actions = `${roleSelect}${roleBtn}
            <button class="ss-icon-btn" data-timeout="${m.id}" title="Time out member">${icon('clock')}</button>
            <button class="ss-icon-btn kick" data-kick="${m.id}" title="Kick member">${icon('user-minus')}</button>
            <button class="ss-icon-btn ban" data-ban="${m.id}" title="Ban member">${icon('ban')}</button>`;
        }
        return `<div class="ss-member-row">
          ${avatarHTML(m, 36, m.status || 'offline')}
          <div class="ss-member-info">
            <div class="ss-member-name">${escapeHtml(m.display_name || m.username)}${badge}${croleBadge}</div>
            <div class="ss-member-tag">${escapeHtml(fullTag(m))}</div>
          </div>
          <div class="ss-member-actions">${actions}</div>
        </div>`;
      }).join('') || '<div class="inv-empty">No members.</div>'}</div>`;
    hydrateIcons(body);
    body.querySelectorAll('[data-promote]').forEach(b => b.addEventListener('click', () => setMemberRole(s, b.dataset.promote, 'admin')));
    body.querySelectorAll('[data-demote]').forEach(b => b.addEventListener('click', () => setMemberRole(s, b.dataset.demote, 'member')));
    body.querySelectorAll('[data-role-for]').forEach(sel => sel.addEventListener('change', () => assignCustomRole(s, sel.dataset.roleFor, sel.value || null)));
    body.querySelectorAll('[data-kick]').forEach(b => b.addEventListener('click', () => kickMember(s, b.dataset.kick)));
    body.querySelectorAll('[data-ban]').forEach(b => b.addEventListener('click', () => banMember(s, b.dataset.ban)));
    body.querySelectorAll('[data-timeout]').forEach(b => b.addEventListener('click', () => timeoutMember(s, b.dataset.timeout)));
    return;
  }
  if (tab === 'roles') {
    renderRolesTab(body, s);
    return;
  }
  if (tab === 'moderation') {
    renderModerationTab(body, s);
    return;
  }
  if (tab === 'safety') {
    renderSafetyTab(body, s);
    return;
  }
  // Overview
  const bannerScale = Number(s.banner_scale) > 0 ? Number(s.banner_scale) : 1;
  const posParts = String(s.banner_position || '50% 50%').split(/\s+/);
  const posX = parseInt(posParts[0], 10) || 0;
  const posY = parseInt(posParts[1], 10) || 0;
  const bannerFallback = 'linear-gradient(135deg, var(--brand), color-mix(in srgb, var(--brand) 40%, #000))';
  const bannerStyle = s.banner_url ? '' : `background:${bannerFallback}`;
  const bannerImgStyle = s.banner_url
    ? `background-image:url('${escapeHtml(s.banner_url)}');background-size:cover;background-position:${posX}% ${posY}%;transform:scale(${bannerScale})`
    : '';
  const created = new Date(s.created_at).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
  body.innerHTML = `
    <div class="ss-overview">
      <div class="ss-top">
        <div class="ss-icon-col">
          <div class="ss-icon-drop" id="ss-icon-drop" title="Upload server icon">
            ${s.icon_url ? `<img src="${escapeHtml(s.icon_url)}" alt="">` : `<span class="ss-icon-fallback">${escapeHtml((s.name || '?')[0].toUpperCase())}</span>`}
            <div class="ss-icon-overlay">${icon('upload')}</div>
          </div>
          <div class="ss-icon-hint">${isOwner ? `Click to ${s.icon_url ? 'change' : 'upload'} icon` : 'Server icon'}</div>
          <input type="file" id="ss-icon-file" accept="image/*" class="hidden">
        </div>
        <div class="ss-name-col">
          <div class="field"><label>Server Name</label><input id="ss-name" value="${escapeHtml(s.name)}" maxlength="40" ${isOwner ? '' : 'disabled'} placeholder="e.g. Pixel Lounge, Study Group, Game Night"></div>
        </div>
      </div>
      <div class="ss-banner" id="ss-banner" style="${bannerStyle}">
        <div class="ss-banner-img" id="ss-banner-img" style="${bannerImgStyle}"></div>
        <div class="ss-banner-shade"></div>
        <div class="ss-banner-actions">
          <button class="ss-banner-btn" id="ss-banner-upload">${icon('image')} ${s.banner_url ? 'Change Banner' : 'Upload Banner'}</button>
          ${s.banner_url ? `<button class="ss-banner-btn ghost" id="ss-banner-remove">${icon('trash')} Remove</button>` : ''}
        </div>
        <input type="file" id="ss-banner-file" accept="image/*,image/gif" class="hidden">
      </div>
      <div class="ss-banner-hint">${icon('image')} Recommended 960&times;240. Animated GIFs are supported and will play in the sidebar.</div>
      ${s.banner_url ? `<div class="ss-banner-tools" id="ss-banner-tools">
        <div class="ss-tool"><label>Zoom <span id="ss-scale-val">${Math.round(bannerScale * 100)}%</span></label>
          <input type="range" id="ss-banner-scale" min="1" max="3" step="0.05" value="${bannerScale}" ${isOwner ? '' : 'disabled'}></div>
        <div class="ss-tool"><label>Horizontal <span id="ss-posx-val">${posX}%</span></label>
          <input type="range" id="ss-banner-posx" min="0" max="100" step="1" value="${posX}" ${isOwner ? '' : 'disabled'}></div>
        <div class="ss-tool"><label>Vertical <span id="ss-posy-val">${posY}%</span></label>
          <input type="range" id="ss-banner-posy" min="0" max="100" step="1" value="${posY}" ${isOwner ? '' : 'disabled'}></div>
        <button class="btn secondary ss-tool-reset" id="ss-banner-reset" ${isOwner ? '' : 'disabled'}>${icon('refresh')} Reset</button>
      </div>` : ''}
      <div class="ss-fields">
        <div class="field"><label>Server Description</label>
          <div class="ss-desc-wrap">
            <textarea id="ss-desc" maxlength="500" ${isOwner ? '' : 'disabled'} placeholder="Tell people what your server is about, who it is for, and what to expect when they join.">${escapeHtml(s.description || '')}</textarea>
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
  let bannerScaleV = bannerScale, bannerPosX = posX, bannerPosY = posY;
  const iconDrop = $('ss-icon-drop');
  if (isOwner && iconDrop) {
    iconDrop.addEventListener('click', () => $('ss-icon-file').click());
    $('ss-icon-file').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const d = await uploadImage(f); iconUrl = d.url;
        iconDrop.innerHTML = `<img src="${escapeHtml(d.url)}" alt=""><div class="ss-icon-overlay">${icon('upload')}</div>`;
        hydrateIcons(iconDrop);
      } catch (err) { toast(err.message, 'error'); }
      e.target.value = '';
    });
  }
  const bannerEl = $('ss-banner');
  const bannerImgEl = $('ss-banner-img');
  const paintBannerImg = () => {
    if (!bannerImgEl) return;
    if (bannerUrl) {
      bannerImgEl.style.backgroundImage = `url('${bannerUrl}')`;
      bannerImgEl.style.backgroundSize = 'cover';
      bannerImgEl.style.backgroundPosition = `${bannerPosX}% ${bannerPosY}%`;
      bannerImgEl.style.transform = `scale(${bannerScaleV})`;
    } else {
      bannerImgEl.style.backgroundImage = 'none';
    }
  };
  if (isOwner && bannerEl) {
    $('ss-banner-upload').addEventListener('click', () => $('ss-banner-file').click());
    $('ss-banner-file').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const d = await uploadImage(f); bannerUrl = d.url;
        if (bannerEl) bannerEl.style.background = bannerFallback;
        paintBannerImg();
      } catch (err) { toast(err.message, 'error'); }
      e.target.value = '';
    });
    const rm = $('ss-banner-remove');
    if (rm) rm.addEventListener('click', () => {
      bannerUrl = null;
      if (bannerEl) bannerEl.style.background = bannerFallback;
      paintBannerImg();
      rm.remove();
    });
    const scaleInput = $('ss-banner-scale');
    const posxInput = $('ss-banner-posx');
    const posyInput = $('ss-banner-posy');
    if (scaleInput) scaleInput.addEventListener('input', () => {
      bannerScaleV = Number(scaleInput.value) || 1;
      const lbl = $('ss-scale-val'); if (lbl) lbl.textContent = Math.round(bannerScaleV * 100) + '%';
      paintBannerImg();
    });
    if (posxInput) posxInput.addEventListener('input', () => {
      bannerPosX = parseInt(posxInput.value, 10) || 0;
      const lbl = $('ss-posx-val'); if (lbl) lbl.textContent = bannerPosX + '%';
      paintBannerImg();
    });
    if (posyInput) posyInput.addEventListener('input', () => {
      bannerPosY = parseInt(posyInput.value, 10) || 0;
      const lbl = $('ss-posy-val'); if (lbl) lbl.textContent = bannerPosY + '%';
      paintBannerImg();
    });
    const resetBtn = $('ss-banner-reset');
    if (resetBtn) resetBtn.addEventListener('click', () => {
      bannerScaleV = 1; bannerPosX = 50; bannerPosY = 50;
      if (scaleInput) scaleInput.value = 1;
      if (posxInput) posxInput.value = 50;
      if (posyInput) posyInput.value = 50;
      const a = $('ss-scale-val'); if (a) a.textContent = '100%';
      const b = $('ss-posx-val'); if (b) b.textContent = '50%';
      const c = $('ss-posy-val'); if (c) c.textContent = '50%';
      paintBannerImg();
    });
  }
  const save = $('ss-save');
  if (save) save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      const { server } = await api('/api/servers/' + s.id, { method: 'PATCH', body: JSON.stringify({ name: $('ss-name').value.trim(), description: $('ss-desc').value.trim(), icon_url: iconUrl, banner_url: bannerUrl, banner_scale: bannerScaleV, banner_position: `${bannerPosX}% ${bannerPosY}%` }) });
      state.server = server;
      const sn = $('sidebar-name'); if (sn) sn.textContent = server.name;
      syncSidebarBanner(true);
      await loadServers();
      toast('Server updated', 'success');
      renderServerTab('overview', server, isOwner);
    } catch (e) { toast(e.message, 'error'); save.disabled = false; }
  });
}

/* ============================================================
   SERVER SETTINGS — Roles / Moderation / Safety tabs
   ============================================================ */
async function refreshRoles() {
  if (!state.server) return;
  try { const { roles } = await api('/api/servers/' + state.server.id + '/roles'); state.roles = roles || []; } catch (e) { /* ignore */ }
}

function roleGradient(r) {
  if (r && r.color2 && /^#[0-9a-fA-F]{6}$/.test(r.color2)) return `linear-gradient(135deg, ${r.color}, ${r.color2})`;
  return r ? r.color : '#5865F2';
}
function parseRolePerms(r) {
  try { const p = JSON.parse((r && r.permissions) || '{}'); return (p && typeof p === 'object') ? p : {}; } catch (e) { return {}; }
}
const ROLE_PERMISSIONS = [
  ['administrator', 'Administrator', 'Grants every permission below and bypasses channel overrides.', 'General', 'shield'],
  ['manage_server', 'Manage Server', 'Change the server name, icon, banner and description.', 'General', 'settings'],
  ['manage_roles', 'Manage Roles', 'Create, edit and delete roles below their own rank.', 'General', 'id-badge'],
  ['manage_channels', 'Manage Channels', 'Create, edit and delete channels and categories.', 'Channels', 'hash'],
  ['manage_messages', 'Manage Messages', 'Delete and pin messages from other members.', 'Channels', 'trash'],
  ['create_invites', 'Create Invites', 'Generate new invite links for the server.', 'Channels', 'link'],
  ['manage_members', 'Manage Members', 'Promote, demote, time out and move members.', 'Members', 'users'],
  ['kick_members', 'Kick Members', 'Remove members from the server.', 'Members', 'user-minus'],
  ['ban_members', 'Ban Members', 'Ban members and manage the ban list.', 'Members', 'ban'],
  ['mention_everyone', 'Mention Everyone', 'Use @everyone and @here in messages.', 'Members', 'at-sign']
];
const PERM_GROUPS = ['General', 'Channels', 'Members'];

function renderRolesTab(body, s) {
  const admin = amIAdmin();
  const roles = (state.roles || []).slice().sort((a, b) => (b.position || 0) - (a.position || 0));
  const members = state.members || [];
  const builtins = [
    { id: 'owner', name: 'Owner', color: '#f0b232', desc: 'Full access. The owner cannot be removed or demoted.', count: 1, locked: true },
    { id: 'admin', name: 'Admin', color: '#f23f43', desc: 'Can manage channels, roles, members and moderation.', count: members.filter(m => m.role === 'admin' && m.id !== s.owner_id).length, manageable: true },
    { id: 'member', name: 'Member', color: '#949ba4', desc: 'Standard access to channels and conversations.', count: members.filter(m => m.id !== s.owner_id && (m.role || 'member') === 'member').length, manageable: true }
  ];
  const roleRow = (r, i) => {
    const perms = parseRolePerms(r);
    const permCount = Object.keys(perms).filter(k => perms[k]).length;
    const badges = [
      r.hoist ? '<span class="role-flag hoist">Hoisted</span>' : '',
      r.mentionable ? '<span class="role-flag">Mentionable</span>' : '<span class="role-flag muted">Silent</span>',
      perms.administrator ? '<span class="role-flag danger">Admin</span>' : ''
    ].join('');
    return `<div class="ss-role-card">
      <div class="role-order">
        <button class="role-move" data-move-up="${r.id}" title="Move up" ${i === 0 ? 'disabled' : ''}>${icon('chevron-up')}</button>
        <button class="role-move" data-move-down="${r.id}" title="Move down" ${i === roles.length - 1 ? 'disabled' : ''}>${icon('chevron-down')}</button>
      </div>
      <span class="role-dot" style="background:${roleGradient(r)}"></span>
      <div class="ss-role-info">
        <div class="ss-role-name" style="color:${r.color}">${roleIconHTML(r.icon)}${escapeHtml(r.name)}</div>
        <div class="ss-role-desc">${r.member_count || 0} member${(r.member_count || 0) === 1 ? '' : 's'} &middot; ${permCount} permission${permCount === 1 ? '' : 's'}</div>
        <div class="role-flags">${badges}</div>
      </div>
      ${admin ? `<div class="ss-role-actions"><button class="ss-icon-btn" data-assign-role="${r.id}" title="Assign members">${icon('user-plus')}</button><button class="ss-icon-btn" data-edit-role="${r.id}" title="Edit">${icon('pencil')}</button><button class="ss-icon-btn ban" data-del-role="${r.id}" title="Delete">${icon('trash')}</button></div>` : ''}
    </div>`;
  };
  body.innerHTML = `
    <div class="ss-panel">
      <div class="ss-section-title">Role Hierarchy <span class="ss-section-hint">Higher roles appear first and outrank lower ones.</span></div>
      <div class="ss-roles">
        ${builtins.map(r => `<div class="ss-role-card builtin">
          <div class="role-order placeholder"></div>
          <span class="role-dot" style="background:${r.color}"></span>
          <div class="ss-role-info"><div class="ss-role-name">${r.name}${r.locked ? ` ${icon('lock')}` : ''}</div><div class="ss-role-desc">${r.desc}</div></div>
          ${admin && r.manageable ? `<button class="ss-icon-btn" data-assign-builtin="${r.id}" title="Manage members">${icon('users')}</button>` : ''}
          <span class="ss-role-count">${r.count}</span>
        </div>`).join('')}
      </div>
      <div class="ss-section-title">Custom Roles \u2014 ${roles.length}</div>
      <div class="ss-roles" id="ss-custom-roles">
        ${roles.map(roleRow).join('') || '<div class="inv-empty">No custom roles yet. Create one to tag members with a name, colour and permissions.</div>'}
      </div>
      ${admin ? `<div class="ss-actions"><button class="btn" id="ss-add-role">${icon('plus')} Create Role</button></div>` : '<div class="ss-note">Only the owner and admins can manage roles.</div>'}
    </div>
  `;
  hydrateIcons(body);
  const addBtn = $('ss-add-role');
  if (addBtn) addBtn.addEventListener('click', () => openRoleEditor(s, null));
  body.querySelectorAll('[data-del-role]').forEach(b => b.addEventListener('click', () => deleteServerRole(s, b.dataset.delRole)));
  body.querySelectorAll('[data-edit-role]').forEach(b => b.addEventListener('click', () => { const r = (state.roles || []).find(x => x.id === b.dataset.editRole); if (r) openRoleEditor(s, r); }));
  body.querySelectorAll('[data-move-up]').forEach(b => b.addEventListener('click', () => moveServerRole(s, b.dataset.moveUp, 'up')));
  body.querySelectorAll('[data-move-down]').forEach(b => b.addEventListener('click', () => moveServerRole(s, b.dataset.moveDown, 'down')));
  body.querySelectorAll('[data-assign-role]').forEach(b => b.addEventListener('click', () => openRoleAssign(s, b.dataset.assignRole)));
  body.querySelectorAll('[data-assign-builtin]').forEach(b => b.addEventListener('click', () => openBuiltinAssign(s, b.dataset.assignBuiltin)));
}

async function moveServerRole(s, rid, dir) {
  try {
    const d = await api('/api/servers/' + s.id + '/roles/' + rid + '/move', { method: 'POST', body: JSON.stringify({ dir }) });
    if (d && d.roles) state.roles = d.roles;
    renderServerTab('roles', state.server, state.server.owner_id === me.id);
  } catch (e) { toast(e.message, 'error'); }
}

/* Assign a custom role to members. Changes save instantly and the member list
   (including any hoisted "display separately" group) refreshes when closed. */
function openRoleAssign(s, roleId) {
  const role = (state.roles || []).find(r => r.id === roleId);
  if (!role) return;
  const members = state.members || [];
  const wrap = document.createElement('div');
  wrap.className = 'confirm-overlay';
  wrap.innerHTML = `<div class="confirm-box role-assign-box">
    <div class="ra-head">
      <div>
        <h3>Assign \\u201c${escapeHtml(role.name)}\\u201d</h3>
        <p class="ra-sub">Tick the members who should have this role. Changes save instantly.</p>
      </div>
      <span class="ra-role-chip" style="color:${role.color};border-color:${role.color}66;background:${role.color}18">${roleIconHTML(role.icon, 'role-tag-ico')}${escapeHtml(role.name)}</span>
    </div>
    <div class="ra-search">${icon('search')}<input id="ra-search" placeholder="Search members\\u2026"></div>
    <div class="ra-list" id="ra-list"></div>
    <div class="confirm-actions"><button class="btn" id="ra-done">Done</button></div>
  </div>`;
  document.body.appendChild(wrap);
  hydrateIcons(wrap);
  const list = wrap.querySelector('#ra-list');
  const renderList = (q = '') => {
    const needle = q.toLowerCase();
    const filtered = members.filter(m => !needle ||
      (m.display_name || m.username || '').toLowerCase().includes(needle) ||
      (m.username || '').toLowerCase().includes(needle));
    list.innerHTML = filtered.map(m => {
      const isOwner = m.id === s.owner_id;
      const checked = m.custom_role_id === role.id;
      return `<label class="ra-row">
        ${avatarHTML(m, 32, m.status || 'offline')}
        <div class="ra-name"><b>${escapeHtml(m.display_name || m.username)}</b><span>${escapeHtml(fullTag(m))}</span></div>
        ${isOwner ? `<span class="ra-owner-tag">${icon('crown')} Owner</span>` : ''}
        <input type="checkbox" data-uid="${m.id}" ${checked ? 'checked' : ''}>
      </label>`;
    }).join('') || '<div class="inv-empty">No members found.</div>';
    hydrateIcons(list);
    list.querySelectorAll('input[data-uid]').forEach(cb => cb.addEventListener('change', async () => {
      const uid = cb.dataset.uid;
      cb.disabled = true;
      try {
        await api('/api/servers/' + s.id + '/members/' + uid, { method: 'PATCH', body: JSON.stringify({ custom_role_id: cb.checked ? role.id : null }) });
        const m = members.find(x => x.id === uid);
        if (m) m.custom_role_id = cb.checked ? role.id : null;
        role.member_count = Math.max(0, (role.member_count || 0) + (cb.checked ? 1 : -1));
        renderMembers();
      } catch (e) { cb.checked = !cb.checked; toast(e.message, 'error'); }
      cb.disabled = false;
    }));
  };
  renderList();
  wrap.querySelector('#ra-search').addEventListener('input', e => renderList(e.target.value.trim()));
  const done = () => { wrap.remove(); refreshRoles().then(() => { renderServerTab('roles', state.server, state.server.owner_id === me.id); renderMembers(); }); };
  wrap.querySelector('#ra-done').addEventListener('click', done);
  wrap.addEventListener('click', e => { if (e.target === wrap) done(); });
}

/* Manage the built-in Owner / Admin / Member role for each member. */
function openBuiltinAssign(s) {
  const members = state.members || [];
  const wrap = document.createElement('div');
  wrap.className = 'confirm-overlay';
  wrap.innerHTML = `<div class="confirm-box role-assign-box">
    <div class="ra-head">
      <div>
        <h3>Server roles</h3>
        <p class="ra-sub">Choose Admin or Member for each person. The owner is always locked.</p>
      </div>
    </div>
    <div class="ra-search">${icon('search')}<input id="ra-search" placeholder="Search members\\u2026"></div>
    <div class="ra-list" id="ra-list"></div>
    <div class="confirm-actions"><button class="btn" id="ra-done">Done</button></div>
  </div>`;
  document.body.appendChild(wrap);
  hydrateIcons(wrap);
  const list = wrap.querySelector('#ra-list');
  const renderList = (q = '') => {
    const needle = q.toLowerCase();
    const filtered = members.filter(m => !needle ||
      (m.display_name || m.username || '').toLowerCase().includes(needle) ||
      (m.username || '').toLowerCase().includes(needle));
    list.innerHTML = filtered.map(m => {
      const isOwner = m.id === s.owner_id;
      const role = isOwner ? 'owner' : (m.role || 'member');
      return `<div class="ra-row">
        ${avatarHTML(m, 32, m.status || 'offline')}
        <div class="ra-name"><b>${escapeHtml(m.display_name || m.username)}</b><span>${escapeHtml(fullTag(m))}</span></div>
        ${isOwner
          ? `<span class="ra-owner-tag">${icon('crown')} Owner</span>`
          : `<select class="ra-role-select" data-uid="${m.id}">
               <option value="member"${role === 'member' ? ' selected' : ''}>Member</option>
               <option value="admin"${role === 'admin' ? ' selected' : ''}>Admin</option>
             </select>`}
      </div>`;
    }).join('') || '<div class="inv-empty">No members found.</div>';
    list.querySelectorAll('select[data-uid]').forEach(sel => sel.addEventListener('change', async () => {
      const uid = sel.dataset.uid;
      sel.disabled = true;
      try {
        await api('/api/servers/' + s.id + '/members/' + uid, { method: 'PATCH', body: JSON.stringify({ role: sel.value }) });
        const m = members.find(x => x.id === uid);
        if (m) m.role = sel.value;
        toast(sel.value === 'admin' ? 'Member promoted to admin' : 'Admin demoted to member', 'success');
        renderMembers();
      } catch (e) { toast(e.message, 'error'); }
      sel.disabled = false;
    }));
  };
  renderList();
  wrap.querySelector('#ra-search').addEventListener('input', e => renderList(e.target.value.trim()));
  const done = () => { wrap.remove(); refreshRoles().then(() => { renderServerTab('roles', state.server, state.server.owner_id === me.id); renderMembers(); }); };
  wrap.querySelector('#ra-done').addEventListener('click', done);
  wrap.addEventListener('click', e => { if (e.target === wrap) done(); });
}

function openRoleEditor(s, role) {
  const colors = PALETTE;
  const cur = role ? role.color : '#5865F2';
  const cur2 = (role && role.color2) || '';
  const perms = parseRolePerms(role);
  const iconIsImage = role && role.icon && (/^(https?:)?\/\//i.test(role.icon) || role.icon.startsWith('/uploads/') || role.icon.startsWith('data:'));
  const wrap = document.createElement('div');
  wrap.className = 'confirm-overlay';
  wrap.innerHTML = `<div class="confirm-box role-editor">
    <h3>${role ? 'Edit Role' : 'Create Role'}</h3>
    <div class="re-preview" id="re-preview">
      <span class="re-preview-chip" id="re-preview-chip"></span>
      <span class="re-preview-hint">Live preview</span>
    </div>
    <div class="re-grid">
      <div class="field"><label>Role Name</label><input id="role-name" maxlength="32" value="${escapeHtml(role ? role.name : '')}" placeholder="e.g. Moderator, VIP, Artist"></div>
      <div class="field"><label>Icon <span class="opt">image</span></label>
        <div class="re-icon-picker">
          <div class="re-icon-preview" id="role-icon-preview">${iconIsImage ? `<img src="${escapeHtml(role.icon)}" alt="">` : (role && role.icon ? `<span>${escapeHtml(role.icon)}</span>` : icon('image'))}</div>
          <div class="re-icon-actions">
            <button type="button" class="re-icon-btn" id="role-icon-upload">${icon('upload')} Upload</button>
            <button type="button" class="re-icon-clear" id="role-icon-clear" title="Remove icon">${icon('xmark')}</button>
          </div>
          <input type="file" id="role-icon-file" accept="image/*" hidden>
        </div>
      </div>
    </div>
    <div class="field"><label>Primary Colour</label><div class="role-color-row" id="role-color-row">
      ${colors.map(c => `<button type="button" class="role-swatch${c === cur ? ' sel' : ''}" data-color="${c}" style="background:${c}"></button>`).join('')}
    </div></div>
    <div class="field"><label>Gradient <span class="opt">optional second colour</span></label><div class="role-color-row" id="role-color2-row">
      <button type="button" class="role-swatch none${cur2 ? '' : ' sel'}" data-color="">None</button>
      ${colors.map(c => `<button type="button" class="role-swatch${c === cur2 ? ' sel' : ''}" data-color="${c}" style="background:${c}"></button>`).join('')}
    </div></div>
    <div class="re-toggles">
      <label class="re-toggle"><input type="checkbox" id="role-hoist" ${role && role.hoist ? 'checked' : ''}><div><b>Display separately</b><span>Show members with this role in their own group in the member list.</span></div></label>
      <label class="re-toggle"><input type="checkbox" id="role-mention" ${!role || role.mentionable ? 'checked' : ''}><div><b>Allow anyone to mention</b><span>Members can @mention this role in messages.</span></div></label>
    </div>
    <div class="field re-perms-field">
      <div class="re-perms-head"><label>Permissions</label><div class="re-perms-toolbar"><span class="re-perm-count" id="re-perm-count"></span><button type="button" class="re-mini" id="re-perm-all">Select all</button><button type="button" class="re-mini" id="re-perm-none">Clear</button></div></div>
      <div class="re-perms" id="re-perms">
        ${PERM_GROUPS.map(g => {
          const items = ROLE_PERMISSIONS.filter(p => p[3] === g);
          const gIcon = items[0][4];
          return `<div class="re-perm-group">
            <div class="re-perm-group-head">${icon(gIcon)}<span>${g}</span><span class="rpg-count" data-group="${g}"></span></div>
            <div class="re-perm-group-body">
              ${items.map(([key, label, desc]) => `<label class="re-perm"><div class="re-perm-text"><b>${label}</b><span>${desc}</span></div><span class="re-switch"><input type="checkbox" data-perm="${key}" ${perms[key] ? 'checked' : ''}><span class="re-switch-track"></span></span></label>`).join('')}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
    ${role && amIAdmin() ? `<div class="field re-assign-field">
      <div class="re-perms-head"><label>Assigned Members</label><span class="re-perm-count" id="re-assign-count"></span></div>
      <div class="ra-search">${icon('search')}<input id="re-assign-search" placeholder="Search members\u2026"></div>
      <div class="ra-list re-assign-list" id="re-assign-list"></div>
    </div>` : ''}
    <div class="confirm-actions"><button class="btn ghost" id="role-cancel">Cancel</button><button class="btn" id="role-save">${role ? 'Save Changes' : 'Create Role'}</button></div>
  </div>`;
  document.body.appendChild(wrap);
  hydrateIcons(wrap);
  let chosen = cur;
  let chosen2 = cur2;
  let iconUrl = iconIsImage ? role.icon : '';
  const previewChip = wrap.querySelector('#re-preview-chip');
  const nameInput = wrap.querySelector('#role-name');
  const iconPreview = wrap.querySelector('#role-icon-preview');
  const iconFile = wrap.querySelector('#role-icon-file');
  const refreshPreview = () => {
    const nm = nameInput.value.trim() || 'New Role';
    previewChip.innerHTML = (iconUrl ? `<img class="role-ico-img" src="${escapeHtml(iconUrl)}" alt="">` : '') + escapeHtml(nm);
    previewChip.style.color = chosen;
    previewChip.style.background = chosen2 ? `linear-gradient(135deg, ${chosen}22, ${chosen2}22)` : `${chosen}22`;
    previewChip.style.borderColor = chosen2 ? chosen2 : chosen;
  };
  const setIconPreview = () => {
    iconPreview.innerHTML = iconUrl ? `<img src="${escapeHtml(iconUrl)}" alt="">` : icon('image');
    if (!iconUrl) hydrateIcons(iconPreview);
  };
  wrap.querySelector('#role-icon-upload').addEventListener('click', () => iconFile.click());
  iconFile.addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const d = await uploadImage(f); iconUrl = d.url; setIconPreview(); refreshPreview(); }
    catch (err) { toast(err.message, 'error'); }
    e.target.value = '';
  });
  wrap.querySelector('#role-icon-clear').addEventListener('click', () => { iconUrl = ''; setIconPreview(); refreshPreview(); });
  const updatePermCount = () => {
    const total = wrap.querySelectorAll('[data-perm]').length;
    const on = wrap.querySelectorAll('[data-perm]:checked').length;
    const el = wrap.querySelector('#re-perm-count');
    if (el) el.textContent = on + ' of ' + total + ' enabled';
    wrap.querySelectorAll('.re-perm-group').forEach(grp => {
      const g = grp.querySelector('.re-perm-group-head .rpg-count');
      if (!g) return;
      const all = grp.querySelectorAll('[data-perm]').length;
      const sel = grp.querySelectorAll('[data-perm]:checked').length;
      g.textContent = sel + '/' + all;
      g.classList.toggle('full', sel === all && all > 0);
    });
  };
  wrap.querySelectorAll('[data-perm]').forEach(cb => cb.addEventListener('change', updatePermCount));
  const permAll = wrap.querySelector('#re-perm-all');
  if (permAll) permAll.addEventListener('click', () => { wrap.querySelectorAll('[data-perm]').forEach(cb => cb.checked = true); updatePermCount(); });
  const permNone = wrap.querySelector('#re-perm-none');
  if (permNone) permNone.addEventListener('click', () => { wrap.querySelectorAll('[data-perm]').forEach(cb => cb.checked = false); updatePermCount(); });
  wrap.querySelectorAll('#role-color-row .role-swatch').forEach(b => b.addEventListener('click', () => {
    chosen = b.dataset.color;
    wrap.querySelectorAll('#role-color-row .role-swatch').forEach(x => x.classList.toggle('sel', x === b));
    refreshPreview();
  }));
  wrap.querySelectorAll('#role-color2-row .role-swatch').forEach(b => b.addEventListener('click', () => {
    chosen2 = b.dataset.color;
    wrap.querySelectorAll('#role-color2-row .role-swatch').forEach(x => x.classList.toggle('sel', x === b));
    refreshPreview();
  }));
  nameInput.addEventListener('input', refreshPreview);
  refreshPreview();
  setIconPreview();
  updatePermCount();
  /* Inline member assignment for an existing role (owner + admins). */
  const assignList = wrap.querySelector('#re-assign-list');
  if (assignList) {
    const members = state.members || [];
    const assignCount = wrap.querySelector('#re-assign-count');
    const renderAssign = (q = '') => {
      const needle = q.toLowerCase();
      const filtered = members.filter(m => !needle ||
        (m.display_name || m.username || '').toLowerCase().includes(needle) ||
        (m.username || '').toLowerCase().includes(needle));
      assignList.innerHTML = filtered.map(m => {
        const isOwnerRow = m.id === s.owner_id;
        const checked = m.custom_role_id === role.id;
        return `<label class="ra-row">
          ${avatarHTML(m, 32, m.status || 'offline')}
          <div class="ra-name"><b>${escapeHtml(m.display_name || m.username)}</b><span>${escapeHtml(fullTag(m))}</span></div>
          ${isOwnerRow ? `<span class="ra-owner-tag">${icon('crown')} Owner</span>` : ''}
          <input type="checkbox" data-ruid="${m.id}" ${checked ? 'checked' : ''}>
        </label>`;
      }).join('') || '<div class="inv-empty">No members found.</div>';
      hydrateIcons(assignList);
      if (assignCount) {
        const n = members.filter(m => m.custom_role_id === role.id).length;
        assignCount.textContent = n + ' assigned';
      }
      assignList.querySelectorAll('input[data-ruid]').forEach(cb => cb.addEventListener('change', async () => {
        const uid = cb.dataset.ruid;
        cb.disabled = true;
        try {
          await api('/api/servers/' + s.id + '/members/' + uid, { method: 'PATCH', body: JSON.stringify({ custom_role_id: cb.checked ? role.id : null }) });
          const m = members.find(x => x.id === uid);
          if (m) m.custom_role_id = cb.checked ? role.id : null;
          if (assignCount) assignCount.textContent = members.filter(x => x.custom_role_id === role.id).length + ' assigned';
          renderMembers();
        } catch (e) { cb.checked = !cb.checked; toast(e.message, 'error'); }
        cb.disabled = false;
      }));
    };
    renderAssign();
    const rsearch = wrap.querySelector('#re-assign-search');
    if (rsearch) rsearch.addEventListener('input', e => renderAssign(e.target.value.trim()));
  }
  const done = () => wrap.remove();
  wrap.querySelector('#role-cancel').addEventListener('click', done);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) done(); });
  wrap.querySelector('#role-save').addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) { toast('Role name required', 'error'); return; }
    const permObj = {};
    wrap.querySelectorAll('[data-perm]').forEach(cb => { if (cb.checked) permObj[cb.dataset.perm] = true; });
    const payload = {
      name,
      color: chosen,
      color2: chosen2 || '',
      hoist: wrap.querySelector('#role-hoist').checked,
      mentionable: wrap.querySelector('#role-mention').checked,
      permissions: permObj,
      icon: iconUrl
    };
    try {
      if (role) await api('/api/servers/' + s.id + '/roles/' + role.id, { method: 'PATCH', body: JSON.stringify(payload) });
      else await api('/api/servers/' + s.id + '/roles', { method: 'POST', body: JSON.stringify(payload) });
      done();
      toast(role ? 'Role updated' : 'Role created', 'success');
      await refreshRoles();
      renderServerTab('roles', state.server, state.server.owner_id === me.id);
      renderMembers();
    } catch (e) { toast(e.message, 'error'); }
  });
}

async function deleteServerRole(s, rid) {
  const ok = await confirmDialog({ title: 'Delete Role', body: 'Delete this role? Members who have it keep their membership.', confirmText: 'Delete', danger: true });
  if (!ok) return;
  try {
    await api('/api/servers/' + s.id + '/roles/' + rid, { method: 'DELETE' });
    toast('Role deleted', 'success');
    await refreshRoles();
    renderServerTab('roles', state.server, state.server.owner_id === me.id);
  } catch (e) { toast(e.message, 'error'); }
}

async function assignCustomRole(s, uid, rid) {
  try {
    await api('/api/servers/' + s.id + '/members/' + uid, { method: 'PATCH', body: JSON.stringify({ custom_role_id: rid }) });
    toast('Role updated', 'success');
    reloadServerMembers();
  } catch (e) { toast(e.message, 'error'); }
}

function renderModerationTab(body, s) {
  if (!amIAdmin()) { body.innerHTML = '<div class="ss-note">Only the owner and admins can view moderation.</div>'; return; }
  body.innerHTML = `
    <div class="ss-section-title">Banned Members</div>
    <div id="ss-bans"><div class="inv-empty">Loading\u2026</div></div>
    <div class="ss-note">Kick and ban members from the <b>Members</b> tab. Banned members cannot rejoin even with a valid invite.</div>`;
  loadBans(s);
}

async function loadBans(s) {
  try {
    const { bans } = await api('/api/servers/' + s.id + '/bans');
    const el = $('ss-bans'); if (!el) return;
    el.innerHTML = bans.length ? bans.map(b => `<div class="ss-member-row">
      ${avatarHTML(b.user, 36)}
      <div class="ss-member-info"><div class="ss-member-name">${escapeHtml(b.user.display_name || b.user.username)}</div>
      <div class="ss-member-tag">${escapeHtml(fullTag(b.user))}${b.reason ? ' \u2014 ' + escapeHtml(b.reason) : ''}</div></div>
      <div class="ss-member-actions"><button class="ss-member-role-btn" data-unban="${b.user_id}">${icon('unlock')} Unban</button></div>
    </div>`).join('') : '<div class="inv-empty">No banned members.</div>';
    hydrateIcons(el);
    el.querySelectorAll('[data-unban]').forEach(btn => btn.addEventListener('click', () => unbanMember(s, btn.dataset.unban)));
  } catch (e) { const el = $('ss-bans'); if (el) el.innerHTML = '<div class="inv-empty">' + escapeHtml(e.message) + '</div>'; }
}

function renderSafetyTab(body, s) {
  const admin = amIAdmin();
  const st = state.serverSettings || {};
  const channels = (state.channels || []).filter(c => c.type === 'text');
  body.innerHTML = `
    <div class="ss-section-title">Safety & Moderation</div>
    <div class="ss-field-grid">
      <div class="ss-field"><label>Verification Level</label>
        <select id="ss-verif" ${admin ? '' : 'disabled'}>
          ${['none','low','medium','high'].map(v => `<option value="${v}"${st.verification_level === v ? ' selected' : ''}>${{none:'None',low:'Low',medium:'Medium',high:'Highest'}[v]}</option>`).join('')}
        </select>
        <div class="hint">How strict membership checks are before members can chat.</div>
      </div>
      <div class="ss-field"><label>Default Notifications</label>
        <select id="ss-notif" ${admin ? '' : 'disabled'}>
          ${['all','mentions','none'].map(v => `<option value="${v}"${st.default_notifications === v ? ' selected' : ''}>${{all:'All Messages',mentions:'Only @mentions',none:'Nothing'}[v]}</option>`).join('')}
        </select>
        <div class="hint">What new members are notified about by default.</div>
      </div>
      <div class="ss-field"><label>Slow Mode (seconds between messages)</label>
        <input type="number" id="ss-slow" min="0" max="21600" value="${st.slow_mode || 0}" ${admin ? '' : 'disabled'}>
        <div class="hint">0 = off. Members must wait this long between messages.</div>
      </div>
      <div class="ss-field"><label>System Messages Channel</label>
        <select id="ss-sys" ${admin ? '' : 'disabled'}>
          <option value="">None</option>
          ${channels.map(c => `<option value="${c.id}"${st.system_channel_id === c.id ? ' selected' : ''}>#${escapeHtml(c.name)}</option>`).join('')}
        </select>
        <div class="hint">Where join and moderation notices are posted.</div>
      </div>
    </div>
    <div class="set-row"><div><div class="sr-title">Explicit Content Filter</div><div class="sr-desc">Block messages and attachment names that contain explicit language or media. Blocked messages are never posted.</div></div><div class="toggle${st.explicit_filter ? ' on' : ''}" data-ss-toggle="explicit_filter"></div></div>
    <div class="set-row"><div><div class="sr-title">Allow @everyone / @here</div><div class="sr-desc">Let the owner and admins ping the whole server (@everyone) or only members who are online (@here). When off, these pings are ignored.</div></div><div class="toggle${st.allow_everyone ? ' on' : ''}" data-ss-toggle="allow_everyone"></div></div>
    ${admin ? `<div class="ss-actions"><button class="btn" id="ss-save-settings">${icon('check')} Save Settings</button></div>` : '<div class="ss-note">Only the owner and admins can edit these settings.</div>'}
  `;
  hydrateIcons(body);
  if (!admin) return;
  body.querySelectorAll('[data-ss-toggle]').forEach(t => t.addEventListener('click', () => t.classList.toggle('on')));
  $('ss-save-settings').addEventListener('click', () => saveServerSettings(s));
}

async function saveServerSettings(s) {
  const body = $('ss-body');
  const payload = {
    verification_level: $('ss-verif').value,
    default_notifications: $('ss-notif').value,
    slow_mode: parseInt($('ss-slow').value, 10) || 0,
    system_channel_id: $('ss-sys').value || null,
    explicit_filter: body.querySelector('[data-ss-toggle="explicit_filter"]').classList.contains('on'),
    allow_everyone: body.querySelector('[data-ss-toggle="allow_everyone"]').classList.contains('on')
  };
  try {
    const { settings } = await api('/api/servers/' + s.id + '/settings', { method: 'PATCH', body: JSON.stringify(payload) });
    state.serverSettings = settings;
    toast('Server settings saved', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

async function kickMember(s, uid) {
  const m = state.members.find(x => x.id === uid);
  const ok = await confirmDialog({ title: 'Kick Member', body: `Kick <b>${escapeHtml(m ? (m.display_name || m.username) : 'this member')}</b> from the server? They can rejoin with an invite.`, confirmText: 'Kick', danger: true });
  if (!ok) return;
  try { await api('/api/servers/' + s.id + '/kick', { method: 'POST', body: JSON.stringify({ user_id: uid }) }); toast('Member kicked', 'success'); reloadServerMembers(); }
  catch (e) { toast(e.message, 'error'); }
}

async function banMember(s, uid) {
  const m = state.members.find(x => x.id === uid);
  const reason = await promptDialog({ title: 'Ban Member', label: 'Reason (optional)', placeholder: `Why are you banning ${m ? (m.display_name || m.username) : 'this member'}?`, confirmText: 'Ban', value: '' });
  if (reason === null) return;
  try { await api('/api/servers/' + s.id + '/bans', { method: 'POST', body: JSON.stringify({ user_id: uid, reason }) }); toast('Member banned', 'success'); reloadServerMembers(); }
  catch (e) { toast(e.message, 'error'); }
}

async function unbanMember(s, uid) {
  try {
    await api('/api/servers/' + s.id + '/bans/' + uid, { method: 'DELETE' });
    toast('Member unbanned', 'success');
    if (document.querySelector('.ss-nav-item.active')?.dataset.tab === 'moderation') renderServerTab('moderation', s, s.owner_id === me.id);
  } catch (e) { toast(e.message, 'error'); }
}

async function timeoutMember(s, uid) {
  const mins = await promptDialog({ title: 'Time Out Member', label: 'Duration in minutes', value: '10', placeholder: '10', confirmText: 'Time Out' });
  if (mins === null) return;
  const n = Math.max(0, parseInt(mins, 10) || 0);
  try { await api('/api/servers/' + s.id + '/members/' + uid + '/timeout', { method: 'POST', body: JSON.stringify({ minutes: n }) }); toast(n > 0 ? `Member timed out for ${n} min` : 'Timeout removed', 'success'); }
  catch (e) { toast(e.message, 'error'); }
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
    if (data.settings) state.serverSettings = data.settings;
    if (data.roles) state.roles = data.roles;
    renderMembers();
    const activeTab = document.querySelector('.ss-nav-item.active');
    if (activeTab && ['members', 'roles', 'moderation'].includes(activeTab.dataset.tab)) {
      renderServerTab(activeTab.dataset.tab, state.server, state.server.owner_id === me.id);
    }
  } catch (e) { /* ignore */ }
}

/* Coalesce bursts of member updates (role changes, joins, presence) into one
   refresh so the server is not re-fetched several times in a row. */
const scheduleMembersReload = debounce(() => { reloadServerMembers(); }, 250);

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
/* The set of permissions the signed-in user holds in the current server,
   mirroring the server-side memberPermissions() logic. */
function myPerms() {
  const s = state.server;
  const perms = new Set();
  if (!s || !me) return perms;
  if (s.owner_id === me.id) { perms.add('*'); return perms; }
  const m = (state.members || []).find(x => x.id === me.id);
  if (!m) return perms;
  if (m.role === 'owner' || m.role === 'admin') perms.add('*');
  if (m.custom_role_id) {
    const r = (state.roles || []).find(x => x.id === m.custom_role_id);
    if (r) { const p = parseRolePerms(r); for (const k of Object.keys(p)) if (p[k]) perms.add(k); }
  }
  return perms;
}
function can(perm) {
  const p = myPerms();
  return p.has('*') || p.has('administrator') || p.has(perm);
}
function amIAdmin() {
  const s = state.server;
  if (!s) return false;
  if (s.owner_id === me.id) return true;
  const m = state.members.find(x => x.id === me.id);
  if (m && (m.role === 'owner' || m.role === 'admin')) return true;
  /* A custom role that grants any management permission also unlocks the
     management UI (the server still enforces each specific permission). */
  return can('administrator') || can('manage_channels') || can('manage_roles') ||
    can('manage_members') || can('manage_server') || can('manage_messages') ||
    can('kick_members') || can('ban_members');
}

/* Platform administrator = the account named "keep" (or whatever the server
   lists in ADMIN_USERNAMES) OR any account the owner has whitelisted. The
   backend is the real gate; this only controls whether the Admin Panel button
   is rendered. */
function isPlatformAdmin() {
  return !!(me && me.platform_admin);
}
function isPlatformOwner() {
  return !!(me && me.platform_owner);
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
    items.push({ label: 'Edit Channel', icon: 'sliders', onClick: () => openEditChannel(c) });
    items.push({ sep: true });
    items.push({ label: 'New Text Channel', icon: 'plus', onClick: () => openCreateChannel('text', c.category_id || null) });
    items.push({ label: 'New Voice Channel', icon: 'volume-high', onClick: () => openCreateChannel('voice', c.category_id || null) });
    items.push({ label: 'New Category', icon: 'folder', onClick: () => createCategory() });
    items.push({ sep: true });
    items.push({ label: 'Rename Channel', icon: 'pencil', onClick: () => renameChannel(c) });
    items.push({ label: 'Edit Channel Topic', icon: 'note', onClick: () => editChannelTopic(c) });
    items.push({ sep: true });
    items.push({ label: 'Move Up', icon: 'arrow-up', onClick: () => moveChannelBy(c, -1) });
    items.push({ label: 'Move Down', icon: 'arrow-down', onClick: () => moveChannelBy(c, 1) });
    items.push({ sep: true });
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
    const r = await api('/api/servers/' + state.server.id + '/channels/' + c.id, { method: 'PATCH', body: JSON.stringify({ name: clean }) });
    const fresh = (r && r.channel) || Object.assign({}, c, { name: clean });
    state.channels = (state.channels || []).map(x => x.id === c.id ? fresh : x);
    if (state.channel && state.channel.id === c.id) { state.channel = fresh; $('chat-title').textContent = fresh.name; }
    renderChannelList();
    toast('Channel renamed', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

async function editChannelTopic(c) {
  const topic = await promptDialog({ title: 'Edit Channel Topic', body: 'Set a short topic that appears under the channel name.', label: 'Topic', value: c.topic || '', confirmText: 'Save Topic', maxlength: 200, placeholder: 'What is this channel about?' });
  if (topic === null) return;
  try {
    const r = await api('/api/servers/' + state.server.id + '/channels/' + c.id, { method: 'PATCH', body: JSON.stringify({ topic }) });
    const fresh = (r && r.channel) || Object.assign({}, c, { topic });
    state.channels = (state.channels || []).map(x => x.id === c.id ? fresh : x);
    if (state.channel && state.channel.id === c.id) { state.channel = fresh; $('chat-topic').textContent = fresh.topic || ''; }
    renderChannelList();
    toast('Channel topic updated', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteChannel(c) {
  const ok = await confirmDialog({ title: 'Delete Channel', body: `Delete <b>#${escapeHtml(c.name)}</b>? Every message in this channel will be permanently removed.`, confirmText: 'Delete Channel', danger: true });
  if (!ok) return;
  try {
    await api('/api/servers/' + state.server.id + '/channels/' + c.id, { method: 'DELETE' });
    state.channels = (state.channels || []).filter(x => x.id !== c.id);
    if (state.channel && state.channel.id === c.id) {
      state.channel = null;
      const first = state.channels.find(x => x.type === 'text') || state.channels[0];
      if (first) openChannel(first.id);
      else { state.messages = []; renderEmptyChat('This server has no channels yet.'); }
    }
    renderChannelList();
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
  if (!el) return;
  if (el.dataset.closing) return;
  el.dataset.closing = '1';
  el.classList.add('mini-out');
  setTimeout(() => { if (el.parentNode) el.remove(); }, 150);
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
    myChosenStatus = status; userIsIdle = false; tabAwayOffline = false; resetIdleTimer();
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
  $('hdr-members').addEventListener('click', () => { saveSetting('showMembers', !state.showMembers); renderMembers(); });
  $('hdr-pins').addEventListener('click', (e) => { e.stopPropagation(); openPinsPanel(); });
  $('hdr-search').addEventListener('click', (e) => { e.stopPropagation(); openSearch(); });
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
  $('attach-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    showContextMenu(r.left, r.top - 148, [
      { label: 'Images', icon: 'image', onClick: () => pickFile('image/*') },
      { label: 'Videos & GIFs', icon: 'film', onClick: () => pickFile('video/*,image/gif') },
      { label: 'Any File', icon: 'upload', onClick: () => pickFile('') }
    ]);
  });
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
    const sp = e.target.closest('.spoiler');
    if (sp) { sp.classList.toggle('revealed'); return; }
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
        !e.target.closest('#hdr-notifs') && !e.target.closest('.mention-pop') && !e.target.closest('#sidebar-header') &&
        !e.target.closest('.mini-profile') && !e.target.closest('#user-panel-me')) {
      closePopovers();
    }
  });
  /* "/" focuses the message box (Discord's quick-reply shortcut).
     Desktop only, and never while typing in a field or with a dialog open. */
  const isDesktop = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!isDesktop()) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (document.querySelector('.modal-overlay:not(.hidden), #confirm-overlay, .lightbox, .emoji-picker, .context-menu, .dropdown-menu')) return;
    const input = $('message-input');
    if (!input || $('composer').classList.contains('hidden')) return;
    e.preventDefault();
    input.focus();
    const len = input.value.length;
    try { input.setSelectionRange(len, len); } catch (err) { /* ignore */ }
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

/* ============================================================
   SOFT UPDATE (deploy watcher)
   ------------------------------------------------------------
   Polls /api/version, which returns the build id of the running server
   (Render's RENDER_GIT_COMMIT, so it changes on every deploy). The id the page
   was loaded with is captured on the first poll; if a later poll reports a
   different id, a new build has been deployed and we show a centred prompt that
   counts down from 20 seconds and then reloads automatically. */
let updateBaseline = null;
let updateTimer = null;
let updateShown = false;

async function startUpdateWatcher() {
  try {
    const v = await api('/api/version', { retries: 1 });
    if (v && v.build) updateBaseline = v.build;
  } catch (e) { /* version probe is best-effort */ }
  /* Poll every 30s. Skip while the tab is hidden so background tabs stay quiet;
     check immediately when the tab becomes visible again. */
  updateTimer = setInterval(checkForUpdate, 30000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkForUpdate();
  });
}

async function checkForUpdate() {
  if (updateShown || document.hidden) return;
  try {
    const v = await api('/api/version', { retries: 1 });
    if (!v || !v.build) return;
    if (updateBaseline === null) { updateBaseline = v.build; return; }
    if (v.build !== updateBaseline) {
      updateBaseline = v.build;
      showUpdatePrompt(v.build);
    }
  } catch (e) { /* ignore transient errors */ }
}

function showUpdatePrompt(build) {
  if (updateShown) return;
  updateShown = true;
  if (updateTimer) { clearInterval(updateTimer); updateTimer = null; }

  const buildLabel = build ? String(build).slice(0, 7) : 'latest';
  let remaining = 20;
  const overlay = document.createElement('div');
  overlay.className = 'update-overlay';
  overlay.innerHTML = `
    <div class="update-card" role="dialog" aria-modal="true" aria-labelledby="update-title">
      <div class="update-head">
        <span class="update-pill">New build available</span>
        <h2 class="update-title" id="update-title">A new version of Crossroads is ready</h2>
        <p class="update-text">Refresh to load the latest deployment. Everything you have open is saved on the server, so nothing is lost.</p>
      </div>
      <ul class="update-list">
        <li><span class="update-tick" aria-hidden="true"></span>Performance and reliability improvements</li>
        <li><span class="update-tick" aria-hidden="true"></span>Latest fixes and interface polish</li>
        <li><span class="update-tick" aria-hidden="true"></span>Your messages, friends and settings stay intact</li>
      </ul>
      <div class="update-meta">
        <span class="update-build">Build <code>${buildLabel}</code></span>
        <span class="update-count">Refreshing in <span class="update-secs">20</span>s</span>
      </div>
      <div class="update-actions">
        <button type="button" class="update-btn ghost" id="update-later">Later</button>
        <button type="button" class="update-btn primary" id="update-refresh">Refresh now</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const secsEl = overlay.querySelector('.update-secs');
  const refresh = () => { try { location.reload(); } catch (e) {} };
  overlay.querySelector('#update-refresh').addEventListener('click', refresh);
  overlay.querySelector('#update-later').addEventListener('click', () => {
    if (tick) clearInterval(tick);
    overlay.remove();
  });

  const tick = setInterval(() => {
    remaining -= 1;
    if (secsEl) secsEl.textContent = String(Math.max(0, remaining));
    if (remaining <= 0) {
      clearInterval(tick);
      refresh();
    }
  }, 1000);
}
