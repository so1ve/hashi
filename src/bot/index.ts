import type { HydrateFlavor } from "@grammyjs/hydrate";
import { hydrate } from "@grammyjs/hydrate";
import { Menu, MenuRange } from "@grammyjs/menu";
import { b, fmt } from "@grammyjs/parse-mode";
import { addReplyParam } from "@roziscoding/grammy-autoquote";
import { env } from "cloudflare:workers";
import type { Context } from "grammy";
import { Bot } from "grammy";

import * as kv from "../kv";
import { Aborted } from "../utils";
import { guard } from "./guard";
import { ensureTopic } from "./utils";

export type HashiContext = HydrateFlavor<Context>;
// don't check env existence here because we have `env-checker` middleware
export const bot = new Bot<HashiContext>(process.env.BOT_TOKEN);
export type HashiBot = typeof bot;

bot.use(hydrate());
// bot.api.config.use(autoRetry());

await bot.api.setMyCommands([
	{ command: "start", description: "Start the bot" },
]);

const initialized = false;

export function initializeBot(hostname: string) {
	if (initialized) {
		return;
	}

	const verificationMenu = new Menu<HashiContext>("verification")
		.dynamic((ctx) => {
			const range = new MenuRange<HashiContext>();

			range.webApp(
				"Click to Verify",
				`https://${hostname}/verify?chatId=${ctx.chatId}`,
			);

			return range;
		})
		.text("Cancel", (ctx) => ctx.deleteMessage());

	bot.use(verificationMenu);

	bot.command("start").filter(
		async (ctx) => ctx.chat.type === "private",
		guard,
		async (ctx) => {
			const user = await kv.users.get(ctx.chatId);
			if (!user) {
				await kv.users.set(ctx.chatId, { blocked: false, verified: false });
			}

			if (user?.verified) {
				if (user?.verificationMessageId) {
					try {
						await ctx.api.deleteMessage(ctx.chatId, user.verificationMessageId);
					} catch {}
				}

				if (!verificationMenu) {
					throw new Error("Verification menu not initialized");
				}
				const message = await ctx.reply(
					"Please verify yourself using the button below.",
					{
						reply_markup: verificationMenu,
					},
				);

				await kv.users.set(ctx.chatId, {
					...user,
					verificationMessageId: message.message_id,
				});

				return;
			}

			await ensureTopic(ctx, ctx.chatId);

			await ctx.reply("Hello! I'm Hashi.");
		},
	);

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
			const user = (await kv.users.get(privateChatId)) ?? {};

			await kv.users.set(privateChatId, { ...user, blocked });
			const combined = fmt`This user has been ${b}${blocked ? "blocked" : "unblocked"}${b}.`;
			await ctx.reply(combined.text, {
				entities: combined.entities,
			});
		},
	);

	bot.on("message").filter(
		async (ctx) => ctx.chat.type === "private",
		guard,
		async (ctx) => {
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

			const isBlocked = await kv.users.get(privateChatId);
			if (isBlocked) {
				await ctx.reply("This user has been blocked from using this bot.");

				return;
			}

			await ctx.message.copy(privateChatId);
		},
	);
}
