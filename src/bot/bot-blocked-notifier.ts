import { env } from "cloudflare:workers";

import { Aborted } from "../utils";
import { ensureTopic } from "./utils";
import type { HashiBot } from ".";

export function registerBotBlockedNotifier(bot: HashiBot) {
	bot.on("my_chat_member").filter(
		async (ctx) =>
			ctx.myChatMember.new_chat_member.status === "kicked" ||
			ctx.myChatMember.new_chat_member.status === "left",
		async (ctx) => {
			const chatId = ctx.myChatMember.chat.id;
			const topicId = await ensureTopic(ctx, chatId);
			if (topicId === Aborted) {
				return;
			}

			await bot.api.sendMessage(env.GROUP_ID, "User blocked the bot.", {
				message_thread_id: topicId,
			});
		},
	);
}
