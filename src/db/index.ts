import { unixNow } from "../server/crypto.ts";

export type SqlParam = string | number | null;

export interface SqlStatement {
  sql: string;
  params?: readonly SqlParam[];
}

export interface SqlRunResult {
  changes: number;
}

export interface SqlDatabase {
  first: <T>(sql: string, params?: readonly SqlParam[]) => Promise<T | null>;
  all: <T>(sql: string, params?: readonly SqlParam[]) => Promise<T[]>;
  run: (sql: string, params?: readonly SqlParam[]) => Promise<SqlRunResult>;
  batch: (
    statements: readonly SqlStatement[],
  ) => Promise<readonly SqlRunResult[]>;
}

export interface CloseableSqlDatabase extends SqlDatabase {
  close: () => void;
}

export function d1Adapter(db: D1Database): SqlDatabase {
  const prepare = (sql: string, params: readonly SqlParam[] = []) =>
    params.length > 0 ? db.prepare(sql).bind(...params) : db.prepare(sql);

  return {
    first: <T>(sql: string, params?: readonly SqlParam[]) =>
      prepare(sql, params).first<T>(),

    all: async <T>(sql: string, params?: readonly SqlParam[]): Promise<T[]> =>
      (await prepare(sql, params).all<T>()).results,

    run: async (
      sql: string,
      params?: readonly SqlParam[],
    ): Promise<SqlRunResult> => ({
      changes: (await prepare(sql, params).run()).meta.changes ?? 0,
    }),

    async batch(
      statements: readonly SqlStatement[],
    ): Promise<readonly SqlRunResult[]> {
      if (statements.length === 0) {
        return [];
      }
      const results = await db.batch(
        statements.map((s) => prepare(s.sql, s.params)),
      );

      return results.map((res) => ({ changes: res.meta.changes ?? 0 }));
    },
  };
}

export const DEFAULT_FEATURES = {
  message_sent_reaction: true,
  verification: false,
  new_chat_notification: true,
} as const;

export type FeatureKey = keyof typeof DEFAULT_FEATURES;

export const FEATURE_KEYS = Object.keys(DEFAULT_FEATURES) as FeatureKey[];

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  message_sent_reaction: "Delivery Reaction (👍)",
  verification: "Human Verification (Turnstile)",
  new_chat_notification: "New Chat Notifications",
};

export const DEFAULT_TEXTS = {
  welcome: "Hello! Send a message here and I will forward it.",
  blocked: "You are blocked from using this bot.",
  verify_prompt: "Please complete the verification below to start chatting.",
  verify_success: "Verification complete! You can now send messages.",
} as const;

export type TextKey = keyof typeof DEFAULT_TEXTS;

export const TEXT_KEYS = Object.keys(DEFAULT_TEXTS) as TextKey[];

export const TEXT_LABELS: Record<TextKey, string> = {
  welcome: "Welcome Message",
  blocked: "Blocked Notice",
  verify_prompt: "Verification Prompt",
  verify_success: "Verification Success",
};

export type SystemKey = "notifications_topic_id" | "setup_fingerprint";

export const isFeatureKey = (key: string): key is FeatureKey =>
  key in DEFAULT_FEATURES;

export const isTextKey = (key: string): key is TextKey => key in DEFAULT_TEXTS;

export interface UserRecord {
  chatId: number;
  topicId: number | null;
  displayName: string;
  username: string | null;
  blocked: boolean;
  verified: boolean;
  verificationMessageId: number | null;
  createdAt: number;
  updatedAt: number;
}

interface UserRow {
  chat_id: number;
  topic_id: number | null;
  display_name: string;
  username: string | null;
  blocked: number;
  verified: number;
  verification_message_id: number | null;
  created_at: number;
  updated_at: number;
}

