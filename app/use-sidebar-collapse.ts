import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from "react";

const clamp = (width: number) => Math.round(Math.max(56, Math.min(240, width)));

export function useSidebarCollapse(savedWidth: number, autoHideSetting: number, saveWidth: (width: number) => void) {
  const [drag, setDrag] = useState<{ x: number; initial: number; width: number } | null>(null);
  const width = drag?.width ?? savedWidth;
  const sidebarRef = useRef<HTMLElement>(null);
  const revealRef = useRef<HTMLButtonElement>(null);
  const [hidden, setHidden] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const activated = useRef(false);
  const keyboardMode = useRef(false);
  const resizing = Boolean(drag);
  const escapeFocus = useRef(false);
  // Keep existing saved positive delay values as the enabled flag; hiding has no timer.
  const autoHide = autoHideSetting > 0 && desktop;
  const reveal = () => setHidden(false);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1200px)");
    const update = () => { setDesktop(media.matches); };
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const sidebar = sidebarRef.current;
    const handle = revealRef.current;
    if (!sidebar || !autoHide) { activated.current = false; setHidden(false); return; }
    if (resizing) return;
    const boundary = sidebar.parentElement?.querySelector<HTMLElement>('.sidebar-resize-boundary');
    const surfaces = [sidebar, handle, boundary].filter((node): node is HTMLElement => Boolean(node));
    const contains = (target: Node | null) => surfaces.some(node => node.contains(target));
    const keyboardFocus = () => keyboardMode.current && document.activeElement instanceof HTMLElement
      && document.activeElement.matches(':focus-visible') && contains(document.activeElement);
    const hide = () => {
      if (sidebar.contains(document.activeElement) || boundary?.contains(document.activeElement)) {
        escapeFocus.current = true; handle?.focus();
        window.requestAnimationFrame(() => { escapeFocus.current = false; });
      }
      setHidden(true);
    };
    const hideIfOutside = () => {
      if (!surfaces.some(node => node.matches(':hover')) && !keyboardFocus()) hide();
    };
    const onLeave = (event: globalThis.PointerEvent) => {
      if (!contains(event.relatedTarget as Node | null) && !keyboardFocus()) hide();
    };
    const onBlur = (event: FocusEvent) => {
      if (!contains(event.relatedTarget as Node | null)) hideIfOutside();
    };
    const onEnter = () => { keyboardMode.current = false; setHidden(false); };
    const onPointerDown = () => { keyboardMode.current = false; };
    const onFocus = () => {
      if (escapeFocus.current) return;
      keyboardMode.current = document.activeElement instanceof HTMLElement && document.activeElement.matches(':focus-visible');
      setHidden(false);
    };
    const onEscape = (event: globalThis.KeyboardEvent) => {
      keyboardMode.current = true;
      if (event.key !== 'Escape') return;
      event.preventDefault(); escapeFocus.current = true; handle?.focus(); setHidden(true);
      window.requestAnimationFrame(() => { escapeFocus.current = false; });
    };
    for (const node of surfaces) {
      node.addEventListener('pointerenter', onEnter);
      node.addEventListener('pointerdown', onPointerDown);
      node.addEventListener('pointerleave', onLeave);
      node.addEventListener('focusin', onFocus);
      node.addEventListener('focusout', onBlur);
    }
    sidebar.addEventListener('keydown', onEscape);
    if (!activated.current) hide(); else hideIfOutside();
    activated.current = true;
    return () => {
      for (const node of surfaces) {
        node.removeEventListener('pointerenter', onEnter);
        node.removeEventListener('pointerdown', onPointerDown);
        node.removeEventListener('pointerleave', onLeave);
        node.removeEventListener('focusin', onFocus);
        node.removeEventListener('focusout', onBlur);
      }
      sidebar.removeEventListener('keydown', onEscape);
    };
  }, [resizing, autoHide]);
  const resizeProps = {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      reveal();
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({ x: event.clientX, initial: width, width });
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      if (drag) setDrag({ ...drag, width: clamp(drag.initial + event.clientX - drag.x) });
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
      if (!drag) return;
      saveWidth(clamp(drag.initial + event.clientX - drag.x)); setDrag(null);
    },
    onPointerCancel: () => setDrag(null),
    onLostPointerCapture: () => setDrag(null),
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      const next = event.key === "ArrowLeft" ? width - 16 : event.key === "ArrowRight" ? width + 16
        : event.key === "Home" ? 56 : event.key === "End" ? 240 : null;
      if (next !== null) { event.preventDefault(); saveWidth(clamp(next)); }
    },
  };
  const revealProps = {
    onFocus: () => { if (!escapeFocus.current) reveal(); },
    onClick: () => { reveal(); requestAnimationFrame(() => sidebarRef.current?.querySelector<HTMLElement>("button, a[href], [tabindex='0']")?.focus()); },
  };
  return { width, collapsed: width < 144, resizing: Boolean(drag), sidebarRef, resizeProps,
    autoHide, hidden: autoHide && hidden && !drag, revealRef, revealProps };
}
