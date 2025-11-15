import * as kv from "../kv";
import { bot } from ".";

export async function verifySuccess(chatId: number, messageId: string) {
	console.log({ userId: chatId, messageId });

	const user = await kv.users.get(chatId);
	if (user) {
		await kv.users.set(chatId, { ...user, verified: true });
	}
	await bot.api.deleteMessage(chatId, Number.parseInt(messageId));
	await bot.api.sendMessage(
		chatId,
		"Verification successful! You can now use the bot.",
	);
}
