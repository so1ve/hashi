import type { AbortSignal } from "abort-controller";
import { AbortController } from "abort-controller";

import type { SqliteBoolean } from "./types";

export const Aborted = Symbol("Aborted");

export async function avoidReductantCalls<T, R>(
	map: Map<T, AbortController>,
	key: T,
	fn: (signal: AbortSignal) => Promise<R>,
): Promise<R | typeof Aborted> {
	const existingController = map.get(key);
	if (existingController) {
		existingController.abort();
		map.delete(key);
	}

	const controller = new AbortController();
	map.set(key, controller);

	try {
		return await fn(controller.signal);
	} catch (error) {
		if ((error as Error).name !== "AbortError") {
			throw error;
		}

		return Aborted;
	} finally {
		if (map.get(key) === controller) {
			map.delete(key);
		}
	}
}

export const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));
export const toSqliteBoolean = (
	value: boolean | SqliteBoolean,
): SqliteBoolean => (value ? 1 : 0);
