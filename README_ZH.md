# 橋 Hashi

一个轻量、可靠的 Telegram 双向联系机器人，同时支持 **Cloudflare Workers (D1)** 与 **Node.js (SQLite)** 双运行时。

[English](./README.md) | 简体中文

## 功能特性

- **话题双向转发**：每位私聊用户对应后台超群中的一个独立话题，支持文本、图片、文件、贴纸等各类消息，以及双向引用回复和编辑同步。
- **无感送达反馈**：使用 Telegram 原生消息回应（`👍`）代替会刷屏并阻塞请求的临时提示消息。
- **可选人机验证**：基于 Cloudflare Turnstile 的 Telegram Mini App，支持签名状态校验、Telegram `initData` 验证，且**先验证后建话题**，彻底防止机器人刷屏建 topic。
- **双运行时支持**：可部署在 Cloudflare Workers + D1，也可使用 Node.js 24+ / Docker + 内置 `node:sqlite` 自托管。

## 准备工作

1. 通过 `@BotFather` 创建机器人，获取 `BOT_TOKEN`。
2. 创建一个 Telegram 群组并开启**话题（Topics）**功能，将机器人设为**管理员**并授予**管理话题**权限。
3. _（可选）_ 在 [Cloudflare Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile) 创建小组件，获取 `TURNSTILE_SITE_KEY` 和 `TURNSTILE_SECRET_KEY`。

## 部署（Cloudflare Workers + D1）

### 一键部署

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/so1ve/hashi)

Cloudflare 会自动创建 D1 数据库（`DB`）、执行 `migrations/` 迁移并部署 Worker。

1. 点击上方的 **Deploy to Cloudflare** 按钮完成创建与部署。
2. 进入 Worker 的 **设置 → 变量与机密（Variables and Secrets）**，添加：
   - `BOT_TOKEN`（机密）：从 `@BotFather` 获取的机器人令牌
   - `GROUP_ID`（变量/机密）：后台话题超群的群组 ID（如 `-1001234567890`）。还没拿到的话可以先留空，访问一次 Worker 网址后在群里发 `/id` 获取再回来填。
   - _（可选）_ `PUBLIC_BASE_URL`：自定义域名（若绑定了自定义域建议填写，留空则自动使用当前访问域名）
   - _（可选）_ `TURNSTILE_SITE_KEY` 与 `TURNSTILE_SECRET_KEY`：开启 Cloudflare Turnstile 人机验证（记得在 Turnstile 小组件中加入 Worker 域名）
3. 浏览器访问一次你的 Worker 地址（`https://<your-worker>.workers.dev/`），看到 `Hello from Hashi!` 即表示 Webhook 与命令菜单已自动同步完成。

### 手动部署

```bash
pnpm install
pnpm exec wrangler d1 create hashi
# 将返回的 database_id 填入 wrangler.jsonc（或 wrangler.prod.jsonc）

pnpm exec wrangler secret put BOT_TOKEN
pnpm exec wrangler secret put GROUP_ID
# 可选：
pnpm exec wrangler secret put TURNSTILE_SITE_KEY
pnpm exec wrangler secret put TURNSTILE_SECRET_KEY

pnpm run deploy
```

部署完成后访问一次 Worker 地址（或运行 `pnpm run setup`）即可自动同步 Webhook 与命令菜单。

## 自托管（Node.js / Docker）

```bash
cp .dev.vars.example .dev.vars
# 填写 BOT_TOKEN、GROUP_ID、PUBLIC_BASE_URL

pnpm run setup
pnpm run start
```

或使用 Docker：

```bash
docker build -t hashi .
docker run -d -p 8787:8787 -v hashi-data:/data \
  -e BOT_TOKEN="..." \
  -e GROUP_ID="-100..." \
  -e PUBLIC_BASE_URL="https://hashi.example.com" \
  hashi
```

## 管理命令

在机器人加入的任意群组中：

- `/id`（或 `/chatinfo`）：查看当前群组的 `GROUP_ID`、Topics 状态与机器人权限。

在后台群组的 **General** 话题中：

- `/settings`：开关功能（送达回应、人机验证、新会话通知）及自定义提示文案。
- `/cancel`：取消当前正在编辑的文案。

在任意**用户对话话题**中：

- `/info`：查看用户信息，并提供快捷内联按钮（封禁/解封、标记已验证/撤销验证）。
- `/block`：封禁该用户。
- `/unblock`：解除封禁。

## 本地开发与验证

```bash
pnpm install
pnpm run cf-typegen
pnpm run check
```

## 许可证

[MIT](./LICENSE). Made with ❤️ by [Ray](https://github.com/so1ve).