const mapUserRow = (row: UserRow): UserRecord => ({
  chatId: row.chat_id,
  topicId: row.topic_id,
  displayName: row.display_name,
  username: row.username,
  blocked: row.blocked !== 0,
  verified: row.verified !== 0,
  verificationMessageId: row.verification_message_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export async function getUserByChatId(
  db: SqlDatabase,
  chatId: number,
): Promise<UserRecord | null> {
  const row = await db.first<UserRow>(
    `SELECT chat_id, topic_id, display_name, username, blocked, verified,
            verification_message_id, created_at, updated_at
     FROM users
     WHERE chat_id = ?1`,
    [chatId],
  );

  return row ? mapUserRow(row) : null;
}

export async function getUserByTopicId(
  db: SqlDatabase,
  topicId: number,
): Promise<UserRecord | null> {
  const row = await db.first<UserRow>(
    `SELECT chat_id, topic_id, display_name, username, blocked, verified,
            verification_message_id, created_at, updated_at
     FROM users
     WHERE topic_id = ?1`,
    [topicId],
  );

  return row ? mapUserRow(row) : null;
}

export async function upsertUser(
  db: SqlDatabase,
  profile: {
    chatId: number;
    displayName: string;
    username: string | null;
  },
  now: number = unixNow(),
): Promise<{ user: UserRecord; nameChanged: boolean }> {
  const existing = await getUserByChatId(db, profile.chatId);
  if (!existing) {
    await db.run(
      `INSERT INTO users (
         chat_id, display_name, username, blocked, verified, created_at, updated_at
       ) VALUES (?1, ?2, ?3, 0, 0, ?4, ?4)
       ON CONFLICT(chat_id) DO UPDATE SET
         display_name = excluded.display_name,
         username = excluded.username,
         updated_at = excluded.updated_at`,
      [profile.chatId, profile.displayName, profile.username, now],
    );
    const created = await getUserByChatId(db, profile.chatId);
    if (!created) {
      throw new Error(`failed to upsert user ${profile.chatId}`);
    }

    return { user: created, nameChanged: false };
  }

  const nameChanged =
    existing.displayName !== "" && existing.displayName !== profile.displayName;
  if (
    existing.displayName !== profile.displayName ||
    existing.username !== profile.username
  ) {
    await db.run(
      `UPDATE users
       SET display_name = ?2, username = ?3, updated_at = ?4
       WHERE chat_id = ?1`,
      [profile.chatId, profile.displayName, profile.username, now],
    );

    return {
      user: {
        ...existing,
        displayName: profile.displayName,
        username: profile.username,
        updatedAt: now,
      },
      nameChanged,
    };
  }

  return { user: existing, nameChanged: false };
}

/**
 * Atomically claims the initial topic_id for a user when none is set yet.
 * Returns true if this caller won the race, false if another request already
 * set a topic_id.
 */
export async function claimUserTopic(
  db: SqlDatabase,
  chatId: number,
  topicId: number,
  now: number = unixNow(),
): Promise<boolean> {
  const res = await db.run(
    `UPDATE users
     SET topic_id = ?2, updated_at = ?3
     WHERE chat_id = ?1 AND topic_id IS NULL`,
    [chatId, topicId, now],
  );

  return res.changes > 0;
}

/**
 * Replaces a deleted or invalid topic_id unconditionally.
 */
export async function replaceUserTopic(
  db: SqlDatabase,
  chatId: number,
  topicId: number,
  now: number = unixNow(),
): Promise<void> {
  await db.run(
    `UPDATE users
     SET topic_id = ?2, updated_at = ?3
     WHERE chat_id = ?1`,
    [chatId, topicId, now],
  );
}

export async function setUserBlocked(
  db: SqlDatabase,
  chatId: number,
  blocked: boolean,
  now: number = unixNow(),
): Promise<void> {
  await db.run(
    `UPDATE users
     SET blocked = ?2, updated_at = ?3
     WHERE chat_id = ?1`,
    [chatId, blocked ? 1 : 0, now],
  );
}

export async function setUserVerified(
  db: SqlDatabase,
  chatId: number,
  verified: boolean,
  now: number = unixNow(),
): Promise<void> {
  await db.run(
    `UPDATE users
     SET verified = ?2, verification_message_id = NULL, updated_at = ?3
     WHERE chat_id = ?1`,
    [chatId, verified ? 1 : 0, now],
  );
}

export async function setUserVerificationMessageId(
  db: SqlDatabase,
  chatId: number,
  messageId: number | null,
  now: number = unixNow(),
): Promise<void> {
  await db.run(
    `UPDATE users
     SET verification_message_id = ?2, updated_at = ?3
     WHERE chat_id = ?1`,
    [chatId, messageId, now],
  );
}

export async function saveMessageLink(
  db: SqlDatabase,
  link: {
    privateChatId: number;
    privateMessageId: number;
    groupMessageId: number;
    topicId: number;
    direction: "in" | "out";
  },
  now: number = unixNow(),
): Promise<void> {
  await db.run(
    `INSERT OR REPLACE INTO message_links (
       private_chat_id, private_message_id, group_message_id, topic_id, direction, created_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    [
      link.privateChatId,
      link.privateMessageId,
      link.groupMessageId,
      link.topicId,
      link.direction,
      now,
    ],
  );
}

export async function findGroupMessageByPrivate(
  db: SqlDatabase,
  privateChatId: number,
  privateMessageId: number,
): Promise<{ groupMessageId: number; topicId: number } | null> {
  const row = await db.first<{ group_message_id: number; topic_id: number }>(
    `SELECT group_message_id, topic_id
     FROM message_links
     WHERE private_chat_id = ?1 AND private_message_id = ?2`,
    [privateChatId, privateMessageId],
  );

  return row
    ? { groupMessageId: row.group_message_id, topicId: row.topic_id }
    : null;
}

export async function findPrivateMessageByGroup(
  db: SqlDatabase,
  topicId: number,
  groupMessageId: number,
): Promise<{ privateChatId: number; privateMessageId: number } | null> {
  const row = await db.first<{
    private_chat_id: number;
    private_message_id: number;
  }>(
    `SELECT private_chat_id, private_message_id
     FROM message_links
     WHERE topic_id = ?1 AND group_message_id = ?2`,
    [topicId, groupMessageId],
  );

  return row
    ? {
        privateChatId: row.private_chat_id,
        privateMessageId: row.private_message_id,
      }
    : null;
}

const featureStorageKey = (key: FeatureKey): string => `feature:${key}`;
const textStorageKey = (key: TextKey): string => `text:${key}`;
const systemStorageKey = (key: SystemKey): string => `system:${key}`;

export async function getFeatures(
  db: SqlDatabase,
): Promise<Record<FeatureKey, boolean>> {
  const rows = await db.all<{ key: string; value: string }>(
    `SELECT key, value FROM settings WHERE key LIKE 'feature:%'`,
  );
  const result: Record<FeatureKey, boolean> = { ...DEFAULT_FEATURES };
  for (const row of rows) {
    const k = row.key.slice("feature:".length);
    if (isFeatureKey(k)) {
      result[k] = row.value === "1";
    }
  }

  return result;
}

export async function getFeature(
  db: SqlDatabase,
  key: FeatureKey,
): Promise<boolean> {
  const row = await db.first<{ value: string }>(
    "SELECT value FROM settings WHERE key = ?1",
    [featureStorageKey(key)],
  );

  return row ? row.value === "1" : DEFAULT_FEATURES[key];
}

export async function setFeature(
  db: SqlDatabase,
  key: FeatureKey,
  enabled: boolean,
  now: number = unixNow(),
): Promise<void> {
  await db.run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
    [featureStorageKey(key), enabled ? "1" : "0", now],
  );
}

export async function getTexts(
  db: SqlDatabase,
): Promise<Record<TextKey, string>> {
  const rows = await db.all<{ key: string; value: string }>(
    `SELECT key, value FROM settings WHERE key LIKE 'text:%'`,
  );
  const result: Record<TextKey, string> = { ...DEFAULT_TEXTS };
  for (const row of rows) {
    const k = row.key.slice("text:".length);
    if (isTextKey(k)) {
      result[k] = row.value;
    }
  }

  return result;
}

export async function getText(db: SqlDatabase, key: TextKey): Promise<string> {
  const row = await db.first<{ value: string }>(
    "SELECT value FROM settings WHERE key = ?1",
    [textStorageKey(key)],
  );

  return row ? row.value : DEFAULT_TEXTS[key];
}

export async function setText(
  db: SqlDatabase,
  key: TextKey,
  value: string,
  now: number = unixNow(),
): Promise<void> {
  await db.run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
    [textStorageKey(key), value, now],
  );
}

export async function getSystemValue(
  db: SqlDatabase,
  key: SystemKey,
): Promise<string | null> {
  const row = await db.first<{ value: string }>(
    "SELECT value FROM settings WHERE key = ?1",
    [systemStorageKey(key)],
  );

  return row?.value ?? null;
}

export async function claimSystemValue(
  db: SqlDatabase,
  key: SystemKey,
  value: string,
  now: number = unixNow(),
): Promise<boolean> {
  const res = await db.run(
    `INSERT OR IGNORE INTO settings (key, value, updated_at)
     VALUES (?1, ?2, ?3)`,
    [systemStorageKey(key), value, now],
  );

  return res.changes > 0;
}

export async function setSystemValue(
  db: SqlDatabase,
  key: SystemKey,
  value: string,
  now: number = unixNow(),
): Promise<void> {
  await db.run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
    [systemStorageKey(key), value, now],
  );
}

const PENDING_EDIT_TTL_SECONDS = 900;

export interface PendingEdit {
  settingKey: TextKey;
  promptMessageId: number | null;
  createdAt: number;
}

export async function setPendingEdit(
  db: SqlDatabase,
  chatId: number,
  userId: number,
  topicId: number,
  settingKey: TextKey,
  promptMessageId: number | null,
  now: number = unixNow(),
): Promise<void> {
  await db.run(
    `INSERT INTO pending_edits (
       chat_id, user_id, topic_id, setting_key, prompt_message_id, created_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(chat_id, user_id, topic_id) DO UPDATE SET
       setting_key = excluded.setting_key,
       prompt_message_id = excluded.prompt_message_id,
       created_at = excluded.created_at`,
    [chatId, userId, topicId, settingKey, promptMessageId, now],
  );
}

export async function getPendingEdit(
  db: SqlDatabase,
  chatId: number,
  userId: number,
  topicId: number,
  now: number = unixNow(),
): Promise<PendingEdit | null> {
  const row = await db.first<{
    setting_key: string;
    prompt_message_id: number | null;
    created_at: number;
  }>(
    `SELECT setting_key, prompt_message_id, created_at
     FROM pending_edits
     WHERE chat_id = ?1 AND user_id = ?2 AND topic_id = ?3`,
    [chatId, userId, topicId],
  );
  if (!row || !isTextKey(row.setting_key)) {
    return null;
  }
  if (now - row.created_at > PENDING_EDIT_TTL_SECONDS) {
    await clearPendingEdit(db, chatId, userId, topicId);

    return null;
  }

  return {
    settingKey: row.setting_key,
    promptMessageId: row.prompt_message_id,
    createdAt: row.created_at,
  };
}

export async function clearPendingEdit(
  db: SqlDatabase,
  chatId: number,
  userId: number,
  topicId: number,
): Promise<boolean> {
  const res = await db.run(
    `DELETE FROM pending_edits
     WHERE chat_id = ?1 AND user_id = ?2 AND topic_id = ?3`,
    [chatId, userId, topicId],
  );

  return res.changes > 0;
}
