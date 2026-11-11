"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { CalendarMode } from "./calendar-data";
import { getRuntimeLanguage } from "./i18n";
import { habitLifecycleState } from "./habit-lifecycle";
import { getStoicheionLetters } from "./stoicheion-data";
import { isHabitScheduledForDate, updateHabitCompletion, type HabitWorkspace } from "./habits";
import { RESTORATION_AUXILIARIES, RESTORATION_SECTORS } from "./stoicheion-restoration-data";
import { restorationCopy, restorationLocal } from "./stoicheion-restoration-copy";
import { habitPracticeProgress } from "./habit-practice-goal";
import { practiceCopy } from "./habit-practice-copy";
import { RESTORATION_POSITION_IDS, RESTORATION_STAGES, type RestorationDrawCard } from "./stoicheion-restoration-state";
import { restorationPlanEquation, restorationPreparedCount, restorationSourceKey, reversedSectors, snapshotMatchesSource, validateRestorationStrategy,
  type RestorationSource, type RestorationStrategy } from "./stoicheion-restoration-strategy";
import { useSharedWorkDrafts } from "./use-shared-work-drafts";
import type { WorkDraft } from "./shared-work-draft-journal";
import { RestorationStrategyDialog, RESTORATION_DRAFT_SCOPE } from "./StoicheionRestorationDialog";
import { RestorationRepository } from "./stoicheion-restoration-storage";
import { PERSONAL_DOCUMENT_READY_EVENT } from "./cloud-sync";
import { completeRestorationWork, deleteRestorationWork, deleteArchivedRestorationWorks, reflectRestorationWork, restorationExpired, restorationWorks, linkedRestorationHabit, type RestorationWork, type RestorationWorkspace, type RestorationDocument } from "./stoicheion-restoration-work";
import { StoicheionActionButton } from "./StoicheionActionButton";
import { ExperimentalIcon } from "./ExperimentalIcon";
import "./stoicheion-restoration.css";

export type RestorationPrimaryState = "preparing" | "begin" | "resume" | "view";
export type RestorationHandle = { activate: (sectorId?: string | null) => void };
type Props = {
  cards: RestorationDrawCard[]; sourceDate: string; sourceSeed: number | null; today: string;
  workspace: HabitWorkspace; calendarMode: CalendarMode; userId?: string;
  onChange: (workspace: HabitWorkspace) => void | Promise<void>; onOpenHabits?: () => void;
  onPrimaryStateChange?: (state: RestorationPrimaryState) => void;
};

function scrollToResult(id: string) {
  requestAnimationFrame(() => {
    const target = document.getElementById(id);
    target?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    target?.focus({ preventScroll: true });
  });
}

