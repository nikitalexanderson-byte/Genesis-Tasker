import ru from './gno-copy.ru.json';
import en from './gno-copy.en.json';
import el from './gno-locales/el.json';
import de from './gno-locales/de.json';
import fr from './gno-locales/fr.json';
import es from './gno-locales/es.json';
import it from './gno-locales/it.json';
import pt from './gno-locales/pt.json';
import pl from './gno-locales/pl.json';
import sr from './gno-locales/sr.json';
import uk from './gno-locales/uk.json';
import zh from './gno-locales/zh.json';
import tr from './gno-locales/tr.json';
import ja from './gno-locales/ja.json';
import type {Language} from '../i18n';
export type GnoCopy=typeof ru;
const locales:Record<string,GnoCopy>={ru,en,el,de,fr,es,it,pt,pl,sr,uk,zh,tr,ja};
export function gnoCopy(language:string):GnoCopy {return locales[language]??en;}
export function fillGno(text:string,values:Record<string,string|number>):string {
 return text.replace(/\{(\w+)\}/g,(token,key)=>Object.hasOwn(values,key)?String(values[key]):token);
}
export const gnoTitle=(language:Language|string)=>language==='ru'?'Гно Метэр Басилея':'Gno Meter Basileia';
