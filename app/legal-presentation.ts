import {legalPageContent} from './legal-content';
import {currentPublicEdition,type PublicEdition} from './public-route';
import websiteRegionCopy from './website-region-copy.json';
import internationalCopy from './public-international-copy.json';
import internationalBillingCopy from './public-billing-legal-copy.json';
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
export function legalPresentation(page:LegalPageName,language:string,translate:Translate,backup:Translate=translate,edition:PublicEdition=currentPublicEdition()) {
  const source=legalPageContent(page,language,edition);
  if(page==='refund')return source;
  const sections=new Map([...localizedAccountRetentionSections(language),...localizedDictationLegalSections(language),...localizedWeatherLegalSections(language)]);
  const advice=adviceCopy[language as keyof typeof adviceCopy]??adviceCopy.en;
  const release=releaseCopy[language as keyof typeof releaseCopy]??releaseCopy.en;
  sections.set(adviceCopy.ru.dataTitle,[advice.dataTitle,`${advice.dataNotice} ${advice.ageData}`]);
  sections.set(adviceCopy.ru.ageLegalTitle,[advice.ageLegalTitle,advice.ageLegal]);
  const authored=new Map(Object.entries(releaseCopy.ru).map(([key,value])=>[value,release[key as keyof typeof release]]));
  const international=edition==='international',external=internationalCopy[language as keyof typeof internationalCopy]??internationalCopy.en;
  const merchantBodies=new Set<string>([releaseCopy.ru.identity,releaseCopy.ru.performer,releaseCopy.ru.paymentData]);
  const present=(text:string)=>international?text.replace(/nikitalexanderson@gmail\.com/gi,'demiurge.soft@gmail.com').replace(/GigaChat|ГигаЧат|Гигачат|Гига Чат/gi,external.aiProvider).replace(/CloudTips/g,external.paymentProvider).replace('a signed the external payment provider notification','a signed notification from the external payment provider').replace(/(^|[.!?]\s+)the external payment provider/g,(_,prefix:string)=>prefix+'The external payment provider'):text;
  return {title:translate(source.title),intro:translate(source.intro),sections:source.sections.filter(([,body])=>!international||!merchantBodies.has(body)).map(([title,body])=>{
    if(international&&page==='support'&&title==='Связаться')return[translate(title),external.supportBody] as const;
    if(international&&page==='terms'&&title==='Тарифы и повышение доступа')return[translate(title),internationalBillingCopy[language as keyof typeof internationalBillingCopy]??internationalBillingCopy.en] as const;
    if(title===websiteRegionCopy.ru.title){const region=websiteRegionCopy[language as keyof typeof websiteRegionCopy]??websiteRegionCopy.en;return[region.title,region.privacy] as const;}
    const complete=sections.get(title);if(complete)return [present(complete[0]),present(complete[1])] as const;
    if(backupTitles.has(title))return [present(backup(title)),present(backup(body))] as const;
    return [present(translate(title)),present(authored.get(body)??translate(body))] as const;
  })};
}
