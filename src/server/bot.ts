import type {
  FeatureKey,
  SqlDatabase,
  TextKey,
  UserRecord,
} from "../db/index.ts";
import {
  FEATURE_KEYS,
  FEATURE_LABELS,
  TEXT_KEYS,
  TEXT_LABELS,
  claimSystemValue,
  claimUserTopic,
  clearPendingEdit,
  findGroupMessageByPrivate,
  findPrivateMessageByGroup,
  getFeature,
  getFeatures,
  getPendingEdit,
  getSystemValue,
  getText,
  getTexts,
  getUserByChatId,
  getUserByTopicId,
  isFeatureKey,
  isTextKey,
  replaceUserTopic,
  saveMessageLink,
  setFeature,
  setPendingEdit,
  setSystemValue,
  setText,
  setUserBlocked,
  setUserVerificationMessageId,
  setUserVerified,
  upsertUser,
} from "../db/index.ts";
import type { TelegramClient } from "../telegram/client.ts";
import {
  TelegramApiError,
  escapeHtml,
  formatUserDisplayName,
  hasForwardableContent,
  isMessageNotModifiedError,
  isTopicClosedError,
  isTopicDeletedError,
  isUserUnavailableError,
  parseCommand,
} from "../telegram/client.ts";
import type {
  InlineKeyboardMarkup,
  TelegramCallbackQuery,
  TelegramChatMemberUpdated,
  TelegramMessage,
  TelegramUpdate,
} from "../telegram/types.ts";
import type { LoadedConfig } from "./config.ts";
import { errorMessage, signVerifyState } from "./crypto.ts";

export interface BotDeps {
  db: SqlDatabase;
  config: LoadedConfig;
  telegram: TelegramClient;
  baseUrl: string;
  waitUntil: (promise: Promise<unknown>) => void;
}

export interface SetupReport {
  botUsername: string;
  botId: number;
  groupTitle: string;
  groupId: number;
  webhookUrl: string;
  turnstileConfigured: boolean;
}

const ALLOWED_UPDATES = [
  "message",
  "edited_message",
  "callback_query",
  "my_chat_member",
] as const;

const GENERAL_TOPIC_ID = 0;

const isGeneralTopicMessage = (message: TelegramMessage): boolean =>
  !message.is_topic_message ||
  message.message_thread_id === undefined ||
  message.message_thread_id === 1;

function topicDeepLink(groupId: number, topicId: number): string {
  const numericId = String(groupId).replace(/^-100/, "");

  return `https://t.me/c/${numericId}/${topicId}`;
}

function formatUserInfoHtml(user: UserRecord): string {
  const name = escapeHtml(user.displayName || `User ${user.chatId}`);
  const username = user.username ? `@${escapeHtml(user.username)}` : "—";
  const status = user.blocked ? "Blocked" : "Active";
  const verification = user.verified ? "Verified" : "Unverified";

  return [
    "<b>User Info</b>",
    `Name: ${name}`,
    `Username: ${username}`,
    `ID: <a href="tg://user?id=${user.chatId}"><code>${user.chatId}</code></a>`,
    `Status: <b>${status}</b> · ${verification}`,
  ].join("\n");
}

const userActionsKeyboard = (user: UserRecord): InlineKeyboardMarkup => ({
  inline_keyboard: [
    [
      user.blocked
        ? { text: "Unblock", callback_data: `u:unblock:${user.chatId}` }
        : { text: "Block", callback_data: `u:block:${user.chatId}` },
      user.verified
        ? {
            text: "Revoke Verification",
            callback_data: `u:unverify:${user.chatId}`,
          }
        : { text: "Mark Verified", callback_data: `u:verify:${user.chatId}` },
    ],
  ],
});

const settingsMainMarkup = (): InlineKeyboardMarkup => ({
  inline_keyboard: [
    [
      { text: "Features", callback_data: "s:features" },
      { text: "Messages", callback_data: "s:texts" },
    ],
  ],
});

