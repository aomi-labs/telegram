-- Vendor work uses the existing durable outbox, but completed rows remain
-- as receipts so Telegram retries cannot enqueue the same command again.
ALTER TABLE outbox ADD COLUMN target text NOT NULL DEFAULT 'backend';
ALTER TABLE outbox ADD COLUMN completed_at timestamptz;
ALTER TABLE outbox ADD COLUMN lease_until timestamptz;
ALTER TABLE outbox ADD COLUMN lease_token text;
CREATE UNIQUE INDEX outbox_vendor_update ON outbox (tenant, ((update->>'update_id')::bigint)) WHERE target = 'vendor';
CREATE INDEX outbox_vendor_due ON outbox (next_at) WHERE target = 'vendor' AND completed_at IS NULL;
