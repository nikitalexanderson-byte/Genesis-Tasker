"use client";
import {useEffect} from "react";

/** Native ::backdrop clicks are retargeted to <dialog>, not to a separate backdrop node. */
export function DialogDismissal() {
  useEffect(() => {
    let pressed: {dialog: HTMLDialogElement; pointer: number} | null = null;
    const outside = (event: PointerEvent, dialog: HTMLDialogElement) => {
      const bounds = dialog.getBoundingClientRect();
      return event.target === dialog && (event.clientX < bounds.left || event.clientX >= bounds.right
        || event.clientY < bounds.top || event.clientY >= bounds.bottom);
    };
    const down = (event: PointerEvent) => {
      const dialog = event.target;
      pressed = event.button === 0 && dialog instanceof HTMLDialogElement && dialog.open
        && dialog.dataset.genesisDialogManaged !== "true" && outside(event, dialog) ? {dialog, pointer: event.pointerId} : null;
    };
    const up = (event: PointerEvent) => {
      const start = pressed; pressed = null;
      if (!start || event.button !== 0 || start.pointer !== event.pointerId || !start.dialog.open || !outside(event, start.dialog)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      // Run the component's existing Cancel path, never Submit or an inferred Save action.
      if (start.dialog.dispatchEvent(new Event("cancel", {cancelable: true}))) start.dialog.close();
    };
    const cancel = () => { pressed = null; };
    document.addEventListener("pointerdown", down, true); document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", cancel, true);
    return () => { document.removeEventListener("pointerdown", down, true); document.removeEventListener("pointerup", up, true); document.removeEventListener("pointercancel", cancel, true); };
  }, []);
  return null;
}
