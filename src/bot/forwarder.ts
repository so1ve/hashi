import type { Menu } from "@grammyjs/menu";
import { env } from "cloudflare:workers";

import { db } from "../db";
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

			// const messageSentNotificationEnabled = await getSetting(
			// 	"messageSentNotification",
			// );
			// const messageSentText = await getText("messageSent");
			// if (messageSentNotificationEnabled) {
			// 	const message = await ctx.reply(messageSentText, {
			// 		disable_notification: true,
			// 	});
			// 	await sleep(3000);
			// 	await ctx.api.deleteMessage(ctx.chat.id, message.message_id);
			// }
		},
	);

	bot.on("message:is_topic_message").filter(
		async (ctx) =>
			!ctx.from.is_bot && ctx.chat.id === Number.parseInt(env.GROUP_ID),
		async (ctx) => {
			const mapping = (
				await db.select("chatTopicMappings", null, {
					topicId: ctx.message.message_thread_id,
				})
			)[0];

			if (!mapping?.chatId) {
				await ctx.reply("Could not find the private chat ID for this topic.");

				return;
			}

			const user = (
				await db.select("users", null, {
					chatId: mapping.chatId,
				})
			)[0];
			if (user?.blocked) {
				await ctx.reply("This user has been blocked from using this bot.");

				return;
			}

			await ctx.message.copy(mapping.chatId);
		},
	);
}
