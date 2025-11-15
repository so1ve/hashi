import type { AbortController } from "abort-controller";
import { env } from "cloudflare:workers";

import * as kv from "../kv";
import { Aborted, avoidReductantCalls } from "../utils";
import type { HashiContext } from ".";

async function topicExists(ctx: HashiContext, topicId: number) {
	try {
		await ctx.api.reopenForumTopic(env.GROUP_ID, topicId);

		return true;
	} catch (e: any) {
		if (e.description.includes("TOPIC_NOT_MODIFIED")) {
			return true;
		}

		return false;
	}
}

const topicCreationRequests = new Map<number, AbortController>();

export async function ensureTopic(ctx: HashiContext, privateChatId: number) {
	const topicId = await kv.topicIdFromPrivateChatId.get(privateChatId);
	if (topicId && (await topicExists(ctx, topicId))) {
		await kv.privateChatIdFromTopicId.set(topicId, privateChatId);

		return topicId;
	}

	// Must be called within a context where ctx.chat is defined, like user private chats
	const title = ctx.chat!.first_name ?? `Chat ${privateChatId}`;

	const result = await avoidReductantCalls(
		topicCreationRequests,
		privateChatId,
		async (signal) => {
			const topic = await ctx.api.createForumTopic(
				env.GROUP_ID,
				title,
				undefined,
				signal,
			);

			return topic.message_thread_id;
		},
	);

	if (result !== Aborted) {
		await kv.topicIdFromPrivateChatId.set(privateChatId, result);
		await kv.privateChatIdFromTopicId.set(result, privateChatId);
	}

	return result;
}
