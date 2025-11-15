import type { Handler } from "hono";

import { verifySuccess } from "../bot/verify";
import type { Env } from "../types";

export const verifyCallback: Handler<Env> = async (c) => {
	const { token, chatId } = await c.req.json();

	// verify https://challenges.cloudflare.com/turnstile/v0/siteverify
	const data: any = await fetch(
		"https://challenges.cloudflare.com/turnstile/v0/siteverify",
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				secret: c.env.TURNSTILE_SECRET_KEY,
				response: token,
			}),
		},
	).then((res) => res.json());

	if (!data.success) {
		return c.json({ status: "error", message: "Verification failed" });
	}

	await verifySuccess(Number.parseInt(chatId));

	return c.json({ status: "ok" });
};
