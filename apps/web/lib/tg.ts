"use client";

/** Thin access to the Telegram WebApp object. Everything degrades to a plain browser tab. */
export function tg() {
  return typeof window === "undefined" ? undefined : window.Telegram?.WebApp;
}

export function initData(): string {
  return tg()?.initData ?? "";
}

/** Opens the bot chat with a draft pre-entered. The user still presses send; that is the consent. */
export function openDraft(botUsername: string, text: string): void {
  const url = `https://t.me/${botUsername}?text=${encodeURIComponent(text)}`;
  const app = tg();
  if (app?.openTelegramLink) app.openTelegramLink(url);
  else window.open(url, "_blank", "noopener");
}

export function haptic(kind: "light" | "success" | "error" = "light"): void {
  const h = tg()?.HapticFeedback;
  if (!h) return;
  if (kind === "light") h.impactOccurred("light");
  else h.notificationOccurred(kind);
}
