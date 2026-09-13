import { commandOf, type CallbackQuery, type Message, type Update } from "../telegram/update.ts";

/** Callback data the service owns. Everything else is the backend's. */
export const VENDOR_CALLBACK_PREFIX = "t:";

/** Commands the aomi backend owns. A tenant may never claim one of these. */
export const RESERVED_COMMANDS: ReadonlySet<string> = new Set([
  "start", "help", "wallet", "permission", "transactions", "sign",
]);

export type Route =
  | { kind: "vendor_command"; name: string; args: string[]; message: Message }
  | { kind: "vendor_callback"; query: CallbackQuery }
  | { kind: "web_app_data"; message: Message }
  | { kind: "start"; arg: string | null; message: Message }
  | { kind: "forward" };

/**
 * The routing table. One owner per update: the service answers what is
 * declared as a vendor command or vendor callback, and everything else is
 * the backend's, forwarded byte for byte. Vendor commands are DM-only.
 */
export function classify(update: Update, vendorCommands: ReadonlySet<string>): Route {
  const message = update.message;
  if (message) {
    if (message.web_app_data) return { kind: "web_app_data", message };
    const command = commandOf(message);
    if (!command) return { kind: "forward" };
    if (command.name === "start") return { kind: "start", arg: command.args[0] ?? null, message };
    if (message.chat.type === "private" && vendorCommands.has(command.name) && !RESERVED_COMMANDS.has(command.name)) {
      return { kind: "vendor_command", name: command.name, args: command.args, message };
    }
    return { kind: "forward" };
  }
  const query = update.callback_query;
  if (query?.data?.startsWith(VENDOR_CALLBACK_PREFIX)) return { kind: "vendor_callback", query };
  return { kind: "forward" };
}

/** Refuse a tenant whose command set collides with the backend's. */
export function assertNoReservedCommands(names: Iterable<string>): void {
  const clash = [...names].filter((name) => RESERVED_COMMANDS.has(name));
  if (clash.length) throw new Error(`tenant claims reserved commands: ${clash.join(", ")}`);
}
