# 橋 Hashi

A Telegram two-way chatbot implemented using Cloudflare Workers

English | [简体中文](./README_ZH.md)

## Features

- Supports two-way communication for various message types including text, images, and more
- Human verification based on Cloudflare Turnstile

## Deployment

### Create a Telegram Bot

1. Search for `@BotFather` in Telegram and start a conversation.
2. Send `/newbot` or click the `Open` button, and follow the prompts to create a new bot.
3. After creation, remember to save the `BOT_TOKEN` you receive.

### Create a Chat Group

1. Create a Telegram group and enable the topics feature for the group.
2. Add the bot as an administrator. It's recommended to grant all permissions (message management, topic management).
3. Use `@getidsbot` to get the group ID (add it to the group chat), and remember the `GROUP_ID` you receive.

### Get Cloudflare Turnstile Keys

Visit [Cloudflare Dashboard](https://dash.cloudflare.com/?to=/:account/turnstile), create a widget, and you can fill in any hostname for now. Get and remember the `SITE_KEY` and `SECRET_KEY`.

### Deploy to Cloudflare Workers

First, fork this repository to your GitHub account. Then click the button below to deploy:

[<img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare">](https://dash.cloudflare.com/?to=/:account/workers-and-pages/create/import-repository)

1. Select your GitHub account and the forked repository, then click `Continue`.
2. Fill in any name, then click `Create and Deploy`.
3. After the deployment fails, click `Continue` to enter the dashboard page.
4. Click `Settings`, and add the following environment variables in `Variables and Secrets`:
   - `BOT_TOKEN`: The bot token obtained from BotFather
   - `GROUP_ID`: The group ID obtained from the backend group
   - `TURNSTILE_SITE_KEY`: Cloudflare Turnstile Site Key
   - `TURNSTILE_SECRET_KEY`: Cloudflare Turnstile Secret Key
5. Click `Save and Deploy`, and wait for the deployment to complete.

After deployment is complete, go back to the `Overview` page, copy the domain from `Domains & Routes`, and return to the Turnstile dashboard to add the domain to the `Hostnames` list of the widget you created.

## Usage

### Communication

1. Search for and open your bot in Telegram, then click the `Start` button.
2. The bot will send a message, follow the prompts to complete human verification.
3. After successful verification, you can start bidirectional communication with the bot!

### Administration

In the backend group, you can use the following commands in the `General` topic for management:

- `/settings`: Modify settings and prompt text.

In the topic where you're conversing with a user, you can use the following commands:

- `/block`: Block bidirectional chat with the current user.
- `/unblock`: Unblock the current user.

## Credits

This project was inspired by [ctt](https://github.com/iawooo/ctt). Thanks to [iawooo](https://github.com/iawooo) for the excellent work!

## 📝 License

[MIT](./LICENSE). Made with ❤️ by [Ray](https://github.com/so1ve)
