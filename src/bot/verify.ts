import * as kv from "../kv";
import { bot } from ".";

export async function verifySuccess(chatId: number) {
	const user = await kv.users.get(chatId);
	if (user) {
		if (user.verificationMessageId) {
			await bot.api.deleteMessage(chatId, user.verificationMessageId);
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
