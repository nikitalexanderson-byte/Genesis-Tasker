const weekdayPaths = [
  "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16M12 11v2",
  "M9 4a8 8 0 1 1 0 16 9 9 0 0 0 0-16Z",
  "M15 9 21 3m-6 0h6v6M9 8a6 6 0 1 0 0 12 6 6 0 0 0 0-12",
  "M8 3a4 4 0 0 0 8 0M12 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8m0 8v7m-4-3h8",
  "M5 5c6-2 8 5 2 9h12M15 4v17",
  "M12 3a6 6 0 1 0 0 12 6 6 0 0 0 0-12m0 12v7m-4-3h8",
  "M8 3v17M5 6h7M8 12c7-7 11-1 7 4-3 4-1 5 1 5",
] as const;

export function WeekdaySymbol({ weekday, size = 24 }: { weekday: number; size?: number }) {
  return <svg className="weekday-symbol" width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" focusable="false"><path d={weekdayPaths[weekday] ?? weekdayPaths[0]} /></svg>;
}
