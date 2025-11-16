import type { SettingsKey, TextsKey } from "../types";
import { db } from ".";

export async function getSettings() {
	const settingsRows = await db.select("settings");

	return settingsRows.reduce(
		(acc, row) => {
			acc[row.key] = Boolean(row.value);

			return acc;
		},
		{} as Record<SettingsKey, boolean>,
	);
}
export async function getSetting(key: SettingsKey) {
	const result = await db.select("settings", null, { key });

	return result[0].value;
}
export async function setSetting(key: SettingsKey, value: boolean) {
	await db.update("settings", { key, value: value ? 1 : 0 }, { key });
}

export async function getTexts() {
	const textsRows = await db.select("texts");

	return textsRows.reduce(
		(acc, row) => {
			acc[row.key] = Boolean(row.value);

			return acc;
		},
		{} as Record<TextsKey, boolean>,
	);
}
export async function getText(key: TextsKey) {
	const result = await db.select("texts", null, { key });

	return result[0].value;
}
export async function setText(key: TextsKey, value: string) {
	await db.update("texts", { key, value }, { key });
}
