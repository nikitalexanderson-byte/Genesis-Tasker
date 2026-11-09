"use client";
/* eslint-disable @next/next/no-img-element -- Hero Path WebP artwork is pre-optimized for both deployment targets. */

import { useId, useState, type CSSProperties, type PointerEvent } from "react";
import { HEROIC_RANK_ICON_ASSETS } from "./hero-path-assets";
import { HEROIC_RANKS, type HeroicRankId } from "./habit-progress";

type HeroicRankSigilProps = {
  rankId: HeroicRankId | "unranked" | null;
  color: string;
  className?: string;
  compact?: boolean;
};

type RankMotif = {
  primary: string;
  secondary: string;
  nodes?: readonly [number, number, number][];
};

export const HEROIC_RANK_SIGIL_MOTIFS: Readonly<Record<HeroicRankId, RankMotif>> = {
  tantalus: { primary: "M34 54h32l-5 18H39z M39 54c0-8 5-14 11-14s11 6 11 14", secondary: "M50 22v12 M42 27l8-5 8 5", nodes: [[50, 18, 3]] },
  sisyphus: { primary: "M24 73 48 38 76 73z", secondary: "M30 68c8-12 16-18 25-23", nodes: [[64, 34, 9]] },
  cyclops: { primary: "M20 50c15-20 45-20 60 0-15 20-45 20-60 0z", secondary: "M37 50c0-18 26-18 26 0s-26 18-26 0", nodes: [[50, 50, 7]] },
  icarus: { primary: "M48 66 27 39l18 8 5-25 5 25 18-8-21 27z", secondary: "M30 62 18 49 M70 62l12-13", nodes: [[50, 17, 3]] },
  "lion-heart": { primary: "M50 73C34 61 27 51 31 40c4-10 16-9 19-1 3-8 15-9 19 1 4 11-3 21-19 33z", secondary: "M28 34 20 22l16 5 14-11 14 11 16-5-8 12" },
  "venom-vanquisher": { primary: "M30 68c14-4 10-17 23-20 16-4 14-21 1-23 15 10 15 28 1 36-10 7-25 2-25-8", secondary: "M65 25 76 19 M65 25l8 8", nodes: [[30, 68, 3]] },
  "golden-horn-pathfinder": { primary: "M31 34c-2-13 6-19 15-11-9 3-9 14-3 20 M69 34c2-13-6-19-15-11 9 3 9 14 3 20", secondary: "M50 39v34 M42 65l8 8 8-8", nodes: [[50, 50, 3]] },
  "mountain-tamer": { primary: "M18 70 40 34l10 15 12-25 20 46z", secondary: "M34 44l7 7 8-5 12 13 M50 70v-12", nodes: [[50, 55, 3]] },
  "lord-of-the-current": { primary: "M18 38c10-8 20-8 30 0s20 8 34 0 M18 51c10-8 20-8 30 0s20 8 34 0 M18 64c10-8 20-8 30 0s20 8 34 0", secondary: "M50 23v43 M43 59l7 7 7-7" },
  "bronze-wing": { primary: "M49 68C34 61 24 50 21 32c12 2 22 8 29 19 7-11 17-17 29-19-3 18-13 29-28 36z", secondary: "M28 40l21 17 M72 40 51 57 M50 27v38" },
  "tamer-of-might": { primary: "M28 35c13-13 31 0 22 15-9 15 9 28 22 15 M72 35c-13-13-31 0-22 15 9 15-9 28-22 15", secondary: "M38 50h24 M50 38v24", nodes: [[50, 50, 5]] },
  "iron-charioteer": { primary: "M25 50a25 25 0 1 0 50 0 25 25 0 1 0-50 0", secondary: "M50 25v50 M25 50h50 M32 32l36 36 M68 32 32 68", nodes: [[50, 50, 5]] },
  "royal-honor-bearer": { primary: "M25 66 21 36l18 13 11-25 11 25 18-13-4 30z", secondary: "M28 72h44 M35 59h30", nodes: [[21, 33, 3], [50, 21, 3], [79, 33, 3]] },
  "western-verge-guardian": { primary: "M27 75V29h46v46 M37 75V40h26v35", secondary: "M18 75h64 M50 40v35", nodes: [[50, 54, 3]] },
  "golden-garden-keeper": { primary: "M50 74V48 M50 52c-15 1-23-9-22-22 14-2 23 5 22 22 M50 49c15 1 23-9 22-22-14-2-23 5-22 22", secondary: "M34 74c2-9 8-13 16-13s14 4 16 13", nodes: [[50, 31, 4]] },
  "risen-from-the-abyss": { primary: "M19 70c10-11 20-11 31 0 11-11 21-11 31 0 M50 70V31 M39 43l11-12 11 12", secondary: "M28 77h44 M25 61h50", nodes: [[50, 25, 4]] },
  "mirror-victor": { primary: "M50 19 76 50 50 81 24 50z", secondary: "M50 28 66 50 50 72 34 50z M24 50h52", nodes: [[50, 50, 4]] },
  "lord-of-the-thread": { primary: "M50 19c24 0 29 31 8 38-17 6-28-17-12-25 12-5 23 9 14 18-8 10-23 2-19-9", secondary: "M50 19v12 M56 66 50 79l-6-13", nodes: [[50, 50, 3]] },
  "golden-argonaut": { primary: "M19 59h62L69 73H31z M31 54h38L57 38H43z", secondary: "M50 38V20 M50 20l16 12H50", nodes: [[27, 59, 3], [73, 59, 3]] },
  "celestial-rider": { primary: "M24 65c8-21 20-29 37-21l11-12 5 22-11 21H39z", secondary: "M40 44c-4-9 1-18 10-21 8 4 11 11 8 20", nodes: [[65, 31, 4]] },
  "voice-beyond-styx": { primary: "M26 37c10-9 22-9 32 0l16 13-16 13c-10 9-22 9-32 0", secondary: "M20 73c13-7 24-7 37 0 9 5 17 5 25 0 M34 50h24", nodes: [[63, 50, 3]] },
  "arcadian-arrow": { primary: "M23 70 72 21 M54 22h19v19 M29 57l14 14", secondary: "M20 76l14-3-11-11z M68 26l7-7", nodes: [[50, 50, 3]] },
  "myrmidon-shield": { primary: "M50 18 75 28v20c0 16-10 27-25 34-15-7-25-18-25-34V28z", secondary: "M50 29v40 M35 49h30", nodes: [[50, 49, 5]] },
  "many-counseled-wanderer": { primary: "M50 19 60 42 81 50 60 58 50 81 40 58 19 50 40 42z", secondary: "M50 32v36 M32 50h36", nodes: [[50, 50, 5]] },
  "spear-of-athena": { primary: "M50 17 59 36l-6-2v39l8 8H39l8-8V34l-6 2z", secondary: "M34 49h32 M43 24l7-7 7 7", nodes: [[50, 49, 4]] },
  "dragon-seed-sower": { primary: "M24 66c8-19 17-31 26-39 9 8 18 20 26 39-17-8-35-8-52 0z", secondary: "M31 69c12-8 26-8 38 0 M50 27v42", nodes: [[34, 58, 3], [50, 53, 3], [66, 58, 3]] },
  "sphinx-solver": { primary: "M27 69c1-20 5-35 23-45 18 10 22 25 23 45z", secondary: "M40 43c2-8 17-8 19 0 1 6-9 7-9 14 M50 64v2", nodes: [[50, 38, 3], [50, 72, 3]] },
  "calydonian-glory-bearer": { primary: "M27 67c-3-18 8-35 23-35s26 17 23 35c-12-5-34-5-46 0z", secondary: "M34 36 25 24l17 5 M66 36l9-12-17 5 M39 58h22", nodes: [[50, 48, 5]] },
};

