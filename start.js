const { Users, Sessions } = require('./queries');
const { isValidPhone, cleanPhone } = require('../utils/helpers');

function register(bot) {
  // /start
  bot.onText(/\/start/, async (msg) => {
    const { id: chatId, first_name } = msg.chat;
    const user = msg._user;

    const linked = user && user.phone_number;

    await bot.sendMessage(chatId,
      `👋 Welcome${first_name ? `, ${first_name}` : ''}!\n\n` +
      `I'm your *MTN MoMo bot* — send and receive mobile money directly inside Telegram.\n\n` +
      (linked
        ? `📱 Your number: \`${user.phone_number}\`\n\n`
        : `⚠️ You haven't linked a MoMo number yet. Use /register to get started.\n\n`) +
      `*Commands:*\n` +
      `/register — link your MTN MoMo number\n` +
      `/pay — send money to a Telegram user or phone\n` +
      `/send — send to any MoMo number\n` +
      `/request — request payment from someone\n` +
      `/balance — check your linked account\n` +
      `/history — view recent transactions\n` +
      `/connect — add payment to your Telegram channel`,
      { parse_mode: 'Markdown' }
    );
  });

  // /register — start phone linking flow
  bot.onText(/\/register/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    Sessions.set(telegramId, 'awaiting_phone');

    await bot.sendMessage(chatId,
      `📱 *Link your MTN MoMo number*\n\n` +
      `Please send your MoMo phone number in international format:\n` +
      `Example: \`+256700000000\`\n\n` +
      `_Send /cancel to abort._`,
      { parse_mode: 'Markdown' }
    );
  });

  // Handle text input during registration flow
  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;

    const telegramId = msg.from.id;
    const session = Sessions.get(telegramId);
    if (!session || session.step !== 'awaiting_phone') return;

    const phone = cleanPhone(msg.text);

    if (!isValidPhone(phone)) {
      await bot.sendMessage(msg.chat.id,
        `❌ That doesn't look like a valid MTN number.\n` +
        `Please use format: \`+256700000000\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Check if number already registered to another user
    const existing = Users.findByPhone(phone);
    if (existing && String(existing.telegram_id) !== String(telegramId)) {
      await bot.sendMessage(msg.chat.id,
        `❌ That number is already linked to another account.\n` +
        `Contact support if you believe this is an error.`
      );
      return;
    }

    Users.setPhone(telegramId, phone);
    Sessions.clear(telegramId);

    await bot.sendMessage(msg.chat.id,
      `✅ *Number linked!*\n\n` +
      `📱 \`${phone}\` is now linked to your Telegram account.\n\n` +
      `You can now use /pay, /send, /request and more.`,
      { parse_mode: 'Markdown' }
    );
  });

  // /cancel — abort any active session
  bot.onText(/\/cancel/, async (msg) => {
    Sessions.clear(msg.from.id);
    await bot.sendMessage(msg.chat.id, '❎ Cancelled. What else can I help with?');
  });
}

module.exports = { register };
