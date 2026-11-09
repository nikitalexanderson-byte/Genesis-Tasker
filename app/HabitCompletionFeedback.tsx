"use client";

import { translateText, type Language } from "./i18n";
import copy from "./habit-feedback-copy.json";
import type { HabitFeedbackEvent } from "./habit-feedback";

type HabitCompletionFeedbackProps = {
  event: HabitFeedbackEvent;
  language: Language;
  showGamification: boolean;
};

export function HabitCompletionFeedback({ event, language, showGamification }: HabitCompletionFeedbackProps) {
  const isEnglish = language === "en";
  const achievement = isEnglish ? event.achievementTitleEn : event.achievementTitle;
  return (
    <aside
      className={`habit-completion-feedback kind-${event.kind}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="habit-feedback-symbol" aria-hidden="true">{event.habitEmoji || "✓"}</span>
      <div>
        <small>{(copy[language] ?? copy.en)[event.kind]}{event.kind === "rank-up" ? ` — ${translateText(isEnglish ? event.rankTitleEn : event.rankTitle, language)}` : ""}</small>
        <strong data-no-translate>{event.habitTitle}</strong>
        {showGamification && (event.xp > 0 || event.laurels > 0) ? (
          <p>
            {event.xp > 0 ? <b>+{event.xp} XP</b> : null}
            {event.laurels > 0 ? <b>♕ +{event.laurels} {isEnglish ? "Laurels" : "Лавров"}</b> : null}
          </p>
        ) : null}
        {achievement ? <em>{isEnglish ? `Achievement: ${achievement}` : `Достижение: ${achievement}`}</em> : null}
      </div>
      <span className="habit-feedback-check" aria-hidden="true">✓</span>
    </aside>
  );
}
