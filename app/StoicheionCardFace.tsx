import type {CSSProperties} from 'react';
import type {StoicheionLetter} from './stoicheion-data';
import {getStoicheionCardArt} from './stoicheion-card-art';
import {getRuntimeLanguage,type Language} from './i18n';
import {stoicheionArtCopy} from './catalog-i18n';
import {formatGreekTerms} from './greek-terms';

const STOICHEION_CARD_ART_VERSION = "20260906-anatomy-glow";
const CARD_LABEL = { ru: "Карта", en: "Card", el: "Κάρτα", de: "Karte", fr: "Carte",
  es: "Carta", it: "Carta", pt: "Carta", pl: "Karta", sr: "Карта", uk: "Картка",
  zh: "卡牌", tr: "Kart", ja: "カード" } as const;

type StoicheionCardVariant = "alphabet" | "daily" | "dialog" | "spread";

/** The same authored face is used by the Stoicheion deck and its Aurora readings. */
export function StoicheionCardFace({
  letter,
  reversed = false,
  variant,
  language = getRuntimeLanguage(),
}: {
  letter: StoicheionLetter;
  reversed?: boolean;
  variant: StoicheionCardVariant;
  language?: Language;
}) {
  const art = getStoicheionCardArt(letter);
  const localizedArt = stoicheionArtCopy(letter.id, language);
  const body = localizedArt?.body ?? art.body;
  const bodyGreek = formatGreekTerms(localizedArt?.bodyGreek ?? art.bodyGreek, language);
  const invocation = localizedArt?.invocation ?? art.invocation;
  const cardLabel = `${CARD_LABEL[language]} ${letter.name}: ${letter.symbol}, ${body}, ${bodyGreek}`;

  return (
    <span
      className={`stoicheion-card-visual stoicheion-card-visual-${variant}${reversed ? " is-reversed" : ""}`}
      data-genesis-preserve="stoicheion-card-art"
      role="img"
      aria-label={cardLabel}
      style={{
        "--stoicheion-card-accent": art.accent,
        "--stoicheion-card-accent-rgb": art.accentRgb,
      } as CSSProperties}
    >
      {/* Static pre-compressed deck art must remain a predictable public-file URL in both build targets. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="stoicheion-card-artwork"
        src={`/stoicheion-cards/${letter.id}.webp?v=${STOICHEION_CARD_ART_VERSION}`}
        alt=""
        draggable={false}
        loading={variant === "daily" || variant === "dialog" ? "eager" : "lazy"}
      />
      <span className="stoicheion-card-artwork-shade" aria-hidden="true" />
      {/* The shared SVG is a decorative overlay, not content that benefits from image optimization. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="stoicheion-card-frame" src="/stoicheion-cards/frame-greek-key.svg" alt="" draggable={false} aria-hidden="true" />
      <span className="stoicheion-card-title" data-no-translate>
        <small>{String(letter.order).padStart(2, "0")}</small>
        <strong>{letter.name}</strong>
      </span>
      <span className="stoicheion-card-sigil" lang="el">
        <strong>{letter.symbol}</strong>
        <small>{letter.lowercase}</small>
      </span>
      <span className="stoicheion-card-caption" data-no-translate>
        <strong>{body}</strong>
        <small lang={language}>{bodyGreek}</small>
        <i lang={language}>{invocation}</i>
      </span>
    </span>
  );
}
