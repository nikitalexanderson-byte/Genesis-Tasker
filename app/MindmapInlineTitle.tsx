"use client";
import { useEffect, useRef, useState } from "react";
import { ExperimentalIcon } from "./ExperimentalIcon";
import { translateText } from "./i18n";

export function MindmapInlineTitle({ title, onCommit, onCancel }: { title: string; onCommit: (text: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(title);
  const input = useRef<HTMLInputElement>(null), finished = useRef(false);
  useEffect(() => { input.current?.focus({ preventScroll: true }); input.current?.select(); }, []);
  const finish = () => { if (finished.current) return; finished.current = true; if (value.trim()) onCommit(value); else onCancel(); };
  return <form className="mindmap-inline-title" onSubmit={event => { event.preventDefault(); finish(); }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) finish(); }}>
    <input ref={input} data-no-translate aria-label={translateText("Название мысли")} placeholder={translateText("Название мысли")} value={value} maxLength={2000}
      onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
      onChange={event => setValue(event.target.value)} onKeyDown={event => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); finished.current = true; onCancel(); }
        if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
      }}/>
    <div><button type="submit" aria-label="Сохранить название" disabled={!value.trim()}><ExperimentalIcon name="check"/></button>
      <button type="button" aria-label="Отмена" onClick={() => { finished.current = true; onCancel(); }}><ExperimentalIcon name="close"/></button></div>
  </form>;
}
