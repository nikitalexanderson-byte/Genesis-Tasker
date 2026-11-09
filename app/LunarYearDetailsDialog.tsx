"use client";
import {DialogCloseButton} from './DialogCloseButton';
import {useDialogAccessibility} from './use-dialog-accessibility';
import {LunarTriad} from './LunarTriad';
import {lunarTriadCopy} from './lunar-triad';
import {translateText, type Language} from './i18n';

export default function LunarYearDetailsDialog({language,onClose}:{language:Language;onClose:()=>void}) {
  const ref=useDialogAccessibility<HTMLElement>(onClose);
  const copy=lunarTriadCopy(language);
  return <div className="modal-backdrop sacred-year-details-backdrop" role="presentation">
    <section ref={ref} className="sacred-year-details-modal" role="dialog" aria-modal="true" lang={language}
      aria-labelledby="lunar-year-details-title" tabIndex={-1}>
      <DialogCloseButton className="modal-close sacred-year-details-close" onClick={onClose}
        aria-label={translateText('Закрыть',language)}/>
      <header className="sacred-year-details-header" data-no-translate>
        <h2 id="lunar-year-details-title">{copy.title} · {copy.more}</h2>
      </header>
      <LunarTriad language={language}/>
    </section>
  </div>;
}
