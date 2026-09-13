/** The slice of Telegram's Update type the edge needs. Everything else passes through untouched. */
export interface User { id: number; is_bot: boolean; first_name: string; username?: string }
export interface Chat { id: number; type: "private" | "group" | "supergroup" | "channel" }
export interface MessageEntity { type: string; offset: number; length: number }
export interface WebAppData { data: string; button_text: string }
export interface Message {
  message_id: number;
  date: number;
  chat: Chat;
  from?: User;
  text?: string;
  entities?: MessageEntity[];
  web_app_data?: WebAppData;
}
export interface CallbackQuery { id: string; from: User; message?: Message; data?: string }
export interface Update {
  update_id: number;
  message?: Message;
  callback_query?: CallbackQuery;
  [other: string]: unknown;
}

export interface InlineKeyboardButton {
  text: string;
  web_app?: { url: string };
  callback_data?: string;
  url?: string;
}

/**
 * The slash command a message starts with, if any, without the leading slash
 * and without an `@botname` suffix. Uses Telegram's own `bot_command` entity
 * at offset 0, so free text that merely contains a slash is never a command.
 */
export function commandOf(message: Message): { name: string; args: string[] } | null {
  const entity = message.entities?.find((e) => e.type === "bot_command" && e.offset === 0);
  const text = message.text;
  if (!entity || !text) return null;
  const raw = text.slice(1, entity.length);
  const name = raw.split("@")[0]?.toLowerCase() ?? "";
  if (!name) return null;
  const args = text.slice(entity.length).trim().split(/\s+/).filter(Boolean);
  return { name, args };
}
