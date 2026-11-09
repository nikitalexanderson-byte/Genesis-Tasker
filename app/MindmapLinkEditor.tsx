"use client";
import { useState } from "react";
import type { MapLink } from "./mindmaps-model";

export function MindmapLinkEditor({ link, from, to, readOnly, onSave, onRemove }: {
  link: MapLink; from: string; to: string; readOnly?: boolean; onSave: (link: MapLink) => void; onRemove: () => void;
}) {
  const [label, setLabel] = useState(link.label), [color, setColor] = useState(link.color ?? "#8c672b");
  return <form className="mindmap-link-editor" onSubmit={event => { event.preventDefault(); if (!readOnly) onSave({ ...link, label: label.trim(), color }); }}>
    <p data-no-translate>{from} → {to}</p>
    <fieldset disabled={readOnly}><label>Подпись связи<input data-no-translate maxLength={240} value={label} onChange={event => setLabel(event.target.value)}/></label>
      <label>Цвет смысловой связи<input type="color" value={color} onChange={event => setColor(event.target.value)}/></label></fieldset>
    <div className="mindmap-actions"><button type="submit" className="primary-button" disabled={readOnly}>Сохранить</button>
      <button type="button" className="danger-button" disabled={readOnly} onClick={onRemove}>Удалить связь</button></div>
  </form>;
}
