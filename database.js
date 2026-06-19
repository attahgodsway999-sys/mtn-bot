const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || './data/bot.db';
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function migrate() {
  db.exec(`
    -- Users linked to their MoMo number
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT UNIQUE NOT NULL,
      telegram_username TEXT,
      full_name TEXT,
      phone_number TEXT,           -- MoMo phone number e.g. +256700000000
      is_verified INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Channel integrations (for admins who want payment buttons in their channel)
    CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT UNIQUE NOT NULL,
      channel_name TEXT,
      admin_telegram_id TEXT NOT NULL,
      admin_phone_number TEXT NOT NULL,  -- MoMo number to receive channel payments
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (admin_telegram_id) REFERENCES users(telegram_id)
    );

    -- All payment transactions
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference_id TEXT UNIQUE NOT NULL,   -- MTN external reference UUID
      momo_transaction_id TEXT,            -- MTN's own transaction ID (returned on status check)
      type TEXT NOT NULL,                  -- 'payment' | 'request' | 'channel_payment'
      status TEXT DEFAULT 'pending',       -- 'pending' | 'successful' | 'failed'
      sender_telegram_id TEXT,
      recipient_telegram_id TEXT,          -- null if sending to external phone
      recipient_phone TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'EUR',
      description TEXT,
      channel_id TEXT,                     -- if this was a channel payment
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (sender_telegram_id) REFERENCES users(telegram_id),
      FOREIGN KEY (channel_id) REFERENCES channels(channel_id)
    );

    -- Pending payment requests (one user requesting from another)
    CREATE TABLE IF NOT EXISTS payment_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference_id TEXT UNIQUE NOT NULL,
      requester_telegram_id TEXT NOT NULL,
      payer_telegram_id TEXT,              -- null if request sent outside Telegram
      payer_phone TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'EUR',
      description TEXT,
      status TEXT DEFAULT 'pending',       -- 'pending' | 'paid' | 'declined' | 'expired'
      expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (requester_telegram_id) REFERENCES users(telegram_id)
    );

    -- User sessions for multi-step flows (e.g. waiting for phone number input)
    CREATE TABLE IF NOT EXISTS sessions (
      telegram_id TEXT PRIMARY KEY,
      step TEXT,                           -- current conversation step
      data TEXT,                           -- JSON blob of partial form data
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  console.log('✅ Database migrated successfully');
}

module.exports = { db, migrate };
