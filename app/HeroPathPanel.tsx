"use client";
import { DialogCloseButton } from "./DialogCloseButton";
/* eslint-disable @next/next/no-img-element -- Hero Path WebP artwork is pre-optimized for both deployment targets. */

import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";
import { HERO_PATH_CHECKPOINT_ICON_ASSETS } from "./hero-path-assets";
import type { Language } from "./i18n";
import { HeroicRankSigil } from "./HeroicRankSigil";
import { useDialogAccessibility } from "./use-dialog-accessibility";
import {
  FOUNDATIONAL_HEROIC_RANKS,
  HERO_PATH_CHECKPOINTS,
  HIDDEN_HEROIC_RANKS,
  heroicRankForProgress,
  hiddenHeroicPathRevealed,
  hiddenHeroicPathUnlocked,
  nextHeroicRankForProgress,
  type HabitWorkspace,
  type HeroicRank,
  type HeroicRankId,
} from "./habits";

type HeroPathPanelProps = {
  workspace: HabitWorkspace;
  language: Language;
  onClaimCheckpoint: (rankId: HeroicRankId) => void;
  onRevealHiddenPath: () => void;
  onClose: () => void;
};

function AmphoraSigil({ open, rankId }: { open: boolean; rankId: HeroicRankId }) {
  const artwork = HERO_PATH_CHECKPOINT_ICON_ASSETS[rankId];
  return <span className={`hero-amphora-sigil${open ? " open" : ""}`} aria-hidden="true" data-genesis-preserve="hero-path-checkpoint-art">{artwork ? <img
    src={artwork.src}
    srcSet={artwork.srcSet}
    sizes={artwork.sizes}
    alt=""
    width="512"
    height="512"
    decoding="async"
    draggable="false"
  /> : <svg viewBox="0 0 80 90"><path className="hero-amphora-lid" d="M27 14h26l4 7H23z" /><path d="M25 23c2 8 1 12-5 18-7 7-7 19-1 28 9 14 33 14 42 0 6-9 6-21-1-28-6-6-7-10-5-18z" /><path d="M22 36c-12-2-16 6-12 16 2 5 7 7 12 8M58 36c12-2 16 6 12 16-2 5-7 7-12 8M25 50h30M29 65c8-7 14-7 22 0" /><circle cx="40" cy="50" r="5" /></svg>}</span>;
}

function RankPathMap({
  ranks,
  stepOffset,
  hidden,
  currentRankId,
  total,
  workspace,
  language,
  onClaimCheckpoint,
}: {
  ranks: readonly HeroicRank[];
  stepOffset: number;
  hidden?: boolean;
  currentRankId: HeroicRankId | null;
  total: number;
  workspace: HabitWorkspace;
  language: Language;
  onClaimCheckpoint: (rankId: HeroicRankId) => void;
}) {
  const isEnglish = language === "en";
  const checkpoints = new Map(HERO_PATH_CHECKPOINTS.map((checkpoint) => [checkpoint.rankId, checkpoint]));
  return (
    <div className={`hero-path-map${hidden ? " hero-path-map-hidden" : ""}`}>
      <span className="hero-path-line" aria-hidden="true" />
      {ranks.map((item, index) => {
        const reached = total >= item.threshold;
        const current = currentRankId === item.id;
        const checkpoint = checkpoints.get(item.id);
        const claimed = checkpoint ? workspace.rewardTransactions.some((transaction) => transaction.idempotencyKey === `hero-path-amphora:self:${item.id}`) : false;
        return <Fragment key={item.id}>
          <article className={`hero-path-rank${hidden ? " hidden-path-rank" : ""}${reached ? " reached" : ""}${current ? " current" : ""}${index % 2 ? " right" : " left"}`} style={{ "--rank-color": item.color } as CSSProperties}>
            <div className="hero-path-rank-copy"><small>{isEnglish ? `Step ${stepOffset + index + 1}` : `Ступень ${stepOffset + index + 1}`}</small><h3>{isEnglish ? item.titleEn : item.title}</h3><span>{item.threshold.toLocaleString(isEnglish ? "en-US" : "ru-RU")} XP</span>{current ? <em>{isEnglish ? "You are here" : "Вы здесь"}</em> : reached ? <em>✓ {isEnglish ? "Reached" : "Достигнут"}</em> : null}</div>
            <HeroicRankSigil compact rankId={item.id} color={item.color} />
          </article>
          {checkpoint ? <article className={`hero-path-checkpoint${hidden ? " hidden-path-checkpoint" : ""}${reached ? " unlocked" : ""}${claimed ? " claimed" : ""}`}>
            <AmphoraSigil open={claimed} rankId={item.id} />
            <div><small>{isEnglish ? "Guaranteed checkpoint reward" : "Гарантированная награда чекпоинта"}</small><strong>{isEnglish ? checkpoint.titleEn : checkpoint.title}</strong><span>♕ +{checkpoint.rewardLaurels} {isEnglish ? "Laurels" : "Лавров"}</span></div>
            <button type="button" disabled={!reached || claimed} onClick={() => onClaimCheckpoint(item.id)}>{claimed ? (isEnglish ? "Received" : "Получено") : reached ? (isEnglish ? "Open amphora" : "Открыть амфору") : (isEnglish ? "Locked" : "Закрыто")}</button>
          </article> : null}
        </Fragment>;
      })}
    </div>
  );
}

