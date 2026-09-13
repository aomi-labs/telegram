import type { Sql } from "postgres";
import type { AccountBinding } from "../tenant.ts";
import type { Update } from "../telegram/update.ts";
import type { PendingHandover } from "../edge/handover.ts";

export interface TenantRow {
  id: string;
  bot_id: string;
  bot_username: string;
  bot_token_sealed: string;
  aomi_webhook_url: string;
  webhook_secret: string;
  ingest_key_hash: string;
  ingest_origins: string[];
}

export interface OutboxRow { id: string; tenant: string; update: Update; attempts: number }

export interface VendorJob extends OutboxRow { lease_token: string }

export type WatchState = "watching" | "paused" | "fired" | "cancelled" | "expired";
export interface WatchRow {
  id: string;
  tenant: string;
  account_id: string;
  kind: string;
  params: Record<string, unknown>;
  state: WatchState;
  created_at: Date;
  expires_at: Date;
  fired_at: Date | null;
}
export interface VisitRow { last_seen_at: Date; snapshot: Record<string, unknown> | null }
export interface FillRow {
  tenant: string; account_id: string; book: string; block: string; log_index: number;
  symbol: string; market: string; side: string; price: string; qty: string; tx_hash: string | null; at: Date;
}
export interface AlertRow { id: string; tenant: string; account_id: string; kind: string; sent_at: Date; cleared_at: Date | null }

/** All persistence behind one type. Every method is a single statement or one transaction. */
export class Store {
  constructor(readonly sql: Sql) {}

  tenant(id: string): Promise<TenantRow | null> {
    return this.sql<TenantRow[]>`SELECT * FROM tenants WHERE id = ${id}`.then((rows) => rows[0] ?? null);
  }

  async upsertTenant(row: TenantRow): Promise<void> {
    await this.sql`
      INSERT INTO tenants (id, bot_id, bot_username, bot_token_sealed, aomi_webhook_url, webhook_secret, ingest_key_hash, ingest_origins)
      VALUES (${row.id}, ${row.bot_id}, ${row.bot_username}, ${row.bot_token_sealed}, ${row.aomi_webhook_url}, ${row.webhook_secret}, ${row.ingest_key_hash}, ${row.ingest_origins})
      ON CONFLICT (id) DO UPDATE SET
        bot_id = EXCLUDED.bot_id, bot_username = EXCLUDED.bot_username, bot_token_sealed = EXCLUDED.bot_token_sealed,
        aomi_webhook_url = EXCLUDED.aomi_webhook_url, webhook_secret = EXCLUDED.webhook_secret, ingest_key_hash = EXCLUDED.ingest_key_hash,
        ingest_origins = EXCLUDED.ingest_origins`;
  }

  /** Partner web registered a handover it just issued. Idempotent on token hash. */
  async recordPendingHandover(pending: PendingHandover): Promise<void> {
    await this.sql`
      INSERT INTO accounts (tenant, token_hash, account_id, chain_id, owner_address)
      VALUES (${pending.tenant}, ${pending.tokenHash}, ${pending.accountId}, ${pending.chainId}, ${pending.ownerAddress})
      ON CONFLICT (tenant, token_hash) DO NOTHING`;
  }

  /**
   * The edge saw `/start <token>`. If the hash matches a pending row, bind the
   * Telegram user to it and make it the user's one active mapping. Returns the
   * binding, or null when the token is not one the partner registered.
   */
  async bindStart(tenant: string, tokenHash: string, telegramUserId: string): Promise<AccountBinding | null> {
    return this.sql.begin(async (tx) => {
      const [row] = await tx<{ id: string; account_id: string; chain_id: string; owner_address: string }[]>`
        SELECT id, account_id, chain_id, owner_address FROM accounts
        WHERE tenant = ${tenant} AND token_hash = ${tokenHash} AND telegram_user_id IS NULL
        FOR UPDATE`;
      if (!row) return null;
      await tx`UPDATE accounts SET active = false WHERE tenant = ${tenant} AND telegram_user_id = ${telegramUserId} AND active`;
      await tx`UPDATE accounts SET telegram_user_id = ${telegramUserId}, bound_at = now(), active = true WHERE id = ${row.id}`;
      return { tenant, telegramUserId, accountId: row.account_id, chainId: Number(row.chain_id), ownerAddress: row.owner_address };
    });
  }

  binding(tenant: string, telegramUserId: string): Promise<AccountBinding | null> {
    return this.sql<{ account_id: string; chain_id: string; owner_address: string }[]>`
      SELECT account_id, chain_id, owner_address FROM accounts
      WHERE tenant = ${tenant} AND telegram_user_id = ${telegramUserId} AND active`
      .then((rows) => {
        const row = rows[0];
        return row ? { tenant, telegramUserId, accountId: row.account_id, chainId: Number(row.chain_id), ownerAddress: row.owner_address } : null;
      });
  }

