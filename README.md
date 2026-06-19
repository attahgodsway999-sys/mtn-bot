# MTN MoMo Telegram Bot

Send and receive MTN Mobile Money directly inside Telegram — peer-to-peer, to external numbers, and integrated into channels for premium content payments.

---

## Features

| Command | What it does |
|---|---|
| `/register` | Link your MTN MoMo number |
| `/pay @user 5000` | Pay a Telegram user |
| `/pay +256700000000 5000` | Pay any MoMo number |
| `/request @user 5000` | Request payment from someone |
| `/balance` | Check your MoMo account balance |
| `/history` | View recent transactions |
| `/connect` | Link your Telegram channel |
| `/post @channel 5000 desc` | Post a paywall message to your channel |

---

## Setup

### 1. Create a Telegram bot

1. Open [@BotFather](https://t.me/BotFather) on Telegram
2. Run `/newbot` and follow the prompts
3. Copy the **bot token**

### 2. Get MTN MoMo API credentials

1. Go to [momodeveloper.mtn.com](https://momodeveloper.mtn.com) and sign up
2. Subscribe to **Collections** and **Disbursements** products
3. Get your **primary keys** from the portal
4. Create API users and keys for each product:

```bash
# Example: Create API user for Collections
curl -X POST https://sandbox.momodeveloper.mtn.com/v1_0/apiuser \
  -H "X-Reference-Id: <your-uuid>" \
  -H "Ocp-Apim-Subscription-Key: <collections-primary-key>" \
  -H "Content-Type: application/json" \
  -d '{"providerCallbackHost": "your-webhook-url.com"}'

# Get the API key
curl -X POST https://sandbox.momodeveloper.mtn.com/v1_0/apiuser/<your-uuid>/apikey \
  -H "Ocp-Apim-Subscription-Key: <collections-primary-key>"
```

Repeat for Disbursements.

### 3. Configure environment

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Key values:
- `TELEGRAM_BOT_TOKEN` — from BotFather
- `MOMO_COLLECTIONS_*` — Collections product credentials
- `MOMO_DISBURSEMENTS_*` — Disbursements product credentials
- `MOMO_CURRENCY` — `EUR` for sandbox, your local currency in production
- `MOMO_TARGET_ENVIRONMENT` — `sandbox` or `production`
- `WEBHOOK_URL` — your public URL (e.g. `https://your-app.railway.app`)
- `BOT_USERNAME` — your bot's username without @

### 4. Install and run locally

```bash
npm install

# Dev mode (polling — no webhook needed)
npm run dev

# Production
npm start
```

---

## Deploy to Railway

1. Push this repo to GitHub
2. Create a new project on [railway.app](https://railway.app)
3. Connect your GitHub repo
4. Add all env vars from `.env.example` in Railway's Variables tab
5. Set `WEBHOOK_URL` to `https://your-app-name.railway.app`
6. Deploy — Railway auto-detects Node.js

> ⚠️ Railway's free tier doesn't persist disk. For production, use **Railway's PostgreSQL** plugin or switch `better-sqlite3` to a managed Postgres (see below).

## Deploy to Render

1. Push to GitHub
2. Create a new **Web Service** on [render.com](https://render.com)
3. Connect your repo — Render will use `render.yaml` automatically
4. Fill in the `sync: false` env vars in Render's dashboard
5. Set `WEBHOOK_URL` to your Render URL

---

## Channel Integration Guide

For Telegram channel owners who want to monetise with payment buttons:

1. Add the bot as **admin** of your channel
2. DM the bot: `/connect`
3. Send your channel username when prompted
4. To post a paywall: `/post @yourchannel 5000 Premium analysis report`
5. The bot posts to your channel with a "Pay" button
6. When subscribers tap it, they're taken to DM with the bot where they approve via USSD
7. Money lands in your linked MoMo number automatically

---

## Production checklist

- [ ] Switch `MOMO_ENV` and `MOMO_TARGET_ENVIRONMENT` to `production`
- [ ] Update `MOMO_BASE_URL` to `https://momodeveloper.mtn.com`
- [ ] Set correct `MOMO_CURRENCY` for your country (e.g. `UGX`, `GHS`, `CM`)
- [ ] Use a persistent database (PostgreSQL recommended)
- [ ] Set up proper error logging (e.g. Sentry)
- [ ] Add rate limiting on payment commands
- [ ] Test all flows on sandbox before going live

---

## Architecture

```
src/
  index.js              — Bot entry point, webhook/polling setup
  commands/
    start.js            — /start, /register, phone linking flow
    pay.js              — /pay command (user-to-user and external)
    request.js          — /request, /balance, /history
    channel.js          — /connect, /post, channel payment flow
  db/
    database.js         — SQLite setup and migrations
    queries.js          — DB helper functions
    migrate.js          — Standalone migration runner
  mtn/
    momoClient.js       — MTN MoMo API (Collections + Disbursements)
  middleware/
    auth.js             — Auto user registration, phone guard
  utils/
    helpers.js          — Formatters, validators, parsers
```

## Switching to PostgreSQL

Replace `better-sqlite3` with `pg`:

```bash
npm uninstall better-sqlite3
npm install pg
```

Then update `src/db/database.js` to use `pg.Pool` and convert the SQL to Postgres syntax (swap `?` params for `$1, $2`, etc., and `datetime('now')` for `NOW()`).
