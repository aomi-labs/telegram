import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  SERVICE_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, "32 bytes hex"),
  PUBLIC_URL: z.string().url(),
  /** Public origin of the mini app (apps/web). Optional: without it commands render text only. */
  PUBLIC_WEB_URL: z.string().url().optional(),
  TELEGRAM_API_BASE: z.string().url().default("https://api.telegram.org"),
  VERIFY_WEBHOOK_SECRET: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  PORT: z.coerce.number().int().positive().default(8790),
  FORWARD_INTERVAL_MS: z.coerce.number().int().positive().default(500),
  SCHEDULER_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`config: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  return parsed.data;
}
