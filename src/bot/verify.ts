import type { Middleware } from "grammy";

import * as kv from "../kv";
import type { HashiContext } from ".";

export const verify: Middleware<HashiContext> = async (ctx, next) => {
	if (!ctx.chatId) {
		return;
	}
	const user = await kv.users.get(ctx.chatId);
	if (user?.blocked) {
		await ctx.reply("You are blocked from using this bot.");
	}
	// undefined means the user never used this bot before, so we let them pass
	if (user?.verified === false) {
		await ctx.reply("You need to pass verification to use this bot.");
	}
	await next();
};
