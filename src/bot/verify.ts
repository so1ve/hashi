import type { Menu } from "@grammyjs/menu";
import { env } from "cloudflare:workers";

import { db } from "../db";
import type { HashiContext } from ".";
import { bot } from ".";

export async function sendVerification(
	ctx: HashiContext,
	verificationMenu: Menu<HashiContext>,
	chatId: number,
) {
	const user = (await db.select("users", null, { chatId }))[0];

	if (!user?.verified) {
		if (user?.verificationMessageId) {
			try {
				await ctx.api.deleteMessage(chatId, user.verificationMessageId);
			} catch {}
		}

		const message = await ctx.reply(
			"Please verify yourself using the button below.",
			{
				reply_markup: verificationMenu,
			},
		);

		await db.update(
			"users",
			{
				verificationMessageId: message.message_id,
			},
			{ chatId },
		);
	}
}

export async function verifySuccess(chatId: number) {
	const user = (await db.select("users", null, { chatId }))[0];
	if (user) {
		if (user.verificationMessageId) {
			try {
				await bot.api.deleteMessage(chatId, user.verificationMessageId);
			} catch {}
		}
		await db.update(
			"users",
			{
				verified: 1,
				verificationMessageId: null,
			},
			{ chatId },
		);
	}
	await bot.api.sendMessage(
		chatId,
		"Verification successful! You can now use the bot.",
	);

	const mapping = (await db.select("chatTopicMappings", null, { chatId }))[0];
	await bot.api.sendMessage(env.GROUP_ID, "User passed verification.", {
		message_thread_id: mapping.topicId,
	});
}
