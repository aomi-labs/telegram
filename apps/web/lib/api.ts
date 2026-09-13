"use client";

import { useEffect, useState } from "react";
import { initData } from "./tg.ts";

export async function api<T>(tenant: string, path: string, init: RequestInit = {}): Promise<T> {
  if (init.signal?.aborted) throw init.signal.reason;
  const controller = new AbortController();
  const cancel = () => controller.abort(init.signal?.reason);
  init.signal?.addEventListener("abort", cancel, { once: true });
  let abort: () => void = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", abort, { once: true });
  });
  const readOnly = ["GET", "HEAD"].includes((init.method ?? "GET").toUpperCase());
  const timeoutMessage = readOnly
    ? "The request took too long. Check your connection and try again."
    : "The request timed out. Refresh to check whether it completed.";
  const timer = setTimeout(() => controller.abort(new Error(timeoutMessage)), 30_000);
  try {
    // Include body consumption in the deadline, not just receipt of headers.
    return await Promise.race([
      (async () => {
        const response = await fetch(`/api/t/${tenant}${path}`, {
          ...init,
          signal: controller.signal,
          headers: { "content-type": "application/json", "x-telegram-init-data": initData(), ...(init.headers ?? {}) },
          cache: "no-store",
        });
        const body = await response.json() as T & { error?: string };
        if (!response.ok) throw new Error(body.error ?? `${response.status}`);
        return body;
      })(),
      cancelled,
    ]);
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", cancel);
    controller.signal.removeEventListener("abort", abort);
  }
}

export function useApi<T>(tenant: string, path: string | null): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    const controller = new AbortController();
    setError(null);
    api<T>(tenant, path, { signal: controller.signal }).then((d) => live && setData(d)).catch((e: Error) => live && setError(e.message));
    return () => { live = false; controller.abort(); };
  }, [tenant, path, tick]);
  return { data, error, reload: () => setTick((t) => t + 1) };
}
