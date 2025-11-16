import type { AbortController } from "abort-controller";
import { env } from "cloudflare:workers";

import { db } from "../db";
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

function getTopicName(ctx: HashiContext) {
	// Must be called within a context where ctx.chat is defined, like user private chats
	const chat = ctx.chat!;

	if (chat.first_name) {
		const fullName = chat.last_name
			? `${chat.first_name} ${chat.last_name}`
			: chat.first_name;

		return fullName;
	}

	if (chat.username) {
		return `@${chat.username}`;
	}

	return `User ${ctx.chatId}`;
}

export async function ensureTopic(ctx: HashiContext, privateChatId: number) {
	const mapping = (
		await db.select("chatTopicMappings", null, {
			chatId: privateChatId,
		})
	)[0];
	if (mapping && (await topicExists(ctx, mapping.topicId))) {
		return mapping.topicId;
	}

	const title = getTopicName(ctx);

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
		await db.insert(
			"chatTopicMappings",
			{
				chatId: privateChatId,
				topicId: result,
			},
			{ or: "REPLACE" },
		);
	}

	return result;
}

export async function ensureUser(chatId: number) {
	let user = (
		await db.select("users", null, {
			chatId,
		})
	)[0];
	if (!user) {
		user = {
			chatId,
			blocked: 0,
			verified: 0,
			verificationMessageId: null,
		};
		await db.insert("users", user);
	}

	return user;
}
