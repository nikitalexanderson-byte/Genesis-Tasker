import { useId, useRef, useState } from "react";
import { buildHabitHistoryCsv, createHabitBackup } from "./habit-backup";
import { translateText, type Language } from "./i18n";
import { ExperimentalIcon } from "./ExperimentalIcon";
import { IconActionButton } from "./IconActionButton";
import type { HabitWorkspace } from "./habits";
import { HabitDataRestore } from "./HabitDataRestore";
import type { HabitRestoreRequest, HabitRestorePreview } from "./habit-backup-restore";
import type { TimeFormat } from "./time-format";
import {useDataTransferGuard} from './FeatureAccessContext';
import "./habit-data-export.css";

function downloadFile(body: string, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([body], { type: mime }));
  const link = document.createElement("a"); link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function HabitDataExport({ workspace, language, restoreScope = "", timeFormat, timeZone, onRestore, onPreview }: { workspace: HabitWorkspace; language: Language;
  timeFormat?: TimeFormat; timeZone?: string;
  onPreview?: (text: string, scope: string) => Promise<HabitRestorePreview>;
  restoreScope?: string; onRestore?: (request: HabitRestoreRequest, scope: string) => Promise<void> }) {
  const t = (text: string) => translateText(text, language), id = useId();
  const transfer = useDataTransferGuard();
  const details = useRef<HTMLDetailsElement>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const save = async (format: "csv" | "json") => {
    if (busy || !transfer.check()) return;
    setBusy(true); setError("");
    try {
      const now = new Date().toISOString();
      if (format === "csv") downloadFile(buildHabitHistoryCsv(workspace, { label: t }), `GENESIS-habits-history-${now.slice(0, 10)}.csv`, "text/csv;charset=utf-8");
      else {
        const backup=await createHabitBackup(workspace, now);
        if (!transfer.check()) return;
        downloadFile(`${JSON.stringify(backup, null, 2)}\n`, `GENESIS-habits-backup-${now.slice(0, 10)}.json`, "application/json;charset=utf-8");
      }
    } catch { setError("Не удалось создать файл. Повторите попытку."); }
    finally { setBusy(false); }
  };
  return <details ref={details} className="habit-data-export">
    <summary><ExperimentalIcon name="file" /><span>{t("Данные привычек")}</span><svg className="disclosure-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m5.5 7.5 4.5 4.5 4.5-4.5" /></svg></summary>
    <div aria-labelledby={`${id}-description`} aria-busy={busy}>
      <p id={`${id}-description`}>{t("Включает всю историю, независимо от выбранного периода отчёта.")} {t("Подключения Google не переносятся.")}</p>
      <div className="habit-data-actions">
        <IconActionButton className="icon-label-choice" icon={<><ExperimentalIcon name="file"/><span className="icon-choice-label">CSV</span></>}
          label={t("Экспорт всей истории CSV")} disabled={busy} onClick={() => void save("csv")}/>
        <IconActionButton className="icon-label-choice" icon={<><ExperimentalIcon name="archive"/><span className="icon-choice-label">JSON</span></>}
          label={t("Резервная копия JSON")} disabled={busy} onClick={() => void save("json")}/>
      </div>
      {error ? <p role="alert">{t(error)}</p> : null}
      {onRestore ? <HabitDataRestore key={restoreScope} scope={restoreScope} workspace={workspace} language={language} timeFormat={timeFormat} timeZone={timeZone} onRestore={onRestore} onPreview={onPreview} onRecovery={() => details.current?.setAttribute("open", "")} /> : null}
    </div>
  </details>;
}
