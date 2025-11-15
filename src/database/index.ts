/**
 * Intentially flatten KV structure to improve performance
 * user_states.id -> user_states:{privateChatId
 */
import QuickLRU from "quick-lru";

const mappingCache = new QuickLRU<number, number>({ maxSize: 1000 });
const topicCreationLocks = new Map<number, Promise<number>>();

let db: D1Database | null = null;

export function initDatabase(d1: D1Database) {
	db = d1;
}

export async function getTopicIdFromPrivateChatId(
	privateChatId: number,
): Promise<number | null> {
	const cached = mappingCache.get(privateChatId);
	if (cached !== undefined) {
		return cached;
	}

	if (!db) {
		throw new Error("Database not initialized");
	}

	const result = await db
		.prepare("SELECT topic_id FROM chat_topic_mappings WHERE chat_id = ?")
		.bind(privateChatId.toString())
		.first<{ topic_id: number }>();

	if (result?.topic_id) {
		mappingCache.set(privateChatId, result.topic_id);

		return result.topic_id;
	}

	return null;
}

export async function getPrivateChatIdFromTopicId(
	topicId: number,
): Promise<number | null> {
	// Check cache first
	for (const [chatId, tid] of mappingCache.entries()) {
		if (tid === topicId) {
			return chatId;
		}
	}

	if (!db) {
		throw new Error("Database not initialized");
	}

	const result = await db
		.prepare("SELECT chat_id FROM chat_topic_mappings WHERE topic_id = ?")
		.bind(topicId.toString())
		.first<{ chat_id: string }>();

	return result?.chat_id ? Number.parseInt(result.chat_id) : null;
}

export async function saveTopicMapping(
	privateChatId: number,
	topicId: number,
): Promise<void> {
	if (!db) {
		throw new Error("Database not initialized");
	}

	await db
		.prepare(
			"INSERT OR REPLACE INTO chat_topic_mappings (chat_id, topic_id) VALUES (?, ?)",
		)
		.bind(privateChatId.toString(), topicId.toString())
		.run();

	mappingCache.set(privateChatId, topicId);
}

export async function deleteTopicMapping(privateChatId: number): Promise<void> {
	if (!db) {
		throw new Error("Database not initialized");
	}

	await db
		.prepare("DELETE FROM chat_topic_mappings WHERE chat_id = ?")
		.bind(privateChatId.toString())
		.run();

	mappingCache.delete(privateChatId);
}

/**
 * Ensure a topic exists for a user with concurrency control
 */
export async function ensureUserTopic(
	privateChatId: number,
	botToken: string,
	groupId: string,
	userInfo: { username: string; nickname: string; id: number },
): Promise<number> {
	// Check if lock exists, wait for it
	const existingLock = topicCreationLocks.get(privateChatId);
	if (existingLock) {
		return await existingLock;
	}

	// Create new lock
	const lockPromise = (async () => {
		try {
			// Check if topic already exists
			let topicId = await getTopicIdFromPrivateChatId(privateChatId);

			if (topicId !== null) {
				// Validate topic still exists
				const isValid = await validateTopic(topicId, botToken, groupId);
				if (isValid) {
					return topicId;
				}
				// Topic invalid, delete mapping
				await deleteTopicMapping(privateChatId);
			}

			// Create new topic
			topicId = await createForumTopic(userInfo.nickname, botToken, groupId);

			// Save mapping
			await saveTopicMapping(privateChatId, topicId);

			// Send welcome message
			const now = new Date();
			const formattedTime = now.toISOString().replace("T", " ").slice(0, 19);
			const welcomeMessage = `昵称: ${userInfo.nickname}\n用户名: @${userInfo.username}\nUserID: ${userInfo.id}\n发起时间: ${formattedTime}`;

			await sendMessageToTopic(topicId, welcomeMessage, botToken, groupId);

			return topicId;
		} finally {
			topicCreationLocks.delete(privateChatId);
		}
	})();

	topicCreationLocks.set(privateChatId, lockPromise);

	return await lockPromise;
}

async function createForumTopic(
	name: string,
	botToken: string,
	groupId: string,
): Promise<number> {
	const response = await fetch(
		`https://api.telegram.org/bot${botToken}/createForumTopic`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				chat_id: groupId,
				name,
			}),
		},
	);

	const data: any = await response.json();

	if (!data.ok) {
		throw new Error(`Failed to create forum topic: ${data.description}`);
	}

	return data.result.message_thread_id;
}

async function validateTopic(
	topicId: number,
	botToken: string,
	groupId: string,
): Promise<boolean> {
	try {
		const response = await fetch(
			`https://api.telegram.org/bot${botToken}/sendMessage`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					chat_id: groupId,
					message_thread_id: topicId,
					text: "Validation check",
					disable_notification: true,
				}),
			},
		);

		const data: any = await response.json();

		if (data.ok) {
			// Delete validation message
			await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					chat_id: groupId,
					message_id: data.result.message_id,
				}),
			});

			return true;
		}

		return false;
	} catch {
		return false;
	}
}

async function sendMessageToTopic(
	topicId: number,
	text: string,
	botToken: string,
	groupId: string,
): Promise<void> {
	const response = await fetch(
		`https://api.telegram.org/bot${botToken}/sendMessage`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				chat_id: groupId,
				message_thread_id: topicId,
				text,
			}),
		},
	);

	const data: any = await response.json();

	if (!data.ok) {
		throw new Error(`Failed to send message to topic: ${data.description}`);
	}
}
