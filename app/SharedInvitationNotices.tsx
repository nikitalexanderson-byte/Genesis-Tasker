"use client";
import { DialogCloseButton } from "./DialogCloseButton";

import { useEffect, useRef, useState } from "react";
import { acceptSharedInvitation, rejectSharedInvitation, listSharedInvitations, type SharedInvitation } from "./cloud-sync";
import type { NoticeActivity } from "./notification-dock-model";
import "./shared-invitation-notices.css";

export type SharedInvitationDestination = { spaceId: string; projectId: string };

/** Mounted per account so a late response cannot appear in another account. */
export function SharedInvitationNotices({userId, english, onAccepted, persistent = false, onActivity}: {
  userId: string; english: boolean; onAccepted: (destination: SharedInvitationDestination) => void;
  persistent?: boolean;
  onActivity?: (activity: NoticeActivity) => void;
}) {
  const storageKey = `genesis-hidden-invitations:${userId}`;
  const [hidden, setHidden] = useState(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]");
      if (Array.isArray(saved)) return new Set(saved.filter((id): id is string => typeof id === "string").slice(-1000));
    } catch { /* Notices still work when storage is unavailable. */ }
    return new Set<string>();
  });
  const alive = useRef(false);
  const [invitations, setInvitations] = useState<SharedInvitation[]>([]);
  const [pending, setPending] = useState("");
  const [errorId, setErrorId] = useState("");
  const accepting = useRef(false);
  useEffect(() => { onActivity?.({ count: invitations.length, tokens: invitations.map(item => `invitation:${item.id}`), title: english ? "Workspace invitations" : "Приглашения в пространства" }); }, [invitations, english, onActivity]);

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    let loading = false;
    const refresh = async () => {
      if (loading || document.visibilityState !== "visible" || !navigator.onLine) return;
      loading = true;
      try {
        const items = await listSharedInvitations(controller.signal);
        if (alive.current) setInvitations(items);
      } catch { /* Retain current invitations until the next successful refresh. */ }
      finally { loading = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("genesis:shared-updates", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      alive.current = false; controller.abort(); window.clearInterval(timer);
      window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh);
      window.removeEventListener("genesis:shared-updates", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [storageKey, persistent]);

  const hide = (id: string, resolved = false) => {
    const next = new Set(hidden).add(id);
    setHidden(next);
    try { localStorage.setItem(storageKey, JSON.stringify([...next].slice(-1000))); } catch { /* Hide for this session. */ }
    if (resolved) setInvitations(items => items.filter(item => item.id !== id));
  };
  const accept = async (id: string) => {
    if (accepting.current) return;
    accepting.current = true; setPending(id); setErrorId("");
    try {
      const destination = await acceptSharedInvitation(id);
      if (!alive.current) return;
      hide(id, true); onAccepted(destination); window.dispatchEvent(new Event("genesis:shared-updates"));
    } catch { if (alive.current) setErrorId(id); }
    finally { accepting.current = false; if (alive.current) setPending(""); }
  };

  if (!invitations.length) return null;
  return <aside className={persistent ? "shared-persistent-invitations" : "shared-invitation-notices"} aria-label={english ? "Workspace invitations" : "Приглашения в пространства"} aria-live="polite" aria-relevant="additions">
    {!persistent && invitations.some(item=>hidden.has(item.id)) ? <button type="button" className="secondary-button shared-invitation-reopen" onClick={()=>{setHidden(new Set());try{localStorage.removeItem(storageKey);}catch{/* Restore invitations in this session. */}}}>{english ? "Workspace invitations" : "Приглашения в пространства"} · {invitations.length}</button> : null}
    {invitations.filter(item=>persistent||!hidden.has(item.id)).map(invitation => <section className="shared-invitation-notice" key={invitation.id}>
      <header><h2>{english ? "Workspace invitation" : "Приглашение в пространство"}</h2>
        {!persistent ? <DialogCloseButton type="button" className="shared-invitation-close" disabled={pending===invitation.id} onClick={() => hide(invitation.id)} aria-label={english ? "Hide invitation" : "Скрыть приглашение"} /> : null}</header>
      <strong className="shared-invitation-title" data-no-translate>{invitation.spaceTitle}</strong>
      <p><span data-no-translate>{invitation.inviterName}</span> · {english ? "invites you to join" : "приглашает присоединиться"}</p>
      {invitation.projectTitle ? <p data-no-translate>{invitation.projectTitle}</p> : null}
      {errorId===invitation.id ? <p role="alert">{english ? "Could not accept the invitation. Try again." : "Не удалось принять приглашение. Повторите попытку."}</p> : null}
      <button type="button" className="primary-button" disabled={Boolean(pending)} onClick={() => void accept(invitation.id)}>{pending===invitation.id ? (english ? "Accepting…" : "Принимаем…") : (english ? "Accept" : "Принять")}</button>
      {persistent ? <button type="button" className="secondary-button" disabled={Boolean(pending)} onClick={() => { if(accepting.current)return; accepting.current=true;setPending(invitation.id);void rejectSharedInvitation(invitation.id).then(()=>{if(alive.current)hide(invitation.id,true);}).catch(()=>{if(alive.current)setErrorId(invitation.id);}).finally(()=>{accepting.current=false;if(alive.current)setPending("");}); }}>{english ? "Decline" : "Отклонить"}</button> : null}
    </section>)}
  </aside>;
}
