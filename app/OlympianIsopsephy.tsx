"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Language } from "./i18n";
import { DialogCloseButton } from "./DialogCloseButton";
import { ExperimentalIcon } from "./ExperimentalIcon";
import { useDialogAccessibility } from "./use-dialog-accessibility";
import { greekIsopsephy, restorationRoot } from "./stoicheion-restoration-math";
import { translateText } from "./i18n";
import { OLYMPIAN_KNOWLEDGE, normalizeOlympianSearch, useOlympianCopy, type KnowledgeCopy } from "./olympian-knowledge";
import { OlympianGuide, OlympianKnowledge, type OlympianNavigation } from "./OlympianKnowledge";
import type { TheokyklosSegmentId } from "./theokyklos-data";
import content from "./olympian-isopsephy.json";
import "./olympian-isopsephy.css";
import { OlympianEmblem } from './OlympianEmblem';
import { olympianLetterEquation } from './olympian-reading-math';

type Copy = Record<Language, string>;
export type OlympianDeity = {
  id: string; greek: string; number: number; summands: number[];
  name: Copy; summary: Copy; detail: Copy; paths: string[];
  calculatedNumber?: number; calculationNote?: Copy;
};
const deities: readonly OlympianDeity[] = content.deities;
const locale = (language: Language): Language => Object.hasOwn(content.locales, language) ? language : "en";

function OlympianSymbol({ deity, className = "" }: { deity: OlympianDeity; className?: string }) {
  return <img className={`olympian-symbol ${className}`.trim()}
    src={`/theokyklos-symbols/olympian-${deity.id}-v313.png`} alt="" aria-hidden="true" decoding="async" />;
}

export function OlympianIsopsephyContent({ language, onSelect, onOpenStoicheion, onOpenSector, search }: {
  language: Language; onSelect: (deity: OlympianDeity) => void;
  search?: { id: string; query: string; onChange: (value: string) => void; copy: KnowledgeCopy };
} & OlympianNavigation) {
  const lang = locale(language);
  const copy = content.locales[lang];
  const knowledgeCopy = search?.copy;
  const query = search?.query ?? "";
  const needle = normalizeOlympianSearch(query);
  const visibleDeities = deities.filter(deity => {
    const knowledge = OLYMPIAN_KNOWLEDGE.deities[deity.id];
    const words = [...knowledge.words, ...knowledge.rootWords];
    return !needle || normalizeOlympianSearch([
      deity.name[lang], deity.greek, deity.number, deity.summary[lang],
      ...words.flatMap(word => [word.greek, greekIsopsephy(word.greek), knowledgeCopy?.[word.meaning] ?? "", knowledgeCopy?.[`rootName.${restorationRoot(greekIsopsephy(word.greek))}`] ?? ""]),
      ...OLYMPIAN_KNOWLEDGE.deities[deity.id].variants.flatMap(variant => [variant.greek, greekIsopsephy(variant.greek)]),
    ].join(" ")).includes(needle);
  });
  return <div className="olympian-body" lang={lang} data-no-translate>
    <div className="olympian-intro">
      <p>{copy.intro}</p>
      <a className="olympian-stoicheion-link" href="#stoicheion" onClick={event => {
        if (onOpenStoicheion && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
          event.preventDefault();
          onOpenStoicheion();
        }
      }}>{copy.link}<ExperimentalIcon name="open" /></a>
    </div>
    {knowledgeCopy && search ? <>
      <div className="olympian-search"><label className="sr-only" htmlFor={search.id}>{knowledgeCopy.search}</label><ExperimentalIcon name="search" /><input type="search" id={search.id} value={query} placeholder={knowledgeCopy.searchHint} onChange={event => search.onChange(event.target.value)} />{query ? <button type="button" aria-label={knowledgeCopy.clear} onClick={() => search.onChange("")}><ExperimentalIcon name="close" /></button> : null}</div>
      <OlympianGuide copy={knowledgeCopy} onOpenSector={onOpenSector} />
    </> : null}
    <ul className="olympian-grid">
      {visibleDeities.map(deity => <li key={deity.id} className={deity.id === "dionysus" ? "olympian-wide" : undefined}>
        <button type="button" className="olympian-tile" data-olympian={deity.id} data-dialog-save="false"
          aria-haspopup="dialog" onClick={() => onSelect(deity)}>
          <span className="olympian-tile-heading" aria-hidden="true">
            <OlympianSymbol deity={deity} />
            <span className="olympian-number">{deity.number}</span>
          </span>
          <strong>{deity.name[lang]}<span className="sr-only"> · {deity.number}</span></strong>
          <span className="olympian-summary">{deity.summary[lang]}</span>
        </button>
      </li>)}
    </ul>
    {visibleDeities.length === 0 && knowledgeCopy ? <p className="olympian-empty" role="status">{knowledgeCopy.empty}</p> : null}
  </div>;
}

