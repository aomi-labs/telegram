import { verifyTelegramInitData, type AccountBinding, type Tenant, type TenantRow } from "@aomi-telegram/core";
import { server, tenants } from "./server.ts";

export const INIT_DATA_HEADER = "x-telegram-init-data";

export type Authorized<A = unknown> = {
  tenant: Tenant<A>;
  row: TenantRow;
  telegramUserId: string;
  binding: AccountBinding | null;
  account: A | null;
};

export class AuthError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * Every BFF call carries the Mini App initData. It is verified against
 * Telegram's public key with the tenant's bot id, then the Telegram user is
 * resolved to the tenant account the edge bound at /start. No bot token, no
 * call to the aomi backend.
 */
export async function authorize<A = unknown>(request: Request, tenantId: string): Promise<Authorized<A>> {
  const tenant = tenants.get(tenantId) as Tenant<A> | undefined;
  const row = await server().store.tenant(tenantId);
  if (!tenant || !row) throw new AuthError(404, "unknown tenant");

  let telegramUserId: string;
  const devUser = process.env.NODE_ENV !== "production" ? process.env.WEB_DEV_TELEGRAM_USER_ID : undefined;
  if (devUser) {
    telegramUserId = devUser;
  } else {
    const initData = request.headers.get(INIT_DATA_HEADER) ?? "";
    const verified = verifyTelegramInitData(initData, row.bot_id);
    if (!verified.ok) throw new AuthError(401, verified.reason);
    telegramUserId = verified.launch.telegramUserId;
  }

  const binding = await server().store.binding(tenantId, telegramUserId);
  const account = binding ? await tenant.adapter.resolveAccount(binding) : null;
  return { tenant, row, telegramUserId, binding, account };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** Wraps a route so auth failures and adapter errors become JSON, never HTML error pages. */
export function route<A = unknown>(handler: (auth: Authorized<A>, request: Request, params: Record<string, string>) => Promise<Response>) {
  return async (request: Request, context: { params: Promise<Record<string, string>> }): Promise<Response> => {
    const params = await context.params;
    try {
      const auth = await authorize<A>(request, params.tenant ?? "");
      return await handler(auth, request, params);
    } catch (error) {
      if (error instanceof AuthError) return json({ error: error.message }, error.status);
      const cause = (error as { cause?: { code?: string; message?: string } }).cause;
      console.error(JSON.stringify({ event: "bff.error", error: String(error), cause: cause ? `${cause.code ?? ""} ${cause.message ?? ""}`.trim() : undefined }));
      return json({ error: "venue_read_failed" }, 502);
    }
  };
}
