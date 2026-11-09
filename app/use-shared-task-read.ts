"use client";
import { useEffect } from "react";
import { useSharedUpdates } from "./SharedUpdatesProvider";

/** Hidden tabs and comments not loaded into the discussion never acknowledge updates. */
export function useSharedTaskRead(projectId: string | undefined, taskId: string | undefined, commentIds: string[]) {
  const { markTaskRead } = useSharedUpdates();
  const commentsKey = JSON.stringify([...new Set(commentIds)].sort());
  useEffect(() => {
    if (!projectId || !taskId) return;
    const controller = new AbortController();
    let pending = false, done = false;
    const read = async () => {
      if (pending || done || document.visibilityState !== "visible" || !navigator.onLine) return;
      pending = true;
      try { await markTaskRead(projectId, taskId, JSON.parse(commentsKey), controller.signal); done = true; }
      catch { /* The summary exposes failure; retry while the viewed task stays open. */ }
      finally { pending = false; }
    };
    const frame = requestAnimationFrame(() => void read());
    const retry = window.setInterval(() => void read(), 5000);
    window.addEventListener("online", read); window.addEventListener("focus", read);
    document.addEventListener("visibilitychange", read);
    return () => {
      controller.abort(); cancelAnimationFrame(frame); window.clearInterval(retry);
      window.removeEventListener("online", read); window.removeEventListener("focus", read);
      document.removeEventListener("visibilitychange", read);
    };
  }, [projectId, taskId, commentsKey, markTaskRead]);
}
