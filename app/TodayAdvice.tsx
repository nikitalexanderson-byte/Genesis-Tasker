"use client";
/* eslint-disable @next/next/no-img-element -- Decorative account-specific artwork uses native lazy loading in both web builds. */

import { useEffect, useMemo, useRef, useState, type PointerEvent, type KeyboardEvent } from "react";
import { loadDailyAdvice,loadSavedAdvice, recordDailyAdvice, type GenesisUser } from "./cloud-sync";
import { ADVICE_CATEGORIES, ADVICE_TOPICS, adviceHabitScores, adviceHabitTopicScores, adviceTaskContext, advicePreferences, todayAdviceHistory, adviceCardVisible, type AdviceScores, type AdviceTopicScores, type AdvicePersonalTask, type DailyAdviceResponse } from "./daily-advice";
import type { Habit } from "./habits";
import labels from "./daily-advice-copy.json";
import collectionLabels from "./advice-collections-copy.json";
import { AdviceBodyText } from "./AdviceBodyText";
import "./daily-advice.css";
import { useDiary } from './DiaryProvider';
import diaryLabels from './diary-copy.json';
import { ExperimentalIcon } from './ExperimentalIcon';
import { DiaryMark } from './DiaryLaunchButton';
import { AdviceShareButton } from './AdviceShareButton';
import { translateText } from './i18n';
import {adviceTargetFromUrl,type AdviceTarget} from './advice-notifications';
import notificationLabels from './advice-notification-copy.json';

function adviceLinkTarget():AdviceTarget|false|null {
  if(typeof window==='undefined')return null;
  const url=new URL(window.location.href);
  return ['advice','adviceDay','adviceCollection'].some(key=>url.searchParams.has(key))?adviceTargetFromUrl(url)??false:null;
}

