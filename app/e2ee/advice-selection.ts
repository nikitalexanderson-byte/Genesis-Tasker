import metadataPin from '../../contracts/public-advice-metadata-v1.json' with {type:'json'};
import {backupJson} from '../backup-format.ts';
import {ADVICE_CATEGORIES,ADVICE_TOPICS,adviceCardVisible,type AdviceCategory,type AdviceCollection,type AdvicePreferences,type AdviceScores,type AdviceTopicScores,type DailyAdvice} from '../daily-advice.ts';
import {SearchMoonPhase} from 'astronomy-engine';
import {civilDayNumber,momentCivilDate,isCivilDate} from '../calendar-context.ts';

export type AdviceCandidate=Omit<DailyAdvice,'dayKey'|'dismissed'|'sequence'>&{collection:AdviceCollection;topics?:string[];schedule?:{phases:('new'|'full')[];leadDays:number[]};
 status?:'draft'|'published';timeOfDay?:'morning'|'evening';priority?:boolean;contentVersion?:string;translationVersion?:string};
export type AdviceSelectionHistory={dayKey:string;entry:AdviceCandidate};
const hash=async(value:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
const clothing=(entry:AdviceCandidate)=>entry.topics?.some(topic=>['clothing','attributes'].includes(topic))??false;
const lunar=(entry:AdviceCandidate)=>entry.schedule?.phases.some(phase=>['new','full'].includes(phase))??false;
const visible=(entry:AdviceCandidate,preferences:AdvicePreferences)=>adviceCardVisible({...entry,dayKey:'2000-01-01',dismissed:false},preferences)
 &&(entry.status??'published')!=='draft';
export function advicePhaseLeads(day:string,timeZone:string){
 if(!isCivilDate(day))throw new Error('E2EE_ADVICE_DAY_INVALID');const result:Partial<Record<'new'|'full',number>>={},start=new Date(Date.parse(day+'T00:00:00Z')-36*3600000);
 for(const [phase,degrees]of [['new',0],['full',180]] as const){const event=SearchMoonPhase(degrees,start,6);if(event){const lead=civilDayNumber(momentCivilDate(event.date,timeZone))-civilDayNumber(day);if(lead>=1&&lead<=3)result[phase]=lead;}}return result;
}
export async function publicAdviceMetadata(read:(path:string)=>Promise<Uint8Array>,current:()=>void):Promise<AdviceCandidate[]>{
 current();const bytes=await read(metadataPin.path);current();if(bytes.length!==metadataPin.bytes)throw new Error('E2EE_ADVICE_CATALOGUE_INTEGRITY');
 const actual=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');current();
 if(actual!==metadataPin.sha256)throw new Error('E2EE_ADVICE_CATALOGUE_INTEGRITY');const value=backupJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes),8*1024*1024) as {protocol:number;policyVersion:string;items:AdviceCandidate[]};
 if(value.protocol!==1||!Array.isArray(value.items)||value.items.length<1||value.items.length>10000||new Set(value.items.map(row=>row.id)).size!==value.items.length)throw new Error('E2EE_ADVICE_CATALOGUE_INVALID');
 for(const row of value.items){if(!/^advice-[a-f0-9]{24}$/.test(row.id)||!['aurora','philosophers'].includes(row.collection)||typeof row.body!=='string'||!row.body.trim()||row.body.length>100000
  ||!Array.isArray(row.categories)||row.categories.some(id=>!ADVICE_CATEGORIES.includes(id))||!Array.isArray(row.sources)||row.sources.length>20||row.topics?.some(topic=>!ADVICE_TOPICS.includes(topic as typeof ADVICE_TOPICS[number])))throw new Error('E2EE_ADVICE_CATALOGUE_INVALID');}
 current();return structuredClone(value.items);
}
export function adviceCollectionLimits(items:AdviceCandidate[],preferences:AdvicePreferences,packageLimit:number|null){
 const eligible=items.filter(entry=>visible(entry,preferences)),available=ADVICE_CATEGORIES.filter(id=>eligible.some(entry=>entry.categories.includes(id))),aurora=Math.min(6,Math.max(3,(preferences.smart?available:available.filter(id=>preferences.categories.includes(id))).length));
 return{aurora:preferences.collections.includes('aurora')&&eligible.some(row=>row.collection==='aurora')?Math.min(aurora,packageLimit??aurora):0,
  philosophers:preferences.collections.includes('philosophers')&&eligible.some(row=>row.collection==='philosophers')?preferences.philosophersPerDay:0};
}
/** Same editorial selection rules run locally: category/topic affinity, lunar
 * preparation, rare clothing pool, source/theme alternation and unseen rounds.
 * Callers persist the selected full snapshot before publishing its reference. */
