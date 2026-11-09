import {LUNAR_PATRONS, LUNAR_TRIAD_SOURCES, lunarTriadCopy} from './lunar-triad';
import type {Language} from './i18n';
import './lunar-triad.css';

export function LunarTriad({language}: {language:Language}) {
  const copy=lunarTriadCopy(language);
  return <div className="lunar-triad" data-no-translate>
      <p>{copy.note}</p>
      {LUNAR_PATRONS.map((id,index)=><section key={id} aria-label={copy[id].name}>
        <h4>{copy[id].name} · {index===0?'1–10':index===1?'11–20':'21–29/30'}</h4>
        <p>{copy[id].meaning}</p>
      </section>)}
      <ul>{LUNAR_TRIAD_SOURCES.map(source=><li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.label}</a></li>)}</ul>
  </div>;
}
