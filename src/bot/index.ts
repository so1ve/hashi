import { autoRetry } from "@grammyjs/auto-retry";
import type { HydrateFlavor } from "@grammyjs/hydrate";
import { hydrate } from "@grammyjs/hydrate";
import { b, fmt } from "@grammyjs/parse-mode";
import { addReplyParam } from "@roziscoding/grammy-autoquote";
import type { AbortController } from "abort-controller";
import { env } from "cloudflare:workers";
import type { Context } from "grammy";
import { Bot } from "grammy";

import * as kv from "../kv";
import { Aborted, avoidReductantCalls } from "../utils";

export type HashiContext = HydrateFlavor<Context>;
// don't check env existence here because we have `env-checker` middleware
export const bot = new Bot<HashiContext>(process.env.BOT_TOKEN);
export type HashiBot = typeof bot;

bot.use(hydrate());
bot.api.config.use(autoRetry());

await bot.api.setMyCommands([
	{ command: "start", description: "Start the bot" },
]);

async function topicExists(ctx: Context, topicId: number) {
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

async function ensureTopic(ctx: Context, privateChatId: number) {
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

bot.command("start", async (ctx) => {
	await ctx.reply(
		"Hello! I'm hashi. Send me a message in private chat, and I'll create a forum topic for you in the group.",
	);

	await ensureTopic(ctx, ctx.chatId);
});

bot.command("block").filter(
	async (ctx) => ctx.chat.id === Number.parseInt(env.GROUP_ID),
	async (ctx) => {
		ctx.api.config.use(addReplyParam(ctx));

		if (!ctx.message) {
			await ctx.reply("ctx.message not found!");

			return;
		}

		if (!ctx.message?.message_thread_id) {
			await ctx.reply("Please use this command in a topic.");

			return;
		}

		const topicId = ctx.message.message_thread_id;
		const privateChatId = await kv.privateChatIdFromTopicId.get(topicId);

		if (!privateChatId) {
			await ctx.reply("Could not find the private chat ID for this topic.");

			return;
		}

		const param = ctx.match || "true";

		if (param !== "true" && param !== "false") {
			const combined = fmt`Please provide ${b}true${b} or ${b}false${b} as parameter.`;
			await ctx.reply(combined.text, {
				entities: combined.entities,
			});

			return;
		}
		const blocked = param === "true";
		const user = (await kv.blockedUsers.get(privateChatId)) ?? {};
		await kv.blockedUsers.set(privateChatId, { ...user, blocked });
		const combined = fmt`This user has been ${b}${blocked ? "blocked" : "unblocked"}${b}.`;
		await ctx.reply(combined.text, {
			entities: combined.entities,
		});
	},
);

bot.on("message").filter(
	async (ctx) => ctx.chat.type === "private",
	async (ctx) => {
		const user = await kv.blockedUsers.get(ctx.from.id);
		if (user?.blocked) {
			await ctx.reply("You are blocked from using this bot.");

			return;
		}

		const topicId = await ensureTopic(ctx, ctx.chatId);

		if (topicId === Aborted) {
			return;
		}

		await ctx.message.copy(env.GROUP_ID, { message_thread_id: topicId });
	},
);

bot.on("message:is_topic_message").filter(
	async (ctx) =>
		!ctx.from.is_bot && ctx.chat.id === Number.parseInt(env.GROUP_ID),
	async (ctx) => {
		const topicId = ctx.message.message_thread_id;
		const privateChatId = await kv.privateChatIdFromTopicId.get(topicId);

		if (!privateChatId) {
			await ctx.reply("Could not find the private chat ID for this topic.");

			return;
		}

		const isBlocked = await kv.blockedUsers.get(privateChatId);
		if (isBlocked) {
			await ctx.reply("This user has been blocked from using this bot.");

			return;
		}

		await ctx.message.copy(privateChatId);
	},
);
