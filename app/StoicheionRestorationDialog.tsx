"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CalendarMode } from "./calendar-data";
import { getRuntimeLanguage } from "./i18n";
import { restorationExpired, restorationWorks, type RestorationWorkspace } from "./stoicheion-restoration-work";
import { personalDocumentAccess, PERSONAL_DOCUMENT_READY_EVENT } from "./cloud-sync";
import { getStoicheionLetters } from "./stoicheion-data";
import { isEligibleRestorationHabit } from "./stoicheion-restoration-habits";
import { RESTORATION_AUXILIARIES, RESTORATION_FRAMEWORK, RESTORATION_LETTER_FOCI, RESTORATION_SECTORS } from "./stoicheion-restoration-data";
import { restorationCopy, restorationLocal } from "./stoicheion-restoration-copy";
import { practiceCopy } from "./habit-practice-copy";
import { restorationTrace, type RestorationNeed } from "./stoicheion-restoration-math";
import { RESTORATION_POSITION_IDS } from "./stoicheion-restoration-state";
import { restorationPlanEquation, restorationPlanReady, restorationPreparedCount, reversedSectors, snapshotMatchesSource, validateRestorationStrategy,
  type RestorationStrategy, type RestorationPlan } from "./stoicheion-restoration-strategy";
import { materializeRestorationStrategy, restorationRecommendation } from "./stoicheion-restoration-commit";
import { useSharedWorkDrafts } from "./use-shared-work-drafts";
import type { WorkDraft } from "./shared-work-draft-journal";
import { useDialogAccessibility } from "./use-dialog-accessibility";
import { DialogCloseButton } from "./DialogCloseButton";
import { ExperimentalIcon } from "./ExperimentalIcon";
import { StoicheionActionButton } from "./StoicheionActionButton";

export const RESTORATION_DRAFT_SCOPE = "genesis-stoicheion-restoration-v1";
type Props = {
  userId: string; open: boolean; draft: RestorationStrategy; recovered: WorkDraft<RestorationStrategy> | null;
  workspace: RestorationWorkspace; calendarMode: CalendarMode; today: string;
  onChange: (workspace: RestorationWorkspace) => void | Promise<void>; onClose: () => void;
  onDeleted: () => void | Promise<void>;
  onDraftChange: (draft: RestorationStrategy) => void; onStaged: (record: WorkDraft<RestorationStrategy>) => void;
  onSaved: (cleanupError: boolean) => void;
};

