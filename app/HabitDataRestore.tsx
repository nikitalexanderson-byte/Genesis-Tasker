import { useCallback, useEffect, useId, useRef, useState } from "react";
import { previewHabitRestore, type HabitRestoreChoice, type HabitRestorePreview, type HabitRestoreRequest } from "./habit-backup-restore";
import { habitDisplayText } from "./habit-display-text";
import { translateText, type Language } from "./i18n";
import type { HabitWorkspace } from "./habits";
import type { TimeFormat } from "./time-format";
import { IconActionButton } from "./IconActionButton";
import { PERSONAL_DOCUMENT_READY_EVENT } from "./cloud-sync";
import type { HabitRestoreJournal, HabitRestoreDraftRecord, HabitRestoreDeviceDraft, HabitRestoreEnvelope } from "./habit-restore-journal";
import {useDataTransferGuard} from './FeatureAccessContext';

export function HabitDataRestore({ workspace, language, scope, timeFormat = "24h", timeZone, onRestore, onPreview, onRecovery }: { workspace: HabitWorkspace; language: Language; scope: string;
  timeFormat?: TimeFormat; timeZone?: string;
  onPreview?: (text: string, scope: string) => Promise<HabitRestorePreview>;
  onRecovery?: () => void;
  onRestore: (request: HabitRestoreRequest, scope: string) => Promise<void> }) {
  const id = useId(), lock = useRef(false), generation = useRef(0), t = (source: string) => translateText(source, language);
  const transfer = useDataTransferGuard();
  const fileInput=useRef<HTMLInputElement>(null);
  const [lastFile, setLastFile] = useState<File | undefined>(undefined);
  const [preview, setPreview] = useState<HabitRestorePreview | null>(null), [choices, setChoices] = useState<Record<string, HabitRestoreChoice>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const journal = useRef<HabitRestoreJournal | null>(null), owned = useRef<HabitRestoreDraftRecord | null>(null), source = useRef<HabitRestoreDraftRecord | null>(null), text = useRef("");
  const previewer = useRef(onPreview), recovery = useRef(onRecovery);
  const [records, setRecords] = useState<HabitRestoreDraftRecord[]>([]), [ready, setReady] = useState(false), [durable, setDurable] = useState(false);
  const [broken, setBroken] = useState<HabitRestoreEnvelope | null>(null);
  const [initialization, retryInitialization] = useState(0);
  const invalidate = useCallback(() => { generation.current++; }, []);
  useEffect(() => { previewer.current = onPreview; recovery.current = onRecovery; }, [onPreview, onRecovery]);
  useEffect(() => {
    let closed = false, loaded = false, attempt = 0;
    const initialize = async () => {
      const ticket = ++attempt;
      try {
      const library = await import("./habit-restore-journal");
      const cipher = scope === "local" ? await library.localHabitRestoreCipher() : (await import("./cloud-sync")).personalDocumentAccess(scope);
      const value = new library.HabitRestoreJournal(scope, cipher);
      if (closed || ticket !== attempt) { value.dispose(); return; }
      journal.current?.dispose();
      journal.current = value;
      const rows = await value.list();
      if (closed || ticket !== attempt) return;
      loaded = true; setRecords(rows); setReady(true); setBroken(null); setError("");
      if (rows.length) recovery.current?.();
      } catch (reason) { if (!closed && ticket === attempt) {
      if (reason && typeof reason === "object" && "record" in reason) { setBroken(reason.record as HabitRestoreEnvelope); recovery.current?.(); }
      setError("Не удалось сохранить. Проверьте синхронизацию и повторите.");
      } }
    };
    const accessReady = () => { if (!loaded && !closed) void initialize(); };
    window.addEventListener(PERSONAL_DOCUMENT_READY_EVENT, accessReady);
    void initialize();
    return () => { closed = true; window.removeEventListener(PERSONAL_DOCUMENT_READY_EVENT, accessReady); invalidate(); journal.current?.dispose(); journal.current = null; };
  }, [scope, invalidate, initialization]);
  const persist = async (value: HabitRestoreDeviceDraft) => {
    setDurable(false);
    if (!journal.current) throw Error("HABIT_RESTORE_STORAGE_UNAVAILABLE");
    const record = await journal.current.write(value); owned.current = record;
    setRecords(current => [record, ...current.filter(row => row.id !== record.id)]); setDurable(true);
  };
  const resume = async (record: HabitRestoreDraftRecord) => {
    if (busy || lock.current || !transfer.check()) return;
    lock.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const value = record.value;
      const current = await (previewer.current ? previewer.current(value.text, scope) : previewHabitRestore(workspace, value.text));
      if (!transfer.check()) return;
      source.current = record; text.current = value.text; setLastFile(new File([value.text], value.filename, { type: "application/json" }));
      setPreview({ ...current, fingerprint: value.fingerprint }); setChoices(value.choices); setDurable(true);
      if (current.fingerprint !== value.fingerprint) setError("Данные изменились. Проверьте копию заново.");
    } catch { setError("Копия недействительна, повреждена или имеет неподдерживаемую версию."); }
    finally { lock.current = false; setBusy(false); }
  };
  const clear = async () => {
    if (!journal.current) throw Error("HABIT_RESTORE_STORAGE_UNAVAILABLE");
    if (owned.current) await journal.current.remove(owned.current);
    if (source.current && source.current.id !== owned.current?.id) {
      try { await journal.current.remove(source.current); } catch (error) { if (!(error instanceof Error) || error.message !== "HABIT_RESTORE_DRAFT_CHANGED") throw error; }
    }
    owned.current = null; source.current = null; setRecords(await journal.current.list()); setDurable(false);
  };
  const read = async (file?: File) => {
    if (!transfer.check()) return;
    const token = ++generation.current;
    setPreview(null); setChoices({}); setError(""); setMessage("");
    if (!file) return;
    setLastFile(file);
    setBusy(true);
    let validated = false;
    try {
      if (file.size > 64 * 1024 * 1024) throw Error("HABIT_BACKUP_TOO_LARGE");
      const body = await file.text();
      if (!transfer.check()) return;
      const result = await (onPreview ? onPreview(body, scope) : previewHabitRestore(workspace, body));
      if (generation.current !== token || !transfer.check()) return;
      validated = true;
      await persist({ version: 1, filename: file.name.slice(0, 250), text: body, fingerprint: result.fingerprint, choices: {}, phase: "review" });
      if (generation.current !== token) return;
      text.current = body;
      if (generation.current === token) setPreview(result);
    } catch (reason) { if (generation.current === token) setError(!validated ? "Копия недействительна, повреждена или имеет неподдерживаемую версию."
      : reason instanceof DOMException && reason.name === "QuotaExceededError" ? "Не удалось сохранить файл на устройстве. Освободите место и повторите."
      : "Не удалось сохранить. Проверьте синхронизацию и повторите."); }
    finally { if (generation.current === token) setBusy(false); }
  };
  const apply = async () => {
    if (!preview || lock.current || busy || !durable || !transfer.check()) return;
    lock.current = true; setBusy(true); setError(""); setMessage("");
    try {
      await persist({ version: 1, filename: lastFile?.name.slice(0, 250) ?? "JSON", text: text.current, fingerprint: preview.fingerprint, choices, phase: "applying" });
      if (!transfer.check()) return;
      await onRestore({ preview, choices }, scope);
      await clear();
      setPreview(null); setChoices({}); setMessage("Восстановление завершено.");
    } catch (error) {
      setError(error instanceof Error && error.message === "HABIT_RESTORE_STALE"
        ? "Данные изменились. Проверьте копию заново." : "Не удалось восстановить. Проверьте синхронизацию и повторите.");
    } finally { lock.current = false; setBusy(false); }
  };
  const unresolved = preview?.habits.some(row => row.kind === "conflict" && !choices[row.id]);
  const selected = preview?.habits.some(row => row.kind === "new" || row.kind === "conflict" && choices[row.id] === "copy");
  const choose = async (id: string, choice: HabitRestoreChoice) => {
    if (!preview || busy || lock.current) return;
    lock.current = true; setBusy(true); setError(""); const next = { ...choices, [id]: choice }; setChoices(next);
    try { await persist({ version: 1, filename: lastFile?.name.slice(0, 250) ?? "JSON", text: text.current, fingerprint: preview.fingerprint, choices: next, phase: "review" }); }
    catch { setError("Не удалось сохранить. Проверьте синхронизацию и повторите."); }
    finally { lock.current = false; setBusy(false); }
  };
  return <section className="habit-data-restore" aria-labelledby={`${id}-title`} aria-busy={busy}>
    <h3 id={`${id}-title`}>{t("Восстановить из JSON")}</h3>
    <p>{t("Сначала проверьте копию. До применения данные не меняются.")}</p>
    {broken ? <div className="habit-restore-damaged"><p>{t("Черновик повреждён. Сохраните его файл перед удалением.")}</p><div className="habit-data-actions">
      <IconActionButton data-dialog-save-alternative="true" icon="file" label={t("Сохранить файл")} disabled={busy} onClick={() => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(broken)], { type: "application/json" }));
        const link = document.createElement("a"); link.href = url; link.download = "GENESIS-restore-draft-encrypted.json"; document.body.append(link); link.click(); link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }} />
      <IconActionButton icon="delete" label={t("Удалить черновик")} disabled={busy} onClick={() => {
        if (!journal.current || lock.current) return; lock.current = true; setBusy(true);
        void journal.current.discard(broken).then(async () => { setBroken(null); const rows = await journal.current!.list(); setRecords(rows); setReady(true); setError(""); })
          .catch(reason => { if (reason && typeof reason === "object" && "record" in reason) setBroken(reason.record as HabitRestoreEnvelope); setError("Не удалось сохранить. Проверьте синхронизацию и повторите."); })
          .finally(() => { lock.current = false; setBusy(false); });
      }} />
    </div></div> : null}
    <div className="habit-backup-file"><span>{t("Выберите резервную копию JSON")}</span>
      <div className="habit-backup-picker"><IconActionButton icon="file" label={t("Выберите резервную копию JSON")} disabled={busy || !ready} onClick={()=>{if(transfer.check())fileInput.current?.click();}}/>
        <span data-no-translate>{lastFile?.name ?? "JSON"}</span></div>
      <input ref={fileInput} id={`${id}-file`} type="file" hidden accept="application/json,.json" disabled={busy || !ready} aria-label={t("Выберите резервную копию JSON")}
        onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void read(file); }} /></div>
    {!preview && records.length ? <ul className="habit-restore-rows">{records.map(record => <li key={record.id}>
      <strong>{t("Черновик восстановления")}</strong><span data-no-translate>{record.value.filename}</span>
      <IconActionButton icon="undo" label={t("Восстановить")} disabled={busy} onClick={() => void resume(record)} />
    </li>)}</ul> : null}
    {preview ? <div className="habit-restore-preview">
      <p>{t("Копия проверена")} · <time dateTime={preview.backup.createdAt}>{new Date(preview.backup.createdAt).toLocaleString(language, { timeZone, hour12: timeFormat === "12h" })}</time></p>
      <p>{t(preview.empty ? "В пустом пространстве восстановится сохранённый журнал наград без повторного начисления."
        : "В заполненном пространстве сохранятся текущие XP, Лавры, квесты и достижения. История из копии не начисляет награды.")}</p>
      <p>{t("Активные привычки восстановятся на паузе. Подключения Google не переносятся.")}</p>
      <ul className="habit-restore-rows">{preview.habits.map(row => <li key={row.id}>
        <strong data-no-translate>{habitDisplayText(preview.backup.data.habits.find(habit => habit.id === row.id)!, language).title}</strong>
        <span>{t(({ new: "Новая привычка", same: "Без изменений", conflict: "Конфликт", restored: "Уже восстановлено" } as const)[row.kind])}</span>
        <span>{t("Записи")}: {new Intl.NumberFormat(language).format(row.records)}</span>
        {row.kind === "conflict" ? <><div className="habit-restore-comparison">
          <p>{t("Текущая привычка")}: <span data-no-translate>{row.currentTitle}</span> · {t("Записи")}: {new Intl.NumberFormat(language).format(row.currentRecords)}</p>
          <p>{(row.changes.length ? row.changes : ["Настройки"]).map(change => t(change)).join(" · ")}</p></div><label>{t("Выберите действие")}<select disabled={busy} value={choices[row.id] ?? ""}
          onChange={event => void choose(row.id, event.target.value as HabitRestoreChoice)}>
          <option value="" disabled>{t("Выберите действие")}</option><option value="keep">{t("Оставить текущую")}</option>
          <option value="copy">{t("Восстановить отдельной копией")}</option></select></label></> : null}
      </li>)}</ul>
      <div className="habit-data-actions"><button type="button" aria-label={t("Применить восстановление")} disabled={busy || !durable || unresolved || !selected} onClick={() => void apply()}>{t(busy ? "Сохранение…" : "Восстановить")}</button>
        <IconActionButton icon="close" label={t("Отмена")} disabled={busy} onClick={() => { lock.current = true; setBusy(true); void clear().then(() => { generation.current++; setPreview(null); setChoices({}); })
          .catch(() => setError("Не удалось сохранить. Проверьте синхронизацию и повторите.")).finally(() => { lock.current = false; setBusy(false); }); }} /></div>
    </div> : null}
    {busy ? <p role="status">{t("Загружаем данные…")}</p> : null}
    {error ? <><p role="alert">{t(error)}</p>{!broken ? <div className="habit-data-actions"><IconActionButton icon="map-refresh" label={t("Обновить")} disabled={busy} onClick={() => { if (!ready) retryInitialization(value => value + 1); else if (lastFile) void read(lastFile); }} /></div> : null}</> : null}{message ? <p role="status">{t(message)}</p> : null}
  </section>;
}
