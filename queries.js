const { db } = require('./database');

// ── Users ─────────────────────────────────────────────────────────────────────

const Users = {
  find: (telegramId) =>
    db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(telegramId)),

  findByUsername: (username) =>
    db.prepare('SELECT * FROM users WHERE telegram_username = ?').get(username),

  findByPhone: (phone) =>
    db.prepare('SELECT * FROM users WHERE phone_number = ?').get(phone),

  upsert: (telegramId, username, fullName) => {
    db.prepare(`
      INSERT INTO users (telegram_id, telegram_username, full_name)
      VALUES (?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        telegram_username = excluded.telegram_username,
        full_name = excluded.full_name,
        updated_at = datetime('now')
    `).run(String(telegramId), username || null, fullName || null);
    return Users.find(telegramId);
  },

  setPhone: (telegramId, phone) => {
    db.prepare(`
      UPDATE users SET phone_number = ?, is_verified = 1, updated_at = datetime('now')
      WHERE telegram_id = ?
    `).run(phone, String(telegramId));
  },
};

// ── Sessions (multi-step flows) ───────────────────────────────────────────────

const Sessions = {
  get: (telegramId) => {
    const row = db.prepare('SELECT * FROM sessions WHERE telegram_id = ?').get(String(telegramId));
    if (!row) return null;
    return { step: row.step, data: JSON.parse(row.data || '{}') };
  },

  set: (telegramId, step, data = {}) => {
    db.prepare(`
      INSERT INTO sessions (telegram_id, step, data, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(telegram_id) DO UPDATE SET step = excluded.step, data = excluded.data, updated_at = datetime('now')
    `).run(String(telegramId), step, JSON.stringify(data));
  },

  clear: (telegramId) => {
    db.prepare('DELETE FROM sessions WHERE telegram_id = ?').run(String(telegramId));
  },
};

// ── Transactions ──────────────────────────────────────────────────────────────

const Transactions = {
  create: (fields) => {
    const {
      referenceId, type, senderTelegramId, recipientTelegramId,
      recipientPhone, amount, currency, description, channelId,
    } = fields;
    db.prepare(`
      INSERT INTO transactions
        (reference_id, type, sender_telegram_id, recipient_telegram_id,
         recipient_phone, amount, currency, description, channel_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      referenceId, type, senderTelegramId || null, recipientTelegramId || null,
      recipientPhone, amount, currency || 'EUR', description || null, channelId || null,
    );
  },

  updateStatus: (referenceId, status, momoTxId = null) => {
    db.prepare(`
      UPDATE transactions
      SET status = ?, momo_transaction_id = ?, updated_at = datetime('now')
      WHERE reference_id = ?
    `).run(status, momoTxId, referenceId);
  },

  find: (referenceId) =>
    db.prepare('SELECT * FROM transactions WHERE reference_id = ?').get(referenceId),

  historyForUser: (telegramId, limit = 10) =>
    db.prepare(`
      SELECT * FROM transactions
      WHERE sender_telegram_id = ? OR recipient_telegram_id = ?
      ORDER BY created_at DESC LIMIT ?
    `).all(String(telegramId), String(telegramId), limit),
};

// ── Channels ──────────────────────────────────────────────────────────────────

const Channels = {
  find: (channelId) =>
    db.prepare('SELECT * FROM channels WHERE channel_id = ?').get(String(channelId)),

  create: (channelId, channelName, adminTelegramId, adminPhone) => {
    db.prepare(`
      INSERT INTO channels (channel_id, channel_name, admin_telegram_id, admin_phone_number)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(channel_id) DO UPDATE SET
        channel_name = excluded.channel_name,
        admin_phone_number = excluded.admin_phone_number,
        is_active = 1
    `).run(String(channelId), channelName, String(adminTelegramId), adminPhone);
  },

  listForAdmin: (adminTelegramId) =>
    db.prepare('SELECT * FROM channels WHERE admin_telegram_id = ?').all(String(adminTelegramId)),
};

// ── Payment Requests ──────────────────────────────────────────────────────────

const PaymentRequests = {
  create: (fields) => {
    const { referenceId, requesterTelegramId, payerTelegramId, payerPhone, amount, currency, description } = fields;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO payment_requests
        (reference_id, requester_telegram_id, payer_telegram_id, payer_phone, amount, currency, description, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(referenceId, String(requesterTelegramId), payerTelegramId ? String(payerTelegramId) : null,
      payerPhone, amount, currency || 'EUR', description || null, expiresAt);
  },

  find: (referenceId) =>
    db.prepare('SELECT * FROM payment_requests WHERE reference_id = ?').get(referenceId),

  updateStatus: (referenceId, status) => {
    db.prepare(`
      UPDATE payment_requests SET status = ? WHERE reference_id = ?
    `).run(status, referenceId);
  },
};

module.exports = { Users, Sessions, Transactions, Channels, PaymentRequests };