async function settingsFeaturesMarkup(
  db: SqlDatabase,
): Promise<InlineKeyboardMarkup> {
  const features = await getFeatures(db);

  return {
    inline_keyboard: [
      ...FEATURE_KEYS.map((key) => [
        {
          text: `${features[key] ? "✓" : "✗"} ${FEATURE_LABELS[key]}`,
          callback_data: `s:toggle:${key}`,
        },
      ]),
      [{ text: "← Back", callback_data: "s:main" }],
    ],
  };
}

async function settingsTextsMarkup(
  db: SqlDatabase,
): Promise<InlineKeyboardMarkup> {
  const texts = await getTexts(db);

  return {
    inline_keyboard: [
      ...TEXT_KEYS.map((key) => [
        {
          text: `${texts[key] ? "Edit" : "Set"}: ${TEXT_LABELS[key]}`,
          callback_data: `s:edit:${key}`,
        },
      ]),
      [{ text: "← Back", callback_data: "s:main" }],
    ],
  };
}

export async function setupBot(
  deps: Pick<BotDeps, "config" | "telegram" | "baseUrl">,
): Promise<SetupReport> {
  const { config, telegram, baseUrl } = deps;
  const me = await telegram.getMe();

  const chat = await telegram.getChat(config.groupId);
  if (chat.type !== "supergroup") {
    throw new Error(
      `GROUP_ID ${config.groupId} must be a supergroup, got '${chat.type}'`,
    );
  }
  if (!chat.is_forum) {
    throw new Error(
      `GROUP_ID ${config.groupId} does not have Topics enabled. Enable Topics in the group settings first.`,
    );
  }

  const membership = await telegram.getChatMember(config.groupId, me.id);
  if (
    membership.status !== "administrator" &&
    membership.status !== "creator"
  ) {
    throw new Error(
      `Bot @${me.username ?? me.id} must be an administrator in group ${config.groupId}`,
    );
  }
  if (
    membership.status === "administrator" &&
    membership.can_manage_topics === false
  ) {
    throw new Error(
      `Bot @${me.username ?? me.id} needs the "Manage Topics" permission in group ${config.groupId}`,
    );
  }

  await Promise.all([
    telegram.setMyCommands(
      [{ command: "start", description: "Start chatting" }],
      { type: "all_private_chats" },
    ),
    telegram.setMyCommands(
      [
        { command: "settings", description: "Configure bot (in General)" },
        { command: "info", description: "Show user info for this topic" },
        { command: "block", description: "Block this topic's user" },
        { command: "unblock", description: "Unblock this topic's user" },
        { command: "cancel", description: "Cancel editing a setting" },
      ],
      { type: "chat", chat_id: config.groupId },
    ),
  ]);

  const webhookUrl = `${baseUrl}/webhook`;
  await telegram.setWebhook({
    url: webhookUrl,
    secret_token: config.webhookSecret,
    allowed_updates: ALLOWED_UPDATES,
  });

  return {
    botUsername: me.username ?? String(me.id),
    botId: me.id,
    groupTitle: chat.title ?? String(config.groupId),
    groupId: config.groupId,
    webhookUrl,
    turnstileConfigured: config.turnstile !== null,
  };
}

