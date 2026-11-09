type CalendarModeIconProps = {
  mode: "profane" | "sacred" | "lunar";
  size?: number;
  className?: string;
};

/** Calendar identity shared by the web selector and Gregorian date labels. */
export function CalendarModeIcon({ mode, size = 24, className = "" }: CalendarModeIconProps) {
  return (
    <svg className={`calendar-mode-icon calendar-mode-icon-${mode} ${className}`} width={size} height={size}
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {mode === "profane" ? <>
        <g className="calendar-key calendar-key-left"><circle cx="7" cy="5" r="2.5" /><path d="m8.4 7.1 9.1 13M14.9 16.4l2.5-1.7M16.5 18.7l2.5-1.7" /></g>
        <g className="calendar-key calendar-key-right"><circle cx="17" cy="5" r="2.5" /><path d="m15.6 7.1-9.1 13M9.1 16.4l-2.5-1.7M7.5 18.7 5 17" /></g>
      </> : mode === "sacred" ? <>
        <g className="calendar-sun-rays"><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></g>
        <circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      </> : <path className="calendar-moon-disc" d="M19.79 15.5A8 8 0 0 1 8.5 4.21 8 8 0 1 0 19.79 15.5Z" />}
    </svg>
  );
}
