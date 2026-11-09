"use client";

import { useEffect } from "react";
import { DialogCloseButton } from "./DialogCloseButton";
import { futureModelingCopy } from "./future-modeling";
import { stoicheionTimelineCopy } from "./stoicheion-timeline";
import { useDialogAccessibility } from "./use-dialog-accessibility";

export function StoicheionTimelineHelp({ language, onClose }: { language: string; onClose: () => void }) {
  const copy = stoicheionTimelineCopy(language);
  const localized = futureModelingCopy(language);
  const dialogRef = useDialogAccessibility<HTMLElement>(onClose);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);
  return <div className="stoicheion-timeline-help-backdrop" role="presentation">
    <section ref={dialogRef} className="stoicheion-timeline-help-dialog" role="dialog" aria-modal="true"
      aria-labelledby="stoicheion-timeline-help-title" tabIndex={-1} lang={localized.language} data-no-translate>
      <header><h2 id="stoicheion-timeline-help-title">{copy.method}</h2>
        <DialogCloseButton aria-label={localized.close} onClick={onClose} />
      </header>
      {copy.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
    </section>
  </div>;
}
