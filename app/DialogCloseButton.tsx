"use client";

import type { ButtonHTMLAttributes } from "react";
import { ExperimentalIcon } from "./ExperimentalIcon";
import { translateText } from "./i18n";
import "./dialog-controls.css";

/** The same close control keeps each dialog's existing label, position and dismiss guard. */
export function DialogCloseButton({ className = "", type = "button", ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  return <button {...props} type={type} className={`dialog-close-button ${className}`.trim()} aria-label={props["aria-label"] ?? translateText("Закрыть")}>
    <ExperimentalIcon name="close" />
  </button>;
}
