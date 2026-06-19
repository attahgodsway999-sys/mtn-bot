require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const { migrate } = require('./db/database');
const { registerUser } = require('./middleware/auth');

// Commands
const startCmd = require('./commands/start');
const payCmd = require('./commands/pay');
const requestCmd = require('./commands/request');
const channelCmd = require('./commands/channel');

// ── Validate env ──────────────────────────────────────────────────────────────
const required = [
  'TELEGRAM_BOT_TOKEN',
  'MOMO_COLLECTIONS_PRIMARY_KEY',
  'MOMO_COLLECTIONS_USER_ID',
  'MOMO_COLLECTIONS_API_KEY',
  'MOMO_DISBURSEMENTS_PRIMARY_KEY',
  'MOMO_DISBURSEMENTS_USER_ID',
  'MOMO_DISBURSEMENTS_API_KEY',
];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`❌ Missing env var: ${key}`);
    process.exit(1);
  }
}

// ── DB ────────────────────────────────────────────────────────────────────────
migrate();

// ── Bot setup ─────────────────────────────────────────────────────────────────
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const PORT = parseInt(process.env.PORT || '3000', 10);

let bot;

if (WEBHOOK_URL) {
  // Production: use webhook (required for Railway/Render)
  bot = new TelegramBot(TOKEN, { webHook: { port: PORT } });

  const app = express();
  app.use(express.json());

  const webhookPath = `/webhook/${TOKEN}`;
  app.post(webhookPath, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });

  // Health check for Railway/Render
  app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

  app.listen(PORT, async () => {
    const url = `${WEBHOOK_URL}${webhookPath}`;
    await bot.setWebHook(url);
    console.log(`✅ Bot running in webhook mode`);
    console.log(`   Webhook: ${url}`);
  });

} else {
  // Development: long polling
  bot = new TelegramBot(TOKEN, { polling: true });
  console.log('✅ Bot running in polling mode (dev)');
}

// ── Middleware — register user on every message ───────────────────────────────
bot.on('message', async (msg, next) => {
  if (!msg.from) return;
  await registerUser(bot, msg);
});

// ── Register command handlers ─────────────────────────────────────────────────
startCmd.register(bot);
payCmd.register(bot);
requestCmd.register(bot);
channelCmd.register(bot);

// ── Error handling ────────────────────────────────────────────────────────────
bot.on('polling_error', (err) => console.error('Polling error:', err.message));
bot.on('error', (err) => console.error('Bot error:', err.message));

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

console.log('🤖 MTN MoMo Telegram Bot started');
