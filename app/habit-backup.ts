import { isCivilDate } from "./calendar-context.ts";
import { habitRuleForDate, habitMeasurementProgress } from "./habit-measurement.ts";
import { habitHistoryState } from "./habit-history.ts";
import { habitTimerEpoch } from "./habit-timer.ts";
import { EMPTY_HABIT_WORKSPACE, normalizeHabitWorkspace, type HabitWorkspace } from "./habits.ts";

const arrayKeys = ["habits", "habitCompletions", "habitMeasurements", "habitTimers", "habitHistory", "dailyGoalRecords",
  "quests", "achievementUnlocks", "rewardTransactions", "streakFreezeTransactions", "hiddenDefaultTemplates"] as const;
const keys = [...arrayKeys, "trackerSchemaVersion", "habitTimerEpoch", "userProgress", "habitSettings"] as const;
export type HabitBackupState = Pick<HabitWorkspace, typeof keys[number]>;
export type HabitBackup = { format: "genesis.habits.backup"; version: 1; createdAt: string; checksum: string; data: HabitBackupState };
const maximumBytes = 64 * 1024 * 1024;
const fail = (code = "HABIT_BACKUP_INVALID"): never => { throw new RangeError(code); };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const instant = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
const identifier = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 1024;
const rowIdentity = (key: typeof arrayKeys[number], row: unknown): unknown => key === "hiddenDefaultTemplates" ? row : !object(row) ? null
  : key === "dailyGoalRecords" ? row.date : key === "achievementUnlocks" ? row.achievementId
    : key === "rewardTransactions" || key === "streakFreezeTransactions" ? row.idempotencyKey : row.id;

