"use client";

import { useEffect, useState } from "react";
import { initData } from "./tg.ts";

export async function api<T>(tenant: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/t/${tenant}${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-telegram-init-data": initData(), ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `${response.status}`);
  return body;
}

export function useApi<T>(tenant: string, path: string | null): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    setError(null);
    api<T>(tenant, path).then((d) => live && setData(d)).catch((e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, [tenant, path, tick]);
  return { data, error, reload: () => setTick((t) => t + 1) };
}
