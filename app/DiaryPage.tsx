"use client";
import { useEffect, useRef, useState, type FormEvent, type CSSProperties } from 'react';
import { useDiary } from './DiaryProvider';
import { DIARY_COLORS, newDiaryNote, restoreDiaryNote, diaryCustomInk, diaryNoteCategory, type DiaryNote, type DiaryCategory } from './diary-model';
import type { DiaryRecord } from './diary-storage';
import copy from './diary-copy.json';
import { diaryCopy } from './diary-copy';
import { DiarySettings, DiaryDeleteDialog } from './DiarySettings';
import { DiaryMark } from './DiaryLaunchButton';
import { ExperimentalIcon } from './ExperimentalIcon';
import { DialogCloseButton } from './DialogCloseButton';
import { useDialogAccessibility } from './use-dialog-accessibility';
import './diary.css';
import { originalAdvicePreview } from './advice-text';
import { AdviceBodyText } from './AdviceBodyText';

export function AdviceDislikeIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 14V3h4v11h-4Zm0-10H6a2 2 0 0 0-2 1.7l-1 6A2 2 0 0 0 5 14h5v4a3 3 0 0 0 3 3l4-7"/></svg>;
}
type Copy = typeof copy.ru;
function customNoteStyle(color?: string): CSSProperties | undefined {
  if (!color) return undefined;
  const ink = diaryCustomInk(color);
  return { '--note-paper': color, '--note-ink': ink, '--note-soft': ink } as CSSProperties;
}
function NoteEditor({ record, language, onClose, onSaved }: { record?: DiaryRecord; language: string; onClose: () => void; onSaved: (note: DiaryNote) => void }) {
  const text: Copy = diaryCopy(language); const diary = useDiary();
  const [note, setNote] = useState<DiaryNote>(() => record?.note ?? newDiaryNote());
  const [error, setError] = useState(''); const [draftStatus, setDraftStatus] = useState(''); const [saving, setSaving] = useState(false);
  const actions = useRef(diary); useEffect(() => { actions.current = diary; }, [diary]);
  const [baseline] = useState(() => JSON.stringify(record?.note ?? note));
  const changed = JSON.stringify(note) !== baseline;
  const persistDraft = async () => {
    if (!note.body.trim() || !changed) return true;
    try { await actions.current.keepDraft(note, record); setDraftStatus(text.draftSaved); return true; }
    catch { setError(text.draftError); return false; }
  };
  const close = async () => { if (!saving && await persistDraft()) { if (!changed && !record?.draftKey) diary.discardOwn(note.id); onClose(); } };
  const ref = useDialogAccessibility<HTMLElement>(() => { void close(); });
  useEffect(() => {
    if (!changed || !note.body.trim() || saving) return;
    const timer = window.setTimeout(() => { void actions.current.keepDraft(note, record).then(() => setDraftStatus(text.draftSaved)).catch(() => setError(text.draftError)); }, 650);
    return () => window.clearTimeout(timer);
  }, [note, record, changed, saving, text]);
  const save = async (event?: FormEvent, asCopy = false) => {
    event?.preventDefault(); setError(''); setSaving(true);
    const value = { ...note, updatedAt: new Date().toISOString() };
    try {
      const saved = asCopy ? { ...value, id: crypto.randomUUID(), advice: undefined, reaction: null, archived: false, createdAt: value.updatedAt } : value;
      await diary.save(saved, asCopy ? undefined : record);
      if (asCopy) { if (record?.draftKey) diary.discard(record.draftKey); else diary.discardOwn(note.id); }
      onSaved(saved);
    } catch (failure) { setError(failure instanceof Error && /DIARY_(REVISION_CONFLICT|NOTE_DELETED|LOCAL_UPLOAD_PENDING)/.test(failure.message) ? text.conflict : text.error); }
    finally { setSaving(false); }
  };
  return <div className="modal-backdrop"><section className="modal diary-editor" data-exp-ui="dialog" ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="diary-editor-title" data-no-translate>
    <header><h2 id="diary-editor-title">{record ? text.editing : text.newNote}</h2><DialogCloseButton aria-label={text.closeDraft} disabled={saving} onClick={() => void close()} /></header>
    <form onSubmit={event => void save(event)}>
      <label>{text.heading}<input data-dialog-initial-focus value={note.title} maxLength={200} onChange={event => setNote({ ...note, title: event.target.value })} /></label>
      <label>{text.body}<textarea required maxLength={30000} value={note.body} onChange={event => setNote({ ...note, body: event.target.value })} /></label>
      <fieldset className="diary-color-options"><legend>{text.color}</legend>{DIARY_COLORS.map((color, index) => <label key={color} data-color={color}><input type="radio" name="diary-color" value={color} checked={!note.customColor && note.color === color} onChange={() => setNote({ ...note, color, customColor: undefined })}/><span>{text.colors[index]}</span></label>)}
        <label className="diary-custom-color" style={customNoteStyle(note.customColor)}><ExperimentalIcon name="palette"/><span>{text.customColor}</span><input type="color" aria-label={text.customColor} value={note.customColor ?? '#a9c5ac'} disabled={saving} onChange={event => setNote({ ...note, customColor: event.target.value })}/></label>
      </fieldset>
      {note.advice ? <details className="diary-advice-source"><summary>{text.readOnlyAdvice}</summary><AdviceBodyText advice={note.advice}/>{note.advice.sources.map((source, index) => <p key={index}>{text.source}: {[note.advice?.collection === 'philosophers' ? '' : source.author, source.work, source.reference].filter(Boolean).join(' · ')}</p>)}</details> : null}
      {error ? <div role="alert" className="diary-notice"><p>{error}</p>{error === text.conflict ? <button type="button" data-dialog-save="false" disabled={saving} onClick={() => void save(undefined, true)}>{text.copy}</button> : null}</div> : null}
      <p className="diary-save-state" role="status">{draftStatus || text.private}</p>
      <footer><button className="primary-button" type="submit" disabled={!note.body.trim() || saving || diary.busy}><ExperimentalIcon name="save"/>{text.save}</button><button type="button" disabled={saving} onClick={() => void close()}>{text.cancel}</button></footer>
    </form>
  </section></div>;
}
export default function DiaryPage({ language, onClose }: { language: string; onClose: () => void }) {
  const text = diaryCopy(language); const diary = useDiary();
  const [category, setCategory] = useState<DiaryCategory>('personal');
  const [tab, setTab] = useState<'board' | 'favorites' | 'archive'>('board'); const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<DiaryRecord | 'new' | null>(null); const [error, setError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false); const [deleting, setDeleting] = useState<DiaryRecord | null>(null);
  const categoryRecords = diary.records.filter(row => diaryNoteCategory(row.note) === category);
  const drafts = categoryRecords.filter(row => row.draftKey);
  const notes = categoryRecords.filter(row => !row.draftKey && (tab === 'archive' ? row.note.archived : !row.note.archived && (tab !== 'favorites' || row.note.reaction === 'favorite'))
    && `${row.note.title}\n${row.note.body}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .toSorted((a, b) => Number(b.note.pinned) - Number(a.note.pinned) || b.note.updatedAt.localeCompare(a.note.updatedAt));
  const counts: Record<DiaryCategory, number> = {personal: 0, saved: 0};
  for (const row of diary.records) {
    const section = diaryNoteCategory(row.note);
    if (section && !row.draftKey && !row.note.archived) counts[section]++;
  }
  const chooseCategory = (value: DiaryCategory) => { setCategory(value); setTab('board'); };
  const onSaved = (note: DiaryNote) => {
    const destination = diaryNoteCategory(note);
    const created = editing === 'new' || Boolean(editing && editing.note.id !== note.id);
    if (destination && (destination !== category || created)) chooseCategory(destination);
    if (created) setQuery('');
    setEditing(null);
  };
  const change = async (row: DiaryRecord, note: DiaryNote) => {
    setError(''); try { await diary.save({ ...note, updatedAt: new Date().toISOString() }, row); }
    catch (failure) { setError(failure instanceof Error && failure.message.includes('DIARY_REVISION_CONFLICT') ? text.conflict : text.error); }
  };
  return <section className="diary-page" aria-label={text.title} data-no-translate>
    <header className="workspace-header diary-heading" data-exp-ui="panel">
      <div className="workspace-header-main"><button type="button" className="diary-back" aria-label={tab === 'board' ? text.back : text.title} title={tab === 'board' ? text.back : text.title} onClick={() => tab === 'board' ? onClose() : setTab('board')}><ExperimentalIcon name="map-back"/></button><span className="projects-hero-mark" aria-hidden="true"><DiaryMark/></span><div className="workspace-header-copy"><h1>{text.title}</h1><p>{tab === 'favorites' ? text.favorites : tab === 'archive' ? text.archive : text.description}</p></div></div>
      <p className="diary-privacy"><ExperimentalIcon name="lock"/>{text.private}</p>
    </header>
    <div className="diary-categories" role="group" aria-label={text.categories}>
      {(['personal', 'saved'] as const).map(id => <button type="button" key={id} data-diary-category={id} aria-pressed={category === id} onClick={() => chooseCategory(id)}>
        <ExperimentalIcon name={id === 'personal' ? 'edit' : 'save'}/><span>{id === 'personal' ? text.personalNotes : text.savedNotes}</span><small aria-hidden="true">{counts[id]}</small>
      </button>)}
    </div>
    <div className="diary-toolbar"><button type="button" className="primary-button" disabled={diary.loading || diary.error} onClick={() => { chooseCategory('personal'); setQuery(''); setEditing('new'); }}><ExperimentalIcon name="plus"/>{text.newNote}</button>
      <label className="diary-search"><ExperimentalIcon name="search"/><input type="search" aria-label={text.search} placeholder={text.search} value={query} onChange={event => setQuery(event.target.value)}/></label>
      <details className="diary-more"><summary aria-label={text.more} title={text.more}><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg></summary><div>
        <button type="button" onClick={event => { setSettingsOpen(true); event.currentTarget.closest('details')?.removeAttribute('open'); }}><ExperimentalIcon name="settings"/>{text.settings}</button>
        <button type="button" aria-pressed={tab === 'favorites'} onClick={event => { setCategory('saved'); setTab('favorites'); event.currentTarget.closest('details')?.removeAttribute('open'); }}><ExperimentalIcon name="star"/>{text.favorites}</button>
        <button type="button" aria-pressed={tab === 'archive'} onClick={event => { setTab('archive'); event.currentTarget.closest('details')?.removeAttribute('open'); }}><ExperimentalIcon name="archive"/>{text.archive}</button></div></details>
    </div>
    {diary.loading ? <p role="status">{text.loading}</p> : null}
    {diary.error || error ? <div className="diary-notice" role="alert"><p>{error || text.error}</p><button type="button" onClick={() => { setError(''); void diary.refresh(); }}>{text.retry}</button></div> : null}
    {diary.offline ? <p className="diary-notice" role="status">{text.offline}</p> : null}
    {!diary.syncEnabled ? <p className="diary-notice" role="status">{text.localOnly}</p> : null}
    {drafts.length ? <details className="diary-drafts"><summary>{text.drafts} · {drafts.length}</summary><p>{text.draftHint}</p>{drafts.map(row => <div key={row.draftKey}><button type="button" onClick={() => setEditing(row)}>{row.note.title || text.untitled}</button></div>)}</details> : null}
    {tab === 'archive' ? <div className="diary-archive-heading"><h2>{text.archive}</h2><p>{text.archiveHint}</p></div> : null}
    {!diary.loading && !diary.error && !notes.length ? <div className="diary-empty"><DiaryMark/><h2>{query ? text.emptySearch : tab === 'archive' ? text.emptyArchive : tab === 'favorites' ? text.emptyFavorites : category === 'personal' ? text.emptyPersonal : text.emptySaved}</h2>{!query && tab === 'board' ? <p>{category === 'personal' ? text.personalHint : text.savedHint}</p> : null}</div> : null}
    <div className="diary-board" data-diary-category={category}>{notes.map(row => <article className="diary-note" key={row.note.id} data-color={row.note.color} style={customNoteStyle(row.note.customColor)}>
      <div className="diary-note-meta"><time dateTime={row.note.createdAt}>{new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(row.note.createdAt))}</time>{row.note.reaction === 'dislike' ? <span><AdviceDislikeIcon/>{text.disliked}</span> : row.note.advice ? <span>{text.savedNotes}</span> : null}</div>
      <button type="button" className="diary-note-open" onClick={() => setEditing(row)} aria-label={`${text.edit}: ${row.note.title || text.untitled}`}><h2>{row.note.title || text.untitled}</h2>{originalAdvicePreview(row.note) ? <AdviceBodyText advice={row.note.advice!}/> : <p>{row.note.body}</p>}</button>
      <footer>
        {row.note.advice ? <button type="button" className="diary-favorite" disabled={diary.busy} aria-label={row.note.reaction === 'favorite' ? text.unfavorite : text.favorite} title={row.note.reaction === 'favorite' ? text.unfavorite : text.favorite} aria-pressed={row.note.reaction === 'favorite'} onClick={() => void change(row, { ...row.note, reaction: row.note.reaction === 'favorite' ? null : 'favorite', archived: false })}><ExperimentalIcon name="star"/></button> : null}
        <button type="button" disabled={diary.busy} aria-label={row.note.pinned ? text.unpin : text.pin} title={row.note.pinned ? text.unpin : text.pin} aria-pressed={row.note.pinned} onClick={() => void change(row, { ...row.note, pinned: !row.note.pinned })}><ExperimentalIcon name="map-pin"/></button>
        <button type="button" disabled={diary.busy} aria-label={row.note.archived ? text.restore : text.toArchive} title={row.note.archived ? text.restore : text.toArchive} onClick={() => void change(row, row.note.archived ? restoreDiaryNote(row.note) : { ...row.note, archived: true })}><ExperimentalIcon name={row.note.archived ? 'undo' : 'archive'}/></button>
        <button type="button" disabled={diary.busy} aria-label={text.deleteNote} title={text.deleteNote} onClick={() => setDeleting(row)}><ExperimentalIcon name="trash"/></button>
      </footer>
    </article>)}</div>
    {editing ? <NoteEditor key={editing === 'new' ? 'new' : editing.draftKey || editing.note.id} record={editing === 'new' ? undefined : editing} language={language} onClose={() => setEditing(null)} onSaved={onSaved} /> : null}
    {settingsOpen ? <DiarySettings language={language} onClose={() => setSettingsOpen(false)}/> : null}
    {deleting ? <DiaryDeleteDialog language={language} record={deleting} onClose={() => setDeleting(null)}/> : null}
  </section>;
}