/** Stable JSON, also rejecting prototype keys before untrusted content can reach object merges. */
export function canonicalHabitBackup(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalHabitBackup).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => {
    if (["__proto__", "constructor", "prototype"].includes(key)) return fail();
    return `${JSON.stringify(key)}:${canonicalHabitBackup(value[key])}`;
  }).join(",")}}`;
  if (typeof value === "number" && !Number.isFinite(value) || value === undefined) return fail();
  return JSON.stringify(value);
}
const clone = <T,>(value: T): T => JSON.parse(canonicalHabitBackup(value)) as T;
async function checksum(data: HabitBackupState) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalHabitBackup(data)));
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, "0")).join("");
}

/** A tracking backup never contains tasks, account credentials or independent sleep/mood/abstinence modules. */
export async function createHabitBackup(workspace: HabitWorkspace, createdAt = new Date().toISOString()): Promise<HabitBackup> {
  if (!instant(createdAt)) return fail();
  const data = clone(Object.fromEntries(keys.map(key => [key, workspace[key]]))) as HabitBackupState;
  // Google IDs are account-specific. Importing a file must not modify an unrelated Google task/event.
  data.habits = data.habits.map(habit => ({ ...habit, reminder: { ...habit.reminder,
    syncToGoogleTasks: false, showInGoogleCalendar: false, googleTaskId: null, googleEventId: null } }));
  return { format: "genesis.habits.backup", version: 1, createdAt, checksum: await checksum(data), data };
}

function validateState(input: unknown): HabitBackupState {
  if (!object(input) || keys.some(key => !(key in input)) || Object.keys(input).some(key => !keys.includes(key as typeof keys[number]))) return fail();
  if (input.trackerSchemaVersion !== 16 || typeof input.habitTimerEpoch !== "string" || !object(input.userProgress) || !object(input.habitSettings)) return fail();
  for (const key of arrayKeys) if (!Array.isArray(input[key])) return fail();
  const data = input as unknown as HabitBackupState;
  habitTimerEpoch(data.habitTimerEpoch);
  for (const key of arrayKeys) {
    if (key === "hiddenDefaultTemplates") { if (data[key].some(id => !identifier(id))) return fail(); continue; }
    const ids = new Set<string>();
    for (const row of data[key]) {
      if (!object(row)) return fail();
      const id = rowIdentity(key, row);
      if (!identifier(id) || ids.has(id)) return fail();
      ids.add(id);
    }
  }
  const habits = new Map(data.habits.map(habit => [habit.id, habit]));
  for (const habit of data.habits) if (typeof habit.title !== "string" || !habit.title.trim() || !isCivilDate(habit.createdDate)
    || !instant(habit.createdAt) || !instant(habit.updatedAt) || !object(habit.schedule) || !object(habit.reminder)
    || habit.reminder.googleTaskId !== null || habit.reminder.googleEventId !== null || habit.reminder.syncToGoogleTasks || habit.reminder.showInGoogleCalendar) return fail();
  for (const key of ["habitCompletions", "habitMeasurements", "habitHistory"] as const) for (const row of data[key]) {
    const habit = habits.get(row.habitId);
    if (!habit || !isCivilDate(row.date) || row.date < habit.createdDate || !instant(row.createdAt)) return fail();
  }
  for (const row of data.habitCompletions) if (!instant(row.updatedAt) || typeof row.completed !== "boolean"
    || !Number.isSafeInteger(row.xpAwarded) || row.xpAwarded < 0 || row.xpAwarded > 20 || typeof row.note !== "string") return fail();
  for (const row of data.habitTimers) if (!habits.has(row.habitId) || !instant(row.at)) return fail();
  for (const row of data.quests) if (row.habitId !== null && !habits.has(row.habitId)) return fail();
  for (const row of data.rewardTransactions) if (!Number.isSafeInteger(row.amount) || !instant(row.createdAt)) return fail();
  // Reuse the actual domain parsers, but never return their reward-producing projections as imported data.
  const normalized = normalizeHabitWorkspace({ ...EMPTY_HABIT_WORKSPACE, ...clone(data) });
  for (const key of arrayKeys) {
    const retained = new Set(normalized[key].map(row => rowIdentity(key, row)));
    if (data[key].some(row => !retained.has(rowIdentity(key, row)))) return fail();
  }
  for (const event of data.habitMeasurements) habitMeasurementProgress(habits.get(event.habitId)!, event.date, data.habitMeasurements);
  for (const event of data.habitHistory) if (habitHistoryState(data.habitHistory, event.habitId, event.date).rows.length === 0) return fail();
  return clone(data);
}

/** Parsing validates the whole file before a preview or any write is allowed. */
export async function parseHabitBackup(text: string): Promise<HabitBackup> {
  if (new TextEncoder().encode(text).length > maximumBytes) return fail("HABIT_BACKUP_TOO_LARGE");
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return fail(); }
  canonicalHabitBackup(raw);
  if (!object(raw) || raw.format !== "genesis.habits.backup") return fail();
  if (raw.version !== 1) return fail("HABIT_BACKUP_VERSION");
  if (!instant(raw.createdAt) || typeof raw.checksum !== "string" || !/^[a-f0-9]{64}$/.test(raw.checksum)) return fail();
  const data = validateState(raw.data);
  if (await checksum(data) !== raw.checksum) return fail("HABIT_BACKUP_INTEGRITY");
  return { format: "genesis.habits.backup", version: 1, createdAt: raw.createdAt, checksum: raw.checksum, data };
}

export const HABIT_HISTORY_CSV_COLUMNS = {
  record_type: "Тип записи", habit_id: "Идентификатор привычки", habit_name: "Название привычки",
  record_id: "Идентификатор записи", entry_id: "Идентификатор результата", date: "Дата выполнения", value: "Значение", value_thousandths: "Значение в тысячных",
  unit: "Единица", completed: "Выполнено", quality: "Качество", note: "Заметка", created_at: "Время внесения",
  updated_at: "Время изменения", source: "Источник", historical: "Историческая корректировка", replaces: "Предыдущие записи",
  rule_id: "Версия правила", target_thousandths: "Дневная цель в тысячных", period: "Период цели", period_metric: "Метрика цели",
  period_target: "Цель периода", period_target_thousandths: "Цель периода в тысячных", calendar: "Календарь", time_zone: "Часовой пояс", year_start: "Начало года",
  quality_confirmed_at: "Время подтверждения качества", completed_times: "Время выполнений", calendar_version: "Версия календаря", skipped_at: "Время осознанного пропуска",
} as const;

function decimal(value: number | null) {
  return value === null ? "" : `${Math.trunc(value / 1000)}${value % 1000 ? `.${String(value % 1000).padStart(3, "0").replace(/0+$/, "")}` : ""}`;
}
function csvCell(value: unknown) {
  let text = value == null ? "" : String(value);
  let first = 0;
  while (first < text.length && (text.charCodeAt(first) <= 32 || /\s/u.test(text[first]))) first++;
  if (typeof value === "string" && /^[=+@-]/u.test(text.slice(first))) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

/** Every stored revision in the requested range is exported; the dashboard's visible month is irrelevant. */
export function buildHabitHistoryCsv(workspace: HabitWorkspace, options: {
  start?: string; end?: string; habitId?: string; label?: (source: string) => string;
} = {}) {
  if (options.start && !isCivilDate(options.start) || options.end && !isCivilDate(options.end)
    || options.start && options.end && options.start > options.end) return fail("HABIT_EXPORT_RANGE_INVALID");
  const output: Record<string, unknown>[] = [], habits = new Map(workspace.habits.map(habit => [habit.id, habit]));
  const accepts = (habitId: string, date: string) => (!options.habitId || options.habitId === habitId)
    && (!options.start || date >= options.start) && (!options.end || date <= options.end);
  const common = (habitId: string, date: string, ruleId?: string) => {
    const habit = habits.get(habitId); if (!habit) return fail();
    const currentRule = habitRuleForDate(habit, date);
    const rule = ruleId ? habit.ruleHistory?.find(row => row.id === ruleId) ?? (currentRule.id === ruleId ? currentRule : fail()) : currentRule;
    const goal = rule.periodGoal;
    return { habit_id: habit.id, habit_name: habit.title, date, rule_id: rule.id, unit: rule.measurement?.unit ?? "",
      target_thousandths: rule.measurement?.target ?? "", period: goal?.period ?? "day", period_metric: goal?.metric ?? "days",
      period_target: goal?.metric === "sum" ? decimal(goal.target) : goal?.target ?? "",
      period_target_thousandths: goal?.metric === "sum" ? goal.target : "", calendar: goal?.calendar ?? rule.schedule.recurrence.mode,
      time_zone: goal?.context.timeZone ?? rule.schedule.timezone,
      year_start: goal?.context.gregorianYearStart ?? rule.schedule.recurrence.calendarContext?.gregorianYearStart ?? "january",
      calendar_version: goal?.context.version ?? rule.schedule.recurrence.calendarContext?.version ?? "" };
  };
  for (const row of workspace.habitCompletions) if (accepts(row.habitId, row.date)) output.push({ ...common(row.habitId, row.date),
    record_type: "completion", record_id: row.id, completed: row.completed, quality: row.qualityValue, note: row.note,
    created_at: row.createdAt, updated_at: row.updatedAt, source: "snapshot", quality_confirmed_at: row.qualityConfirmedAt,
    completed_times: JSON.stringify(row.completedTimes ?? []), skipped_at: row.skippedAt,
    historical: workspace.habitHistory.some(edit => edit.habitId === row.habitId && edit.date === row.date && edit.source !== "decision") });
  for (const row of workspace.habitMeasurements) if (accepts(row.habitId, row.date)) output.push({ ...common(row.habitId, row.date, row.ruleId),
    record_type: "measurement", record_id: row.id, rule_id: row.ruleId, value: decimal(row.value), value_thousandths: row.value,
    entry_id: row.entryId, note: row.note, source: row.source, historical: row.historical, created_at: row.createdAt, updated_at: row.createdAt, replaces: JSON.stringify(row.replaces) });
  for (const row of workspace.habitHistory) if (accepts(row.habitId, row.date)) output.push({ ...common(row.habitId, row.date, row.ruleId),
    record_type: "history-edit", record_id: row.id, rule_id: row.ruleId, completed: row.value.completed,
    quality: row.value.qualityValue, note: row.value.note, source: row.source, historical: row.source !== "decision", skipped_at: row.value.skippedAt,
    quality_confirmed_at: row.value.qualityConfirmedAt, completed_times: JSON.stringify(row.value.completedTimes),
    created_at: row.createdAt, updated_at: row.updatedAt, replaces: JSON.stringify(row.replaces) });
  output.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.habit_id).localeCompare(String(b.habit_id))
    || String(a.created_at).localeCompare(String(b.created_at)) || String(a.record_id).localeCompare(String(b.record_id)));
  const columns = Object.keys(HABIT_HISTORY_CSV_COLUMNS) as (keyof typeof HABIT_HISTORY_CSV_COLUMNS)[];
  const heading = columns.map(key => csvCell(`${key} [${(options.label ?? (text => text))(HABIT_HISTORY_CSV_COLUMNS[key])}]`)).join(",");
  return `\uFEFF${[heading, ...output.map(row => columns.map(key => csvCell(row[key])).join(","))].join("\r\n")}\r\n`;
}
