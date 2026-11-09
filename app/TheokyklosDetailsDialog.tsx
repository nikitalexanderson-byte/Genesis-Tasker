"use client";

import { habitDisplayText } from "./habit-display-text";
import { DialogCloseButton } from "./DialogCloseButton";

import { useEffect, type CSSProperties } from "react";
import type { CalendarMode } from "./calendar-data";
import { translateText, type Language } from "./i18n";
import { practiceCopy } from "./habit-practice-copy";
import { catalogText, sacredWordCopy } from "./catalog-i18n";
import {
  applyHabitLifecycleToWorkspace,
  createHabitFromSacredPractice,
  findStandardSacredHabit,
  additionalSacredHabits,
  habitDateKey,
  isHabitScheduledForDate,
  updateHabitCompletion,
  type HabitWorkspace,
} from "./habits";
import { isSacredPracticeSectorId, sacredPracticesForSector } from "./sacred-practices";
import { THEOKYKLOS_DETAIL_ART, THEOKYKLOS_SYMBOL_ART } from "./theokyklos-assets";
import type { TheokyklosLocalizedText, TheokyklosSegment } from "./theokyklos-data";
import { markTrackerEntityChanged } from "./tracker-core";
import { useDialogAccessibility } from "./use-dialog-accessibility";
import { TheokyklosRestorationContext } from "./TheokyklosRestorationContext";
import "./theokyklos-practices.css";
import { habitLifecycleState } from "./habit-lifecycle";
import { SacredHabitRestoreAction } from "./SacredHabitRestoreAction";
import { restoreSacredHabit } from "./sacred-habit-restore";

function localized(copy: TheokyklosLocalizedText, language: Language) {
  return catalogText(copy, language);
}

function groupLabel(segment: TheokyklosSegment, language: Language) {
  const labels = language === "en"
    ? {
        paired: "Vector of transformation",
        single: "Self-sufficient vector",
        axis: "Vertical axis of power",
        core: "Center and hearth",
        threshold: "Guardian of the threshold",
      }
    : {
        paired: "Вектор трансформации",
        single: "Самодостаточный вектор",
        axis: "Вертикаль силы",
        core: "Центр и очаг",
        threshold: "Страж порога",
      };
  return labels[segment.group];
}

type TheokyklosDetailsDialogProps = {
  segment: TheokyklosSegment;
  language: Language;
  workspace: HabitWorkspace;
  date: string;
  calendarMode: CalendarMode;
  onChange: (workspace: HabitWorkspace) => void;
  onClose: () => void;
  onOpenHabits?: () => void;
};

