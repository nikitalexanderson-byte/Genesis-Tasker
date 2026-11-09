"use client";
import { useEffect, useState } from "react";
import type { Language } from "./i18n";
import copy from "./habit-feedback-copy.json";
import { HABIT_FEEDBACK_KINDS, HABIT_SOUND_SCHEMES, deliverHabitFeedback, playFeedbackSound,
  type HabitFeedbackKind, type HabitFeedbackSettings } from "./habit-feedback";

export function HabitFeedbackSoundSettings({ language, settings, onChange }: {
  language: Language; settings: HabitFeedbackSettings; onChange: (settings: HabitFeedbackSettings) => void;
}) {
  const text = copy[language] ?? copy.en;
  const [kind, setKind] = useState<HabitFeedbackKind>("completion");
  const [preview, setPreview] = useState(0);
  useEffect(() => {
    if (!preview) return;
    const timer = window.setTimeout(() => setPreview(0), 2600);
    return () => window.clearTimeout(timer);
  }, [preview]);
  return <div className="habit-sound-settings">
    <strong>{text.schemes}</strong>
    <div role="radiogroup" aria-label={text.schemes} className="habit-sound-schemes">
      {HABIT_SOUND_SCHEMES.map(scheme => <div className="habit-sound-scheme" key={scheme}>
        <label htmlFor={`habit-sound-${scheme}`} aria-label={text[scheme]}>
          <input id={`habit-sound-${scheme}`} type="radio" name="habit-sound-scheme" checked={settings.soundScheme === scheme}
            onChange={() => onChange({ ...settings, soundScheme: scheme })} />
          <span><b>{text[scheme]}</b><small>{text[`${scheme}Hint`]}</small></span>
        </label>
        <button type="button" className="habit-sound-listen" aria-label={`${text.listen} · ${text[scheme]}`}
          title={`${text.listen} · ${text[scheme]}`} onClick={() => playFeedbackSound(kind, scheme)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m11 5-6 4H2v6h3l6 4V5Zm4 3a5 5 0 0 1 0 8m3-11a9 9 0 0 1 0 14"/></svg>
        </button>
      </div>)}
    </div>
    <small>{text.webSoundHint}</small>
    <label className="habit-feedback-event"><span>{text.events}</span>
      <select value={kind} onChange={event => setKind(event.target.value as HabitFeedbackKind)}>
        {HABIT_FEEDBACK_KINDS.map(value => <option key={value} value={value}>{text[value]}</option>)}
      </select>
    </label>
    <button type="button" className="secondary-button" onClick={() => {
      deliverHabitFeedback(kind, settings); setPreview(value => value + 1);
    }}>{text.test}</button>
    <small>{text.testHint}</small>
    {preview ? <aside key={preview} role="status" aria-live="polite"
      className={`habit-feedback-preview${settings.animations ? " animated" : ""}`}>
      <strong>{text[kind]}</strong><small>{text.test}</small>
    </aside> : null}
  </div>;
}
