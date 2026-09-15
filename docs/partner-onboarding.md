# Partner onboarding

What a partner does once to put their bot behind the service.

1. **Give us the bot token.** We run `pnpm onboard --tenant <id>`. The command
   reads the webhook currently registered on the bot (the aomi backend's URL),
   stores it as the forward target, points the bot at the service, registers
   the command menu, and prints an ingest key exactly once.
2. **Register through the trusted issuer.** Configure the Aomi manager's
   `AOMI_TELEGRAM_HANDOVER_INGEST` JSON mapping, keyed by the exact bot
   registration id, with `url` and the tenant's server-only `key`. Wallet
   issuance registers the verified account, owner and venue chain before
   returning the QR token. The registration request is:

   ```http
   POST /t/<tenant>/handovers
   Authorization: Bearer <ingest key>
   Content-Type: application/json

   { "token_hash": "<sha256 hex of the raw token>", "account_id": "11",
     "chain_id": 2092151908, "owner_address": "0x..." }
   ```

   Send the bare-token SHA-256, not Aomi's prefixed internal claim hash.
   The service never holds a claimable token. A browser Origin is not
   authorization, even if allowlisted, and must never receive the ingest key.
   Release the configured issuer and bearer-only worker together before
   switching the frontend. Review/invalidate bindings created through the
   former public endpoint and require affected users to relink; this change
   does not retroactively establish their provenance.
3. **Keep the bot registration.** If the aomi bot registration is ever
   recreated, aomi re-points the webhook at itself and the service goes quiet
   until step 1 is repeated. The service's health check compares
   `getWebhookInfo` and alerts when this happens.

Rules the partner's commands live under: slash only, DM only, none of
`/start /help /wallet /permission /transactions /sign`, and a hard character
budget per reply.
