"use client";
import { useId, useRef, useState, type ReactNode } from "react";
import type { SharedTask, SharedTaskPage } from "./cloud-sync";
import { ExperimentalIcon } from "./ExperimentalIcon";
import { SharedTaskPageControls } from "./SharedTaskPageControls";
import { runtimeLocale, translateText as t } from "./i18n";

const BATCH_SIZE = 5;

/** UI batches stay small even when the API supplies a larger buffered page. */
export function SharedTaskBatches({tasks, page, busy, error, onMore, onRefresh, className, renderTask}: {
  tasks: readonly SharedTask[]; page: SharedTaskPage | null; busy: boolean; error?: string;
  onMore: () => Promise<boolean>; onRefresh: () => void; className: string; renderTask: (task: SharedTask) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(BATCH_SIZE * 2);
  const loading = useRef(false);
  const summary = useRef<HTMLElement>(null);
  const id = useId();
  const total = page?.total ?? tasks.length;
  const visible = Math.min(open ? limit : BATCH_SIZE, tasks.length);
  const nextCount = Math.min(BATCH_SIZE, Math.max(0, total - visible));
  const moreLabel = `${t("Показать ещё")} (${nextCount.toLocaleString(runtimeLocale())})`;
  const showMore = async (target = visible + BATCH_SIZE) => {
    if (busy || loading.current) return;
    if (target <= tasks.length || !page?.hasMore) { setLimit(target); return; }
    loading.current = true;
    try { if (await onMore()) setLimit(target); }
    finally { loading.current = false; }
  };
  const collapse = () => { setOpen(false); setLimit(BATCH_SIZE * 2); summary.current?.focus(); };
  return <div className="shared-task-batches">
    <div className={className}>{tasks.slice(0, BATCH_SIZE).map(renderTask)}</div>
    {total > BATCH_SIZE ? <details className="shared-task-batches-more" open={open} onToggle={event => {
      const expanded = event.currentTarget.open;
      setOpen(expanded);
      if (!expanded) setLimit(BATCH_SIZE * 2);
      else if (tasks.length <= BATCH_SIZE) void showMore(BATCH_SIZE * 2);
    }}>
      <summary ref={summary} aria-controls={id}><ExperimentalIcon name="chevron"/><span data-no-translate>{open ? t("Свернуть") : moreLabel}</span></summary>
      <div id={id} className={className}>{tasks.slice(BATCH_SIZE, limit).map(renderTask)}</div>
      <div className="shared-task-batches-actions">
        {nextCount ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void showMore()} data-no-translate>{busy ? t("Загрузка…") : moreLabel}</button> : null}
        <button type="button" className="secondary-button" onClick={collapse}>{t("Свернуть")}</button>
      </div>
    </details> : null}
    <SharedTaskPageControls page={page ? {...page, hasMore:false} : null} loaded={visible} busy={busy} error={error} onMore={() => undefined} onRefresh={onRefresh}/>
  </div>;
}
