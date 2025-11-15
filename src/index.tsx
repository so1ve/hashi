import { webhookCallback } from "grammy";
import { Hono } from "hono";

import { bot } from "./bot";
import { checker } from "./middlewares/checker";
import { errorHandler } from "./middlewares/error-handler";
import { initialize } from "./middlewares/initialize";
import { VerifyPage } from "./pages/verify";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.use(errorHandler).use(checker).use(initialize);

app.get("/", (c) => c.text("Hello, Hashi!"));
app.get("/verify", (c) => c.render(<VerifyPage />));

app.post("/webhook", (c) => webhookCallback(bot, "hono")(c));

export default app;