export async function choosePrivateAdvice(input:{items:AdviceCandidate[];preferences:AdvicePreferences;scores:AdviceScores;topics:AdviceTopicScores;history:AdviceSelectionHistory[];
 issuedToday:AdviceCandidate[];day:string;timeZone:string;hour:number;seed:string;ownerId:string;excludedCollections:AdviceCollection[];restricted:boolean;previousCategories?:AdviceCategory[];reservePhilosopher?:boolean},current:()=>void):Promise<AdviceCandidate|null>{
 const {items,preferences,scores,topics,day,history,issuedToday}=input;current();
 const available=ADVICE_CATEGORIES.filter(id=>items.some(entry=>entry.categories.includes(id)));let categories=preferences.smart?available:available.filter(id=>preferences.categories.includes(id));
 if(!categories.length)categories=preferences.smart?available:available.slice(0,1);
 if(!preferences.categories.includes('aphrodisia')||preferences.aphrodisiaAdult==null)categories=categories.filter(id=>id!=='aphrodisia');
 const leads=advicePhaseLeads(day,input.timeZone),excluded=new Set(issuedToday.map(row=>row.id)),lunarIssued=issuedToday.some(lunar)||history.some(row=>row.dayKey===day&&lunar(row.entry));
 const timeMatches=(entry:AdviceCandidate)=>entry.timeOfDay==='morning'?input.hour>=5&&input.hour<12:entry.timeOfDay==='evening'?input.hour>=18||input.hour<5:true;
 let eligible=items.filter(entry=>visible(entry,preferences)&&!input.excludedCollections.includes(entry.collection)&&!excluded.has(entry.id)
  &&(!input.restricted||!entry.categories.some(id=>['aphrodisia','psychopompia'].includes(id)))&&(entry.collection==='philosophers'||entry.categories.some(id=>categories.includes(id)))
  &&(!entry.schedule||entry.schedule.phases.some(phase=>entry.schedule!.leadDays.includes(leads[phase]??0)))&&(!lunarIssued||!lunar(entry))&&(!preferences.smart||timeMatches(entry)));
 if(!eligible.length)return null;
 if(input.reservePhilosopher&&excluded.size>=5&&eligible.some(entry=>entry.collection==='philosophers'))eligible=eligible.filter(entry=>entry.collection==='philosophers');
 const lastShown=new Map<string,string>(),shownCounts=new Map<string,number>(),exposures=new Set<string>(),recentCategories=new Map<string,number>(),recentTopics=new Map<string,number>();
 history.forEach((row,index)=>{if(!lastShown.has(row.entry.id))lastShown.set(row.entry.id,row.dayKey);const id=row.entry.id+':'+row.dayKey;if(!exposures.has(id)){shownCounts.set(row.entry.id,(shownCounts.get(row.entry.id)??0)+1);exposures.add(id);}
  if(index<3){for(const id of row.entry.categories)recentCategories.set(id,(recentCategories.get(id)??0)+1);for(const id of row.entry.topics??[])recentTopics.set(id,(recentTopics.get(id)??0)+1);}});
 if((topics.clothing??0)+(topics.attributes??0)<=0){
  const ordinaryUnseen=items.some(entry=>(entry.status??'published')!=='draft'&&entry.categories.includes('hestiology')&&!clothing(entry)&&!lastShown.has(entry.id)),cutoff=civilDayNumber(day)-30,month=day.slice(0,7)+'-01';
  const recent=history.some(row=>(civilDayNumber(row.dayKey)>cutoff||row.dayKey>=month)&&clothing(row.entry)),rareDay=parseInt((await hash(input.ownerId+':'+day+':clothing')).slice(0,4),16)%4===0;current();
  if(ordinaryUnseen||recent||history[0]&&clothing(history[0].entry)||!rareDay)eligible=eligible.filter(entry=>!clothing(entry));
 }
 if(!eligible.length)return null;
 const themes=new Map(['love','aesthetics','consciousness'].map(id=>[id,0]));let previousTheme:string|null=null;
 for(const row of history){const theme=row.entry.aphrodisiaTheme;if(theme&&themes.has(theme)){themes.set(theme,themes.get(theme)!+1);previousTheme??=theme;}}
 const presentThemes=[...new Set(eligible.map(entry=>entry.aphrodisiaTheme).filter((id):id is NonNullable<typeof id>=>!!id))];
 if(presentThemes.length){const min=Math.min(...presentThemes.map(id=>themes.get(id)!));eligible=eligible.filter(entry=>!entry.aphrodisiaTheme||themes.get(entry.aphrodisiaTheme)===min);}
 const round=(rows:AdviceCandidate[])=>{const min=Math.min(...rows.map(entry=>shownCounts.get(entry.id)??0));return rows.filter(entry=>(shownCounts.get(entry.id)??0)===min);};
 if(preferences.collections.length>1&&new Set(eligible.map(row=>row.collection)).size>1){let rows=round(eligible);if(rows.some(entry=>entry.schedule))rows=rows.filter(entry=>entry.schedule);
  const sources=[...new Set(rows.map(entry=>entry.collection))],different=sources.filter(source=>source!==history[0]?.entry.collection),choices=different.length?different:sources;
  const collection=choices[parseInt((await hash(input.seed+':collection')).slice(0,4),16)%choices.length];current();eligible=rows.filter(entry=>entry.collection===collection);}
 if(input.previousCategories?.length){const rows=round(eligible),different=rows.filter(entry=>entry.categories.some(id=>!input.previousCategories!.includes(id)));eligible=different.length?different:rows;}
 if(previousTheme){const rows=round(eligible),different=rows.filter(entry=>entry.aphrodisiaTheme!==previousTheme);if(different.length)eligible=different;}
 const family=()=>{const parenting=topics.parenting??0,sons=topics.sons??0,fatherhood=topics.fatherhood??0,motherhood=topics.motherhood??0;let score=Math.log1p(parenting+sons+fatherhood)+(fatherhood>0?1.5:0)+(sons>0?.75:0);if(motherhood>0&&fatherhood<=0)score=score*.3-1;return score;};
 type Rank=(string|number)[];let best:AdviceCandidate|null=null,bestRank:Rank|null=null;
 const before=(left:Rank,right:Rank)=>{for(let index=0;index<left.length;index++){if(left[index]<right[index])return true;if(left[index]>right[index])return false;}return false;};
 for(const entry of eligible){let affinity=0,recent=0,topicAffinity=0;
  for(const category of entry.categories.filter(id=>categories.includes(id))){affinity=Math.max(affinity,preferences.smart?Math.log1p(Math.max(0,scores[category]??0)):1);recent=Math.max(recent,recentCategories.get(category)??0);}
  for(const topic of entry.topics??[])if(preferences.smart||['clothing','attributes','cleaning','home_order'].includes(topic))topicAffinity=Math.max(topicAffinity,Math.log1p(Math.max(0,topics[topic as keyof AdviceTopicScores]??0))/(1+(recentTopics.get(topic)??0)));
  if(preferences.smart&&entry.categories.includes('kourotrophy'))affinity+=family();
  const rank:Rank=[lastShown.get(entry.id)??'',-Number(!!entry.schedule),-(affinity/(1+recent)+topicAffinity),-Number(preferences.smart&&!!entry.timeOfDay),-Number(entry.priority??false),await hash(input.seed+':'+entry.id)];current();
  if(!bestRank||before(rank,bestRank)){best=entry;bestRank=rank;}
 }
 return best?structuredClone(best):null;
}
