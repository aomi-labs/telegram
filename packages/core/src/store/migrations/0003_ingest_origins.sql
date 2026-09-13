-- Web origins allowed to register handovers without the ingest key. A static
-- partner SPA has nowhere to keep a secret; the token hash is unguessable and
-- the service checks account ownership on chain before accepting the row.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ingest_origins text[] NOT NULL DEFAULT '{}';
