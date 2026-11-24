import type { Context } from "hono";
import { Hono } from "hono";

import type { SqlDatabase } from "../db/index.ts";
import { TelegramClient } from "../telegram/client.ts";
import type { TelegramUpdate } from "../telegram/types.ts";
import { ensureBotSetup, handleTelegramUpdate } from "./bot.ts";
import type { LoadedConfig } from "./config.ts";
import { resolveBaseUrl } from "./config.ts";
import { errorMessage, timingSafeEqual } from "./crypto.ts";
import { handleVerifyCallback, handleVerifyPage } from "./routes/verify.ts";

export interface AppContext {
  db: SqlDatabase;
  config: LoadedConfig;
  waitUntil?: (promise: Promise<unknown>) => void;
}

export interface AppBindings<E extends object = object> {
  Bindings: E;
  Variables: {
    db: SqlDatabase;
    config: LoadedConfig;
    waitUntil: (promise: Promise<unknown>) => void;
  };
}

export type AppContextResolver<E extends object = object> = (
  c: Context<AppBindings<E>>,
) => AppContext | Promise<AppContext>;

function defaultWaitUntil(promise: Promise<unknown>): void {
  void promise.catch((error: unknown) => {
    console.error(
      JSON.stringify({
        message: "background task failed",
        error: errorMessage(error),
      }),
    );
  });
}

export function createApp<E extends object = object>(
  resolveContext: AppContextResolver<E>,
): Hono<AppBindings<E>> {
  const app = new Hono<AppBindings<E>>();

  app.get("/healthz", (c) => c.text("ok\n"));

  app.use("*", async (c, next) => {
    const resolved = await resolveContext(c);
    c.set("db", resolved.db);
    c.set("config", resolved.config);
    c.set("waitUntil", resolved.waitUntil ?? defaultWaitUntil);
    await next();
  });

  app.get("/", async (c) => {
    const db = c.get("db");
    const config = c.get("config");
    const baseUrl = resolveBaseUrl(config, c.req.url);
    const telegram = new TelegramClient(
      config.botToken,
      config.telegramApiBaseUrl,
    );

    await ensureBotSetup({ db, config, telegram, baseUrl });

    if (config.groupId === null) {
      return c.text(
        "Hello from Hashi! Webhook registered. Add the bot to your forum group, send /id to get GROUP_ID, then set GROUP_ID.",
      );
    }

    return c.text("Hello from Hashi!");
  });

  app.get("/verify", handleVerifyPage);
  app.post("/verify/callback", handleVerifyCallback);

  app.post("/webhook", async (c) => {
    const db = c.get("db");
    const config = c.get("config");
    const providedSecret = c.req.header("x-telegram-bot-api-secret-token");
    if (
      !providedSecret ||
      !(await timingSafeEqual(providedSecret, config.webhookSecret))
    ) {
      return c.json({ ok: false, error: "unauthorized" }, 401);
    }

    let update: TelegramUpdate;
    try {
      update = await c.req.json<TelegramUpdate>();
    } catch {
      return c.json({ ok: false, error: "invalid JSON" }, 400);
    }

    const baseUrl = resolveBaseUrl(config, c.req.url);
    const telegram = new TelegramClient(
      config.botToken,
      config.telegramApiBaseUrl,
    );
    const waitUntil = c.get("waitUntil");

    waitUntil(ensureBotSetup({ db, config, telegram, baseUrl }));

    await handleTelegramUpdate(
      {
        db,
        config,
        telegram,
        baseUrl,
        waitUntil,
      },
      update,
    );

    return c.json({ ok: true });
  });

  app.onError((error, c) => {
    const message = errorMessage(error);
    console.error(
      JSON.stringify({
        message: "unhandled server error",
        method: c.req.method,
        path: c.req.path,
        error: message,
      }),
    );

    return c.text(message, 500);
  });

  return app;
}
