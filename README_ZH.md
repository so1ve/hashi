# 橋 Hashi

一个基于 Cloudflare Workers 实现的 Telegram 双向机器人

[English](./README.md) | 简体中文

## 功能

- 支持文本、图片等多种消息类型的双向通信
- 可选的基于 Cloudflare Turnstile 的人机验证

## 部署

### 创建 Telegram 机器人

1. 在 Telegram 中搜索 `@BotFather` 并开始对话。
2. 发送 `/newbot` 或点击 `Open` 按钮，并按照提示创建一个新的机器人。
3. 创建完成后，记住获取到的 `BOT_TOKEN`。

### 创建后台群组

1. 创建一个 Telegram 群组，并打开群组的话题功能。
2. 添加机器人为管理员，建议权限全给（消息管理，话题管理）
3. 通过 `@getidsbot` 获取群组 ID （拉进群聊），记住获取到的 `GROUP_ID`。

### （可选）获取 Cloudflare Turnstile 密钥

访问 [Cloudflare Dashboard](https://dash.cloudflare.com/?to=/:account/turnstile)，创建一个小组件，主机名可以先随便填。获取 `TURNSTILE_SITE_KEY` 和 `TURNSTILE_SECRET_KEY` 并记住。

### 部署到 Cloudflare Workers

首先，Fork 本仓库到你的 GitHub 账号下。然后点击下面的按钮进行部署：

[<img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare">](https://dash.cloudflare.com/?to=/:account/workers-and-pages/create/import-repository)

1. 选择你的 GitHub 账号和 Fork 的仓库，点击 `继续`。
2. 随便填写一个名称，点击 `创建和部署`。
3. 在部署失败后，点击 `继续`，进入仪表盘页面。
4. 点击 `设置`，在 `变量与机密` 处中添加以下环境变量：
   - `BOT_TOKEN`：在 BotFather 获取的机器人令牌
   - `GROUP_ID`：在后台群组获取的群组ID
   - （可选）`TURNSTILE_SITE_KEY`：Cloudflare Turnstile 的 Site Key
   - （可选）`TURNSTILE_SECRET_KEY`：Cloudflare Turnstile 的 Secret Key
5. 点击 `保存并部署`，等待部署完成。

部署完成后，回到 `概述` 页面，复制 `域和路由` 处的域名，并回到 Turnstil e 仪表盘，将域名添加到你创建的小组件的 `主机名` 列表中。

## 使用

### 通信

1. 在 Telegram 中搜索并打开你的机器人，点击 `开始` 按钮。
2. 机器人会发送一条消息，按照提示完成人机验证。
3. 验证成功后，你就可以开始与机器人进行双向通信了！

### 管理

在后台群组中，你可以在 `General` 话题下使用以下命令进行管理：

- `/settings`：修改设置和提示文本。

在和用户对话的话题中，可以使用以下命令：

- `/block`：禁止当前用户的双向聊天。
- `/unblock`：解除对当前用户的禁止。

### 人机验证

你可以在设置中开启或关闭人机验证功能。如果开启，用户在开始与机器人通信前需要完成验证；如果关闭，用户可以直接与机器人通信。开启人机验证需要在部署时提供 `TURNSTILE_SITE_KEY` 和 `TURNSTILE_SECRET_KEY`。

## 致谢

这个项目受到了 [ctt](https://github.com/iawooo/ctt) 的启发。感谢 [iawooo](https://github.com/iawooo) 的出色工作！

## 📝 许可证

[MIT](./LICENSE). Made with ❤️ by [Ray](https://github.com/so1ve)
