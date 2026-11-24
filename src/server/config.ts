import { deriveWebhookSecret } from "./crypto.ts";

export interface ServerRuntimeEnv {
  BOT_TOKEN?: string;
  GROUP_ID?: string;
  PUBLIC_BASE_URL?: string;
  WEBHOOK_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_HOSTNAMES?: string;
  TELEGRAM_API_BASE_URL?: string;
  TURNSTILE_SITEVERIFY_URL?: string;
}

export interface TurnstileConfig {
  siteKey: string;
  secretKey: string;
  hostnames: Set<string>;
}

export interface LoadedConfig {
  botToken: string;
  groupId: number;
  publicBaseUrl: string | null;
  webhookSecret: string;
  turnstile: TurnstileConfig | null;
  telegramApiBaseUrl: string;
  turnstileSiteverifyUrl: string;
}

const stripTrailingSlash = (url: string): string =>
  url.trim().replace(/\/+$/, "");

function parseGroupId(raw: string | undefined): number {
  const trimmed = raw?.trim();
  if (!trimmed) {
    throw new Error("GROUP_ID environment variable is required");
  }
  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error(`GROUP_ID must be an integer, got '${trimmed}'`);
  }
  const value = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(value) || value >= 0) {
    throw new Error(
      `GROUP_ID must be a negative supergroup ID (e.g. -1001234567890), got '${trimmed}'`,
    );
  }

  return value;
}

function parsePublicBaseUrl(raw: string | undefined): string | null {
  const trimmed = stripTrailingSlash(raw ?? "");
  if (!trimmed) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`PUBLIC_BASE_URL must be a valid URL, got '${trimmed}'`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(
      `PUBLIC_BASE_URL must use http or https, got '${parsed.protocol}'`,
    );
  }

  return trimmed;
}

let cachedConfig: { key: string; promise: Promise<LoadedConfig> } | null = null;

const configCacheKey = (env: ServerRuntimeEnv): string =>
  JSON.stringify([
    env.BOT_TOKEN,
    env.GROUP_ID,
    env.PUBLIC_BASE_URL,
    env.WEBHOOK_SECRET,
    env.TURNSTILE_SITE_KEY,
    env.TURNSTILE_SECRET_KEY,
    env.TURNSTILE_HOSTNAMES,
    env.TELEGRAM_API_BASE_URL,
    env.TURNSTILE_SITEVERIFY_URL,
  ]);

async function buildConfig(env: ServerRuntimeEnv): Promise<LoadedConfig> {
  const botToken = env.BOT_TOKEN?.trim();
  if (!botToken) {
    throw new Error("BOT_TOKEN secret is required");
  }

  const groupId = parseGroupId(env.GROUP_ID);
  const publicBaseUrl = parsePublicBaseUrl(env.PUBLIC_BASE_URL);
  const explicitSecret = env.WEBHOOK_SECRET?.trim();
  const webhookSecret = explicitSecret || (await deriveWebhookSecret(botToken));

  const siteKey = env.TURNSTILE_SITE_KEY?.trim() || "";
  const secretKey = env.TURNSTILE_SECRET_KEY?.trim() || "";
  if (Boolean(siteKey) !== Boolean(secretKey)) {
    throw new Error(
      "TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY must either both be set or both be empty",
    );
  }

  let turnstile: TurnstileConfig | null = null;
  if (siteKey && secretKey) {
    const hostnames = new Set<string>();
    const rawHostnames = env.TURNSTILE_HOSTNAMES?.trim();
    if (rawHostnames) {
      for (const item of rawHostnames.split(",")) {
        const host = item.trim().toLowerCase();
        if (host) {
          hostnames.add(host);
        }
      }
    } else if (publicBaseUrl) {
      hostnames.add(new URL(publicBaseUrl).hostname.toLowerCase());
    }
    turnstile = { siteKey, secretKey, hostnames };
  }

  return {
    botToken,
    groupId,
    publicBaseUrl,
    webhookSecret,
    turnstile,
    telegramApiBaseUrl: stripTrailingSlash(
      env.TELEGRAM_API_BASE_URL || "https://api.telegram.org",
    ),
    turnstileSiteverifyUrl:
      env.TURNSTILE_SITEVERIFY_URL?.trim() ||
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
  };
}

export function loadConfig(env: ServerRuntimeEnv): Promise<LoadedConfig> {
  const key = configCacheKey(env);
  if (cachedConfig?.key === key) {
    return cachedConfig.promise;
  }
  const promise = buildConfig(env).catch((error: unknown) => {
    if (cachedConfig?.key === key) {
      cachedConfig = null;
    }

    throw error;
  });
  cachedConfig = { key, promise };

  return promise;
}

export function resolveBaseUrl(
  config: LoadedConfig,
  requestUrl?: string,
): string {
  if (config.publicBaseUrl) {
    return config.publicBaseUrl;
  }
  if (requestUrl) {
    return new URL(requestUrl).origin;
  }

  throw new Error(
    "PUBLIC_BASE_URL is required when no incoming request URL is available",
  );
}
