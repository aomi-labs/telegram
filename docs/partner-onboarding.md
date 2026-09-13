# Partner onboarding

What a partner does once to put their bot behind the service.

1. **Give us the bot token.** We run `pnpm onboard --tenant <id>`. The command
   reads the webhook currently registered on the bot (the aomi backend's URL),
   stores it as the forward target, points the bot at the service, registers
   the command menu, and prints an ingest key exactly once.
2. **Post handovers at issue time.** After the partner web app's aomi issue
   call succeeds, it posts to the service so the coming `/start` can be bound:

   ```http
   POST /t/<tenant>/handovers
   Origin: https://dev.wcm.inc            (an allowlisted web origin)
     — or —
   Authorization: Bearer <ingest key>     (from a server)

   { "token_hash": "<sha256 hex of the raw token>", "account_id": "11",
     "chain_id": 2092151908, "owner_address": "0x..." }
   ```

   Send the hash, never the token. The service never holds a claimable token.
   A browser call from an allowlisted origin needs no key: the token hash is
   unguessable, and the service reads the account's owner on chain and refuses
   the row unless it matches `owner_address`. Origins are set at onboarding
   with `--ingest-origin`. World's web app does this in
   `registerHandoverWithMiniApp` when `aomi.miniAppUrl` is configured.
3. **Keep the bot registration.** If the aomi bot registration is ever
   recreated, aomi re-points the webhook at itself and the service goes quiet
   until step 1 is repeated. The service's health check compares
   `getWebhookInfo` and alerts when this happens.

Rules the partner's commands live under: slash only, DM only, none of
`/start /help /wallet /permission /transactions /sign`, and a hard character
budget per reply.
