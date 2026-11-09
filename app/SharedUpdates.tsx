"use client";
import { DialogCloseButton } from "./DialogCloseButton";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { loadSharedInbox, type SharedNotification } from "./cloud-sync";
import { useSharedUpdates } from "./SharedUpdatesProvider";
import { ExperimentalIcon } from "./ExperimentalIcon";
import "./shared-updates.css";
import { SharedInvitationNotices } from "./SharedInvitationNotices";
import { sharedUnreadCount } from "./shared-unread-count";
import { messengerText } from "./messenger-copy";

export type SharedTaskDestination = { spaceId: string; projectId: string; taskId?: string; taskAction?: "locate" | "comments"; commentId?: string };
export const notificationDestination = (item: SharedNotification): SharedTaskDestination => ({
  spaceId: item.spaceId, projectId: item.projectId, ...(item.action === "project.created" ? {} : { taskId: item.objectId }),
  ...(item.action === "comment.created" ? { taskAction: "comments", ...(item.commentId ? { commentId: item.commentId } : {}) } : {}),
});

export function SharedWorkspaceSummary({ userId, english, language, workspaceActions, onOpen }: { userId: string; english: boolean; language: string; workspaceActions?: (messagesButton: ReactNode) => ReactNode; onOpen: (place: SharedTaskDestination) => void }) {
  const { overview, error, refresh, markRead } = useSharedUpdates();
  const [open, setOpen] = useState(false); const [unread, setUnread] = useState(true);
  const [items, setItems] = useState<SharedNotification[]>([]); const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [failed, setFailed] = useState(false); const [reload, setReload] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null); const generation = useRef(0);
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
  useEffect(() => {
    const version = ++generation.current; if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setBusy(true); setFailed(false);
      void loadSharedInbox({ unread, signal: controller.signal }).then(result => {
        if (!controller.signal.aborted) { setItems(result.notifications); setCursor(result.nextCursor); }
      }).catch(() => { if (!controller.signal.aborted) setFailed(true); })
        .finally(() => { if (generation.current === version) setBusy(false); });
    }, 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [open, unread, reload]);
  const more = async () => {
    if (!cursor || busy) return; setBusy(true); setFailed(false); const version = generation.current;
    try { const result = await loadSharedInbox({ unread, before: cursor }); if (version !== generation.current) return;
      setItems(current => [...current, ...result.notifications.filter(item => !current.some(old => old.id === item.id))]); setCursor(result.nextCursor);
    } catch { if (version === generation.current) setFailed(true); }
    finally { if (version === generation.current) setBusy(false); }
  };
  const read = async (ids: string[], all = false, destination?: SharedTaskDestination) => {
    if (busy) return; setBusy(true); setFailed(false);
    if (destination) {
      setOpen(false); onOpen(destination);
      if (destination.taskId) { setBusy(false); return; }
    }
    try { await markRead(ids, all); setReload(value => value + 1);
    } catch { setFailed(true); } finally { setBusy(false); }
  };
  const newCount = sharedUnreadCount(overview);
  const messagesLabel = messengerText('title', language);
  const messagesButton = <button type="button" className="shared-updates-open secondary-button"
    title={messagesLabel} aria-label={`${messagesLabel}: ${newCount}`} aria-haspopup="dialog" onClick={() => setOpen(true)}>
    <ExperimentalIcon name="mail" /><strong className="shared-updates-badge" aria-hidden="true">{newCount > 99 ? "99+" : newCount}</strong>
  </button>;
  return <div className="shared-workspace-summary">
    <div className="shared-header-actions" role="group" aria-label={english ? "Workspace controls" : "Управление пространством"}>
      {workspaceActions ? workspaceActions(messagesButton) : messagesButton}
    </div>
    {error ? <button type="button" className="shared-summary-retry" onClick={refresh}>{english ? "Refresh summary" : "Обновить сводку"}</button> : null}
    <dialog className="shared-projects-modal shared-updates-dialog" ref={dialog} onCancel={() => setOpen(false)}
      aria-labelledby="shared-updates-title">
      <header><h2 id="shared-updates-title">{english ? "New in shared affairs" : "Новое в общих делах"}</h2>
        <DialogCloseButton type="button" className="shared-updates-close" aria-label={english ? "Close updates" : "Закрыть обновления"} onClick={() => setOpen(false)} /></header>
      <div className="shared-updates-toolbar"><div className="shared-updates-filter" role="group" aria-label={english ? "Updates filter" : "Фильтр обновлений"}>
        <button type="button" aria-pressed={unread} onClick={() => setUnread(true)}>{english ? "Unread" : "Непрочитанные"}</button>
        <button type="button" aria-pressed={!unread} onClick={() => setUnread(false)}>{english ? "All" : "Все"}</button></div>
        <button type="button" disabled={busy || !newCount} onClick={() => void read([], true)}>{english ? "Mark all as read" : "Прочитать всё"}</button></div>
      <p className="shared-updates-counts">{english ? "New tasks" : "Новых задач"}: {overview?.newTasks ?? "…"} · {english ? "New projects" : "Новых проектов"}: {overview?.newProjects ?? "…"} · {english ? "Comments" : "Комментариев"}: {overview?.newComments ?? "…"}</p>
      {failed ? <p role="alert">{english ? "Could not update notifications. Try again." : "Не удалось обновить уведомления. Повторите попытку."} <button type="button" disabled={busy} onClick={() => setReload(value => value + 1)}>{english ? "Retry" : "Повторить"}</button></p> : null}
      {open ? <SharedInvitationNotices userId={userId} english={english} persistent onAccepted={place => { setOpen(false); refresh(); onOpen(place); window.dispatchEvent(new Event("genesis:shared-updates")); }}/>:null}
      <ul className="shared-updates-list">{items.map(item => <li key={item.id} data-unread={!item.isRead || undefined}>
        <button type="button" className="shared-update-open" disabled={busy} onClick={() => void read([item.id], false, notificationDestination(item))}>
          <ExperimentalIcon name={item.action === "project.created" ? "projects" : item.action === "comment.created" ? "comment" : "plus"} />
          <span><small>{item.action === "project.created" ? (english ? "New project" : "Новый проект") : item.action === "comment.created" ? (english ? "New comment" : "Новый комментарий") : (english ? "New task" : "Новая задача")} · <span data-no-translate>{item.actorName}</span></small>
            <strong data-no-translate>{item.taskTitle || item.projectTitle}</strong>{item.commentBody ? <span data-no-translate>{item.commentBody}</span> : null}
            <small data-no-translate>{item.projectTitle}</small><time dateTime={item.createdAt}>{new Intl.DateTimeFormat(english ? "en" : "ru", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.createdAt))}</time><span className="shared-update-destination"><ExperimentalIcon name="open" />{item.action === "project.created" ? (english ? "Open project" : "Открыть проект") : (english ? "Open task" : "Открыть задачу")}</span></span>
        </button>
        {!item.isRead ? <button type="button" className="shared-update-read" disabled={busy} title={english ? "Mark as read" : "Отметить прочитанным"} aria-label={english ? `Mark as read: ${item.taskTitle || item.projectTitle}` : `Прочитать: ${item.taskTitle || item.projectTitle}`} onClick={() => void read([item.id])}><ExperimentalIcon name="check" /></button> : null}
      </li>)}</ul>
      {busy ? <p role="status">{english ? "Loading updates…" : "Загружаем обновления…"}</p> : !items.length && !failed ? <p>{english ? "No updates here." : "Здесь пока нет обновлений."}</p> : null}
      {cursor ? <button type="button" disabled={busy} onClick={() => void more()}>{english ? "Show more" : "Показать ещё"}</button> : null}
    </dialog>
  </div>;
}

