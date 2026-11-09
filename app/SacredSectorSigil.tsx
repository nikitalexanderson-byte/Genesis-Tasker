"use client";

import { useState, type CSSProperties, type PointerEvent } from "react";
import { SACRED_PRACTICE_SECTOR_IDS, type SacredPracticeSectorId } from "./sacred-practices";
import { THEOKYKLOS_SYMBOL_ART, THEOKYKLOS_SYMBOL_COLORS } from "./theokyklos-assets";

type SacredSectorSigilProps = {
  sectorId: SacredPracticeSectorId;
  className?: string;
  compact?: boolean;
  active?: boolean;
};

export function SacredSectorSigil({ sectorId, className = "", compact = false, active = false }: SacredSectorSigilProps) {
  const sectorIndex = SACRED_PRACTICE_SECTOR_IDS.indexOf(sectorId);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [awakened, setAwakened] = useState(false);

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / Math.max(1, bounds.width) - 0.5;
    const y = (event.clientY - bounds.top) / Math.max(1, bounds.height) - 0.5;
    setTilt({ x: Math.round(y * -13), y: Math.round(x * 13) });
  };

  return (
    <div
      className={`sacred-sector-sigil${compact ? " compact" : ""}${active ? " active" : ""}${awakened ? " awakened" : ""}${className ? ` ${className}` : ""}`}
      style={{
        "--sector-sigil-color": THEOKYKLOS_SYMBOL_COLORS[sectorId],
        "--sector-tilt-x": `${tilt.x}deg`,
        "--sector-tilt-y": `${tilt.y}deg`,
        "--sector-phase": `${sectorIndex * -0.41}s`,
      } as CSSProperties}
      aria-hidden="true"
      data-sacred-sector-sigil={sectorId}
      data-genesis-preserve="theokyklos-sector-sigil"
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setTilt({ x: 0, y: 0 })}
      onPointerDown={() => setAwakened((value) => !value)}
    >
      <span className="sacred-sector-sigil-halo" />
      <span className="sacred-sector-sigil-orbit"><i /><i /><i /></span>
      <span className="sacred-sector-sigil-ring outer" />
      <span className="sacred-sector-sigil-ring inner" />
      {/* eslint-disable-next-line @next/next/no-img-element -- Shared static PNG is pre-optimized for both deployment targets. */}
      <img src={THEOKYKLOS_SYMBOL_ART[sectorId]} alt="" width="256" height="256" draggable="false" />
    </div>
  );
}
