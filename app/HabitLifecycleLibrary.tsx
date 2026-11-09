import { DialogCloseButton } from './DialogCloseButton';
import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { habitLifecycleState, type HabitLifecycleAction, type HabitLifecycleCommand, type HabitLifecycleStatus } from "./habit-lifecycle";
import { habitCompletionCount } from "./habit-laurel-retention";
import { habitEconomyHistory } from "./habit-history";
import { habitDisplayText } from "./habit-display-text";
import { translateText, type Language } from "./i18n";
import { useDialogAccessibility } from "./use-dialog-accessibility";
import { ExperimentalIcon } from "./ExperimentalIcon";
import { IconActionButton } from "./IconActionButton";
import { HabitLibraryActions } from "./HabitLibraryActions";
import type { Habit, HabitWorkspace } from "./habits";
import "./habit-lifecycle.css";
import { habitPracticeProgress, practiceLibraryStatus } from "./habit-practice-goal";
import { practiceCopy } from "./habit-practice-copy";
import { habitDateKey } from "./habits";

const labels: Record<HabitLifecycleStatus, string> = { active: "Активные", paused: "Пауза", archived: "Архив", deleted: "Удалённые" };
type Props = { workspace: HabitWorkspace; language: Language; requestedDelete?: string; onAdd: () => void; onEdit: (habit: Habit) => void;
  onKey: (habit: Habit) => void; details: (habit: Habit) => ReactNode;
  onCommand?: (command: HabitLifecycleCommand) => Promise<void> };

