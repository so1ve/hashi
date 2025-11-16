import { b, fmt } from "@grammyjs/parse-mode";
import { addReplyParam } from "@roziscoding/grammy-autoquote";
import { env } from "cloudflare:workers";
import type { Middleware } from "grammy";

import { db } from "../db";
import type { HashiBot } from ".";

const createBlockHandler = (blocked: boolean) =>
	(async (ctx) => {
		ctx.api.config.use(addReplyParam(ctx));

		if (!ctx.message) {
			await ctx.reply("ctx.message not found!");

			return;
		}

		if (!ctx.message?.message_thread_id) {
			await ctx.reply("Please use this command in a topic.");

			return;
		}

		const topicId = ctx.message.message_thread_id;
		const privateChatId = (
			await db.select("chatTopicMappings", null, {
				topicId,
			})
		)[0].chatId;

		if (!privateChatId) {
			await ctx.reply("Could not find the private chat ID for this topic.");

			return;
		}

		await db.update(
			"users",
			{ blocked: blocked ? 1 : 0 },
			{ chatId: privateChatId },
		);
		const combined = fmt`This user has been ${b}${blocked ? "blocked" : "unblocked"}${b}.`;
		await ctx.reply(combined.text, {
			entities: combined.entities,
		});
	}) as Middleware;

export function registerBlockCommand(bot: HashiBot) {
	bot
		.command("block")
		.filter(
			async (ctx) => ctx.chat.id === Number.parseInt(env.GROUP_ID),
			createBlockHandler(true),
		);
	bot
		.command("unblock")
		.filter(
			async (ctx) => ctx.chat.id === Number.parseInt(env.GROUP_ID),
			createBlockHandler(false),
		);
}
