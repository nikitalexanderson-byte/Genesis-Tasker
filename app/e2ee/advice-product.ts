import {E2eeFeatureDocument,type FeatureDocumentPort} from './feature-document.ts';
import {E2eePrivateDocument} from './product-repository.ts';
import {requirePrivateAccount,type WebPrivateAccount} from './product-session.ts';
import {privatePreferences} from './preferences-product.ts';
import {PublicAdviceCatalogues,type AdviceCatalogueLanguage,type AdviceCatalogueText} from './advice-catalogue.ts';
import {publicAdviceMetadata,choosePrivateAdvice,adviceCollectionLimits,type AdviceCandidate,type AdviceSelectionHistory} from './advice-selection.ts';
import {adviceCardVisible,advicePreferences,ADVICE_CATEGORIES,ADVICE_TOPICS,type AdvicePreferences,type AdviceScores,type AdviceTopicScores,type DailyAdvice,type DailyAdviceResponse,type AdviceCollection} from '../daily-advice.ts';
import {normalizeAdviceMigrationResponse} from './advice-source.ts';
import {exactKeys,assertTechnical} from './keys.ts';
import {decodeE2eeBytes} from './envelope.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {isCivilDate} from '../calendar-context.ts';
import {canonicalJson} from '../aurora/forecast.ts';
import type {WireValue} from './commands.ts';