async function ensureNotificationsTopic(deps: BotDeps): Promise<number> {
  const { db, config, telegram } = deps;
  const stored = await getSystemValue(db, "notifications_topic_id");
  if (stored) {
    const parsed = Number.parseInt(stored, 10);
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  const topic = await telegram.createForumTopic(
    config.groupId,
    "Notifications",
  );
  const won = await claimSystemValue(
    db,
    "notifications_topic_id",
    String(topic.message_thread_id),
  );
  if (!won) {
    await telegram
      .deleteForumTopic(config.groupId, topic.message_thread_id)
      .catch(() => {});
    const winner = await getSystemValue(db, "notifications_topic_id");
    if (winner) {
      return Number.parseInt(winner, 10);
    }
    await setSystemValue(
      db,
      "notifications_topic_id",
      String(topic.message_thread_id),
    );
  }

  await telegram
    .sendMessage(
      config.groupId,
      "New user chats will be announced in this topic.",
      {
        message_thread_id: topic.message_thread_id,
        disable_notification: true,
      },
    )
    .catch(() => {});

  return topic.message_thread_id;
}

async function notifyNewChat(
  deps: BotDeps,
  user: UserRecord,
  topicId: number,
): Promise<void> {
  if (!(await getFeature(deps.db, "new_chat_notification"))) {
    return;
  }

  async function sendNotice(notificationsTopicId: number) {
    await deps.telegram.sendMessage(
      deps.config.groupId,
      `<b>New chat started</b>\n\n${formatUserInfoHtml(user)}`,
      {
        message_thread_id: notificationsTopicId,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "Open Topic",
                url: topicDeepLink(deps.config.groupId, topicId),
              },
            ],
          ],
        },
      },
    );
  }

  let notificationsTopicId = await ensureNotificationsTopic(deps);
  try {
    await sendNotice(notificationsTopicId);
  } catch (error) {
    if (isTopicClosedError(error)) {
      await deps.telegram.reopenForumTopic(
        deps.config.groupId,
        notificationsTopicId,
      );
      await sendNotice(notificationsTopicId);

      return;
    }
    if (isTopicDeletedError(error)) {
      const recreated = await deps.telegram.createForumTopic(
        deps.config.groupId,
        "Notifications",
      );
      notificationsTopicId = recreated.message_thread_id;
      await setSystemValue(
        deps.db,
        "notifications_topic_id",
        String(notificationsTopicId),
      );
      await sendNotice(notificationsTopicId);

      return;
    }

    throw error;
  }
}

async function createAndInitializeUserTopic(
  deps: BotDeps,
  user: UserRecord,
  mode: "claim" | "replace",
): Promise<number> {
  const { db, config, telegram } = deps;
  const topicName = user.displayName || `User ${user.chatId}`;
  const created = await telegram.createForumTopic(config.groupId, topicName);
  const newTopicId = created.message_thread_id;

  if (mode === "claim") {
    const won = await claimUserTopic(db, user.chatId, newTopicId);
    if (!won) {
      await telegram
        .deleteForumTopic(config.groupId, newTopicId)
        .catch(() => {});
      const latest = await getUserByChatId(db, user.chatId);
      if (latest?.topicId !== null && latest?.topicId !== undefined) {
        return latest.topicId;
      }
      await replaceUserTopic(db, user.chatId, newTopicId);
    }
  } else {
    await replaceUserTopic(db, user.chatId, newTopicId);
  }

  const updatedUser: UserRecord = { ...user, topicId: newTopicId };
  await telegram.sendMessage(config.groupId, formatUserInfoHtml(updatedUser), {
    message_thread_id: newTopicId,
    parse_mode: "HTML",
    disable_notification: true,
    reply_markup: userActionsKeyboard(updatedUser),
  });

  if (mode === "claim") {
    deps.waitUntil(
      notifyNewChat(deps, updatedUser, newTopicId).catch((error: unknown) => {
        console.error(
          JSON.stringify({
            message: "failed to post new chat notification",
            chatId: user.chatId,
            error: errorMessage(error),
          }),
        );
      }),
    );
  }

  return newTopicId;
}

async function ensureUserTopic(
  deps: BotDeps,
  user: UserRecord,
): Promise<number> {
  if (user.topicId !== null) {
    return user.topicId;
  }

  return createAndInitializeUserTopic(deps, user, "claim");
}

async function sendVerificationPrompt(
  deps: BotDeps,
  user: UserRecord,
): Promise<void> {
  const { db, config, telegram, baseUrl } = deps;
  if (!config.turnstile) {
    await telegram.sendMessage(
      user.chatId,
      "Verification is enabled, but Turnstile is not configured. Please contact the administrator.",
    );

    return;
  }

  if (user.verificationMessageId !== null) {
    await telegram
      .deleteMessage(user.chatId, user.verificationMessageId)
      .catch(() => {});
  }

  const stateToken = await signVerifyState(config.botToken, user.chatId);
  const verifyUrl = `${baseUrl}/verify?token=${encodeURIComponent(stateToken)}`;
  const promptText = await getText(db, "verify_prompt");

  const sent = await telegram.sendMessage(user.chatId, promptText, {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Verify", web_app: { url: verifyUrl } }],
        [{ text: "Cancel", callback_data: "v:cancel" }],
      ],
    },
  });

  await setUserVerificationMessageId(db, user.chatId, sent.message_id);
}

