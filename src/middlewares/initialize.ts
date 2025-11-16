import { env } from "cloudflare:workers";
import { createMiddleware } from "hono/factory";

import { bot, initializeBot } from "../bot";
import { initializeTables } from "../db/initialize";

const { GROUP_ID } = env;

let initialized = false;

async function checkPermissions() {
	async function doWithErrorHandling(fn: () => Promise<void>, text: string) {
		try {
			await fn();
		} catch (error) {
			const err = new Error(text);

			err.cause = error;
			throw err;
		}
	}

	await doWithErrorHandling(async () => {
		await bot.api.getChat(GROUP_ID);
	}, "Failed to access the group chat. Please ensure the bot has been added to the group.");

	await doWithErrorHandling(async () => {
		const { id } = await bot.api.getMe();
		await bot.api.getChatMember(GROUP_ID, id);
	}, "Failed to access the bot's membership status in the group. Please ensure the bot has the necessary permissions.");
}

export const initialize = createMiddleware(async (c, next) => {
	if (!initialized) {
		initialized = true;

		const { hostname } = new URL(c.req.url);
		await initializeBot(hostname);
		await bot.api.setWebhook(`https://${hostname}/webhook`);
		await initializeTables();
		await checkPermissions();
	}

	await next();
});