export const StoicheionRestoration = forwardRef<RestorationHandle, Props>(function StoicheionRestoration({
  cards, sourceDate, sourceSeed, today, workspace: habitWorkspace, calendarMode, userId = "", onChange: onHabitChange, onOpenHabits, onPrimaryStateChange,
}, ref) {
  const language = getRuntimeLanguage();
  const t = restorationCopy(language);
  const local = (value: {ru: string; en: string}) => restorationLocal(value, language);
  const currentSource: RestorationSource | null = cards.length === 9 && sourceSeed !== null ? { cards, sourceDate, sourceSeed } : null;
  const journal = useSharedWorkDrafts(userId || "anonymous", RESTORATION_DRAFT_SCOPE, "stoicheion-restoration", true, validateRestorationStrategy);
  const hydrated = journal.loaded;
  const [memory, setMemory] = useState<Record<string, RestorationStrategy>>({});
  const [staged, setStaged] = useState<Record<string, WorkDraft<RestorationStrategy>>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [recovered, setRecovered] = useState<WorkDraft<RestorationStrategy> | null>(null);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [document, setDocument] = useState<RestorationDocument>({ version: 1, works: [], removed: [] });
  const [repository, setRepository] = useState<RestorationRepository | null>(null);
  const [cloudReady, setCloudReady] = useState(false);
  const [cloudError, setCloudError] = useState("");
  const [archiveDeleteKey, setArchiveDeleteKey] = useState<string | null>(null);
  const [archiveDeleting, setArchiveDeleting] = useState(false);
  const [draftDeleteKey, setDraftDeleteKey] = useState<string | null>(null);
  const [draftDeleting, setDraftDeleting] = useState(false);
  const [draftDeleteError, setDraftDeleteError] = useState("");
  const draftCancel = useRef<HTMLButtonElement>(null);
  const draftTrigger = useRef<HTMLButtonElement | null>(null);
  const archiveCancel = useRef<HTMLButtonElement>(null);
  const archiveTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { if (archiveDeleteKey) archiveCancel.current?.focus(); }, [archiveDeleteKey]);
  useEffect(() => { if (draftDeleteKey) draftCancel.current?.focus(); }, [draftDeleteKey]);
  function cancelArchiveDelete() { if (archiveDeleting) return; setArchiveDeleteKey(null); archiveTrigger.current?.focus(); }
  function cancelDraftDelete() { if (draftDeleting) return; setDraftDeleteKey(null); draftTrigger.current?.focus(); }

  useEffect(() => {
    if (!userId) return;
    const repo = new RestorationRepository(userId, localStorage);
    let active = true;
    const load = () => void repo.load().then(value => { if (active) { setDocument(value); setCloudReady(true); setCloudError(""); } })
      .catch(reason => { if (active) { setRepository(repo); setCloudError(reason instanceof Error && reason.message.includes("CONFLICT") ? t.archiveConflict : t.archiveError); } });
    queueMicrotask(() => { if (active) { setRepository(repo); load(); } });
    window.addEventListener(PERSONAL_DOCUMENT_READY_EVENT, load);
    return () => { active = false; window.removeEventListener(PERSONAL_DOCUMENT_READY_EVENT, load); };
  }, [userId, t.archiveConflict, t.archiveError]);
  const workspace: RestorationWorkspace = { ...habitWorkspace, stoicheionWorks: document.works, stoicheionRemovedWorks: document.removed };
  async function onChange(next: RestorationWorkspace) {
    if (!repository || !cloudReady) throw new Error("RESTORATION_ARCHIVE_NOT_READY");
    const { stoicheionWorks: works = [], stoicheionRemovedWorks: removed = [], ...habits } = next;
    if (JSON.stringify(habits) !== JSON.stringify(habitWorkspace)) await onHabitChange(habits);
    try { const saved = await repository.save({ version: 1, works, removed }); setDocument(saved); setCloudError(""); }
    catch (error) { setCloudError(repository.conflict ? t.archiveConflict : t.archiveError); throw error; }
  }
  const cycles = restorationWorks(workspace, today);
  const snapshots = cycles.map(work => work.snapshot);
  const groups = [...new Set(snapshots.map(restorationSourceKey))].map(key => ({ key, works: cycles.filter(work => restorationSourceKey(work.snapshot) === key) }));
  const activeGroups = groups.filter(group => !group.works.every(work => work.archivedAt));
  const archiveGroups = groups.filter(group => group.works.every(work => work.archivedAt));
  const { refresh } = journal;
  const records = useMemo(() => {
    const bySource = new Map<string, WorkDraft<RestorationStrategy>>();
    for (const row of [...journal.rows, ...Object.values(staged)].sort((a,b) => b.at.localeCompare(a.at))) {
      const key = restorationSourceKey(row.value);
      if (!bySource.has(key)) bySource.set(key, row);
    }
    return bySource;
  }, [journal.rows, staged]);
  const currentKey = currentSource ? restorationSourceKey(currentSource) : "";
  const currentDraft = memory[currentKey] ?? records.get(currentKey)?.value;
  const currentSaved = currentSource ? reversedSectors(currentSource).every(id => snapshots.some(snapshot => snapshot.sectorId === id && snapshotMatchesSource(snapshot, currentSource))) : false;
  const primary: RestorationPrimaryState = !hydrated || !cloudReady ? "preparing" : currentSaved && currentSource && reversedSectors(currentSource).length ? "view"
    : currentDraft || currentSource && snapshots.some(snapshot => snapshotMatchesSource(snapshot, currentSource)) ? "resume" : "begin";
  useEffect(() => onPrimaryStateChange?.(primary), [onPrimaryStateChange, primary]);

  function activateSource(source: RestorationSource, sectorId?: string | null) {
    if (!reversedSectors(source).length) { scrollToResult("stoicheion-restoration"); return; }
    const key = restorationSourceKey(source);
    const saved = snapshots.filter(snapshot => snapshotMatchesSource(snapshot, source));
    if (reversedSectors(source).every(id => saved.some(snapshot => snapshot.sectorId === id))) {
      const work = cycles.find(work => snapshotMatchesSource(work.snapshot, source) && (!sectorId || work.snapshot.sectorId === sectorId));
      if (work?.archivedAt) { let parent = window.document.getElementById(`restoration-cycle-${work.id}`)?.parentElement; while (parent) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement; } }
      if (work) scrollToResult(`restoration-cycle-${work.id}`);
      return;
    }
    let draft = memory[key] ?? records.get(key)?.value;
    if (!draft && restorationExpired(source.sourceDate, today)) { setNotice(t.expired); return; }
    if (!draft) {
      const ids = reversedSectors(source);
      draft = { version: 1, ...source, activeSectorId: ids[0], plans: Object.fromEntries(ids.map(id => {
        const guidance = RESTORATION_SECTORS.find(item => item.id === id)!.needs.conflict;
        return [id, { need: "conflict", supportIds: [guidance.supportId], resourceLetterId: "", intention: local(guidance.intention), linkedHabitId: "", withoutHabit: true, step: 0, prepared: false, touched: false }];
      })) };
    }
    if (sectorId && reversedSectors(source).includes(sectorId)) draft = { ...draft, activeSectorId: sectorId };
    setMemory(previous => ({ ...previous, [key]: draft }));
    setRecovered(records.get(key) ?? null); setEditingKey(key); setOpen(true); setNotice("");
  }
  useImperativeHandle(ref, () => ({ activate: sectorId => { if (hydrated && cloudReady && currentSource) activateSource(currentSource, sectorId); } }));
  const onStaged = (record: WorkDraft<RestorationStrategy>) => setStaged(previous => ({ ...previous, [record.id]: record }));
  const unfinished = [...new Set([...records.keys(), ...Object.keys(memory)])].map(key => memory[key] ?? records.get(key)!.value)
    .filter(draft => !reversedSectors(draft).every(id => snapshots.some(snapshot => snapshot.sectorId === id && snapshotMatchesSource(snapshot, draft))));

  async function deleteDraft(key: string) {
    setDraftDeleting(true); setDraftDeleteError("");
    try {
      const rows = new Map([...journal.rows, ...Object.values(staged)].sort((a,b) => a.at.localeCompare(b.at)).map(row => [row.id, row]));
      for (const row of rows.values()) if (restorationSourceKey(row.value) === key) await journal.remove(row);
      setMemory(previous => Object.fromEntries(Object.entries(previous).filter(([source]) => source !== key)));
      setStaged(previous => Object.fromEntries(Object.entries(previous).filter(([,row]) => restorationSourceKey(row.value) !== key)));
      await refresh(); setDraftDeleteKey(null); setNotice(t.draftDeleted);
      requestAnimationFrame(() => window.document.getElementById("stoicheion-restoration")?.focus());
    } catch { setDraftDeleteError(t.draftDeleteError); }
    finally { setDraftDeleting(false); }
  }

  return <>
    <section id="stoicheion-restoration" className="restoration restoration-results" aria-labelledby="restoration-title" tabIndex={-1} data-no-translate>
      <header className="restoration-heading"><div><h2 id="restoration-title">{t.title}</h2><p>{cycles.length ? t.resultsIntro : t.intro}</p></div>
        <div className="restoration-heading-actions">
          {currentSource && !currentSaved && !restorationExpired(sourceDate, today) ? <StoicheionActionButton icon="restoration" className="primary-button" disabled={!hydrated || !cloudReady} onClick={() => activateSource(currentSource)}>{t[primary]}</StoicheionActionButton> : null}
          {onOpenHabits && cycles.length ? <button type="button" className="secondary-button" onClick={onOpenHabits}><ExperimentalIcon name="habits" />{t.openHabits}</button> : null}
        </div></header>
      {currentSource && cards.every(card => !card.reversed) ? <p>{t.allUpright}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {draftDeleteError ? <p className="restoration-error" role="alert">{draftDeleteError}</p> : null}
      {cloudError ? <div role="alert"><p className="restoration-error">{cloudError}</p><button type="button" className="secondary-button" onClick={() => void repository?.load().then(value => { setDocument(value); setCloudReady(true); setCloudError(""); }).catch(() => setCloudError(repository?.conflict ? t.archiveConflict : t.archiveError))}>{t.retryDraft}</button>{repository?.conflict ? <button type="button" className="secondary-button" onClick={() => void repository.keepPending().then(value => { setDocument(value); setCloudReady(true); setCloudError(""); }).catch(() => setCloudError(t.archiveError))}>{t.keepVersion}</button> : null}</div> : null}
      {activeGroups.map(group => <section className="restoration-saved-group" key={group.key} aria-label={`${t.strategy} · ${group.works[0].snapshot.sourceDate}`}>
        <header><h3>{t.strategy}</h3><span>{group.works[0].snapshot.sourceDate} · {t.cards}: {group.works.length}</span></header>
        {group.works.map(work => work.archivedAt ? <details className="restoration-history" key={work.id}><summary>{t.completed} · {work.snapshot.intention}</summary><RestorationCycle work={work} workspace={workspace} calendarMode={calendarMode} today={today} onChange={onChange} /></details>
          : <RestorationCycle key={work.id} work={work} workspace={workspace} calendarMode={calendarMode} today={today} onChange={onChange} />)}
      </section>)}
      {archiveGroups.length ? <details id="restoration-archive" className="restoration-history"><summary>{t.archive} · {archiveGroups.length}</summary><p className="restoration-note">{t.archiveHelp}</p>{archiveGroups.map(group => <div className="restoration-archive-entry" key={group.key}>
        <details className="restoration-saved-group"><summary>{group.works[0].snapshot.sourceDate} · {t.cards}: {group.works.length}</summary>{group.works.map(work => <RestorationCycle key={work.id} work={work} workspace={workspace} calendarMode={calendarMode} today={today} onChange={onChange} />)}</details>
        <button type="button" className="restoration-archive-delete" aria-label={`${t.archiveDelete}: ${group.works[0].snapshot.sourceDate}`} title={t.archiveDelete} disabled={archiveDeleting || !cloudReady}
          onClick={event => { archiveTrigger.current = event.currentTarget; setArchiveDeleteKey(group.key); }}><ExperimentalIcon name="delete" /></button>
        {archiveDeleteKey === group.key ? <section className="restoration-archive-confirm" role="group" aria-labelledby="restoration-archive-delete-title">
          <h4 id="restoration-archive-delete-title">{t.archiveDeleteTitle}</h4><p>{t.archiveDeleteHelp}</p><div className="restoration-heading-actions">
            <button type="button" className="secondary-button" ref={archiveCancel} disabled={archiveDeleting} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); cancelArchiveDelete(); } }} onClick={cancelArchiveDelete}>{t.archiveDeleteCancel}</button>
            <button type="button" className="secondary-button" disabled={archiveDeleting} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); cancelArchiveDelete(); } }} onClick={() => void (async () => {
              setArchiveDeleting(true);
              try {
                await onChange(deleteArchivedRestorationWorks(workspace, group.works));
                setArchiveDeleteKey(null); setNotice(t.archiveDeleted);
                setMemory(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => key !== group.key)));
                setStaged(previous => Object.fromEntries(Object.entries(previous).filter(([,row]) => restorationSourceKey(row.value) !== group.key)));
                for (const row of journal.rows) if (restorationSourceKey(row.value) === group.key) await journal.remove(row);
                await refresh();
                requestAnimationFrame(() => window.document.getElementById("stoicheion-restoration")?.focus());
              } catch { setCloudError(t.archiveError); }
              finally { setArchiveDeleting(false); }
            })()}>{t.archiveDelete}</button>
          </div>
        </section> : null}
      </div>)}</details> : null}
      {unfinished.length ? <details className="restoration-history"><summary>{t.drafts} · {unfinished.length}</summary><div>{unfinished.map(draft => {
        const key = restorationSourceKey(draft);
        return <div className="restoration-draft-entry" key={key}>
          <button type="button" className="secondary-button restoration-draft-open" disabled={draftDeleting} onClick={() => activateSource(draft)}>
            <ExperimentalIcon name="stoicheion" /><span>{draft.sourceDate}<small>{t.cardsReady}: {restorationPreparedCount(draft, snapshots)} {t.countOf} {reversedSectors(draft).length}</small></span><ExperimentalIcon name="chevron" />
          </button>
          <button type="button" className="restoration-draft-delete" aria-label={`${t.deleteDraft}: ${draft.sourceDate}`} title={t.deleteDraft} disabled={draftDeleting || !hydrated || !journal.ready}
            onClick={event => { draftTrigger.current = event.currentTarget; setDraftDeleteError(""); setDraftDeleteKey(key); }}><ExperimentalIcon name="delete" /></button>
          {draftDeleteKey === key ? <section className="restoration-draft-confirm" role="group" aria-label={t.deleteDraftTitle}>
            <h4>{t.deleteDraftTitle}</h4><p>{t.deleteDraftHelp}</p><div className="restoration-draft-confirm-actions">
              <button type="button" className="secondary-button" ref={draftCancel} disabled={draftDeleting} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); cancelDraftDelete(); } }} onClick={cancelDraftDelete}>{t.archiveDeleteCancel}</button>
              <button type="button" className="secondary-button restoration-delete-button" disabled={draftDeleting} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); cancelDraftDelete(); } }} onClick={() => void deleteDraft(key)}>{t.deleteDraft}</button>
            </div>
          </section> : null}
        </div>;
      })}</div></details> : null}
      {!workspace.habitSettings.enabled ? <p className="restoration-note">{t.disabled}</p> : null}
    </section>
    {editingKey && memory[editingKey] ? <RestorationStrategyDialog key={`${userId}:${editingKey}`} userId={userId} open={open} draft={memory[editingKey]} recovered={recovered}
      workspace={workspace} calendarMode={calendarMode} today={today} onChange={onChange} onClose={() => setOpen(false)}
      onDeleted={async () => { for (const row of new Map([...journal.rows, ...Object.values(staged)].sort((a,b) => a.at.localeCompare(b.at)).map(row => [row.id, row])).values()) if (restorationSourceKey(row.value) === editingKey) await journal.remove(row); setOpen(false); setEditingKey(null); setMemory(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => key !== editingKey))); setStaged(previous => Object.fromEntries(Object.entries(previous).filter(([,row]) => restorationSourceKey(row.value) !== editingKey))); setNotice(t.deleted); await refresh(); }}
      onDraftChange={draft => setMemory(previous => ({ ...previous, [editingKey]: draft }))} onStaged={onStaged}
      onSaved={cleanupError => {
        setOpen(false); setEditingKey(null); setMemory(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => key !== editingKey)));
        setStaged(previous => Object.fromEntries(Object.entries(previous).filter(([,row]) => restorationSourceKey(row.value) !== editingKey)));
        setNotice(cleanupError ? `${t.strategySaved}. ${t.draftError}` : t.strategySaved); void refresh(); scrollToResult("stoicheion-restoration");
      }} /> : null}
  </>;
});

