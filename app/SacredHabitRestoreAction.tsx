"use client";

import { useState } from "react";
import type { Habit } from "./habits";
import { translateText, type Language } from "./i18n";
import { ExperimentalIcon } from "./ExperimentalIcon";
import { canRestoreSacredHabit } from "./sacred-habit-restore";
import "./sacred-habit-restore.css";

export function SacredHabitRestoreAction({ habit, language, disabled = false, onRestore }: {
  habit: Habit; language: Language; disabled?: boolean; onRestore: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!canRestoreSacredHabit(habit)) return null;
  const t = (text: string) => translateText(text, language);
  return <div className="sacred-practice-restore">
    <button type="button" className="secondary-button" disabled={disabled} aria-expanded={confirming}
      onClick={() => setConfirming(value => !value)}><ExperimentalIcon name="undo" />{t("Вернуть исходную")}</button>
    {confirming ? <div className="sacred-practice-restore-confirm" role="group" aria-label={t("Вернуть исходную привычку?")}>
      <p>{t("Вернутся название, описание, значок и цвет. Расписание, статус и история выполнения сохранятся.")}</p>
      <div><button type="button" className="primary-button" disabled={disabled} onClick={() => { onRestore(); setConfirming(false); }}>{t("Вернуть")}</button>
        <button type="button" className="secondary-button" onClick={() => setConfirming(false)}>{t("Отмена")}</button></div>
    </div> : null}
  </div>;
}
