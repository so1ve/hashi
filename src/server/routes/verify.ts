import type { Context } from "hono";

import { TelegramClient } from "../../telegram/client.ts";
import type { AppBindings } from "../app.ts";
import { completeUserVerification } from "../bot.ts";
import { resolveBaseUrl } from "../config.ts";
import { verifyStateToken, verifyTelegramInitData } from "../crypto.ts";
import { renderVerifyPage } from "../ui/pages.ts";

export const TURNSTILE_ACTION = "hashi_verify";

interface TurnstileSiteverifyResponse {
  "success": boolean;
  "action"?: string;
  "hostname"?: string;
  "error-codes"?: string[];
}

export async function handleVerifyPage<E extends object>(
  c: Context<AppBindings<E>>,
): Promise<Response> {
  c.header("Cache-Control", "no-store");
  const config = c.get("config");

  if (!config.turnstile) {
    return c.html(renderVerifyPage({ status: "unconfigured" }), 503);
  }

  const stateToken = c.req.query("token") ?? "";
  const chatId = await verifyStateToken(config.botToken, stateToken);
  if (chatId === null) {
    return c.html(renderVerifyPage({ status: "invalid" }), 400);
  }

  return c.html(
    renderVerifyPage({
      status: "ready",
      siteKey: config.turnstile.siteKey,
      stateToken,
      action: TURNSTILE_ACTION,
    }),
  );
}

export async function handleVerifyCallback<E extends object>(
  c: Context<AppBindings<E>>,
): Promise<Response> {
  c.header("Cache-Control", "no-store");
  const config = c.get("config");
  const db = c.get("db");

  if (!config.turnstile) {
    return c.json(
      { status: "error", message: "Turnstile is not configured." },
      503,
    );
  }

  let body: { token?: unknown; state?: unknown; initData?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ status: "error", message: "Invalid JSON payload." }, 400);
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  const state = typeof body.state === "string" ? body.state.trim() : "";
  const initData =
    typeof body.initData === "string" ? body.initData.trim() : "";

  if (!token || token.length > 2048 || !state) {
    return c.json(
      { status: "error", message: "Missing verification token." },
      400,
    );
  }

  const chatId = await verifyStateToken(config.botToken, state);
  if (chatId === null) {
    return c.json(
      {
        status: "error",
        message: "Verification link expired. Request a new one in Telegram.",
      },
      403,
    );
  }

  if (initData) {
    const parsedInit = await verifyTelegramInitData(config.botToken, initData);
    if (parsedInit?.userId !== chatId) {
      return c.json(
        { status: "error", message: "Telegram session validation failed." },
        403,
      );
    }
  }

  const params = new URLSearchParams({
    secret: config.turnstile.secretKey,
    response: token,
  });
  const clientIp =
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  if (clientIp) {
    params.set("remoteip", clientIp);
  }

  let verifyResult: TurnstileSiteverifyResponse;
  try {
    const res = await fetch(config.turnstileSiteverifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`siteverify HTTP ${res.status}`);
    }
    verifyResult = await res.json<TurnstileSiteverifyResponse>();
  } catch {
    return c.json(
      {
        status: "error",
        message: "Could not reach verification service. Please try again.",
      },
      502,
    );
  }

  const expectedHostnames =
    config.turnstile.hostnames.size > 0
      ? config.turnstile.hostnames
      : new Set([new URL(c.req.url).hostname.toLowerCase()]);

  const returnedHost = verifyResult.hostname?.toLowerCase() ?? "";
  if (
    !verifyResult.success ||
    verifyResult.action !== TURNSTILE_ACTION ||
    !expectedHostnames.has(returnedHost)
  ) {
    return c.json(
      {
        status: "error",
        message: "Verification check did not pass. Please try again.",
      },
      403,
    );
  }

  const baseUrl = resolveBaseUrl(config, c.req.url);
  const telegram = new TelegramClient(
    config.botToken,
    config.telegramApiBaseUrl,
  );
  await completeUserVerification(
    {
      db,
      config,
      telegram,
      baseUrl,
      waitUntil: c.get("waitUntil"),
    },
    chatId,
  );

  return c.json({ status: "ok" });
}