type Locator={dayKey:string;objectId:string;legacy:boolean};
type Index={protocol:1;ownerId:string;days:Locator[]};
type Reference={objectId:string;payloadHash:string};
type Entry={entry:AdviceCandidate;translations:Record<string,AdviceCatalogueText>|null;slot:number;createdAt:string;viewedAt:string|null;dismissedAt:string|null;reference:Reference|null};
type Day={protocol:1;ownerId:string;dayKey:string;currentId:string|null;selection:AdvicePreferences|null;entries:Entry[]};
type Issue={protocol:1;ownerId:string;scopeId:string;intentId:string;dayKey:string;slot:number;entry:AdviceCandidate;selection:AdvicePreferences};
type Policy={dayKey:string;serverNow:string;auroraLimit:number;restricted:boolean;settingsAllowed:boolean;legacy:{slot:number;collection:AdviceCollection}[];issues:({slot:number;collection:AdviceCollection}&Reference)[];checkpointHash:string;directoryRevision:number};
type Pending={protocol:1;ownerId:string;issue:Issue;result:Record<string,WireValue>|null;complete:boolean};
export interface AdviceProductPorts{
 ownerId:string;scopeId:string;mode:'online'|'offline';current:()=>void;
 preferences:()=>Promise<AdvicePreferences>;language:()=>AdviceCatalogueLanguage;publicBytes:(path:string)=>Promise<Uint8Array>;
 feature:<T>(id:string,validate:(value:unknown)=>T,seed:()=>Promise<T>)=>FeatureDocumentPort<T>;
 original:(id:string)=>Promise<unknown>;
 readPolicy:()=>Promise<unknown>;
 readIssue:(ref:Reference)=>Promise<unknown>;
 prepareIssue:(issue:Issue)=>Promise<Reference>;
 publishIssue:(issue:Issue,ref:Reference)=>Promise<Record<string,WireValue>>;
 localRead:(id:'advice-pending-v1'|'advice-policy-v1')=>Promise<{serial:number;value:unknown}|null>;
 localWrite:(id:'advice-pending-v1'|'advice-policy-v1',value:unknown,expected:number|null)=>Promise<void>;
 archivePending:(intentId:string,value:unknown)=>Promise<void>;
}
function invalid():never{throw new Error('E2EE_ADVICE_CONTENT_INVALID');}
function object(value:unknown):asserts value is Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))invalid();}
function integer(value:unknown,min=0,max=Number.MAX_SAFE_INTEGER):asserts value is number{if(!Number.isSafeInteger(value)||(value as number)<min||(value as number)>max)invalid();}
function date(value:unknown):asserts value is string{if(typeof value!=='string'||!isCivilDate(value))invalid();}
function time(value:unknown):asserts value is string{if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))invalid();}
function candidate(value:unknown):AdviceCandidate{
 object(value);const row=value as AdviceCandidate;
 normalizeAdviceMigrationResponse({dayKey:'2000-01-01',state:'ready',advice:{...Object.fromEntries(Object.entries(row).filter(([name])=>!['contentVersion','translationVersion','topics','schedule','status','timeOfDay','priority'].includes(name))),dayKey:'2000-01-01',dismissed:false}});
 if(!['aurora','philosophers'].includes(row.collection)||row.topics?.some(id=>!ADVICE_TOPICS.includes(id as typeof ADVICE_TOPICS[number])))invalid();return row;
}
function issue(value:unknown,ports:Pick<AdviceProductPorts,'ownerId'|'scopeId'>):Issue{
 exactKeys(value,['protocol','ownerId','scopeId','intentId','dayKey','slot','entry','selection']);if(value.protocol!==1||value.ownerId!==ports.ownerId||value.scopeId!==ports.scopeId)invalid();
 assertTechnical(value.intentId);date(value.dayKey);integer(value.slot,1,9);candidate(value.entry);object(value.selection);const selection=advicePreferences(value.selection);if(canonicalJson(selection)!==canonicalJson(value.selection))invalid();return value as Issue;
}
function reference(value:unknown):Reference{exactKeys(value,['objectId','payloadHash']);assertTechnical(value.objectId);if(!value.objectId.startsWith('advice-live:'))invalid();decodeE2eeBytes(value.payloadHash,32);return value as Reference;}
function policy(input:unknown):Policy{
 exactKeys(input,['dayKey','serverNow','auroraLimit','restricted','settingsAllowed','legacy','issues','checkpointHash','directoryRevision']);date(input.dayKey);time(input.serverNow);integer(input.auroraLimit,0,6);integer(input.directoryRevision,1);decodeE2eeBytes(input.checkpointHash,32);
 if(typeof input.restricted!=='boolean'||typeof input.settingsAllowed!=='boolean'||!Array.isArray(input.legacy)||!Array.isArray(input.issues)||input.legacy.length+input.issues.length>9)invalid();
 const seen=new Set<number>();for(const [rows,live]of [[input.legacy,false],[input.issues,true]] as const)for(const row of rows){exactKeys(row,live?['slot','collection','objectId','payloadHash']:['slot','collection']);integer(row.slot,1,9);if(seen.has(row.slot)||!['aurora','philosophers'].includes(String(row.collection)))invalid();seen.add(row.slot);if(live)reference({objectId:row.objectId,payloadHash:row.payloadHash});}
 if([...seen].sort((a,b)=>a-b).some((slot,index)=>slot!==index+1))invalid();return input as Policy;
}
/** Authentication of a stored product cell never resumes or grants an issue. */
export function inspectAdviceLocalCell(id:'advice-pending-v1'|'advice-policy-v1',input:unknown,ownerId:string,scopeId:string){
 if(id==='advice-policy-v1')return policy(input);
 exactKeys(input,['protocol','ownerId','issue','result','complete']);
 if(input.protocol!==1||input.ownerId!==ownerId||typeof input.complete!=='boolean')invalid();const value=issue(input.issue,{ownerId,scopeId});
 if(input.result!==null){object(input.result);const result=input.result;
  if(result.intentId!==value.intentId||result.dayKey!==value.dayKey||result.slot!==value.slot||result.collection!==value.entry.collection||result.objectId!=='advice-live:'+value.intentId)invalid();decodeE2eeBytes(result.payloadHash,32);}
 if(input.complete&&input.result===null)invalid();return input as unknown as Pending;
}
/** One common product engine for browser and the network-disabled native
 * runtime. Its ports expose domain content, never key material or arbitrary IO. */
