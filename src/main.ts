import { Hono } from "hono";
import { envChecker } from "./middlewares/env-checker.ts";
import { autoRegister } from "./middlewares/auto-register.ts";
import { Api } from "./api.ts";
import "@std/dotenv/load";

const app = new Hono();
// Use assertion here since we other routes are protected by envChecker
const api = new Api(Deno.env.get("BOT_TOKEN")!);

app
	.use(envChecker)
	.use(autoRegister(api));

Deno.serve(app.fetch);
