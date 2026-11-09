import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import type { InboxPosition } from "./ui-visibility";

type InboxDrag = {
  card: HTMLElement; workspace: HTMLElement; handle: HTMLButtonElement; pointerId: number;
  x: number; y: number; point: { x: number; y: number }; active: boolean;
  originalStyle: string | null; placeholder: HTMLElement | null; scrollParents: HTMLElement[];
};

function dockAt(drag: InboxDrag): InboxPosition {
  const rect = drag.workspace.getBoundingClientRect();
  const top = Math.max(0, rect.top);
  const bottom = Math.min(window.innerHeight, rect.bottom);
  const height = Math.max(1, bottom - top);
  if (drag.point.y < top + height * .25) return "top";
  if (drag.point.y > bottom - height * .25) return "bottom";
  return drag.point.x < rect.left + rect.width / 2 ? "left" : "right";
}

export function useInboxDrag(onPosition: (position: InboxPosition) => void) {
  const candidate = useRef<InboxDrag | null>(null);
  const frame = useRef<number | null>(null);
  const lastFrame = useRef<number | null>(null);
  const [target, setTarget] = useState<InboxPosition | null>(null);
  const [dragging, setDragging] = useState(false);

  const reset = useCallback(() => {
    const drag = candidate.current;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null; lastFrame.current = null; candidate.current = null;
    if (drag) {
      if (drag.originalStyle === null) drag.card.removeAttribute("style");
      else drag.card.setAttribute("style", drag.originalStyle);
      drag.card.classList.remove("is-inbox-dragging");
      drag.placeholder?.remove();
      if (drag.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
      delete document.documentElement.dataset.inboxDragging;
    }
    setDragging(false); setTarget(null);
  }, []);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && candidate.current) { event.preventDefault(); reset(); } };
    window.addEventListener("blur", reset); document.addEventListener("keydown", escape);
    return () => { window.removeEventListener("blur", reset); document.removeEventListener("keydown", escape); reset(); };
  }, [reset]);

  const scroll = (timestamp: number) => {
    const drag = candidate.current;
    if (!drag?.active) return;
    const elapsed = Math.min(40, timestamp - (lastFrame.current ?? timestamp - 16.7)) / 1000;
    lastFrame.current = timestamp;
    for (const parent of drag.scrollParents) {
      const viewport = parent === document.scrollingElement;
      const rect = parent.getBoundingClientRect();
      const top = viewport ? 0 : Math.max(0, rect.top);
      const bottom = viewport ? innerHeight : Math.min(innerHeight, rect.bottom);
      const edge = Math.min(96, (bottom - top) / 3);
      if (edge <= 0) continue;
      const y = drag.point.y;
      const direction = y < top + edge ? -1 : y > bottom - edge ? 1 : 0;
      if (!direction) continue;
      const depth = direction < 0 ? top + edge - y : y - bottom + edge;
      const speed = 180 + Math.min(1, depth / edge) * 780;
      const next = Math.max(0, Math.min(parent.scrollHeight - parent.clientHeight, parent.scrollTop + direction * speed * elapsed));
      if (Math.abs(next - parent.scrollTop) < .5) continue;
      parent.scrollTo({ top: next, behavior: "instant" });
      break;
    }
    setTarget(dockAt(drag));
    frame.current = requestAnimationFrame(scroll);
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const workspace = event.currentTarget.closest<HTMLElement>("[data-inbox-workspace]");
    if (!workspace) return;
    let card: HTMLElement = event.currentTarget;
    while (card.parentElement && card.parentElement !== workspace) card = card.parentElement;
    const scrollParents: HTMLElement[] = [];
    for (let parent: HTMLElement | null = workspace; parent; parent = parent.parentElement) {
      if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) scrollParents.push(parent);
    }
    if (document.scrollingElement && !scrollParents.includes(document.scrollingElement as HTMLElement)) scrollParents.push(document.scrollingElement as HTMLElement);
    event.stopPropagation(); event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    candidate.current = { card, workspace, handle: event.currentTarget, pointerId: event.pointerId,
      x: event.clientX, y: event.clientY, point: { x: event.clientX, y: event.clientY }, active: false,
      originalStyle: card.getAttribute("style"), placeholder: null, scrollParents };
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = candidate.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.point = { x: event.clientX, y: event.clientY };
    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 8) return;
      const rect = drag.card.getBoundingClientRect();
      const placeholder = document.createElement("div");
      placeholder.className = "inbox-drag-placeholder"; placeholder.setAttribute("aria-hidden", "true");
      placeholder.style.height = `${rect.height}px`;
      drag.card.before(placeholder); drag.placeholder = placeholder;
      Object.assign(drag.card.style, { position: "fixed", left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, margin: "0", zIndex: "1200" });
      drag.card.classList.add("is-inbox-dragging"); drag.active = true;
      document.documentElement.dataset.inboxDragging = "true"; setDragging(true);
      frame.current = requestAnimationFrame(scroll);
    }
    event.preventDefault(); event.stopPropagation();
    drag.card.style.transform = `translate(${event.clientX - drag.x}px, ${event.clientY - drag.y}px)`;
    setTarget(dockAt(drag));
  };

  const onPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = candidate.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.point = { x: event.clientX, y: event.clientY };
    const destination = drag.active ? dockAt(drag) : null;
    event.stopPropagation(); reset();
    if (destination) onPosition(destination);
  };

  return { target, dragging, handleProps: { onPointerDown, onPointerMove, onPointerUp,
    onPointerCancel: reset, onLostPointerCapture: reset,
    onClick: (event: MouseEvent<HTMLButtonElement>) => { event.preventDefault(); event.stopPropagation(); } } };
}
