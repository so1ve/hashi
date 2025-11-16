import { toSqliteBoolean } from "../utils";
import { db } from ".";

export async function blockUser(chatId: number) {
	await db.update("users", { blocked: toSqliteBoolean(true) }, { chatId });
}

export async function unblockUser(chatId: number) {
	await db.update("users", { blocked: toSqliteBoolean(false) }, { chatId });
}

export async function isUserBlocked(chatId: number): Promise<boolean> {
	const user = (await db.select("users", null, { chatId }))[0];

	return user ? Boolean(user.blocked) : false;
}
