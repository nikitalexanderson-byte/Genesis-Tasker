"use client";
import { DialogCloseButton } from "./DialogCloseButton";

import { useEffect, useRef, useState } from "react";
import { CalendarDatePicker } from "./CalendarDatePicker";
import { TimeClockPicker } from "./TimeClockPicker";
import type { CalendarMode } from "./calendar-data";
import { runtimeLocale } from "./i18n";
import type { TimeFormat } from "./time-format";
import { useDialogAccessibility } from "./use-dialog-accessibility";
import {
  MAX_REMINDER_MINUTES,
  MAX_TASK_REMINDERS,
  formatTaskReminder,
  reminderMinutesBeforeTask,
  taskReminderKey,
  type TaskReminder,
} from "./task-reminders";

const PRESET_REMINDERS = [10, 30, 60, 1_440] as const;
const UNIT_MINUTES = {
  minutes: 1,
  hours: 60,
  days: 1_440,
  weeks: 10_080,
} as const;

type ReminderUnit = keyof typeof UNIT_MINUTES;
type CustomMode = "relative" | "absolute";

function localDateValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function TaskReminderPicker({
  value,
  onChange,
  taskDate,
  taskTime,
  calendarMode,
  timeFormat = "24h",
  disabled = false,
}: {
  value: TaskReminder[];
  onChange: (value: TaskReminder[]) => void;
  taskDate: string;
  taskTime: string;
  calendarMode: CalendarMode;
  timeFormat?: TimeFormat;
  disabled?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customMode, setCustomMode] = useState<CustomMode>("relative");
  const [amount, setAmount] = useState("1");
  const [unit, setUnit] = useState<ReminderUnit>("hours");
  const [absoluteDate, setAbsoluteDate] = useState(taskDate || localDateValue());
  const [absoluteTime, setAbsoluteTime] = useState(taskTime || "09:00");
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const locale = runtimeLocale();
  const atLimit = value.length >= MAX_TASK_REMINDERS;
  const customDialogRef = useDialogAccessibility<HTMLElement>(() => setCustomOpen(false), customOpen);

  useEffect(() => {
    if (!menuOpen) return;
    const closeMenu = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  const includes = (reminder: TaskReminder) => value.some((item) => taskReminderKey(item) === taskReminderKey(reminder));

  const addReminder = (reminder: TaskReminder) => {
    if (atLimit || includes(reminder)) return false;
    onChange([...value, reminder]);
    return true;
  };

  const choosePreset = (minutes: number) => {
    addReminder({ kind: "relative", minutes });
    setMenuOpen(false);
  };

  const openCustom = () => {
    setMenuOpen(false);
    setCustomMode("relative");
    setAmount("1");
    setUnit("hours");
    setAbsoluteDate(taskDate || localDateValue());
    setAbsoluteTime(taskTime || "09:00");
    setError("");
    setCustomOpen(true);
  };

  const saveCustom = () => {
    setError("");
    let reminder: TaskReminder;
    if (customMode === "relative") {
      const numericAmount = Number(amount);
      const minutes = numericAmount * UNIT_MINUTES[unit];
      if (!Number.isInteger(numericAmount) || numericAmount < 1) {
        setError("Введите целое число больше нуля.");
        return;
      }
      if (minutes > MAX_REMINDER_MINUTES) {
        setError("Google Calendar поддерживает напоминания не более чем за 4 недели.");
        return;
      }
      reminder = { kind: "relative", minutes };
    } else {
      if (!absoluteDate || !absoluteTime) {
        setError("Выберите дату и точное время напоминания.");
        return;
      }
      const absolute = new Date(`${absoluteDate}T${absoluteTime}:00`);
      if (Number.isNaN(absolute.getTime())) {
        setError("Дата или время напоминания указаны неверно.");
        return;
      }
      reminder = { kind: "absolute", at: absolute.toISOString() };
      const minutes = reminderMinutesBeforeTask(reminder, taskDate, taskTime);
      if (minutes === null || minutes < 0) {
        setError("Напоминание должно быть установлено не позже начала задачи.");
        return;
      }
      if (minutes > MAX_REMINDER_MINUTES) {
        setError("Дата напоминания должна быть не более чем за 4 недели до задачи.");
        return;
      }
    }

    if (includes(reminder)) {
      setError("Такое напоминание уже добавлено.");
      return;
    }
    if (!addReminder(reminder)) {
      setError("К одной задаче можно добавить не более 5 напоминаний.");
      return;
    }
    setCustomOpen(false);
  };

  const triggerLabel = value.length ? "+ Добавить ещё" : "Без напоминания";

  return (
    <div className="reminder-field" ref={rootRef}>
      <span className="reminder-field-label">Напомнить</span>
      <div className="reminder-control">
        {value.length ? (
          <div className="reminder-chips" role="list" aria-label="Добавленные напоминания">
            {value.map((reminder) => (
              <span className="reminder-chip" role="listitem" key={taskReminderKey(reminder)}>
                <span>{formatTaskReminder(reminder, locale, timeFormat)}</span>
                <button
                  type="button"
                  onClick={() => onChange(value.filter((item) => taskReminderKey(item) !== taskReminderKey(reminder)))}
                  aria-label={`Удалить напоминание: ${formatTaskReminder(reminder, locale, timeFormat)}`}
                  disabled={disabled}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="m7 7 10 10M17 7 7 17" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="reminder-menu-wrap">
          <button
            type="button"
            className={value.length ? "reminder-add-button" : "reminder-select-trigger"}
            aria-haspopup="listbox"
            aria-expanded={menuOpen}
            disabled={disabled || atLimit}
            onClick={() => setMenuOpen((current) => !current)}
          >
            <span>{atLimit ? "Добавлено 5 напоминаний" : triggerLabel}</span>
            <svg className="reminder-disclosure-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="m6.5 9 5.5 5.5L17.5 9" />
            </svg>
          </button>
          {menuOpen ? (
            <div className="reminder-menu" role="listbox" aria-label="Добавить напоминание">
              {PRESET_REMINDERS.map((minutes) => {
                const reminder: TaskReminder = { kind: "relative", minutes };
                const added = includes(reminder);
                return (
                  <button type="button" role="option" aria-selected={added} disabled={added} onClick={() => choosePreset(minutes)} key={minutes}>
                    <span>{formatTaskReminder(reminder, locale, timeFormat)}</span>
                    {added ? <small>Добавлено</small> : null}
                  </button>
                );
              })}
              <button type="button" role="option" aria-selected="false" className="reminder-menu-custom" onClick={openCustom}>
                Пользовательский...
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {customOpen ? (
        <div className="modal-backdrop custom-reminder-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCustomOpen(false); }}>
          <section ref={customDialogRef} className="custom-reminder-modal" role="dialog" aria-modal="true" aria-labelledby="custom-reminder-title" tabIndex={-1}>
            <DialogCloseButton type="button" className="modal-close" onClick={() => setCustomOpen(false)} aria-label="Закрыть" />
            <span className="eyebrow">Точная настройка</span>
            <h2 id="custom-reminder-title">Пользовательское напоминание</h2>
            <div className="custom-reminder-modes" role="tablist" aria-label="Способ настройки напоминания">
              <button type="button" role="tab" aria-selected={customMode === "relative"} className={customMode === "relative" ? "active" : ""} onClick={() => { setCustomMode("relative"); setError(""); }}>
                Относительное время
              </button>
              <button type="button" role="tab" aria-selected={customMode === "absolute"} className={customMode === "absolute" ? "active" : ""} onClick={() => { setCustomMode("absolute"); setError(""); }}>
                Дата и время
              </button>
            </div>

            {customMode === "relative" ? (
              <div className="custom-reminder-relative" role="tabpanel">
                <label>
                  <span>Количество</span>
                  <input type="number" min="1" step="1" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} />
                </label>
                <label>
                  <span>Единица времени</span>
                  <select value={unit} onChange={(event) => setUnit(event.target.value as ReminderUnit)}>
                    <option value="minutes">Минут</option>
                    <option value="hours">Часов</option>
                    <option value="days">Дней</option>
                    <option value="weeks">Недель</option>
                  </select>
                </label>
                <p>Напоминание сработает за указанное время до начала задачи.</p>
              </div>
            ) : (
              <div className="custom-reminder-absolute" role="tabpanel">
                <label htmlFor="custom-reminder-date">
                  <span>Дата напоминания</span>
                  <CalendarDatePicker
                    id="custom-reminder-date"
                    mode={calendarMode}
                    value={absoluteDate}
                    max={taskDate || undefined}
                    onChange={setAbsoluteDate}
                    required
                  />
                </label>
                <label htmlFor="custom-reminder-time">
                  <span>Точное время</span>
                  <TimeClockPicker id="custom-reminder-time" value={absoluteTime} timeFormat={timeFormat} onChange={setAbsoluteTime} />
                </label>
              </div>
            )}

            {error ? <p className="custom-reminder-error" role="alert">{error}</p> : null}
            <p className="custom-reminder-limit">Google Calendar позволяет добавить до 5 уведомлений не более чем за 4 недели до задачи.</p>
            <div className="custom-reminder-actions">
              <button type="button" className="text-button" onClick={() => setCustomOpen(false)}>Отмена</button>
              <button type="button" className="primary-button" onClick={saveCustom}>Добавить</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
