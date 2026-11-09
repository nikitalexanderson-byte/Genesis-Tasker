"use client";

import { useState, type ButtonHTMLAttributes, type CSSProperties } from "react";

export function StoicheionActionButton({ icon, className = "", children, ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { icon: "restoration" | "read" | "reroll" }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  return <button {...props} type={props.type ?? "button"}
    className={`stoicheion-action-button stoicheion-action-${icon} ${className}`.trim()}
    data-active={hovered || focused || undefined}
    onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
    <svg className="stoicheion-action-icon" width="25" height="25" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {icon === "restoration" ? <>
        <path className="restoration-icon-orbit" d="M4 21.5 14 4l10 17.5H4Z" strokeWidth=".8" />
        {[ [14,6], [11,11], [17,11], [8,16], [14,16], [20,16], [5,21], [11,21], [17,21], [23,21] ].map(([cx,cy], index) =>
          <circle className="restoration-icon-point" key={index} cx={cx} cy={cy} r="1.5" fill="currentColor" stroke="none"
            style={{ "--point-x": `${(14-cx)*.48}px`, "--point-y": `${(14-cy)*.48}px`, "--point-delay": `${index*16}ms` } as CSSProperties} />)}
      </> : icon === "read" ? <><path d="M14 7.5C10 4.5 5.5 5 3.5 6v16c3.5-1.5 7-1 10.5 1.5C17.5 21 21 20.5 24.5 22V6c-2-1-6.5-1.5-10.5 1.5Z" /><path d="M14 7.5v16M7 10h3.5M7 14h3.5M17.5 10H21M17.5 14H21" /></>
        : <><path d="M22.4 10A9 9 0 1 0 23 17M23 4.5V11h-6.5" /><path d="M14 9v5l3 2" /></>}
    </svg><span>{children}</span>
  </button>;
}
