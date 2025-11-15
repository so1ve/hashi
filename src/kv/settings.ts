import { env } from "cloudflare:workers";
import { defu } from "defu";

import { defaultSettings } from "../settings";
import type { DeepPartial, Settings } from "../types";

const { KV } = env;

let cachedSettings: Settings | null = null;

export const settings = {
	get: async (): Promise<Settings> => {
		cachedSettings ??= await KV.get("settings", { type: "json" });

		return cachedSettings ?? defaultSettings;
	},
	update: async (data: DeepPartial<Settings>) => {
		const merged = defu(data, await settings.get());
		cachedSettings = merged;
		await KV.put("settings", JSON.stringify(merged));
	},
};

export async function initializeSettings() {
	const current = await settings.get();
	if (current) {
		return;
	}

	await settings.update(defaultSettings);
}
