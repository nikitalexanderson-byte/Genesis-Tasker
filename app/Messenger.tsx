"use client";
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ExperimentalIcon } from './ExperimentalIcon';
import { DialogCloseButton } from './DialogCloseButton';
import { messengerRequest, messengerInbox, messengerChat, messengerContacts, messengerProjects, type MessengerChat, type MessengerContact, type MessengerMessage, type MessengerDevice, type ChatKind } from './messenger-api';
import { messengerDevice, messengerSecret, type LocalMessengerDevice } from './messenger-secrets';
import { messengerPending } from './private-message-vault';
import { encryptPrivateMessage, decryptPrivateMessage } from './private-message-crypto';
import type { NoticeActivity } from './notification-dock-model';
import copy from './messenger-copy.json';
import {GenesisApiError} from './cloud-sync';
import './messenger.css';
const Legacy = lazy(() => import('./SharedSpaceCollaboration').then(m => ({ default: m.SharedPrivateNotices })));
type CopyKey = keyof typeof copy.ru;
type DisplayMessage = MessengerMessage & {
    displayText: string;
    failed?: boolean;
};
type Pending = {
    method: string;
    path: string;
    body: Record<string, unknown>;
};
function MessengerIcon({ label, name, onClick, disabled = false }: {
    label: string;
    name: string;
    onClick: () => void;
    disabled?: boolean;
}) { return <button type="button" className="messenger-icon" title={label} aria-label={label} disabled={disabled} onClick={onClick}><ExperimentalIcon name={name}/></button>; }
function MessengerDialog({ title, closeLabel, close, children }: {
    title: string;
    closeLabel: string;
    close: () => void;
    children: ReactNode;
}) {
    const ref = useRef<HTMLDialogElement>(null);
    useEffect(() => { const d = ref.current; d?.showModal(); return () => d?.close(); }, []);
    return <dialog ref={ref} className="messenger-dialog" aria-label={title} onClose={close}><header><h3>{title}</h3><DialogCloseButton aria-label={closeLabel} onClick={close}/></header>{children}</dialog>;
}
/** Shares the existing Google session and account-generation cancellation in cloud-sync. */
export default function Messenger({ userId, language, active = true, view = 'contacts', onActivity, onConversationOpen, legacyEnabled = false }: {
    userId: string;
    language: string;
    active?: boolean;
    view?: 'contacts' | 'notices';
    onActivity?: (activity: NoticeActivity) => void;
    onConversationOpen?: () => void;
    legacyEnabled?: boolean;
}) {
    const c = (key: CopyKey) => ((copy as Record<string, Record<string, string>>)[language] ?? copy.en)[key] ?? copy.en[key];
    const [blocked,setBlocked]=useState<MessengerContact[]>([]);
    const [chats, setChats] = useState<MessengerChat[]>([]), [contacts, setContacts] = useState<MessengerContact[]>([]);
    const [hiddenChats,setHiddenChats]=useState<MessengerChat[]>([]),[showHidden,setShowHidden]=useState(false);
    const [selected, setSelected] = useState<MessengerChat | null>(null), [messages, setMessages] = useState<DisplayMessage[]>([]), [cursor, setCursor] = useState<number | null>(null);
    const [tab, setTab] = useState<'chats' | 'contacts' | 'legacy'>('chats'), [modal, setModal] = useState<'new' | 'members' | 'devices' | 'security' | null>(null);
    const [kind, setKind] = useState<ChatKind>('direct'), [email, setEmail] = useState(''), [title, setTitle] = useState(''), [project, setProject] = useState('');
    const [projects, setProjects] = useState<{
        id: string;
        title: string;
    }[]>([]), [devices, setDevices] = useState<MessengerDevice[]>([]);
    const [draft, setDraft] = useState(''), [editing, setEditing] = useState<DisplayMessage | null>(null), [pending, setPending] = useState<Pending | null>(null);
    const [pendingConflict, setPendingConflict] = useState(false);
    const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [code, setCode] = useState(''), [secretError, setSecretError] = useState('');
    const earlierLoaded = useRef(false);
    const generation = useRef(0), selection = useRef<string | null>(null), working = useRef(false), alive = useRef(true), device = useRef<LocalMessengerDevice | null>(null), createId = useRef('');
    const list = useRef<HTMLOListElement>(null);
    const path = (id: string, suffix = '') => '/conversations/' + encodeURIComponent(id) + suffix;
    function failure(e: unknown) { const msg = e instanceof Error ? e.message : ''; return msg.includes('CONTACT_UNAVAILABLE') ? c('contactUnavailable') : msg.includes('RATE_LIMIT') ? c('requestLimit') : c('failure'); }
    async function run(action: () => Promise<void>) { if (working.current)
        return; working.current = true; setBusy(true); setError(''); try {
        await action();
    }
    catch (e) {
        if (e instanceof GenesisApiError && e.status === 409) setPendingConflict(true);
        if (alive.current)
            setError(failure(e));
    }
    finally {
        working.current = false;
        if (alive.current)
            setBusy(false);
    } }
    const refresh = useCallback(async () => { const result = await messengerInbox(); if (alive.current) {
        setChats(result.conversations);setHiddenChats(result.hiddenConversations??[]); } }, []);
    async function visibility(chat:MessengerChat,action:'hide'|'show'|'delete') {
        await messengerRequest(path(chat.id,'/visibility'),'POST',{action});
        await refresh();
    }
    useEffect(() => { const guard=generation; alive.current = true; return () => { alive.current = false; guard.current++; }; }, [userId]);
    useEffect(() => {
        let stopped = false;
        const update = () => { if (stopped || !userId || document.visibilityState !== 'visible')
            return; void refresh().catch(() => { if (!stopped)
            setError(c('failure')); }); };
        update();
        const timer = window.setInterval(update, 5000);
        return () => { stopped = true; clearInterval(timer); };
        // Copy does not affect the account-scoped polling subscription.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId, refresh]);
    useEffect(() => { const unread = chats.filter(chat => chat.unread > 0 || chat.members.some(m => m.userId === userId && m.status === 'pending')); onActivity?.({ count: unread.reduce((n, chat) => n + Math.max(1, chat.unread), 0), tokens: unread.map(chat => 'private:messenger:' + chat.id + ':' + chat.updatedAt), title: c('title') }); }, [chats, userId, language, onActivity]); // eslint-disable-line react-hooks/exhaustive-deps
    async function localDevice() { return device.current ?? (device.current = await messengerDevice(userId)); }
    async function load(id: string, before = 0) {
        try { await loadChecked(id,before); }
        catch(e) { if(e instanceof GenesisApiError && [401,403,404].includes(e.status) && selection.current===id) { setMessages([]);setSecretError(c('failure')); } throw e; }
    }
    async function loadChecked(id: string, before = 0) {
        const version = generation.current, fresh = await messengerChat(id);
        if (version !== generation.current || selection.current !== id)
            return;
        setSelected(fresh);
        let secret: Awaited<ReturnType<typeof messengerSecret>> | null = null;
        const own = fresh.members.find(m => m.userId === userId);
        if (own?.status === 'pending')
            return;
        if (fresh.kind === 'secret') {
            try {
                secret = await messengerSecret(userId, fresh, await localDevice());
                if (version !== generation.current)
                    return;
                setCode(secret.code);
                setSecretError('');
            }
            catch (e) {
                if (version !== generation.current)
                    return;
                setMessages([]);
                setSecretError(e instanceof Error && e.message === 'MESSENGER_SECRET_DEVICE_ONLY' ? c('deviceOnly') : c('notReady'));
                return;
            }
        }
        const params = new URLSearchParams({ before: String(before), ...(fresh.kind === 'secret' ? { deviceId: device.current!.id } : {}) });
        const result = await messengerRequest<{
            messages: MessengerMessage[];
            nextCursor: number | null;
            clearedThrough?: number;
        }>(path(id, '/messages?' + params));
        const rows: DisplayMessage[] = await Promise.all(result.messages.map(async (row) => {
            if (row.deletedAt)
                return { ...row, displayText: c('deleted') };
            try {
                return { ...row, displayText: secret ? await decryptPrivateMessage(secret.key, { spaceId: 'messenger-secret-v1', conversationId: id, id: row.id, senderId: row.senderId, revision: row.revision }, row.payload!, secret.keyIds) : row.text ?? '' };
            }
            catch {
                return { ...row, displayText: c('decryptError'), failed: true };
            }
        }));
        if (version !== generation.current || selection.current !== id)
            return;
        const follow = !list.current || list.current.scrollHeight - list.current.scrollTop - list.current.clientHeight < 80;
        setMessages(previous => {const old=previous.filter(row=>row.seq>(result.clearedThrough??0));return before ? [...rows, ...old].filter((m, i, a) => a.findIndex(x => x.id === m.id) === i) : [...old.filter(m => rows[0] && m.seq < rows[0].seq), ...rows];});
        if(before)earlierLoaded.current=true;
        if(before||!earlierLoaded.current)setCursor(result.nextCursor);
        if (!before && follow)
            requestAnimationFrame(() => list.current?.scrollTo({ top: list.current.scrollHeight }));
        if (active && view === 'contacts' && document.visibilityState === 'visible' && rows.length && !rows.some(r => r.failed))
            await messengerRequest(path(id, '/read'), 'POST', { seq: rows.at(-1)!.seq, ...(secret ? { deviceId: device.current!.id } : {}) });
    }
    async function choose(chat: MessengerChat) {
        generation.current++;
        earlierLoaded.current=false;
        selection.current = chat.id;
        setSelected(chat);
        setMessages([]);
        setCursor(null);
        setDraft('');
        setEditing(null);
        setPending(null);
        setPendingConflict(false);
        setCode('');
        setSecretError('');
        setTab('chats');
        setError('');
        onConversationOpen?.();
        setLoading(true);
        try {
            const saved = await messengerPending(userId, chat.id);
            if (selection.current !== chat.id)
                return;
            if (saved)
                setPending(JSON.parse(saved));
            const recovered = await messengerPending(userId, 'draft:' + chat.id);
            if (selection.current !== chat.id) return;
            if (recovered) setDraft(recovered);
            await load(chat.id);
        }
        finally {
            if (selection.current === chat.id)
                setLoading(false);
        }
    }
    useEffect(() => {
        if (!selected?.id || !active || view !== 'contacts')
            return;
        const id = selected.id;
        const timer = window.setInterval(() => { if (!working.current && document.visibilityState === 'visible')
            void load(id).catch(() => { if (selection.current === id)
                setError(c('failure')); }); }, 5000);
        return () => clearInterval(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selected?.id, active, view, language]);
    const back = () => { generation.current++; selection.current = null; setSelected(null); setMessages([]); setDraft(''); setEditing(null); setPending(null); setSecretError(''); setError(''); };
    async function selectContacts() { setTab('contacts');const result=await messengerContacts();setContacts(result.contacts);setBlocked(result.blocked); }
    async function submit() {
        if (!selected)
            return;
        const id = selected.id;
        let command = pending;
        if (!command) {
            const fresh = await messengerChat(id), mid = editing?.id ?? crypto.randomUUID(), body: Record<string, unknown> = { id: mid };
            if (editing)
                body.expectedRevision = editing.revision;
            if (fresh.kind === 'secret') {
                const d = await localDevice(), secret = await messengerSecret(userId, fresh, d);
                body.deviceId = d.id;
                body.payload = await encryptPrivateMessage(secret.key, { spaceId: 'messenger-secret-v1', conversationId: id, id: mid, senderId: userId, revision: (editing?.revision ?? 0) + 1 }, draft, secret.keyIds);
            }
            else
                body.text = draft;
            command = { method: editing ? 'PATCH' : 'POST', path: path(id, '/messages' + (editing ? '/' + mid : '')), body };
            await messengerPending(userId, id, JSON.stringify(command));
            setPending(command);
        }
        await messengerRequest(command.path, command.method, command.body);
        await messengerPending(userId, id, null);
        await messengerPending(userId, 'draft:' + id, null);
        if (selection.current !== id)
            return;
        setPending(null);
        setPendingConflict(false);
        setDraft('');
        setEditing(null);
        await load(id);
        await refresh();
    }
    async function recoverPendingConflict() {
        if (!selected || !pending || !pendingConflict) return;
        const id = selected.id;
        const fresh = await messengerChat(id);
        let text = draft;
        if (pending.method !== 'DELETE') {
            if (fresh.kind === 'secret') {
                const secret = await messengerSecret(userId, fresh, await localDevice());
                text = await decryptPrivateMessage(secret.key, { spaceId: 'messenger-secret-v1', conversationId: id,
                    id: String(pending.body.id), senderId: userId, revision: Number(pending.body.expectedRevision ?? 0) + 1 },
                    pending.body.payload as Parameters<typeof decryptPrivateMessage>[2], secret.keyIds);
            } else {
                if (typeof pending.body.text !== 'string') throw new Error('INVALID_PENDING_TEXT');
                text = pending.body.text;
            }
        }
        // Persist the recovered text before releasing the rejected command.
        await messengerPending(userId, 'draft:' + id, text);
        await messengerPending(userId, id, null);
        if (selection.current !== id) return;
        setPending(null); setPendingConflict(false); setEditing(null); setDraft(text);
        await load(id);
    }
    async function membership(action: string, extra: Record<string, unknown> = {}) { if (!selected)
        return; const id = selected.id; const deviceId = selected.kind === 'secret' && action === 'accept' ? (await localDevice()).id : undefined; await messengerRequest(path(id, '/membership'), 'POST', { action, ...extra, ...(deviceId ? { deviceId } : {}) }); if (action === 'decline' || action === 'leave')
        back();
    else
        await load(id); await refresh(); }
    async function create() { if (!createId.current)
        createId.current = crypto.randomUUID(); const chat = await messengerRequest<MessengerChat>('/conversations', 'POST', { id: createId.current, kind, ...(kind === 'project' ? { projectId: project } : kind === 'group' ? { title, emails: email.split(',').map(x => x.trim()).filter(Boolean) } : { email }), ...(kind === 'secret' ? { deviceId: (await localDevice()).id } : {}) }); setModal(null); createId.current = ''; setEmail(''); setTitle(''); await refresh(); await choose(chat); }
    useEffect(() => {
        const open=(event:Event)=>{
            const detail=(event as CustomEvent<{userId?:string;projectId?:string}>).detail;
            if(!userId||!detail)return;
            const input=detail.projectId?{kind:'project',projectId:detail.projectId}:detail.userId?{kind:'direct',userId:detail.userId}:null;
            if(input)void run(async()=>{const target=await messengerRequest<MessengerChat>('/conversations','POST',{id:crypto.randomUUID(),...input});await choose(target);await refresh();});
        };
        window.addEventListener('genesis:messenger-peer',open);window.addEventListener('genesis:messenger-project',open);
        return()=>{window.removeEventListener('genesis:messenger-peer',open);window.removeEventListener('genesis:messenger-project',open);};
        // Event handlers use the current account and visible panel callbacks.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    },[userId,onConversationOpen]);
    const own = selected?.members.find(m => m.userId === userId), peer = selected?.members.find(m => m.userId !== userId);
    const ready = selected && own?.status !== 'pending' && !secretError;
    if (view === 'notices')
        return <aside aria-live="polite">{chats.filter(chat => chat.unread > 0 || chat.members.some(m => m.userId === userId && m.status === 'pending')).map(chat => <button type="button" className="shared-private-notice" key={chat.id} onClick={() => void run(() => choose(chat))}><strong>{chat.title}</strong><span>{c(chat.kind)} · {chat.unread}</span></button>)}</aside>;
    return <section className="messenger" aria-label={c('title')} data-no-translate>
    <header className="messenger-toolbar">{selected ? <MessengerIcon label={c('back')} name="chevron-left" onClick={back} disabled={busy}/> : null}<h3>{selected?.title ?? c('title')}</h3>{selected ? <><MessengerIcon label={c('members')} name="team" onClick={() => setModal('members')} disabled={busy}/><MessengerIcon label={c('refresh')} name="map-refresh" onClick={() => void run(async () => { await refresh(); await load(selected.id); })} disabled={busy}/>{selected.kind === 'secret' && code ? <MessengerIcon label={c('security')} name="lock" onClick={() => setModal('security')} disabled={busy}/> : null}</> : null}</header>
    {busy || loading ? <div role="status" className="messenger-loading"><span />{c('loading')}</div> : null}{error ? <p role="alert" className="messenger-error">{error}</p> : null}
    {!selected ? <><div className="messenger-tabs connected-submenu" role="group" aria-label={c('title')}><button type="button" aria-pressed={tab !== 'contacts'} onClick={() => setTab('chats')}>{c('chats')}</button><button type="button" aria-pressed={tab === 'contacts'} onClick={() => void run(selectContacts)}>{c('contacts')}</button></div>
      {tab === 'chats' ? <div className="messenger-conversation-actions">
        <MessengerIcon label={c('newChat')} name="mail" onClick={() => { setModal('new'); createId.current = ''; void messengerProjects().then(r => setProjects(r.projects)).catch(() => setProjects([])); }} disabled={busy}/>
        <MessengerIcon label={c('refresh')} name="map-refresh" onClick={() => void run(refresh)} disabled={busy}/>
        <MessengerIcon label={c('devices')} name="account" onClick={() => void run(async () => { setDevices((await messengerRequest<{ devices: MessengerDevice[] }>('/devices')).devices); setModal('devices'); })} disabled={busy}/>
        <MessengerIcon label={c('legacy')} name="history" onClick={() => setTab('legacy')} disabled={busy || !legacyEnabled}/>
        <MessengerIcon label={showHidden?c('chats'):c('hiddenChats')} name="eye-off" onClick={()=>setShowHidden(value=>!value)} disabled={busy}/>
      </div> : null}
      {tab === 'chats' ? <>{showHidden?<h4>{c('hiddenChats')}</h4>:null}<ul className="messenger-list">{!(showHidden?hiddenChats:chats).length ? <li><p>{showHidden?c('hiddenEmpty'):c('empty')}</p></li> : (showHidden?hiddenChats:chats).map(chat => <li key={chat.id}><button type="button" onClick={() => void run(() => choose(chat))} disabled={busy}><ExperimentalIcon name={chat.kind === 'secret' ? 'lock' : chat.kind === 'project' ? 'projects' : 'mail'}/><span><strong>{chat.title}</strong><small>{c(chat.kind)}{chat.members.some(m => m.userId === userId && m.status === 'pending') ? ' · ' + c('invitation') : ''}</small></span>{chat.unread ? <b>{chat.unread}</b> : null}</button><MessengerIcon label={(showHidden?c('showChat'):c('hideChat'))+' · '+chat.title} name={showHidden?'eye':'eye-off'} disabled={busy} onClick={()=>void run(()=>visibility(chat,showHidden?'show':'hide'))}/><MessengerIcon label={c('deleteChat')+' · '+chat.title} name="trash" disabled={busy} onClick={()=>{if(confirm(c('confirmDeleteChat')))void run(()=>visibility(chat,'delete'));}}/></li>)}</ul></> : null}
      {tab === 'contacts' ? <><form className="messenger-compose" onSubmit={e => { e.preventDefault(); void run(async () => { setContacts((await messengerRequest<{
            contacts: MessengerContact[];
        }>('/contacts', 'POST', { email })).contacts); setEmail(''); }); }}><label className="sr-only" htmlFor="messenger-contact-email">{c('email')}</label><input id="messenger-contact-email" type="email" required value={email} maxLength={254} placeholder={c('email')} onChange={e => setEmail(e.target.value)}/>{<MessengerIcon label={c('addContact')} name={'plus'} onClick={() => void run(async () => { setContacts((await messengerRequest<{
            contacts: MessengerContact[];
        }>('/contacts', 'POST', { email })).contacts); setEmail(''); })} disabled={busy}/>}</form><ul className="messenger-list">{!contacts.length ? <li><p>{c('contactEmpty')}</p></li> : contacts.map(contact => <li key={contact.userId}><button type="button" onClick={() => void run(async () => { const chat = await messengerRequest<MessengerChat>('/conversations', 'POST', { id: crypto.randomUUID(), kind: 'direct', email: contact.email }); await choose(chat); })}><span><strong>{contact.name}</strong><small>{contact.email}</small></span><ExperimentalIcon name="mail"/></button>{<MessengerIcon label={c('removeContact')} name={'trash'} onClick={() => void run(async () => { await messengerRequest('/contacts', 'DELETE', { userId: contact.userId }); await selectContacts(); })} disabled={busy}/>}</li>)}</ul>{blocked.map(contact=><div className="messenger-compose" key={'blocked:'+contact.userId}><span>{contact.name}</span><button type="button" disabled={busy} onClick={()=>void run(async()=>{await messengerRequest('/blocks','POST',{userId:contact.userId,blocked:false});await selectContacts();})}>{c('unblock')}</button></div>)}</> : null}
      {tab === 'legacy' ? <><p>{c('legacyHelp')}</p><Suspense fallback={<p>{c('loading')}</p>}><Legacy userId={userId} language={language} embedded view="contacts" active={active}/></Suspense></> : null}
    </> : <><details className="messenger-help"><summary>{c(selected.kind)}</summary><p>{c(selected.kind === 'secret' ? 'secretHelp' : 'cloudHelp')}</p>{selected.kind === 'project' ? <p>{c('projectHelp')}</p> : null}</details>
      {own?.status === 'pending' ? <div className="messenger-invitation"><p>{c('invitation')}</p><div className="messenger-actions"><button type="button" disabled={busy} onClick={() => void run(() => membership('accept'))}>{c('accept')}</button><button type="button" disabled={busy} onClick={() => void run(() => membership('decline'))}>{c('decline')}</button></div></div> : null}
      {secretError ? <p role="status">{secretError}</p> : null}
      <ol ref={list} className="messenger-messages" aria-live="polite">{cursor ? <li><button type="button" disabled={busy} onClick={() => void run(() => load(selected.id, cursor))}>{c('older')}</button></li> : null}{messages.map(m => <li key={m.id} data-self={m.senderId === userId || undefined}><header><strong>{m.senderId === userId ? c('you') : selected.members.find(member => member.userId === m.senderId)?.name ?? ''}</strong><time dateTime={m.createdAt}>{new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(m.createdAt))}</time></header><p>{m.displayText}</p>{!m.deletedAt && m.senderId === userId ? <div className="messenger-message-actions">{<MessengerIcon label={c('edit')} name={'edit'} onClick={() => { setEditing(m); setDraft(m.displayText); }} disabled={busy || !!pending || !!m.failed}/>}{<MessengerIcon label={c('delete')} name={'trash'} onClick={() => { if (confirm(c('confirmDelete')))
            void run(async () => { const body = { expectedRevision: m.revision, ...(selected.kind === 'secret' ? { deviceId: (await localDevice()).id } : {}) }; await messengerRequest(path(selected.id, '/messages/' + m.id), 'DELETE', body); await load(selected.id); }); }} disabled={busy || !!pending}/>}</div> : null}</li>)}</ol>
      {pending ? <p role="status">{c('pending')}</p> : null}
      {pending && pendingConflict ? <button type="button" disabled={busy} onClick={() => void run(recoverPendingConflict)}>{c('recoverPending')}</button> : null}
      {ready ? <form className="messenger-compose" onSubmit={e => { e.preventDefault(); void run(submit); }}><label className="sr-only" htmlFor="messenger-draft">{c('message')}</label><textarea id="messenger-draft" maxLength={12000} value={draft} disabled={busy || !!pending} placeholder={c('message')} onChange={e => setDraft(e.target.value)}/><button type="submit" className="messenger-icon" aria-label={c(pending ? 'retry' : editing ? 'save' : 'send')} title={c(pending ? 'retry' : editing ? 'save' : 'send')} disabled={busy || (!pending && !draft.trim())}><ExperimentalIcon name="send"/></button>{editing && !pending ? <MessengerIcon label={c('cancel')} name={'close'} onClick={() => { setEditing(null); setDraft(''); }} disabled={busy}/> : null}</form> : null}
    </>}
    {modal === 'new' ? <MessengerDialog closeLabel={c('close')} title={c('newChat')} close={() => setModal(null)}><form onSubmit={e => { e.preventDefault(); void run(create); }}><div className="messenger-kind" role="group" aria-label={c('newChat')}>{(['direct', 'group', 'project', 'secret'] as const).map(k => <button type="button" key={k} aria-label={c(k)} title={c(k)} aria-pressed={kind === k} onClick={() => { setKind(k); createId.current = ''; }}>{k === 'project' ? 'PRO' : <ExperimentalIcon name={k === 'direct' ? 'account' : k === 'group' ? 'team' : 'eye'}/>}</button>)}</div>
      {kind === 'project' ? <label>{c('chooseProject')}<select value={project} required onChange={e => setProject(e.target.value)}><option value="">{c(projects.length ? 'chooseProject' : 'noProjects')}</option>{projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label> : <><label>{c(kind === 'group' ? 'emails' : 'email')}<input type={kind === 'group' ? 'text' : 'email'} required value={email} maxLength={12000} onChange={e => setEmail(e.target.value)}/></label>{kind === 'group' ? <label>{c('groupName')}<input value={title} required maxLength={120} onChange={e => setTitle(e.target.value)}/></label> : null}</>}
      <p>{c(kind === 'secret' ? 'secretHelp' : 'cloudHelp')}</p><div className="messenger-actions"><button type="button" onClick={() => setModal(null)}>{c('cancel')}</button><button type="submit" disabled={busy}>{c('create')}</button></div>{error ? <p role="alert">{error}</p> : null}</form></MessengerDialog> : null}
    {modal === 'security' ? <MessengerDialog closeLabel={c('close')} title={c('security')} close={() => setModal(null)}><p className="messenger-code">{code}</p><p>{c('securityHelp')}</p></MessengerDialog> : null}
    {modal === 'devices' ? <MessengerDialog closeLabel={c('close')} title={c('devices')} close={() => setModal(null)}><ul className="messenger-list">{devices.map(d => <li key={d.id}><span>{d.label}<small>{new Intl.DateTimeFormat(language, { dateStyle: 'short' }).format(new Date(d.createdAt))}{d.revokedAt ? ' · ' + c('revoked') : ''}</small></span>{!d.revokedAt ? <MessengerIcon label={c('revoke')} name={'close'} onClick={() => { if (confirm(c('confirmRevoke')))
        void run(async () => { await messengerRequest('/devices/' + d.id, 'DELETE'); setDevices((await messengerRequest<{
            devices: MessengerDevice[];
        }>('/devices')).devices); }); }} disabled={busy}/> : null}</li>)}</ul></MessengerDialog> : null}
    {modal === 'members' && selected ? <MessengerDialog closeLabel={c('close')} title={c('members')} close={() => setModal(null)}><ul className="messenger-list">{selected.members.map(m => <li key={m.userId}><span>{m.name}<small>{m.status === 'pending' ? c('waiting') : ''}</small></span>{selected.kind === 'group' && own?.role === 'owner' && m.userId !== userId ? <MessengerIcon label={c('removeMember')} name={'close'} onClick={() => void run(() => membership('remove', { userId: m.userId }))} disabled={busy}/> : null}{selected.kind === 'group' && own?.role === 'owner' && m.status === 'active' && m.userId !== userId ? <MessengerIcon label={c('transfer')} name={'team'} onClick={() => void run(() => membership('transfer', { userId: m.userId }))} disabled={busy}/> : null}</li>)}</ul>
      {selected.kind === 'group' && own?.role === 'owner' ? <form className="messenger-compose" onSubmit={e => { e.preventDefault(); void run(async () => { await membership('add', { email }); setEmail(''); }); }}><input type="email" value={email} required placeholder={c('email')} aria-label={c('email')} onChange={e => setEmail(e.target.value)}/><button type="submit" disabled={busy}>{c('addMember')}</button></form> : null}
      {selected.kind === 'group' && own?.role !== 'owner' ? <button type="button" disabled={busy} onClick={() => void run(async () => { await membership('leave'); setModal(null); })}>{c('leave')}</button> : null}
      {peer && ['direct', 'secret'].includes(selected.kind) ? <button type="button" disabled={busy} onClick={() => { if (confirm(c('confirmBlock')))
            void run(async () => { await messengerRequest('/blocks', 'POST', { userId: peer.userId, blocked: true }); setModal(null); back(); await refresh(); }); }}>{c('block')}</button> : null}
    </MessengerDialog> : null}
  </section>;
}
