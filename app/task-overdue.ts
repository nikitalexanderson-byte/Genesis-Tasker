type DeadlineTask = { done: boolean; dueDate: string; endDate?: string; time?: string; zoneId?: string };

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Status is calculated from the device clock, without completing or rewriting the task. */
export function isTaskOverdue(task: DeadlineTask, now = new Date(), occurrenceOrDeadline?: string): boolean {
  if (task.done || !Number.isFinite(now.getTime())) return false;
  const deadline = occurrenceOrDeadline ?? (task.endDate && task.endDate >= task.dueDate ? task.endDate : task.dueDate);
  if (!validDate(deadline)) return false;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en", { timeZone: task.zoneId, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat("en", { year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
  }
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === name)?.value ?? "";
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  if (date !== deadline) return date > deadline;
  if (!task.time || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(task.time)) return false;
  return `${part("hour")}:${part("minute")}:${part("second")}` >= (task.time.length === 5 ? `${task.time}:00` : task.time);
}
