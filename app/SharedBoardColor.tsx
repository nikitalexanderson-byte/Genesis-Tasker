"use client";

import { useState } from "react";

const presets = ["#2d6c68", "#54718a", "#665c88", "#b65472", "#a5543f", "#b18b48", "#67736c", "#171d19"];

/** The same controls serve board creation and editing. */
export function SharedBoardColor({ value, initialValue = "#2d6c68", onChange, name, english }: {
  value?: string; initialValue?: string; onChange?: (color: string) => void; name?: string; english: boolean;
}) {
  const [local, setLocal] = useState(initialValue);
  const color = value ?? local;
  const change = (next: string) => { setLocal(next); onChange?.(next); };
  return <fieldset className="shared-board-color">
    <legend>{english ? "Color" : "Цвет"}</legend>
    <div className="shared-board-color-presets">
      {presets.map(preset => <button type="button" key={preset} aria-pressed={color.toLowerCase() === preset}
        aria-label={`${english ? "Color" : "Цвет"} ${preset}`} onClick={() => change(preset)}>
        <span style={{ backgroundColor: preset }} aria-hidden="true" />
        {color.toLowerCase() === preset ? <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="m5 12 4 4 10-10" fill="none" stroke="currentColor" strokeWidth="2"/></svg> : null}
      </button>)}
    </div>
    <label>{english ? "Custom color" : "Свой цвет"}<input type="color" name={name} value={color}
      onChange={event => change(event.target.value)} /></label>
  </fieldset>;
}
