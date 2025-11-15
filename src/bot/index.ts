import type { HydrateFlavor } from "@grammyjs/hydrate";
import { hydrate } from "@grammyjs/hydrate";
import { Menu, MenuRange } from "@grammyjs/menu";
import type { Context, SessionFlavor } from "grammy";
import { Bot, session } from "grammy";

import { registerBlockCommand } from "./block";
import { registerBotBlockedNotifier } from "./bot-blocked-notifier";
import { registerForwarder } from "./forwarder";
import { guard } from "./guard";
import { registerSettings } from "./settings";
import { ensureTopic } from "./utils";

// Define the shape of our session.
interface SessionData {
	awaitingTextSetting: string | null;
}

export type HashiContext = HydrateFlavor<Context & SessionFlavor<SessionData>>;
// don't check env existence here because we have `env-checker` middleware
export const bot = new Bot<HashiContext>(process.env.BOT_TOKEN);
export type HashiBot = typeof bot;

bot.use(hydrate());
bot.use(
	session<SessionData, HashiContext>({
		initial: () => ({ awaitingTextSetting: null }),
	}),
);

await bot.api.setMyCommands([
	{ command: "start", description: "Start the bot" },
	{ command: "block", description: "Block user" },
	{ command: "settings", description: "Configure your settings" },
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
		guard(verificationMenu),
		async (ctx) => {
			await ensureTopic(ctx, ctx.chatId);

			await ctx.reply("Hello! I'm Hashi.");
		},
	);

	registerBlockCommand(bot);
	registerForwarder(bot, verificationMenu);
	registerBotBlockedNotifier(bot);
	registerSettings(bot);
}
