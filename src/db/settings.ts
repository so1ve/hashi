import type { SettingsKey, TextsKey } from "../settings";
import type { Settings, SqliteBoolean, Texts } from "../types";
import { toSqliteBoolean } from "../utils";
import { db } from ".";

export async function getSettings() {
	const settingsRows = await db.select("settings");

	return settingsRows.reduce((acc, row) => {
		acc[row.key] = row.value;

		return acc;
	}, {} as Settings);
}
export async function getSetting(key: SettingsKey) {
	const result = await db.select("settings", null, { key });

	return result[0].value;
}
export async function setSetting(
	key: SettingsKey,
	value: boolean | SqliteBoolean,
) {
	await db.update("settings", { key, value: toSqliteBoolean(value) }, { key });
}

export async function getTexts() {
	const textsRows = await db.select("texts");

	return textsRows.reduce((acc, row) => {
		acc[row.key] = row.value;

		return acc;
	}, {} as Texts);
}
export async function getText(key: TextsKey) {
	const result = await db.select("texts", null, { key });

	return result[0].value;
}
export async function setText(key: TextsKey, value: string) {
	await db.update("texts", { key, value }, { key });
}
