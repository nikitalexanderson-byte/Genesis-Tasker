/* eslint-disable @next/next/no-img-element -- Member-only image responses use the authenticated session. */
"use client";
import { useRef, useState } from "react";
import { ExperimentalIcon } from "./ExperimentalIcon";

export function SharedTaskImageInput({ value, onChange, onReadingChange, english, disabled }: { value: string; onChange: (data: string) => void; onReadingChange: (reading: boolean) => void; english: boolean; disabled: boolean }) {
  const [error, setError] = useState(""); const [reading, setReading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return <div className="shared-task-image-input">
    <button type="button" className="shared-image-choose secondary-button" disabled={disabled || reading} onClick={() => input.current?.click()}><ExperimentalIcon name="image" />{english ? "Attach a photo" : "Прикрепить фото"}</button>
      <input ref={input} hidden aria-label={english ? "Attach a photo" : "Прикрепить фото"} type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled || reading} onChange={event => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; setError(""); if (!file) return;
        if (file.size > 3 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
          setError(english ? "Choose a JPEG, PNG or WebP image up to 3 MB." : "Выберите JPEG, PNG или WebP до 3 МБ."); return;
        }
        setReading(true); onReadingChange(true); const reader = new FileReader();
        reader.onload = () => { onChange(String(reader.result)); setReading(false); onReadingChange(false); };
        reader.onerror = () => { setError(english ? "Could not read the photo. Choose it again." : "Не удалось прочитать фото. Выберите его повторно."); setReading(false); onReadingChange(false); };
        reader.readAsDataURL(file);
      }} />
    <small>{english ? "JPEG, PNG or WebP · up to 3 MB. Visible to task participants." : "JPEG, PNG или WebP · до 3 МБ. Видно участникам задачи."}</small>
    {reading ? <p role="status">{english ? "Reading photo…" : "Читаем фото…"}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {value ? <div className="shared-task-image-preview"><img src={value} alt={english ? "Attached photo preview" : "Предпросмотр прикреплённого фото"} />
      <button type="button" disabled={disabled} onClick={() => onChange("")}><ExperimentalIcon name="close" />{english ? "Remove photo" : "Убрать фото"}</button></div> : null}
  </div>;
}
export function SharedTaskImage({ src, english }: { src: string; english: boolean }) {
  const [failed, setFailed] = useState(false);
  return <figure className="shared-task-image">
    {failed ? <p role="status">{english ? "Photo is unavailable. Check your connection and task access." : "Фото недоступно. Проверьте подключение и доступ к задаче."}</p>
      : <img src={src} alt={english ? "Photo attached to this task" : "Фото, прикреплённое к задаче"} referrerPolicy="no-referrer" onError={() => setFailed(true)} />}
    <figcaption>{english ? "Photo is visible only to task participants." : "Фото видно только участникам задачи."}</figcaption>
  </figure>;
}
