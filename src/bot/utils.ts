import type { AbortController } from "abort-controller";
import { env } from "cloudflare:workers";

import { db, getSystemValue, setSystemValue } from "../db";
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

function getUserInfo(ctx: HashiContext) {
	const chat = ctx.chat!;
	const chatId = ctx.chatId!;

	const name = getReadableUserName(ctx);
	const username = chat.username ? `@${chat.username}` : "N/A";
	const userLink = `tg://user?id=${chatId}`;

	const formattedInfo = [
		`Name: ${name}`,
		`Username: ${username}`,
		`ID: [${chatId}](${userLink})`,
	].join("\n");

	return formattedInfo;
}

function getReadableUserName(ctx: HashiContext) {
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

async function sendUserInfo(ctx: HashiContext, topicId: number) {
	const userInfo = getUserInfo(ctx);

	await ctx.api.sendMessage(env.GROUP_ID, userInfo, {
		message_thread_id: topicId,
		disable_notification: true,
		parse_mode: "Markdown",
	});
}

async function sendNotificationMessage(
	ctx: HashiContext,
	notificationsTopicId: number,
	userTopicId: number,
) {
	const userInfo = getUserInfo(ctx);
	const topicLink = `https://t.me/c/${env.GROUP_ID.replace("-100", "")}/${userTopicId}`;

	await ctx.api.sendMessage(
		env.GROUP_ID,
		`New user started a chat!\n\n${userInfo}`,
		{
			message_thread_id: notificationsTopicId,
			disable_notification: false,
			parse_mode: "Markdown",
			reply_markup: {
				inline_keyboard: [
					[
						{
							text: "Chat",
							url: topicLink,
						},
					],
				],
			},
		},
	);
}

const notificationsTopicCreationRequest = new Map<string, AbortController>();

export async function ensureNotificationsTopic(
	ctx: HashiContext,
): Promise<number | typeof Aborted> {
	const storedTopicId = await getSystemValue("notifications_topic");

	if (storedTopicId) {
		const topicId = Number.parseInt(storedTopicId);
		if (await topicExists(ctx, topicId)) {
			return topicId;
		}
	}

	const result = await avoidReductantCalls(
		notificationsTopicCreationRequest,
		"notifications_topic",
		async (signal) => {
			const topic = await ctx.api.createForumTopic(
				env.GROUP_ID,
				"Notifications",
				undefined,
				signal,
			);

			await ctx.api.sendMessage(
				env.GROUP_ID,
				"This topic will receive notifications when new users start a chat.",
				{
					message_thread_id: topic.message_thread_id,
					disable_notification: true,
				},
			);

			return topic.message_thread_id;
		},
	);

	if (result !== Aborted) {
		await setSystemValue("notifications_topic", result.toString());
	}

	return result;
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

	const title = getReadableUserName(ctx);

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

			const topicId = topic.message_thread_id;

			await sendUserInfo(ctx, topicId);

			// Send notification to the Notifications topic
			const notificationsTopicId = await ensureNotificationsTopic(ctx);
			if (notificationsTopicId !== Aborted) {
				await sendNotificationMessage(ctx, notificationsTopicId, topicId);
			}

			return topicId;
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