function HiddenPathGate({ language, opening, onOpen }: { language: Language; opening: boolean; onOpen: () => void }) {
  const isEnglish = language === "en";
  return (
    <section className={`hero-path-reveal-gate${opening ? " opening" : ""}`} aria-live="polite">
      <div className="hero-path-gate-art" aria-hidden="true">
        <i />
        <svg viewBox="0 0 420 230" role="presentation">
          <defs><radialGradient id="hero-gate-glow"><stop offset="0" stopColor="#f5dc9a" stopOpacity=".9" /><stop offset="1" stopColor="#8f78c4" stopOpacity="0" /></radialGradient></defs>
          <circle className="hero-gate-aura" cx="210" cy="112" r="104" fill="url(#hero-gate-glow)" />
          <g className="hero-gate-left"><path d="M202 204H72V50l44-34h86z" /><path d="M104 185V66l30-23h68M132 68v108M160 56v120" /></g>
          <g className="hero-gate-right"><path d="M218 204h130V50l-44-34h-86z" /><path d="M316 185V66l-30-23h-68M288 68v108M260 56v120" /></g>
          <path className="hero-gate-star" d="m210 65 10 31 31 10-31 10-10 31-10-31-31-10 31-10z" />
          <path className="hero-gate-floor" d="M54 205h312M104 221h212" />
        </svg>
      </div>
      <div className="hero-path-gate-copy">
        <span className="eyebrow">{isEnglish ? "The visible path is complete" : "Видимый путь завершён"}</span>
        <h3>{isEnglish ? "The gates have awakened" : "Врата пробудились"}</h3>
        <p>{isEnglish ? "A continuation is ready to be revealed. Open it when you wish to take the next step." : "Продолжение готово открыться. Откройте его, когда будете готовы сделать следующий шаг."}</p>
        <button type="button" disabled={opening} onClick={onOpen}>{opening ? (isEnglish ? "Opening…" : "Врата открываются…") : (isEnglish ? "Open the continuation" : "Открыть продолжение")}</button>
      </div>
    </section>
  );
}

