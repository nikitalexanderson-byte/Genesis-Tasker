export type TimeFormat = "24h" | "12h";

export function normalizeTimeFormat(value: unknown): TimeFormat {
  return value === "12h" ? "12h" : "24h";
}

export function twelveHourParts(hour: number) {
  const normalizedHour = ((hour % 24) + 24) % 24;
  return {
    hour: normalizedHour % 12 || 12,
    period: normalizedHour >= 12 ? "PM" as const : "AM" as const,
  };
}

export function hourFromTwelveHour(hour: number, period: "AM" | "PM") {
  const normalizedHour = ((hour % 12) + 12) % 12;
  return normalizedHour + (period === "PM" ? 12 : 0);
}

export function formatTimeValue(value: string, timeFormat: TimeFormat, includeSeconds = false) {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return value;
  const hour = Number(match[1]);
  const minute = match[2];
  const second = match[3] ?? "00";
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return value;
  const suffix = includeSeconds ? `:${second}` : "";
  if (timeFormat === "24h") return `${String(hour).padStart(2, "0")}:${minute}${suffix}`;
  const twelveHour = twelveHourParts(hour);
  return `${String(twelveHour.hour).padStart(2, "0")}:${minute}${suffix} ${twelveHour.period}`;
}

export function formatClockTime(date: Date, timeFormat: TimeFormat) {
  return formatTimeValue(
    `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`,
    timeFormat,
    true,
  );
}
