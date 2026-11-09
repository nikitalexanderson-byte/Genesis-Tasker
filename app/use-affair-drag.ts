"use client";

import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type TouchEvent } from "react";

export function useAffairDrag<T extends { id: string; title: string }, D>(
  targetAt: (x: number, y: number, item: T) => D | null,
  onDrop: (item: T, target: D) => void,
) {
  const [preview, setPreview] = useState<{ item: T; x: number; y: number } | null>(null);
  const [target, setTarget] = useState<D | null>(null);
  const candidate = useRef<{ item: T; source: HTMLElement; capture?: HTMLElement; x: number; y: number; active: boolean; pointerId?: number; timer?: number } | null>(null);
  const point = useRef<{ x: number; y: number } | null>(null);
  const frame = useRef<number | null>(null);
  const lastFrame = useRef<number | null>(null);
  const suppressClick = useRef(false);

  const reset = () => {
    if (candidate.current?.timer) window.clearTimeout(candidate.current.timer);
    if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    candidate.current = null; point.current = null; frame.current = null; lastFrame.current = null;
    setPreview(null); setTarget(null);
  };
  useEffect(() => {
    const preventScroll = (event: Event) => {
      if (candidate.current?.active && event.cancelable) event.preventDefault();
    };
    document.addEventListener("touchmove", preventScroll, { capture: true, passive: false });
    return () => {
      document.removeEventListener("touchmove", preventScroll, true);
      if (candidate.current?.timer) window.clearTimeout(candidate.current.timer);
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    };
  }, []);
  const scroll = (timestamp: number) => {
    frame.current = null;
    const p = point.current; const drag = candidate.current;
    if (!p || !drag?.active) return;
    const elapsed = Math.min(40, Math.max(1, timestamp - (lastFrame.current ?? timestamp - 16.7))) / 1000;
    const containers: Element[] = [];
    let el = document.elementFromPoint(p.x, p.y);
    while (el && el !== document.scrollingElement) { containers.push(el); el = el.parentElement; }
    el = drag.source;
    while (el && el !== document.scrollingElement) { if (!containers.includes(el)) containers.push(el); el = el.parentElement; }
    if (document.scrollingElement) containers.push(document.scrollingElement);
    let moved = false;
    for (const axis of ["x", "y"] as const) {
      for (const container of containers) {
        const viewport = container === document.scrollingElement;
        const style = getComputedStyle(container);
        if (!viewport && !/auto|scroll/.test(axis === "x" ? style.overflowX : style.overflowY)) continue;
        const rect = container.getBoundingClientRect();
        if (!viewport && (axis === "x" ? p.y < rect.top || p.y > rect.bottom : p.x < rect.left || p.x > rect.right)) continue;
        const start = viewport ? 0 : Math.max(0, axis === "x" ? rect.left : rect.top);
        const end = viewport ? (axis === "x" ? window.innerWidth : window.innerHeight) : Math.min(axis === "x" ? window.innerWidth : window.innerHeight, axis === "x" ? rect.right : rect.bottom);
        const edge = Math.min(100, (end - start) / 3);
        const position = p[axis];
        if (edge <= 0) continue;
        const direction = position < start + edge ? -1 : position > end - edge ? 1 : 0;
        if (!direction) continue;
        const depth = direction < 0 ? start + edge - position : position - end + edge;
        const speed = 180 + Math.min(1, depth / edge) * 780;
        const current = axis === "x" ? container.scrollLeft : container.scrollTop;
        const max = axis === "x" ? container.scrollWidth - container.clientWidth : container.scrollHeight - container.clientHeight;
        const next = Math.max(0, Math.min(max, current + direction * speed * elapsed));
        if (Math.abs(next - current) < .5) continue;
        container.scrollTo({ [axis === "x" ? "left" : "top"]: next, behavior: "instant" });
        moved = true; break;
      }
    }
    if (moved) { lastFrame.current = timestamp; setTarget(targetAt(p.x, p.y, drag.item)); frame.current = requestAnimationFrame(scroll); }
    else lastFrame.current = null;
  };
  const update = (x: number, y: number) => {
    const drag = candidate.current;
    if (!drag?.active) return;
    point.current = { x, y }; setPreview({ item: drag.item, x, y }); setTarget(targetAt(x, y, drag.item));
    if (frame.current === null) frame.current = requestAnimationFrame(scroll);
  };
  const finish = (x: number, y: number, cancelled = false) => {
    const drag = candidate.current;
    if (drag?.active) {
      const destination = cancelled ? null : targetAt(x, y, drag.item);
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 350);
      if (destination) onDrop(drag.item, destination);
    }
    reset();
  };
  const control = (value: EventTarget) => value instanceof Element
    && !value.closest("[data-affair-drag-surface]")
    && Boolean(value.closest("button, input, select, textarea, a, summary, label, [contenteditable=true]"));
  const props = (item: T, enabled = true) => ({
    "data-affair-item-id": item.id,
    "data-dragging": preview?.item.id === item.id || undefined,
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (!enabled || event.pointerType === "touch" || event.button !== 0 || control(event.target)) return;
      const surface=event.target instanceof Element ? event.target.closest<HTMLElement>("[data-affair-drag-surface]") : null;
      const capture=surface && event.currentTarget.contains(surface) ? surface : event.currentTarget;
      candidate.current = { item, source: event.currentTarget, capture, x: event.clientX, y: event.clientY, pointerId: event.pointerId, active: false };
      // Keep text selection and native text/image dragging from taking this gesture.
      capture.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const drag = candidate.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 4) {
        drag.active = true;
      }
      if (drag.active) { event.preventDefault(); update(event.clientX, event.clientY); }
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      if (candidate.current?.pointerId !== event.pointerId) return;
      const capture=candidate.current.capture;
      finish(event.clientX, event.clientY);
      if (capture?.hasPointerCapture(event.pointerId)) capture.releasePointerCapture(event.pointerId);
    },
    onPointerCancel: () => reset(),
    onLostPointerCapture: () => { if (candidate.current?.pointerId !== undefined) reset(); },
    onTouchStart: (event: TouchEvent<HTMLElement>) => {
      if (event.touches.length !== 1) { reset(); return; }
      if (!enabled || control(event.target)) return;
      reset();
      const touch = event.touches[0];
      const drag = { item, source: event.currentTarget, x: touch.clientX, y: touch.clientY, active: false, timer: 0 };
      candidate.current = drag;
      drag.timer = window.setTimeout(() => {
        if (candidate.current !== drag) return;
        drag.active = true; update(drag.x, drag.y);
      }, 450);
    },
    onTouchMove: (event: TouchEvent<HTMLElement>) => {
      const drag = candidate.current; const touch = event.touches[0];
      if (!drag || !touch || drag.pointerId !== undefined) return;
      if (!drag.active && Math.hypot(touch.clientX - drag.x, touch.clientY - drag.y) > 8) { reset(); return; }
      update(touch.clientX, touch.clientY);
    },
    onTouchEnd: (event: TouchEvent<HTMLElement>) => {
      const touch = event.changedTouches[0]; if (touch) finish(touch.clientX, touch.clientY);
    },
    onTouchCancel: () => reset(),
    onClickCapture: (event: MouseEvent<HTMLElement>) => {
      if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); }
    },
    onDragStart: (event: React.DragEvent<HTMLElement>) => { if (candidate.current) event.preventDefault(); },
    onContextMenu: (event: MouseEvent<HTMLElement>) => { if (candidate.current) event.preventDefault(); },
  });
  return { preview, target, props };
}