export async function completeUserVerification(
  deps: BotDeps,
  chatId: number,
): Promise<{ alreadyVerified: boolean }> {
  const { db, config, telegram } = deps;
  const user = await getUserByChatId(db, chatId);
  if (!user) {
    throw new Error(`Unknown user ${chatId}`);
  }
  if (user.verified) {
    return { alreadyVerified: true };
  }

  if (user.verificationMessageId !== null) {
    await telegram
      .deleteMessage(chatId, user.verificationMessageId)
      .catch(() => {});
  }

  await setUserVerified(db, chatId, true);

  const successText = await getText(db, "verify_success");
  await telegram.sendMessage(chatId, successText).catch(() => {});

  if (user.topicId !== null) {
    await telegram
      .sendMessage(config.groupId, "User passed human verification.", {
        message_thread_id: user.topicId,
        disable_notification: true,
      })
      .catch(() => {});
  }

  return { alreadyVerified: false };
}

async function handlePrivateMessage(
  deps: BotDeps,
  message: TelegramMessage,
): Promise<void> {
  const { db, config, telegram } = deps;
  const chatId = message.chat.id;
  const profileSource = message.from ?? message.chat;
  const displayName = formatUserDisplayName(chatId, profileSource);
  const username = profileSource.username ?? null;

  const { user, nameChanged } = await upsertUser(db, {
    chatId,
    displayName,
    username,
  });

  if (user.blocked) {
    const blockedText = await getText(db, "blocked");
    await telegram.sendMessage(chatId, blockedText);

    return;
  }

  const verificationEnabled = await getFeature(db, "verification");
  if (verificationEnabled && !user.verified) {
    await sendVerificationPrompt(deps, user);

    return;
  }

  const cmd = parseCommand(message.text);
  if (cmd?.command === "start") {
    const welcomeText = await getText(db, "welcome");
    await telegram.sendMessage(chatId, welcomeText);

    return;
  }

  if (!hasForwardableContent(message)) {
    return;
  }

  let topicId = await ensureUserTopic(deps, user);

  if (nameChanged && user.topicId !== null) {
    deps.waitUntil(
      telegram
        .editForumTopic(config.groupId, topicId, displayName)
        .catch(() => {}),
    );
  }

  let replyToGroupMessageId: number | undefined;
  if (message.reply_to_message) {
    const linked = await findGroupMessageByPrivate(
      db,
      chatId,
      message.reply_to_message.message_id,
    );
    if (linked?.topicId === topicId) {
      replyToGroupMessageId = linked.groupMessageId;
    }
  }

  const copyToTopic = (targetTopicId: number, replyId?: number) =>
    telegram.copyMessage(config.groupId, chatId, message.message_id, {
      message_thread_id: targetTopicId,
      ...(replyId === undefined
        ? {}
        : {
            reply_parameters: {
              message_id: replyId,
              allow_sending_without_reply: true,
            },
          }),
    });

  let copiedId: number;
  try {
    const copied = await copyToTopic(topicId, replyToGroupMessageId);
    copiedId = copied.message_id;
  } catch (error) {
    if (isTopicClosedError(error)) {
      await telegram.reopenForumTopic(config.groupId, topicId);
      const copied = await copyToTopic(topicId, replyToGroupMessageId);
      copiedId = copied.message_id;
    } else if (isTopicDeletedError(error)) {
      topicId = await createAndInitializeUserTopic(deps, user, "replace");
      const copied = await copyToTopic(topicId);
      copiedId = copied.message_id;
    } else {
      throw error;
    }
  }

  await saveMessageLink(db, {
    privateChatId: chatId,
    privateMessageId: message.message_id,
    groupMessageId: copiedId,
    topicId,
    direction: "in",
  });

  if (await getFeature(db, "message_sent_reaction")) {
    deps.waitUntil(
      telegram
        .setMessageReaction(chatId, message.message_id, [
          { type: "emoji", emoji: "👍" },
        ])
        .catch(() => {}),
    );
  }
}

