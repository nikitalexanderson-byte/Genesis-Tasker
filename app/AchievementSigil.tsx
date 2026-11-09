"use client";

import { useState, type CSSProperties, type PointerEvent } from "react";

type AchievementSigilProps = {
  artwork: string;
  unlocked: boolean;
  concealed: boolean;
  label: string;
};

export function AchievementSigil({ artwork, unlocked, concealed, label }: AchievementSigilProps) {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const move = (event: PointerEvent<HTMLSpanElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    setTilt({ x: ((event.clientY - bounds.top) / bounds.height - .5) * -8, y: ((event.clientX - bounds.left) / bounds.width - .5) * 8 });
  };
  return (
    <span
      className={`achievement-sigil${unlocked ? " unlocked" : " locked"}`}
      data-genesis-preserve="achievement-medallion"
      style={{ "--achievement-tilt-x": `${tilt.x}deg`, "--achievement-tilt-y": `${tilt.y}deg` } as CSSProperties}
      role="img"
      aria-label={label}
      onPointerMove={move}
      onPointerLeave={() => setTilt({ x: 0, y: 0 })}
    >
      <svg viewBox="0 0 64 64" aria-hidden="true">
        {concealed ? (
          <>
            <circle className="achievement-sigil-orbit" cx="32" cy="32" r="27" />
            <circle className="achievement-sigil-field" cx="32" cy="32" r="22" />
            <g className="achievement-sigil-secret-lock">
              <path d="M23 30v-5a9 9 0 0 1 18 0v5" />
              <rect x="20" y="30" width="24" height="20" rx="3" />
              <path d="M32 38v5" />
            </g>
          </>
        ) : (
          <image className="achievement-sigil-art" href={artwork} x="0" y="0" width="64" height="64" preserveAspectRatio="xMidYMid meet" />
        )}
        {!unlocked && !concealed ? <path className="achievement-sigil-lock" d="M26 31v-4a6 6 0 0 1 12 0v4m-15 0h18v14H23Z" /> : null}
      </svg>
    </span>
  );
}
