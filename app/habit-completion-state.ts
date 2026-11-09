import type { HabitCompletion, HabitWorkspace } from "./habits";

/** Select the current snapshot while leaving the original rows intact for audit and export. */
export function currentHabitCompletions(workspace: Pick<HabitWorkspace, "habitCompletions">, habitId: string) {
  const order = (a: HabitCompletion, b: HabitCompletion) => b.version - a.version
    || Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || String(b.id ?? "").localeCompare(String(a.id ?? ""));
  const days = new Map<string, HabitCompletion>();
  for (const row of [...workspace.habitCompletions].filter(row => row.habitId === habitId).sort(order)) if (!days.has(row.date)) days.set(row.date, row);
  return days;
}