export function TheokyklosDetailsDialog({ segment, language, workspace, date, calendarMode, onChange, onClose, onOpenHabits }: TheokyklosDetailsDialogProps) {
  const practiceSectorId = isSacredPracticeSectorId(segment.id) ? segment.id : null;
  const sectorHabits = practiceSectorId ? workspace.habits.filter((habit) => habit.sacredSectorId === practiceSectorId) : [];
  const sectorPractices = practiceSectorId ? sacredPracticesForSector(practiceSectorId) : [];
  const detailsDialogRef = useDialogAccessibility<HTMLElement>(onClose, true);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div className="modal-backdrop theokyklos-details-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside ref={detailsDialogRef} id="theokyklos-details" className={`theokyklos-details segment-${segment.id}`} role="dialog" aria-modal="true" aria-labelledby="theokyklos-details-title" tabIndex={-1}>
        <DialogCloseButton className="theokyklos-details-close" type="button" onClick={onClose} aria-label={language === "en" ? "Close segment description" : "Закрыть описание сегмента"} />
        <header>
          <span className="theokyklos-details-symbol" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element -- Shared static PNG is pre-optimized for both deployment targets. */}
            <img src={THEOKYKLOS_SYMBOL_ART[segment.id]} alt="" width="256" height="256" draggable="false" />
          </span>
          <div className="theokyklos-details-identity">
            <span className="eyebrow">{groupLabel(segment, language)}</span>
            <h2 id="theokyklos-details-title">{localized(segment.title, language)}</h2>
            <strong>{localized(segment.patrons, language)}</strong>
          </div>
        </header>
        <figure className="theokyklos-details-art">
          {/* eslint-disable-next-line @next/next/no-img-element -- Artwork is a pre-optimized WebP shared by both deployment targets. */}
          <img
            src={THEOKYKLOS_DETAIL_ART[segment.id]}
            alt={`${localized(segment.patrons, language)} — ${localized(segment.title, language)}`}
            width="1680"
            height="945"
            decoding="async"
          />
        </figure>
        <p className="theokyklos-essence" data-no-translate>{localized(segment.essence, language)}</p>
        <p className="theokyklos-description" data-no-translate>{localized(segment.description, language)}</p>
        <TheokyklosRestorationContext sectorId={segment.id} language={language} />
        <section className="theokyklos-incantation" aria-labelledby="theokyklos-incantation-title">
          <div>
            <span className="eyebrow">{language === "en" ? "Sacred utterance" : "Священные слова"}</span>
            <h3 id="theokyklos-incantation-title">{language === "en" ? "Words of the segment" : "Заклинания Божеств"}</h3>
          </div>
          <p>{language === "en"
            ? "Pronounce each word deliberately, moving from meaning to sound."
            : "Произносите каждое слово осознанно, переходя от смысла к звучанию."}</p>
          <ol>
            {segment.words.map((sacredWord) => (
              <li key={sacredWord.greek}>
                <span lang={language === "ru" || language === "el" ? "grc" : language} data-no-translate>{sacredWordCopy(sacredWord.greek, language)}</span>
                <div data-no-translate>
                  <strong>«{localized(sacredWord.pronunciation, language)}»</strong>
                  <small>{localized(sacredWord.meaning, language)}</small>
                </div>
              </li>
            ))}
          </ol>
        </section>
        {practiceSectorId ? (
          <section className="theokyklos-sacred-practices" aria-labelledby="theokyklos-sacred-practices-title">
            <header>
              <div><span className="eyebrow">{language === "en" ? "Myth in daily life" : "Миф в повседневности"}</span><h3 id="theokyklos-sacred-practices-title">{language === "en" ? "Sacred habits" : "Сакральные привычки"}</h3></div>
              {onOpenHabits ? <button type="button" onClick={onOpenHabits}>{language === "en" ? "All habits" : "Все привычки"} →</button> : null}
            </header>
            <p>{!workspace.habitSettings.enabled
              ? (language === "en" ? "Habit tracking is disabled in your account. Practices remain visible but cannot be started or marked." : "Трекинг привычек отключён в личном кабинете. Практики видны, но их нельзя начинать или отмечать.")
              : sectorHabits.some((habit) => habit.active)
              ? (language === "en" ? "Your chosen practice is active in this sector and can be marked here." : "В этом секторе уже действует выбранная вами практика — её можно отметить прямо здесь.")
              : sectorHabits.length
              ? (language === "en" ? "The chosen practice is disabled. You can enable it again here." : "Выбранная практика отключена. Здесь её можно включить снова.")
              : translateText("Выберите обычное действие и выполните его один раз в поддержку этого сектора.", language)}</p>
            {!sectorHabits.length ? <p className="theokyklos-practice-notice" role="note">{practiceCopy(language).warning}</p> : null}
            <div>
              {sectorPractices.map(practice => ({ habit: findStandardSacredHabit(workspace.habits, practice.id), practice }))
                .concat(additionalSacredHabits(workspace.habits, practiceSectorId).flatMap(habit => {
                  const practice = sectorPractices.find(row => row.id === habit.sacredPracticeId);
                  return practice ? [{ habit, practice }] : [];
                }))
                .filter((item) => item.practice)
                .map(({ habit, practice }) => {
                  const lifecycle = habit ? habitLifecycleState(habit) : null;
                  const needsRestore = lifecycle?.status === "archived" || lifecycle?.status === "deleted";
                  const completion = habit ? workspace.habitCompletions.find((entry) => entry.habitId === habit.id && entry.date === date) : undefined;
                  const canTrack = Boolean(workspace.habitSettings.enabled && habit?.active && isHabitScheduledForDate(habit, date, calendarMode, workspace.habitCompletions) && habit.createdDate <= date && date === habitDateKey(new Date()));
                  return (
                    <article className={`${habit ? "started" : "suggested"}${habit && !habit.active ? " paused" : ""}`} style={{ "--practice-color": habit?.color ?? practice!.color } as CSSProperties} key={habit?.id ?? practice!.id}>
                      <span aria-hidden="true">{habit?.emoji ?? practice!.emoji}</span>
                      <div className="theokyklos-practice-copy"><small>{habit ? (habit.active ? (language === "en" ? "Active practice" : "Активная практика") : (language === "en" ? "Paused" : "На паузе")) : (language === "en" ? "Suggested practice" : "Предлагаемая практика")}</small><strong data-no-translate>{habit ? habitDisplayText(habit, language).title : catalogText(practice!.title, language)}</strong><p data-no-translate>{habit ? habitDisplayText(habit, language).description : catalogText(practice!.description, language)}</p><blockquote data-no-translate>{catalogText(practice!.myth, language)}</blockquote></div>
                      {habit ? <div className="theokyklos-practice-restore"><SacredHabitRestoreAction habit={habit} language={language}
                        disabled={!workspace.habitSettings.enabled} onRestore={() => onChange(restoreSacredHabit(workspace, habit.id, language))} /></div> : null}
                      {habit ? (
                        habit.active ? <div className="theokyklos-practice-actions"><button type="button" className={completion?.completed ? "completed" : ""} disabled={!canTrack} onClick={() => onChange(updateHabitCompletion(workspace, habit, date, { completed: !completion?.completed }))}>{completion?.completed ? `✓ ${language === "en" ? "Done" : "Выполнено"}` : (language === "en" ? "Mark today" : "Отметить сегодня")}</button><button type="button" className="disable" onClick={() => onChange({ ...workspace, habits: workspace.habits.map((item) => item.id === habit.id ? markTrackerEntityChanged({ ...item, active: false }) : item) })}>{language === "en" ? "Disable" : "Отключить"}</button></div>
                          : <button type="button" disabled={!workspace.habitSettings.enabled || lifecycle?.conflict} onClick={() => onChange(applyHabitLifecycleToWorkspace(workspace, { id: `habit-state:${crypto.randomUUID()}`, habitId: habit.id, action: needsRestore ? "restore" : "resume", at: new Date().toISOString(), heads: lifecycle!.heads.map(row => row.id) }))}>{needsRestore ? translateText("Восстановить", language) : language === "en" ? "Enable again" : "Включить снова"}</button>
                      ) : <button type="button" disabled={!workspace.habitSettings.enabled} onClick={() => onChange({ ...workspace, habits: [...workspace.habits, createHabitFromSacredPractice(practice!, habitDateKey(new Date()), calendarMode, language)] })}>{language === "en" ? "Begin" : "Начать"}</button>}
                    </article>
                  );
                })}
            </div>
          </section>
        ) : null}
      </aside>
    </div>
  );
}
