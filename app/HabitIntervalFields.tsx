import { useContext, useId } from "react";
import type { Habit } from "./habits";
import { DEFAULT_HABIT_INTERVAL, habitIntervalTimes, normalizeHabitInterval } from "./habit-interval";
import { TimeClockPicker, TimeClockFormatContext } from "./TimeClockPicker";
import { formatTimeValue } from "./time-format";
import "./habit-interval.css";

export function HabitIntervalFields({ habit, onChange }: { habit: Habit; onChange: (habit: Habit) => void }) {
  const fieldId = useId();
  const timeFormat = useContext(TimeClockFormatContext);
  const schedule = habit.intervalSchedule;
  const update = (patch: Partial<NonNullable<typeof schedule>>) => onChange({ ...habit, intervalSchedule: { ...schedule!, ...patch } });
  const times = habitIntervalTimes(schedule);
  return <div className="habit-interval-fields">
    <label className="habit-no-strict-time"><input type="checkbox" checked={Boolean(schedule)} onChange={event => onChange({ ...habit,
      intervalSchedule: event.target.checked ? { ...DEFAULT_HABIT_INTERVAL } : null,
      ...(event.target.checked ? { preferredTime: "", reminder: { ...habit.reminder, timing: "habit" } } : {}),
    })}/><span>Повторять в течение дня</span></label>
    {schedule ? <>
      <div className="habit-editor-grid">
        <label><span>Интервал, минут</span><input type="number" min={1} max={1440} step={1} required value={schedule.intervalMinutes || ""} onChange={event => update({ intervalMinutes: Number(event.target.value) })}/></label>
        <label htmlFor={`${fieldId}-start`}><span>Начало промежутка</span><TimeClockPicker id={`${fieldId}-start`} value={schedule.startTime} onChange={startTime => update({ startTime })} ariaLabel="Начало промежутка"/></label>
        <label htmlFor={`${fieldId}-end`}><span>Конец промежутка</span><TimeClockPicker id={`${fieldId}-end`} value={schedule.endTime} onChange={endTime => update({ endTime })} ariaLabel="Конец промежутка"/></label>
        {!habit.measurement ? <label className="wide"><span>Способ отметки</span><select value={schedule.completionMode} onChange={event => update({ completionMode: event.target.value === "day" ? "day" : "each" })}>
          <option value="each">Каждое повторение отдельно</option><option value="day">Одна отметка за день</option>
        </select></label> : null}
      </div>
      {!normalizeHabitInterval(schedule) ? <p role="alert">Укажите интервал от 1 до 1440 минут и время окончания не раньше начала.</p> : <div className="habit-interval-preview"><span>Запланированные времена</span><p>{times.slice(0, 6).map(time => formatTimeValue(time, timeFormat)).join(" · ")}{times.length > 6 ? ` · … · ${formatTimeValue(times.at(-1)!, timeFormat)}` : ""}</p><small><span>Повторений за день:</span> {times.length}</small></div>}
      <small>{habit.measurement ? "Повторы задают напоминания; выполнение определяется суммой записей." : schedule.completionMode === "each" ? "Все повторения завершены — привычка выполнена за день." : "Одна отметка подтверждает выполнение привычки за весь день."}</small>
    </> : null}
  </div>;
}
