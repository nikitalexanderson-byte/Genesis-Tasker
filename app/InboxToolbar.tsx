import { useEffect, useRef, useState } from "react";
import type { InboxPosition } from "./ui-visibility";
import { useInboxDrag } from "./use-inbox-drag";

const positions: InboxPosition[] = ["top", "right", "left", "bottom"];
const label = (position: InboxPosition, english: boolean) => (english
  ? { top: "Top", right: "Right", left: "Left", bottom: "Bottom" }
  : { top: "Сверху", right: "Справа", left: "Слева", bottom: "Снизу" })[position];

export function InboxToolbar({ title, scopeLabel, titleId, count, position, compact, english, onPosition, onCompact, onHide }: {
  title: string; scopeLabel: string; titleId?: string; count: number; position: InboxPosition; english: boolean;
  compact: boolean; onPosition: (position: InboxPosition) => void; onCompact: (compact: boolean) => void; onHide: () => void;
}) {
  const { target, dragging, handleProps } = useInboxDrag(onPosition);
  return <>
    <header className="workspace-inbox-header inbox-move-bar">
      <span className="inbox-mobile-heading"><strong>{title}</strong><small>({scopeLabel})</small></span>
      <button type="button" className="inbox-drag-handle" title={english ? "Drag to move the inbox" : "Перетащите плашку, чтобы переместить хаос-бокс"}
        aria-label={english ? "Move inbox" : "Переместить хаос-бокс"} aria-pressed={dragging} {...handleProps}
        onKeyDown={event => { const target = ({ ArrowUp: "top", ArrowDown: "bottom", ArrowLeft: "left", ArrowRight: "right" } as Record<string, InboxPosition>)[event.key]; if (target) { event.preventDefault(); onPosition(target); } }}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h.01M16 5h.01M8 12h.01M16 12h.01M8 19h.01M16 19h.01" /></svg>
        <span id={titleId} className="inbox-heading"><span>{title}</span><span className="inbox-heading-scope">({scopeLabel})</span></span>
      </button>
      <small aria-label={english ? "Task and list count" : "Количество задач и списков"}>{count}</small>
      <button type="button" className="inbox-hide-button" onClick={onHide} title={english ? "Hide inbox" : "Скрыть хаос-бокс"} aria-label={english ? "Hide inbox" : "Скрыть хаос-бокс"}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18M10.5 10.5a2.1 2.1 0 0 0 3 3M7 6.5C4.3 8.2 2 12 2 12s4 7 10 7c1.7 0 3.3-.5 4.8-1.4M10 5.2c.7-.1 1.3-.2 2-.2 6 0 10 7 10 7s-1.2 2.1-3.2 4" /></svg>
      </button>
    <div className="inbox-toolbar-controls"><label className="inbox-control-group inbox-position-choice"><span className="inbox-control-label">{english ? "Position" : "Расположение"}</span>
      <select aria-label={english ? "Inbox position" : "Расположение хаос-бокса"} value={position} onChange={event => onPosition(event.target.value as InboxPosition)}>
        {positions.map(item => <option key={item} value={item}>{label(item, english)}</option>)}
      </select>
    </label><div className="inbox-control-group" role="group" aria-label={english ? "Inbox display" : "Отображение хаос-бокса"}>
      <span className="inbox-control-label">{english ? "Display" : "Отображение"}</span>
      <div className="inbox-display-switch">
        <button type="button" aria-pressed={!compact} onClick={() => onCompact(false)}>{english ? "Detailed" : "Подробно"}</button>
        <button type="button" aria-pressed={compact} onClick={() => onCompact(true)}>{english ? "Compact" : "Кратко"}</button>
      </div>
    </div></div>
    </header>
    {target ? <div className="inbox-dock-preview" aria-live="polite">{english ? "Release to place" : "Отпустите для размещения"}: {label(target, english)}</div> : null}
  </>;
}

/** Same pointer capture and keyboard affordance as the app menu boundary. */
export function InboxResizeBoundary({ position, width, onWidth }: { position: InboxPosition; width: number; onWidth: (width: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; initial: number; width: number } | null>(null);
  const [maximum, setMaximum] = useState(300);
  const [current, setCurrent] = useState(width);
  useEffect(() => {
    const workspace = ref.current?.closest<HTMLElement>('[data-inbox-workspace]');
    if (!workspace) return;
    const update = () => {
      const max = Math.max(300, Math.floor(workspace.clientWidth / 2));
      setMaximum(max);
      const next = Math.max(300, Math.min(max, width));
      setCurrent(next);
      workspace.style.setProperty('--inbox-width', `${next}px`);
    };
    update(); const observer = new ResizeObserver(update); observer.observe(workspace);
    return () => observer.disconnect();
  }, [width, position]);
  const change = (next: number) => {
    const value = Math.round(Math.max(300, Math.min(maximum, next)));
    setCurrent(value);
    ref.current?.closest<HTMLElement>('[data-inbox-workspace]')?.style.setProperty('--inbox-width', `${value}px`);
    return value;
  };
  const cancel = () => { drag.current = null; change(width); };
  // A focusable window splitter exposes range and keyboard resizing, as the menu does.
  // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex
  return <div ref={ref} className="inbox-resize-boundary" role="separator" tabIndex={0} aria-orientation="vertical"
    aria-label="Ширина хаос-бокса" aria-valuemin={300} aria-valuemax={maximum} aria-valuenow={current}
    onPointerDown={event => { if(event.button!==0)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);drag.current={x:event.clientX,initial:current,width:current}; }}
    onPointerMove={event => { const d=drag.current;if(d)d.width=change(d.initial+(event.clientX-d.x)*(position==='right'?-1:1)); }}
    onPointerUp={() => { if(drag.current)onWidth(drag.current.width);drag.current=null; }}
    onPointerCancel={cancel} onLostPointerCapture={() => { if(drag.current)cancel(); }}
    onKeyDown={event => { const next=event.key==='Home'?300:event.key==='End'?maximum:event.key==='ArrowLeft'?current+(position==='right'?16:-16):event.key==='ArrowRight'?current+(position==='right'?-16:16):null;if(next!==null){event.preventDefault();onWidth(change(next));} }} />;
}

export function InboxRestore({ english, onRestore }: { english: boolean; onRestore: () => void }) {
  return <button type="button" className="secondary-button inbox-restore" onClick={onRestore}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>
    {english ? "Show inbox" : "Показать хаос-бокс"}
  </button>;
}
