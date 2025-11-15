import type { Menu } from "@grammyjs/menu";
import { env } from "cloudflare:workers";

import * as kv from "../kv";
import { Aborted } from "../utils";
import { guard } from "./guard";
import { ensureTopic } from "./utils";
import type { HashiBot, HashiContext } from ".";

export function registerForwarder(
	bot: HashiBot,
	verificationMenu: Menu<HashiContext>,
) {
	bot.on("message").filter(
		async (ctx) => ctx.chat.type === "private",
		guard(verificationMenu),
		async (ctx) => {
			const topicId = await ensureTopic(ctx, ctx.chatId);

			if (topicId === Aborted) {
				return;
			}

			await ctx.message.copy(env.GROUP_ID, { message_thread_id: topicId });
		},
	);

	bot.on("message:is_topic_message").filter(
		async (ctx) =>
			!ctx.from.is_bot && ctx.chat.id === Number.parseInt(env.GROUP_ID),
		async (ctx) => {
			const topicId = ctx.message.message_thread_id;
			const privateChatId = await kv.privateChatIdFromTopicId.get(topicId);

			if (!privateChatId) {
				await ctx.reply("Could not find the private chat ID for this topic.");

				return;
			}

			const user = await kv.users.get(privateChatId);
			if (user?.blocked) {
				await ctx.reply("This user has been blocked from using this bot.");

				return;
			}

			await ctx.message.copy(privateChatId);
		},
	);
}
