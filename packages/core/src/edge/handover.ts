import { sha256Hex } from "../crypto.ts";

/**
 * The partner web posts sha256 of the handover token it issued. The edge sees
 * the raw token as the `/start` argument on its way to the backend, hashes it
 * the same way, and binds the Telegram user. The raw token is never stored.
 */
export function handoverTokenHash(startArg: string): string {
  return sha256Hex(startArg);
}

export interface PendingHandover {
  tenant: string;
  tokenHash: string;
  accountId: string;
  chainId: number;
  ownerAddress: string;
}

export function isPlausibleStartToken(arg: string | null): arg is string {
  return typeof arg === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(arg);
}
