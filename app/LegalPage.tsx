"use client";

import { publicLegalUpdated } from "./legal-content";
import { BACKUP_LEGAL_READY, BACKUP_LEGAL_VERSION } from './backup-legal';
import {useBackupCopy} from './use-backup-copy';
import {browserLanguage,getRuntimeLanguage,translateText} from './i18n';
import {legalPresentation} from './legal-presentation';
import {publicPagePath,currentPublicEdition,type PublicEdition} from './public-route';
import {PublicEditionRouting} from './PublicRegionControl';
import type {LegalPageName} from './legal-route';
import {publicMerchantHtml, publicProductCopy} from './public-product';
import './public-product.css';
export {currentLegalPage} from './legal-route';
export type {LegalPageName} from './legal-route';

export function LegalPage({page,edition=currentPublicEdition()}:{page:LegalPageName;edition?:PublicEdition}) {
  const language=typeof window==='undefined'?getRuntimeLanguage():browserLanguage();
  const {c}=useBackupCopy(language);
  const content=legalPresentation(page,language,text=>translateText(text,language),text=>c(text,translateText(text,'en')),edition);
  const base=process.env.NEXT_PUBLIC_GENESIS_BASE_PATH?.trim()||'';
  const home=publicPagePath(language,'home',base,edition);
  return (
    <main className="legal-shell" data-no-translate><PublicEditionRouting language={language}/>
      <header className="legal-header">
        <a className="welcome-brand" href={home}><span className="solar-mark"><i /></span><span><strong>GENESIS</strong><small>{translateText('доверие и ясность',language)}</small></span></a>
        <a href={home}>{translateText('← На главную',language)}</a>
      </header>
      <article className="legal-document" data-no-translate={page==='refund'?true:undefined}>
        <span className="welcome-kicker">{translateText('ОФИЦИАЛЬНЫЙ ДОКУМЕНТ',language)}</span>
        <h1>{content.title}</h1>
        <p className="legal-intro">{content.intro}</p>
        <p className="legal-date">{translateText('Редакция от',language)} {publicLegalUpdated()}</p>
        <div data-no-translate dangerouslySetInnerHTML={{__html:publicMerchantHtml(language,page,base,edition)}} />
        {!BACKUP_LEGAL_READY && (page==='privacy'||page==='terms')?<p data-no-translate role="note">{c('Проект редакции {version}. Дополнения для 3.2.2 ещё не готовы к публикации: требуются подтверждение юридических фактов и приёмка отключённых функций.','Draft revision {version}. The 3.2.2 additions await confirmation of legal facts and acceptance testing of the disabled features.').replace('{version}',BACKUP_LEGAL_VERSION)}</p>:null}
        {content.sections.map(([title,body])=><section data-no-translate key={title}><h2>{title}</h2><p>{body}</p></section>)}
        {page === "privacy" ? (
          <p className="legal-policy-link">
            <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">Google API Services User Data Policy</a>
          </p>
        ) : null}
      </article>
      <footer className="legal-footer">{(['privacy','terms','refund','support','delete-account'] as const).map(slug=><a key={slug} href={publicPagePath(language,slug,base,edition)}>{slug==='delete-account'?publicProductCopy(language,edition).deleteAccount:publicProductCopy(language,edition)[slug]}</a>)}</footer>
    </main>
  );
}
