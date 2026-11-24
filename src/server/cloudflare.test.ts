import {
  applyD1Migrations,
  createExecutionContext,
  reset,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  d1Adapter,
  getText,
  getUserByChatId,
  setFeature,
} from "../db/index.ts";
import type { CloudflareWorkerEnv } from "../entry/cloudflare.ts";
import worker from "../entry/cloudflare.ts";
import { deriveWebhookSecret, unixNow } from "./crypto.ts";

interface RecordedCall {
  method: string;
  body: Record<string, unknown>;
}

interface MockTelegramState {
  calls: RecordedCall[];
  nextMessageId: number;
  nextTopicId: number;
  copyErrors: Map<string, { error_code: number; description: string }>;
  turnstileResponse: {
    success: boolean;
    action?: string;
    hostname?: string;
  };
}

const BOT_TOKEN = "123456:TEST-BOT-TOKEN";
const GROUP_ID = -1_001_234_567_890;
const BASE_URL = "https://hashi.example.com";

async function signInitData(
  botToken: string,
  userId: number,
  authDate: number = unixNow(),
): Promise<string> {
  const encoder = new TextEncoder();
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: "AAEAAAE",
    user: JSON.stringify({ id: userId, first_name: "Alice" }),
  });
  const pairs: string[] = [];
  for (const [key, value] of params.entries()) {
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const key1 = await crypto.subtle.importKey(
    "raw",
    encoder.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const secretBytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key1, encoder.encode(botToken)),
  );
  const key2 = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key2, encoder.encode(dataCheckString)),
  );
  const hash = [...sigBytes]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  params.set("hash", hash);

  return params.toString();
}

const createMockFetch =
  (state: MockTelegramState): typeof globalThis.fetch =>
  async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const url = new URL(req.url);

    if (url.href === "https://turnstile.mock/siteverify") {
      return Response.json(state.turnstileResponse);
    }

    const match = /^\/bot([^/]+)\/([a-zA-Z]+)$/.exec(url.pathname);
    if (match) {
      const method = match[2];
      const rawBody = await req.text();
      const body = rawBody
        ? (JSON.parse(rawBody) as Record<string, unknown>)
        : {};
      state.calls.push({ method, body });

      if (method === "getMe") {
        return Response.json({
          ok: true,
          result: {
            id: 999,
            is_bot: true,
            first_name: "Hashi",
            username: "hashi_bot",
          },
        });
      }
      if (method === "getChat") {
        return Response.json({
          ok: true,
          result: {
            id: GROUP_ID,
            type: "supergroup",
            title: "Hashi Admin",
            is_forum: true,
          },
        });
      }
      if (method === "getChatMember") {
        return Response.json({
          ok: true,
          result: {
            status: "administrator",
            can_manage_topics: true,
            user: { id: 999, is_bot: true, first_name: "Hashi" },
          },
        });
      }
      if (method === "createForumTopic") {
        state.nextTopicId += 1;

        return Response.json({
          ok: true,
          result: {
            message_thread_id: state.nextTopicId,
            name: body.name,
          },
        });
      }
      if (method === "copyMessage") {
        const key = `${String(body.chat_id)}:${String(body.message_thread_id ?? "")}`;
        const injectedError = state.copyErrors.get(key);
        if (injectedError) {
          state.copyErrors.delete(key);

          return Response.json({ ok: false, ...injectedError });
        }
        state.nextMessageId += 1;

        return Response.json({
          ok: true,
          result: { message_id: state.nextMessageId },
        });
      }
      if (method === "sendMessage") {
        state.nextMessageId += 1;

        return Response.json({
          ok: true,
          result: {
            message_id: state.nextMessageId,
            chat: { id: body.chat_id, type: "private" },
            date: unixNow(),
            text: body.text,
          },
        });
      }

      return Response.json({ ok: true, result: true });
    }

    throw new Error(`unhandled fetch ${req.method} ${req.url}`);
  };