function OlympianCatalog(props: Parameters<typeof OlympianIsopsephyContent>[0]) {
  const { copy } = useOlympianCopy(locale(props.language));
  const [query, setQuery] = useState("");
  const id = useId();
  return <OlympianIsopsephyContent {...props} search={copy ? { id, query, onChange: setQuery, copy } : undefined} />;
}

export function OlympianIsopsephyDialog({ deity, language, onClose, onBack, onSelect, onOpenStoicheion, onOpenSector, embedded = false }: {
  deity: OlympianDeity; language: Language; onClose: () => void;
  onBack?: () => void; onSelect?: (deity: OlympianDeity) => void;
  embedded?: boolean;
} & OlympianNavigation) {
  const lang = locale(language);
  const copy = content.locales[lang];
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useDialogAccessibility<HTMLElement>(onClose);
  const { copy: knowledgeCopy, error, retry } = useOlympianCopy(lang);
  const index = deities.findIndex(candidate => candidate.id === deity.id);
  const equation = olympianLetterEquation(deity.greek);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);
  const dialog = <div className="modal-backdrop olympian-backdrop" role="presentation" lang={lang} data-no-translate>
    <section ref={dialogRef} className="olympian-modal olympian-reading-modal" role="dialog" aria-modal="true" data-dialog-header="none" data-olympian-embedded={embedded || undefined}
      aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}>
      <div className="olympian-reading-toolbar">
        {onBack ? <button type="button" className="olympian-text-action" onClick={onBack}><ExperimentalIcon name="chevron-left" />{knowledgeCopy?.back ?? content.locales[lang].title}</button> : <span />}
        {!embedded ? <DialogCloseButton onClick={onClose} aria-label={`${copy.close}: ${deity.name[lang]}`} /> : null}
      </div>
      <header className="olympian-modal-heading">
        <OlympianSymbol deity={deity} />
        <div>
          <h2 id={titleId}>{deity.name[lang]} <span>{deity.number}</span></h2>
          <p className="olympian-greek" lang="el">{deity.greek}</p>
        </div>
      </header>
      <p id={descriptionId} className="olympian-modal-summary">{deity.summary[lang]}</p>
      <p className="olympian-detail">{deity.detail[lang]}</p>
      {knowledgeCopy ? <OlympianKnowledge key={deity.id} deity={deity} deities={deities} language={lang} copy={knowledgeCopy} onSelect={onSelect} onOpenStoicheion={onOpenStoicheion} onOpenSector={onOpenSector} /> : <><div className="olympian-calculation">
        <span>{copy.formula}</span>
        <p className="olympian-equation" role="math" aria-label={equation}>
          {equation}
        </p>
        {deity.calculationNote ? <p className="olympian-calculation-note">{deity.calculationNote[lang]}</p> : null}
      </div><p role="status">{error ? translateText("Не удалось загрузить данные", lang) : translateText("Загрузка…", lang)}</p>{error ? <button type="button" className="olympian-text-action" onClick={retry}>{translateText("Повторить", lang)}</button> : null}</>}
      {knowledgeCopy && onSelect ? <nav className="olympian-deity-navigation" aria-label={copy.title}>
        <button type="button" onClick={() => onSelect(deities[(index + deities.length - 1) % deities.length])}><ExperimentalIcon name="chevron-left" /><span><small>{knowledgeCopy.previous}</small>{deities[(index + deities.length - 1) % deities.length].name[lang]}</span></button>
        <button type="button" onClick={() => onSelect(deities[(index + 1) % deities.length])}><span><small>{knowledgeCopy.next}</small>{deities[(index + 1) % deities.length].name[lang]}</span><ExperimentalIcon name="chevron" /></button>
      </nav> : null}
    </section>
  </div>;
  return typeof document === "undefined" ? dialog : createPortal(dialog, document.body);
}

