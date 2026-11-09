import baseRU from './texts.ru.json';
import testRU from './forecast-test-copy.ru.json';
import adaptiveRU from './adaptive-copy.ru.json';
const RU={...baseRU,...testRU,...adaptiveRU};
import { translateText, type Language } from '../i18n';
import {RESTORATION_LETTER_FOCI} from '../stoicheion-restoration-data';
import {restorationLocal} from '../stoicheion-restoration-copy';

const languages=new Set(['ru','en','el','de','fr','es','it','pt','pl','sr','uk','zh','tr','ja']);
export const auroraLanguage=(value:string):Language=>languages.has(value)?value as Language:'en';
const normalize=(value:string)=>value.replace(/\s+/gu,' ').trim();
const packs=new Map<Language,Promise<Record<string,string>>>();
export function loadAuroraLocale(language:Language):Promise<Record<string,string>> {
  if(language==='ru')return Promise.resolve(RU);
  if(!packs.has(language))packs.set(language,Promise.all([
    import(`./locales/${language}.a.json`),import(`./locales/${language}.b.json`),
  ]).then(([a,b])=>({...a.default,...b.default})).catch(error=>{packs.delete(language);throw error;}));
  return packs.get(language)!;
}

/** Canonical records stay in their authored language; localization never rewrites saved forecasts or user values. */
export function createAuroraTranslator(language:Language,pack:Record<string,string>) {
  const dictionary=new Map<string,string>();
  for(const focus of Object.values(RESTORATION_LETTER_FOCI))for(const text of [focus.risk,focus.quality])dictionary.set(normalize(text.ru),restorationLocal(text,language));
  for(const [id,source] of Object.entries(RU)){
    const translated=pack[id];if(typeof translated!=='string'||!translated.trim())throw new Error(`AURORA_LOCALE_MISSING:${language}:${id}`);
    const from=source.split('|'),to=translated.split('|');
    if(from.length!==to.length)throw new Error(`AURORA_LOCALE_STRUCTURE:${language}:${id}`);
    dictionary.set(normalize(source),normalize(translated));
    from.forEach((part,index)=>dictionary.set(normalize(part),normalize(to[index])));
  }
  const fragments=[...dictionary].filter(([source])=>source.length>=4&&/[А-Яа-яЁё]/u.test(source)).sort((a,b)=>b[0].length-a[0].length)
    .map(([source,replacement])=>[source,replacement,source.toLocaleLowerCase('ru')] as const);
  return (source:string)=>{
    if(language==='ru')return source;
    const normalized=normalize(source),exact=dictionary.get(normalized);
    const outer=(value:string)=>(source.match(/^\s*/u)?.[0]??'')+value+(source.match(/\s*$/u)?.[0]??'');
    if(exact)return outer(exact);
    if(!/[А-Яа-яЁё]/u.test(normalized))return source;
    let pieces=[{text:normalized,translated:false}];
    for(const [fragment,replacement,foldedFragment] of fragments)pieces=pieces.flatMap(piece=>{
      if(piece.translated)return [piece];
      const folded=piece.text.toLocaleLowerCase('ru');if(!folded.includes(foldedFragment))return [piece];
      const parts:typeof pieces=[];let start=0,index:number;
      while((index=folded.indexOf(foldedFragment,start))!==-1){
        parts.push({text:piece.text.slice(start,index),translated:false},{text:replacement,translated:true});start=index+fragment.length;
      }
      parts.push({text:piece.text.slice(start),translated:false});return parts;
    });
    return outer(pieces.map(piece=>{
      if(piece.translated)return piece.text;
      const exact=dictionary.get(normalize(piece.text));
      if(exact)return (piece.text.match(/^\s*/u)?.[0]??'')+exact+(piece.text.match(/\s*$/u)?.[0]??'');
      return translateText(piece.text,language,true);
    }).join(''));
  };
}
