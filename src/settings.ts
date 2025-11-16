import type { Settings, Texts } from "./types";

export const defaultSettings = {
	messageSentNotification: 1,
} satisfies Settings;

export const defaultTexts = {
	welcome: "Hello, this is Hashi!",
	messageSent: "✅ Your message has been sent successfully.",
} satisfies Texts;
