# Partner onboarding

1. Register the bot with Aomi, then run `pnpm onboard --tenant <id>` using its bot token. The worker captures Aomi's webhook URL, installs its own authenticated webhook, and registers commands. Keep the stored Aomi URL private: it contains the bot capability.
2. Deploy Aomi's canonical binding endpoint before this mini-app version. The server appends `/binding` to the stored webhook URL and posts `{ "telegram_user_id": "123" }` after verifying Telegram identity. No ingestion key, browser registration call, or extra environment variable is needed.
3. Keep the existing World signed handover flow. Manager verifies venue ownership; the worker forwards `/start`; Aomi claims the handover. The mini-app retries briefly while claiming completes. Claimed accounts can be viewed; trading still needs owner grant and activation.
4. If the Aomi registration or webhook capability rotates, repeat onboarding with the current Aomi webhook URL. A disabled or revoked binding fails closed; old local account mappings cannot restore access.

Deploy backend first, then worker and web together. The retired `/t/<tenant>/handovers` endpoint returns 404. Existing database tables remain for non-destructive rollout, but local accounts are no longer authoritative; their Telegram IDs only seed fresh canonical scheduler lookups.

Verify real Telegram claim, mini-app display, activation, trade receipt, and revoked/expired access before declaring delivery complete.

Partner commands remain slash-only and DM-only, excluding `/start /help /wallet /permission /transactions /sign`, with a hard character budget per reply.
