import type {
  BotCommand,
  BotCommandScope,
  ForumTopic,
  InlineKeyboardMarkup,
  MessageIdResult,
  ReactionTypeEmoji,
  ReplyMarkup,
  ReplyParameters,
  TelegramChat,
  TelegramChatMember,
  TelegramMessage,
  TelegramMessageEntity,
  TelegramUser,
} from "./types.ts";

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RETRY_AFTER_SECONDS = 5;
const MAX_ATTEMPTS = 3;

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: {
    retry_after?: number;
  };
}

export class TelegramApiError extends Error {
  public readonly method: string;
  public readonly errorCode: number;
  public readonly description: string;
  public readonly retryAfter?: number;

  constructor(
    method: string,
    errorCode: number,
    description: string,
    retryAfter?: number,
  ) {
    super(`Telegram API ${method} failed (${errorCode}): ${description}`);
    this.name = "TelegramApiError";
    this.method = method;
    this.errorCode = errorCode;
    this.description = description;
    this.retryAfter = retryAfter;
  }
}

export function isTopicDeletedError(error: unknown): boolean {
  if (!(error instanceof TelegramApiError)) {
    return false;
  }
  const desc = error.description.toLowerCase();

  return (
    desc.includes("message thread not found") ||
    desc.includes("topic_deleted") ||
    desc.includes("topic_id_invalid")
  );
}

export const isTopicClosedError = (error: unknown): boolean =>
  error instanceof TelegramApiError &&
  error.description.toLowerCase().includes("topic_closed");

export const isMessageNotModifiedError = (error: unknown): boolean =>
  error instanceof TelegramApiError &&
  error.description.toLowerCase().includes("message is not modified");

export function isUserUnavailableError(error: unknown): boolean {
  if (!(error instanceof TelegramApiError)) {
    return false;
  }
  const desc = error.description.toLowerCase();

  return (
    error.errorCode === 403 ||
    desc.includes("bot was blocked by the user") ||
    desc.includes("user is deactivated") ||
    desc.includes("chat not found") ||
    desc.includes("bot can't initiate conversation")
  );
}

export const escapeHtml = (input: string): string =>
  input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export function formatUserDisplayName(
  chatId: number,
  info?: { first_name?: string; last_name?: string; username?: string },
): string {
  if (info?.first_name) {
    const full = info.last_name
      ? `${info.first_name} ${info.last_name}`
      : info.first_name;

    return full.trim().slice(0, 128) || `User ${chatId}`;
  }
  if (info?.username) {
    return `@${info.username}`.slice(0, 128);
  }

  return `User ${chatId}`;
}

export function parseCommand(
  text: string | undefined,
): { command: string; args: string } | null {
  if (!text?.startsWith("/")) {
    return null;
  }
  const trimmed = text.trim();
  const spaceIdx = trimmed.search(/\s/);
  const head = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  const args = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();
  const match = /^\/(\w+)(?:@\w+)?$/.exec(head);
  if (!match) {
    return null;
  }

  return {
    command: match[1].toLowerCase(),
    args,
  };
}