export function SharedCommentNotices({ userId, english, onOpen }: { userId: string; english: boolean; onOpen: (place: SharedTaskDestination) => void }) {
  const { comments } = useSharedUpdates();
  const [hidden, setHidden] = useState<string[]>(() => { try { return JSON.parse(sessionStorage.getItem(`genesis-comment-notices:${userId}`) || "[]"); } catch { return []; } });
  const dismiss = (id: string) => { const next = [...hidden, id].slice(-500); setHidden(next); try { sessionStorage.setItem(`genesis-comment-notices:${userId}`, JSON.stringify(next)); } catch { /* Dismissal still works in memory. */ } };
  return <aside className="shared-comment-notices" aria-label={english ? "New task comments" : "Новые комментарии к задачам"} aria-live="polite">
    {comments.filter(item => !hidden.includes(item.id)).slice(0, 3).map(item => <article key={item.id}>
      <button type="button" className="shared-comment-notice-open" data-comment-id={item.commentId} onClick={() => onOpen(notificationDestination(item))}>
        <span className="shared-comment-notice-heading"><ExperimentalIcon name="comment" /><strong>{english ? "New comment" : "Новый комментарий"}</strong></span>
        <span><strong data-no-translate>{item.actorName}</strong> · <span data-no-translate>{item.taskTitle}</span></span>
        {item.commentBody ? <span className="shared-comment-preview" data-no-translate>{item.commentBody}</span> : null}
        <span className="shared-comment-notice-action"><ExperimentalIcon name="open" />{english ? "Open task" : "Открыть задачу"}</span>
      </button>
      <DialogCloseButton type="button" className="shared-comment-notice-dismiss" aria-label={english ? "Hide comment notification" : "Скрыть уведомление о комментарии"} onClick={() => dismiss(item.id)} />
    </article>)}
  </aside>;
}