export function RestorationStrategyDialog({userId, open, draft, recovered, workspace, calendarMode, today,
  onChange, onClose, onDeleted, onDraftChange, onStaged, onSaved}: Props) {
  const language = getRuntimeLanguage();
  const t = restorationCopy(language);
  const local = (value: {ru: string; en: string}) => restorationLocal(value, language);
  const letters = getStoicheionLetters(language);
  const journal = useSharedWorkDrafts(userId || "anonymous", RESTORATION_DRAFT_SCOPE, "stoicheion-restoration", true, validateRestorationStrategy);
  const [review, setReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [unavailable, setUnavailable] = useState(!userId);
  const [error, setError] = useState("");
  const mainRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef(recovered);
  const stagedCallback = useRef(onStaged);
  useEffect(() => { stagedCallback.current = onStaged; }, [onStaged]);
  const {ready, stage, remove, writerId} = journal;
  useEffect(() => {
    if (!ready) return;
    let active = true;
    const persist = async () => {
      if (!active) return;
      try { personalDocumentAccess(userId).check(); } catch { setUnavailable(true); return; }
      setUnavailable(false);
      await stage(draft).then(async record => {
      stagedCallback.current(record);
      // Migrate a recovered record only after its replacement is safely sealed.
      const source = sourceRef.current;
      if (source && source.id !== writerId) {
        sourceRef.current = null;
        try { await remove(source); } catch { /* A concurrent edit stays in the journal. */ }
      }
      }).catch(() => undefined);
    };
    queueMicrotask(() => void persist());
    const unlocked = () => void persist();
    window.addEventListener(PERSONAL_DOCUMENT_READY_EVENT, unlocked);
    return () => { active = false; window.removeEventListener(PERSONAL_DOCUMENT_READY_EVENT, unlocked); };
  }, [draft, ready, stage, userId, remove, writerId]);
  const dialogRef = useDialogAccessibility<HTMLDivElement>(() => { if (!saving) onClose(); }, open);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    const previousRoot = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; document.documentElement.style.overflow = previousRoot; };
  }, [open]);
  const sectors = reversedSectors(draft);
  const expired = restorationExpired(draft.sourceDate, today);
  const needsTracking = sectors.some(id => !draft.plans[id].withoutHabit);
  const snapshots = restorationWorks(workspace, today).map(work => work.snapshot);
  const savedFor = (id: string) => snapshots.find(snapshot => snapshot.sectorId === id && snapshotMatchesSource(snapshot, draft));
  const count = restorationPreparedCount(draft, snapshots);
  const plan = draft.plans[draft.activeSectorId];
  const sector = RESTORATION_SECTORS.find(item => item.id === draft.activeSectorId)!;
  const card = draft.cards[RESTORATION_POSITION_IDS.indexOf(sector.id)];
  const letter = letters.find(item => item.id === card.letterId)!;
  const guidance = sector.needs[plan.need];
  const equation = restorationPlanEquation(draft, sector.id, plan);
  const resource = letters.find(item => item.id === plan.resourceLetterId);
  const recommendation = restorationRecommendation(draft, sector.id, plan, language);
  const saved = savedFor(sector.id);
  const spreadTotal = draft.cards.reduce((sum, card) => sum + letters.find(item => item.id === card.letterId)!.value, 0);
  function focusMain() {
    requestAnimationFrame(() => {
      const main = mainRef.current;
      main?.focus({ preventScroll: true });
      if (matchMedia("(max-width: 800px)").matches) main?.closest(".restoration-editor")?.scrollIntoView({ block: "start" });
    });
  }
  function patch(next: Partial<RestorationPlan>) {
    onDraftChange({ ...draft, plans: { ...draft.plans, [sector.id]: { ...plan, prepared: false, touched: true, ...next } } }); setError("");
  }
  function chooseCard(id: string) { onDraftChange({ ...draft, activeSectorId: id }); setReview(false); setError(""); focusMain(); }
  function changeStep(step: number) { patch({step, prepared: plan.prepared}); focusMain(); }
  function changeNeed(need: RestorationNeed) {
    const next = sector.needs[need];
    patch({ need, supportIds: [next.supportId], resourceLetterId: "", intention: plan.intention === local(guidance.intention) ? local(next.intention) : plan.intention });
  }
  function finishCard() {
    if (!resource || !plan.intention.trim()) return;
    patch({ prepared: true });
    const next = sectors.find(id => id !== sector.id && !savedFor(id) && !restorationPlanReady(draft, id, draft.plans[id]));
    if (next) { onDraftChange({ ...draft, activeSectorId: next, plans: { ...draft.plans, [sector.id]: { ...plan, touched: true, prepared: true } } }); focusMain(); }
    else { setReview(true); focusMain(); }
  }
  async function saveStrategy() {
    if (saving || expired || count !== sectors.length || needsTracking && !workspace.habitSettings.enabled) return;
    setSaving(true); setError("");
    try {
      const next = materializeRestorationStrategy(draft, workspace, {today, startedAt:new Date().toISOString(), calendarMode, language});
      await onChange(next);
    } catch (reason) {
      setError(reason instanceof Error && reason.message === "PRACTICE_DIVINATION_EXPIRED" ? practiceCopy(language).divinationExpired
        : reason instanceof Error && reason.message === "RESTORATION_DUPLICATE_HABIT" ? t.duplicateHabit : t.error); setSaving(false); return;
    }
    let cleanupError = false;
    try { await journal.clearCurrent(sourceRef.current); } catch { cleanupError = !unavailable; }
    onSaved(cleanupError);
  }
  if (!open) return null;
  return createPortal(<div className="genesis-app restoration-portal" data-no-translate>
    <div className="modal-backdrop restoration-backdrop" role="dialog" aria-modal="true" aria-labelledby="restoration-dialog-title" aria-describedby="restoration-dialog-intro" ref={dialogRef} tabIndex={-1}>
      <section className="restoration restoration-dialog">
        <header className="restoration-dialog-heading"><div><h2 id="restoration-dialog-title">{t.strategy}</h2><p id="restoration-dialog-intro">{t.strategyIntro}</p></div>
          <DialogCloseButton aria-label={t.close} disabled={saving} onClick={onClose} />
        </header>
        <div className="restoration-dialog-body"><aside className="restoration-card-sidebar">
          <h3>{t.cards}</h3><p className="restoration-ready-count" aria-live="polite">{t.cardsReady}: <strong>{count} {t.countOf} {sectors.length}</strong></p>
          <nav className="restoration-card-list" aria-label={t.cards}>{sectors.map(id => {
            const item = draft.cards[RESTORATION_POSITION_IDS.indexOf(id as typeof RESTORATION_POSITION_IDS[number])];
            const chosen = letters.find(letter => letter.id === item.letterId)!;
            const state = savedFor(id) || restorationPlanReady(draft,id,draft.plans[id]) ? "ready" : draft.plans[id].touched ? "inProgress" : "notStarted";
            return <button type="button" key={id} aria-current={!review && sector.id === id ? "true" : undefined} onClick={() => chooseCard(id)} disabled={saving}>
              <span className="restoration-letter-mark" aria-hidden="true">{chosen.symbol}</span><span><strong>{chosen.name}</strong><small>{local(RESTORATION_SECTORS.find(sector => sector.id === id)!.title).split(/[·•]/)[0].trim()}</small><em className={`restoration-card-state state-${state}`}>{state === "ready" ? <ExperimentalIcon name="check" /> : null}{t[state]}</em></span>
            </button>;
          })}</nav>
          <button type="button" className="secondary-button restoration-review-button" aria-pressed={review} onClick={() => { setReview(true); focusMain(); }} disabled={saving}><ExperimentalIcon name="check" />{t.reviewStrategy}</button>
        </aside><div className="restoration-editor">
          {review ? <div className="restoration-review" ref={mainRef} tabIndex={-1}>
            <h3>{t.allSelected}</h3><p>{t.reviewHelp}</p><p className="restoration-note" role="note">{practiceCopy(language).warning}</p>
            {sectors.map(id => {
              const snapshot = savedFor(id);
              const item = draft.cards[RESTORATION_POSITION_IDS.indexOf(id as typeof RESTORATION_POSITION_IDS[number])];
              const selected = letters.find(letter => letter.id === item.letterId)!;
              const selectedPlan = draft.plans[id];
              const ready = Boolean(snapshot) || restorationPlanReady(draft,id,selectedPlan);
              const copy = restorationRecommendation(draft,id,selectedPlan,language);
              return <section className="restoration-review-item" key={id}><header><h4>{selected.symbol} · {selected.name} · {local(RESTORATION_SECTORS.find(sector => sector.id === id)!.title)}</h4><span className="restoration-status">{ready ? t.ready : t.inProgress}</span></header>
                <h5>{t.intention}</h5><p>{snapshot?.intention ?? selectedPlan.intention}</p>
                {ready ? <><h5>{t.action}</h5>{(snapshot?.action ?? copy.action).split("\n\n").map((text,index) => <p key={index}>{text}</p>)}</> : null}
                <button type="button" className="secondary-button" disabled={saving} onClick={() => chooseCard(id)}>{snapshot ? t.savedCard : ready ? t.editCard : t.prepareCard}<ExperimentalIcon name="chevron" /></button>
              </section>;
            })}
          </div> : <>
            <header className="restoration-selection"><span><b aria-hidden="true">{letter.symbol}</b><span><strong>{letter.name}</strong><small>{local(sector.title)}</small></span></span><span className="restoration-status">{saved ? t.savedCard : plan.prepared ? t.cardReady : t.inProgress}</span></header>
            {saved ? <div className="restoration-main" ref={mainRef} tabIndex={-1}><h3>{t.intention}</h3><p>{saved.intention}</p><h3>{t.action}</h3>{saved.action.split("\n\n").map((text,index) => <p key={index}>{text}</p>)}</div> : <>
            <nav className="restoration-steps" aria-label={t.strategy}>
              {(["meaning", "myth", "equation", "practice"] as const).map((key,index) => <button type="button" key={key} aria-current={plan.step === index ? "step" : undefined} disabled={saving || index === 3 && !resource} onClick={() => changeStep(index)}><span>{index+1}</span>{t[key]}</button>)}
            </nav>
            <div className="restoration-columns"><div className="restoration-main" ref={mainRef} tabIndex={-1} aria-busy={saving}>
              {plan.step === 0 ? <>
                <h3>{t.field}</h3><p>{local(sector.field)}</p>
                <h3>{t.cardFocus} · {letter.name}</h3><p>{local(RESTORATION_LETTER_FOCI[letter.id].risk)}</p>
                <fieldset className="restoration-needs" disabled={saving}><legend>{t.need}</legend><p>{t.possibility}</p>
                  {(["deficit", "excess", "conflict"] as const).map(key => <label key={key}><input type="radio" name="restoration-need" value={key} checked={plan.need === key} onChange={() => changeNeed(key)} /><span>{t[key]}</span></label>)}
                </fieldset>
                <h3>{t.risk}</h3><p>{local(guidance.risk)}</p><h3>{t.quality}</h3><p>{local(guidance.quality)} {local(RESTORATION_LETTER_FOCI[letter.id].quality)}</p>
              </> : null}
              {plan.step === 1 ? <>
                <h3>{t.ambivalence}</h3><p>{local(sector.ambivalence)}</p>
                <h3>{local(sector.myth.title)}</h3><p>{local(sector.myth.body)}</p>
                <a href={sector.myth.url} target="_blank" rel="noreferrer">{t.source} · {sector.myth.source}<ExperimentalIcon name="open" /></a><p className="restoration-note">{t.interpretation}</p>
                <details className="restoration-model"><summary>{local(RESTORATION_FRAMEWORK.title)}</summary><p className="restoration-formula">{RESTORATION_FRAMEWORK.formula}</p><p>{local(RESTORATION_FRAMEWORK.body)}</p></details>
                <fieldset className="restoration-supports" disabled={saving}><legend>{t.supports}</legend><p>{t.supportHelp}</p>
                  {RESTORATION_AUXILIARIES.map(support => <label key={support.id} aria-label={local(support.title)} htmlFor={`restoration-support-${support.id}`}><input id={`restoration-support-${support.id}`} type="checkbox" checked={plan.supportIds.includes(support.id)} onChange={event => patch({supportIds:event.target.checked ? [...plan.supportIds,support.id] : plan.supportIds.filter(id => id !== support.id),resourceLetterId:""})} /><span><strong>{local(support.title)}</strong><small>{local(support.purpose)}</small></span></label>)}
                </fieldset>
              </> : null}
              {plan.step === 2 ? <>
                <h3>{t.resource}</h3><p>{t.resourceHelp}</p>
                <div className="restoration-resources">{equation.candidates.map(candidate => <button type="button" key={candidate.id} disabled={saving} aria-pressed={plan.resourceLetterId === candidate.id} onClick={() => patch({resourceLetterId:candidate.id})}>
                  <b aria-hidden="true">{candidate.symbol}</b><span><strong>{letters.find(item => item.id === candidate.id)?.name} · {candidate.value}</strong><small>{local(RESTORATION_LETTER_FOCI[candidate.id].quality)}</small></span></button>)}</div><p className="restoration-note">{t.arithmeticNote}</p>
              </> : null}
              {plan.step === 3 ? <>
                <h3>{t.contemplation}</h3>{recommendation.practiceText.split("\n\n").map((text,index) => <p key={index}>{text}</p>)}
                <h3>{t.action}</h3>{recommendation.action.split("\n\n").map((text,index) => <p key={index}>{text}</p>)}
                <label className="restoration-field"><span>{t.intention}</span><textarea value={plan.intention} disabled={saving} maxLength={500} rows={3} onChange={event => patch({intention:event.target.value})} /></label>
                <label className="restoration-field"><span>{t.habitOptional}</span><select value={plan.withoutHabit ? "__none__" : plan.linkedHabitId} disabled={saving} onChange={event => patch({linkedHabitId:event.target.value === "__none__" ? "" : event.target.value, withoutHabit:event.target.value === "__none__"})}>
                  <option value="__none__">{t.withoutHabit}</option><option value="" disabled={!workspace.habitSettings.enabled}>{t.newHabit}</option>{workspace.habits.filter(isEligibleRestorationHabit).map(habit => <option key={habit.id} value={habit.id} disabled={sectors.some(id => id !== sector.id && draft.plans[id].linkedHabitId === habit.id)}>{t.existingHabit} · {habit.title}</option>)}
                </select></label><p className="restoration-note">{plan.withoutHabit ? t.withoutHabitHelp : practiceCopy(language).warning}</p>
              </> : null}
            </div><aside className="restoration-equation" aria-label={t.equation}>
              <h3>{t.equation}</h3><p className="restoration-formula">{t.formula}</p>
              <dl><div><dt>{t.original}</dt><dd>{spreadTotal} → <strong>{equation.target}</strong></dd></div><div><dt>A · {letter.name}</dt><dd>{letter.value}</dd></div>
                <div><dt>B · {resource?.name ?? t.resourceQuality}</dt><dd>{resource?.value ?? "?"}</dd></div><div><dt>U · {t.supportSum}</dt><dd>{equation.supportTotal}</dd></div></dl>
              {equation.supports.map(support => <p className="restoration-key" key={support.id}><span lang="grc">{support.word}</span><span>{support.value}</span></p>)}
              {resource ? <p className="restoration-result">{letter.value} + {resource.value} + {equation.supportTotal} = {letter.value+resource.value+equation.supportTotal}<br />{restorationTrace(letter.value+resource.value+equation.supportTotal).join(" → ")}</p> : <p>{t.root} B = {equation.requiredRoot}</p>}
            </aside></div>
            <footer className="restoration-navigation"><button type="button" className="secondary-button" disabled={saving || plan.step === 0} onClick={() => changeStep(plan.step-1)}>{t.back}</button>
              {plan.step < 3 ? <button type="button" className="primary-button" disabled={saving || plan.step === 2 && !resource} onClick={() => changeStep(plan.step+1)}>{t.next}<ExperimentalIcon name="chevron" /></button>
                : <button type="button" className="primary-button" disabled={saving || !resource || !plan.intention.trim()} onClick={finishCard}><ExperimentalIcon name="check" />{t.finishCard}</button>}
            </footer>
            </>}
          </>}
        </div></div>
        <footer className="restoration-dialog-footer"><div className="restoration-draft-status" role="status">
          <span>{unavailable ? t.draftUnavailable : journal.status === "error" ? t.draftError : journal.status === "saved" ? t.draftSaved : t.draftSaving}</span>
          {!unavailable && journal.status !== "error" ? <small>{t.draftHelp}</small> : null}
          {journal.status === "error" && !unavailable ? <button type="button" className="secondary-button" onClick={() => void stage(draft).then(onStaged).catch(() => undefined)}>{t.retryDraft}</button> : null}
          {error ? <p className="restoration-error" role="alert">{error}</p> : null}
          {count < sectors.length ? <small>{t.remainingHelp}</small> : null}
          {!workspace.habitSettings.enabled && needsTracking ? <small>{t.disabled}</small> : null}
          {expired ? <p className="restoration-error">{t.expired}</p> : null}
        </div>{expired ? <button type="button" className="secondary-button restoration-delete-button" disabled={saving} onClick={async () => { setSaving(true); try { await journal.clearCurrent(sourceRef.current); await onDeleted(); } catch { setError(t.draftError); setSaving(false); } }}><ExperimentalIcon name="delete" />{t.delete}</button> : <StoicheionActionButton icon="restoration" className="primary-button" disabled={saving || review && (count !== sectors.length || needsTracking && !workspace.habitSettings.enabled)} onClick={() => { if (!review) {setReview(true);focusMain();} else void saveStrategy(); }}>
          {saving ? t.preparing : review ? t.saveStrategy : t.reviewStrategy}
        </StoicheionActionButton>}</footer>
      </section>
    </div>
  </div>, document.body);
}