async function handleGroupGeneralMessage(
  deps: BotDeps,
  message: TelegramMessage,
): Promise<void> {
  const { db, config, telegram } = deps;
  const userId = message.from?.id;
  if (!userId) {
    return;
  }

  const cmd = parseCommand(message.text);
  if (cmd?.command === "settings") {
    await clearPendingEdit(db, config.groupId, userId, GENERAL_TOPIC_ID);
    await telegram.sendMessage(config.groupId, "<b>Hashi Settings</b>", {
      parse_mode: "HTML",
      reply_markup: settingsMainMarkup(),
    });

    return;
  }

  if (cmd?.command === "cancel") {
    const cleared = await clearPendingEdit(
      db,
      config.groupId,
      userId,
      GENERAL_TOPIC_ID,
    );
    await telegram.sendMessage(
      config.groupId,
      cleared ? "Cancelled." : "Nothing to cancel.",
      {
        reply_parameters: {
          message_id: message.message_id,
          allow_sending_without_reply: true,
        },
      },
    );

    return;
  }

  if (
    cmd?.command === "block" ||
    cmd?.command === "unblock" ||
    cmd?.command === "info"
  ) {
    await telegram.sendMessage(
      config.groupId,
      `Use /${cmd.command} inside a user's topic.`,
      {
        reply_parameters: {
          message_id: message.message_id,
          allow_sending_without_reply: true,
        },
      },
    );

    return;
  }

  if (message.text !== undefined && !cmd) {
    const pending = await getPendingEdit(
      db,
      config.groupId,
      userId,
      GENERAL_TOPIC_ID,
    );
    if (!pending) {
      return;
    }

    const trimmed = message.text.trim();
    if (!trimmed) {
      await telegram.sendMessage(
        config.groupId,
        "Text cannot be empty. Send the new text or /cancel.",
        {
          reply_parameters: {
            message_id: message.message_id,
            allow_sending_without_reply: true,
          },
        },
      );

      return;
    }

    await setText(db, pending.settingKey, trimmed);
    await clearPendingEdit(db, config.groupId, userId, GENERAL_TOPIC_ID);
    await telegram.sendMessage(
      config.groupId,
      `Updated <b>${escapeHtml(TEXT_LABELS[pending.settingKey])}</b>.`,
      {
        parse_mode: "HTML",
        reply_parameters: {
          message_id: message.message_id,
          allow_sending_without_reply: true,
        },
      },
    );
  }
}

