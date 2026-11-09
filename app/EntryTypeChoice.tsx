"use client";
export type EntryType = "task" | "meeting" | "birthday" | "event";
export const entryTypes: EntryType[] = ["task", "meeting", "birthday", "event"];
export function entryTypeTitlePlaceholder(type: EntryType | undefined) {
  return type === "birthday" ? "Кто именинник?" : type === "event" ? "Какое событие?"
    : type === "meeting" ? "С кем будет встреча и где?" : undefined;
}
export function entryTypeLabel(type: EntryType | undefined, english = false) {
  return english ? ({task:"Task",meeting:"Meeting",birthday:"Birthday",event:"Event"})[type ?? "task"]
    : ({task:"Задача",meeting:"Встреча",birthday:"День рождения",event:"Событие"})[type ?? "task"];
}
export function EntryTypeChoice({value,onChange,english,disabled,types=entryTypes}: {value:EntryType;onChange:(value:EntryType)=>void;english:boolean;disabled?:boolean;types?:EntryType[]}) {
  return <label className="entry-type-choice"><span>{english?"Entry type":"Тип записи"}</span>
    <select value={value} disabled={disabled} onChange={event=>onChange(event.target.value as EntryType)}>
      {types.map(type=><option key={type} value={type}>{entryTypeLabel(type,english)}</option>)}
    </select></label>;
}
