import { afterEach, describe, expect, it, vi } from "vitest";

import { applyMigrations, openNodeSqlite } from "../db/node.ts";
import { startNodeServer } from "../entry/node.ts";
import {
  deriveWebhookSecret,
  signVerifyState,
  unixNow,
  verifyStateToken,
} from "./crypto.ts";

describe("hashi portable node runtime", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("applies migrations idempotently on node:sqlite", async () => {
    const db = openNodeSqlite(":memory:");
    try {
      const first = await applyMigrations(db);
      const second = await applyMigrations(db);

      expect(first).toEqual(["0001_init.sql"]);
      expect(second).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("signs and verifies state tokens with expiration checks", async () => {
    const token = await signVerifyState("bot:secret", 12_345, 60, 1000);

    await expect(verifyStateToken("bot:secret", token, 1030)).resolves.toBe(
      12_345,
    );
    await expect(
      verifyStateToken("bot:secret", token, 1061),
    ).resolves.toBeNull();
    await expect(
      verifyStateToken("wrong:secret", token, 1030),
    ).resolves.toBeNull();
  });

  it("serves static assets, status page, and authenticated webhooks over HTTP", async () => {
    const realFetch = globalThis.fetch;
    const telegramCalls: string[] = [];
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (url.startsWith("https://telegram.mock/")) {
          telegramCalls.push(url);
          if (url.endsWith("/createForumTopic")) {
            return Response.json({
              ok: true,
              result: { message_thread_id: 55, name: "Node User" },
            });
          }
          if (url.endsWith("/copyMessage")) {
            return Response.json({ ok: true, result: { message_id: 888 } });
          }

          return Response.json({
            ok: true,
            result: {
              message_id: 889,
              chat: { id: 1, type: "private" },
              date: unixNow(),
            },
          });
        }

        return realFetch(input, init);
      },
    );

    const botToken = "987654:NODE-TEST";
    const secret = await deriveWebhookSecret(botToken);
    const server = await startNodeServer({
      host: "127.0.0.1",
      port: 0,
      dbPath: ":memory:",
      env: {
        BOT_TOKEN: botToken,
        GROUP_ID: "-100999888777",
        PUBLIC_BASE_URL: "https://node-hashi.example.com",
        TELEGRAM_API_BASE_URL: "https://telegram.mock",
      },
    });

    try {
      const origin = `http://127.0.0.1:${server.port}`;

      const health = await realFetch(`${origin}/healthz`);

      expect(health.status).toBe(200);

      const css = await realFetch(`${origin}/styles.css`);

      expect(css.status).toBe(200);
      await expect(css.text()).resolves.toContain("--tg-theme-bg-color");

      const setupJs = await realFetch(`${origin}/setup.js`);

      expect(setupJs.status).toBe(200);

      const webhookRes = await realFetch(`${origin}/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": secret,
        },
        body: JSON.stringify({
          update_id: 1,
          message: {
            message_id: 7,
            chat: { id: 5001, type: "private", first_name: "Node User" },
            from: { id: 5001, is_bot: false, first_name: "Node User" },
            date: unixNow(),
            text: "Hello from Node runtime!",
          },
        }),
      });

      expect(webhookRes.status).toBe(200);
      expect(
        telegramCalls.some((u) => u.endsWith("/createForumTopic")),
      ).toBeTruthy();
      expect(
        telegramCalls.some((u) => u.endsWith("/copyMessage")),
      ).toBeTruthy();
    } finally {
      await server.close();
    }
  });
});
