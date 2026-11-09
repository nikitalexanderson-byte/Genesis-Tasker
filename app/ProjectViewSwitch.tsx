"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { translateText, type Language } from "./i18n";
import { PROJECT_VIEWS, moveProjectView, type ProjectView } from "./project-view-order";
import copy from "./project-view-order-copy.json";
import "./project-view-order.css";

type DragPreview = { id: ProjectView; x: number; y: number; width: number; height: number; fontSize: string; valid: boolean };
type Gesture = {
  id: ProjectView; pointer: number; x: number; y: number; active: boolean; timer: number; original: string;
  capture: HTMLDivElement; order: ProjectView[]; offsetX: number; offsetY: number; lift: number; valid: boolean;
  touch: boolean; width: number; height: number; fontSize: string;
};
const names = { list: "Список", board: "Доски", calendar: "Календарь", gantt: "Гант" };

export function ProjectViewSwitch({ order, active, language, dropView, onSelect, onReorder }: {
  order: ProjectView[] | null; active: ProjectView; language: Language; dropView?: string;
  onSelect: (view: ProjectView) => void; onReorder: (views: ProjectView[]) => void;
}) {
  const saved = order ?? [...PROJECT_VIEWS], identity = saved.join(","), helpId = useId();
  const currentIdentity = useRef(identity);
  useLayoutEffect(() => { currentIdentity.current = identity; }, [identity]);
  const container = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null), suppressClick = useRef(false);
  const [preview, setPreview] = useState<ProjectView[] | null>(null), [dragging, setDragging] = useState<DragPreview | null>(null);
  const [pressing, setPressing] = useState<ProjectView | null>(null);
  const [message, setMessage] = useState("");
  const labels = copy[language];
  const label = (view: ProjectView) => translateText(names[view], language);
  const finish = useCallback((commit: boolean) => {
    const item = gesture.current; if (!item) return;
    window.clearTimeout(item.timer); gesture.current = null;
    if (item.active) {
      suppressClick.current = true;
      if (commit && item.valid && item.original === currentIdentity.current && item.order.join(",") !== item.original) {
        onReorder(item.order); setMessage(labels.first.replace("{view}", translateText(names[item.order[0]], language)));
      } else if (commit && item.original !== currentIdentity.current) setMessage(labels.changed);
    }
    if (item.capture.hasPointerCapture(item.pointer)) item.capture.releasePointerCapture(item.pointer);
    setPreview(null); setDragging(null); setPressing(null);
  }, [labels, language, onReorder]);
  useEffect(() => {
    const cancel = () => finish(false);
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && gesture.current) { event.preventDefault(); finish(false); }
    };
    const visibility = () => { if (document.hidden) finish(false); };
    const releasedOutside = (event: globalThis.PointerEvent) => {
      if (gesture.current?.pointer === event.pointerId && !gesture.current.active) finish(false);
    };
    window.addEventListener("keydown", escape);
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    window.addEventListener("scroll", cancel, true);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pointerup", releasedOutside);
    window.addEventListener("pointercancel", releasedOutside);
    return () => {
      window.removeEventListener("keydown", escape);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
      window.removeEventListener("scroll", cancel, true);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pointerup", releasedOutside);
      window.removeEventListener("pointercancel", releasedOutside);
    };
  }, [finish]);
  useEffect(() => () => {
    const item = gesture.current; gesture.current = null;
    if (item) {
      window.clearTimeout(item.timer);
      if (item.capture.hasPointerCapture(item.pointer)) item.capture.releasePointerCapture(item.pointer);
    }
  }, []);
  const activate = (item: Gesture) => {
    if (gesture.current !== item || item.original !== currentIdentity.current) { finish(false); return false; }
    // Capture the stable row: moving a captured button in the DOM breaks capture.
    try { item.capture.setPointerCapture(item.pointer); } catch { finish(false); return false; }
    window.clearTimeout(item.timer); item.active = true; setPressing(null); setPreview(item.order);
    setDragging({ id: item.id, x: item.x - item.offsetX, y: Math.max(8, item.y - item.offsetY - item.lift),
      width: item.width, height: item.height, fontSize: item.fontSize, valid: true });
    return true;
  };
  const down = (event: PointerEvent<HTMLButtonElement>, id: ProjectView) => {
    if (!event.isPrimary || event.button !== 0 || gesture.current || !container.current) return;
    suppressClick.current = false;
    const button = event.currentTarget, capture = container.current, rect = button.getBoundingClientRect();
    const item: Gesture = {
      id, pointer: event.pointerId, x: event.clientX, y: event.clientY, active: false, timer: 0, original: identity,
      capture, order: [...saved], offsetX: event.clientX - rect.x, offsetY: event.clientY - rect.y,
      lift: event.pointerType === "touch" ? rect.height + 12 : 12, valid: true,
      touch: event.pointerType === "touch", width: rect.width, height: rect.height, fontSize: getComputedStyle(button).fontSize,
    };
    item.timer = window.setTimeout(() => activate(item), 350);
    gesture.current = item; setPressing(id);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const item = gesture.current; if (!item || event.pointerId !== item.pointer) return;
    if (!item.active) {
      const distance = Math.hypot(event.clientX - item.x, event.clientY - item.y);
      if (item.touch) { if (distance > 12) finish(false); return; }
      // A normal mouse drag starts as soon as it moves; waiting 350 ms rejected it.
      if (distance <= 4 || !activate(item)) return;
    }
    event.preventDefault();
    const bounds = item.capture.getBoundingClientRect();
    item.valid = event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
    setDragging(current => current ? { ...current,
      x: Math.max(0, Math.min(window.innerWidth - current.width, event.clientX - item.offsetX)),
      y: Math.max(8, Math.min(window.innerHeight - current.height - 8, event.clientY - item.offsetY - item.lift)), valid: item.valid,
    } : null);
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLButtonElement>("[data-project-view]");
    if (!item.valid || !target || target.parentElement !== item.capture) return;
    const id = target.dataset.projectView as ProjectView;
    if (id === item.id) return;
    item.order = moveProjectView(item.order, item.id, id); setPreview(item.order);
  };
  return <>
    <div ref={container} className="shared-projects-view-switch reorderable-project-views" role="group" aria-label={translateText("Вид проекта", language)}
      aria-describedby={helpId} data-reordering={dragging ? true : undefined} data-drop-valid={dragging?.valid}
      onContextMenu={event => event.preventDefault()}
      onPointerLeave={() => { if (gesture.current && !gesture.current.active) finish(false); }}
      onPointerMove={move} onPointerUp={event => {
        if (gesture.current?.pointer !== event.pointerId) return;
        move(event); finish(true);
      }} onPointerCancel={event => { if (gesture.current?.pointer === event.pointerId) finish(false); }}
      onLostPointerCapture={event => { if (event.target === event.currentTarget && gesture.current?.pointer === event.pointerId) finish(false); }}>
      {(preview ?? saved).map(view => <button key={view} type="button" data-project-view={view}
        data-shared-drop-view={view === "list" || view === "board" ? view : undefined} data-drop-active={dropView === view || undefined}
        data-view-dragging={dragging?.id === view || undefined} aria-pressed={active === view} aria-describedby={helpId}
        data-view-pressing={pressing === view || undefined}
        onContextMenu={event => event.preventDefault()} onDragStart={event => event.preventDefault()} onPointerDown={event => down(event, view)}
        onClick={event => { if (suppressClick.current && event.detail !== 0) { event.preventDefault(); suppressClick.current = false; } else onSelect(view); }}
        onKeyDown={event => {
          if (event.key === "Escape" && gesture.current) { event.preventDefault(); finish(false); return; }
          if (!event.altKey || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault(); const index = saved.indexOf(view);
          const destination = event.key === "Home" ? 0 : event.key === "End" ? saved.length - 1 : Math.max(0, Math.min(saved.length - 1, index + (event.key === "ArrowLeft" ? -1 : 1)));
          if (destination === index) return;
          const next = moveProjectView(saved, view, saved[destination]); onReorder(next); setMessage(labels.first.replace("{view}", label(next[0])));
        }}>{label(view)}</button>)}
    </div>
    {dragging ? createPortal(<div className="project-view-drag-preview" aria-hidden="true" data-no-translate data-drop-valid={dragging.valid}
      style={{ transform: `translate3d(${dragging.x}px, ${dragging.y}px, 0)`, width: dragging.width, height: dragging.height, fontSize: dragging.fontSize }}>
      {label(dragging.id)}
    </div>, document.body) : null}
    <p id={helpId} className="project-view-order-help">{labels.help}</p>
    <span className="sr-only" aria-live="polite">{message}</span>
  </>;
}