const UNRANKED_MOTIF: RankMotif = {
  primary: "M50 26v48 M26 50h48",
  secondary: "M34 34l32 32 M66 34 34 66",
  nodes: [[50, 50, 5]],
};

export function HeroicRankSigil({ rankId, color, className = "", compact = false }: HeroicRankSigilProps) {
  const rawId = useId();
  const gradientId = `rank-sigil-gradient-${rawId.replace(/:/g, "")}`;
  const glowId = `rank-sigil-glow-${rawId.replace(/:/g, "")}`;
  const rankIndex = Math.max(0, HEROIC_RANKS.findIndex((rank) => rank.id === rankId));
  const motif = rankId && rankId !== "unranked" ? HEROIC_RANK_SIGIL_MOTIFS[rankId] : UNRANKED_MOTIF;
  const artwork = rankId && rankId !== "unranked" ? HEROIC_RANK_ICON_ASSETS[rankId] : undefined;
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [awakened, setAwakened] = useState(0);

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / Math.max(1, bounds.width) - 0.5;
    const y = (event.clientY - bounds.top) / Math.max(1, bounds.height) - 0.5;
    setTilt({ x: Math.round(x * 12), y: Math.round(y * -12) });
  };

  return (
    <div
      className={`rank-sigil${compact ? " compact" : ""}${awakened % 2 ? " awakened" : ""}${className ? ` ${className}` : ""}`}
      style={{
        "--rank-color": color,
        "--sigil-tilt-x": `${tilt.x}deg`,
        "--sigil-tilt-y": `${tilt.y}deg`,
        "--sigil-phase": `${rankIndex * -0.37}s`,
      } as CSSProperties}
      aria-hidden="true"
      data-rank-sigil={rankId ?? "unranked"}
      data-genesis-preserve="heroic-rank-medallion"
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setTilt({ x: 0, y: 0 })}
      onPointerDown={() => setAwakened((value) => value + 1)}
    >
      {artwork ? <img
        className="rank-sigil-image"
        src={artwork.src}
        srcSet={artwork.srcSet}
        sizes={artwork.sizes}
        alt=""
        width="512"
        height="512"
        decoding="async"
        draggable="false"
      /> : <svg viewBox="0 0 100 100" focusable="false">
        <defs>
          <radialGradient id={gradientId} cx="38%" cy="30%" r="72%">
            <stop offset="0" stopColor="#fff8dd" />
            <stop offset="0.34" stopColor={color} stopOpacity="0.95" />
            <stop offset="1" stopColor={color} stopOpacity="0.14" />
          </radialGradient>
          <filter id={glowId} x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="2.2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <circle className="rank-sigil-halo" cx="50" cy="50" r="45" fill={`url(#${gradientId})`} />
        <g className="rank-sigil-orbit">
          <circle cx="50" cy="7" r="2.1" />
          <circle cx="93" cy="50" r="1.4" />
          <circle cx="50" cy="93" r="1.8" />
        </g>
        <circle className="rank-sigil-ring outer" cx="50" cy="50" r="37" />
        <circle className="rank-sigil-ring inner" cx="50" cy="50" r="27" />
        <g className="rank-sigil-core" filter={`url(#${glowId})`}>
          <g className="rank-sigil-motif">
            <path d={motif.primary} />
            <path className="rank-sigil-motif-secondary" d={motif.secondary} />
            <g className="rank-sigil-motif-nodes">
              {motif.nodes?.map(([cx, cy, r], index) => <circle cx={cx} cy={cy} r={r} key={`${cx}-${cy}-${index}`} />)}
            </g>
          </g>
        </g>
        <g className="rank-sigil-laurels">
          <path d="M25 73C14 61 13 43 22 29" />
          <path d="M75 73C86 61 87 43 78 29" />
          {[0, 1, 2, 3].map((leaf) => <circle key={leaf} cx={20 + leaf * 2} cy={62 - leaf * 9} r="2.2" />)}
          {[0, 1, 2, 3].map((leaf) => <circle key={leaf} cx={80 - leaf * 2} cy={62 - leaf * 9} r="2.2" />)}
        </g>
      </svg>}
    </div>
  );
}