export function OlympianIsopsephy({ language, onOpenStoicheion, onOpenSector, initialDeityId, onInitialDeityOpened }: {
  language: Language; onOpenStoicheion?: OlympianNavigation["onOpenStoicheion"];
  onOpenSector?: (sectorId: TheokyklosSegmentId, returnTo: () => void) => void;
  initialDeityId?: string | null; onInitialDeityOpened?: () => void;
}) {
  const initialDeity = deities.find(deity => deity.id === initialDeityId) ?? null;
  const [open, setOpen] = useState(Boolean(initialDeity));
  const [selected, setSelected] = useState<OlympianDeity | null>(initialDeity);
  const lang = locale(language);
  const copy = content.locales[lang];
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [emblemState, setEmblemState] = useState<'rest' | 'hover' | 'pressed'>('rest');
  const close = () => {
    setOpen(false); setSelected(null);
    window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  };
  useEffect(() => { if (initialDeityId) onInitialDeityOpened?.(); }, [initialDeityId, onInitialDeityOpened]);
  const openSector = onOpenSector ? (sectorId: TheokyklosSegmentId) => {
    const returnDeity = selected;
    close();
    onOpenSector(sectorId, () => { setSelected(returnDeity); setOpen(true); });
  } : undefined;
  // The inert catalogue must not enter the dialog stack when a reading opens
  // directly after returning from a letter or a sector.
  const catalogRef = useDialogAccessibility<HTMLElement>(close, open && !selected);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);
  const catalog = open ? <div className="modal-backdrop olympian-backdrop" role="presentation" lang={lang} data-no-translate>
    <section ref={catalogRef} className="olympian-modal olympian-catalog-modal" role="dialog" aria-modal="true"
      aria-labelledby={titleId} aria-hidden={selected ? true : undefined} inert={selected ? true : undefined} tabIndex={-1}>
      <header className="olympian-catalog-heading">
        <h2 id={titleId}>{copy.title}</h2>
        <DialogCloseButton onClick={close} aria-label={copy.close} />
      </header>
      <OlympianCatalog language={language} onSelect={setSelected} onOpenSector={openSector}
        onOpenStoicheion={onOpenStoicheion ? () => { close(); onOpenStoicheion(); } : undefined} />
    </section>
  </div> : null;
  return <div className="olympian-isopsephy" lang={lang} data-no-translate>
    <button ref={triggerRef} type="button" className="year-details-button olympian-disclosure" aria-haspopup="dialog" aria-expanded={open} data-emblem-state={emblemState}
      onPointerEnter={() => setEmblemState('hover')} onPointerLeave={() => setEmblemState('rest')}
      onPointerDown={() => setEmblemState('pressed')} onPointerUp={() => setEmblemState('hover')} onPointerCancel={() => setEmblemState('rest')}
      onFocus={() => setEmblemState('hover')} onBlur={() => setEmblemState('rest')}
      onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') setEmblemState('pressed'); }}
      onKeyUp={() => setEmblemState('hover')} onClick={() => setOpen(true)}>
      <span className="olympian-emblem-frame"><OlympianEmblem state={emblemState} /></span>
      <span><strong>{copy.title}</strong><small>{copy.subtitle}</small></span>
      <ExperimentalIcon name="open" />
    </button>
    {typeof document === "undefined" ? catalog : createPortal(catalog, document.body)}
    {selected ? <OlympianIsopsephyDialog key={selected.id} deity={selected} language={language} onClose={close} onBack={() => setSelected(null)} onSelect={setSelected} onOpenSector={openSector}
      onOpenStoicheion={onOpenStoicheion ? (cardId, returnTo) => { close(); onOpenStoicheion(cardId, returnTo); } : undefined} /> : null}
  </div>;
}