  async enqueueForward(tenant: string, update: Update): Promise<void> {
    await this.sql`INSERT INTO outbox (tenant, update) VALUES (${tenant}, ${this.sql.json(update as never)})`;
  }

  async enqueueVendor(tenant: string, update: Update): Promise<void> {
    await this.sql`INSERT INTO outbox (tenant, update, target)
      VALUES (${tenant}, ${this.sql.json(update as never)}, 'vendor') ON CONFLICT DO NOTHING`;
  }

  /** Claim and lease in one statement; locks survive until the UPDATE finishes. */
  claimVendor(limit: number, leaseToken: string): Promise<VendorJob[]> {
    return this.sql<VendorJob[]>`
      WITH due AS (
        SELECT id FROM outbox WHERE target = 'vendor' AND completed_at IS NULL
          AND next_at <= now() AND (lease_until IS NULL OR lease_until <= now())
        ORDER BY id LIMIT ${limit} FOR UPDATE SKIP LOCKED
      )
      UPDATE outbox SET lease_until = now() + interval '60 seconds', lease_token = ${leaseToken}
      FROM due WHERE outbox.id = due.id
      RETURNING outbox.id, tenant, update, attempts, lease_token`;
  }

  async renewVendor(id: string, leaseToken: string): Promise<boolean> {
    const rows = await this.sql`UPDATE outbox SET lease_until = now() + interval '60 seconds'
      WHERE id = ${id} AND lease_token = ${leaseToken} AND completed_at IS NULL RETURNING id`;
    return rows.length === 1;
  }

  async completeVendor(id: string, leaseToken: string): Promise<void> {
    await this.sql`UPDATE outbox SET completed_at = now(), lease_until = NULL, lease_token = NULL
      WHERE id = ${id} AND lease_token = ${leaseToken}`;
  }

  async retryVendor(id: string, leaseToken: string, attempts: number): Promise<void> {
    await this.sql`UPDATE outbox SET attempts = ${attempts}, lease_until = NULL, lease_token = NULL,
      next_at = now() + make_interval(secs => ${Math.min(2 ** attempts, 300)})
      WHERE id = ${id} AND lease_token = ${leaseToken}`;
  }

  /** Claims due rows for one drainer pass; other drainers skip locked rows. */
  claimDue(limit: number): Promise<OutboxRow[]> {
    return this.sql<OutboxRow[]>`
      SELECT id, tenant, update, attempts FROM outbox
      WHERE target = 'backend' AND next_at <= now()
      ORDER BY id
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED`;
  }

  async delivered(id: string): Promise<void> {
    await this.sql`DELETE FROM outbox WHERE id = ${id}`;
  }

  async failed(id: string, attempts: number, error: string): Promise<void> {
    const delaySeconds = Math.min(2 ** attempts, 300);
    await this.sql`
      UPDATE outbox SET attempts = ${attempts}, last_error = ${error.slice(0, 500)},
        next_at = now() + make_interval(secs => ${delaySeconds})
      WHERE id = ${id}`;
  }

  async touchVisit(tenant: string, telegramUserId: string): Promise<void> {
    await this.sql`
      INSERT INTO visits (tenant, telegram_user_id) VALUES (${tenant}, ${telegramUserId})
      ON CONFLICT (tenant, telegram_user_id) DO UPDATE SET last_seen_at = now()`;
  }

  visit(tenant: string, telegramUserId: string): Promise<VisitRow | null> {
    return this.sql<VisitRow[]>`SELECT last_seen_at, snapshot FROM visits WHERE tenant = ${tenant} AND telegram_user_id = ${telegramUserId}`
      .then((rows) => rows[0] ?? null);
  }

  /** The mini app records what the user saw so the next launch can show what changed. */
  async recordVisit(tenant: string, telegramUserId: string, snapshot: Record<string, unknown>): Promise<void> {
    await this.sql`
      INSERT INTO visits (tenant, telegram_user_id, snapshot) VALUES (${tenant}, ${telegramUserId}, ${this.sql.json(snapshot as never)})
      ON CONFLICT (tenant, telegram_user_id) DO UPDATE SET last_seen_at = now(), snapshot = EXCLUDED.snapshot`;
  }

  async createWatch(tenant: string, accountId: string, kind: string, params: Record<string, unknown>, ttlDays = 30): Promise<WatchRow> {
    const [row] = await this.sql<WatchRow[]>`
      INSERT INTO watches (tenant, account_id, kind, params, expires_at)
      VALUES (${tenant}, ${accountId}, ${kind}, ${this.sql.json(params as never)}, now() + make_interval(days => ${ttlDays}))
      RETURNING *`;
    return row!;
  }

