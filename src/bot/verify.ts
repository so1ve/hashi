import type { Menu } from "@grammyjs/menu";

import * as kv from "../kv";
import type { HashiContext } from ".";
import { bot } from ".";

export async function sendVerification(
	ctx: HashiContext,
	verificationMenu: Menu<HashiContext>,
	chatId: number,
) {
	let user = await kv.users.get(chatId);

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

		user = await kv.users.get(chatId);
		await kv.users.set(chatId, {
			...user,
			verificationMessageId: message.message_id,
		});
	}
}

export async function verifySuccess(chatId: number) {
	const user = await kv.users.get(chatId);
	if (user) {
		if (user.verificationMessageId) {
			try {
				await bot.api.deleteMessage(chatId, user.verificationMessageId);
			} catch {}
		}
		await kv.users.set(chatId, {
			...user,
			verified: true,
			verificationMessageId: undefined,
		});
	}
	await bot.api.sendMessage(
		chatId,
		"Verification successful! You can now use the bot.",
	);
}
