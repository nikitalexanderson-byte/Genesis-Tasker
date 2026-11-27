"use client";
import privateSecurityCopy from '../contracts/e2ee/shared-security-copy-v1.json';
import {isLanguage, runtimeLocale} from './i18n';
import { useEffect, useId, useRef, useState } from "react";
import { ExperimentalIcon } from "./ExperimentalIcon";
import type { SharedTaskAttachment } from "./cloud-sync";
import {privateSharedFileOwner,readPrivateSharedFile} from './private-shared-file';
import {requirePrivateAccount} from './e2ee/product-session';

export type TaskFileDraft = { id: string; name: string; type: string; size: number; data: string };
const extensions = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "txt", "csv"];
const totalLimit = 10 * 1024 * 1024;
export function taskFileError(error: unknown, english: boolean): string {
  const code = error instanceof Error ? error.message : String(error);
  if (["TASK_FILES_TOO_LARGE", "TOO_MANY_TASK_FILES"].includes(code)) return english
    ? "Up to 5 files per task, 10 MB in total. Remove a file or choose smaller files."
    : "До 5 файлов на задачу, суммарно до 10 МБ. Уберите файл или выберите файлы меньшего размера.";
  if (code === "INVALID_TASK_FILE_REMOVAL") return english ? "The file list changed. Reopen the task and try again." : "Список файлов изменился. Откройте задачу повторно и попробуйте ещё раз.";
  if (["INVALID_TASK_FILE", "INVALID_TASK_FILES", "INVALID_TASK_FILENAME", "UNSUPPORTED_TASK_FILE", "INVALID_TASK_FILE_CONTENT"].includes(code)) return english
    ? "A file could not be attached. Check its format and contents, then choose it again."
    : "Не удалось прикрепить файл. Проверьте его формат и содержимое, затем выберите его ещё раз.";
  return code;
}
export function taskFileSize(size: number, english: boolean) {
  const inMegabytes = size >= 1024 * 1024;
  const amount = inMegabytes ? size / (1024 * 1024) : Math.max(1, Math.ceil(size / 1024));
  return new Intl.NumberFormat(runtimeLocale(english ? "en" : undefined), {
    style: "unit", unit: inMegabytes ? "megabyte" : "kilobyte", unitDisplay: "short", maximumFractionDigits: 1,
  }).format(amount);
}
function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("FILE_READ_FAILED"));
    reader.readAsDataURL(file);
  });
}

export function SharedTaskAttachmentList({ files, english,language }: { files: SharedTaskAttachment[]; english: boolean;language?:string }) {
  const [busy,setBusy]=useState(''),[failed,setFailed]=useState(false),privateOwner=privateSharedFileOwner();
  const download=async(file:SharedTaskAttachment)=>{if(busy||!privateOwner)return;setBusy(file.id);setFailed(false);let url:string|undefined;
   try{const account=requirePrivateAccount(privateOwner),result=await readPrivateSharedFile(file.url,privateOwner);try{account.requireOpen();if(requirePrivateAccount(privateOwner)!==account||result.bytes.length!==file.size||result.filename!==file.name)throw new Error('E2EE_PRIVATE_FILE_CORRUPT');url=URL.createObjectURL(new Blob([result.bytes],{type:'application/octet-stream'}));}finally{result.bytes.fill(0);}
    account.requireOpen();const link=document.createElement('a');link.href=url;link.download=file.name;link.click();const held=url;setTimeout(()=>URL.revokeObjectURL(held),1000);url=undefined;
   }catch{setFailed(true);}finally{if(url)URL.revokeObjectURL(url);setBusy('');}
  };
  if (!files.length) return null;
  return <section className="shared-task-attachments" aria-label={english ? "Task files" : "Файлы задачи"}>
    <h3>{english ? "Attached files" : "Прикреплённые файлы"}</h3>
    <ul className="task-file-list">{files.map(file => <li key={file.id}>
      <ExperimentalIcon name="file" />
      {privateOwner?<button type="button" disabled={!!busy} onClick={()=>void download(file)}><span>{file.name}</span><small>{taskFileSize(file.size, english)} · {english ? "Download" : "Скачать"}</small></button>:<a href={file.url} download={file.name}><span>{file.name}</span><small>{taskFileSize(file.size, english)} · {english ? "Download" : "Скачать"}</small></a>}
    </li>)}</ul>
    {failed?<p role="alert">{privateSecurityCopy[language&&isLanguage(language)?language:english?'en':'ru'].error}</p>:null}
  </section>;
}

