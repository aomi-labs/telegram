-- Fills the worker indexes per bound account from the venue's trade events.
CREATE TABLE IF NOT EXISTS fills (
  id           bigserial PRIMARY KEY,
  tenant       text NOT NULL REFERENCES tenants(id),
  account_id   text NOT NULL,
  book         text NOT NULL,
  block        bigint NOT NULL,
  log_index    integer NOT NULL,
  symbol       text NOT NULL,
  market       text NOT NULL,
  side         text NOT NULL,
  price        text NOT NULL,
  qty          text NOT NULL,
  tx_hash      text,
  at           timestamptz NOT NULL,
  UNIQUE (tenant, account_id, book, block, log_index)
);
CREATE INDEX IF NOT EXISTS fills_by_account ON fills (tenant, account_id, at DESC);

-- Where each background scan has reached. Key is tenant-defined, e.g. fills:<account>.
CREATE TABLE IF NOT EXISTS cursors (
  tenant      text NOT NULL REFERENCES tenants(id),
  key         text NOT NULL,
  value       bigint NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant, key)
);
