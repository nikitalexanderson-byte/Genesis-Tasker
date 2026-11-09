"use client";
import { useEffect, useState } from "react";
import { WEB_REMINDER_EVENT, unlockReminderAudio, type WebReminderKind } from "./web-reminder-presentation";
import { LOCAL_SESSION_ENDED_EVENT } from "./cloud-sync";
export type ReminderNotice = { id: string; kind: WebReminderKind; title: string; body: string };
export function useReminderNotices(appBase: string) {
  const [notes, setNotes] = useState<ReminderNotice[]>([]);
  useEffect(() => {
    const remove = unlockReminderAudio(appBase);
    const notify = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail || !["task", "habit"].includes(detail.kind) || typeof detail.title !== "string" || typeof detail.body !== "string") return;
      setNotes(current => [{ id: crypto.randomUUID(), kind: detail.kind, title: detail.title, body: detail.body }, ...current]);
    };
    const clear = () => setNotes([]);
    window.addEventListener(WEB_REMINDER_EVENT, notify); window.addEventListener(LOCAL_SESSION_ENDED_EVENT, clear);
    return () => { remove?.(); window.removeEventListener(WEB_REMINDER_EVENT, notify); window.removeEventListener(LOCAL_SESSION_ENDED_EVENT, clear); };
  }, [appBase]);
  return { notes, dismiss: (id: string) => setNotes(current => current.filter(note => note.id !== id)) };
}
