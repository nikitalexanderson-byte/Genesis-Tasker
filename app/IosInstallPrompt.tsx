import type { Language } from "./i18n";
import { DialogCloseButton } from "./DialogCloseButton";
import { useDialogAccessibility } from "./use-dialog-accessibility";
import copy from "./ios-install-copy.json";

export default function IosInstallPrompt({ language, onClose }: { language: Language; onClose: () => void }) {
  const ref = useDialogAccessibility<HTMLElement>(onClose);
  const text = copy[language];
  return <div className="modal-backdrop" role="presentation" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="ios-install-dialog" role="dialog" aria-modal="true" aria-labelledby="ios-install-title" ref={ref} tabIndex={-1} data-no-translate>
      <header><h2 id="ios-install-title">{text.title}</h2><DialogCloseButton aria-label={text.close} onClick={onClose} /></header>
      <p>{text.intro}</p>
      <ol>{text.steps.map(step => <li key={step}>{step}</li>)}</ol>
    </section>
  </div>;
}