describe("hashi worker", () => {
  let state: MockTelegramState;
  let testEnv: CloudflareWorkerEnv;
  let webhookSecret: string;

  async function callWorker(
    path: string,
    init?: RequestInit,
  ): Promise<Response> {
    const ctx = createExecutionContext();
    const req = new Request(`${BASE_URL}${path}`, init);
    const res = await worker.fetch(req, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    return res;
  }

  const postWebhook = (
    update: Record<string, unknown>,
    secret = webhookSecret,
  ) =>
    callWorker("/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { "X-Telegram-Bot-Api-Secret-Token": secret } : {}),
      },
      body: JSON.stringify(update),
    });

  beforeEach(async () => {
    await applyD1Migrations(
      env.DB,
      (
        env as unknown as {
          TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
        }
      ).TEST_MIGRATIONS,
    );

    state = {
      calls: [],
      nextMessageId: 1000,
      nextTopicId: 100,
      copyErrors: new Map(),
      turnstileResponse: {
        success: true,
        action: "hashi_verify",
        hostname: "hashi.example.com",
      },
    };
    vi.stubGlobal("fetch", createMockFetch(state));

    webhookSecret = await deriveWebhookSecret(BOT_TOKEN);
    testEnv = Object.assign({}, env, {
      BOT_TOKEN,
      GROUP_ID: String(GROUP_ID),
      PUBLIC_BASE_URL: BASE_URL,
      TURNSTILE_SITE_KEY: "0x4AAAAAAA_test_sitekey",
      TURNSTILE_SECRET_KEY: "0x4AAAAAAA_test_secret",
      TELEGRAM_API_BASE_URL: "https://telegram.mock",
      TURNSTILE_SITEVERIFY_URL: "https://turnstile.mock/siteverify",
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await reset();
  });

  it("serves healthz, status page, authenticated setup, and rejects forged webhooks", async () => {
    const health = await callWorker("/healthz");

    expect(health.status).toBe(200);
    await expect(health.text()).resolves.toBe("ok\n");

    const status = await callWorker("/");

    expect(status.status).toBe(200);
    await expect(status.text()).resolves.toContain("橋 Hashi");

    const unauthWebhook = await postWebhook({ update_id: 1 }, "wrong-secret");

    expect(unauthWebhook.status).toBe(401);

    const unauthSetup = await callWorker("/api/setup", { method: "POST" });

    expect(unauthSetup.status).toBe(401);

    const setupRes = await callWorker("/api/setup", {
      method: "POST",
      headers: { Authorization: `Bearer ${webhookSecret}` },
    });

    expect(setupRes.status).toBe(200);

    const report = await setupRes.json<{
      ok: boolean;
      botUsername: string;
      webhookUrl: string;
    }>();

    expect(report.ok).toBeTruthy();
    expect(report.botUsername).toBe("hashi_bot");
    expect(report.webhookUrl).toBe(`${BASE_URL}/webhook`);

    const setCommandsCalls = state.calls.filter(
      (c) => c.method === "setMyCommands",
    );

    expect(setCommandsCalls).toHaveLength(2);
    expect(
      state.calls.find((c) => c.method === "setWebhook")?.body.secret_token,
    ).toBe(webhookSecret);

    // Also accepts BOT_TOKEN directly for one-click deploy setup
    const botTokenSetupRes = await callWorker("/api/setup", {
      method: "POST",
      headers: { Authorization: `Bearer ${BOT_TOKEN}` },
    });

    expect(botTokenSetupRes.status).toBe(200);

    // Renders friendly setup-required page when BOT_TOKEN/GROUP_ID are not set yet
    const ctx = createExecutionContext();
    const unconfiguredRes = await worker.fetch(
      new Request(`${BASE_URL}/`),
      Object.assign({}, env),
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(unconfiguredRes.status).toBe(503);
    await expect(unconfiguredRes.text()).resolves.toContain("Setup required");
  });

  it("forwards bidirectionally with HTML escaping, reply links, edits, reactions, and topic recovery", async () => {
    const userChatId = 42_001;

    // /start sends welcome without creating a topic
    const startRes = await postWebhook({
      update_id: 1,
      message: {
        message_id: 10,
        chat: {
          id: userChatId,
          type: "private",
          first_name: "Alice <Dev>",
          username: "alice_dev",
        },
        from: {
          id: userChatId,
          is_bot: false,
          first_name: "Alice <Dev>",
          username: "alice_dev",
        },
        date: unixNow(),
        text: "/start",
      },
    });

    expect(startRes.status).toBe(200);
    expect(
      state.calls.some((c) => c.method === "createForumTopic"),
    ).toBeFalsy();

    // First real message creates topic, sends HTML-escaped info card, copies message, reacts with thumbs up
    const msg1Res = await postWebhook({
      update_id: 2,
      message: {
        message_id: 11,
        chat: {
          id: userChatId,
          type: "private",
          first_name: "Alice <Dev>",
          username: "alice_dev",
        },
        from: {
          id: userChatId,
          is_bot: false,
          first_name: "Alice <Dev>",
          username: "alice_dev",
        },
        date: unixNow(),
        text: "Hello from Alice!",
      },
    });

    expect(msg1Res.status).toBe(200);

    const user = await getUserByChatId(d1Adapter(env.DB), userChatId);

    expect(user?.topicId).toBe(101);

    const infoMsg = state.calls.find(
      (c) =>
        c.method === "sendMessage" &&
        c.body.chat_id === GROUP_ID &&
        c.body.message_thread_id === 101,
    );

    expect(infoMsg?.body.parse_mode).toBe("HTML");
    expect(String(infoMsg?.body.text)).toContain("Alice &lt;Dev&gt;");
    expect(String(infoMsg?.body.text)).toContain("@alice_dev");

    const reactionCall = state.calls.find(
      (c) => c.method === "setMessageReaction",
    );

    expect(reactionCall?.body.chat_id).toBe(userChatId);
    expect(reactionCall?.body.message_id).toBe(11);

    const copiedToGroup = state.calls.find(
      (c) => c.method === "copyMessage" && c.body.chat_id === GROUP_ID,
    );

    expect(copiedToGroup?.body.message_thread_id).toBe(101);

    // Second message uses cached topicId with ZERO reopenForumTopic / createForumTopic calls
    const beforeCalls = state.calls.length;
    await postWebhook({
      update_id: 3,
      message: {
        message_id: 12,
        chat: {
          id: userChatId,
          type: "private",
          first_name: "Alice <Dev>",
          username: "alice_dev",
        },
        from: {
          id: userChatId,
          is_bot: false,
          first_name: "Alice <Dev>",
          username: "alice_dev",
        },
        date: unixNow(),
        text: "Second message",
      },
    });
    const newCalls = state.calls.slice(beforeCalls);

    expect(newCalls.some((c) => c.method === "reopenForumTopic")).toBeFalsy();
    expect(newCalls.some((c) => c.method === "createForumTopic")).toBeFalsy();

    // Admin replies to user's first forwarded message in topic
    const firstGroupMsgId = 1003; // sendMessage(welcome=1001), sendMessage(info=1002), copyMessage(11->1003)
    const adminReplyRes = await postWebhook({
      update_id: 4,
      message: {
        message_id: 500,
        message_thread_id: 101,
        is_topic_message: true,
        chat: { id: GROUP_ID, type: "supergroup", is_forum: true },
        from: { id: 777, is_bot: false, first_name: "Admin" },
        date: unixNow(),
        text: "Hi Alice!",
        reply_to_message: {
          message_id: firstGroupMsgId,
          chat: { id: GROUP_ID, type: "supergroup" },
          date: unixNow(),
        },
      },
    });

    expect(adminReplyRes.status).toBe(200);

    const copiedToUser = state.calls.find(
      (c) => c.method === "copyMessage" && c.body.chat_id === userChatId,
    );

    expect(copiedToUser?.body.reply_parameters).toEqual({
      message_id: 11,
      allow_sending_without_reply: true,
    });

    // User edits message 11 -> syncs edit to group message
    await postWebhook({
      update_id: 5,
      edited_message: {
        message_id: 11,
        chat: { id: userChatId, type: "private" },
        from: { id: userChatId, is_bot: false, first_name: "Alice <Dev>" },
        date: unixNow(),
        text: "Hello from Alice (edited)!",
      },
    });
    const editCall = state.calls.find((c) => c.method === "editMessageText");

    expect(editCall?.body.chat_id).toBe(GROUP_ID);
    expect(editCall?.body.message_id).toBe(firstGroupMsgId);
    expect(editCall?.body.text).toBe("Hello from Alice (edited)!");

    // Deleted topic recovery: simulate Telegram returning message thread not found
    state.copyErrors.set(`${GROUP_ID}:101`, {
      error_code: 400,
      description: "Bad Request: message thread not found",
    });
    const recoverRes = await postWebhook({
      update_id: 6,
      message: {
        message_id: 13,
        chat: {
          id: userChatId,
          type: "private",
          first_name: "Alice <Dev>",
          username: "alice_dev",
        },
        from: {
          id: userChatId,
          is_bot: false,
          first_name: "Alice <Dev>",
          username: "alice_dev",
        },
        date: unixNow(),
        text: "After topic deleted",
      },
    });

    expect(recoverRes.status).toBe(200);

    const updatedUser = await getUserByChatId(d1Adapter(env.DB), userChatId);

    expect(updatedUser?.topicId).toBeGreaterThan(101);
  });

  it("handles blocking, delivery errors, and DB-persisted settings edits across requests", async () => {
    const userChatId = 42_002;
    await postWebhook({
      update_id: 10,
      message: {
        message_id: 20,
        chat: { id: userChatId, type: "private", first_name: "Bob" },
        from: { id: userChatId, is_bot: false, first_name: "Bob" },
        date: unixNow(),
        text: "Hi",
      },
    });
    const user = await getUserByChatId(d1Adapter(env.DB), userChatId);
    const topicId = user!.topicId!;

    // Simulate user blocked bot when admin sends a message
    state.copyErrors.set(`${userChatId}:`, {
      error_code: 403,
      description: "Forbidden: bot was blocked by the user",
    });
    const blockedDelivery = await postWebhook({
      update_id: 11,
      message: {
        message_id: 600,
        message_thread_id: topicId,
        is_topic_message: true,
        chat: { id: GROUP_ID, type: "supergroup", is_forum: true },
        from: { id: 777, is_bot: false, first_name: "Admin" },
        date: unixNow(),
        text: "Ping",
      },
    });

    expect(blockedDelivery.status).toBe(200);
    expect(
      state.calls.some(
        (c) =>
          c.method === "sendMessage" &&
          c.body.message_thread_id === topicId &&
          String(c.body.text).includes("blocked the bot"),
      ),
    ).toBeTruthy();

    // Admin blocks user via /block
    await postWebhook({
      update_id: 12,
      message: {
        message_id: 601,
        message_thread_id: topicId,
        is_topic_message: true,
        chat: { id: GROUP_ID, type: "supergroup", is_forum: true },
        from: { id: 777, is_bot: false, first_name: "Admin" },
        date: unixNow(),
        text: "/block",
      },
    });

    expect(
      (await getUserByChatId(d1Adapter(env.DB), userChatId))?.blocked,
    ).toBeTruthy();

    // Admin opens /settings in General, triggers text edit, sends new welcome text in next request
    await postWebhook({
      update_id: 13,
      callback_query: {
        id: "cb-edit-welcome",
        from: { id: 777, is_bot: false, first_name: "Admin" },
        data: "s:edit:welcome",
        message: {
          message_id: 700,
          chat: { id: GROUP_ID, type: "supergroup", is_forum: true },
          date: unixNow(),
        },
      },
    });

    await postWebhook({
      update_id: 14,
      message: {
        message_id: 701,
        chat: { id: GROUP_ID, type: "supergroup", is_forum: true },
        from: { id: 777, is_bot: false, first_name: "Admin" },
        date: unixNow(),
        text: "Welcome to Hashi v2!",
      },
    });

    await expect(getText(d1Adapter(env.DB), "welcome")).resolves.toBe(
      "Welcome to Hashi v2!",
    );
  });

  it("enforces Turnstile verification before creating topics and validates signed state + initData", async () => {
    await setFeature(d1Adapter(env.DB), "verification", true);
    const userChatId = 42_003;

    // Unverified user messages -> gets verify prompt, NO topic created
    await postWebhook({
      update_id: 20,
      message: {
        message_id: 30,
        chat: { id: userChatId, type: "private", first_name: "Charlie" },
        from: { id: userChatId, is_bot: false, first_name: "Charlie" },
        date: unixNow(),
        text: "Hey there",
      },
    });

    const userBefore = await getUserByChatId(d1Adapter(env.DB), userChatId);

    expect(userBefore?.topicId).toBeNull();
    expect(userBefore?.verified).toBeFalsy();

    const promptCall = state.calls.find(
      (c) => c.method === "sendMessage" && c.body.chat_id === userChatId,
    );
    const markup = promptCall?.body.reply_markup as {
      inline_keyboard: { web_app?: { url: string } }[][];
    };
    const verifyUrl = markup.inline_keyboard[0][0].web_app!.url;
    const stateToken = new URL(verifyUrl).searchParams.get("token")!;

    // Tampered token rejected on GET /verify
    expect((await callWorker("/verify?token=tampered.token")).status).toBe(400);

    // Valid token serves Mini App page
    const verifyPage = await callWorker(
      `/verify?token=${encodeURIComponent(stateToken)}`,
    );

    expect(verifyPage.status).toBe(200);
    await expect(verifyPage.text()).resolves.toContain("Human verification");

    // Forged initData for another user is rejected
    const wrongInitData = await signInitData(BOT_TOKEN, 99_999);
    const forgedRes = await callWorker("/verify/callback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: "cf-token-ok",
        state: stateToken,
        initData: wrongInitData,
      }),
    });

    expect(forgedRes.status).toBe(403);

    // Mismatched hostname from siteverify is rejected
    state.turnstileResponse = {
      success: true,
      action: "hashi_verify",
      hostname: "evil.example.com",
    };
    const validInitData = await signInitData(BOT_TOKEN, userChatId);
    const wrongHostRes = await callWorker("/verify/callback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: "cf-token-ok",
        state: stateToken,
        initData: validInitData,
      }),
    });

    expect(wrongHostRes.status).toBe(403);

    // Valid verification completes and unlocks forwarding
    state.turnstileResponse = {
      success: true,
      action: "hashi_verify",
      hostname: "hashi.example.com",
    };
    const okRes = await callWorker("/verify/callback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: "cf-token-ok",
        state: stateToken,
        initData: validInitData,
      }),
    });

    expect(okRes.status).toBe(200);

    const userAfter = await getUserByChatId(d1Adapter(env.DB), userChatId);

    expect(userAfter?.verified).toBeTruthy();

    // Now user's message creates a topic and forwards normally
    await postWebhook({
      update_id: 21,
      message: {
        message_id: 31,
        chat: { id: userChatId, type: "private", first_name: "Charlie" },
        from: { id: userChatId, is_bot: false, first_name: "Charlie" },
        date: unixNow(),
        text: "Now I am verified!",
      },
    });

    const userWithTopic = await getUserByChatId(d1Adapter(env.DB), userChatId);

    expect(userWithTopic?.topicId).not.toBeNull();
  });
});
