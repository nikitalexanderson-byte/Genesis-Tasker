import { useRef, useState } from "react";
import type { Habit } from "./habits";
import { habitRuleForDate, formatHabitValue, type HabitRuleVersion } from "./habit-measurement";
import { habitRuleFrontier, habitRuleState } from "./habit-rule-history";
import { calendarModeForRecurrence } from "./task-recurrence";
import { formatCalendarDateValue, type CalendarMode } from "./calendar-data";
import { formatTimeValue, type TimeFormat } from "./time-format";
import { translateText, type Language } from "./i18n";
import "./habit-rule-history.css";

const patternCopy = {
  daily: "Ежедневно", weekdays: "Дни недели", monthly: "Дни месяца", yearly: "Ежегодно",
  "pyata-days": "Дни пяты", "month-days": "Дни месяца", "lunar-days": "Дни месяца",
  "lunar-decades": "Декады", "lunar-decade-days": "Дни внутри декад", "lunar-phases": "Фазы Луны", "lunar-yearly": "Ежегодно",
} as const;

export function HabitRuleDefinition({ rule, language, timeFormat }: {
  rule: HabitRuleVersion; language: Language; timeFormat: TimeFormat;
}) {
  const t = (text: string) => translateText(text, language), goal = rule.periodGoal, measurement = rule.measurement;
  const recurrence = rule.schedule.recurrence, mode = calendarModeForRecurrence(recurrence.mode);
  const context = recurrence.calendarContext;
  const calendarName = (calendar: CalendarMode) => t(calendar === "profane" ? "Григорианский" : calendar === "lunar" ? "Лунный" : "Сакральный");
  const number = (value: number) => new Intl.NumberFormat(language).format(value);
  const amount = (value: number) => `${formatHabitValue(value, language)} ${measurement?.kind === "duration" ? t("мин") : measurement?.unit ?? ""}`;
  const recorded = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: rule.schedule.timezone }).formatToParts(new Date(rule.recordedAt));
  const part = (type: string) => recorded.find(value => value.type === type)?.value ?? "";
  return <div className="habit-rule-definition">
    <p><strong>{t(goal?.period === "week" ? "За неделю" : goal?.period === "month" ? "За месяц" : "За день")}: </strong>
      {goal ? `${goal.metric === "sum" ? amount(goal.target) : number(goal.target)} · ${t(goal.metric === "days" ? "Разные дни" : goal.metric === "entries" ? "Отдельные выполнения" : "Сумма значений")}`
        : measurement ? amount(measurement.target) : t("Выполнено / не выполнено")}</p>
    {goal ? <p>{t("Календарь цели")}: {calendarName(goal.calendar)} · {goal.context.timeZone}</p> : null}
    <p>{calendarName(mode)} · {rule.schedule.timezone} · {recurrence.enabled ? t(patternCopy[recurrence.pattern]) : t("Без повторения")}
      {recurrence.enabled ? ` · ${t("Интервал")}: ${number(recurrence.interval)}` : ""}</p>
    {recurrence.enabled && recurrence.pattern !== "daily" ? <p>{t("Дни")}: {recurrence.days.map(day => recurrence.pattern === "weekdays"
      ? new Intl.DateTimeFormat(language, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 4 + day))) : number(day)).join(", ")}
      {recurrence.months.length ? ` · ${t("Месяцы")}: ${recurrence.months.map(number).join(", ")}` : ""}
      {recurrence.pyatas.length ? ` · ${t(recurrence.mode === "lunar" ? "Декады" : "Пяты")}: ${recurrence.pyatas.map(number).join(", ")}` : ""}</p> : null}
    <p>{t("Начало")}: {formatCalendarDateValue(rule.schedule.startDate, mode, true, context)}
      {rule.schedule.endDate ? ` · ${t("Конец")}: ${formatCalendarDateValue(rule.schedule.endDate, mode, true, context)}` : ""}</p>
    <p>{t("Вступает в силу")}: <time dateTime={rule.effectiveDate}>{formatCalendarDateValue(rule.effectiveDate, mode, true, context)}</time></p>
    {rule.recordedAt !== "1970-01-01T00:00:00.000Z" ? <p>{t("Записано")}: <time dateTime={rule.recordedAt}>
      {formatCalendarDateValue(`${part("year")}-${part("month")}-${part("day")}`, mode, true, context)} · {formatTimeValue(`${part("hour")}:${part("minute")}`, timeFormat)}</time></p> : null}
  </div>;
}

export function HabitRuleHistory({ habit, date, language, timeFormat, saving, onChoose }: {
  habit: Habit; date: string; language: Language; timeFormat: TimeFormat; saving: boolean;
  onChoose: (chosenId: string, heads: string[], operationId: string) => Promise<void>;
}) {
  const t = (text: string) => translateText(text, language);
  const history = habit.ruleHistory?.length ? habit.ruleHistory : [habitRuleForDate(habit, habit.createdDate)];
  const frontier = habitRuleFrontier(habit), conflict = frontier.length > 1, current = habitRuleState(habit, date);
  const [expanded, setExpanded] = useState(conflict), [limit, setLimit] = useState(20);
  const operation = useRef<{ choice: string; heads: string; id: string } | null>(null);
  const visible = new Set([...history.slice(-limit).map(rule => rule.id), ...frontier.map(rule => rule.id)]);
  return <fieldset className="habit-editor-section habit-rule-history wide">
    <legend>{t("История целей и расписаний")}</legend>
    {conflict ? <div role="alert"><p>{t("Правила изменены на нескольких устройствах. Выберите действующий вариант.")}</p>
      <p>{t("До выбора спорные дни нейтральны; новые записи и награды приостановлены.")}</p></div> : null}
    <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary>{t("Показать версии")} · {history.length}</summary>
      <ol>{[...history].reverse().filter(rule => visible.has(rule.id)).map(rule => <li key={rule.id}>
        <strong>{t(conflict && frontier.some(head => head.id === rule.id) ? "Конфликт правил" : rule.selectedRuleId ? "Выбор сохранён"
          : rule.effectiveDate > date ? "Запланировано" : current.appliedVersion.id === rule.id ? "Действует" : "Предыдущее правило")}</strong>
        <HabitRuleDefinition rule={rule} language={language} timeFormat={timeFormat}/>
        {conflict && frontier.some(head => head.id === rule.id) ? <button type="button" className="secondary-button" disabled={saving}
          onClick={() => {
            const heads = frontier.map(head => head.id).sort(), key = JSON.stringify(heads);
            if (operation.current?.choice !== rule.id || operation.current?.heads !== key)
              operation.current = { choice: rule.id, heads: key, id: `rule-choice:${crypto.randomUUID()}` };
            void onChoose(rule.id, heads, operation.current.id);
          }}>{t("Выбрать это правило")}</button> : null}
      </li>)}</ol>
      {history.length > visible.size ? <button type="button" className="secondary-button" onClick={() => setLimit(limit + 20)}>{t("Ещё версии")}</button> : null}
    </details>
    <p>{t("Выбор сохраняет альтернативы и прежние ID записей. Прошлые награды не начисляются повторно.")}</p>
    {conflict ? <p>{t("Выбор меняет только правило. Остальные несохранённые правки не применяются.")}</p> : null}
  </fieldset>;
}