function RestorationCycle({ work, workspace, calendarMode, today, onChange }: {work: RestorationWork; workspace: RestorationWorkspace; calendarMode: CalendarMode; today: string; onChange: (next: RestorationWorkspace) => void | Promise<void>}) {
  const language = getRuntimeLanguage();
  const t = restorationCopy(language);
  const local = (value: {ru: string; en: string}) => restorationLocal(value, language);
  const habit = linkedRestorationHabit(work, workspace);
  const snapshot = work.snapshot;
  const letters = getStoicheionLetters(language);
  const letter = letters.find(item => item.id === snapshot.letterId)!;
  const sector = RESTORATION_SECTORS.find(item => item.id === snapshot.sectorId)!;
  const resource = letters.find(item => item.id === snapshot.resourceLetterId)!;
  const progress = work.completionDates;
  const todayEntry = progress.includes(today);
  const scheduled = habit ? isHabitScheduledForDate(habit, today, calendarMode, workspace.habitCompletions) && habitLifecycleState(habit).status === "active" : today >= snapshot.startedDate && today <= work.deadline;
  const finite = habit ? habitPracticeProgress(habit, workspace.habitCompletions, today) : null, finiteCopy = practiceCopy(language);
  const target = work.requiredCompletions, count = progress.length;
  const enabled = !habit || workspace.habitSettings.enabled;
  const missed = today > work.deadline && count < target;
  const archived = Boolean(work.archivedAt);
  const [reflection, setReflection] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const equation = restorationPlanEquation(snapshot, snapshot.sectorId, { ...snapshot, linkedHabitId: "", prepared: true, touched: true, step: 3 });
  async function commit(next: RestorationWorkspace) {
    setSaving(true);
    try { await onChange(next); setError(""); return true; } catch { setError(t.error); return false; }
    finally { setSaving(false); }
  }
  return <article id={`restoration-cycle-${work.id}`} className="restoration-cycle" tabIndex={-1}>
    <header className="restoration-cycle-heading"><span className="restoration-letter-mark" aria-hidden="true">{letter.symbol}</span><div><h3>{letter.name} · {local(sector.title)}</h3></div>
      <span className="restoration-status"><ExperimentalIcon name="check" />{archived ? t.archived : t.strategyReady}</span>
      <p className="restoration-cycle-intention">{snapshot.intention}</p></header>
    <div className="restoration-columns"><div className="restoration-main">
      <h4>{t.contemplation}</h4>{snapshot.practiceText.split("\n\n").map((paragraph,index) => <p key={index}>{paragraph}</p>)}
      <h4>{t.action}</h4>{snapshot.action.split("\n\n").map((paragraph,index) => <p key={index}>{paragraph}</p>)}
      <details className="restoration-source"><summary>{t.showDetails}</summary>
        <p>{t.need} · {t[snapshot.need]}</p>
        <h4>{local(sector.myth.title)}</h4><p>{local(sector.myth.body)}</p><a href={sector.myth.url} target="_blank" rel="noreferrer">{t.source} · {sector.myth.source}</a><p className="restoration-note">{t.interpretation}</p>
        <p className="restoration-formula">{t.formula}</p><p>{snapshot.spreadTotal} → {snapshot.pythmen} · {letter.value} + {resource.value} + {equation.supportTotal} = {letter.value + resource.value + equation.supportTotal} → {snapshot.pythmen}</p>
        <h4>{t.supports}</h4><ul>{equation.supports.map(support => <li key={support.id}>{local(RESTORATION_AUXILIARIES.find(item => item.id === support.id)!.title)} · <span lang="grc">{support.word}</span> · {support.value}</li>)}</ul>
        <p>{t.snapshot} · {snapshot.sourceDate}</p><ol>{snapshot.cards.map((card,index) => <li key={index}>{local(RESTORATION_SECTORS.find(item => item.id === RESTORATION_POSITION_IDS[index])!.title)} · {letters.find(item => item.id === card.letterId)?.name} · {card.reversed ? "↓" : "↑"}</li>)}</ol>
      </details>
      {archived ? <div className="restoration-final-note"><h4>{t.finalReflection}</h4><p>{snapshot.reflection}</p><p className="restoration-note">{t.archived} · <time dateTime={work.archivedAt!}>{work.archivedAt!.slice(0,10)}</time></p></div> : <>
      <label className="restoration-field"><span>{count >= target ? t.finalReflection : t.reflection}</span><textarea rows={3} disabled={saving} maxLength={2000} value={reflection ?? snapshot.reflection} onChange={event => { setReflection(event.target.value); setNotice(""); }} /></label>
      <button type="button" className="secondary-button" disabled={saving || !enabled || !(reflection ?? snapshot.reflection).trim() || count < target && (reflection === null || reflection.trim() === snapshot.reflection)} onClick={async () => {
        if (await commit(reflectRestorationWork(workspace, work, reflection ?? snapshot.reflection, today))) { setNotice(t.saved); setReflection(null); if (count >= target) scrollToResult("stoicheion-restoration"); }
      }}><ExperimentalIcon name="save" />{count >= target ? t.finishArchive : t.saveReflection}</button>
      {count >= target ? <p className="restoration-note">{t.finishArchiveHelp}</p> : null}
      {missed ? <details className="restoration-delete"><summary>{t.delete}</summary><p>{t.deleteHelp}</p><button type="button" className="secondary-button" disabled={saving} onClick={() => void commit(deleteRestorationWork(workspace, work, today))}><ExperimentalIcon name="delete" />{t.deleteExpired}</button></details> : null}
      </>}
      {notice ? <p role="status">{notice}</p> : null}{error ? <p className="restoration-error" role="alert">{error}</p> : null}
    </div><aside className="restoration-tetractys" aria-label={t.practiceProgress}>
      <h4>{missed ? finiteCopy.missed : count === target ? t.completed : t.practiceProgress}</h4><p className="restoration-progress" aria-live="polite">{count} / {target}</p>
      {missed && !finite ? <p className="restoration-error">{t.expired}</p> : null}
      {!habit ? <p className="restoration-note">{t.withoutHabitHelp}</p> : null}
      {!habit ? <p>{finiteCopy.deadline}: <time dateTime={work.deadline}>{work.deadline}</time></p> : finite ? <><p>{finiteCopy.deadline}: <time dateTime={finite.deadline}>{finite.deadline}</time> · {habit.schedule.timezone}</p><p className="restoration-note">{finiteCopy.warning}</p></> : <>
      <div className="restoration-triangle" aria-hidden="true">{RESTORATION_STAGES.map((stage,row) => <div key={stage.id}>{Array.from({length:stage.count},(_,index) => <i key={index} className={progress.length > row*(row+1)/2+index ? "is-complete" : undefined} />)}</div>)}</div>
      <p>{t.tetractys}</p><ol>{RESTORATION_STAGES.map(stage => <li key={stage.id}>{stage.count} · {t[stage.id]}</li>)}</ol><p className="restoration-note">{t.cycleHelp}</p></>}
      {!archived && count < target && !missed ? <button type="button" className="primary-button" disabled={saving || !enabled || !scheduled || todayEntry} onClick={() => {
        try { void commit(habit ? updateHabitCompletion(workspace, habit, today, { completed: true }, today) : completeRestorationWork(workspace, work, today)); } catch { setError(t.error); }
      }}><ExperimentalIcon name="check" />{todayEntry ? t.doneToday : t.completeToday}</button> : null}
      {!scheduled && count < target && !missed ? <p className="restoration-note">{t.notScheduled}</p> : null}
      {todayEntry && !progress.includes(today) ? <p className="restoration-note">{t.todayEarlier}</p> : null}
    </aside></div>
  </article>;
}
