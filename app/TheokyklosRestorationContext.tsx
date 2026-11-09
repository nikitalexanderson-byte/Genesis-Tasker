import type { Language } from "./i18n";
import { RESTORATION_AUXILIARIES, RESTORATION_FRAMEWORK, RESTORATION_SECTORS } from "./stoicheion-restoration-data";
import { restorationCopy, restorationLocal } from "./stoicheion-restoration-copy";
import "./stoicheion-restoration.css";

export function TheokyklosRestorationContext({ sectorId, language }: {sectorId: string; language: Language}) {
  const sector = RESTORATION_SECTORS.find(item => item.id === sectorId);
  const auxiliary = RESTORATION_AUXILIARIES.find(item => item.id === sectorId);
  const t = restorationCopy(language);
  const local = (text: {ru:string;en:string}) => restorationLocal(text, language);
  if (!sector && !auxiliary) return null;
  return <section className="restoration-context" data-no-translate>
    <h3>{sector ? t.ambivalence : t.supports}</h3>
    {sector ? <><p>{local(sector.field)}</p><p>{local(sector.ambivalence)}</p>
      <details><summary>{t.explain}</summary><h4>{local(sector.myth.title)}</h4><p>{local(sector.myth.body)}</p>
        <a href={sector.myth.url} target="_blank" rel="noreferrer">{t.source} · {sector.myth.source}</a><p>{t.interpretation}</p>
    </details></> : auxiliary ? <p>{local(auxiliary.purpose)}</p> : null}
    <details><summary>{local(RESTORATION_FRAMEWORK.title)}</summary><p>{RESTORATION_FRAMEWORK.formula}</p><p>{local(RESTORATION_FRAMEWORK.body)}</p></details>
  </section>;
}
