import { autoRetry } from "@grammyjs/auto-retry";
import type { HydrateFlavor } from "@grammyjs/hydrate";
import { hydrate } from "@grammyjs/hydrate";
import type { Context } from "grammy";
import { Bot } from "grammy";

import { ensureUserTopic, getPrivateChatIdFromTopicId } from "../database";

type MyContext = HydrateFlavor<Context>;

// don't check env existence here because we have `env-checker` middleware
export const bot = new Bot<MyContext>(process.env.BOT_TOKEN);

bot.use(hydrate());
bot.api.config.use(autoRetry());

// Handle private messages from users
bot.on("message").filter(
	async (ctx) => !ctx.message.is_topic_message,
	async (ctx) => {
		const privateChatId = ctx.chat.id;
		const text = ctx.message.text ?? "";

		try {
			// Get user info
			const userInfo = {
				id: ctx.from.id,
				username: ctx.from.username ?? `User_${privateChatId}`,
				nickname:
					ctx.from.first_name +
					(ctx.from.last_name ? ` ${ctx.from.last_name}` : ""),
			};

			// Ensure topic exists (with concurrency control)
			const topicId = await ensureUserTopic(
				privateChatId,
				process.env.BOT_TOKEN,
				process.env.GROUP_ID,
				userInfo,
			);

			// Forward message to topic
			const formattedMessage = `${userInfo.nickname}:\n${text}`;
			await ctx.api.sendMessage(process.env.GROUP_ID, formattedMessage, {
				message_thread_id: topicId,
			});

			// Confirm to user
			await ctx.reply("消息已发送！");
		} catch (error) {
			console.error("Error handling private message:", error);
			await ctx.reply("消息发送失败，请稍后重试。");
		}
	},
);

// Handle messages in group topics - forward back to private chat
bot.on("message:is_topic_message", async (ctx) => {
	const topicId = ctx.message.message_thread_id;
	if (!topicId) {
		return;
	}

	try {
		// Get the private chat ID associated with this topic
		const privateChatId = await getPrivateChatIdFromTopicId(topicId);

		if (privateChatId) {
			const text = ctx.message.text ?? "";
			await ctx.api.sendMessage(privateChatId, text);
		}
	} catch (error) {
		console.error("Error handling topic message:", error);
	}
});
