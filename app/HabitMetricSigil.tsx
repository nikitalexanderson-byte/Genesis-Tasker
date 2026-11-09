"use client";

import { useId, useState, type CSSProperties, type PointerEvent } from "react";

type HabitMetricSigilProps = {
  variant: "laurels" | "streak";
  value: number;
  record?: number;
  className?: string;
};

function metricEnergy(value: number, record: number) {
  const safeValue = Math.max(0, value);
  const safeRecord = Math.max(safeValue, record, 1);
  return Math.min(1, Math.max(safeValue / safeRecord, Math.log2(safeValue + 1) / 8));
}

export function HabitMetricSigil({ variant, value, record = value, className = "" }: HabitMetricSigilProps) {
  const rawId = useId().replace(/:/g, "");
  const gradientId = `habit-metric-gradient-${rawId}`;
  const glowId = `habit-metric-glow-${rawId}`;
  const clipId = `habit-metric-clip-${rawId}`;
  const energy = metricEnergy(value, record);
  const streakNodes = Math.min(5, Math.max(0, Math.ceil(Math.max(0, value) / 3)));
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [highlight, setHighlight] = useState({ x: 35, y: 28 });
  const [awakened, setAwakened] = useState(0);

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const relativeX = (event.clientX - bounds.left) / Math.max(1, bounds.width);
    const relativeY = (event.clientY - bounds.top) / Math.max(1, bounds.height);
    setTilt({ x: Math.round((relativeY - 0.5) * -14), y: Math.round((relativeX - 0.5) * 14) });
    setHighlight({ x: Math.round(relativeX * 100), y: Math.round(relativeY * 100) });
  };

  const resetPointer = () => {
    setTilt({ x: 0, y: 0 });
    setHighlight({ x: 35, y: 28 });
  };

  return (
    <div
      className={`habit-metric-sigil metric-sigil-${variant}${awakened % 2 ? " awakened" : ""}${className ? ` ${className}` : ""}`}
      style={{
        "--metric-tilt-x": `${tilt.x}deg`,
        "--metric-tilt-y": `${tilt.y}deg`,
        "--metric-energy": energy,
        "--metric-glow-size": `${7 + energy * 7}px`,
        "--metric-ring-opacity": 0.42 + energy * 0.42,
        "--metric-orbit-opacity": 0.42 + energy * 0.52,
        "--metric-aura-opacity": 0.13 + energy * 0.27,
        "--metric-speed": `${Math.max(4.8, 11 - energy * 5.5)}s`,
        "--metric-orbit-speed": `${Math.max(4.1, 9 - energy * 4.4)}s`,
        "--metric-phase": `${(Math.max(0, value) % 12) * -0.19}s`,
      } as CSSProperties}
      aria-hidden="true"
      onPointerMove={handlePointerMove}
      onPointerLeave={resetPointer}
      onPointerDown={() => setAwakened((current) => current + 1)}
    >
      <svg viewBox="0 0 100 100" focusable="false">
        <defs>
          <radialGradient id={gradientId} cx={`${highlight.x}%`} cy={`${highlight.y}%`} r="74%">
            <stop offset="0" stopColor="#fff8d8" stopOpacity=".98" />
            <stop offset=".32" stopColor="#efd07b" stopOpacity=".9" />
            <stop offset="1" stopColor="#9d7036" stopOpacity=".08" />
          </radialGradient>
          <filter id={glowId} x="-90%" y="-90%" width="280%" height="280%">
            <feGaussianBlur stdDeviation={2.1 + energy * 1.4} result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <clipPath id={clipId}><circle cx="50" cy="50" r="45" /></clipPath>
        </defs>

        <circle className="metric-sigil-halo" cx="50" cy="50" r="45" />
        <circle className="metric-sigil-ring" cx="50" cy="50" r="39" />
        <g className="metric-sigil-orbit">
          <circle cx="50" cy="8" r={1.5 + energy} />
          <circle cx="90" cy="50" r="1.25" />
          <circle cx="21" cy="79" r="1" />
        </g>
        <g className="metric-sigil-flare" clipPath={`url(#${clipId})`}>
          <path d="M-12 77L77-12" />
        </g>

        {variant === "laurels" ? (
          <g className="metric-sigil-laurel-core" filter={`url(#${glowId})`}>
            <g className="metric-sigil-laurel-branches">
              <path d="M42 77C24 69 17 52 23 32" />
              <path d="M58 77C76 69 83 52 77 32" />
              <ellipse cx="28" cy="65" rx="3.2" ry="6.2" transform="rotate(-42 28 65)" />
              <ellipse cx="23" cy="54" rx="3" ry="6" transform="rotate(-67 23 54)" />
              <ellipse cx="23" cy="42" rx="2.8" ry="5.5" transform="rotate(-91 23 42)" />
              <ellipse cx="31" cy="70" rx="3" ry="5.8" transform="rotate(39 31 70)" />
              <ellipse cx="72" cy="65" rx="3.2" ry="6.2" transform="rotate(42 72 65)" />
              <ellipse cx="77" cy="54" rx="3" ry="6" transform="rotate(67 77 54)" />
              <ellipse cx="77" cy="42" rx="2.8" ry="5.5" transform="rotate(91 77 42)" />
              <ellipse cx="69" cy="70" rx="3" ry="5.8" transform="rotate(-39 69 70)" />
            </g>
            <g className="metric-sigil-crown">
              <path d="M34 59L31 38L43 49L50 31L57 49L69 38L66 59Z" fill={`url(#${gradientId})`} />
              <path d="M34 63H66M37 68H63" />
              <circle cx="31" cy="35" r="2.3" />
              <circle cx="50" cy="27.5" r="2.5" />
              <circle cx="69" cy="35" r="2.3" />
            </g>
          </g>
        ) : (
          <g className="metric-sigil-streak-core" filter={`url(#${glowId})`}>
            <path className="metric-sigil-streak-aura" d="M50 78C35 67 35 52 45 42C48 38 50 33 50 27C61 37 68 49 65 61C63 70 57 76 50 78Z" fill={`url(#${gradientId})`} />
            <g className="metric-sigil-staff">
              <path d="M50 72V29M50 29L40 40M50 29L60 40" />
              <path d="M50 52L40 45M50 61L60 54" />
            </g>
            <g className="metric-sigil-streak-nodes">
              {[0, 1, 2, 3, 4].map((node) => (
                <circle className={node < streakNodes ? "lit" : ""} key={node} cx="50" cy={69 - node * 8.5} r={node < streakNodes ? 2.15 : 1.45} />
              ))}
            </g>
            <path className="metric-sigil-arrow-light" d="M50 69V30M50 30L43 38M50 30L57 38" />
          </g>
        )}
      </svg>
    </div>
  );
}
