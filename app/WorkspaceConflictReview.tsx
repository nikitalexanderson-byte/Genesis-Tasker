"use client";
import { useEffect, useState } from "react";
import type { Language } from "./i18n";
import { translateText } from "./i18n";
import { registerWorkspaceConflictReviewHandler, retryPendingWorkspaceSync, LOCAL_SESSION_ENDED_EVENT, type WorkspaceConflictReviewRequest } from "./cloud-sync";
import type { WorkspaceConflictChoices } from "./workspace-sync-state";
import { workspaceConflictCopy } from "./workspace-conflict-copy";
import { DialogCloseButton } from "./DialogCloseButton";
import { useDialogAccessibility } from "./use-dialog-accessibility";
import "./workspace-conflict-review.css";

const fieldNames: Record<string, string> = { title: "Название", description: "Описание", name: "Название", color: "Цвет", position: "Порядок", status: "Статус", tags: "Теги", priority: "Приоритет", completedTimes: "Выполнено", habitSettings: "Настройки привычек", userProgress: "Прогресс" };

export function WorkspaceConflictDialog({ request, language, onClose }: { request: WorkspaceConflictReviewRequest; language: Language; onClose: (saved: boolean) => void }) {
  const c = workspaceConflictCopy(language);
  const [review, setReview] = useState(request);
  const [choices, setChoices] = useState<WorkspaceConflictChoices>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const close = () => { if (!busy) { review.cancel(); onClose(false); } };
  const dialog = useDialogAccessibility<HTMLFormElement>(close);
  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; };
  }, []);
  const format = (value: unknown) => value === null || value === undefined ? c.removed
    : value === "" ? c.empty : typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const refresh = async () => {
    setBusy(true); setError("");
    try { setReview(await review.refresh()); setChoices({}); setStale(false); }
    catch { setError(c.error); }
    finally { setBusy(false); }
  };
  return <div className="modal-backdrop workspace-conflict-backdrop">
    <form ref={dialog} className="workspace-conflict-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-conflict-title" aria-describedby="workspace-conflict-intro" aria-busy={busy} tabIndex={-1} onSubmit={async event => {
      event.preventDefault(); if (busy || stale) return;
      setBusy(true); setError("");
      try { await review.confirm(Object.fromEntries(review.conflicts.map(row => [row.key, choices[row.key] ?? "remote"]))); onClose(true); }
      catch (reason) { const changed = reason instanceof Error && (reason.message === "WORKSPACE_REVIEW_STALE" || reason.message.includes("WORKSPACE_VERSION_CONFLICT")); setStale(changed); setError(changed ? c.stale : c.error); setBusy(false); }
    }}>
      <header><h2 id="workspace-conflict-title">{c.title}</h2><DialogCloseButton disabled={busy} onClick={close} aria-label={c.later} /></header>
      <p id="workspace-conflict-intro">{c.intro}</p>
      <div className="workspace-conflict-fields">
        {review.conflicts.map((row, index) => <fieldset key={row.key} disabled={busy}>
          <legend><strong>{!row.entityId && fieldNames[row.title] ? translateText(fieldNames[row.title], language) : row.title}</strong><span>{row.field ? (fieldNames[row.field] ? translateText(fieldNames[row.field], language) : `${c.field}: ${row.field}`) : c.field} · {index + 1}/{review.conflicts.length}</span></legend>
          <div className="workspace-conflict-options">{(["remote", "local"] as const).map(side => <label key={side} className={choices[row.key] === side || (!choices[row.key] && side === "remote") ? "selected" : ""}>
            <span><input type="radio" name={row.key} value={side} checked={(choices[row.key] ?? "remote") === side} onChange={() => setChoices(current => ({ ...current, [row.key]: side }))} /><strong>{c[side]}</strong></span>
            <pre>{format(row[side])}</pre>
          </label>)}</div>
        </fieldset>)}
      </div>
      {error && <p role="alert" className="workspace-conflict-error">{error}</p>}
      <footer><small>{c.privacy}</small><div>
        <button type="button" className="text-button workspace-conflict-refresh" title={c.refresh} aria-label={c.refresh} disabled={busy} onClick={() => void refresh()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M5.5 8a7 7 0 0 1 12-3L20 8M4 16l2.5 3a7 7 0 0 0 12-3" /></svg></button>
        <button type="button" className="text-button" disabled={busy} onClick={close}>{c.later}</button>
        <button type="submit" className="primary-button" disabled={busy || stale}>{busy ? c.saving : c.save}</button>
      </div></footer>
    </form>
  </div>;
}

export default function WorkspaceConflictReview({ language }: { language: Language }) {
  const [request, setRequest] = useState<WorkspaceConflictReviewRequest | null>(null);
  const [pending, setPending] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const c = workspaceConflictCopy(language);
  useEffect(() => registerWorkspaceConflictReviewHandler(next => { setRequest(next); setPending(true); }), []);
  useEffect(() => {
    const close = () => { setRequest(null); setPending(false); };
    window.addEventListener(LOCAL_SESSION_ENDED_EVENT, close);
    return () => window.removeEventListener(LOCAL_SESSION_ENDED_EVENT, close);
  }, []);
  return <>{request ? <WorkspaceConflictDialog key={request.conflicts.map(row => row.key).join()} request={request} language={language} onClose={saved => { setRequest(null); if (saved) setPending(false); }} /> : null}
    {pending && !request ? <button type="button" className="workspace-conflict-pending" disabled={retrying} onClick={async () => {
      setRetrying(true);
      try { await retryPendingWorkspaceSync(); setPending(false); } catch { /* Draft stays available for review. */ }
      finally { setRetrying(false); }
    }}>{c.pending}</button> : null}</>;
}
