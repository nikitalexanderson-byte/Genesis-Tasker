import A from './adaptive-copy.ru.json';
import guided from './guided-copy.json';
import type {Language} from '../i18n';
import type {InformationFamily} from './catalog/questions';

export const guidedCopy=(language:string)=>guided[language as keyof typeof guided]??guided.en;
export function QuestionGuidance({language,family,example}:{language:Language;family:InformationFamily;example:string}){
 return <div className="aurora-question-guidance">
  <p data-no-translate>{guidedCopy(language)[family]}</p>
  <aside className="aurora-case"><strong>{A.example}</strong><p>{example}</p></aside>
 </div>;
}
