const kv = await Deno.openKv();

export async function getUser(chatId: string) {
	return await kv.get<{ chatId: string; subscribed: boolean }>([
		"users",
		chatId,
	]);
}
