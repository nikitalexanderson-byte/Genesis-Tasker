"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { querySharedTasks, type SharedTaskFilter, type SharedTaskPage, type SharedTaskSort } from "./cloud-sync";
import { sharedTaskDetailsError } from "./shared-task-details";
import { translateText } from "./i18n";

/** Bounded pages, refreshed on the existing five-second cadence. A changed generation replaces the collection. */
export function useSharedTaskPage(filter: SharedTaskFilter | null, sort: SharedTaskSort = "position", refreshKey?: unknown, ownerKey?: string) {
  const filterKey = JSON.stringify(filter);
  const key = JSON.stringify([filter, sort, ownerKey]);
  const [state, setState] = useState<{key: string; page: SharedTaskPage} | null>(null);
  const [failure, setFailure] = useState<{key:string;message:string} | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const loadingMore = useRef(false);
  const refreshing = useRef(false);
  const moreController = useRef<AbortController | null>(null);
  const error = failure?.key === key ? failure.message : "";
  const page = state?.key === key ? state.page : null;
  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (filterKey === "null" || loadingMore.current || refreshing.current) return;
    const current = ++request.current;
    refreshing.current = true;
    try {
      const result = await querySharedTasks(JSON.parse(filterKey), null, sort, signal);
      if (current !== request.current || signal?.aborted) return;
      setState(previous => ({key, page: previous?.key===key && previous.page.queryVersion===result.queryVersion ? {...result,tasks:previous.page.tasks,nextCursor:previous.page.nextCursor,hasMore:previous.page.hasMore} : result}));
      setFailure(null);
    } catch (error) {
      if (current === request.current && !signal?.aborted) { setFailure({key,message:sharedTaskDetailsError(error) ?? translateText(error instanceof Error ? error.message : "Не удалось загрузить данные")});
        if ((error instanceof Error && error.message.startsWith("VIEW_")) || (error && typeof error === "object" && "status" in error && [401,403,404].includes(Number(error.status)))) setState(null);
      }
    } finally { if (current === request.current) refreshing.current = false; }
  }, [key, filterKey, sort]);
  useEffect(() => {
    if (filterKey === "null") return;
    const controller = new AbortController();
    const invalidate = () => { ++request.current; refreshing.current=false; loadingMore.current=false; moreController.current?.abort(); };
    const initial = window.setTimeout(() => {setBusy(false);void refresh(controller.signal);}, 0);
    const timer = window.setInterval(() => { if (navigator.onLine && document.visibilityState === "visible") void refresh(controller.signal); }, 5000);
    const changed = () => void refresh(controller.signal);
    window.addEventListener("genesis:shared-updates", changed);
    return () => { invalidate(); controller.abort(); window.clearTimeout(initial); window.clearInterval(timer); window.removeEventListener("genesis:shared-updates", changed); };
  }, [refresh, refreshKey, filterKey]);
  const more = async () => {
    if (!filter || !page?.nextCursor || busy) return false;
    const current = ++request.current; loadingMore.current = true; refreshing.current=false; setBusy(true);
    const controller = new AbortController(); moreController.current=controller;
    try {
      const result = await querySharedTasks(filter, page.nextCursor, sort, controller.signal);
      if (current !== request.current) return false;
      setState({key,page:{...result,tasks:[...new Map([...page.tasks,...result.tasks].map(task=>[task.id,task])).values()]}}); setFailure(null);
      return true;
    } catch (error) {
      if (current !== request.current) return false;
      if (error instanceof Error && error.message === "SHARED_QUERY_CHANGED") { loadingMore.current = false; setBusy(false); await refresh(); }
      if ((error instanceof Error && error.message.startsWith("VIEW_")) || (error && typeof error === "object" && "status" in error && [401,403,404].includes(Number(error.status)))) setState(null);
      setFailure({key,message:sharedTaskDetailsError(error) ?? translateText(error instanceof Error ? error.message : "Не удалось загрузить данные")});
      return false;
    } finally { if (current === request.current) {loadingMore.current = false; setBusy(false);} }
  };
  return { page, error, busy, more, refresh };
}
