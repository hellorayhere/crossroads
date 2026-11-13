const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/* Restore the database from durable storage (private GitHub repo) BEFORE it is
   opened. Render's free plan has an ephemeral disk, so this is what keeps user
   data alive across deploys. Runs in a child process so this synchronous module
   can block until the download finishes. No-op unless GH_DATA_REPO is set.

   Only the DATABASE is fetched here (a few hundred KB). Uploaded media can be
   hundreds of megabytes, and downloading it inside this blocking child used to
   exceed the timeout below - which aborted the whole restore and left every
   image/video/audio file 404ing. Media is now streamed in by the server after
   it starts listening (see persist.restoreUploads / fetchUpload). */
if (process.env.GH_DATA_REPO && process.env.GH_DATA_TOKEN) {
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'persist.js'), 'restore', '--db-only'], {
      stdio: 'inherit',
      timeout: 90000,
      env: process.env
    });
  } catch (e) {
    console.error('[db] remote restore skipped:', e.message);
  }
}

const db = new Database(path.join(DATA_DIR, 'crossroads.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  discriminator TEXT NOT NULL,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  pronouns TEXT DEFAULT '',
  custom_status TEXT DEFAULT '',
  banner_color TEXT DEFAULT '#5865F2',
  avatar TEXT,
  avatar_url TEXT,
  banner TEXT,
  banner_url TEXT,
  accent_color TEXT DEFAULT '#5865F2',
  bio TEXT DEFAULT '',
  status TEXT DEFAULT 'online',
  created_at INTEGER NOT NULL,
  UNIQUE(username, discriminator)
);

CREATE TABLE IF NOT EXISTS servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT,
  icon_url TEXT,
  banner_url TEXT,
  description TEXT DEFAULT '',
  owner_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  max_uses INTEGER,
  uses INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS server_members (
  server_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  role TEXT DEFAULT 'member',
  PRIMARY KEY (server_id, user_id)
);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'text',
  topic TEXT DEFAULT '',
  position INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT,
  dm_id TEXT,
  user_id TEXT NOT NULL,
  content TEXT DEFAULT '',
  attachment_url TEXT,
  attachment_name TEXT,
  attachment_type TEXT,
  created_at INTEGER NOT NULL,
  edited_at INTEGER,
  pinned INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reactions (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(message_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS dm_channels (
  id TEXT PRIMARY KEY,
  user1_id TEXT NOT NULL,
  user2_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(user1_id, user2_id)
);

CREATE TABLE IF NOT EXISTS dm_hidden (
  dm_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (dm_id, user_id)
);

CREATE TABLE IF NOT EXISTS friendships (
  id TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL,
  addressee_id TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  UNIQUE(requester_id, addressee_id)
);

CREATE TABLE IF NOT EXISTS blocks (
  id TEXT PRIMARY KEY,
  blocker_id TEXT NOT NULL,
  blocked_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  content TEXT DEFAULT '',
  updated_at INTEGER NOT NULL,
  UNIQUE(owner_id, target_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  data TEXT DEFAULT '{}',
  read INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

/* Per-server configuration (safety, moderation defaults, system channel). */
CREATE TABLE IF NOT EXISTS server_settings (
  server_id TEXT PRIMARY KEY,
  verification_level TEXT DEFAULT 'none',
  explicit_filter INTEGER DEFAULT 0,
  allow_everyone INTEGER DEFAULT 1,
  default_notifications TEXT DEFAULT 'all',
  slow_mode INTEGER DEFAULT 0,
  system_channel_id TEXT,
  updated_at INTEGER
);

/* Banned members. A ban removes the member and blocks them from rejoining. */
CREATE TABLE IF NOT EXISTS server_bans (
  server_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  moderator_id TEXT,
  reason TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (server_id, user_id)
);

/* Custom server roles (name + colour), assignable to members. */
CREATE TABLE IF NOT EXISTS server_roles (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#5865F2',
  position INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

/* Platform profile badges: a custom image + a name, assignable to users by
   the admin console. Purely additive; existing data is untouched. */
CREATE TABLE IF NOT EXISTS profile_badges (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon_url TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_badges (
  user_id TEXT NOT NULL,
  badge_id TEXT NOT NULL,
  assigned_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, badge_id)
);

/* Lightweight moderation audit trail. */
CREATE TABLE IF NOT EXISTS server_audit (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  target_id TEXT,
  detail TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_messages_dm ON messages(dm_id);
CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_friendships_req ON friendships(requester_id);
CREATE INDEX IF NOT EXISTS idx_friendships_add ON friendships(addressee_id);
CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks(blocker_id);
CREATE INDEX IF NOT EXISTS idx_notes_owner ON notes(owner_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_invites_server ON invites(server_id);
CREATE INDEX IF NOT EXISTS idx_dm_hidden_user ON dm_hidden(user_id);
CREATE INDEX IF NOT EXISTS idx_server_bans_server ON server_bans(server_id);
CREATE INDEX IF NOT EXISTS idx_server_roles_server ON server_roles(server_id);
CREATE INDEX IF NOT EXISTS idx_server_audit_server ON server_audit(server_id);
`);

/* ---------------- Migrations ----------------
   Older databases were created before the email field became optional and
   before the profile columns (display_name, pronouns, custom_status,
   banner_color) existed. Bring any existing database up to date. */
function migrate() {
  const cols = db.prepare('PRAGMA table_info(users)').all();
  const names = cols.map(c => c.name);
  const emailCol = cols.find(c => c.name === 'email');
  const emailNotNull = emailCol ? emailCol.notnull === 1 : false;

  // 1. Add any missing profile columns.
  const additions = {
    display_name: 'TEXT',
    pronouns: "TEXT DEFAULT ''",
    custom_status: "TEXT DEFAULT ''",
    banner_color: "TEXT DEFAULT '#5865F2'",
    settings: "TEXT DEFAULT '{}'",
    username_changed_at: 'INTEGER',
    /* Optional fixed 6-digit code for a test/demo account. When set, this code
       is always accepted (and shown) instead of the rotating TOTP value. */
    twofa_fixed_code: 'TEXT',
    /* Self-service account state. `deactivated` is a reversible pause: the
       owner can sign back in to reactivate. `deleted` is a soft delete that
       scrubs personal data but keeps the row so other people's message
       history and replies are never broken. */
    deactivated: 'INTEGER DEFAULT 0',
    deactivated_at: 'INTEGER',
    deleted: 'INTEGER DEFAULT 0',
    deleted_at: 'INTEGER'
  };
  for (const [col, def] of Object.entries(additions)) {
    if (!names.includes(col)) {
      db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
    }
  }

  // 1b. Additive migrations for messages (replies + mentions). Never destructive.
  const msgCols = db.prepare('PRAGMA table_info(messages)').all().map(c => c.name);
  if (!msgCols.includes('reply_to_id')) {
    try { db.exec('ALTER TABLE messages ADD COLUMN reply_to_id TEXT'); } catch (e) {}
  }
  if (!msgCols.includes('mentions')) {
    try { db.exec("ALTER TABLE messages ADD COLUMN mentions TEXT DEFAULT '[]'"); } catch (e) {}
  }
  // 1b-2. Additive migration for pinned messages (never destructive).
  if (!msgCols.includes('pinned')) {
    try { db.exec('ALTER TABLE messages ADD COLUMN pinned INTEGER DEFAULT 0'); } catch (e) {}
  }
  // 1b-2b. Additive migration: rich embed payload (webhook / link embeds).
  //        Stored as JSON so a webhook can send a custom embed card.
  if (!msgCols.includes('embed')) {
    try { db.exec('ALTER TABLE messages ADD COLUMN embed TEXT'); } catch (e) {}
  }
  // 1b-3. Additive migration: store attachment byte size (for "2.4 MB" labels).
  if (!msgCols.includes('attachment_size')) {
    try { db.exec('ALTER TABLE messages ADD COLUMN attachment_size INTEGER'); } catch (e) {}
  }
  /* 1b-4. Additive migration: plaintext mirror. The E2E layer still stores
     ciphertext in `content`, but a readable copy is kept here so replies,
     notifications and every device can show the real message instead of a
     placeholder. Additive only: existing rows simply keep NULL. */
  if (!msgCols.includes('content_plain')) {
    try { db.exec('ALTER TABLE messages ADD COLUMN content_plain TEXT'); } catch (e) {}
  }
  /* 1b-5. Additive migration: attachment spoiler + description. Spoiler hides
     media behind a blur until clicked; description is optional alt text. */
  if (!msgCols.includes('attachment_spoiler')) {
    try { db.exec('ALTER TABLE messages ADD COLUMN attachment_spoiler INTEGER DEFAULT 0'); } catch (e) {}
  }
  if (!msgCols.includes('attachment_description')) {
    try { db.exec('ALTER TABLE messages ADD COLUMN attachment_description TEXT'); } catch (e) {}
  }
  /* 1b-6. Additive migration: message kind. NULL/'text' is a normal message;
     'call' marks an automatic "X started a call" event row. Additive only. */
  if (!msgCols.includes('kind')) {
    try { db.exec('ALTER TABLE messages ADD COLUMN kind TEXT'); } catch (e) {}
  }
  // The pinned index must be created AFTER the column exists (safe for old DBs).
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_messages_pinned ON messages(pinned)'); } catch (e) {}

  // 1c. Additive migrations for servers (banner + description). Never destructive.
  const srvCols = db.prepare('PRAGMA table_info(servers)').all().map(c => c.name);
  if (!srvCols.includes('banner_url')) {
    try { db.exec('ALTER TABLE servers ADD COLUMN banner_url TEXT'); } catch (e) {}
  }
  if (!srvCols.includes('description')) {
    try { db.exec("ALTER TABLE servers ADD COLUMN description TEXT DEFAULT ''"); } catch (e) {}
  }
  // Banner framing: zoom (scale) and vertical/horizontal position, so the
  // Overview tab can offer scale/position tools. Additive, never destructive.
  if (!srvCols.includes('banner_scale')) {
    try { db.exec('ALTER TABLE servers ADD COLUMN banner_scale REAL DEFAULT 1'); } catch (e) {}
  }
  if (!srvCols.includes('banner_position')) {
    try { db.exec("ALTER TABLE servers ADD COLUMN banner_position TEXT DEFAULT '50% 50%'"); } catch (e) {}
  }

  /* 1c-1b. Additive migration: richer per-server settings. These power the new
     Community tab (welcome message, rules, member invites, AFK channel, 2FA
     requirement, raid protection). Every column is added only when missing and
     defaults are chosen so existing servers behave exactly as before. */
  const ssCols = db.prepare('PRAGMA table_info(server_settings)').all().map(c => c.name);
  const ssAdditions = {
    welcome_message: "TEXT DEFAULT ''",
    rules: "TEXT DEFAULT ''",
    allow_member_invites: 'INTEGER DEFAULT 1',
    afk_channel_id: 'TEXT',
    afk_timeout: 'INTEGER DEFAULT 300',
    require_2fa: 'INTEGER DEFAULT 0',
    raid_protection: 'INTEGER DEFAULT 0',
    system_welcome: 'INTEGER DEFAULT 1',
    default_role_id: 'TEXT',
    invite_splash: 'INTEGER DEFAULT 1',
    community_name: "TEXT DEFAULT ''"
  };
  for (const [col, def] of Object.entries(ssAdditions)) {
    if (!ssCols.includes(col)) {
      try { db.exec(`ALTER TABLE server_settings ADD COLUMN ${col} ${def}`); } catch (e) {}
    }
  }

  // 1c-2. Additive migration: channel categories. A category groups channels
  // under a collapsible header, exactly like Discord. Channels keep working
  // without one (category_id NULL means "no category"). Never destructive.
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS channel_categories (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      name TEXT NOT NULL,
      position INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    )`);
  } catch (e) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_chan_cat_server ON channel_categories(server_id)'); } catch (e) {}
  const chCols = db.prepare('PRAGMA table_info(channels)').all().map(c => c.name);
  if (!chCols.includes('category_id')) {
    try { db.exec('ALTER TABLE channels ADD COLUMN category_id TEXT'); } catch (e) {}
  }
  if (!chCols.includes('slow_mode')) {
    try { db.exec('ALTER TABLE channels ADD COLUMN slow_mode INTEGER DEFAULT 0'); } catch (e) {}
  }
  /* Extra per-channel options exposed by the expanded Edit Channel dialog.
     All additive: existing channels simply default to "normal". */
  const extraChCols = {
    read_only: 'INTEGER DEFAULT 0',   // members can read but not send messages
    nsfw: 'INTEGER DEFAULT 0',        // age-restricted channel marker
    user_limit: 'INTEGER DEFAULT 0',  // voice channel user cap (0 = unlimited)
    bitrate: 'INTEGER DEFAULT 64'     // voice channel bitrate in kbps
  };
  for (const [col, def] of Object.entries(extraChCols)) {
    if (!chCols.includes(col)) {
      try { db.exec(`ALTER TABLE channels ADD COLUMN ${col} ${def}`); } catch (e) {}
    }
  }

  /* 1c-2. Per-channel incoming webhook. A channel has at most one webhook.
     The user presses "Create Webhook" and the server mints a random URL such
     as https://host/api/webhooks/<token>. Anything POSTed to that URL is
     posted into this channel under the webhook's name + avatar.
     Purely additive: the table is created if missing and never dropped. */
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS channel_webhooks (
      channel_id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      name TEXT,
      avatar_url TEXT,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
  } catch (e) {}
  /* Later additions for the incoming-webhook flow. */
  try {
    const whCols = db.prepare('PRAGMA table_info(channel_webhooks)').all().map(c => c.name);
    if (!whCols.includes('token')) {
      try { db.exec('ALTER TABLE channel_webhooks ADD COLUMN token TEXT'); } catch (e) {}
    }
    if (!whCols.includes('bot_user_id')) {
      try { db.exec('ALTER TABLE channel_webhooks ADD COLUMN bot_user_id TEXT'); } catch (e) {}
    }
    if (!whCols.includes('last_used_at')) {
      try { db.exec('ALTER TABLE channel_webhooks ADD COLUMN last_used_at INTEGER'); } catch (e) {}
    }
  } catch (e) {}

  // 1d. Additive migration for server member roles (owner / admin / member).
  const memCols = db.prepare('PRAGMA table_info(server_members)').all().map(c => c.name);
  if (!memCols.includes('role')) {
    try { db.exec("ALTER TABLE server_members ADD COLUMN role TEXT DEFAULT 'member'"); } catch (e) {}
  }
  // 1d-2. Additive migration: optional custom role assignment per member.
  if (!memCols.includes('custom_role_id')) {
    try { db.exec('ALTER TABLE server_members ADD COLUMN custom_role_id TEXT'); } catch (e) {}
  }
  // 1d-3. Additive migration: per-member timeout (moderation).
  if (!memCols.includes('timeout_until')) {
    try { db.exec('ALTER TABLE server_members ADD COLUMN timeout_until INTEGER'); } catch (e) {}
  }
  // 1d-4. Additive migration: hidden bot accounts that back incoming webhooks.
  //        They are real user rows (so messages have a valid author) but must
  //        never show up in search, member lists, or friends.
  try {
    const uCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
    if (!uCols.includes('is_webhook')) {
      try { db.exec('ALTER TABLE users ADD COLUMN is_webhook INTEGER DEFAULT 0'); } catch (e) {}
    }
  } catch (e) {}
  // Backfill: make sure every server owner is marked as 'owner' (never destructive).
  try {
    db.exec(`UPDATE server_members SET role = 'owner'
      WHERE (role IS NULL OR role = 'member')
        AND EXISTS (SELECT 1 FROM servers s WHERE s.id = server_members.server_id AND s.owner_id = server_members.user_id)`);
  } catch (e) {}

  /* ---------------- Admin / platform migrations (all additive) ----------------
     These power the platform-wide admin panel. Nothing here is destructive:
     every column is added only when missing and every table uses IF NOT EXISTS,
     so existing accounts, servers, channels and messages are left untouched. */
  const adminUserCols = {
    token_version: 'INTEGER DEFAULT 0',   // bump to revoke every session for a user
    verified: 'INTEGER DEFAULT 0',        // platform-verified badge
    muted: 'INTEGER DEFAULT 0',           // platform-wide mute (cannot post)
    disabled: 'INTEGER DEFAULT 0',        // account disabled (cannot sign in)
    last_seen_at: 'INTEGER'               // last activity timestamp (admin overview)
  };
  for (const [col, def] of Object.entries(adminUserCols)) {
    if (!names.includes(col)) {
      try { db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`); } catch (e) {}
    }
  }

  /* ---------------- Two-step login (TOTP) ----------------
     Purely additive. twofa_secret holds a base32 shared secret; the six-digit
     code is derived from it and the current time, so no external service is
     needed. twofa_enabled gates whether login requires the code. */
  const twofaCols = {
    twofa_enabled: 'INTEGER DEFAULT 0',
    twofa_secret: 'TEXT'
  };
  for (const [col, def] of Object.entries(twofaCols)) {
    if (!names.includes(col)) {
      try { db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`); } catch (e) {}
    }
  }

  /* ---------------- Device / session tracking ----------------
     One row per successful sign-in. The JWT carries the session id, so a
     device can be listed on the Authorized Devices page and revoked
     individually. Purely additive; old tokens without a session id keep
     working. */
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_agent TEXT DEFAULT '',
      ip TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)');
  } catch (e) {}

  /* ---------------- Trusted devices for two-step login ----------------
     When a user ticks "Trust this device for 30 days" while entering their
     code, we store a hashed device token here. A later sign-in from the same
     browser can present the token and skip the code until it expires. Purely
     additive: the table is created only if missing. */
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS trusted_devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      device_label TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON trusted_devices(user_id)');
  } catch (e) {}

  /* ---------------- Performance indexes ----------------
     These keep message pagination, member lookups and DM lists fast as the
     database grows. All are IF NOT EXISTS so they are safe to re-run. */
  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_channel_created ON messages(channel_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_messages_dm_created ON messages(dm_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_server_members_server ON server_members(server_id);
      CREATE INDEX IF NOT EXISTS idx_server_members_user ON server_members(user_id);
      CREATE INDEX IF NOT EXISTS idx_server_members_role ON server_members(server_id, custom_role_id);
      CREATE INDEX IF NOT EXISTS idx_dm_channels_a ON dm_channels(user_a);
      CREATE INDEX IF NOT EXISTS idx_dm_channels_b ON dm_channels(user_b);
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_server_roles_pos ON server_roles(server_id, position);
    `);
  } catch (e) {}

  /* ---------------- Richer server roles ----------------
     hoist: show this role's members as their own group in the member list
            (separate from the online/offline grouping), like Discord.
     mentionable / permissions / color2 / icon round out the role editor. */
  const roleCols = db.prepare('PRAGMA table_info(server_roles)').all().map(c => c.name);
  const roleAdds = {
    hoist: 'INTEGER DEFAULT 0',
    mentionable: 'INTEGER DEFAULT 1',
    color2: "TEXT DEFAULT ''",
    permissions: "TEXT DEFAULT '{}'",
    icon: 'TEXT'
  };
  for (const [col, def] of Object.entries(roleAdds)) {
    if (!roleCols.includes(col)) {
      try { db.exec(`ALTER TABLE server_roles ADD COLUMN ${col} ${def}`); } catch (e) {}
    }
  }

  // Server-level flags used by the admin panel.
  const adminSrvCols = { locked: 'INTEGER DEFAULT 0', featured: 'INTEGER DEFAULT 0' };
  for (const [col, def] of Object.entries(adminSrvCols)) {
    if (!srvCols.includes(col)) {
      try { db.exec(`ALTER TABLE servers ADD COLUMN ${col} ${def}`); } catch (e) {}
    }
  }

  // Platform-wide bans (separate from per-server bans).
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS global_bans (
      user_id TEXT PRIMARY KEY,
      username TEXT DEFAULT '',
      reason TEXT DEFAULT '',
      moderator_id TEXT,
      created_at INTEGER NOT NULL
    )`);
  } catch (e) {}

  // Simple key/value store for platform settings (registration, maintenance…).
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS global_settings (
      key TEXT PRIMARY KEY,
      value TEXT DEFAULT ''
    )`);
  } catch (e) {}

  // Audit trail for every admin action.
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS admin_audit (
      id TEXT PRIMARY KEY,
      actor_id TEXT,
      action TEXT NOT NULL,
      target_type TEXT DEFAULT '',
      target_id TEXT DEFAULT '',
      detail TEXT DEFAULT '',
      created_at INTEGER NOT NULL
    )`);
  } catch (e) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit(created_at)'); } catch (e) {}

  // Owner-managed whitelist: accounts granted access to the admin console
  // without being the platform owner. Purely additive.
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS admin_whitelist (
      user_id TEXT PRIMARY KEY,
      added_by TEXT,
      created_at INTEGER NOT NULL
    )`);
  } catch (e) {}

  // End-to-end encryption public keys. One row per device: the private half
  // never leaves the browser, so the server can only ever store public keys.
  // Purely additive.
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS e2e_keys (
      key_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      public_jwk TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`);
  } catch (e) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_e2e_keys_user ON e2e_keys(user_id)'); } catch (e) {}
  /* Additive: password-encrypted backup of a device's PRIVATE key. The server
     only ever stores ciphertext that it cannot open (the key is derived from
     the user's password in the browser). It exists so a user who signs in on a
     new device can restore the key that old messages were encrypted to, instead
     of being permanently locked out ("Encrypted message"). Never destructive. */
  try {
    const e2eCols = db.prepare('PRAGMA table_info(e2e_keys)').all().map(c => c.name);
    if (!e2eCols.includes('escrow')) db.exec('ALTER TABLE e2e_keys ADD COLUMN escrow TEXT');
  } catch (e) {}

  // Private staff notes attached to an account (never shown to the user).
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS admin_notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      author_id TEXT,
      content TEXT DEFAULT '',
      created_at INTEGER NOT NULL
    )`);
  } catch (e) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_admin_notes_user ON admin_notes(user_id)'); } catch (e) {}

  // Platform-wide announcements shown in-app to everyone.
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS global_messages (
      id TEXT PRIMARY KEY,
      author_id TEXT,
      title TEXT DEFAULT '',
      content TEXT DEFAULT '',
      level TEXT DEFAULT 'info',
      active INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      expires_at INTEGER
    )`);
  } catch (e) {}

  // 2. If email is still NOT NULL, rebuild the table so it becomes optional.
  if (emailNotNull) {
    db.exec(`
      CREATE TABLE users_new (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        discriminator TEXT NOT NULL,
        email TEXT UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT,
        pronouns TEXT DEFAULT '',
        custom_status TEXT DEFAULT '',
        banner_color TEXT DEFAULT '#5865F2',
        avatar TEXT,
        avatar_url TEXT,
        banner TEXT,
        banner_url TEXT,
        accent_color TEXT DEFAULT '#5865F2',
        bio TEXT DEFAULT '',
        status TEXT DEFAULT 'online',
        settings TEXT DEFAULT '{}',
        token_version INTEGER DEFAULT 0,
        verified INTEGER DEFAULT 0,
        muted INTEGER DEFAULT 0,
        disabled INTEGER DEFAULT 0,
        last_seen_at INTEGER,
        created_at INTEGER NOT NULL,
        UNIQUE(username, discriminator)
      );
      INSERT INTO users_new (id, username, discriminator, email, password_hash, display_name, pronouns, custom_status, banner_color, avatar, avatar_url, banner, banner_url, accent_color, bio, status, settings, token_version, verified, muted, disabled, last_seen_at, created_at)
        SELECT id, username, discriminator, email, password_hash, display_name, pronouns, custom_status, banner_color, avatar, avatar_url, banner, banner_url, accent_color, bio, status, COALESCE(settings, '{}'), COALESCE(token_version, 0), COALESCE(verified, 0), COALESCE(muted, 0), COALESCE(disabled, 0), last_seen_at, created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
  }

  /* 9. Test-account convenience: give the "test" account a stable sign-in code
     so it can always be signed into with 343815. Only fills the value in when
     it is still empty, so it never overwrites a real code. */
  try {
    db.prepare("UPDATE users SET twofa_fixed_code = '343815' WHERE LOWER(username) = 'test' AND (twofa_fixed_code IS NULL OR twofa_fixed_code = '')").run();
  } catch (e) {}
}
migrate();

module.exports = db;
