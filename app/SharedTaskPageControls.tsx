"use client";
import { runtimeLocale, translateText as t } from "./i18n";
import type { SharedTaskPage } from "./cloud-sync";

export function SharedTaskPageCount({loaded, total}: {loaded: number; total: number}) {
  return <span className="shared-task-page-count" aria-live="polite" data-no-translate>{t("Показано: {loaded} из {total}").replace("{loaded}",loaded.toLocaleString(runtimeLocale())).replace("{total}",total.toLocaleString(runtimeLocale()))}</span>;
}

export function SharedTaskPageControls({page, loaded, busy, onMore, onRefresh, error, showCount = true}: {
  page?: Omit<SharedTaskPage,"tasks"> | null; loaded: number; busy: boolean; onMore: () => void; onRefresh: () => void; error?: string; showCount?: boolean;
}) {
  if (!page && !error) return <p role="status">{t("Загрузка…")}</p>;
  if (!showCount && !page?.hasMore && !error) return null;
  return <div className="shared-detail-actions shared-task-page-controls" aria-live="polite">
    {page && showCount ? <SharedTaskPageCount loaded={loaded} total={page.total}/> : null}
    {page?.hasMore ? <button type="button" disabled={busy} onClick={onMore}>{t("Показать ещё")}</button> : null}
    {error ? <><p role="alert">{error}</p><button type="button" disabled={busy} onClick={onRefresh}>{t("Обновить")}</button></> : null}
  </div>;
}