export const hasForwardableContent = (message: TelegramMessage): boolean =>
  Boolean(
    message.text !== undefined ||
    message.photo !== undefined ||
    message.video !== undefined ||
    message.audio !== undefined ||
    message.voice !== undefined ||
    message.document !== undefined ||
    message.sticker !== undefined ||
    message.animation !== undefined ||
    message.video_note !== undefined ||
    message.location !== undefined ||
    message.venue !== undefined ||
    message.contact !== undefined ||
    message.poll !== undefined ||
    message.dice !== undefined ||
    message.story !== undefined,
  );

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class TelegramClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(token: string, baseUrl = "https://api.telegram.org") {
    this.token = token;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private async call<T>(
    method: string,
    payload?: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.baseUrl}/bot${this.token}/${method}`;
    const body = payload ? JSON.stringify(payload) : undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        if (attempt < MAX_ATTEMPTS) {
          await delay(250 * attempt);

          continue;
        }

        throw error;
      }

      let parsed: TelegramResponse<T>;
      try {
        parsed = await response.json<TelegramResponse<T>>();
      } catch {
        if (response.status >= 500 && attempt < MAX_ATTEMPTS) {
          await delay(250 * attempt);

          continue;
        }

        throw new TelegramApiError(
          method,
          response.status,
          `invalid JSON response (HTTP ${response.status})`,
        );
      }

      if (parsed.ok) {
        return parsed.result as T;
      }

      const errorCode = parsed.error_code ?? response.status;
      const description = parsed.description ?? `HTTP ${response.status}`;
      const retryAfter = parsed.parameters?.retry_after;

      if (
        errorCode === 429 &&
        retryAfter !== undefined &&
        retryAfter <= MAX_RETRY_AFTER_SECONDS &&
        attempt < MAX_ATTEMPTS
      ) {
        await delay(retryAfter * 1000);

        continue;
      }

      if (errorCode >= 500 && attempt < MAX_ATTEMPTS) {
        await delay(250 * attempt);

        continue;
      }

      throw new TelegramApiError(method, errorCode, description, retryAfter);
    }

    throw new TelegramApiError(method, 500, "exhausted retry attempts");
  }

  public getMe(): Promise<TelegramUser> {
    return this.call<TelegramUser>("getMe");
  }

  public getChat(chatId: number): Promise<TelegramChat> {
    return this.call<TelegramChat>("getChat", { chat_id: chatId });
  }

  public getChatMember(
    chatId: number,
    userId: number,
  ): Promise<TelegramChatMember> {
    return this.call<TelegramChatMember>("getChatMember", {
      chat_id: chatId,
      user_id: userId,
    });
  }

  public setWebhook(params: {
    url: string;
    secret_token: string;
    allowed_updates?: readonly string[];
    drop_pending_updates?: boolean;
  }): Promise<boolean> {
    return this.call<boolean>("setWebhook", params);
  }

  public setMyCommands(
    commands: readonly BotCommand[],
    scope?: BotCommandScope,
  ): Promise<boolean> {
    return this.call<boolean>("setMyCommands", {
      commands,
      ...(scope ? { scope } : {}),
    });
  }

  public sendMessage(
    chatId: number,
    text: string,
    options?: {
      message_thread_id?: number;
      parse_mode?: "HTML";
      disable_notification?: boolean;
      reply_markup?: ReplyMarkup;
      reply_parameters?: ReplyParameters;
    },
  ): Promise<TelegramMessage> {
    return this.call<TelegramMessage>("sendMessage", {
      chat_id: chatId,
      text,
      ...options,
    });
  }

  public copyMessage(
    chatId: number,
    fromChatId: number,
    messageId: number,
    options?: {
      message_thread_id?: number;
      reply_parameters?: ReplyParameters;
      disable_notification?: boolean;
    },
  ): Promise<MessageIdResult> {
    return this.call<MessageIdResult>("copyMessage", {
      chat_id: chatId,
      from_chat_id: fromChatId,
      message_id: messageId,
      ...options,
    });
  }

  public editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    options?: {
      parse_mode?: "HTML";
      entities?: TelegramMessageEntity[];
      reply_markup?: InlineKeyboardMarkup;
    },
  ): Promise<TelegramMessage | boolean> {
    return this.call<TelegramMessage | boolean>("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      ...options,
    });
  }

  public editMessageCaption(
    chatId: number,
    messageId: number,
    caption: string,
    options?: {
      caption_entities?: TelegramMessageEntity[];
    },
  ): Promise<TelegramMessage | boolean> {
    return this.call<TelegramMessage | boolean>("editMessageCaption", {
      chat_id: chatId,
      message_id: messageId,
      caption,
      ...options,
    });
  }

  public deleteMessage(chatId: number, messageId: number): Promise<boolean> {
    return this.call<boolean>("deleteMessage", {
      chat_id: chatId,
      message_id: messageId,
    });
  }

  public setMessageReaction(
    chatId: number,
    messageId: number,
    reaction: readonly ReactionTypeEmoji[],
  ): Promise<boolean> {
    return this.call<boolean>("setMessageReaction", {
      chat_id: chatId,
      message_id: messageId,
      reaction,
    });
  }

  public createForumTopic(chatId: number, name: string): Promise<ForumTopic> {
    return this.call<ForumTopic>("createForumTopic", {
      chat_id: chatId,
      name: name.slice(0, 128),
    });
  }

  public editForumTopic(
    chatId: number,
    messageThreadId: number,
    name: string,
  ): Promise<boolean> {
    return this.call<boolean>("editForumTopic", {
      chat_id: chatId,
      message_thread_id: messageThreadId,
      name: name.slice(0, 128),
    });
  }

  public reopenForumTopic(
    chatId: number,
    messageThreadId: number,
  ): Promise<boolean> {
    return this.call<boolean>("reopenForumTopic", {
      chat_id: chatId,
      message_thread_id: messageThreadId,
    });
  }

  public deleteForumTopic(
    chatId: number,
    messageThreadId: number,
  ): Promise<boolean> {
    return this.call<boolean>("deleteForumTopic", {
      chat_id: chatId,
      message_thread_id: messageThreadId,
    });
  }

  public answerCallbackQuery(
    callbackQueryId: string,
    options?: { text?: string; show_alert?: boolean },
  ): Promise<boolean> {
    return this.call<boolean>("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      ...options,
    });
  }
}