export function HabitLifecycleLibrary({ workspace, language, requestedDelete, onAdd, onEdit, onKey, details, onCommand }: Props) {
  const t = (text: string) => translateText(text, language), id = useId();
  const requested = workspace.habits.find(habit => habit.id === requestedDelete);
  const [filter, setFilter] = useState<HabitLifecycleStatus | "completed" | "missed">(() => requested ? practiceLibraryStatus(requested, workspace.habitCompletions, habitDateKey(new Date())) : "active");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [pending, setPending] = useState<HabitLifecycleCommand | null>(() => requested && habitLifecycleState(requested).status !== "deleted" ? {
    id: `habit-lifecycle:${crypto.randomUUID()}`, habitId: requested.id, action: "delete", at: new Date().toISOString(),
    heads: habitLifecycleState(requested).heads.map(row => row.id),
  } : null);
  const close = () => { if (!busy) setPending(null); };
  const dialogRef = useDialogAccessibility<HTMLElement>(close, Boolean(pending));
  const economy = habitEconomyHistory(workspace);
  const pendingHabit = workspace.habits.find(habit => habit.id === pending?.habitId);
  const finiteCopy = practiceCopy(language);
  const filterLabels = { ...labels, completed: finiteCopy.completedFilter, missed: finiteCopy.missedFilter };
  const retained = pendingHabit && habitCompletionCount(economy.habitCompletions, pendingHabit.id) >= 50;
  const counts = Object.fromEntries(Object.keys(filterLabels).map(status => [status,
    workspace.habits.filter(habit => practiceLibraryStatus(habit,workspace.habitCompletions,habitDateKey(new Date())) === status).length]));
  const rows = workspace.habits.filter(habit => practiceLibraryStatus(habit,workspace.habitCompletions,habitDateKey(new Date())) === filter)
    .sort((a, b) => Number(b.isKeyHabit) - Number(a.isKeyHabit) || b.priority - a.priority || a.title.localeCompare(b.title));
  const save = async (command: HabitLifecycleCommand) => {
    if (!onCommand || busy) return;
    setBusy(true); setMessage("");
    try { await onCommand(command); setPending(null); setMessage("Состояние сохранено."); }
    catch (error) {
      if (error instanceof Error && error.message === "HABIT_LIFECYCLE_EDIT_CONFLICT") {
        setPending(null); setMessage("Есть изменения с другого устройства. Выберите состояние.");
      } else if (error instanceof Error && error.message === "HABIT_LIFECYCLE_CLOCK_CONFLICT") setMessage("Не удалось сохранить. Проверьте дату и время устройства и повторите.");
      else setMessage("Не удалось сохранить. Проверьте синхронизацию и повторите.");
    }
    finally { setBusy(false); }
  };
  const act = (habit: Habit, action: HabitLifecycleAction, selectedId?: string) => {
    const command: HabitLifecycleCommand = { id: `habit-lifecycle:${crypto.randomUUID()}`, habitId: habit.id,
      at: new Date().toISOString(), action, heads: habitLifecycleState(habit).heads.map(row => row.id), ...(selectedId ? { selectedId } : {}) };
    if (action === "delete") { setMessage(""); setPending(command); } else void save(command);
  };
  return <section className="habit-library habit-lifecycle-library" aria-labelledby={`${id}-title`}>
    <header><h2 id={`${id}-title`}>{t("Ядро привычек")}</h2><IconActionButton icon="plus" label={t("Добавить")} onClick={onAdd}/></header>
    <p className="habit-library-rule">{t("Можно изменять все настройки, кроме баллов и шкалы качества.")}</p>
    <p className="habit-library-rule">{t("Пауза выключает расписание и напоминания. Архив сохраняет историю и награды.")}</p>
    <label className="habit-lifecycle-filter-mobile"><span>{t("Состояние привычки")}</span>
      <select value={filter} onChange={event => setFilter(event.target.value as keyof typeof filterLabels)}>
        {(Object.keys(filterLabels) as (keyof typeof filterLabels)[]).map(status => <option key={status} value={status}>{t(filterLabels[status])} · {counts[status]}</option>)}
      </select></label>
    <div className="habit-lifecycle-filters" role="group" aria-label={t("Состояние привычки")}>
      {(Object.keys(filterLabels) as (keyof typeof filterLabels)[]).map(status => <button type="button" key={status}
        aria-pressed={filter === status} onClick={() => setFilter(status)}><ExperimentalIcon name={status === "active" ? "play" : status === "paused" ? "pause" : status === "archived" ? "archive" : status === "completed" ? "check" : status === "missed" ? "calendar" : "delete"}/>{t(filterLabels[status])} <span>{new Intl.NumberFormat(language).format(counts[status])}</span></button>)}
    </div>
    <p className="habit-lifecycle-message" role="status">{message ? t(message) : ""}</p>
    {rows.length ? <div className="habit-lifecycle-rows">{rows.map(habit => {
      const state = habitLifecycleState(habit);
      const practice = habitPracticeProgress(habit, workspace.habitCompletions, habitDateKey(new Date()));
      return <article key={habit.id} className={`${!habit.active ? "paused" : ""}${habit.isKeyHabit ? " key-habit" : ""}`}
        data-habit-id={habit.id} style={{ "--habit-color": habit.color } as CSSProperties}>
        <i /><div><span><b className="habit-emoji" aria-hidden="true">{habit.emoji}</b><strong data-no-translate>{habitDisplayText(habit, language).title}</strong>
          {habit.isKeyHabit ? <mark>{t("Главная")}</mark> : null}<em>{t("Приоритет")} {habit.priority}</em></span>
          <small>{details(habit)} · {practice ? <>{practice.status === "completed" ? finiteCopy.completed : practice.status === "missed" ? finiteCopy.missed : `${finiteCopy.progress} ${practice.dates.length}/${practice.goal.requiredCompletions}`} · {finiteCopy.deadline}: <time dateTime={practice.deadline}>{practice.deadline}</time></>
            : <>{t("Выполнено дней")} {new Intl.NumberFormat(language).format(habitCompletionCount(economy.habitCompletions, habit.id))} · {finiteCopy.retention}</>}</small></div>
          {state.conflict ? <div className="habit-lifecycle-conflict" aria-busy={busy}><p>{t("Есть изменения с другого устройства. Выберите состояние.")}</p>
            {state.heads.map(head => <button type="button" key={head.id} disabled={busy || !onCommand}
              onClick={() => act(habit, "resolve", head.id)}>{t(labels[head.status])} · <time>{new Date(head.at).toLocaleString(language)}</time></button>)}</div> :
            <HabitLibraryActions isKeyHabit={habit.isKeyHabit} active={habit.active} language={language} disabled={busy} stateDisabled={!onCommand}
              onKey={filter === "active" || filter === "paused" ? () => onKey(habit) : undefined}
              onEdit={filter !== "archived" && filter !== "deleted" ? () => onEdit(habit) : undefined}
              onToggleActive={filter === "active" || filter === "paused" ? () => act(habit, habit.active ? "pause" : "resume") : undefined}
              onArchive={filter !== "archived" && filter !== "deleted" ? () => act(habit, "archive") : undefined}
              onRestore={filter === "archived" || filter === "deleted" ? () => act(habit, "restore") : undefined}
              onDelete={filter !== "deleted" ? () => act(habit, "delete") : undefined}/>
          }
      </article>;
    })}</div> : <div className="habit-library-empty"><p>{t("Ничего не найдено")}</p></div>}
    {filter === "archived" || filter === "deleted" ? <p>{t("Восстановление вернёт привычку на паузу. Награды и прежний штраф не изменятся.")}</p> : null}
    {pending && pendingHabit ? <div className="modal-backdrop habit-editor-backdrop">
      <section ref={dialogRef} className="habit-editor habit-lifecycle-confirm" data-exp-ui="dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-delete`} tabIndex={-1}>
        <DialogCloseButton type="button" disabled={busy} onClick={close} aria-label={t("Закрыть")} />
        <h2 id={`${id}-delete`}>{t("Удалить привычку")}</h2><strong data-no-translate>{habitDisplayText(pendingHabit, language).title}</strong>
        <p>{habitPracticeProgress(pendingHabit, workspace.habitCompletions, habitDateKey(new Date())) ? finiteCopy.deleteNotice : t(retained ? "Рубеж 50 дней достигнут: Лавры сохранятся. История останется доступной для восстановления."
          : "Удаление до 50 уникальных дней выполнения обнуляет весь баланс Лавров. История останется доступной для восстановления.")}</p>
        {message ? <p role="alert">{t(message)}</p> : null}
        <footer><button type="button" disabled={busy} onClick={close}>{t("Отмена")}</button>
          <button type="button" className="danger" disabled={busy || !onCommand} onClick={() => void save(pending)}>{t(busy ? "Сохранение…" : "Удалить")}</button></footer>
      </section>
    </div> : null}
  </section>;
}
