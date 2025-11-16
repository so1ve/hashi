import type { HydrateFlavor } from "@grammyjs/hydrate";
import { hydrate } from "@grammyjs/hydrate";
import { Menu, MenuRange } from "@grammyjs/menu";
import { env } from "cloudflare:workers";
import type { Context, SessionFlavor } from "grammy";
import { Bot, session } from "grammy";

import { getText } from "../db";
import type { TextsKey } from "../types";
import { registerBlockCommand } from "./block";
import { registerBotBlockedNotifier } from "./bot-blocked-notifier";
import { registerForwarder } from "./forwarder";
import { guard } from "./guard";
import { registerSettings } from "./settings";

// Define the shape of our session.
interface SessionData {
	awaitingTextSetting: TextsKey | null;
}

export type HashiContext = HydrateFlavor<Context & SessionFlavor<SessionData>>;
// Declare bot but don't initialize it yet.
// The bot will be initialized in `initializeBot()`
export let bot: Bot<HashiContext>;
export type HashiBot = typeof bot;

export async function initializeBot(hostname: string) {
	if (bot) {
		return;
	}

	// don't check env existence here because we have `checker` middleware
	bot = new Bot<HashiContext>(env.BOT_TOKEN);

	bot.use(hydrate());
	bot.use(
		session<SessionData, HashiContext>({
			initial: () => ({ awaitingTextSetting: null }),
		}),
	);

	await bot.api.setMyCommands([
		{ command: "start", description: "Start the bot" },
		{ command: "block", description: "Block user" },
		{ command: "unblock", description: "Unblock user" },
		{ command: "settings", description: "Configure your settings" },
	]);

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
		guard(verificationMenu),
		async (ctx) => {
			const text = await getText("welcome");
			await ctx.reply(text);
		},
	);

	registerBlockCommand(bot);
	registerForwarder(bot, verificationMenu);
	registerBotBlockedNotifier(bot);
	registerSettings(bot);
}
