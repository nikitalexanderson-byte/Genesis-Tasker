"use client";
import { useEffect, useState } from "react";
import { loadSharedCalendarPreviews, type SharedCalendarPreviewFilter } from "./cloud-sync";

type Preview = Awaited<ReturnType<typeof loadSharedCalendarPreviews>>;

/** Bounded per-day previews; the main calendar retains its desktop-only default. */
export function useCalendarTaskPreviews(userId: string | undefined, from: string, to: string, enabled: boolean,
  options?: {filter?: SharedCalendarPreviewFilter; allWidths?: boolean; refreshKey?: unknown; pollMs?: number}) {
  const filterKey = JSON.stringify(options?.filter ?? null);
  const allWidths = options?.allWidths ?? false;
  const pollMs = options?.pollMs ?? 30000;
  const refreshKey = options?.refreshKey;
  const key = JSON.stringify([userId, from, to, enabled, filterKey, allWidths]);
  const [state, setState] = useState<{key:string;data:Preview} | null>(null);
  useEffect(() => {
    if (!userId || !enabled) return;
    const media = window.matchMedia("(min-width: 1100px)");
    let controller: AbortController | null = null;
    let live = true;
    const refresh = () => {
      if (!allWidths && !media.matches) { controller?.abort(); controller = null; setState(null); return; }
      // Slow requests must finish instead of being aborted by each polling tick.
      if (controller) return;
      const current = new AbortController(); controller = current;
      void loadSharedCalendarPreviews(from, to, current.signal, JSON.parse(filterKey) ?? undefined).then(data => {
        if (live && !current.signal.aborted) setState({key,data});
      }).catch(() => { if (live && !current.signal.aborted) setState(null); })
        .finally(() => { if (controller === current) controller = null; });
    };
    refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) refresh();
    }, pollMs);
    media.addEventListener("change", refresh);
    window.addEventListener("genesis:shared-updates", refresh);
    return () => {
      live = false; controller?.abort(); window.clearInterval(timer);
      media.removeEventListener("change", refresh);
      window.removeEventListener("genesis:shared-updates", refresh);
    };
  }, [key, userId, from, to, enabled, filterKey, allWidths, pollMs, refreshKey]);
  return state?.key === key ? state.data : null;
}
