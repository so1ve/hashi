/**
 * Intentially flatten KV structure to improve performance
 * user_states.id -> user_states:{privateChatId}
 */
import { env } from "cloudflare:workers";
import QuickLRU from "quick-lru";

const { KV } = env;

const mappingCache = new QuickLRU<string, number>({ maxSize: 1000 });
const blockedUsersCache = new QuickLRU<string, boolean>({ maxSize: 1000 });

const createCachedKv = <V, R>(
	cache: QuickLRU<string, R>,
	keyTransformer: (key: V) => string,
) => ({
	get: async (_key: V) => {
		const key = keyTransformer(_key);
		const cached = cache.get(key);
		if (cached) {
			return cached;
		}

		const result = await KV.get<R>(key, {
			type: "json",
		});
		if (result) {
			cache.set(key, result);
		}

		return result;
	},

	set: async (_key: V, value: R) => {
		const key = keyTransformer(_key);
		cache.set(key, value);
		await KV.put(key, JSON.stringify(value));
	},
});

export const topicIdFromPrivateChatId = createCachedKv<number, number>(
	mappingCache,
	(key) => `private_chat_to_topic:${key}`,
);
export const privateChatIdFromTopicId = createCachedKv<number, number>(
	mappingCache,
	(key) => `topic_to_private_chat:${key}`,
);

export const blockedUsers = createCachedKv<number, boolean>(
	blockedUsersCache,
	(key) => `blocked_user:${key}`,
);
