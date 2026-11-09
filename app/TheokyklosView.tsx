"use client";

import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  THEOKYKLOS_DIRECTION_IDS,
  THEOKYKLOS_SEGMENTS,
  type TheokyklosLocalizedText,
  type TheokyklosSegment,
  type TheokyklosSegmentId,
} from "./theokyklos-data";
import { translateText, type Language } from "./i18n";
import { catalogText } from "./catalog-i18n";
import type { CalendarMode } from "./calendar-data";
import type { HabitWorkspace } from "./habits";
import type { SacredPracticeSectorId } from "./sacred-practices";
import { THEOKYKLOS_SYMBOL_ART } from "./theokyklos-assets";
import { TheokyklosSymbolImage } from "./TheokyklosSymbolImage";
import { TheokyklosDetailsDialog } from "./TheokyklosDetailsDialog";
import { OlympianIsopsephy } from "./OlympianIsopsephy";

type Point = { x: number; y: number };

const CENTER: Point = { x: 450, y: 420 };

function localized(copy: TheokyklosLocalizedText, language: Language) {
  return catalogText(copy, language);
}

function polarPoint(angle: number, radius: number): Point {
  const radians = angle * Math.PI / 180;
  return {
    x: CENTER.x + Math.cos(radians) * radius,
    y: CENTER.y + Math.sin(radians) * radius,
  };
}

function annularSectorPath(centerAngle: number, innerRadius = 174, outerRadius = 302) {
  const startAngle = centerAngle - 20.5;
  const endAngle = centerAngle + 20.5;
  const outerStart = polarPoint(startAngle, outerRadius);
  const outerEnd = polarPoint(endAngle, outerRadius);
  const innerEnd = polarPoint(endAngle, innerRadius);
  const innerStart = polarPoint(startAngle, innerRadius);
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 0 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 0 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}

function directionLabel(id: TheokyklosSegmentId, language: Language) {
  const labels: Record<(typeof THEOKYKLOS_DIRECTION_IDS)[number], TheokyklosLocalizedText> = {
    north: { ru: "Север", en: "North" },
    northeast: { ru: "Северо-Восток", en: "Northeast" },
    east: { ru: "Восток", en: "East" },
    southeast: { ru: "Юго-Восток", en: "Southeast" },
    south: { ru: "Юг", en: "South" },
    southwest: { ru: "Юго-Запад", en: "Southwest" },
    west: { ru: "Запад", en: "West" },
    northwest: { ru: "Северо-Запад", en: "Northwest" },
  };
  return localized(labels[id as (typeof THEOKYKLOS_DIRECTION_IDS)[number]], language);
}

type TheokyklosViewProps = {
  language: Language;
  workspace: HabitWorkspace;
  date: string;
  calendarMode: CalendarMode;
  initialSectorId?: SacredPracticeSectorId | null;
  onSelectedSectorClosed?: () => void;
  onChange: (workspace: HabitWorkspace) => void;
  onOpenHabits?: () => void;
  onOpenStoicheion?: () => void;
  allowOlympians?: boolean;
};