export class E2eeAdviceProduct{
 #serial:Promise<unknown>=Promise.resolve();#index:FeatureDocumentPort<Index>;#days=new Map<string,FeatureDocumentPort<Day>>();#metadata:Promise<AdviceCandidate[]>|undefined;#catalogues:PublicAdviceCatalogues;
 constructor(private readonly ports:AdviceProductPorts){
  this.#catalogues=new PublicAdviceCatalogues(ports.publicBytes,ports.current);
  this.#index=ports.feature('personal-advice-live-index-v1',value=>this.#validateIndex(value),async()=>{const source=await ports.original('personal-advice-history-index-v1');exactKeys(source,['protocol','ownerId','days']);if(source.protocol!==1||source.ownerId!==ports.ownerId||!Array.isArray(source.days))invalid();
   return this.#validateIndex({protocol:1,ownerId:ports.ownerId,days:source.days.map(row=>{exactKeys(row,['dayKey','objectId']);return{...row,legacy:true};})});});
 }
 #run<T>(fn:()=>Promise<T>){const task=this.#serial.catch(()=>undefined).then(async()=>{this.ports.current();return fn();});this.#serial=task;return task;}
 #validateIndex(value:unknown):Index{exactKeys(value,['protocol','ownerId','days']);if(value.protocol!==1||value.ownerId!==this.ports.ownerId||!Array.isArray(value.days)||value.days.length>10000)invalid();const dates=new Set<string>(),objects=new Set<string>();
  for(const row of value.days){exactKeys(row,['dayKey','objectId','legacy']);date(row.dayKey);assertTechnical(row.objectId);if(typeof row.legacy!=='boolean'||dates.has(row.dayKey)||objects.has(row.objectId)||!row.objectId.startsWith(row.legacy?'personal-advice-day:':'personal-advice-live-day:'))invalid();dates.add(row.dayKey);objects.add(row.objectId);}return value as Index;}
 #validateDay(value:unknown,dayKey:string):Day{exactKeys(value,['protocol','ownerId','dayKey','currentId','selection','entries']);if(value.protocol!==1||value.ownerId!==this.ports.ownerId||value.dayKey!==dayKey||!Array.isArray(value.entries)||value.entries.length>9||value.currentId!==null&&typeof value.currentId!=='string')invalid();
  const seen=new Set<string>(),slots=new Set<number>();for(const row of value.entries){exactKeys(row,['entry','translations','slot','createdAt','viewedAt','dismissedAt','reference']);const entry=candidate(row.entry);integer(row.slot,1,9);time(row.createdAt);if(row.viewedAt!==null)time(row.viewedAt);if(row.dismissedAt!==null)time(row.dismissedAt);
   if(seen.has(entry.id)||slots.has(row.slot))invalid();seen.add(entry.id);slots.add(row.slot);if(row.reference!==null)reference(row.reference);if(row.translations!==null)object(row.translations);}
  if(value.currentId!==null&&!seen.has(value.currentId))invalid();if(value.selection!==null){object(value.selection);if(canonicalJson(advicePreferences(value.selection))!==canonicalJson(value.selection))invalid();}return value as Day;}
 async #locator(dayKey:string,create=false){const view=await this.#index.read();this.ports.current();if(view.conflict)throw new Error('E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED');let row=view.document.days.find(row=>row.dayKey===dayKey);
  if(!row&&create){row={dayKey,objectId:'personal-advice-live-day:'+crypto.randomUUID(),legacy:false};await this.#index.write({...view.document,days:[...view.document.days,row]});await this.#index.flush();}return row??null;}
 async #day(locator:Locator){let document=this.#days.get(locator.objectId);if(document)return document;const {ownerId}=this.ports;
  const id=locator.legacy?'personal-advice-live-day:'+locator.objectId.slice('personal-advice-day:'.length):locator.objectId;
  document=this.ports.feature(id,value=>this.#validateDay(value,locator.dayKey),async()=>{
   if(!locator.legacy)return{protocol:1,ownerId,dayKey:locator.dayKey,currentId:null,selection:null,entries:[]};
   const source=await this.ports.original(locator.objectId);exactKeys(source,['protocol','ownerId','dayKey','pointer','entries','extraEntries']);if(source.protocol!==1||source.ownerId!==ownerId||source.dayKey!==locator.dayKey||!Array.isArray(source.entries)||!Array.isArray(source.extraEntries))invalid();
   const raw=[...source.entries,...source.extraEntries] as Record<string,unknown>[];if(!raw.length&&source.pointer!==null)throw new Error('E2EE_ADVICE_HISTORY_REVIEW_REQUIRED');
   const entries:Entry[]=raw.map(row=>{object(row.entry);return{entry:candidate(row.entry),translations:row.translations as Entry['translations'],slot:row.slot as number,createdAt:row.createdAt as string,viewedAt:row.viewedAt as string|null,dismissedAt:row.dismissedAt as string|null,reference:null};}).sort((a,b)=>a.slot-b.slot);
   let currentId=entries.at(-1)?.entry.id??null,selection:AdvicePreferences|null=null;
   if(source.pointer!==null){const pointer=source.pointer;object(pointer);if(typeof pointer.adviceId==='string'&&entries.some(row=>row.entry.id===pointer.adviceId))currentId=pointer.adviceId;if(pointer.selection)selection=advicePreferences(pointer.selection as Partial<AdvicePreferences>);}
   return this.#validateDay({protocol:1,ownerId,dayKey:locator.dayKey,currentId,selection,entries},locator.dayKey);
  });this.#days.set(locator.objectId,document);return document;
 }
 async #readDay(locator:Locator){const document=await this.#day(locator),view=await document.read();this.ports.current();if(view.conflict)throw new Error('E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED');return{document,view};}
 async #policy(){const prior=await this.ports.localRead('advice-policy-v1');this.ports.current();if(this.ports.mode==='offline'){if(!prior)throw new Error('E2EE_OFFLINE_CONTENT_UNAVAILABLE');return policy(prior.value);}
  const value=policy(await this.ports.readPolicy());this.ports.current();await this.ports.localWrite('advice-policy-v1',value,prior?.serial??null);return value;}
 async #sync(day:Day,policy:Policy){let changed=false;
  for(const ref of policy.issues){const existing=day.entries.find(row=>row.slot===ref.slot);if(existing){if(existing.reference?.objectId!==ref.objectId||existing.reference.payloadHash!==ref.payloadHash)invalid();continue;}
   const value=issue(await this.ports.readIssue(ref),this.ports);this.ports.current();if(value.dayKey!==day.dayKey||value.slot!==ref.slot||value.entry.collection!==ref.collection||ref.objectId!=='advice-live:'+value.intentId)invalid();
   day.entries.push({entry:value.entry,translations:null,slot:value.slot,createdAt:policy.serverNow,viewedAt:null,dismissedAt:null,reference:{objectId:ref.objectId,payloadHash:ref.payloadHash}});day.currentId=value.entry.id;day.selection??=value.selection;changed=true;
  }
  for(const legacy of policy.legacy){const row=day.entries.find(row=>row.slot===legacy.slot);if(!row||row.reference!==null||row.entry.collection!==legacy.collection)throw new Error('E2EE_ADVICE_HISTORY_REVIEW_REQUIRED');}
  day.entries.sort((a,b)=>a.slot-b.slot);return changed;
 }
 async #preferences(){const value=advicePreferences(await this.ports.preferences());this.ports.current();return value;}
 async #render(row:Entry,day:string,language=this.ports.language()):Promise<DailyAdvice>{let entry={...row.entry};
  const version=entry.translationVersion??entry.contentVersion;if(version){const text=row.translations?.[language]??await this.#catalogues.resolve(entry.translationVersion?'philosophers':'daily',version,language,entry.id);this.ports.current();entry={...entry,...text,language} as AdviceCandidate;}
  const {contentVersion:_contentVersion,translationVersion:_translationVersion,topics:_topics,schedule:_schedule,status:_status,timeOfDay:_timeOfDay,priority:_priority,...visible}=entry;void [_contentVersion,_translationVersion,_topics,_schedule,_status,_timeOfDay,_priority];
  return{...visible,dayKey:day,dismissed:row.dismissedAt!==null,sequence:row.slot};
 }
 async #context(day:Day,prefs:AdvicePreferences,policy:Policy,scores:AdviceScores,topics:AdviceTopicScores,advance:boolean){
  this.#metadata??=publicAdviceMetadata(this.ports.publicBytes,this.ports.current);const items=await this.#metadata;this.ports.current();const history:AdviceSelectionHistory[]=[];
  const index=await this.#index.read();if(index.conflict)throw new Error('E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED');
  for(const locator of [...index.document.days].sort((a,b)=>b.dayKey.localeCompare(a.dayKey))){const value=locator.dayKey===day.dayKey?day:(await this.#readDay(locator)).view.document;
   for(const row of [...value.entries].sort((a,b)=>b.slot-a.slot))if(row.viewedAt)history.push({dayKey:locator.dayKey,entry:row.entry});}
  let selected=day.selection??prefs;selected={...selected,aphrodisiaAdult:prefs.aphrodisiaAdult,psychopompia:prefs.psychopompia,collections:prefs.collections,philosophersPerDay:prefs.philosophersPerDay};if(policy.restricted)selected=prefs;
  if(!policy.settingsAllowed)selected={...selected,smart:true,categories:ADVICE_CATEGORIES.filter(id=>!['aphrodisia','psychopompia'].includes(id)),aphrodisiaAdult:null};
  const limits=adviceCollectionLimits(items,selected,policy.auroraLimit),counts={aurora:0,philosophers:0};for(const row of day.entries)counts[row.entry.collection]++;
  const exhausted=(['aurora','philosophers'] as const).filter(source=>counts[source]>=limits[source]),timeZone=prefs.notifications.timeZone;
  const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone,hour:'2-digit',hourCycle:'h23'}).format(new Date(policy.serverNow))),previous=day.entries.find(row=>row.entry.id===day.currentId);
  const chosen=await choosePrivateAdvice({items,preferences:selected,scores,topics,history,issuedToday:day.entries.map(row=>row.entry),day:day.dayKey,timeZone,hour,seed:this.ports.ownerId+':'+day.dayKey+':'+day.entries.length,
   ownerId:this.ports.ownerId,excludedCollections:exhausted,restricted:policy.restricted,...(advance&&previous?{previousCategories:previous.entry.categories}:{}),reservePhilosopher:limits.philosophers>0&&counts.philosophers===0},this.ports.current);
  return{chosen,limits,selected,previous,hour};
 }
 async #pending(){const row=await this.ports.localRead('advice-pending-v1');this.ports.current();if(!row)return null;
  const value=inspectAdviceLocalCell('advice-pending-v1',row.value,this.ports.ownerId,this.ports.scopeId) as Pending;return{serial:row.serial,value};}
 async #finish(value:Pending,serial:number){if(value.complete)return;const prepared=await this.ports.prepareIssue(value.issue);this.ports.current();const result=value.result??await this.ports.publishIssue(value.issue,prepared);this.ports.current();
  if(result.intentId!==value.issue.intentId||result.dayKey!==value.issue.dayKey||result.slot!==value.issue.slot||result.collection!==value.issue.entry.collection||result.objectId!==prepared.objectId||result.payloadHash!==prepared.payloadHash)invalid();
  if(!value.result){value.result=result;await this.ports.localWrite('advice-pending-v1',value,serial);serial++;}
  const locator=await this.#locator(value.issue.dayKey,true),{document,view}=await this.#readDay(locator!),day=view.document,existing=day.entries.find(row=>row.slot===value.issue.slot);
  if(existing){if(existing.reference?.objectId!==prepared.objectId||existing.reference.payloadHash!==prepared.payloadHash)invalid();}
  else{day.entries.push({entry:value.issue.entry,translations:null,slot:value.issue.slot,createdAt:new Date().toISOString(),viewedAt:null,dismissedAt:null,reference:prepared});day.currentId=value.issue.entry.id;day.selection??=value.issue.selection;await document.write(day);await document.flush();}
  value.complete=true;await this.ports.localWrite('advice-pending-v1',value,serial);
 }
 today(scores:AdviceScores,topics:AdviceTopicScores|undefined,from?:{id:string;dayKey:string}){return this.#run(async():Promise<DailyAdviceResponse>=>{
  const bounded=(source:unknown,names:readonly string[])=>{const result:Record<string,number>={};if(source!==undefined){object(source);if(Object.keys(source).some(key=>!names.includes(key)))invalid();}
   for(const name of names){const value=(source as Record<string,unknown>|undefined)?.[name]??0;if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1000)invalid();result[name]=value;}return result;};
  const safeScores=bounded(scores,ADVICE_CATEGORIES) as AdviceScores,safeTopics=bounded(topics,ADVICE_TOPICS) as AdviceTopicScores;
  const prefs=await this.#preferences(),current=await this.#policy();if(!prefs.enabled)return{dayKey:current.dayKey,state:'disabled',advice:null,history:[],canNext:false};
  const locator=await this.#locator(current.dayKey,true),{document,view}=await this.#readDay(locator!),day=view.document;
  if(await this.#sync(day,current)){await document.write(day);await document.flush();}
  const advance=!!from&&from.id===day.currentId&&from.dayKey===day.dayKey;
  const context=await this.#context(day,prefs,current,safeScores,safeTopics,advance),limit=Math.max(1,Math.min(9,context.limits.aurora+context.limits.philosophers));
  let previous=day.entries.find(row=>row.entry.id===day.currentId),visible=previous?adviceCardVisible({...await this.#render(previous,day.dayKey),dismissed:false},prefs):false,issued=false;
  const timeChanged=previous&&prefs.smart&&(previous.entry.timeOfDay==='morning'?(context.hour<5||context.hour>=12):previous.entry.timeOfDay==='evening'?(context.hour>=5&&context.hour<18):false);
  if((!previous||advance||!visible||timeChanged)&&context.chosen&&day.entries.length<limit&&this.ports.mode==='online'){
   const prior=await this.#pending();if(prior&&!prior.value.complete)throw new Error('E2EE_ADVICE_PENDING_RETRY_REQUIRED');if(prior)await this.ports.archivePending(prior.value.issue.intentId,prior.value);
   if(advance&&previous&&!previous.viewedAt){previous.viewedAt=new Date().toISOString();await document.write(day);await document.flush();}
   const item:Issue={protocol:1,ownerId:this.ports.ownerId,scopeId:this.ports.scopeId,intentId:crypto.randomUUID(),dayKey:day.dayKey,slot:day.entries.length+1,entry:context.chosen,selection:context.selected};
   const pending:Pending={protocol:1,ownerId:this.ports.ownerId,issue:item,result:null,complete:false};await this.ports.localWrite('advice-pending-v1',pending,prior?.serial??null);await this.#finish(pending,(prior?.serial??0)+1);
   const next=await document.read();if(next.conflict)throw new Error('E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED');Object.assign(day,next.document);previous=day.entries.find(row=>row.entry.id===day.currentId);visible=!!previous;issued=true;
  }
  const history:DailyAdvice[]=[];for(const row of day.entries){const card=await this.#render(row,day.dayKey);if(adviceCardVisible(card,prefs))history.push(card);}
  const advice=previous&&visible?await this.#render(previous,day.dayKey):null,remaining=Math.max(0,limit-day.entries.length);
  const nextChoice=issued&&remaining>0?(await this.#context(day,prefs,current,safeScores,safeTopics,true)).chosen:context.chosen;
  return{dayKey:day.dayKey,state:advice?'ready':'no-match',advice,history,sequence:day.entries.length,dailyLimit:limit,remaining,canNext:!!advice&&!advice.dismissed&&remaining>0&&!!nextChoice};
 });}
 record(id:string,dayKey:string,dismiss=false){return this.#run(async()=>{const locator=await this.#locator(dayKey);if(!locator)throw new Error('E2EE_ADVICE_NOT_FOUND');const {document,view}=await this.#readDay(locator),row=view.document.entries.find(row=>row.entry.id===id);if(!row)throw new Error('E2EE_ADVICE_NOT_FOUND');row.viewedAt??=new Date().toISOString();if(dismiss)row.dismissedAt??=new Date().toISOString();await document.write(view.document);await document.flush();return{ok:true as const};});}
 saved(id:string,dayKey:string,collection:AdviceCollection){return this.#run(async():Promise<DailyAdviceResponse>=>{date(dayKey);const locator=await this.#locator(dayKey);if(!locator)throw new Error('E2EE_ADVICE_NOT_FOUND');const {view}=await this.#readDay(locator),row=view.document.entries.find(row=>row.entry.id===id&&row.entry.collection===collection);if(!row)throw new Error('E2EE_ADVICE_NOT_FOUND');
  const prefs=await this.#preferences(),advice=await this.#render(row,dayKey),visible=adviceCardVisible(advice,prefs);return{dayKey,state:visible?'ready':'no-match',advice:visible?advice:null,history:visible?[advice]:[],sequence:row.slot,dailyLimit:Math.max(1,view.document.entries.length),remaining:0,canNext:false};});}
 resume(){return this.#run(async()=>{const prior=await this.#pending();if(!prior)throw new Error('E2EE_PENDING_SAVE_REQUIRED');await this.#finish(prior.value,prior.serial);});}
 hasPending(){return this.#run(async()=>{const prior=await this.#pending();return !!prior&&!prior.value.complete;});}
}

export function webAdviceProduct(account:WebPrivateAccount,language:()=>AdviceCatalogueLanguage,publicBytes:AdviceProductPorts['publicBytes']){
 const current=()=>{account.requireOpen();if(requirePrivateAccount(account.ownerId)!==account)throw new Error('E2EE_ACCOUNT_CHANGED');},encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
 const {client,directory}=account.personal();
 const version=(objectId:string)=>new E2eePrivateDocument<Issue>({device:account.device,client,scopeId:directory.scopeId,domain:'workspace',objectId,validate:value=>issue(value,{ownerId:account.ownerId,scopeId:directory.scopeId}),assertCurrent:current,assertWrite:current});
 return new E2eeAdviceProduct({ownerId:account.ownerId,scopeId:directory.scopeId,mode:account.mode,current,language,publicBytes,
  preferences:async()=>(await privatePreferences(account.ownerId).read()).advicePreferences,
  feature:(id,validate,seed)=>new E2eeFeatureDocument({ownerId:account.ownerId,domain:'workspace',objectId:id,validate,seed}),
  original:async id=>{const row=await client.read('workspace',id);current();if(!row)throw new Error('E2EE_PRIVATE_SEED_REQUIRED');try{return parseLegacyMigrationJson(decoder.decode(row.bytes),'E2EE_ADVICE_CONTENT_INVALID',16*1024*1024);}finally{row.bytes.fill(0);}},
  readPolicy:()=>client.readAdvicePolicy(),
  readIssue:async ref=>{if(account.mode==='online')await client.assertObjectReference('workspace',ref.objectId,1,ref.payloadHash);const view=await version(ref.objectId).load(account.mode);if(view.pending||view.conflict||view.remoteRevision!==1)invalid();return view.value;},
  prepareIssue:async value=>{const objectId='advice-live:'+value.intentId,document=version(objectId);let view;
   try{view=await document.load(account.mode);}catch(error){if(!(error instanceof Error)||error.message!=='E2EE_PRIVATE_DOCUMENT_MISSING')throw error;await document.save(value,{serial:null,remoteRevision:0});view=await document.load('offline');}
   if(view.conflict||view.remoteRevision>1||canonicalJson(view.value)!==canonicalJson(value))invalid();if(view.pending)await document.flush();const ref=await client.objectReference('workspace',objectId);return{objectId,payloadHash:ref.payloadHash};},
  publishIssue:(value,ref)=>client.executeService('advice-issue',{dayKey:value.dayKey,collection:value.entry.collection,expectedCount:value.slot-1,...ref},value.intentId),
  localRead:async id=>{const row=await account.device.vault.read('outbox',id);current();if(!row)return null;try{return{serial:row.serial,value:parseLegacyMigrationJson(decoder.decode(row.value),'E2EE_ADVICE_CONTENT_INVALID',16*1024*1024)};}finally{row.value.fill(0);}},
  localWrite:async(id,value,expected)=>{const bytes=encoder.encode(JSON.stringify(value));try{await account.device.vault.write([{domain:'outbox',objectId:id,value:bytes,expected}]);current();if(id==='advice-pending-v1'&&typeof window!=='undefined')window.dispatchEvent(new Event('genesis-private-pending-change'));}finally{bytes.fill(0);}},
  archivePending:async(id,value)=>{assertTechnical(id);const objectId='advice-history:'+id,prior=await account.device.vault.read('local-snapshot',objectId);if(prior){try{if(canonicalJson(JSON.parse(decoder.decode(prior.value)))!==canonicalJson(value))invalid();return;}finally{prior.value.fill(0);}}
   const bytes=encoder.encode(JSON.stringify(value));try{await account.device.vault.write([{domain:'local-snapshot',objectId,value:bytes,expected:null}]);}finally{bytes.fill(0);}}
 });
}
