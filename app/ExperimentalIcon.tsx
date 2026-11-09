import { PhysisIconGlyph } from "./PhysisIcon";
/** Reference uses Lucide's ISC-licensed 24px geometry. No new UI runtime. */
export function ExperimentalIcon({ name, className = "" }: { name: string; className?: string }) {
  return <svg className={`experimental-icon ${className}`} data-icon={name} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {name === "physis" ? <PhysisIconGlyph /> : null}
    {name === "today" || name === "sun" ? <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2m-7.07-15.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></> : null}
    {name === "moon" ? <path d="M19.79 15.5A8 8 0 0 1 8.5 4.21 8 8 0 1 0 19.79 15.5Z"/> : null}
    {name === "future-modeling" ? <><circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="M5 17V9a4 4 0 0 1 4-4h8M9 5a4 4 0 0 1 4 4v6a4 4 0 0 0 4 4"/></> : null}
    {name === "info" ? <><circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/></> : null}
    {name === "theme-contrast" ? <><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 4h5a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3h-5Z" fill="currentColor" stroke="none"/><path d="M12 4v16"/></> : null}
    {name === "sunrise" || name === "sunset" ? <><path d="M3 19h18M5 15H3m18 0h-2M7 9 5.5 7.5M17 9l1.5-1.5M7 15a5 5 0 0 1 10 0"/><path d={name === "sunrise" ? "M12 10V2m-3 3 3-3 3 3" : "M12 2v8m-3-3 3 3 3-3"}/></> : null}
    {name.startsWith("calendar-scale-") ? <><rect x="3" y="3" width="18" height="18" rx="2" opacity={name === "calendar-scale-full" ? 1 : .35}/>{name === "calendar-scale-full" ? <path d="M3 9h18M9 9v12M15 9v12M3 15h18"/> : <rect x={name === "calendar-scale-half" ? 6 : 9} y={name === "calendar-scale-half" ? 6 : 9} width={name === "calendar-scale-half" ? 12 : 6} height={name === "calendar-scale-half" ? 12 : 6} rx="1" fill="currentColor"/>}</> : null}
    {name === "projects" ? <><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/><path d="M8 10v4m4-4v2m4-2v6"/></> : null}
    {name === "habits" ? <><path d="M14 9.536V7a4 4 0 0 1 4-4h1.5a.5.5 0 0 1 .5.5V5a4 4 0 0 1-4 4 4 4 0 0 0-4 4c0 2 1 3 1 5a5 5 0 0 1-1 3M4 9a5 5 0 0 1 8 4 5 5 0 0 1-8-4M5 21h14"/></> : null}
    {name === "calendar" ? <><path d="M8 2v4m8-4v4M3 10h18"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/></> : null}
    {name === "meeting" ? <><path d="M8 2v4m8-4v4M3 9h18"/><rect x="3" y="4" width="18" height="18" rx="2"/><circle cx="12" cy="13" r="2"/><path d="M8 20v-1a3 3 0 0 1 3-3h2a3 3 0 0 1 3 3v1"/></> : null}
    {name === "event" ? <><path d="M8 2v4m8-4v4M3 9h18"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="m12 11 1.4 2.8 3.1.4-2.3 2.2.6 3.1-2.8-1.5-2.8 1.5.6-3.1-2.3-2.2 3.1-.4Z"/></> : null}
    {name === "birthday" ? <><path d="M8 3v3m4-4v4m4-3v3M5 12h14M4 12v9h16v-9M3 21h18"/><path d="M5 12V9h14v3M4 15c2 2 4 2 6 0 1.3-1.3 2.7-1.3 4 0 2 2 4 2 6 0"/></> : null}
    {name === "year" ? <><circle cx="12" cy="12" r="9"/><path d="M12 3v3m0 12v3M3 12h3m12 0h3M12 8v4l3 2"/></> : null}
    {name === "stoicheion" || name === "theokyklos" ? <><path d="m12 3 2 7 7 2-7 2-2 7-2-7-7-2 7-2Z"/><path d="M20 2v4m2-2h-4M3 18v4m2-2H1"/></> : null}
    {name === "admin" ? <><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1Z"/><path d="m9 12 2 2 4-4"/></> : null}
    {name === "plus" ? <path d="M5 12h14M12 5v14"/> : null}
    {name === "share-2" ? <><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98m-.01-10.98-6.82 3.98"/></> : null}
    {name === "palette" ? <><path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8Z"/><circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/></> : null}
    {name === "star" ? <path d="m12 3 2.78 5.63 6.22.9-4.5 4.39 1.06 6.2L12 17.19l-5.56 2.93 1.06-6.2L3 9.53l6.22-.9Z"/> : null}
    {name === "heart" ? <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/> : null}
    {name === "advice-like" ? <path d="M7 10v11H3V10h4Zm0 10h11a2 2 0 0 0 2-1.7l1-6A2 2 0 0 0 19 10h-5V6a3 3 0 0 0-3-3l-4 7"/> : null}
    {name === "advice-dislike" ? <path d="M17 14V3h4v11h-4Zm0-10H6a2 2 0 0 0-2 1.7l-1 6A2 2 0 0 0 5 14h5v4a3 3 0 0 0 3 3l4-7"/> : null}
    {name === "pause" ? <><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></> : null}
    {name === "play" ? <path d="m8 4 12 8-12 8Z"/> : null}
    {name === "account" ? <><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2"/></> : null}
    {name === "trash" ? <><path d="M3 6h18M19 6l-1 14H6L5 6M9 6V3h6v3M10 10v6M14 10v6"/></> : null}
    {name === "undo" ? <><path d="M3 10h11a7 7 0 0 1 7 7v3M3 10l6-6m-6 6 6 6"/></> : null}
    {name === "redo" ? <><path d="M21 10H10a7 7 0 0 0-7 7v3m18-10-6-6m6 6-6 6"/></> : null}
    {name === "help" ? <><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4.3 1.7c-1.1.8-1.8 1.3-1.8 2.8M12 17h.01"/></> : null}
    {name === "fit" ? <><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><rect x="8" y="8" width="8" height="8" rx="1"/></> : null}
    {name === "maximize" ? <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/> : null}
    {name === "minimize" ? <path d="M3 8h5V3m13 5h-5V3M8 21v-5H3m13 5v-5h5"/> : null}
    {name === "thought-new" ? <><path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8-1c-1.2 1-1.5 2-1.5 3h-5c0-1-.3-1.7-1.5-2Z"/><path d="M19 3v6m-3-3h6"/></> : null}
    {name === "thought-task" ? <><path d="M4 13h4m-3 3h2M3.4 10a4 4 0 1 1 5.2 0C7.8 10.8 8 12 8 13H4c0-1 .2-2.2-.6-3ZM11 8h9m-3-3 3 3-3 3"/><rect x="12" y="14" width="10" height="8" rx="1.5"/><path d="m14.5 18 1.7 1.7 3.3-3.4"/></> : null}
    {name === "thought-link" ? <path d="M10 13a5 5 0 0 0 7 .2l3-3a5 5 0 0 0-7-7l-2 2m3 6a5 5 0 0 0-7-.2l-3 3a5 5 0 0 0 7 7l2-2"/> : null}
    {name === "map-mode" ? <><rect x="8" y="8" width="8" height="8" rx="2"/><path d="M8 10 4 5m12 5 4-5M8 14l-4 5m12-5 4 5"/><circle cx="3" cy="3" r="2"/><circle cx="21" cy="3" r="2"/><circle cx="3" cy="21" r="2"/><circle cx="21" cy="21" r="2"/></> : null}
    {name === "outline-mode" ? <><path d="M4 4v16m0-12h4m-4 6h4m-4 6h4"/><path d="M11 8h10m-10 6h10m-10 6h10M4 4h7"/></> : null}
    {name === "thought-child" ? <><rect x="3" y="3" width="7" height="5" rx="1.5"/><rect x="13" y="15" width="8" height="6" rx="1.5"/><path d="M6.5 8v10H13m-7 0H3m14-3v-5m-2.5 2.5h5"/></> : null}
    {name === "thought-sibling" ? <><rect x="10" y="3" width="10" height="6" rx="1.5"/><rect x="10" y="15" width="10" height="6" rx="1.5"/><path d="M3 6h7m-4 0v12h4m5-3v-4m-2 2h4"/></> : null}
    {name === "thought-affair" ? <><rect x="2" y="4" width="8" height="15" rx="2"/><path d="m4 8 1 1 2-2M4 13h3m7-2h8m-3-3 3 3-3 3"/><rect x="14" y="17" width="8" height="4" rx="1"/></> : null}
    {name === "thought-focus" ? <><path d="M8 2H2v6m14-6h6v6M2 16v6h6m14-6v6h-6"/><rect x="9" y="8" width="6" height="5" rx="1"/><path d="M12 13v5m-4 0h8"/></> : null}
    {name === "thought-fold" ? <><rect x="9" y="2" width="6" height="5" rx="1"/><path d="M12 7v5M5 16v-4h14v4m-14 5 3-3-3-3m14 6-3-3 3-3"/></> : null}
    {name === "thought-unlink" ? <><rect x="3" y="3" width="7" height="5" rx="1"/><rect x="14" y="16" width="7" height="5" rx="1"/><path d="M6 8v5h4m4 0h3v3m-7-6 4 6m0-6-4 6"/></> : null}
    {name === "map-pin" ? <><path d="m8 3 8 0-1 6 3 4H6l3-4-1-6ZM12 13v8"/></> : null}
    {name === "map-archive" || name === "archive" ? <><rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v13h14V8M9 12h6"/></> : null}
    {name === "save" ? <><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z"/><path d="M7 3v6h9V3M7 21v-8h10v8"/></> : null}
    {name === "download" ? <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M12 3v12m-5-5 5 5 5-5"/></> : null}
    {name === "delete" ? <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/> : null}
    {name === "copy" ? <><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></> : null}
    {name === "history" ? <><path d="M3 11a9 9 0 1 1 2.6 7M3 4v7h7M12 7v5l3 2"/></> : null}
    {name === "map-import" ? <><path d="M14 2H6v8m8-8 6 6v13H6v-5m8-14v6h6M2 13h10m-3-3 3 3-3 3"/></> : null}
    {name === "paste" ? <><rect x="8" y="3" width="8" height="4" rx="1"/><path d="M8 5H5v16h14V5h-3M8 11h8m-8 4h8m-8 3h5"/></> : null}
    {name === "export" ? <><path d="M14 2H6v8m8-8 6 6v13H6v-5m8-14v6h6M2 13h10m-7-3-3 3 3 3"/></> : null}
    {name === "map-refresh" ? <><path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/></> : null}
    {name === "map-up" ? <path d="M12 20V4m-6 6 6-6 6 6"/> : null}
    {name === "map-down" ? <path d="M12 4v16m-6-6 6 6 6-6"/> : null}
    {name === "map-back" ? <path d="m10 5-7 7 7 7M3 12h12a6 6 0 0 1 6 6"/> : null}
    {name === "map-home" ? <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/></> : null}
    {name === "edit" ? <path d="m16 3 5 5M4 20l4-1L21 6a2.1 2.1 0 0 0-3-3L5 16Z"/> : null}
    {name === "delete" ? <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6m4-6v6"/> : null}
    {name === "open" ? <path d="M7 7h10v10M7 17 17 7"/> : null}
    {name === "chevron" ? <path d="m9 18 6-6-6-6"/> : null}
    {name === "chevron-left" ? <path d="m15 18-6-6 6-6"/> : null}
    {name === "send" ? <><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></> : null}
    {name === "search" ? <><circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/></> : null}
    {name === "close" ? <path d="m6 6 12 12M6 18 18 6"/> : null}
    {name === "chevron-down" ? <path d="m6 9 6 6 6-6"/> : null}
    {name === "eye" ? <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></> : null}
    {name === "eye-off" ? <><path d="m3 3 18 18M10.6 5.1A12 12 0 0 1 12 5c6.5 0 10 7 10 7a15 15 0 0 1-3.1 3.9M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5.4-1.4M9.9 9.9a3 3 0 0 0 4.2 4.2"/></> : null}
    {name === "move" ? <path d="M12 3v18M3 12h18m-12-6 3-3 3 3m-6 12 3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3"/> : null}
    {name === "flask" ? <path d="M9 3h6M10 3v6l-5.5 9a2 2 0 0 0 1.7 3h11.6a2 2 0 0 0 1.7-3L14 9V3M8 15h8"/> : null}
    {name === "lock" ? <><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></> : null}
    {name === "team" ? <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/></> : null}
    {name === "settings" ? <><path d="M3 6h7m4 0h7M3 18h13m4 0h1"/><circle cx="12" cy="6" r="2"/><circle cx="18" cy="18" r="2"/></> : null}
    {name === "automation" ? <path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z"/> : null}
    {name === "gear" ? <><path d="m9 3-.5 2-2 1-2-.5-2 3 1.5 1.5v3L2.5 15l2 3 2-.5 2 1 .5 2h4l.5-2 2-1 2 .5 2-3-1.5-1.5v-3L20 9l-2-3-2 .5-2-1-.5-2Z"/><circle cx="11.25" cy="12" r="3"/></> : null}
    {name === "tag" ? <><path d="M20 13 11 22 2 13V2h11l9 9Z"/><circle cx="7" cy="7" r="1"/></> : null}
    {name === "spaces" ? <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></> : null}
    {name === "space-plus" ? <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M17.5 14v7M14 17.5h7"/></> : null}
    {name === "project-plus" ? <><path d="M20 10V7a2 2 0 0 0-2-2h-6l-2-2H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h7M17 13v8m-4-4h8"/></> : null}
    {name === "image" ? <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></> : null}
    {name === "attach" ? <path d="m21 11-8.5 8.5a6 6 0 0 1-8.5-8.5L12 3a4 4 0 0 1 5.7 5.7l-8 8a2 2 0 0 1-2.8-2.8l7.5-7.5"/> : null}
    {name === "file" ? <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 0v6h6M8 13h8m-8 4h6"/></> : null}
    {name === "mail" ? <><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 6 10 7L22 6"/></> : null}
    {name === "comment" ? <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/> : null}
    {name === "check" ? <path d="m5 12 4 4L19 6"/> : null}
    {name === "task" ? <><rect x="4" y="4" width="16" height="16" rx="2"/><path d="m8 12 3 3 5-6"/></> : null}
    {name === "list" ? <><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></> : null}
  </svg>;
}
