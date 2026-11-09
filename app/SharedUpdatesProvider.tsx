"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { loadSharedOverview, loadSharedInbox, readSharedInbox, unreadSharedInbox, readSharedTaskUpdates, updateSharedNotificationDeviceContext, type SharedOverview, type SharedNotification } from "./cloud-sync";
type Updates = { overview: SharedOverview | null; comments: SharedNotification[]; error: boolean;
  notifications: SharedNotification[]; nextCursor: string | null; loadingMore: boolean; moreError: boolean; loadMore: () => Promise<void>;
  refresh: () => void; markRead: (ids: string[], all?: boolean) => Promise<void>;
  markUnread:(ids:string[])=>Promise<void>; unreadOnly:boolean; setUnreadOnly:(unread:boolean)=>void; loading:boolean;
  markTaskRead: (projectId: string, taskId: string, commentIds: string[], signal?: AbortSignal) => Promise<void> };
const UpdatesContext = createContext<Updates>({ overview: null, comments: [], notifications: [], nextCursor: null, loadingMore: false, moreError: false, loadMore: async () => {}, error: false, refresh: () => {}, markRead: async () => {}, markUnread:async()=>{},unreadOnly:true,setUnreadOnly:()=>{},loading:false, markTaskRead: async () => {} });

export function SharedUpdatesProvider({ userId, enabled, writeEnabled, children }: { userId: string; enabled: boolean; writeEnabled: boolean; children: ReactNode }) {
  const [overview, setOverview] = useState<SharedOverview | null>(null);
  const [unreadOnly,setUnreadOnly]=useState(true),[responseIdentity,setResponseIdentity]=useState<{userId:string;unreadOnly:boolean}|null>(null);
  const [notifications, setNotifications] = useState<SharedNotification[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const paging = useRef<AbortController | null>(null), refreshing = useRef<AbortController | null>(null), loaded = useRef(0), controllerRef = useRef<AbortController | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const readGeneration = useRef(0);
  const pendingReads = useRef(0);
  const contextPending=useRef<Promise<unknown>|null>(null);
  useEffect(()=>{
    contextPending.current=null;
    if(!enabled||!writeEnabled||!userId)return;const abort=new AbortController();let reported="";
    const report=()=>{const zone=Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC";if(reported===zone||document.visibilityState!=="visible"||!navigator.onLine)return;reported=zone;contextPending.current=updateSharedNotificationDeviceContext(zone,abort.signal).catch(()=>{reported="";});};
    report();window.addEventListener("focus",report);window.addEventListener("online",report);return()=>{abort.abort();window.removeEventListener("focus",report);window.removeEventListener("online",report);};
  },[userId,enabled,writeEnabled]);
  useEffect(() => {
    if (!enabled || !userId) return;
    const controller = new AbortController(); controllerRef.current = controller;
    const load = async () => {
      if (pendingReads.current || refreshing.current && !refreshing.current.signal.aborted || paging.current && !paging.current.signal.aborted || document.visibilityState !== "visible" || !navigator.onLine) return;
      refreshing.current = controller; const generation = readGeneration.current;
      try {
        await contextPending.current;if(controller.signal.aborted)return;
        const [totals, first] = await Promise.all([loadSharedOverview(controller.signal), loadSharedInbox({ unread: unreadOnly, signal: controller.signal })]);
        let inbox = first; const rows = [...first.notifications];
        // Refresh every loaded page so revoked access and reads on another device cannot leave stale items.
        while (inbox.nextCursor && rows.length < loaded.current && !controller.signal.aborted && generation === readGeneration.current) {
          inbox = await loadSharedInbox({ unread: unreadOnly, before: inbox.nextCursor, signal: controller.signal });
          rows.push(...inbox.notifications);
        }
        if (controller.signal.aborted || generation !== readGeneration.current) return;
        loaded.current = rows.length; setOverview(totals); setNotifications(rows);setResponseIdentity({userId,unreadOnly}); setNextCursor(inbox.nextCursor); setError(false); setMoreError(false);
      } catch { if (!controller.signal.aborted) { setError(true); setNotifications([]); setNextCursor(null); } }
      finally { if (refreshing.current === controller) refreshing.current = null; }
    };
    const timer = window.setTimeout(() => { setLoadingMore(false); void load(); }, 0);
    const poll = window.setInterval(() => void load(), 30000);
    const visible = () => void load();
    window.addEventListener("focus", visible); window.addEventListener("online", visible);
    document.addEventListener("visibilitychange", visible); window.addEventListener("genesis:shared-updates", visible);
    window.addEventListener("genesis:shared-inbox-read", refresh);
    return () => { controller.abort(); window.clearTimeout(timer); window.clearInterval(poll);
      window.removeEventListener("focus", visible); window.removeEventListener("online", visible);
      document.removeEventListener("visibilitychange", visible); window.removeEventListener("genesis:shared-updates", visible);
      window.removeEventListener("genesis:shared-inbox-read", refresh); };
  }, [enabled, userId, revision, refresh,unreadOnly]);
  const loadMore = useCallback(async () => {
    const controller = controllerRef.current;
    if (!enabled || pendingReads.current || !nextCursor || !controller || controller.signal.aborted || paging.current && !paging.current.signal.aborted || refreshing.current && !refreshing.current.signal.aborted) return;
    const generation = readGeneration.current; paging.current = controller; setLoadingMore(true); setMoreError(false);
    try {
      const result = await loadSharedInbox({ unread: unreadOnly, before: nextCursor, signal: controller.signal });
      if (controller.signal.aborted || generation !== readGeneration.current) return;
      setNotifications(current => {
        const rows = [...current, ...result.notifications.filter(item => !current.some(old => old.id === item.id))];
        loaded.current = rows.length; return rows;
      }); setNextCursor(result.nextCursor);
    } catch { if (!controller.signal.aborted) setMoreError(true); }
    finally { if (paging.current === controller) paging.current = null; if (!controller.signal.aborted) setLoadingMore(false); }
  }, [enabled, nextCursor,unreadOnly]);
  const markRead = useCallback(async (ids: string[], all = false) => {
    ++readGeneration.current; ++pendingReads.current;
    try {
      await readSharedInbox(ids, all);
      setNotifications(items => unreadOnly?(all ? [] : items.filter(item => !ids.includes(item.id))):items.map(item=>all||ids.includes(item.id)?{...item,isRead:1}:item));
    } finally { --pendingReads.current; ++readGeneration.current; refresh(); }
  }, [refresh,unreadOnly]);
  const markUnread=useCallback(async(ids:string[])=>{
    ++readGeneration.current; ++pendingReads.current;
    try{await unreadSharedInbox(ids);setNotifications(items=>items.map(item=>ids.includes(item.id)?{...item,isRead:0}:item));}
    finally{--pendingReads.current;++readGeneration.current;refresh();}
  },[refresh]);
  const markTaskRead = useCallback(async (projectId: string, taskId: string, commentIds: string[], signal?: AbortSignal) => {
    if (!writeEnabled) return;
    const generation = ++readGeneration.current;
    ++pendingReads.current;
    try {
      const result = await readSharedTaskUpdates(projectId, taskId, commentIds, signal);
      if (signal?.aborted || generation !== readGeneration.current) return;
      setOverview(result.overview);
      setNotifications(items => unreadOnly?items.filter(item => item.objectId !== taskId || item.action === "comment.created" && !commentIds.includes(item.commentId ?? "")):items.map(item=>item.objectId===taskId&&(!item.commentId||commentIds.includes(item.commentId))?{...item,isRead:1}:item));
      setError(false);
    } catch (error) { if (!signal?.aborted) setError(true); throw error; }
    finally { --pendingReads.current; ++readGeneration.current; refresh(); }
  }, [refresh,unreadOnly,writeEnabled]);
  const currentUser=responseIdentity?.userId===userId,currentMode=currentUser&&responseIdentity?.unreadOnly===unreadOnly;
  const comments = useMemo(() => notifications.filter(item => item.action === "comment.created"&&!item.isRead), [notifications]);
  return <UpdatesContext.Provider value={{ overview: enabled&&currentUser ? overview : null, comments: enabled&&currentMode ? comments : [], notifications: enabled&&currentMode ? notifications : [], nextCursor: enabled&&currentMode ? nextCursor : null, loadingMore, moreError, loadMore, error, refresh, markRead,markUnread,unreadOnly,setUnreadOnly,loading:enabled&&!currentMode&&!error, markTaskRead }}>{children}</UpdatesContext.Provider>;
}


export const useSharedUpdates = () => useContext(UpdatesContext);
