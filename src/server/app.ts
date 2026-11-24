import type { Context } from "hono";
import { Hono } from "hono";

import type { SqlDatabase } from "../db/index.ts";
import { getFeature, getStatsSummary } from "../db/index.ts";
import { TelegramClient } from "../telegram/client.ts";
import type { TelegramUpdate } from "../telegram/types.ts";
import { handleTelegramUpdate, setupBot } from "./bot.ts";
import type { LoadedConfig } from "./config.ts";
import { resolveBaseUrl } from "./config.ts";
import { errorMessage, timingSafeEqual } from "./crypto.ts";
import { handleVerifyCallback, handleVerifyPage } from "./routes/verify.ts";
import { renderStatusPage, renderUnconfiguredPage } from "./ui/pages.ts";

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

  app.get("/", async (c) => {
    let resolved: AppContext;
    try {
      resolved = await resolveContext(c);
    } catch (error) {
      c.header("Cache-Control", "no-store");

      return c.html(
        renderUnconfiguredPage(new URL(c.req.url).origin, errorMessage(error)),
        503,
      );
    }

    const [stats, verificationEnabled] = await Promise.all([
      getStatsSummary(resolved.db),
      getFeature(resolved.db, "verification"),
    ]);

    return c.html(
      renderStatusPage({
        baseUrl: resolveBaseUrl(resolved.config, c.req.url),
        turnstileConfigured: resolved.config.turnstile !== null,
        verificationEnabled,
        stats,
      }),
    );
  });

  app.use("*", async (c, next) => {
    const resolved = await resolveContext(c);
    c.set("db", resolved.db);
    c.set("config", resolved.config);
    c.set("waitUntil", resolved.waitUntil ?? defaultWaitUntil);
    await next();
  });

  app.get("/verify", handleVerifyPage);
  app.post("/verify/callback", handleVerifyCallback);

  app.post("/webhook", async (c) => {
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

    const telegram = new TelegramClient(
      config.botToken,
      config.telegramApiBaseUrl,
    );
    await handleTelegramUpdate(
      {
        db: c.get("db"),
        config,
        telegram,
        baseUrl: resolveBaseUrl(config, c.req.url),
        waitUntil: c.get("waitUntil"),
      },
      update,
    );

    return c.json({ ok: true });
  });

  app.post("/api/setup", async (c) => {
    const config = c.get("config");
    const authHeader = c.req.header("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : "";
    const [matchesSecret, matchesBotToken] = token
      ? await Promise.all([
          timingSafeEqual(token, config.webhookSecret),
          timingSafeEqual(token, config.botToken),
        ])
      : [false, false];
    if (!matchesSecret && !matchesBotToken) {
      return c.json({ ok: false, error: "unauthorized" }, 401);
    }

    const baseUrl = resolveBaseUrl(config, c.req.url);
    const telegram = new TelegramClient(
      config.botToken,
      config.telegramApiBaseUrl,
    );
    const report = await setupBot({ config, telegram, baseUrl });

    return c.json({ ok: true, ...report });
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

    return c.json({ ok: false, error: message }, 500);
  });

  return app;
}
