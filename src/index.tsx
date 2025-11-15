import { webhookCallback } from "grammy";
import { Hono } from "hono";

import { bot } from "./bot";
import { checker } from "./middlewares/checker";
import { errorHandler } from "./middlewares/error-handler";
import { initialize } from "./middlewares/initialize";
import type { Env } from "./types";
import { VerifyPage } from "./verify";
import { verifyCallback } from "./verify/callback";

const app = new Hono<Env>();

app.use(errorHandler).use(checker).use(initialize);

app.get("/", (c) => c.text("Hello, Hashi!"));
app.get("/verify", (c) =>
	c.render(<VerifyPage siteKey={c.env.TURNSTILE_SITE_KEY} />),
);
app.post("/verify/callback", verifyCallback);
app.post("/webhook", (c) => webhookCallback(bot, "hono")(c));

export default app;
