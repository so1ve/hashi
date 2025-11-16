import { webhookCallback } from "grammy";
import { Hono } from "hono";

import { bot } from "./bot";
import { db } from "./db";
import { checker } from "./middlewares/checker";
import { errorHandler } from "./middlewares/error-handler";
import { initialize } from "./middlewares/initialize";
import type { Env } from "./types";
import { VerifyPage } from "./verify";
import { verifyCallback } from "./verify/callback";

const app = new Hono<Env>();

app.use(errorHandler).use(checker).use(initialize);

app.get("/", async (c) => {
	const a = await db.select("users");
	const b = await db.select("chatTopicMappings");
	const cc = await db.select("settings");

	return c.json({ status: "ok", users: a, mappings: b, settings: cc });
});
app.get("/verify", (c) =>
	c.render(<VerifyPage siteKey={c.env.TURNSTILE_SITE_KEY} />),
);
app.post("/verify/callback", verifyCallback);
app.post("/webhook", (c) => webhookCallback(bot, "hono")(c));

export default app;
