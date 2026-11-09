import type { Habit } from "./habits";
import type { Language } from "./i18n";
import copy from "./habit-auto-delete-copy.json";
import { ExperimentalIcon } from "./ExperimentalIcon";
import { momentCivilDate } from "./calendar-context";

export const habitAutoDeleteValid = (habit: Habit) => !habit.autoDeletePolicy || Number.isInteger(habit.autoDeletePolicy.count)
  && habit.autoDeletePolicy.count >= 1 && habit.autoDeletePolicy.count <= 365;

export function HabitAutoDeleteFields({ habit, language, disabled = false, onChange }: {
  habit: Habit; language: Language; disabled?: boolean; onChange: (habit: Habit) => void;
}) {
  const text = copy[language], policy = habit.autoDeletePolicy;
  const patch = (change: Partial<NonNullable<Habit["autoDeletePolicy"]>>) => {
    if (policy) onChange({ ...habit, autoDeletePolicy: { ...policy, ...change } });
  };
  return <details className="habit-editor-section habit-editor-disclosure" data-habit-editor-section="auto-delete">
    <summary><span><ExperimentalIcon name="history"/>{text.title}</span><ExperimentalIcon name="chevron-down"/></summary>
    <div className="habit-editor-disclosure-body">
      <label className="habit-switch"><span><strong>{text.enabled}</strong></span><input type="checkbox" role="switch"
        aria-label={text.enabled} checked={Boolean(policy)} disabled={disabled} onChange={event => onChange({ ...habit,
          autoDeletePolicy: event.target.checked ? { version: 1, id: crypto.randomUUID(), count: 7, unit: "days", points: "keep",
            startOn: momentCivilDate(new Date(), habit.schedule.timezone) } : null })}/><i/></label>
      {policy ? <fieldset className="habit-editor-grid habit-scoring-fields" disabled={disabled}>
        <label><span>{text.count}</span><input type="number" min="1" max="365" step="1" required
          value={policy.count || ""} onChange={event => patch({count: Number(event.target.value)})} aria-invalid={!habitAutoDeleteValid(habit)}/></label>
        <label><span>{text.unit}</span><select value={policy.unit} onChange={event => patch({unit: event.target.value as typeof policy.unit})}>
          <option value="days">{text.days}</option><option value="weeks">{text.weeks}</option><option value="months">{text.months}</option>
        </select></label>
        <label className="wide"><span>{text.points}</span><select value={policy.points} onChange={event => patch({points: event.target.value as typeof policy.points})}>
          <option value="keep">{text.keep}</option><option value="remove">{text.remove}</option>
        </select></label>
        {!habitAutoDeleteValid(habit) ? <p className="wide" role="alert">{text.range}</p> : null}
      </fieldset> : null}
      <p>{text.hint}</p>
    </div>
  </details>;
}
