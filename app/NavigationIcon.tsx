import { PhysisIconGlyph } from "./PhysisIcon";
import type { CSSProperties } from "react";

/** One shared, readable icon vocabulary for the rail and the mobile row. */
export function NavigationIcon({ name }: { name: string }) {
  return <svg className="genesis-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"
    style={{ "--nav-icon-turn": name === "today" || name === "year" ? "18deg" : "0deg" } as CSSProperties}>
    {name === "today" ? <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></> : null}
    {name === "projects" ? <><path d="M3 7h7l2 2h9v11H3Z"/><path d="M3 7V4h7l2 3"/><path d="m8 14 2 2 5-5"/></> : null}
    {name === "habits" ? <><path d="M12 21v-9M12 15C5 15 4 11 4 6c5 0 8 2 8 7M12 11c0-6 3-8 8-8 0 5-2 8-8 8"/></> : null}
    {name === "physis" ? <PhysisIconGlyph /> : null}
    {name === "calendar" ? <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18M7 14h2m4 0h2m2 0h1M7 17h2m4 0h2"/></> : null}
    {name === "year" ? <><circle cx="12" cy="12" r="9"/><path d="M12 3v3m0 12v3M3 12h3m12 0h3"/><path d="m12 8 3 4-3 4-3-4Z"/></> : null}
    {name === "stoicheion" ? <><path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z"/><circle cx="12" cy="12" r="2"/></> : null}
    {name === "admin" ? <><path d="M12 2 21 6v6c0 5-5 8-9 10-4-2-9-5-9-10V6Z"/><path d="m8 12 3 3 5-6"/></> : null}
  </svg>;
}
