import {legalPageContent} from './legal-content';
import {localizedAccountRetentionSections} from './account-retention-legal';
import {localizedDictationLegalSections} from './dictation-legal';
import {localizedWeatherLegalSections} from './weather-legal';
import {backupPrivacySections,backupTermsSections} from './backup-legal';
import adviceCopy from './daily-advice-copy.json';
import releaseCopy from './release-318-legal-copy.json';
import type {LegalPageName} from './legal-route';

const backupTitles=new Set([...backupPrivacySections,...backupTermsSections].map(([title])=>String(title)));
type Translate=(source:string)=>string;

/** Shared by React and the no-JavaScript build: authored disclosures always win
 * over generic UI translations, including the actual service/controller roles. */
export function legalPresentation(page:LegalPageName,language:string,translate:Translate,backup:Translate=translate) {
  const source=legalPageContent(page,language);
  if(page==='refund')return source;
  const sections=new Map([...localizedAccountRetentionSections(language),...localizedDictationLegalSections(language),...localizedWeatherLegalSections(language)]);
  const advice=adviceCopy[language as keyof typeof adviceCopy]??adviceCopy.en;
  const release=releaseCopy[language as keyof typeof releaseCopy]??releaseCopy.en;
  sections.set(adviceCopy.ru.dataTitle,[advice.dataTitle,`${advice.dataNotice} ${advice.ageData}`]);
  sections.set(adviceCopy.ru.ageLegalTitle,[advice.ageLegalTitle,advice.ageLegal]);
  const authored=new Map(Object.entries(releaseCopy.ru).map(([key,value])=>[value,release[key as keyof typeof release]]));
  return {title:translate(source.title),intro:translate(source.intro),sections:source.sections.map(([title,body])=>{
    const complete=sections.get(title);if(complete)return complete;
    if(backupTitles.has(title))return [backup(title),backup(body)] as const;
    return [translate(title),authored.get(body)??translate(body)] as const;
  })};
}
