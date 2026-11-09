"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import type { Language } from "./i18n";
import { DialogCloseButton } from "./DialogCloseButton";
import { ExperimentalIcon } from "./ExperimentalIcon";
import { useDialogAccessibility } from "./use-dialog-accessibility";
import { restorationRoot } from "./stoicheion-restoration-math";
import content from "./olympian-isopsephy.json";
import "./olympian-isopsephy.css";

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

export function OlympianIsopsephyContent({ language, onSelect, onOpenStoicheion }: {
  language: Language; onSelect: (deity: OlympianDeity) => void; onOpenStoicheion?: () => void;
}) {
  const lang = locale(language);
  const copy = content.locales[lang];
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
    <ul className="olympian-grid">
      {deities.map(deity => <li key={deity.id} className={deity.id === "dionysus" ? "olympian-wide" : undefined}>
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
  </div>;
}

export function OlympianIsopsephyDialog({ deity, language, onClose }: {
  deity: OlympianDeity; language: Language; onClose: () => void;
}) {
  const lang = locale(language);
  const copy = content.locales[lang];
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useDialogAccessibility<HTMLElement>(onClose);
  const sum = deity.calculatedNumber ?? deity.number;
  const equation = `${deity.summands.join(" + ")} = ${sum}`;
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);
  const dialog = <div className="modal-backdrop olympian-backdrop" role="presentation" lang={lang} data-no-translate>
    <section ref={dialogRef} className="olympian-modal" role="dialog" aria-modal="true"
      aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}>
      <header className="olympian-modal-heading">
        <OlympianSymbol deity={deity} />
        <div>
          <h2 id={titleId}>{deity.name[lang]} <span>{deity.number}</span></h2>
          <p className="olympian-greek" lang="el">{deity.greek}</p>
        </div>
        <DialogCloseButton onClick={onClose} aria-label={`${copy.close}: ${deity.name[lang]}`} />
      </header>
      <p id={descriptionId} className="olympian-modal-summary">{deity.summary[lang]}</p>
      <div className="olympian-calculation">
        <span>{copy.formula}</span>
        <p className="olympian-equation" role="math" aria-label={equation}>
          {deity.summands.map((value, index) => <span aria-hidden="true" key={index}>{index > 0 ? "+ " : ""}{value}</span>)}
          <strong aria-hidden="true">= {sum}</strong>
        </p>
        <p className="olympian-root">{copy.root}: {restorationRoot(sum)}</p>
        {deity.calculationNote ? <p className="olympian-calculation-note">{deity.calculationNote[lang]}</p> : null}
      </div>
      <p className="olympian-detail">{deity.detail[lang]}</p>
    </section>
  </div>;
  return typeof document === "undefined" ? dialog : createPortal(dialog, document.body);
}

export function OlympianIsopsephy({ language, onOpenStoicheion }: { language: Language; onOpenStoicheion?: () => void }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<OlympianDeity | null>(null);
  const lang = locale(language);
  const copy = content.locales[lang];
  const titleId = useId();
  const close = () => { setOpen(false); setSelected(null); };
  const catalogRef = useDialogAccessibility<HTMLElement>(close, open);
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
      <OlympianIsopsephyContent language={language} onSelect={setSelected}
        onOpenStoicheion={onOpenStoicheion ? () => { close(); onOpenStoicheion(); } : undefined} />
    </section>
  </div> : null;
  return <div className="olympian-isopsephy" lang={lang} data-no-translate>
    <button type="button" className="year-details-button olympian-disclosure" aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <span><ExperimentalIcon name="theokyklos" /></span>
      <span><strong>{copy.title}</strong><small>{copy.subtitle}</small></span>
      <ExperimentalIcon name="open" />
    </button>
    {typeof document === "undefined" ? catalog : createPortal(catalog, document.body)}
    {selected ? <OlympianIsopsephyDialog deity={selected} language={language} onClose={() => setSelected(null)} /> : null}
  </div>;
}