export function TheokyklosView({ language, workspace, date, calendarMode, initialSectorId = null, onSelectedSectorClosed, onChange, onOpenHabits, onOpenStoicheion,allowOlympians=true }: TheokyklosViewProps) {
  const [selectedId, setSelectedId] = useState<TheokyklosSegmentId | null>(initialSectorId);
  const segmentsById = useMemo(() => new Map(THEOKYKLOS_SEGMENTS.map((segment) => [segment.id, segment])), []);
  const directions = THEOKYKLOS_DIRECTION_IDS.map((id) => segmentsById.get(id)).filter((segment): segment is TheokyklosSegment => Boolean(segment));
  const selected = selectedId ? segmentsById.get(selectedId) ?? null : null;

  const closeSelected = () => {
    setSelectedId(null);
    onSelectedSectorClosed?.();
  };
  const selectSegment = (id: TheokyklosSegmentId) => {
    setSelectedId(id);
  };

  const selectWithKeyboard = (event: ReactKeyboardEvent<SVGGElement>, id: TheokyklosSegmentId) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    selectSegment(id);
  };

  const interactiveProps = (segment: TheokyklosSegment) => ({
    role: "button",
    tabIndex: 0,
    "aria-label": `${localized(segment.title, language)} — ${localized(segment.patrons, language)}`,
    "aria-pressed": selectedId === segment.id,
    onClick: () => selectSegment(segment.id),
    onKeyDown: (event: ReactKeyboardEvent<SVGGElement>) => selectWithKeyboard(event, segment.id),
  });

  const zenith = segmentsById.get("zenith")!;
  const nadir = segmentsById.get("nadir")!;
  const hearth = segmentsById.get("hearth")!;
  const center = segmentsById.get("center")!;
  const entrance = segmentsById.get("entrance")!;
  const exit = segmentsById.get("exit")!;
  const zenithPoint = { x: 450, y: 54 };
  const nadirPoint = { x: 450, y: 786 };
  const entrancePoint = { x: 816, y: 420 };
  const exitPoint = { x: 84, y: 420 };
  const outerNodeRadius = 54;

  return (
    <section className="theokyklos-view" aria-labelledby="theokyklos-title" data-genesis-preserve="theokyklos">
      <header className="theokyklos-hero">
        <div className="theokyklos-hero-copy">
          <span className="eyebrow">{translateText("Теокиклос",language).toLocaleUpperCase()} · {language === "en" ? "THE CIRCLE OF GODS" : "КРУГ БОГОВ"}</span>
          <h1 id="theokyklos-title">{language === "en" ? "Theokyklos" : "Теокиклос"}</h1>
          <p>{language === "en"
            ? "An interactive circle of divine powers: eight directions of manifestation, the vertical axis, the sacred hearth, the Point of the Absolute, and the guardians of entry and exit."
            : "Интерактивный круг божественных сил: восемь направлений проявления, вертикальная ось, сакральный очаг, Точка Абсолюта и стражи входа и выхода."}</p>
        </div>
        <div className="section-hero-art section-hero-art-olympus" aria-hidden="true" />
      </header>

      <div className="theokyklos-layout">
        <section className="theokyklos-mandala-card" aria-labelledby="theokyklos-mandala-title">
          <div className="theokyklos-mandala-heading">
            <div>
              <span className="eyebrow">{language === "en" ? "Living diagram" : "Живая схема"}</span>
              <h2 id="theokyklos-mandala-title">{language === "en" ? "Circle of Divine Powers" : "Круг божественных сил"}</h2>
            </div>
            <p>{language === "en" ? "Select any ray, ring, pole, or gate." : "Выберите любой луч, круг, полюс или врата."}</p>
          </div>

          <div className="theokyklos-mandala-viewport">
            <svg className="theokyklos-mandala" viewBox="0 -16 900 872" role="img" aria-labelledby="theokyklos-svg-title theokyklos-svg-description">
              <title id="theokyklos-svg-title">{language === "en" ? "Interactive Circle of Divine Powers" : "Интерактивный Круг божественных сил"}</title>
              <desc id="theokyklos-svg-description">{language === "en"
                ? "Eight directional sectors surround Hestia's inner ring and the central point of Dionysus and Ariadne. Zeus and Hera stand at the zenith, Hades and Persephone at the nadir, with the entrance on the eastern axis and the exit on the western axis."
                : "Восемь направлений окружают внутреннее кольцо Гестии и центральную точку Диониса и Ариадны. Зевс и Гера стоят в зените, Аид и Персефона — в надире, вход расположен на восточной оси, а выход — на западной."}</desc>
              <defs>
                <radialGradient id="theokyklos-core-glow" cx="50%" cy="45%" r="66%">
                  <stop offset="0%" stopColor="#f1d890" stopOpacity=".94" />
                  <stop offset="48%" stopColor="#b7722e" stopOpacity=".52" />
                  <stop offset="100%" stopColor="#102b2d" stopOpacity="0" />
                </radialGradient>
                <linearGradient id="theokyklos-axis-glow" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#d9c57d" stopOpacity=".9" />
                  <stop offset="50%" stopColor="#83a8a4" stopOpacity=".16" />
                  <stop offset="100%" stopColor="#766f8f" stopOpacity=".84" />
                </linearGradient>
                <filter id="theokyklos-soft-glow" x="-80%" y="-80%" width="260%" height="260%">
                  <feGaussianBlur stdDeviation="9" result="blur" />
                  <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>

              <circle className="theokyklos-celestial-field" cx={CENTER.x} cy={CENTER.y} r="345" />
              <circle className="theokyklos-orbit orbit-outer" cx={CENTER.x} cy={CENTER.y} r="320" />
              <circle className="theokyklos-orbit orbit-inner" cx={CENTER.x} cy={CENTER.y} r="166" />
              <path className="theokyklos-axis" d="M450 92V748" />
              <path className="theokyklos-cross-axis" d="M122 420H778" />
              <circle className="theokyklos-core-aura" cx={CENTER.x} cy={CENTER.y} r="164" fill="url(#theokyklos-core-glow)" />

              {directions.map((segment) => {
                const label = polarPoint(segment.angle!, 238);
                const patronLines = segment.id === "west"
                  ? (language === "en" ? ["Poseidon", "and Amphitrite"] : ["Посейдон", "и Амфитрита"])
                  : [localized(segment.patrons, language)];
                return (
                  <g
                    {...interactiveProps(segment)}
                    className={`theokyklos-svg-segment direction-segment segment-${segment.id}${selectedId === segment.id ? " is-selected" : ""}`}
                    key={segment.id}
                  >
                    <path className="theokyklos-segment-shape" d={annularSectorPath(segment.angle!)} />
                    <TheokyklosSymbolImage className="theokyklos-mandala-icon theokyklos-direction-icon" href={THEOKYKLOS_SYMBOL_ART[segment.id]} x={label.x - 36} y={label.y - 58} width="72" height="72" preserveAspectRatio="xMidYMid meet" />
                    <text className="theokyklos-segment-label" x={label.x} y={label.y + 28} textAnchor="middle">
                      <tspan className="theokyklos-segment-direction" x={label.x}>{directionLabel(segment.id, language)}</tspan>
                      {patronLines.map((line, index) => (
                        <tspan className="theokyklos-segment-name" x={label.x} dy={index === 0 ? "17" : "14"} key={line}>{line}</tspan>
                      ))}
                    </text>
                  </g>
                );
              })}

              <g
                {...interactiveProps(hearth)}
                className={`theokyklos-svg-segment hearth-segment${selectedId === "hearth" ? " is-selected" : ""}`}
              >
                <circle className="theokyklos-hearth-hit" cx={CENTER.x} cy={CENTER.y} r="139" />
                <circle className="theokyklos-hearth-line" cx={CENTER.x} cy={CENTER.y} r="139" />
                <text className="theokyklos-ring-label" x={CENTER.x} y="301" textAnchor="middle">
                  <tspan x={CENTER.x}>{language === "en" ? "RING" : "КОЛЬЦО"}</tspan>
                  <tspan className="theokyklos-ring-patron" x={CENTER.x} dy="17">{language === "en" ? "HESTIA" : "ГЕСТИЯ"}</tspan>
                </text>
              </g>

              <g
                {...interactiveProps(center)}
                className={`theokyklos-svg-segment center-segment${selectedId === "center" ? " is-selected" : ""}`}
              >
                <circle className="theokyklos-center-disc" cx={CENTER.x} cy={CENTER.y} r="86" />
                <circle className="theokyklos-center-line" cx={CENTER.x} cy={CENTER.y} r="69" />
                <TheokyklosSymbolImage className="theokyklos-mandala-icon theokyklos-center-icon" href={THEOKYKLOS_SYMBOL_ART.center} x="406" y="342" width="88" height="88" preserveAspectRatio="xMidYMid meet" />
                <text className="theokyklos-center-label" x={CENTER.x} y="452" textAnchor="middle">
                  <tspan x={CENTER.x}>{localized(center.patrons, language)}</tspan>
                  <tspan className="theokyklos-center-caption" x={CENTER.x} dy="20">{localized(center.short, language)}</tspan>
                </text>
              </g>

              <g
                {...interactiveProps(zenith)}
                className={`theokyklos-svg-segment axis-node zenith-node${selectedId === "zenith" ? " is-selected" : ""}`}
              >
                <circle cx={zenithPoint.x} cy={zenithPoint.y} r={outerNodeRadius} />
                <TheokyklosSymbolImage className="theokyklos-mandala-icon theokyklos-axis-icon" href={THEOKYKLOS_SYMBOL_ART.zenith} x={zenithPoint.x - 26} y={zenithPoint.y - 46} width="52" height="52" preserveAspectRatio="xMidYMid meet" />
                <text x={zenithPoint.x} y={zenithPoint.y + 25} textAnchor="middle">
                  <tspan x={zenithPoint.x}>{localized(zenith.short, language)}</tspan>
                  <tspan className="theokyklos-outer-node-patron" x={zenithPoint.x} dy="14">{localized(zenith.patrons, language)}</tspan>
                </text>
              </g>
              <g
                {...interactiveProps(nadir)}
                className={`theokyklos-svg-segment axis-node nadir-node${selectedId === "nadir" ? " is-selected" : ""}`}
              >
                <circle cx={nadirPoint.x} cy={nadirPoint.y} r={outerNodeRadius} />
                <TheokyklosSymbolImage className="theokyklos-mandala-icon theokyklos-axis-icon" href={THEOKYKLOS_SYMBOL_ART.nadir} x={nadirPoint.x - 26} y={nadirPoint.y - 46} width="52" height="52" preserveAspectRatio="xMidYMid meet" />
                <text x={nadirPoint.x} y={nadirPoint.y + 25} textAnchor="middle">
                  <tspan x={nadirPoint.x}>{localized(nadir.short, language)}</tspan>
                  <tspan className="theokyklos-outer-node-patron" x={nadirPoint.x} dy="14" textLength="94" lengthAdjust="spacingAndGlyphs">{localized(nadir.patrons, language)}</tspan>
                </text>
              </g>

              <g
                {...interactiveProps(entrance)}
                className={`theokyklos-svg-segment threshold-node entrance-node centered-threshold-node${selectedId === "entrance" ? " is-selected" : ""}`}
              >
                <circle cx={entrancePoint.x} cy={entrancePoint.y} r={outerNodeRadius} />
                <TheokyklosSymbolImage className="theokyklos-mandala-icon theokyklos-threshold-icon" href={THEOKYKLOS_SYMBOL_ART.entrance} x={entrancePoint.x - 26} y={entrancePoint.y - 46} width="52" height="52" preserveAspectRatio="xMidYMid meet" />
                <text x={entrancePoint.x} y={entrancePoint.y + 25} textAnchor="middle">
                  <tspan x={entrancePoint.x}>{localized(entrance.short, language)}</tspan>
                  <tspan className="theokyklos-outer-node-patron" x={entrancePoint.x} dy="14">{localized(entrance.patrons, language)}</tspan>
                </text>
              </g>
              <g
                {...interactiveProps(exit)}
                className={`theokyklos-svg-segment threshold-node exit-node centered-threshold-node${selectedId === "exit" ? " is-selected" : ""}`}
              >
                <circle cx={exitPoint.x} cy={exitPoint.y} r={outerNodeRadius} />
                <TheokyklosSymbolImage className="theokyklos-mandala-icon theokyklos-threshold-icon" href={THEOKYKLOS_SYMBOL_ART.exit} x={exitPoint.x - 26} y={exitPoint.y - 46} width="52" height="52" preserveAspectRatio="xMidYMid meet" />
                <text x={exitPoint.x} y={exitPoint.y + 25} textAnchor="middle">
                  <tspan x={exitPoint.x}>{localized(exit.short, language)}</tspan>
                  <tspan className="theokyklos-outer-node-patron" x={exitPoint.x} dy="14">{localized(exit.patrons, language)}</tspan>
                </text>
              </g>

              <g className="theokyklos-stars" aria-hidden="true">
                <circle cx="93" cy="265" r="2" /><circle cx="812" cy="252" r="2" /><circle cx="92" cy="577" r="1.5" />
                <circle cx="809" cy="588" r="1.5" /><circle cx="284" cy="64" r="1.5" /><circle cx="620" cy="62" r="2" />
              </g>
            </svg>
          </div>

        </section>

        {selected ? <TheokyklosDetailsDialog segment={selected} language={language} workspace={workspace} date={date} calendarMode={calendarMode} onChange={onChange} onClose={closeSelected} onOpenHabits={onOpenHabits} /> : null}
      </div>

      {allowOlympians?<OlympianIsopsephy language={language} onOpenStoicheion={onOpenStoicheion} />:null}
    </section>
  );
}
