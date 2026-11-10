"use client";
import {useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent} from 'react';
import type {CalendarMode} from './calendar-data';
import {translateText, type Language} from './i18n';
import {CalendarModeIcon} from './CalendarModeIcon';
import {displayCalendarOrder, moveDisplayCalendar} from './display-calendar-order';
import copy from './display-calendar-order-copy.json';
import './display-calendar-order.css';

type Gesture = {id: CalendarMode; pointer: number; x: number; y: number; timer: number; active: boolean; valid: boolean; original: string; order: CalendarMode[]; row: HTMLDivElement};

export function DisplayCalendarChoice({label, className, enabledCalendars, order, mode, language, onChange, onReorder}: {
  label: string; className: string; enabledCalendars: CalendarMode[]; order: readonly CalendarMode[]; mode: CalendarMode; language: string;
  onChange: (mode: CalendarMode) => Promise<void>; onReorder: (order: CalendarMode[]) => void;
}) {
  const c = Object.prototype.hasOwnProperty.call(copy, language) ? copy[language as keyof typeof copy] : copy.en;
  const saved = displayCalendarOrder(order), identity = `${saved.join(',')}:${enabledCalendars.join(',')}`;
  const currentIdentity = useRef(identity), row = useRef<HTMLDivElement>(null), gesture = useRef<Gesture | null>(null), suppressClick = useRef(false);
  const [preview, setPreview] = useState<CalendarMode[] | null>(null), [moving, setMoving] = useState<CalendarMode | null>(null), [message, setMessage] = useState('');
  const helpId = useId();
  useLayoutEffect(() => { currentIdentity.current = identity; }, [identity]);
  const finish = useCallback((commit: boolean) => {
    const item = gesture.current; if (!item) return;
    window.clearTimeout(item.timer); gesture.current = null;
    if (item.active) {
      suppressClick.current = true;
      if (commit && item.valid && item.original === currentIdentity.current && item.order.join(',') !== item.original.split(':')[0]) {
        onReorder(item.order); setMessage(c.first.replace('{calendar}', c[item.order.find(id => enabledCalendars.includes(id))!]));
      } else if (commit && item.original !== currentIdentity.current) setMessage(c.changed);
    } else if (!commit) suppressClick.current = true;
    if (item.row.hasPointerCapture(item.pointer)) item.row.releasePointerCapture(item.pointer);
    setMoving(null); setPreview(null);
  }, [c, enabledCalendars, onReorder]);
  useEffect(() => {
    const cancel = () => finish(false);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && gesture.current) { event.preventDefault(); finish(false); } };
    const visibility = () => { if (document.hidden) finish(false); };
    const outside = (event: globalThis.PointerEvent) => { if (gesture.current?.pointer === event.pointerId && !gesture.current.active) finish(false); };
    window.addEventListener('keydown', escape); window.addEventListener('blur', cancel); window.addEventListener('resize', cancel); window.addEventListener('scroll', cancel, true);
    window.addEventListener('pointerup', outside); window.addEventListener('pointercancel', outside); document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('keydown', escape); window.removeEventListener('blur', cancel); window.removeEventListener('resize', cancel); window.removeEventListener('scroll', cancel, true);
      window.removeEventListener('pointerup', outside); window.removeEventListener('pointercancel', outside); document.removeEventListener('visibilitychange', visibility);
    };
  }, [finish]);
  useEffect(() => () => {
    const item = gesture.current; gesture.current = null;
    if (item) { window.clearTimeout(item.timer); if (item.row.hasPointerCapture(item.pointer)) item.row.releasePointerCapture(item.pointer); }
  }, []);
  const down = (event: PointerEvent<HTMLButtonElement>, id: CalendarMode) => {
    if (!event.isPrimary || event.button !== 0 || gesture.current || !row.current) return;
    suppressClick.current = false;
    const item: Gesture = {id, pointer: event.pointerId, x: event.clientX, y: event.clientY, timer: 0, active: false, valid: true, original: identity, order: [...saved], row: row.current};
    item.timer = window.setTimeout(() => {
      if (gesture.current !== item || item.original !== currentIdentity.current) { finish(false); return; }
      try { item.row.setPointerCapture(item.pointer); } catch { finish(false); return; }
      item.active = true; setMoving(id); setPreview(item.order);
    }, 350);
    gesture.current = item;
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const item = gesture.current; if (!item || item.pointer !== event.pointerId) return;
    if (!item.active) { if (Math.hypot(event.clientX - item.x, event.clientY - item.y) > 10) finish(false); return; }
    event.preventDefault();
    const rect = item.row.getBoundingClientRect();
    item.valid = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLButtonElement>('[data-display-calendar]');
    if (!item.valid || !target || target.parentElement !== item.row) return;
    const destination = target.dataset.displayCalendar as CalendarMode;
    if (destination === item.id) return;
    item.order = moveDisplayCalendar(item.order, item.id, destination); setPreview(item.order);
  };
  if (enabledCalendars.length < 2) return null;
  return <div className="display-calendar-order" data-no-translate>
    <div ref={row} className={`display-calendar-choice reorderable-display-calendars ${className}`} role="group" aria-label={translateText(label, language as Language)} aria-describedby={helpId}
      data-reordering={moving || undefined} onPointerMove={move} onPointerLeave={() => { if (gesture.current && !gesture.current.active) finish(false); }}
      onPointerUp={event => { if (gesture.current?.pointer === event.pointerId) { move(event); finish(true); } }}
      onPointerCancel={event => { if (gesture.current?.pointer === event.pointerId) finish(false); }}
      onLostPointerCapture={event => { if (event.target === event.currentTarget && gesture.current?.pointer === event.pointerId) finish(false); }}>
      {(preview ?? saved).filter(id => enabledCalendars.includes(id)).map(id => <button type="button" key={id} className="secondary-button"
        data-display-calendar={id} data-calendar-dragging={moving === id || undefined} aria-pressed={mode === id} aria-label={c[id]} title={c[id]} aria-describedby={helpId}
        onPointerDown={event => down(event, id)} onDragStart={event => event.preventDefault()}
        onContextMenu={event => { if (gesture.current) event.preventDefault(); }}
        onClick={event => { if (suppressClick.current && event.detail !== 0) { event.preventDefault(); suppressClick.current = false; } else void onChange(id); }}
        onKeyDown={event => {
          if (!event.altKey || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault(); finish(false);
          const visible = saved.filter(item => enabledCalendars.includes(item)), index = visible.indexOf(id);
          const destination = event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1 : Math.max(0, Math.min(visible.length - 1, index + (event.key === 'ArrowLeft' ? -1 : 1)));
          if (destination === index) return;
          const next = moveDisplayCalendar(saved, id, visible[destination]); onReorder(next); setMessage(c.first.replace('{calendar}', c[next.find(item => enabledCalendars.includes(item))!]));
        }}><CalendarModeIcon mode={id}/><span>{c[id]}</span></button>)}
    </div>
    <p id={helpId} className="sr-only">{c.help}</p><span className="sr-only" role="status" aria-live="polite">{message}</span>
  </div>;
}
