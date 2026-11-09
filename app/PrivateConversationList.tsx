"use client";
import { useEffect, useRef, useState } from "react";
import { ExperimentalIcon } from "./ExperimentalIcon";
import { collaborationText } from "./collaboration-copy";
import { translateText, type Language } from "./i18n";
import { privateContacts, type PrivateNotice } from "./private-messages-api";
import type { PrivateMessagePeer } from "./SharedMemberMessageButton";

/** The contact list only reads accepted-connection metadata; opening it never marks messages read. */
export function PrivateConversationList({ userId, language, active, onOpen }: {
  userId: string; language: string; active: boolean; onOpen: (peer: PrivateMessagePeer) => void;
}) {
  const [search, setSearch] = useState(""), [contacts, setContacts] = useState<PrivateNotice[]>([]);
  const [cursor, setCursor] = useState<string | null>(null), [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false), [revision, setRevision] = useState(0), [paging, setPaging] = useState(false);
  const [loadedKey,setLoadedKey]=useState('');
  const requestKey=JSON.stringify([userId,search,revision]);
  const visibleContacts=loadedKey===requestKey?contacts:[];
  const waiting=active&&(loadedKey!==requestKey||loading);
  const section=useRef<HTMLElement>(null);
  const pendingPage = useRef<AbortController | null>(null), generation = useRef(0);
  const c = (key: Parameters<typeof collaborationText>[0]) => collaborationText(key, language);
  const t = (text: string) => translateText(text, language as Language);
  useEffect(() => {
    const guard=generation, version = ++guard.current;
    pendingPage.current?.abort();
    if (!active) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true); setFailed(false); setPaging(false); setCursor(null);
      void privateContacts(search, null, controller.signal).then(result => {
        if (controller.signal.aborted || version !== guard.current) return;
        setContacts(result.contacts.filter(item => item.peerId !== userId)); setCursor(result.nextCursor);setLoadedKey(requestKey);
      }).catch(() => { if (!controller.signal.aborted){setContacts([]);setFailed(true);setLoadedKey(requestKey);} })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, search ? 250 : 0);
    return () => { controller.abort(); pendingPage.current?.abort(); window.clearTimeout(timer); guard.current++; };
  }, [userId, search, active, revision,requestKey]);
  useEffect(()=>{if(active)section.current?.focus({preventScroll:true});},[active]);
  useEffect(() => {
    if (!active) return;
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener("genesis:private-updates", refresh); window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => { window.removeEventListener("genesis:private-updates", refresh); window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); };
  }, [active]);
  const more = async () => {
    if (!cursor || paging || waiting) return;
    const controller = new AbortController(), version = generation.current;
    pendingPage.current = controller; setPaging(true); setFailed(false);
    try {
      const result = await privateContacts(search, cursor, controller.signal);
      if (controller.signal.aborted || version !== generation.current) return;
      setContacts(current => [...current, ...result.contacts.filter(item => item.peerId !== userId && !current.some(old => old.id === item.id))]);
      setCursor(result.nextCursor);
    } catch { if (!controller.signal.aborted) setFailed(true); }
    finally { if (!controller.signal.aborted) { pendingPage.current = null; setPaging(false); } }
  };
  return <section ref={section} tabIndex={-1} className="notification-contacts" aria-label={c("contacts")} data-no-translate>
    <label className="notification-contact-search"><span className="sr-only">{c("searchContacts")}</span>
      <ExperimentalIcon name="search" /><input type="search" maxLength={120} value={search}
        placeholder={c("searchContacts")} onChange={event => setSearch(event.target.value)} /></label>
    {waiting ? <p role="status">{t("Загрузка…")}</p> : null}
    {failed&&loadedKey===requestKey ? <p role="alert">{c("failure")} <button type="button" className="secondary-button" onClick={() => setRevision(value => value + 1)}>{t("Обновить")}</button></p> : null}
    {!waiting && !failed && !visibleContacts.length ? <div className="notification-contacts-empty"><p>{search ? t("Ничего не найдено") : c("contactsEmpty")}</p>{!search ? <p>{c("contactsHelp")}</p> : null}</div> : null}
    <ul className="notification-contact-list">{visibleContacts.map(contact => <li key={contact.id}>
      <button type="button" className="notification-contact" aria-label={`${c("write")} · ${contact.peerName} · ${contact.spaceTitle}`}
        onClick={() => onOpen({ spaceId: contact.spaceId, userId: contact.peerId, displayName: contact.peerName })}>
        <span className="notification-contact-copy"><strong>{contact.peerName}</strong><small>{contact.spaceTitle}</small></span>
        {contact.unread > 0 ? <span className="notification-contact-count">{new Intl.NumberFormat(language).format(contact.unread)}</span> : null}
        <ExperimentalIcon name="mail" />
      </button>
    </li>)}</ul>
    {cursor&&loadedKey===requestKey ? <button type="button" className="secondary-button notification-load-more" disabled={paging || waiting} onClick={() => void more()}>{t(paging ? "Загрузка…" : "Показать ещё")}</button> : null}
  </section>;
}
