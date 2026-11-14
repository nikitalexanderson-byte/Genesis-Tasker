"use client";
import {useEffect, useRef, useState, type DragEvent} from 'react';
import {DialogCloseButton} from './DialogCloseButton';
import {ExperimentalIcon} from './ExperimentalIcon';
import {translateText, type Language} from './i18n';
import {effectiveTodayBlockOrder, moveTodayBlock, todayHalfBlocks, TODAY_BLOCK_IDS, type TodayBlockId} from './today-block-order';
import copy from './today-block-order-copy.json';
import './today-block-order.css';

function orderCopy(language: string) {
  return Object.prototype.hasOwnProperty.call(copy, language) ? copy[language as keyof typeof copy] : copy.en;
}

export function TodayBlockOrderButton({language, onClick}: {language: string; onClick: () => void}) {
  const c = orderCopy(language);
  return <button type="button" className="icon-button ux-action-button today-order-toggle" aria-label={c.title}
    data-tooltip={c.title} aria-haspopup="dialog" onClick={onClick}><ExperimentalIcon name="settings"/></button>;
}

export function TodayBlockOrderDialog({order, halfBlocks = [], hiddenBlocks = [], webVisibility = false, language, onSave, onClose}: {
  order: readonly TodayBlockId[] | null; halfBlocks?: readonly TodayBlockId[]; hiddenBlocks?: readonly string[]; webVisibility?: boolean; language: string; onSave: (order: TodayBlockId[], failureMessage: string, halfBlocks: TodayBlockId[], hiddenBlocks: TodayBlockId[]) => Promise<void>; onClose: () => void;
}) {
  const c = orderCopy(language);
  const [draft, setDraft] = useState(() => effectiveTodayBlockOrder(order));
  const [halves, setHalves] = useState(() => todayHalfBlocks(halfBlocks));
  const [hidden, setHidden] = useState(() => TODAY_BLOCK_IDS.filter(id => hiddenBlocks.includes(id)));
  const [saving, setSaving] = useState(false), [saveError, setSaveError] = useState('');
  const [moving, setMoving] = useState<TodayBlockId | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const dialog = useRef<HTMLDialogElement>(null), drag = useRef<TodayBlockId | null>(null);
  useEffect(() => {
    const previous = document.activeElement, element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const move = (source: TodayBlockId, target: TodayBlockId) => {
    const next = moveTodayBlock(draft, source, target);
    setDraft(next); setAnnouncement(`${c[source]}: ${new Intl.NumberFormat(language).format(next.indexOf(source) + 1)} / ${next.length}`);
  };
  const drop = (event: DragEvent<HTMLLIElement>, target: TodayBlockId) => {
    if (!drag.current) return;
    event.preventDefault(); move(drag.current, target); drag.current = null; setMoving(null);
  };
  return <dialog ref={dialog} className="today-order-dialog" aria-labelledby="today-order-title" aria-describedby="today-order-hint" data-no-translate data-web-visibility={webVisibility || undefined}
    onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}>
    <header><h2 id="today-order-title">{c.title}</h2><DialogCloseButton aria-label={c.cancel} disabled={saving} onClick={onClose}/></header>
    <p id="today-order-hint">{c.hint}</p>
    <p className="today-order-width-hint">{c.widthHint}</p>
    <p className="today-order-fixed"><ExperimentalIcon name="lock"/>{c.fixed}</p>
    <ol className="today-order-list">
      {draft.map((id, index) => <li key={id} data-order-block={id} className={moving === id ? 'is-moving' : ''}
        onDragOver={event => { if (drag.current) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }} onDrop={event => drop(event, id)}>
        <button type="button" className="today-order-grip" aria-label={`${c.drag}: ${c[id]}`} title={c.drag} draggable
          onDragStart={event => { drag.current = id; setMoving(id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id); }}
          onDragEnd={() => { drag.current = null; setMoving(null); }}
          onKeyDown={event => {
            const target = event.key === 'ArrowUp' ? draft[index - 1] : event.key === 'ArrowDown' ? draft[index + 1] : event.key === 'Home' ? draft[0] : event.key === 'End' ? draft.at(-1) : null;
            if (target) { event.preventDefault(); move(id, target); }
          }}><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg></button>
        <span>{c[id]}</span>
        {webVisibility ? <button type="button" className="today-order-visibility" aria-pressed={!hidden.includes(id)}
          aria-label={`${translateText(hidden.includes(id) ? 'Показать' : 'Скрыть', language as Language)}: ${c[id]}`}
          title={translateText(hidden.includes(id) ? 'Показать' : 'Скрыть', language as Language)}
          onClick={() => setHidden(current => current.includes(id) ? current.filter(block => block !== id) : TODAY_BLOCK_IDS.filter(block => block === id || current.includes(block)))}>
          <ExperimentalIcon name={hidden.includes(id) ? 'eye-off' : 'eye'}/>
        </button> : null}
        <div className="today-order-width" role="group" aria-label={`${c.width}: ${c[id]}`}>
          <button type="button" aria-label={c.full} aria-pressed={!halves.includes(id)} onClick={() => setHalves(current => current.filter(block => block !== id))}>100%</button>
          <button type="button" aria-label={c.half} aria-pressed={halves.includes(id)} onClick={() => setHalves(current => todayHalfBlocks([...current, id]))}>50%</button>
        </div>
        <div className="today-order-arrows">
          <button type="button" aria-label={`${c.up}: ${c[id]}`} title={c.up} aria-disabled={index === 0}
            onClick={() => { if (index > 0) move(id, draft[index - 1]); }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 14 6-6 6 6"/></svg></button>
          <button type="button" aria-label={`${c.down}: ${c[id]}`} title={c.down} aria-disabled={index === draft.length - 1}
            onClick={() => { if (index < draft.length - 1) move(id, draft[index + 1]); }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 10 6 6 6-6"/></svg></button>
        </div>
      </li>)}
    </ol>
    <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    {saveError ? <p role="alert">{saveError}</p> : null}
    <footer><button type="button" className="secondary-button today-order-reset" onClick={() => { setDraft([...TODAY_BLOCK_IDS]); setHalves([]); }}>{c.reset}</button>
      <button type="button" className="secondary-button" disabled={saving} onClick={onClose}>{c.cancel}</button>
      <button type="button" className="primary-button" disabled={saving} onClick={() => { setSaving(true); setSaveError(''); void onSave([...draft], c.saveFailure, halves, hidden).then(onClose).catch(() => setSaveError(c.saveFailure)).finally(() => setSaving(false)); }}>{c.save}</button></footer>
  </dialog>;
}
