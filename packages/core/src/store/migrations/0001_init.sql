CREATE TABLE IF NOT EXISTS tenants (
  id                text PRIMARY KEY,
  bot_id            bigint NOT NULL UNIQUE,
  bot_username      text NOT NULL,
  bot_token_sealed  text NOT NULL,
  aomi_webhook_url  text NOT NULL,
  webhook_secret    text NOT NULL,
  ingest_key_hash   text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- One row per handover issued by the partner web. telegram_user_id is null
-- until the edge sees the matching /start; then exactly one row per user is
-- active per tenant.
CREATE TABLE IF NOT EXISTS accounts (
  id                bigserial PRIMARY KEY,
  tenant            text NOT NULL REFERENCES tenants(id),
  token_hash        text NOT NULL,
  account_id        text NOT NULL,
  chain_id          bigint NOT NULL,
  owner_address     text NOT NULL,
  telegram_user_id  text,
  issued_at         timestamptz NOT NULL DEFAULT now(),
  bound_at          timestamptz,
  active            boolean NOT NULL DEFAULT false,
  UNIQUE (tenant, token_hash)
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_one_active_per_user
  ON accounts (tenant, telegram_user_id) WHERE active;

CREATE TABLE IF NOT EXISTS watches (
  id           bigserial PRIMARY KEY,
  tenant       text NOT NULL REFERENCES tenants(id),
  account_id   text NOT NULL,
  kind         text NOT NULL,
  params       jsonb NOT NULL,
  state        text NOT NULL DEFAULT 'watching',
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  fired_at     timestamptz
);
CREATE INDEX IF NOT EXISTS watches_live ON watches (tenant, state) WHERE state IN ('watching', 'paused');

CREATE TABLE IF NOT EXISTS alerts (
  id           bigserial PRIMARY KEY,
  tenant       text NOT NULL REFERENCES tenants(id),
  account_id   text NOT NULL,
  kind         text NOT NULL,
  sent_at      timestamptz NOT NULL DEFAULT now(),
  cleared_at   timestamptz
);

CREATE TABLE IF NOT EXISTS visits (
  tenant            text NOT NULL REFERENCES tenants(id),
  telegram_user_id  text NOT NULL,
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  snapshot          jsonb,
  PRIMARY KEY (tenant, telegram_user_id)
);

-- Updates owed to the aomi backend. Telegram is acknowledged once the row
-- exists; delivery is retried until it succeeds.
CREATE TABLE IF NOT EXISTS outbox (
  id           bigserial PRIMARY KEY,
  tenant       text NOT NULL REFERENCES tenants(id),
  update       jsonb NOT NULL,
  attempts     integer NOT NULL DEFAULT 0,
  next_at      timestamptz NOT NULL DEFAULT now(),
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_due ON outbox (next_at);

