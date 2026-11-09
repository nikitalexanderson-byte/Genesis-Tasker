"use client";

import { useId, useState, type ReactNode } from "react";
import { ExperimentalIcon } from "./ExperimentalIcon";

/** Keeps desktop content in place and lets phone users reveal secondary controls. */
export function MobileDisclosure({ label, children, className = "" }: {
  label: string; children: ReactNode; className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return <div className={`mobile-disclosure ${className}`} data-expanded={expanded}>
    <button type="button" className="mobile-disclosure-toggle" aria-expanded={expanded} aria-controls={id}
      onClick={() => setExpanded(value => !value)}><ExperimentalIcon name="chevron" /><span>{label}</span></button>
    <div className="mobile-disclosure-content" id={id}>{children}</div>
  </div>;
}
