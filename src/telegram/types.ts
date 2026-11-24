export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  is_forum?: boolean;
}

export interface TelegramMessageEntity {
  type: string;
  offset: number;
  length: number;
  url?: string;
  user?: TelegramUser;
  language?: string;
  custom_emoji_id?: string;
}

export interface TelegramMessage {
  message_id: number;
  message_thread_id?: number;
  is_topic_message?: boolean;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  entities?: TelegramMessageEntity[];
  caption?: string;
  caption_entities?: TelegramMessageEntity[];
  reply_to_message?: TelegramMessage;
  photo?: unknown[];
  video?: unknown;
  audio?: unknown;
  voice?: unknown;
  document?: unknown;
  sticker?: unknown;
  animation?: unknown;
  video_note?: unknown;
  location?: unknown;
  venue?: unknown;
  contact?: unknown;
  poll?: unknown;
  dice?: unknown;
  story?: unknown;
  forum_topic_created?: unknown;
  forum_topic_edited?: unknown;
  forum_topic_closed?: unknown;
  forum_topic_reopened?: unknown;
  general_forum_topic_hidden?: unknown;
  general_forum_topic_unhidden?: unknown;
  new_chat_members?: TelegramUser[];
  left_chat_member?: TelegramUser;
  pinned_message?: unknown;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramChatMember {
  status:
    "creator" | "administrator" | "member" | "restricted" | "left" | "kicked";
  user: TelegramUser;
  can_manage_topics?: boolean;
  can_delete_messages?: boolean;
}

export interface TelegramChatMemberUpdated {
  chat: TelegramChat;
  from: TelegramUser;
  date: number;
  old_chat_member: TelegramChatMember;
  new_chat_member: TelegramChatMember;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
  my_chat_member?: TelegramChatMemberUpdated;
}

export interface InlineKeyboardButton {
  text: string;
  url?: string;
  callback_data?: string;
  web_app?: { url: string };
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface ForceReplyMarkup {
  force_reply: true;
  input_field_placeholder?: string;
  selective?: boolean;
}

export type ReplyMarkup = InlineKeyboardMarkup | ForceReplyMarkup;

export interface ReplyParameters {
  message_id: number;
  allow_sending_without_reply?: boolean;
}

export interface BotCommand {
  command: string;
  description: string;
}

export type BotCommandScope =
  | { type: "default" }
  | { type: "all_private_chats" }
  | { type: "chat"; chat_id: number };

export interface ReactionTypeEmoji {
  type: "emoji";
  emoji: string;
}

export interface ForumTopic {
  message_thread_id: number;
  name: string;
}

export interface MessageIdResult {
  message_id: number;
}
