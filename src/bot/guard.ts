import type { Menu } from "@grammyjs/menu";
import { env } from "cloudflare:workers";
import type { Middleware } from "grammy";

import { db, getSetting } from "../db";
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
		const result = (
			await db.select("users", null, {
				chatId: ctx.chatId,
			})
		)[0];
		const user = result;
		if (user) {
			if (user.blocked) {
				await ctx.reply("You are blocked from using this bot.");

				return;
			}
			const verificationEnabled = await getSetting("verification");
			if (verificationEnabled) {
				if (!(env.TURNSTILE_SECRET_KEY && env.TURNSTILE_SITE_KEY)) {
					await ctx.reply(
						"Verification is enabled, but the bot is not properly configured. Please contact the administrator.",
					);

					return;
				}
				if (!user.verified) {
					await sendVerification(ctx, menu, ctx.chatId);

					return;
				}
			}
		}

		await next();
	};
