import type { Settings, Texts } from "./types";

export const defaultSettings = {
	messageSentNotification: 1,
	verification: 0,
} satisfies Settings;
export type SettingsKey = keyof typeof defaultSettings;
export const settingItemLabels = {
	messageSentNotification: "Message Sent Notification",
	verification: "User Verification",
} satisfies Record<SettingsKey, string>;

export const defaultTexts = {
	welcome: "Hello, this is Hashi!",
	messageSent: "✅ Your message has been sent successfully.",
} satisfies Texts;
export type TextsKey = keyof typeof defaultTexts;
export const textItemLabels = {
	welcome: "Welcome Message",
	messageSent: "Message Sent Confirmation",
} satisfies Record<TextsKey, string>;
