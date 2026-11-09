"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./button-tooltips.css";

type Hint = { control: HTMLElement; label: string; above: boolean; target: HTMLElement };
const controls = 'button, a[href], [role="button"]';

function visibleText(control: HTMLElement) {
  const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT);
  let text = "";
  while (walker.nextNode()) {
    const node = walker.currentNode, parent = node.parentElement;
    if (!parent || parent.closest('[aria-hidden="true"], .sr-only, [role="tooltip"], svg')) continue;
    if (!parent.getClientRects().length || getComputedStyle(parent).visibility === "hidden") continue;
    text += node.textContent;
  }
  // Arrow, close and other glyph-only controls still need a written description.
  return /[\p{L}\p{N}]/u.test(text);
}

/** One renderer for icon controls, including lazy views, links and native dialogs. */
export function ButtonTooltips() {
  const id = useId(), [hint, setHint] = useState<Hint | null>(null), popup = useRef<HTMLSpanElement>(null);
  const current = useRef<Hint | null>(null);
  useEffect(() => {
    let hovered: HTMLElement | null = null, focused: HTMLElement | null = null, pointerType = "mouse";
    let keyboardFrame = 0, tabFocusPending = false, focusedHint = false;
    const muted = new Map<HTMLElement, { title: string | null; addedLabel: string | null }>();
    const originalTitle = (control: HTMLElement) => muted.get(control)?.title ?? control.getAttribute("title");
    const release = (control: HTMLElement | null) => {
      if (!control || control === hovered || control === focused) return;
      const saved = muted.get(control); if (!saved) return;
      if (control.getAttribute("title") === "") {
        if (saved.title === null) control.removeAttribute("title"); else control.setAttribute("title", saved.title);
      }
      if (saved.addedLabel && control.getAttribute("aria-label") === saved.addedLabel) control.removeAttribute("aria-label");
      muted.delete(control);
    };
    const close = () => { cancelAnimationFrame(keyboardFrame); keyboardFrame = 0; current.current = null; setHint(null); };
    const show = (control: HTMLElement | null) => {
      if (!control || !control.isConnected ||
        control.closest('[data-reordering="true"]') || control.dataset.tooltip === "off" ||
        (!control.hasAttribute("data-tooltip") && !control.hasAttribute("data-action-hint") && !originalTitle(control)?.trim() && visibleText(control))) { close(); return; }
      const label = (control.dataset.tooltip || control.querySelector('[role="tooltip"]')?.textContent ||
        control.getAttribute("aria-label") || originalTitle(control) || control.dataset.actionHint || "").trim();
      if (!label) { close(); return; }
      if (!muted.has(control)) {
        const title = control.getAttribute("title"), addedLabel = !control.hasAttribute("aria-label") ? label : null;
        muted.set(control, { title, addedLabel });
        if (addedLabel) control.setAttribute("aria-label", addedLabel);
        // An empty title also suppresses native titles inherited from ancestors.
        control.setAttribute("title", "");
      }
      const target = control.closest<HTMLElement>('dialog[open], [popover]:popover-open') ?? document.body;
      const next = { control, label, above: control.hasAttribute("data-tooltip-choice"), target };
      current.current = next; setHint(next);
    };
    const candidate = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>(controls) : null;
    const enter = (event: PointerEvent) => {
      pointerType = event.pointerType;
      if (pointerType === "touch") return;
      const control = candidate(event.target); if (control === hovered) return;
      const previous = hovered; hovered = control; release(previous); show(control);
    };
    const leave = (event: PointerEvent) => {
      if (candidate(event.relatedTarget) === hovered) return;
      const previous = hovered; hovered = null; release(previous);
      if (focusedHint && focused && focused.matches(":focus-visible")) show(focused); else close();
    };
    const focus = (event: FocusEvent) => {
      const previous = focused; focused = candidate(event.target); release(previous);
      // showModal() and focus restoration focus controls programmatically too.
      // Only an actual Tab gesture should expose a keyboard hint on entry.
      focusedHint = tabFocusPending && Boolean(focused?.matches(":focus-visible"));
      if (focusedHint) show(focused); else close();
      tabFocusPending = false;
    };
    const blur = () => {
      const previous = focused; focused = null; focusedHint = false; release(previous);
      if (hovered) show(hovered); else close();
    };
    const down = (event: PointerEvent) => { pointerType = event.pointerType; tabFocusPending = false; focusedHint = false; close(); };
    const click = (event: MouseEvent) => {
      const control = candidate(event.target);
      if (control?.hasAttribute("data-tooltip-choice")) show(control); else close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        tabFocusPending = true;
        pointerType = "keyboard";
        cancelAnimationFrame(keyboardFrame);
        // A one-control focus trap may keep the same node when touch becomes keyboard input.
        keyboardFrame = requestAnimationFrame(() => {
          keyboardFrame = 0;
          const previous = focused; focused = candidate(document.activeElement); release(previous); show(focused);
          focusedHint = Boolean(focused);
          tabFocusPending = false;
        });
      } else tabFocusPending = false;
      if (event.key === "Escape" && current.current) {
        event.preventDefault();
        // Let the active dialog handle Escape after its focused tooltip closes.
        if (!(event.target instanceof Element && event.target.closest('dialog[open], [aria-modal="true"]'))) event.stopPropagation();
        focusedHint = false; close();
      }
    };
    document.addEventListener("pointerover", enter);
    document.addEventListener("pointerout", leave);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", blur);
    document.addEventListener("click", click);
    document.addEventListener("keydown", key, true);
    document.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      cancelAnimationFrame(keyboardFrame);
      document.removeEventListener("pointerover", enter); document.removeEventListener("pointerout", leave);
      document.removeEventListener("pointerdown", down, true); document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", blur); document.removeEventListener("click", click);
      document.removeEventListener("keydown", key, true); document.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close); window.removeEventListener("blur", close);
      hovered = null; focused = null; for (const control of muted.keys()) release(control);
    };
  }, []);
  useLayoutEffect(() => {
    if (!hint || !popup.current) return;
    const { control } = hint, node = popup.current;
    const place = () => {
      if (!control.isConnected || !control.getClientRects().length) { current.current = null; setHint(null); return; }
      const anchor = control.getBoundingClientRect(), { width, height } = node.getBoundingClientRect(), gap = 8, edge = 8;
      const above = anchor.top - height - gap >= edge;
      node.style.left = `${Math.max(edge, Math.min(anchor.left + (anchor.width - width) / 2, window.innerWidth - width - edge))}px`;
      node.style.top = `${hint.above && above || anchor.bottom + gap + height > window.innerHeight - edge && above
        ? anchor.top - height - gap : Math.max(edge, Math.min(anchor.bottom + gap, window.innerHeight - height - edge))}px`;
    };
    const descriptions = (control.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
    control.setAttribute("aria-describedby", [...new Set([...descriptions, id])].join(" "));
    place();
    const resize = new ResizeObserver(place); resize.observe(control); resize.observe(node);
    return () => {
      resize.disconnect();
      const remaining = (control.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(value => value && value !== id);
      if (remaining.length) control.setAttribute("aria-describedby", remaining.join(" ")); else control.removeAttribute("aria-describedby");
    };
  }, [hint, id]);
  return hint ? createPortal(<span id={id} ref={popup} role="tooltip" className="button-tooltip" data-no-translate>{hint.label}</span>, hint.target) : null;
}