async function handleGroupTopicMessage(
  deps: BotDeps,
  message: TelegramMessage,
): Promise<void> {
  const { db, config, telegram } = deps;
  const topicId = message.message_thread_id;
  if (!topicId) {
    return;
  }

  const notificationsTopicRaw = await getSystemValue(
    db,
    "notifications_topic_id",
  );
  if (
    notificationsTopicRaw &&
    topicId === Number.parseInt(notificationsTopicRaw, 10)
  ) {
    return;
  }

  const cmd = parseCommand(message.text);
  if (cmd?.command === "settings") {
    await telegram.sendMessage(
      config.groupId,
      "Please run /settings in the General topic.",
      {
        message_thread_id: topicId,
        reply_parameters: {
          message_id: message.message_id,
          allow_sending_without_reply: true,
        },
      },
    );

    return;
  }

  const user = await getUserByTopicId(db, topicId);
  if (!user) {
    if (
      cmd?.command === "block" ||
      cmd?.command === "unblock" ||
      cmd?.command === "info"
    ) {
      await telegram.sendMessage(
        config.groupId,
        "This topic is not linked to a user.",
        {
          message_thread_id: topicId,
          reply_parameters: {
            message_id: message.message_id,
            allow_sending_without_reply: true,
          },
        },
      );
    }

    return;
  }

  if (cmd?.command === "info") {
    await telegram.sendMessage(config.groupId, formatUserInfoHtml(user), {
      message_thread_id: topicId,
      parse_mode: "HTML",
      reply_markup: userActionsKeyboard(user),
      reply_parameters: {
        message_id: message.message_id,
        allow_sending_without_reply: true,
      },
    });

    return;
  }

  if (cmd?.command === "block" || cmd?.command === "unblock") {
    const blocked = cmd.command === "block";
    await setUserBlocked(db, user.chatId, blocked);
    await telegram.sendMessage(
      config.groupId,
      `User has been <b>${blocked ? "blocked" : "unblocked"}</b>.`,
      {
        message_thread_id: topicId,
        parse_mode: "HTML",
        reply_parameters: {
          message_id: message.message_id,
          allow_sending_without_reply: true,
        },
      },
    );

    return;
  }

  if (!hasForwardableContent(message)) {
    return;
  }

  if (user.blocked) {
    await telegram.sendMessage(
      config.groupId,
      "This user is blocked. Use /unblock to resume messaging.",
      {
        message_thread_id: topicId,
        reply_parameters: {
          message_id: message.message_id,
          allow_sending_without_reply: true,
        },
      },
    );

    return;
  }

  let replyToPrivateMessageId: number | undefined;
  if (message.reply_to_message) {
    const linked = await findPrivateMessageByGroup(
      db,
      topicId,
      message.reply_to_message.message_id,
    );
    if (linked?.privateChatId === user.chatId) {
      replyToPrivateMessageId = linked.privateMessageId;
    }
  }

  try {
    const copied = await telegram.copyMessage(
      user.chatId,
      config.groupId,
      message.message_id,
      replyToPrivateMessageId === undefined
        ? undefined
        : {
            reply_parameters: {
              message_id: replyToPrivateMessageId,
              allow_sending_without_reply: true,
            },
          },
    );

    await saveMessageLink(db, {
      privateChatId: user.chatId,
      privateMessageId: copied.message_id,
      groupMessageId: message.message_id,
      topicId,
      direction: "out",
    });
  } catch (error) {
    if (error instanceof TelegramApiError) {
      const notice = isUserUnavailableError(error)
        ? "Could not deliver message: the user has blocked the bot or is unavailable."
        : `Could not deliver message: ${error.description}`;
      await telegram
        .sendMessage(config.groupId, notice, {
          message_thread_id: topicId,
          reply_parameters: {
            message_id: message.message_id,
            allow_sending_without_reply: true,
          },
        })
        .catch(() => {});

      return;
    }

    throw error;
  }
}

async function handleEditedMessage(
  deps: BotDeps,
  message: TelegramMessage,
): Promise<void> {
  const { db, config, telegram } = deps;
  if (message.from?.is_bot) {
    return;
  }

  if (message.chat.type === "private") {
    const user = await getUserByChatId(db, message.chat.id);
    if (!user || user.blocked) {
      return;
    }
    const linked = await findGroupMessageByPrivate(
      db,
      message.chat.id,
      message.message_id,
    );
    if (!linked) {
      return;
    }

    try {
      if (message.text !== undefined) {
        await telegram.editMessageText(
          config.groupId,
          linked.groupMessageId,
          message.text,
          message.entities ? { entities: message.entities } : undefined,
        );
      } else if (message.caption !== undefined) {
        await telegram.editMessageCaption(
          config.groupId,
          linked.groupMessageId,
          message.caption,
          message.caption_entities
            ? { caption_entities: message.caption_entities }
            : undefined,
        );
      }
    } catch (error) {
      if (!isMessageNotModifiedError(error)) {
        console.error(
          JSON.stringify({
            message: "failed to sync private message edit",
            error: errorMessage(error),
          }),
        );
      }
    }

    return;
  }

  if (message.chat.id === config.groupId && message.message_thread_id) {
    const linked = await findPrivateMessageByGroup(
      db,
      message.message_thread_id,
      message.message_id,
    );
    if (!linked) {
      return;
    }
    const user = await getUserByChatId(db, linked.privateChatId);
    if (!user || user.blocked) {
      return;
    }

    try {
      if (message.text !== undefined) {
        await telegram.editMessageText(
          linked.privateChatId,
          linked.privateMessageId,
          message.text,
          message.entities ? { entities: message.entities } : undefined,
        );
      } else if (message.caption !== undefined) {
        await telegram.editMessageCaption(
          linked.privateChatId,
          linked.privateMessageId,
          message.caption,
          message.caption_entities
            ? { caption_entities: message.caption_entities }
            : undefined,
        );
      }
    } catch (error) {
      if (!isMessageNotModifiedError(error)) {
        console.error(
          JSON.stringify({
            message: "failed to sync group message edit",
            error: errorMessage(error),
          }),
        );
      }
    }
  }
}

