import { createMiddleware } from "hono/factory";
import type { Api } from "../api.ts";

let registered = false;

export const autoRegister = (api: Api) =>
	createMiddleware(async (c, next) => {
		if (!registered) {
			registered = true;
			const { origin } = new URL(c.req.url);
			await api.setWebhook(`${origin}/webhook`);
		}
		next();
	});
