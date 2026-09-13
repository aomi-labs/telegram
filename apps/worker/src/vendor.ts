import { randomUUID } from "node:crypto";
import type { Store, Update, VendorJob } from "@aomi-telegram/core";

export interface VendorDeps {
  store: Store;
  handle: (tenant: string, update: Update) => Promise<void>;
  log: (event: string, fields?: Record<string, unknown>) => void;
}

/** Durable retries prevent lost accepted commands. Telegram has no idempotency
 * key for sendMessage, so a crash after sending but before completion can still
 * duplicate a reply. Normal webhook retries are deduplicated by the outbox. */
export async function dispatchVendor(deps: VendorDeps, job: VendorJob): Promise<void> {
  const heartbeat = setInterval(() => {
    void deps.store.renewVendor(job.id, job.lease_token).then((renewed) => {
      if (!renewed) deps.log("vendor.lease_lost", { id: job.id });
    }).catch(() => deps.log("vendor.lease_failed", { id: job.id }));
  }, 20_000);
  try {
    await deps.handle(job.tenant, job.update);
    await deps.store.completeVendor(job.id, job.lease_token);
  } catch {
    await deps.store.retryVendor(job.id, job.lease_token, job.attempts + 1);
    deps.log("vendor.retry", { id: job.id, attempts: job.attempts + 1 });
  } finally {
    clearInterval(heartbeat);
  }
}

/** Separate slots let /app reply while a cold /b venue lookup is still running. */
export function startVendorDrainer(deps: VendorDeps, intervalMs = 250, concurrency = 4): () => void {
  const active = new Set<Promise<void>>();
  let claiming = false;
  let stopped = false;
  const timer = setInterval(async () => {
    if (claiming || stopped || active.size >= concurrency) return;
    claiming = true;
    try {
      const jobs = await deps.store.claimVendor(concurrency - active.size, randomUUID());
      for (const job of jobs) {
        const task = dispatchVendor(deps, job).catch(() => deps.log("vendor.error", { id: job.id }));
        active.add(task);
        void task.finally(() => active.delete(task));
      }
    } catch {
      deps.log("vendor.claim_failed");
    } finally {
      claiming = false;
    }
  }, intervalMs);
  return () => { stopped = true; clearInterval(timer); };
}
