import { webhookCallback } from "grammy";
import { Hono } from "hono";

import { bot } from "./bot";
import { checker } from "./middlewares/checker";
import { errorHandler } from "./middlewares/error-handler";
import { initialize } from "./middlewares/initialize";

const app = new Hono();

app.use(errorHandler).use(checker).use(initialize);

app.get("/", (c) => c.text("Hello, Hashi!"));
app.post("/webhook", (c) => webhookCallback(bot, "hono")(c));

export default app;