async function handleCallbackQuery(
  deps: BotDeps,
  query: TelegramCallbackQuery,
): Promise<void> {
  const { db, config, telegram } = deps;
  const data = query.data ?? "";
  const msg = query.message;

  if (data === "v:cancel") {
    if (msg?.chat.type === "private") {
      await telegram.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
      await setUserVerificationMessageId(db, msg.chat.id, null);
    }
    await telegram.answerCallbackQuery(query.id);

    return;
  }

  if (msg?.chat.id !== config.groupId) {
    await telegram.answerCallbackQuery(query.id);

    return;
  }

  if (data === "s:main") {
    await telegram
      .editMessageText(
        config.groupId,
        msg.message_id,
        "<b>Hashi Settings</b>",
        {
          parse_mode: "HTML",
          reply_markup: settingsMainMarkup(),
        },
      )
      .catch((error: unknown) => {
        if (!isMessageNotModifiedError(error)) {
          throw error;
        }
      });
    await telegram.answerCallbackQuery(query.id);

    return;
  }

  if (data === "s:features") {
    await telegram
      .editMessageText(
        config.groupId,
        msg.message_id,
        "<b>Hashi Settings · Features</b>",
        {
          parse_mode: "HTML",
          reply_markup: await settingsFeaturesMarkup(db),
        },
      )
      .catch((error: unknown) => {
        if (!isMessageNotModifiedError(error)) {
          throw error;
        }
      });
    await telegram.answerCallbackQuery(query.id);

    return;
  }

  if (data === "s:texts") {
    await telegram
      .editMessageText(
        config.groupId,
        msg.message_id,
        "<b>Hashi Settings · Messages</b>",
        {
          parse_mode: "HTML",
          reply_markup: await settingsTextsMarkup(db),
        },
      )
      .catch((error: unknown) => {
        if (!isMessageNotModifiedError(error)) {
          throw error;
        }
      });
    await telegram.answerCallbackQuery(query.id);

    return;
  }

  if (data.startsWith("s:toggle:")) {
    const rawKey = data.slice("s:toggle:".length);
    if (!isFeatureKey(rawKey)) {
      await telegram.answerCallbackQuery(query.id, {
        text: "Unknown setting.",
      });

      return;
    }
    const key: FeatureKey = rawKey;
    const current = await getFeature(db, key);
    const nextValue = !current;

    if (key === "verification" && nextValue && !config.turnstile) {
      await telegram.answerCallbackQuery(query.id, {
        text: "Set TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY first.",
        show_alert: true,
      });

      return;
    }

    await setFeature(db, key, nextValue);
    await telegram
      .editMessageText(
        config.groupId,
        msg.message_id,
        "<b>Hashi Settings · Features</b>",
        {
          parse_mode: "HTML",
          reply_markup: await settingsFeaturesMarkup(db),
        },
      )
      .catch((error: unknown) => {
        if (!isMessageNotModifiedError(error)) {
          throw error;
        }
      });
    await telegram.answerCallbackQuery(query.id, {
      text: `${FEATURE_LABELS[key]}: ${nextValue ? "enabled" : "disabled"}`,
    });

    return;
  }

  if (data.startsWith("s:edit:")) {
    const rawKey = data.slice("s:edit:".length);
    if (!isTextKey(rawKey)) {
      await telegram.answerCallbackQuery(query.id, {
        text: "Unknown text key.",
      });

      return;
    }
    const key: TextKey = rawKey;
    const current = await getText(db, key);
    const prompt = [
      `<b>Editing ${escapeHtml(TEXT_LABELS[key])}</b>`,
      "",
      "Current value:",
      `<blockquote>${escapeHtml(current)}</blockquote>`,
      "",
      "Send the new text in this topic, or /cancel to keep the current value.",
    ].join("\n");

    const promptMessage = await telegram.sendMessage(config.groupId, prompt, {
      parse_mode: "HTML",
      reply_markup: {
        force_reply: true,
        selective: true,
        input_field_placeholder: `New ${TEXT_LABELS[key]}`,
      },
    });
    await setPendingEdit(
      db,
      config.groupId,
      query.from.id,
      GENERAL_TOPIC_ID,
      key,
      promptMessage.message_id,
    );
    await telegram.answerCallbackQuery(query.id);

    return;
  }

  if (data.startsWith("u:")) {
    const [, action, rawChatId] = data.split(":");
    const targetChatId = Number.parseInt(rawChatId ?? "", 10);
    if (!Number.isSafeInteger(targetChatId)) {
      await telegram.answerCallbackQuery(query.id, { text: "Invalid user." });

      return;
    }

    const user = await getUserByChatId(db, targetChatId);
    if (!user) {
      await telegram.answerCallbackQuery(query.id, { text: "User not found." });

      return;
    }

    let notice = "";
    let updated: UserRecord = user;
    if (action === "block" || action === "unblock") {
      const blocked = action === "block";
      await setUserBlocked(db, targetChatId, blocked);
      updated = { ...user, blocked };
      notice = blocked ? "User blocked" : "User unblocked";
    } else if (action === "verify" || action === "unverify") {
      const verified = action === "verify";
      await setUserVerified(db, targetChatId, verified);
      updated = { ...user, verified };
      notice = verified ? "User marked verified" : "Verification revoked";
    } else {
      await telegram.answerCallbackQuery(query.id);

      return;
    }

    await telegram
      .editMessageText(
        config.groupId,
        msg.message_id,
        formatUserInfoHtml(updated),
        {
          parse_mode: "HTML",
          reply_markup: userActionsKeyboard(updated),
        },
      )
      .catch((error: unknown) => {
        if (!isMessageNotModifiedError(error)) {
          throw error;
        }
      });
    await telegram.answerCallbackQuery(query.id, { text: notice });

    return;
  }

  await telegram.answerCallbackQuery(query.id);
}