export function TodayAdvice({ user, habits, tasks, day, ready, onOpenDiary }: { user: GenesisUser; habits: readonly Habit[]; tasks: readonly AdvicePersonalTask[]; day: string; ready: boolean; onOpenDiary?: () => void }) {
  const diary = useDiary(); const diaryText = diaryLabels[user.language];
  const [reactionError, setReactionError] = useState(false);
  const preferences = advicePreferences(user.advicePreferences);
  const [openedAdvice,setOpenedAdvice]=useState<AdviceTarget|false|null>(adviceLinkTarget);
  const [failedOpen,setFailedOpen]=useState('');
  const notificationCopy=notificationLabels[user.language];
  const taskContext = useMemo(() => adviceTaskContext(tasks, day), [tasks, day]);
  const scores = useMemo(() => {
    const values = adviceHabitScores(habits, day);
    for (const category of ADVICE_CATEGORIES) values[category] = Math.min(1000, values[category] + taskContext.scores[category]);
    return values;
  }, [habits, day, taskContext]);
  const topics = useMemo(() => {
    const values = adviceHabitTopicScores(habits, day);
    for (const topic of ADVICE_TOPICS) values[topic] = Math.min(1000, values[topic] + taskContext.topics[topic]);
    return values;
  }, [habits, day, taskContext]);
  const context = JSON.stringify(preferences.smart ? { scores, topics } : { scores: {}, topics: taskContext.topics });
  const requestKey = `${user.uid}:${day}:${user.language}:${JSON.stringify(preferences)}:${JSON.stringify(openedAdvice)}`;
  const [saved, setSaved] = useState<{ key: string; result: DailyAdviceResponse } | null>(null);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [hideError, setHideError] = useState(false);
  const [nextError, setNextError] = useState(false);
  const [selection, setSelection] = useState<{ key: string; id: string } | null>(null);
  const [slide, setSlide] = useState<"previous" | "next" | null>(null);
  const swipeStart = useRef<{ x: number; y: number; id: number } | null>(null);
  const requestSerial = useRef(0);
  const container = useRef<HTMLElement>(null);
  const copy = labels[user.language];
  const result = saved?.key === requestKey ? saved.result : null;
  const cards = result ? todayAdviceHistory(result, preferences) : [];
  const advice = cards.find(card => selection?.key === requestKey && card.id === selection.id)
    ?? cards.find(card => card.id === result?.advice?.id) ?? cards.at(-1) ?? null;
  const selectedIndex = advice ? cards.findIndex(card => card.id === advice.id) : -1;
  const diaryNote = advice ? diary.records.find(row => !row.draftKey && row.note.advice?.id === advice.id)?.note : undefined;
  const archived = diaryNote?.reaction === 'dislike';
  const shown = ready && preferences.enabled && advice && !advice.dismissed && !archived
    && adviceCardVisible(advice,preferences);

  useEffect(() => {
    const open=()=>setOpenedAdvice(adviceLinkTarget());
    window.addEventListener('popstate',open);window.addEventListener('hashchange',open);
    return()=>{window.removeEventListener('popstate',open);window.removeEventListener('hashchange',open);};
  },[]);

  useEffect(() => {
    const online = () => setRetry(value => value + 1);
    const visible = () => { if (document.visibilityState === "visible") online(); };
    const timeKey = () => {
      const now = new Date(), hour = now.getHours();
      return `${now.toDateString()}:${hour < 5 || hour >= 18 ? "evening" : hour < 12 ? "morning" : "day"}:${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
    };
    let clock = timeKey();
    const timer = window.setInterval(() => { const next = timeKey(); if (next !== clock) { clock = next; visible(); } }, 60000);
    window.addEventListener("online", online);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => { window.clearInterval(timer); window.removeEventListener("online", online); window.removeEventListener("focus", visible); document.removeEventListener("visibilitychange", visible); };
  }, []);

  useEffect(() => {
    if (!ready || (!preferences.enabled&&!openedAdvice) || busy || openedAdvice===false) return;
    const controller = new AbortController();
    const serial = ++requestSerial.current;
    const payload = JSON.parse(context) as { scores: AdviceScores; topics: AdviceTopicScores };
    const load=openedAdvice?loadSavedAdvice(openedAdvice,controller.signal):loadDailyAdvice(payload.scores, controller.signal, payload.topics);
    void load.then(result => {
      if (!controller.signal.aborted && serial === requestSerial.current) {
        setFailedOpen('');
        setSaved({ key: requestKey, result });
        setSelection(previous => previous?.key === requestKey ? previous : { key: requestKey, id: result.advice?.id ?? "" });
      }
    }).catch(() => {if(openedAdvice&&!controller.signal.aborted&&serial===requestSerial.current)setFailedOpen(requestKey); /* Never fall back to a draw when a saved notification target cannot be opened. */ });
    return () => controller.abort();
  }, [ready, preferences.enabled, context, requestKey, retry, busy,openedAdvice]);

  useEffect(()=>{
    if(shown&&openedAdvice&&container.current){container.current.scrollIntoView({block:'start',behavior:'auto'});container.current.focus({preventScroll:true});}
  },[shown,openedAdvice,advice?.id]);

  useEffect(() => {
    if (!shown || !container.current) return;
    let inViewport = false; let pending = false; let recorded = false; let active = true;
    const acknowledge = () => {
      if (!active || !inViewport || document.visibilityState !== "visible" || pending || recorded) return;
      pending = true;
      void recordDailyAdvice(advice).then(() => { recorded = true; }).catch(() => undefined).finally(() => { pending = false; });
    };
    const observer = new IntersectionObserver(entries => { inViewport = entries.some(entry => entry.isIntersecting); acknowledge(); }, { threshold: 0.1 });
    observer.observe(container.current);
    document.addEventListener("visibilitychange", acknowledge);
    window.addEventListener("online", acknowledge);
    return () => { active = false; observer.disconnect(); document.removeEventListener("visibilitychange", acknowledge); window.removeEventListener("online", acknowledge); };
  }, [shown, advice]);

  const closeSaved=()=>{const url=new URL(window.location.href);for(const key of ['advice','adviceDay','adviceCollection'])url.searchParams.delete(key);window.history.replaceState(window.history.state,'',url);setOpenedAdvice(null);};
  if(openedAdvice!==null&&(!shown||!advice||!ready||!preferences.enabled))return <aside className="daily-advice-saved-status" data-no-translate>
    <p role="status">{openedAdvice===false||!preferences.enabled||result?notificationCopy.savedUnavailable:failedOpen===requestKey?notificationCopy.savedError:notificationCopy.loading}</p>
    <div>{failedOpen===requestKey?<button type="button" className="secondary-button" onClick={()=>setRetry(value=>value+1)}>{notificationCopy.retry}</button>:null}
      <button type="button" className="secondary-button" onClick={closeSaved}>{notificationCopy.today}</button></div>
  </aside>;
  if ((!shown && !archived) || !advice || !ready || !preferences.enabled) return null;
  const react = async (reaction: 'favorite' | 'dislike') => {
    setReactionError(false); try { await diary.react(advice, reaction); } catch { setReactionError(true); }
  };
  const dismiss = async () => {
    setBusy(true); setHideError(false);
    try {
      await recordDailyAdvice(advice, true);
      setSaved(previous => previous?.key === requestKey ? { ...previous, result: { ...previous.result,
        advice: previous.result.advice?.id === advice.id ? { ...advice, dismissed: true } : previous.result.advice,
        history: (previous.result.history ?? cards).map(card => card.id === advice.id ? { ...card, dismissed: true } : card) } } : previous);
    } catch { setHideError(true); }
    finally { setBusy(false); }
  };
  const next = async () => {
    const latest = result?.advice;
    if (busy || !result?.canNext || !latest) return;
    const serial = ++requestSerial.current;
    setBusy(true); setNextError(false); setHideError(false);
    try {
      const payload = JSON.parse(context) as { scores: AdviceScores; topics: AdviceTopicScores };
      const result = await loadDailyAdvice(payload.scores, undefined, payload.topics, latest);
      if (serial === requestSerial.current) {
        setSaved({ key: requestKey, result });
        setSelection({ key: requestKey, id: result.advice?.id ?? "" }); setSlide("next");
      }
    } catch { if (serial === requestSerial.current) setNextError(true); }
    finally { setBusy(false); }
  };
  const move = (offset: number) => {
    const target = cards[selectedIndex + offset];
    if (busy || !target) return;
    setSlide(offset < 0 ? "previous" : "next");
    setSelection({ key: requestKey, id: target.id });
    setReactionError(false); setHideError(false); setNextError(false);
  };
  const historyEvents = {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (cards.length < 2 || event.pointerType === "mouse" || (event.target as Element).closest("button,a,input,textarea")) return;
      swipeStart.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const start = swipeStart.current; swipeStart.current = null;
      if (!start || start.id !== event.pointerId) return;
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.5) move(dx < 0 ? 1 : -1);
    },
    onPointerCancel() { swipeStart.current = null; },
  };
  const historyKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); move(event.key === "ArrowLeft" ? -1 : 1); }
  };
  const previous = cards.length > 1 ? <button type="button" className="daily-advice-history-arrow daily-advice-icon-action" disabled={busy || selectedIndex <= 0}
    aria-label={copy.previousSaved} title={copy.previousSaved} onKeyDown={historyKeyDown} onClick={() => move(-1)}><ExperimentalIcon name="chevron-left"/></button> : null;
  const position = result?.dailyLimit ? <div className="daily-advice-history" role="group" aria-label={copy.historyLabel}>
    {previous}
    <span role="status" aria-live="polite">{copy.position.replace("{current}", String(advice.sequence ?? result.sequence ?? 1)).replace("{limit}", String(result.dailyLimit))}{!result.canNext ? ` · ${copy.limitReached}` : ""}</span>
    {cards.length > 1 ? <button type="button" className="daily-advice-history-arrow" disabled={busy || selectedIndex >= cards.length - 1}
      aria-label={copy.nextSaved} title={copy.nextSaved} onKeyDown={historyKeyDown} onClick={() => move(1)}><ExperimentalIcon name="chevron"/></button> : null}
  </div> : null;
  const base = (process.env.NEXT_PUBLIC_GENESIS_BASE_PATH?.trim() || "").replace(/\/$/, "");
  const artwork = advice.image && /^\/advice-art\/[a-z0-9-]+\/advice-[a-f0-9]{24}\.webp$/.test(advice.image) ? `${base}${advice.image}` : null;
  if (archived) return <aside {...historyEvents} data-history={cards.length > 1 || undefined} className="daily-advice-card daily-advice-archived" data-no-translate><p role="status">{diaryText.archived}</p><div className="daily-advice-actions"><div className="daily-advice-action-row"><button type="button" className="daily-advice-icon-action" disabled={diary.busy} aria-label={diaryText.undoDislike} title={diaryText.undoDislike} onClick={() => void react('dislike')}><ExperimentalIcon name="undo"/></button>{onOpenDiary ? <button type="button" className="daily-advice-icon-action" aria-label={diaryText.openDiary} title={diaryText.openDiary} onClick={onOpenDiary}><DiaryMark/></button> : null}{result?.canNext ? <button type="button" className="daily-advice-next" disabled={busy} aria-label={copy.next} title={copy.next} onClick={() => void next()}><ExperimentalIcon name="map-refresh"/><span className="daily-advice-next-label">{copy.next}</span></button> : null}</div></div>{position}{reactionError ? <p role="alert">{diaryText.error}</p> : null}</aside>;
  return <aside {...historyEvents} data-collection={advice.collection ?? "aurora"} data-history={cards.length > 1 || undefined} ref={container} tabIndex={openedAdvice?-1:undefined} className={`daily-advice-card${artwork ? " daily-advice-illustrated" : ""}`} aria-labelledby="daily-advice-title" aria-busy={busy} data-no-translate>
    {artwork ? <img className="daily-advice-art" src={artwork} alt="" aria-hidden="true" loading="lazy" decoding="async" /> : null}
    <div className="daily-advice-reading">
    <div className="daily-advice-slide" key={advice.id} data-slide={slide ?? undefined}>
    <header>
      <h2 id="daily-advice-title" lang={advice.language}>{advice.title || copy.title}</h2>
      <button type="button" className="daily-advice-hide" onClick={() => void dismiss()} disabled={busy} aria-label={copy.hide} title={copy.hide}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
      </button>
    </header>
    <AdviceBodyText advice={advice} />
    <footer>{advice.collection!=="philosophers"?<AdviceAttribution text={[collectionLabels[user.language][advice.collection ?? "aurora"], advice.categories.map(id => id === "aphrodisia" && advice.aphrodisiaTheme
      ? copy[`theme${advice.aphrodisiaTheme === "love" ? "Love" : advice.aphrodisiaTheme === "aesthetics" ? "Aesthetics" : "Consciousness"}`]
      : copy.categories[ADVICE_CATEGORIES.indexOf(id)]).join(" · ")].filter(Boolean).join(" · ")} />:null}
    </footer>
    </div>
    <div className="daily-advice-actions">
      <div className="daily-advice-action-row">
        <button type="button" className="daily-advice-icon-action" aria-label={diaryNote?.reaction === 'favorite' ? diaryText.unfavorite : diaryText.favorite} title={diaryNote?.reaction === 'favorite' ? diaryText.unfavorite : diaryText.favorite} aria-pressed={diaryNote?.reaction === 'favorite'} disabled={diary.busy || diary.loading || diary.error} onClick={() => void react('favorite')}><ExperimentalIcon name="advice-like"/></button>
        <button type="button" className="daily-advice-icon-action" aria-label={diaryText.dislike} title={diaryText.dislike} disabled={diary.busy || diary.loading || diary.error} onClick={() => void react('dislike')}><ExperimentalIcon name="advice-dislike"/></button>
        {typeof saved?.result.dailyLimit === "number" ? <button type="button" className="daily-advice-next" aria-label={copy.next} data-tooltip={saved.result.canNext ? copy.next : copy.limitReached} onClick={() => void next()} disabled={busy || !saved.result.canNext}>
          <ExperimentalIcon name="map-refresh"/><span className="daily-advice-next-label">{copy.next}</span>
        </button> : null}
        {diaryNote?.reaction === 'favorite' && onOpenDiary ? <button type="button" className="daily-advice-icon-action" aria-label={diaryText.openDiary} title={diaryText.openDiary} onClick={onOpenDiary}><DiaryMark/></button> : null}
        <div className="daily-advice-return-share"><div className="daily-advice-desktop-history">{position}</div><AdviceShareButton key={advice.id} advice={advice} copy={copy} closeLabel={translateText('Закрыть', user.language)}/></div>
      </div>
    </div>
    {position}
    {reactionError || diary.error ? <p role="alert">{diaryText.error}<button type="button" onClick={() => void diary.refresh()}>{diaryText.retry}</button></p> : null}
    {nextError ? <p role="alert">{copy.nextError}</p> : null}
    {hideError ? <p role="alert">{copy.hideError}</p> : null}
    </div>
  </aside>;
}

function AdviceAttribution({text}:{text:string}) {
  const element=useRef<HTMLSpanElement>(null);
  useEffect(()=>{
    const node=element.current, parent=node?.parentElement;
    if(!node||!parent)return;
    let active=true;
    const fit=()=>{
      node.style.fontSize='';
      const preferred=parseFloat(getComputedStyle(node).fontSize);
      if(node.clientWidth>0&&node.scrollWidth>node.clientWidth)
        node.style.fontSize=`${preferred*node.clientWidth/node.scrollWidth}px`;
    };
    const observer=new ResizeObserver(fit);observer.observe(parent);fit();
    void document.fonts.ready.then(()=>{if(active)fit();});
    return()=>{active=false;observer.disconnect();};
  },[text]);
  return <span className="daily-advice-category-name daily-advice-attribution" ref={element}>{text}</span>;
}
