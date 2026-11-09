"use client";
import { useCallback, useEffect, useState } from "react";

export function useActionNotice() {
  const [announcement, setAnnouncement] = useState({ message: "", revision: 0 });
  const announce = useCallback((text: string) => {
    setAnnouncement((current) => ({ message: text, revision: current.revision + 1 }));
  }, []);
  useEffect(() => {
    if (!announcement.message) return;
    const timer = window.setTimeout(() => setAnnouncement((current) =>
      current.revision === announcement.revision ? { ...current, message: "" } : current), 3500);
    return () => window.clearTimeout(timer);
  }, [announcement.message, announcement.revision]);
  return { notice: announcement.message, announce };
}

export function ActionNotice({ message }: { message: string }) {
  return message ? <div className="action-notice" role="status" aria-live="polite"><span aria-hidden="true">✓</span>{message}</div> : null;
}