async function handleMyChatMember(
  deps: BotDeps,
  event: TelegramChatMemberUpdated,
): Promise<void> {
  if (event.chat.type !== "private") {
    return;
  }
  const user = await getUserByChatId(deps.db, event.chat.id);
  if (!user?.topicId) {
    return;
  }

  const prev = event.old_chat_member.status;
  const next = event.new_chat_member.status;
  let notice: string | null = null;
  if (next === "kicked" || next === "left") {
    notice = "User blocked the bot.";
  } else if ((prev === "kicked" || prev === "left") && next === "member") {
    notice = "User unblocked the bot.";
  }

  if (notice) {
    await deps.telegram
      .sendMessage(deps.config.groupId, notice, {
        message_thread_id: user.topicId,
        disable_notification: true,
      })
      .catch(() => {});
  }
}

export async function handleTelegramUpdate(
  deps: BotDeps,
  update: TelegramUpdate,
): Promise<void> {
  if (update.callback_query) {
    await handleCallbackQuery(deps, update.callback_query);

    return;
  }

  if (update.my_chat_member) {
    await handleMyChatMember(deps, update.my_chat_member);

    return;
  }

  if (update.edited_message) {
    await handleEditedMessage(deps, update.edited_message);

    return;
  }

  const message = update.message;
  if (!message || message.from?.is_bot) {
    return;
  }

  if (message.chat.type === "private") {
    await handlePrivateMessage(deps, message);

    return;
  }

  if (message.chat.id === deps.config.groupId) {
    if (isGeneralTopicMessage(message)) {
      await handleGroupGeneralMessage(deps, message);
    } else {
      await handleGroupTopicMessage(deps, message);
    }
  }
}
