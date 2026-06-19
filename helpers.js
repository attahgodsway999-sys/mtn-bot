/**
 * Validates a phone number looks like a valid MSISDN.
 * Accepts +256700000000 or 0700000000 or 256700000000
 */
function isValidPhone(phone) {
  return /^(\+?256|0)\d{9}$/.test(phone.trim());
}

/**
 * Formats a currency amount nicely.
 */
function formatAmount(amount, currency = 'EUR') {
  return `${currency} ${Number(amount).toFixed(2)}`;
}

/**
 * Formats a transaction status emoji.
 */
function statusEmoji(status) {
  return { successful: '✅', pending: '⏳', failed: '❌' }[status.toLowerCase()] || '❓';
}

/**
 * Formats a transaction history row.
 */
function formatTx(tx, myTelegramId) {
  const isSender = String(tx.sender_telegram_id) === String(myTelegramId);
  const dir = isSender ? '↑ Sent' : '↓ Received';
  const emoji = statusEmoji(tx.status);
  const date = tx.created_at.split('T')[0];
  return `${emoji} ${dir} ${formatAmount(tx.amount, tx.currency)} · ${date}${tx.description ? `\n   _${tx.description}_` : ''}`;
}

/**
 * Parses /pay @username 5000 or /pay +256700000000 5000
 * Returns { target, amount } or null
 */
function parsePayCommand(text) {
  const parts = text.trim().split(/\s+/);
  // /pay @user 5000  OR  /pay +2567xxx 5000  OR  /pay 2567xxx 5000
  if (parts.length < 3) return null;
  const target = parts[1]; // @username or phone
  const amount = parseFloat(parts[2]);
  if (isNaN(amount) || amount <= 0) return null;
  const description = parts.slice(3).join(' ') || null;
  return { target, amount, description };
}

/**
 * Sanitizes phone input — strips spaces and dashes.
 */
function cleanPhone(input) {
  return input.trim().replace(/[\s\-]/g, '');
}

module.exports = { isValidPhone, formatAmount, statusEmoji, formatTx, parsePayCommand, cleanPhone };
