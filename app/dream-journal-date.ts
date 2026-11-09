import {getLunarDate,getSacredDate,type CalendarMode} from './calendar-data';
import {civilDateCarrier,isCivilDate} from './calendar-context';

const pentadDays=['I','II','III','IIII','V'];
/** Display only; the persisted civil day and calendar calculations stay unchanged. */
export function compactDreamDate(value:string,mode:CalendarMode):string {
 if(!isCivilDate(value)||mode==='profane')return value;
 const date=civilDateCarrier(value);
 if(mode==='sacred'){
  const sacred=getSacredDate(date);
  if(sacred.monthIndex===12)return `${sacred.day}.Ω`;
  return `${pentadDays[(sacred.day-1)%5]}.${Math.floor((sacred.day-1)/5)+1}.${sacred.monthIndex+1}`;
 }
 const lunar=getLunarDate(date);
 return `${(lunar.day-1)%10+1}.${Math.floor((lunar.day-1)/10)+1}.${lunar.monthOrdinal}`;
}
