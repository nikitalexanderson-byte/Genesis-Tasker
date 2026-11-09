"use client";

import { useCallback, useRef } from "react";

/** Share the actual remaining compact-header space between all visible controls. */
export function useHeaderControlSize(enabled: boolean) {
  const cleanup = useRef<(() => void) | null>(null);
  return useCallback((header: HTMLElement | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!enabled || !header) return;
    let frame = 0;
    let disposed = false;
    const number = (value: string) => Number.parseFloat(value) || 0;
    const visible = (element: Element) => element.getClientRects().length > 0;
    const groupOverhead = (element: HTMLElement, count: number) => {
      const style = getComputedStyle(element);
      return [style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth]
        .reduce((total, value) => total + number(value), 0)
        + number(style.columnGap) * Math.max(0, count - 1);
    };
    const clear = () => {
      delete header.dataset.headerStacked;
      header.style.removeProperty("--header-control-size");
      header.style.removeProperty("--header-icon-size");
    };
    const measure = () => {
      frame = 0;
      if (disposed) return;
      const brand = header.querySelector<HTMLElement>(":scope > button");
      const calendars = header.querySelector<HTMLElement>(".topbar-calendar-choice");
      const actions = header.querySelector<HTMLElement>(".topbar-actions");
      if (!brand || !calendars || !actions) return;
      const calendarCount = [...calendars.querySelectorAll(":scope > button")].filter(visible).length;
      // Lazy controls occupy their final slot before their button mounts.
      const actionCount = [...actions.querySelectorAll("button, a, .notification-header-slot:empty, [data-header-control-placeholder]")].filter(visible).length;
      const count = calendarCount + actionCount;
      if (!count) { clear(); return; }
      const style = getComputedStyle(header);
      const available = header.getBoundingClientRect().width - number(style.paddingLeft) - number(style.paddingRight)
        - number(style.borderLeftWidth) - number(style.borderRightWidth);
      const overhead = number(style.columnGap) * 2
        + groupOverhead(calendars, calendarCount) + groupOverhead(actions, actionCount);
      delete header.dataset.headerStacked;
      if (brand.getBoundingClientRect().width + overhead + count * 44 > available) header.dataset.headerStacked = "true";
      const size = Math.floor(Math.min(44, Math.max(24, (available - brand.getBoundingClientRect().width - overhead) / count)) * 100) / 100;
      header.style.setProperty("--header-control-size", `${size}px`);
      const iconLimit = window.matchMedia("(max-width: 599px)").matches ? 28 : 26;
      header.style.setProperty("--header-icon-size", `${Math.min(iconLimit, Math.max(22, size * .78))}px`);
    };
    const schedule = () => { if (!frame && !disposed) frame = requestAnimationFrame(measure); };
    const resize = new ResizeObserver(schedule);
    const changes = new MutationObserver(schedule);
    resize.observe(header);
    changes.observe(header, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
    window.addEventListener("resize", schedule);
    void document.fonts.ready.then(schedule);
    measure();
    cleanup.current = () => {
      disposed = true; resize.disconnect(); changes.disconnect(); cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule); clear();
    };
  }, [enabled]);
}
