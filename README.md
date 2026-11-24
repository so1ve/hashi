# 橋 Hashi

A lightweight, two-way Telegram contact relay bot built for **Cloudflare Workers (D1)** and **Node.js (SQLite)**.

English | [简体中文](./README_ZH.md)

## Features

- **Forum-topic relay**: Each private user gets a dedicated topic in your admin supergroup with bidirectional forwarding for text, media, stickers, files, replies, and message edits.
- **Zero-clutter delivery feedback**: Uses native Telegram message reactions (`👍`) instead of temporary confirmation messages.
- **Optional human verification**: Cloudflare Turnstile inside a Telegram Mini App with signed state tokens, Telegram `initData` validation, and lazy topic creation (bots cannot spam topics before passing verification).
- **Stateless & reliable**: Proper SQL migrations, DB-persisted admin settings, authenticated Telegram webhooks (`X-Telegram-Bot-Api-Secret-Token`), and automatic recovery if a topic is closed or deleted.
- **Dual runtime**: Deploy on Cloudflare Workers + D1 or self-host with Node.js 24+ / Docker + built-in `node:sqlite`.

## Prerequisites

1. Create a bot via `@BotFather` and save `BOT_TOKEN`.
2. Create a Telegram supergroup, enable **Topics**, add the bot as an **Administrator** with **Manage Topics** permission, and record its negative `GROUP_ID` (e.g. `-1001234567890`).
3. _(Optional)_ Create a widget in [Cloudflare Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile) and record `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`.

## Deploy (Cloudflare Workers + D1)

### One-click deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/so1ve/hashi)

Cloudflare automatically provisions the D1 database (`DB`), applies `migrations/`, and deploys the Worker.

1. Click **Deploy to Cloudflare** above and finish creating the Worker.
2. Open the Worker's **Settings → Variables and Secrets** and add:
   - `BOT_TOKEN` (Secret): Bot token from `@BotFather`
   - `GROUP_ID` (Variable/Secret): Admin forum supergroup ID (e.g. `-1001234567890`)
   - _(Optional)_ `PUBLIC_BASE_URL`: Custom domain if you attach one (otherwise inferred from the incoming request URL)
   - _(Optional)_ `TURNSTILE_SITE_KEY` & `TURNSTILE_SECRET_KEY`: Enable Cloudflare Turnstile verification (add your Worker hostname to the Turnstile widget)
3. Visit your deployed Worker URL (`https://<your-worker>.workers.dev/`), click **Register webhook**, paste `BOT_TOKEN` (or `WEBHOOK_SECRET`), and click **Register**.

### Manual deploy

```bash
pnpm install
pnpm exec wrangler d1 create hashi
# Put the returned database_id into wrangler.jsonc (or wrangler.prod.jsonc)

pnpm exec wrangler secret put BOT_TOKEN
pnpm exec wrangler secret put GROUP_ID
pnpm exec wrangler secret put PUBLIC_BASE_URL       # e.g. https://hashi.example.com
# Optional:
pnpm exec wrangler secret put TURNSTILE_SITE_KEY
pnpm exec wrangler secret put TURNSTILE_SECRET_KEY

pnpm run deploy
```

Then register the Telegram webhook and scoped commands once:

```bash
BOT_TOKEN="..." GROUP_ID="-100..." PUBLIC_BASE_URL="https://hashi.example.com" pnpm run setup
```

Or via HTTP (accepts either `WEBHOOK_SECRET` or `BOT_TOKEN`):

```bash
curl -X POST https://hashi.example.com/api/setup \
  -H "Authorization: Bearer $BOT_TOKEN"
```

## Self-Hosting (Node.js / Docker)

```bash
cp .dev.vars.example .dev.vars
# Edit .dev.vars with BOT_TOKEN, GROUP_ID, PUBLIC_BASE_URL

pnpm run setup
pnpm run start
```

Or with Docker:

```bash
docker build -t hashi .
docker run -d -p 8787:8787 -v hashi-data:/data \
  -e BOT_TOKEN="..." \
  -e GROUP_ID="-100..." \
  -e PUBLIC_BASE_URL="https://hashi.example.com" \
  hashi
```

## Admin Commands

In the **General** topic of your admin group:

- `/settings` — Toggle features (delivery reaction, Turnstile verification, new chat notifications) and edit bot messages.
- `/cancel` — Cancel an in-progress message edit.

Inside any **user topic**:

- `/info` — Show user details with quick inline buttons (Block/Unblock, Verify/Revoke).
- `/block` — Block the user from messaging.
- `/unblock` — Unblock the user.

## Development

```bash
pnpm install
pnpm run cf-typegen
pnpm run check
```

## License

[MIT](./LICENSE). Made with ❤️ by [Ray](https://github.com/so1ve).