  watches(tenant: string, accountId: string, states: WatchState[]): Promise<WatchRow[]> {
    return this.sql<WatchRow[]>`
      SELECT * FROM watches WHERE tenant = ${tenant} AND account_id = ${accountId} AND state = ANY(${states})
      ORDER BY created_at DESC`;
  }

  /** Every live watch across the tenant, for the scheduler. */
  liveWatches(tenant: string): Promise<WatchRow[]> {
    return this.sql<WatchRow[]>`SELECT * FROM watches WHERE tenant = ${tenant} AND state = 'watching' AND expires_at > now()`;
  }

  /** Legal transitions only; anything else is a no-op that returns null. */
  async setWatchState(tenant: string, accountId: string, id: string, state: WatchState): Promise<WatchRow | null> {
    const from: Record<WatchState, WatchState[]> = { paused: ["watching"], watching: ["paused"], cancelled: ["watching", "paused"], fired: ["watching"], expired: ["watching", "paused"] };
    const [row] = await this.sql<WatchRow[]>`
      UPDATE watches SET state = ${state}, fired_at = CASE WHEN ${state} = 'fired' THEN now() ELSE fired_at END
      WHERE tenant = ${tenant} AND account_id = ${accountId} AND id = ${id} AND state = ANY(${from[state]})
      RETURNING *`;
    return row ?? null;
  }

  /** Every bound, active account with the Telegram user to push to. */
  activeBindings(tenant: string): Promise<AccountBinding[]> {
    return this.sql<{ account_id: string; chain_id: string; owner_address: string; telegram_user_id: string }[]>`
      SELECT account_id, chain_id, owner_address, telegram_user_id FROM accounts WHERE tenant = ${tenant} AND active AND telegram_user_id IS NOT NULL`
      .then((rows) => rows.map((r) => ({ tenant, telegramUserId: r.telegram_user_id, accountId: r.account_id, chainId: Number(r.chain_id), ownerAddress: r.owner_address })));
  }

  fills(tenant: string, accountId: string, since: Date, limit = 200): Promise<FillRow[]> {
    return this.sql<FillRow[]>`
      SELECT * FROM fills WHERE tenant = ${tenant} AND account_id = ${accountId} AND at >= ${since}
      ORDER BY at DESC, log_index DESC LIMIT ${limit}`;
  }

  async insertFills(rows: Omit<FillRow, "tenant" | "account_id">[], tenant: string, accountId: string): Promise<number> {
    if (rows.length === 0) return 0;
    const values = rows.map((r) => ({ tenant, account_id: accountId, book: r.book, block: r.block, log_index: r.log_index, symbol: r.symbol, market: r.market, side: r.side, price: r.price, qty: r.qty, tx_hash: r.tx_hash, at: r.at }));
    const inserted = await this.sql`INSERT INTO fills ${this.sql(values)} ON CONFLICT DO NOTHING RETURNING id`;
    return inserted.length;
  }

  cursor(tenant: string, key: string): Promise<bigint | null> {
    return this.sql<{ value: string }[]>`SELECT value FROM cursors WHERE tenant = ${tenant} AND key = ${key}`
      .then((rows) => (rows[0] ? BigInt(rows[0].value) : null));
  }

  async setCursor(tenant: string, key: string, value: bigint): Promise<void> {
    await this.sql`
      INSERT INTO cursors (tenant, key, value) VALUES (${tenant}, ${key}, ${value.toString()})
      ON CONFLICT (tenant, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  }

  openAlert(tenant: string, accountId: string, kind: string): Promise<AlertRow | null> {
    return this.sql<AlertRow[]>`SELECT * FROM alerts WHERE tenant = ${tenant} AND account_id = ${accountId} AND kind = ${kind} AND cleared_at IS NULL`
      .then((rows) => rows[0] ?? null);
  }

  async raiseAlert(tenant: string, accountId: string, kind: string): Promise<AlertRow> {
    const [row] = await this.sql<AlertRow[]>`INSERT INTO alerts (tenant, account_id, kind) VALUES (${tenant}, ${accountId}, ${kind}) RETURNING *`;
    return row!;
  }

  async clearAlert(tenant: string, accountId: string, kind: string): Promise<void> {
    await this.sql`UPDATE alerts SET cleared_at = now() WHERE tenant = ${tenant} AND account_id = ${accountId} AND kind = ${kind} AND cleared_at IS NULL`;
  }

  async expireWatches(tenant: string): Promise<number> {
    const rows = await this.sql`UPDATE watches SET state = 'expired' WHERE tenant = ${tenant} AND state IN ('watching','paused') AND expires_at <= now() RETURNING id`;
    return rows.length;
  }
}
