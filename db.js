const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

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
  owner_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS server_members (
  server_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
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
  edited_at INTEGER
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

CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_messages_dm ON messages(dm_id);
CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_friendships_req ON friendships(requester_id);
CREATE INDEX IF NOT EXISTS idx_friendships_add ON friendships(addressee_id);
CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks(blocker_id);
CREATE INDEX IF NOT EXISTS idx_notes_owner ON notes(owner_id);
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
    banner_color: "TEXT DEFAULT '#5865F2'"
  };
  for (const [col, def] of Object.entries(additions)) {
    if (!names.includes(col)) {
      db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
    }
  }

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
        created_at INTEGER NOT NULL,
        UNIQUE(username, discriminator)
      );
      INSERT INTO users_new (id, username, discriminator, email, password_hash, display_name, pronouns, custom_status, banner_color, avatar, avatar_url, banner, banner_url, accent_color, bio, status, created_at)
        SELECT id, username, discriminator, email, password_hash, display_name, pronouns, custom_status, banner_color, avatar, avatar_url, banner, banner_url, accent_color, bio, status, created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
  }
}
migrate();

module.exports = db;
