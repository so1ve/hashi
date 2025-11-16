import type { Menu } from "@grammyjs/menu";
import type { Middleware } from "grammy";

import * as kv from "../kv";
import { ensureTopic, ensureUser } from "./utils";
import { sendVerification } from "./verify";
import type { HashiContext } from ".";

export const guard =
	(menu: Menu<HashiContext>): Middleware<HashiContext> =>
	async (ctx, next) => {
		if (!ctx.chatId) {
			return;
		}
		await ensureUser(ctx.chatId);
		await ensureTopic(ctx, ctx.chatId);
		const user = await kv.users.get(ctx.chatId);
		if (user) {
			if (user.blocked) {
				await ctx.reply("You are blocked from using this bot.");

				return;
			}
			if (!user.verified) {
				await sendVerification(ctx, menu, ctx.chatId);

				return;
			}
		}

		await next();
	};
