import { useEffect, useState } from "react";
import type { CalendarMode } from "./calendar-data";
import type { Language } from "./i18n";
import { captureAccountSessionGuard, updateAccountPreferences } from "./cloud-sync";
import { CalendarModeIcon } from "./CalendarModeIcon";
import { DialogCloseButton } from "./DialogCloseButton";
import copy from "./account-discovery-copy.json";

const seenKey = (userId: string) => `genesis-calendar-exploration-v1:${userId}`;
function hasSeen(userId: string) {
  try { return localStorage.getItem(seenKey(userId)) === "1"; } catch { return false; }
}

export default function CalendarExploreNotice({ userId, pending, language, calendars, onSelect, onAcknowledged }: {
  userId: string; pending: boolean; language: Language; calendars: readonly CalendarMode[];
  onSelect: (mode: CalendarMode) => void; onAcknowledged: (userId: string) => void;
}) {
  const [open, setOpen] = useState(() => pending && !hasSeen(userId));
  const text = copy[language];
  const alternatives = calendars.filter(mode => mode !== "profane");
  useEffect(() => {
    if (!pending || alternatives.length === 0) return;
    // Persist that the tip was shown, including when the visitor leaves without closing it.
    try { localStorage.setItem(seenKey(userId), "1"); } catch { /* Server acknowledgement is the cross-device source. */ }
    let disposed = false;
    let inFlight = false;
    const activeSession = captureAccountSessionGuard();
    const acknowledge = () => {
      if (inFlight || disposed) return;
      inFlight = true;
      void Promise.resolve().then(() => {
        activeSession();
        return updateAccountPreferences({ calendarExplorationPending: false });
      }).then(() => {
        if (!disposed) onAcknowledged(userId);
      }).catch(() => { /* Retry on reconnect or on the next visit; local seen state prevents a repeat. */ })
        .finally(() => { inFlight = false; });
    };
    acknowledge();
    window.addEventListener("online", acknowledge);
    return () => { disposed = true; window.removeEventListener("online", acknowledge); };
  }, [userId, pending, alternatives.length, onAcknowledged]);

  if (!open || !alternatives.length) return null;
  return <aside className="calendar-explore-notice" aria-labelledby="calendar-explore-title" data-no-translate>
    <header><h2 id="calendar-explore-title">{text.introTitle}</h2><DialogCloseButton className="calendar-explore-close" aria-label={text.close} onClick={() => setOpen(false)} /></header>
    <p>{text.introCurrent}</p>
    <div className="calendar-explore-options">
      {alternatives.map(mode => <div key={mode}>
        <CalendarModeIcon mode={mode} size={26} />
        <p>{mode === "sacred" ? text.sacredBody : text.lunarBody}</p>
        <button type="button" onClick={() => { setOpen(false); onSelect(mode); }}><span>{mode === "sacred" ? text.trySacred : text.tryLunar}</span><span aria-hidden="true">→</span></button>
      </div>)}
    </div>
  </aside>;
}
