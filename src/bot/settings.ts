import { Menu, MenuRange } from "@grammyjs/menu";
import { env } from "cloudflare:workers";

import { getSettings, getTexts, setSetting, setText } from "../db";
import { defaultTexts } from "../settings";
import type { TextsKey } from "../types";
import type { HashiBot, HashiContext } from ".";

const textKeys = Object.keys(defaultTexts) as TextsKey[];

const textItemLabels = {
	welcome: "Welcome Message",
	messageSent: "Message Sent Confirmation",
} satisfies Record<TextsKey, string>;

export function registerSettings(bot: HashiBot) {
	const text = new Menu<HashiContext>("settings_text")
		.dynamic(async (_ctx) => {
			const range = new MenuRange<HashiContext>();
			const texts = await getTexts();

			for (const item of textKeys) {
				const currentValue = texts[item];
				const label = textItemLabels[item];
				const buttonText = currentValue ? `✏️ ${label}` : `➕ ${label}`;

				range.text(buttonText, async (ctx) => {
					let message = "";
					if (currentValue) {
						message += `Current ${label}:\n\n${currentValue}\n\n`;
					}
					message += "Please send the new text.\n\nSend /cancel to cancel.";

					await ctx.reply(message);
					ctx.session.awaitingTextSetting = item;
					await ctx.answerCallbackQuery();
				});
				range.row();
			}

			return range;
		})
		.back("⬅️ Back");

	const features = new Menu<HashiContext>("settings_features")
		.dynamic(async (_ctx) => {
			const range = new MenuRange<HashiContext>();
			const settings = await getSettings();

			const messageSentEnabled = settings.messageSentNotification;
			const statusIcon = messageSentEnabled ? "✅" : "❌";

			range.text(`${statusIcon} Message Sent Notification`, async (ctx) => {
				await setSetting("messageSentNotification", !messageSentEnabled);

				await ctx.answerCallbackQuery(
					messageSentEnabled
						? "Message Sent Notification disabled"
						: "Message Sent Notification enabled",
				);
				ctx.menu.update();
			});
			range.row();

			return range;
		})
		.back("⬅️ Back");

	const main = new Menu<HashiContext>("settings")
		.submenu("⚙️ Feature Settings", "settings_features")
		.submenu("📝 Text Settings", "settings_text");

	main.register(text);
	main.register(features);
	bot.use(main);

	bot
		.on("message:text")
		.filter(
			async (ctx) =>
				ctx.chat.id === Number.parseInt(env.GROUP_ID) &&
				ctx.session.awaitingTextSetting !== null,
		)
		.filter(async (ctx) => !ctx.message.text.startsWith("/settings"))
		.use(async (ctx) => {
			const text = ctx.message.text;

			if (text.startsWith("/cancel")) {
				ctx.session.awaitingTextSetting = null;
				await ctx.reply("❌ Cancelled.");

				return;
			}

			const settingKey = ctx.session.awaitingTextSetting;
			if (!settingKey) {
				return;
			}

			await setText(settingKey, text);

			ctx.session.awaitingTextSetting = null;

			await ctx.reply(
				`✅ ${textItemLabels[settingKey]} has been updated successfully!`,
			);
		});

	bot.command("settings").filter(
		async (ctx) => ctx.chat.id === Number.parseInt(env.GROUP_ID),
		async (ctx) => {
			await ctx.reply("⚙️ Change your settings", {
				reply_markup: main,
			});
		},
	);
}
