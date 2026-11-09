"use client";
import { type ButtonHTMLAttributes, type ReactNode } from "react";
import { ExperimentalIcon } from "./ExperimentalIcon";
import "./icon-action-button.css";

/** ButtonTooltips renders the same accessible hint for every icon control. */
export function IconActionButton({ icon, label, className = "", showLabel = false, choiceHint = false, ...props }:
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label" | "title"> & {
    icon: ReactNode; label: string; showLabel?: boolean; choiceHint?: boolean;
  }) {
  return <button {...props} type={props.type ?? "button"}
    className={`secondary-button icon-action-button${showLabel ? " icon-label-choice" : ""} ${className}`}
    data-no-translate aria-label={label} data-tooltip={label} data-tooltip-choice={choiceHint || undefined}>
    {typeof icon === "string" ? <ExperimentalIcon name={icon} /> : icon}
    {showLabel ? <span className="icon-choice-label">{label}</span> : null}
  </button>;
}
