import { practiceCopy } from "./habit-practice-copy";
import type { Language } from "./i18n";
export function HabitPracticeNotice({ language, deadline, timezone }: { language: Language; deadline: string; timezone: string }) {
  const copy = practiceCopy(language);
  return <section className="habit-editor-section habit-practice-warning" role="note">
    <p>{copy.warning}</p><p><strong>{copy.deadline}: </strong><time dateTime={deadline}>{deadline}</time> · {timezone}</p>
  </section>;
}
