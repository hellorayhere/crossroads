const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/* Restore the database from durable storage (private GitHub repo) BEFORE it is
   opened. Render's free plan has an ephemeral disk, so this is what keeps user
   data alive across deploys. Runs in a child process so this synchronous module
   can block until the download finishes. No-op unless GH_DATA_REPO is set. */
if (process.env.GH_DATA_REPO && process.env.GH_DATA_TOKEN) {
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'persist.js'), 'restore'], {
      stdio: 'inherit',
      timeout: 120000,
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
    settings: "TEXT DEFAULT '{}'"
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

  // 1d. Additive migration for server member roles (owner / admin / member).
  const memCols = db.prepare('PRAGMA table_info(server_members)').all().map(c => c.name);
  if (!memCols.includes('role')) {
    try { db.exec("ALTER TABLE server_members ADD COLUMN role TEXT DEFAULT 'member'"); } catch (e) {}
  }
  // Backfill: make sure every server owner is marked as 'owner' (never destructive).
  try {
    db.exec(`UPDATE server_members SET role = 'owner'
      WHERE (role IS NULL OR role = 'member')
        AND EXISTS (SELECT 1 FROM servers s WHERE s.id = server_members.server_id AND s.owner_id = server_members.user_id)`);
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
        created_at INTEGER NOT NULL,
        UNIQUE(username, discriminator)
      );
      INSERT INTO users_new (id, username, discriminator, email, password_hash, display_name, pronouns, custom_status, banner_color, avatar, avatar_url, banner, banner_url, accent_color, bio, status, settings, created_at)
        SELECT id, username, discriminator, email, password_hash, display_name, pronouns, custom_status, banner_color, avatar, avatar_url, banner, banner_url, accent_color, bio, status, COALESCE(settings, '{}'), created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
  }
}
migrate();

module.exports = db;