export function HeroPathPanel({ workspace, language, onClaimCheckpoint, onRevealHiddenPath, onClose }: HeroPathPanelProps) {
  const isEnglish = language === "en";
  const total = workspace.userProgress.lifetimeXp;
  const hiddenUnlocked = hiddenHeroicPathUnlocked(total);
  const hiddenRevealed = hiddenHeroicPathRevealed(workspace.userProgress);
  const rank = heroicRankForProgress(workspace.userProgress);
  const nextRank = nextHeroicRankForProgress(workspace.userProgress);
  const progress = nextRank
    ? Math.max(0, Math.min(100, Math.round((total - rank.threshold) / Math.max(1, nextRank.threshold - rank.threshold) * 100)))
    : 100;
  const [opening, setOpening] = useState(false);
  const [revealRequested, setRevealRequested] = useState(false);
  const revealTimer = useRef<number | null>(null);
  const hiddenPathRef = useRef<HTMLElement | null>(null);
  const dialogRef = useDialogAccessibility<HTMLElement>(onClose);

  useEffect(() => () => {
    if (revealTimer.current !== null) window.clearTimeout(revealTimer.current);
  }, []);

  useEffect(() => {
    if (!hiddenRevealed || !revealRequested) return;
    window.requestAnimationFrame(() => hiddenPathRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [hiddenRevealed, revealRequested]);

  const openHiddenPath = () => {
    if (opening) return;
    setOpening(true);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    revealTimer.current = window.setTimeout(() => {
      setRevealRequested(true);
      onRevealHiddenPath();
      setOpening(false);
      revealTimer.current = null;
    }, reducedMotion ? 0 : 720);
  };

  return (
    <div className="modal-backdrop hero-path-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="hero-path-panel" role="dialog" aria-modal="true" aria-labelledby="hero-path-title" tabIndex={-1}>
        <header className="hero-path-header">
          <div><span className="eyebrow">{isEnglish ? "Lifetime progress" : "Пожизненный прогресс"}</span><h2 id="hero-path-title">{isEnglish ? "Path of the Hero" : "Путь Героя"}</h2><p>{isEnglish ? "Every point records a real completion. XP is never spent and ranks are never lost." : "Каждый балл сохраняет реальное выполнение. XP не тратится, а достигнутые ранги не теряются."}</p></div>
          <DialogCloseButton type="button" className="modal-close" onClick={onClose} aria-label={isEnglish ? "Close" : "Закрыть"} />
        </header>

        <div className="hero-path-summary" style={{ "--rank-color": rank.color } as CSSProperties}>
          <HeroicRankSigil rankId={rank.id} color={rank.color} />
          <div><small>{isEnglish ? "Current rank" : "Текущий ранг"}</small><strong>{isEnglish ? rank.titleEn : rank.title}</strong><span>{total.toLocaleString(isEnglish ? "en-US" : "ru-RU")} XP</span><div className="hero-path-progress"><i style={{ width: `${progress}%` }} /></div><em>{nextRank ? (isEnglish ? `${(nextRank.threshold - total).toLocaleString("en-US")} XP to ${nextRank.titleEn}` : `${(nextRank.threshold - total).toLocaleString("ru-RU")} XP до «${nextRank.title}»`) : (isEnglish ? "The visible path is complete" : "Видимый путь пройден")}</em></div>
        </div>

        <RankPathMap ranks={FOUNDATIONAL_HEROIC_RANKS} stepOffset={0} currentRankId={rank.id === "unranked" ? null : rank.id} total={total} workspace={workspace} language={language} onClaimCheckpoint={onClaimCheckpoint} />

        {!hiddenUnlocked ? <aside className="hero-path-mist-gate"><span aria-hidden="true">◇</span><div><strong>{isEnglish ? "The path continues…" : "Путь продолжается…"}</strong><small>{isEnglish ? "Something waits beyond the visible gate." : "За видимыми вратами скрывается продолжение."}</small></div></aside> : null}
        {hiddenUnlocked && !hiddenRevealed ? <HiddenPathGate language={language} opening={opening} onOpen={openHiddenPath} /> : null}
        {hiddenRevealed ? <section className="hero-path-second-path" ref={hiddenPathRef} id="hero-hidden-path">
          <header><span className="eyebrow">{isEnglish ? "Beyond the gate" : "За вратами"}</span><h3>{isEnglish ? "The second path" : "Второй путь"}</h3><p>{isEnglish ? "The mist has lifted. Every new mark still comes only from real, completed actions." : "Туман рассеялся. Каждая новая отметка по-прежнему рождается только из реальных выполненных действий."}</p></header>
          <RankPathMap ranks={HIDDEN_HEROIC_RANKS} stepOffset={FOUNDATIONAL_HEROIC_RANKS.length} hidden currentRankId={rank.id === "unranked" ? null : rank.id} total={total} workspace={workspace} language={language} onClaimCheckpoint={onClaimCheckpoint} />
        </section> : null}
      </section>
    </div>
  );
}
