import {useEffect,useState} from 'react';
import {auroraLanguage} from './aurora/localization';
import {translateText,type Language} from './i18n';
const packs=new Map<Language,Promise<Record<string,string>>>();
export function loadBackupCopy(language:Language) {
 if(!packs.has(language))packs.set(language,import(`./backup-locales/${language}.json`).then(value=>value.default).catch(error=>{packs.delete(language);throw error;}));
 return packs.get(language)!;
}
export function useBackupCopy(requested:string) {
 const language=auroraLanguage(requested),[pack,setPack]=useState<{language:Language;copy:Record<string,string>}|null>(null);
 const [failure,setFailure]=useState<{language:Language;attempt:number}|null>(null),[attempt,setAttempt]=useState(0);
 useEffect(()=>{let live=true;if(language==='ru')return;
  void loadBackupCopy(language).then(copy=>{if(live)setPack({language,copy});}).catch(()=>{if(live)setFailure({language,attempt});});return()=>{live=false;};
 },[language,attempt]);
 const ready=language==='ru'||pack?.language===language;
 const copy = (source: string, english: string) => {
  if (language === 'ru') return source;
  if (pack?.language === language) return pack.copy[source] ?? translateText(source, language, true);
  const initial = translateText(source, language);
  return initial === source ? english : initial;
 };
 return {ready,failed:failure?.language===language&&failure.attempt===attempt,retry:()=>setAttempt(value=>value+1),c:copy};
}
