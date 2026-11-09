"use client";
/* eslint-disable @next/next/no-html-link-for-pages */

import { LEGAL_UPDATED, legalPages } from "./legal-content";
import { BACKUP_LEGAL_READY, BACKUP_LEGAL_VERSION,backupPrivacySections,backupTermsSections } from './backup-legal';
import {useBackupCopy} from './use-backup-copy';
import {getRuntimeLanguage} from './i18n';
import {localizedAccountRetentionSections} from './account-retention-legal';
import {localizedDictationLegalSections} from './dictation-legal';
import {localizedWeatherLegalSections} from './weather-legal';
import type {LegalPageName} from './legal-route';
export {currentLegalPage} from './legal-route';
export type {LegalPageName} from './legal-route';
const backupTitles=new Set([...backupPrivacySections,...backupTermsSections].map(([title])=>String(title)));

export function LegalPage({ page }: { page: LegalPageName }) {
  const content = legalPages[page];
  const language=getRuntimeLanguage();
  const {c}=useBackupCopy(language);
  const retentionSections=localizedAccountRetentionSections(language);
  const dictationSections=localizedDictationLegalSections(language);
  const weatherSections=localizedWeatherLegalSections(language);
  return (
    <main className="legal-shell">
      <header className="legal-header">
        <a className="welcome-brand" href="/"><span className="solar-mark"><i /></span><span><strong>GENESIS</strong><small>доверие и ясность</small></span></a>
        <a href="/">← На главную</a>
      </header>
      <article className="legal-document">
        <span className="welcome-kicker">ОФИЦИАЛЬНЫЙ ДОКУМЕНТ</span>
        <h1>{content.title}</h1>
        <p className="legal-intro">{content.intro}</p>
        <p className="legal-date">Редакция от {LEGAL_UPDATED}</p>
        {!BACKUP_LEGAL_READY && (page==='privacy'||page==='terms')?<p data-no-translate role="note">{c('Проект редакции {version}. Дополнения для 3.2.2 ещё не готовы к публикации: требуются подтверждение юридических фактов и приёмка отключённых функций.','Draft revision {version}. The 3.2.2 additions await confirmation of legal facts and acceptance testing of the disabled features.').replace('{version}',BACKUP_LEGAL_VERSION)}</p>:null}
        {content.sections.map(([title, body]) => {
          const weather=weatherSections.get(title);
          if(weather)return <section data-no-translate key={title}><h2>{weather[0]}</h2><p>{weather[1]}</p></section>;
          const dictation=dictationSections.get(title);
          if(dictation)return <section data-no-translate key={title}><h2>{dictation[0]}</h2><p>{dictation[1]}</p></section>;
          const retention=retentionSections.get(title);
          if(retention)return <section data-no-translate key={title}><h2>{retention[0]}</h2><p>{retention[1]}</p></section>;
          return backupTitles.has(title)?<section data-no-translate key={title}><h2>{c(title,title)}</h2><p>{c(body,body)}</p></section>:<section key={title}><h2>{title}</h2><p>{body}</p></section>;
        })}
        {page === "privacy" ? (
          <p className="legal-policy-link">
            <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">Google API Services User Data Policy</a>
          </p>
        ) : null}
      </article>
      <footer className="legal-footer"><a href="/privacy">Конфиденциальность</a><a href="/terms">Соглашение</a><a href="/support">Поддержка</a><a href="/delete-account">Удаление аккаунта</a></footer>
    </main>
  );
}
