import {requirePrivateAccount,type WebPrivateAccount} from './product-session.ts';
import {E2eePrivateDocument} from './product-repository.ts';
import {assertTechnical,exactKeys} from './keys.ts';
import {decodeE2eeBytes} from './envelope.ts';
import {expectedSourceDraw} from '../aurora/draw-policy.ts';
import {isCivilDate} from '../calendar-context.ts';
import type {StoicheionDrawKind,StoicheionDrawRecord,StoicheionTimelineRecord} from '../cloud-sync.ts';
import type {WireValue} from './commands.ts';

type Card={cardId:string;reversed:boolean};
type Reference={objectId:string;payloadHash:string};
type Head={kind:StoicheionDrawKind;dayKey:string;periodKey:string;revision:number;firstDrawAt:string;legacy:boolean;reference:Reference|null;
 attempts?:1|2;cardRevision?:number;rerollDeadline?:string;remainingSeconds?:number;canReroll?:boolean;unlimited?:boolean;cards?:StoicheionTimelineRecord['cards']};
type State={dayKey:string;serverNow:string;draws:Partial<Record<'daily'|'spread',Head>>;timeline:Head|null;testingAccess:boolean;unlimitedDraws:boolean;periods:Record<StoicheionDrawKind,string>;checkpointHash:string;directoryRevision:number};
type Content={protocol:1;ownerId:string;scopeId:string;intentId:string;kind:StoicheionDrawKind;action:'draw'|'spread-card'|'reveal'|'reroll';periodKey:string;expectedRevision:number;seed:number;cards:Card[]|null};
type Job={protocol:1;ownerId:string;kind:StoicheionDrawKind;content:Content;position:number|null;complete:boolean;result:Record<string,WireValue>|null};
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true}),ids=new Set(expectedSourceDraw(0,24).map(row=>row.cardId));
function invalid():never{throw new Error('E2EE_STOICHEION_CONTENT_INVALID');}
function integer(value:unknown,min=0,max=Number.MAX_SAFE_INTEGER):asserts value is number{if(!Number.isSafeInteger(value)||(value as number)<min||(value as number)>max)invalid();}
function date(value:unknown):asserts value is string{if(typeof value!=='string'||!isCivilDate(value))invalid();}
function time(value:unknown):asserts value is string{if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))invalid();}
function cardList(value:unknown):asserts value is Card[]{if(!Array.isArray(value)||value.length!==9||new Set(value.map(row=>row.cardId)).size!==9)invalid();for(const row of value){exactKeys(row,['cardId','reversed']);if(!ids.has(row.cardId as string)||typeof row.reversed!=='boolean')invalid();}}
function content(value:unknown,ownerId:string,scopeId:string):Content{
 exactKeys(value,['protocol','ownerId','scopeId','intentId','kind','action','periodKey','expectedRevision','seed','cards']);
 if(value.protocol!==1||value.ownerId!==ownerId||value.scopeId!==scopeId||!['daily','spread','timeline'].includes(String(value.kind))||!['draw','spread-card','reveal','reroll'].includes(String(value.action)))invalid();
 assertTechnical(value.intentId);date(value.periodKey);integer(value.expectedRevision);integer(value.seed,0,0xffffffff);
 if(value.kind==='spread')cardList(value.cards);else if(value.cards!==null)invalid();return value as Content;
}
/** Read-only custody uses the same content parser as the live job reader. */
export function inspectStoicheionLocalJob(input:unknown,ownerId:string,scopeId:string,kind:StoicheionDrawKind){
 exactKeys(input,['protocol','ownerId','kind','content','position','complete','result']);
 if(input.protocol!==1||input.ownerId!==ownerId||input.kind!==kind||typeof input.complete!=='boolean')invalid();
 const value=content(input.content,ownerId,scopeId);
 if(input.position!==null)integer(input.position,0,8);
 if(input.result!==null){if(!input.result||typeof input.result!=='object'||Array.isArray(input.result))invalid();
  exactKeys(input.result,['intentId','kind','head']);if(input.result.intentId!==value.intentId||input.result.kind!==kind)invalid();head(input.result.head,kind);}
 if(input.complete&&input.result===null)invalid();return input as unknown as Job;
}
function head(value:unknown,kind:StoicheionDrawKind):Head{
 if(!value||typeof value!=='object'||Array.isArray(value))invalid();const row=value as Head;
 if(row.kind!==kind||typeof row.legacy!=='boolean'||row.legacy!==(row.reference===null))invalid();date(row.dayKey);date(row.periodKey);time(row.firstDrawAt);integer(row.revision,1);
 if(row.reference!==null){exactKeys(row.reference,['objectId','payloadHash']);assertTechnical(row.reference.objectId);if(!row.reference.objectId.startsWith('stoicheion-live:'))invalid();decodeE2eeBytes(row.reference.payloadHash,32);}
 if(kind==='timeline'){if(!Array.isArray(row.cards)||row.cards.length>3)invalid();for(const [index,card]of row.cards.entries()){if(card.position!==index||typeof card.rerolled!=='boolean'||typeof card.canReroll!=='boolean'||typeof card.unlimited!=='boolean')invalid();time(card.firstRevealedAt);time(card.rerollDeadline);integer(card.remainingSeconds,0,180);}}
 else{if(![1,2].includes(row.attempts as number)||typeof row.canReroll!=='boolean'||typeof row.unlimited!=='boolean')invalid();integer(row.cardRevision);integer(row.remainingSeconds,0,180);time(row.rerollDeadline);}
 return row;
}
function state(input:unknown):State{
 exactKeys(input,['dayKey','serverNow','draws','timeline','testingAccess','unlimitedDraws','periods','checkpointHash','directoryRevision']);date(input.dayKey);time(input.serverNow);integer(input.directoryRevision,1);decodeE2eeBytes(input.checkpointHash,32);
 if(typeof input.testingAccess!=='boolean'||typeof input.unlimitedDraws!=='boolean'||!input.draws||typeof input.draws!=='object'||Array.isArray(input.draws))invalid();
 for(const [kind,value]of Object.entries(input.draws)){if(!['daily','spread'].includes(kind))invalid();head(value,kind as 'daily'|'spread');}
 if(input.timeline!==null)head(input.timeline,'timeline');exactKeys(input.periods,['daily','spread','timeline']);for(const value of Object.values(input.periods))date(value);return input as State;
}
/** Live draw data stays client encrypted. The separate signed service commit
 * activates exactly one uploaded immutable version under fresh server limits.
 * Migrated history is readable content and cannot grant a new draw/reroll. */