export function SharedTaskAttachmentsInput({ value, onChange, onReadingChange, english, disabled, existing = [], onRemoveExisting }: {
  value: TaskFileDraft[]; onChange: (files: TaskFileDraft[]) => void; onReadingChange: (reading: boolean) => void;
  english: boolean; disabled: boolean; existing?: SharedTaskAttachment[]; onRemoveExisting?: (id: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const readingRef = useRef(false);
  const active = useRef(true);
  const dragDepth = useRef(0);
  const hintId = useId();
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const unavailable = disabled || reading;
  useEffect(() => { active.current = true; return () => { active.current = false; onReadingChange(false); }; }, [onReadingChange]);
  const addFiles = async (files: File[]) => {
    if (disabled || readingRef.current || !files.length) return;
    setError("");
    if (files.some(file => !extensions.includes(file.name.split(".").pop()?.toLowerCase() ?? ""))) {
      setError(english ? "Choose an image, PDF or office document in one of the formats below." : "Выберите изображение, PDF или офисный документ в одном из форматов ниже."); return;
    }
    if (files.some(file => !file.size)) {
      setError(english ? "An empty file cannot be attached. Choose another file." : "Нельзя прикрепить пустой файл. Выберите другой файл."); return;
    }
    if (files.some(file => file.name.length > 180 || /[/\\]/u.test(file.name) || Array.from(file.name).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))) {
      setError(english ? "Rename the file using a shorter name without slashes." : "Переименуйте файл: до 180 символов, без косых черт."); return;
    }
    const all = [...existing, ...value, ...files];
    if (all.length > 5 || all.reduce((sum, file) => sum + file.size, 0) > totalLimit) {
      setError(english ? "Up to 5 files per task, 10 MB in total. Remove a file or choose smaller files." : "До 5 файлов на задачу, суммарно до 10 МБ. Уберите файл или выберите файлы меньшего размера."); return;
    }
    readingRef.current = true; setReading(true); onReadingChange(true);
    try {
      const drafts = await Promise.all(files.map(async file => ({ id: crypto.randomUUID(), name: file.name, type: file.type,
        size: file.size, data: await readFile(file) })));
      if (active.current) onChange([...value, ...drafts]);
    } catch {
      if (active.current) setError(english ? "Could not read the files. Choose them again." : "Не удалось прочитать файлы. Выберите их ещё раз.");
    } finally { readingRef.current = false; if (active.current) { setReading(false); onReadingChange(false); } }
  };
  return <div className="task-file-input">
    <div className="task-file-dropzone" data-dragging={dragging || undefined} aria-busy={reading}
      onDragEnter={event => { if (!event.dataTransfer.types.includes("Files")) return; event.preventDefault(); dragDepth.current++; if (!unavailable) setDragging(true); }}
      onDragOver={event => { if (!event.dataTransfer.types.includes("Files")) return; event.preventDefault(); event.dataTransfer.dropEffect = unavailable ? "none" : "copy"; }}
      onDragLeave={event => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }}
      onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); void addFiles(Array.from(event.dataTransfer.files)); }}>
      <ExperimentalIcon name="attach" />
      <div><strong>{english ? "Attach files to the task" : "Прикрепить файлы к задаче"}</strong>
        <p>{english ? "Drag files here from your computer or choose them below." : "Перетащите сюда файлы с компьютера или выберите их кнопкой ниже."}</p>
        <button type="button" className="secondary-button" disabled={unavailable} aria-describedby={hintId} onClick={() => input.current?.click()}>
          {reading ? (english ? "Reading files…" : "Читаем файлы…") : (english ? "Choose files" : "Выбрать файлы")}</button>
      </div>
      <input ref={input} hidden type="file" multiple accept={extensions.map(extension => `.${extension}`).join(",")} disabled={unavailable}
        aria-label={english ? "Choose task files" : "Выбрать файлы задачи"} onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; void addFiles(files); }} />
    </div>
    <p id={hintId} className="task-file-hint">{english
      ? "Images: JPG, PNG, WebP, GIF, BMP, TIFF. Documents: PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, ODT/ODS/ODP, RTF, TXT, CSV. Up to 5 files, 10 MB in total. Visible to task participants."
      : "Изображения: JPG, PNG, WebP, GIF, BMP, TIFF. Документы: PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, ODT/ODS/ODP, RTF, TXT, CSV. До 5 файлов, суммарно до 10 МБ. Доступны участникам задачи."}</p>
    {reading ? <p role="status">{english ? "Preparing attachments…" : "Подготавливаем вложения…"}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {(existing.length || value.length) ? <ul className="task-file-list" aria-label={english ? "Selected files" : "Выбранные файлы"}>
      {[...existing, ...value].map(file => <li key={file.id}><ExperimentalIcon name="file" />
        <div><span>{file.name}</span><small>{taskFileSize(file.size, english)}{existing.some(item => item.id === file.id) ? "" : ` · ${english ? "Ready to attach" : "Готов к прикреплению"}`}</small></div>
        <button type="button" disabled={unavailable} aria-label={`${english ? "Remove file" : "Убрать файл"}: ${file.name}`} onClick={() => {
          if (existing.some(item => item.id === file.id)) onRemoveExisting?.(file.id); else onChange(value.filter(item => item.id !== file.id)); setError("");
        }}><ExperimentalIcon name="close" /></button>
      </li>)}
    </ul> : null}
  </div>;
}