export class E2eeStoicheionProduct{
 #serial:Promise<unknown>=Promise.resolve();
 constructor(private readonly account:WebPrivateAccount){}
 #current(){this.account.requireOpen();if(requirePrivateAccount(this.account.ownerId)!==this.account)throw new Error('E2EE_ACCOUNT_CHANGED');}
 #run<T>(operation:()=>Promise<T>){const task=this.#serial.catch(()=>undefined).then(async()=>{this.#current();return operation();});this.#serial=task;return task;}
 #key(){return`stoicheion-state:${this.account.personal().directory.scopeId}`;}
 #document(objectId:string){const account=this.account,{client,directory}=account.personal();return new E2eePrivateDocument<Content>({device:account.device,client,scopeId:directory.scopeId,domain:'stoicheion',objectId,
  validate:value=>content(value,account.ownerId,directory.scopeId),assertCurrent:()=>this.#current(),assertWrite:()=>this.#current()});}
 async #state(){this.#current();const old=await this.account.device.vault.read('key-check',this.#key());
  try{if(this.account.mode==='offline'){if(!old)throw new Error('E2EE_OFFLINE_CONTENT_UNAVAILABLE');return state(JSON.parse(decoder.decode(old.value)));}
   const value=state(await this.account.personal().client.readStoicheionState());this.#current();const bytes=encoder.encode(JSON.stringify(value));try{await this.account.device.vault.write([{domain:'key-check',objectId:this.#key(),value:bytes,expected:old?.serial??null}]);}finally{bytes.fill(0);}return value;
  }finally{old?.value.fill(0);}
 }
 async #legacy(row:Head):Promise<{seed:number;cards:Card[]|null}>{
  const account=this.account,{client,directory}=account.personal(),document=new E2eePrivateDocument<Record<string,unknown>>({device:account.device,client,scopeId:directory.scopeId,domain:'stoicheion',objectId:'personal-stoicheion-draw-history-v1',
   validate:value=>{exactKeys(value,['protocol','ownerId','server','device']);if(value.protocol!==1||value.ownerId!==account.ownerId)invalid();return value;},assertCurrent:()=>this.#current(),assertWrite:()=>this.#current()});
  const view=await document.load(account.mode);this.#current();if(view.pending||view.conflict)throw new Error('E2EE_STOICHEION_HISTORY_REVIEW_REQUIRED');
  const source=view.value.server as {draws:{kind:string;dayKey:string;seed:number}[];spreadCards:{dayKey:string;sourceSeed:number;revision:number;cards:Card[]}[];timelineSessions:{periodKey:string;seed:number}[]};
  const draw=row.kind==='timeline'?source.timelineSessions.find(item=>item.periodKey===row.periodKey)??source.draws.find(item=>item.kind==='timeline'&&item.dayKey===row.dayKey):source.draws.find(item=>item.kind===row.kind&&item.dayKey===row.dayKey);
  if(!draw)throw new Error('E2EE_PRIVATE_SEED_REQUIRED');integer(draw.seed,0,0xffffffff);
  const spread=row.kind==='spread'?source.spreadCards.find(item=>item.dayKey===row.dayKey&&item.sourceSeed===draw.seed):null;
  if(row.kind==='spread'&&(spread?.revision??0)!==row.cardRevision)throw new Error('E2EE_STOICHEION_HISTORY_REVIEW_REQUIRED');
  const cards=row.kind==='spread'?(spread?.cards??expectedSourceDraw(draw.seed)):null;if(cards)cardList(cards);return{seed:draw.seed,cards};
 }
 async #open(row:Head){if(row.legacy)return this.#legacy(row);const ref=row.reference!;const {client}=this.account.personal();
  if(this.account.mode==='online')await client.assertObjectReference('stoicheion',ref.objectId,1,ref.payloadHash);this.#current();
  const view=await this.#document(ref.objectId).load(this.account.mode);this.#current();const value=view.value;
  if(view.pending||view.conflict||view.remoteRevision!==1||ref.objectId!==`stoicheion-live:${value.intentId}`||value.kind!==row.kind||value.periodKey!==row.periodKey||value.expectedRevision+1!==row.revision)invalid();return{seed:value.seed,cards:value.cards};
 }
 async #draw(row:Head):Promise<StoicheionDrawRecord>{const value=await this.#open(row);return{kind:row.kind,dayKey:row.dayKey,seed:value.seed,attempts:row.attempts!,firstDrawAt:row.firstDrawAt,rerollDeadline:row.rerollDeadline!,remainingSeconds:row.remainingSeconds!,canReroll:row.canReroll!,unlimited:row.unlimited,cardRevision:row.cardRevision,...(value.cards?{cards:value.cards}:{})};}
 async #timeline(row:Head):Promise<StoicheionTimelineRecord>{const value=await this.#open(row);return{dayKey:row.dayKey,periodKey:row.periodKey,seed:value.seed,revision:row.revision,firstDrawAt:row.firstDrawAt,cards:row.cards!};}
 loadDraws(){return this.#run(async()=>{const current=await this.#state(),draws:Partial<Record<StoicheionDrawKind,StoicheionDrawRecord>>={};for(const kind of ['daily','spread'] as const)if(current.draws[kind])draws[kind]=await this.#draw(current.draws[kind]);
  return{dayKey:current.dayKey,draws,testingAccess:current.testingAccess,unlimitedDraws:current.unlimitedDraws};});}
 loadTimeline(){return this.#run(async()=>{const current=await this.#state();return{timeline:current.timeline?await this.#timeline(current.timeline):null,serverNow:current.serverNow};});}
 async #saveJob(job:Job,serial:number|null){const bytes=encoder.encode(JSON.stringify(job));try{await this.account.device.vault.write([{domain:'outbox',objectId:`stoicheion-job:${job.kind}`,value:bytes,expected:serial}]);this.#current();if(typeof window!=='undefined')window.dispatchEvent(new Event('genesis-private-pending-change'));}finally{bytes.fill(0);}return(serial??0)+1;}
 async #pending(kind:StoicheionDrawKind){const row=await this.account.device.vault.read('outbox',`stoicheion-job:${kind}`);this.#current();if(!row)return null;
  try{const value=inspectStoicheionLocalJob(JSON.parse(decoder.decode(row.value)),this.account.ownerId,this.account.personal().directory.scopeId,kind);return{job:value,serial:row.serial};}finally{row.value.fill(0);}}
 async #finish(job:Job,serial:number){if(job.complete)return job.result!;if(this.account.mode!=='online')throw new Error('E2EE_ONLINE_REQUIRED');const objectId=`stoicheion-live:${job.content.intentId}`,document=this.#document(objectId);
  let view;try{view=await document.load('online');}catch(error){if(!(error instanceof Error)||error.message!=='E2EE_PRIVATE_DOCUMENT_MISSING')throw error;await document.save(job.content,{serial:null,remoteRevision:0});view=await document.load('offline');}
  if(view.conflict||JSON.stringify(view.value)!==JSON.stringify(job.content)||view.remoteRevision>1)throw new Error('E2EE_STOICHEION_CONTENT_INVALID');if(view.pending)await document.flush();
  const ref=await this.account.personal().client.objectReference('stoicheion',objectId);this.#current();const value=job.content;
  const result=await this.account.personal().client.executeService('stoicheion-grant',{kind:job.kind,action:value.action,position:job.position,expectedRevision:value.expectedRevision,periodKey:value.periodKey,objectId,payloadHash:ref.payloadHash},value.intentId);this.#current();
  if(result.intentId!==value.intentId||result.kind!==job.kind)invalid();const committed=head(result.head,job.kind);if(committed.reference?.objectId!==objectId||committed.reference.payloadHash!==ref.payloadHash||committed.revision!==value.expectedRevision+1)invalid();
  const prior=await this.account.device.vault.read('key-check',this.#key());
  try{if(prior){const value=state(JSON.parse(decoder.decode(prior.value)));if(job.kind==='timeline')value.timeline=committed;else value.draws[job.kind]=committed;value.serverNow=result.serverNow as string;
   const bytes=encoder.encode(JSON.stringify(value));try{await this.account.device.vault.write([{domain:'key-check',objectId:this.#key(),value:bytes,expected:prior.serial}]);}finally{bytes.fill(0);}}}finally{prior?.value.fill(0);}
  job.result=result;job.complete=true;await this.#saveJob(job,serial);return result;
 }
 #mutate(kind:StoicheionDrawKind,action:Content['action'],position:number|null,seed?:number,expected?:{revision?:number;cardRevision?:number;seed?:number;dayKey?:string}){return this.#run(async()=>{
  if(this.account.mode!=='online')throw new Error('E2EE_ONLINE_REQUIRED');const pending=await this.#pending(kind);if(pending&&!pending.job.complete)throw new Error('E2EE_STOICHEION_PENDING_RETRY_REQUIRED');
  const current=await this.#state(),prior=kind==='timeline'?current.timeline:current.draws[kind],opened=prior?await this.#open(prior):null;
  if(expected&&(expected.revision!==undefined&&expected.revision!==(prior?.revision??0)||expected.cardRevision!==undefined&&expected.cardRevision!==(prior?.cardRevision??0)||expected.seed!==undefined&&expected.seed!==opened?.seed||expected.dayKey!==undefined&&expected.dayKey!==prior?.dayKey))throw new Error('E2EE_STOICHEION_STALE');
  if(kind==='timeline'&&action==='reveal'&&prior?.cards?.[position!])return{head:prior,serverNow:current.serverNow};
  let nextSeed=seed??crypto.getRandomValues(new Uint32Array(1))[0],cards:Card[]|null=kind==='spread'?expectedSourceDraw(nextSeed):null;
  if(action==='spread-card'){if(!opened?.cards||position===null||position<0||position>8)invalid();nextSeed=opened.seed;cards=structuredClone(opened.cards);const pool=[...ids].filter(id=>!cards!.some(card=>card.cardId===id));cards[position]={cardId:pool[crypto.getRandomValues(new Uint32Array(1))[0]%pool.length],reversed:crypto.getRandomValues(new Uint8Array(1))[0]<128};}
  if(kind==='timeline'&&opened){nextSeed=opened.seed;if(action==='reroll'){
   const held=expectedSourceDraw(opened.seed,3);let found=false;
   for(let attempt=0;attempt<100000;attempt++){const candidate=crypto.getRandomValues(new Uint32Array(1))[0],draw=expectedSourceDraw(candidate,3);if(draw[position!].cardId!==held[position!].cardId&&draw.every((card,index)=>index===position||card.cardId===held[index].cardId&&card.reversed===held[index].reversed)){nextSeed=candidate;found=true;break;}}
   if(!found)throw new Error('E2EE_STOICHEION_RANDOM_UNAVAILABLE');}}
  integer(nextSeed,0,0xffffffff);const value:Content={protocol:1,ownerId:this.account.ownerId,scopeId:this.account.personal().directory.scopeId,intentId:crypto.randomUUID(),kind,action,periodKey:current.periods[kind],expectedRevision:prior?.revision??0,seed:nextSeed,cards};
  const job:Job={protocol:1,ownerId:this.account.ownerId,kind,content:value,position,complete:false,result:null};
  // Retain the entire prior operation before replacing its current locator.
  if(pending){const bytes=encoder.encode(JSON.stringify(pending.job));try{await this.account.device.vault.write([{domain:'local-snapshot',objectId:`stoicheion-history:${pending.job.content.intentId}`,value:bytes,expected:null}]);}finally{bytes.fill(0);}}
  const serial=await this.#saveJob(job,pending?.serial??null);return this.#finish(job,serial);
 });}
 async saveDraw(kind:StoicheionDrawKind,seed:number){if(kind==='timeline')throw new Error('TIMELINE_CARD_PROTOCOL_REQUIRED');const result=await this.#mutate(kind,'draw',null,seed);return{draw:await this.#draw(head(result.head,kind))};}
 async spreadCard(draw:StoicheionDrawRecord,position:number){const result=await this.#mutate('spread','spread-card',position,undefined,{cardRevision:draw.cardRevision??0,seed:draw.seed,dayKey:draw.dayKey});return{draw:await this.#draw(head(result.head,'spread'))};}
 async timelineCard(position:number,action:'reveal'|'reroll',revision:number){integer(position,0,2);const result=await this.#mutate('timeline',action,position,undefined,{revision});return{timeline:await this.#timeline(head(result.head,'timeline')),serverNow:result.serverNow as string};}
 resume(kind:StoicheionDrawKind){return this.#run(async()=>{const pending=await this.#pending(kind);if(!pending)throw new Error('E2EE_PENDING_SAVE_REQUIRED');return this.#finish(pending.job,pending.serial);});}
 pending(){return this.#run(async()=>{const result:StoicheionDrawKind[]=[];for(const kind of ['daily','spread','timeline'] as const){const row=await this.#pending(kind);if(row&&!row.job.complete)result.push(kind);}return result;});}
}
