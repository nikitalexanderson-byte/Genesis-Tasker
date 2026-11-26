import {assertTechnical,exactKeys} from './keys.ts';
import {decodeE2eeBytes} from './envelope.ts';
import type {PrivatePathAdapter} from './migration-sources.ts';
import type {MigrationSourceContext,MigrationContent} from './migration.ts';
import {EncryptedPendingJournal} from '../encrypted-pending-journal.ts';
import {backupJson} from '../backup-format.ts';
import {canonicalJson} from '../aurora/forecast.ts';
import {expectedSourceDraw} from '../aurora/draw-policy.ts';
import {STOICHEION_LETTERS} from '../stoicheion-data.ts';
import {isCivilDate} from '../calendar-context.ts';
import {stoicheionWeekStart} from '../stoicheion-timeline.ts';
import {mergeRestorationDocuments} from '../stoicheion-restoration-merge.ts';
import {validateRestorationDocument,type RestorationDocument} from '../stoicheion-restoration-work.ts';

const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true}),MAX=16*1024*1024;
type Row=Record<string,unknown>;
export type StoicheionMigrationMemory={ownerId:string;legacyKey:string;generation:number;reconciliationRequired:boolean;
  current:{document:RestorationDocument;base:RestorationDocument;revision:number}|null;
  draws:unknown[];timeline:unknown|null;nativeDraws:unknown|null};
type Snapshot={protocol:1;ownerId:string;scopeId:string;capturedAt:string;memory:StoicheionMigrationMemory;entries:{key:string;value:string}[]};
export type StoicheionSourcePorts={storage:Pick<Storage,'getItem'|'key'|'length'>;memory:()=>StoicheionMigrationMemory;assertCurrent:()=>void;
  legacyStoicheion:(context:MigrationSourceContext)=>Promise<unknown>;
  /** Native authenticates historical envelopes without sharing any key. */
  openLegacy?:(envelope:{iv:string;ciphertext:string},purpose:string)=>Promise<unknown>};
function invalid():never{throw new Error('E2EE_STOICHEION_SOURCE_INVALID');}
function object(value:unknown):asserts value is Row{if(!value||typeof value!=='object'||Array.isArray(value))invalid();}
function allowed(value:unknown,names:readonly string[]):asserts value is Row{object(value);if(Object.keys(value).some(key=>!names.includes(key)))invalid();}
function integer(value:unknown,min=0,max=Number.MAX_SAFE_INTEGER-1):asserts value is number{if(!Number.isSafeInteger(value)||(value as number)<min||(value as number)>max)invalid();}
function time(value:unknown):asserts value is string{if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))invalid();}
function date(value:unknown):asserts value is string{if(typeof value!=='string'||!isCivilDate(value))invalid();}
function parse(raw:string):unknown{try{return backupJson(raw,MAX);}catch{throw new Error('E2EE_STOICHEION_SOURCE_INVALID');}}
function b64(value:unknown,min:number,max=min):Uint8Array<ArrayBuffer>{
  if(typeof value!=='string'||value.length>Math.ceil(max/3)*4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))return invalid();
  const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));if(bytes.length<min||bytes.length>max)return invalid();return bytes;
}
const empty=():RestorationDocument=>({version:1,works:[],removed:[]});
const cardIds=new Set<string>(STOICHEION_LETTERS.map(row=>row.id));
function cards(value:unknown,seed:number){
  if(!Array.isArray(value)||value.length!==0&&value.length!==9)invalid();
  if(!value.length)return expectedSourceDraw(seed);
  const seen=new Set<string>();return value.map(row=>{exactKeys(row,['cardId','reversed']);
    if(typeof row.cardId!=='string'||!cardIds.has(row.cardId)||seen.has(row.cardId)||typeof row.reversed!=='boolean')invalid();seen.add(row.cardId);
    return {cardId:row.cardId,reversed:row.reversed};});
}
function document(value:unknown):RestorationDocument{
  try{const result=validateRestorationDocument(value);
    // Unknown or lossy historical formats require review; never silently drop a
    // deleted duplicate, old field or private reflection while claiming complete.
    if(canonicalJson(value)!==canonicalJson(result))throw new Error();return result;
  }catch{throw new Error('E2EE_STOICHEION_DOCUMENT_REVIEW_REQUIRED');}
}
/** Historical display content only: no attempts, windows, entitlement or live
 * authorization survives normalization into a portable content object. */
function clientDraw(value:unknown,kind?:string,dayKey?:string){
  allowed(value,['kind','dayKey','seed','attempts','firstDrawAt','rerollDeadline','remainingSeconds','canReroll','unlimited','cardRevision','cards','localDeadline']);
  if(!['daily','spread','timeline'].includes(String(value.kind))||kind&&value.kind!==kind||dayKey&&value.dayKey!==dayKey)invalid();
  date(value.dayKey);integer(value.seed,0,0xffffffff);time(value.firstDrawAt);
  const copy:{kind:string;dayKey:string;seed:number;firstDrawAt:string;cardRevision?:number;cards?:ReturnType<typeof cards>}={kind:value.kind as string,dayKey:value.dayKey,seed:value.seed,firstDrawAt:value.firstDrawAt};
  if(value.cardRevision!==undefined){integer(value.cardRevision);copy.cardRevision=value.cardRevision;}
  if(value.cards!==undefined){if(value.kind!=='spread')invalid();copy.cards=cards(value.cards,value.seed);}
  return copy;
}
function clientTimeline(value:unknown){
  allowed(value,['dayKey','periodKey','seed','revision','firstDrawAt','cards']);date(value.dayKey);date(value.periodKey);integer(value.seed,0,0xffffffff);integer(value.revision);time(value.firstDrawAt);
  if(stoicheionWeekStart(value.dayKey)!==value.periodKey||!Array.isArray(value.cards)||value.cards.length>3)invalid();
  const windows=value.cards.map((row,index)=>{allowed(row,['position','firstRevealedAt','rerollDeadline','remainingSeconds','canReroll','rerolled','unlimited','localDeadline']);
    if(row.position!==index)invalid();time(row.firstRevealedAt);if(typeof row.rerolled!=='boolean')invalid();
    return {position:index,firstRevealedAt:row.firstRevealedAt,wasRerolled:row.rerolled};});
  return{dayKey:value.dayKey,periodKey:value.periodKey,seed:value.seed,revision:value.revision,firstDrawAt:value.firstDrawAt,windows};
}
function nativeHistory(value:unknown){
  allowed(value,['days','timelineSession']);object(value.days);const draws:ReturnType<typeof clientDraw>[]=[];
  for(const [dayKey,byKind]of Object.entries(value.days)){
    date(dayKey);allowed(byKind,['daily','spread','timeline']);
    for(const [kind,raw]of Object.entries(byKind)){allowed(raw,['seed','attempts','firstAt','rerollDeadline','unlimited','serverRerollAllowed','cardRevision','cards']);integer(raw.firstAt);
      draws.push(clientDraw({kind,dayKey,seed:raw.seed,firstDrawAt:new Date(raw.firstAt).toISOString(),...(raw.cardRevision===undefined?{}:{cardRevision:raw.cardRevision}),...(raw.cards===undefined?{}:{cards:raw.cards})}));
      if(draws.length>10000)throw new Error('E2EE_SOURCE_TOO_LARGE');}
  }
  let timeline:ReturnType<typeof clientTimeline>|null=null;
  if(value.timelineSession!==undefined){allowed(value.timelineSession,['serverNow','timeline','receivedAt']);time(value.timelineSession.serverNow);integer(value.timelineSession.receivedAt);
    if(value.timelineSession.timeline!==null)timeline=clientTimeline(value.timelineSession.timeline);}
  return{draws,timeline};
}

/** Actual owner-scoped legacy stores. The migration coordinator must fence all
 * writers and durably encrypt captureLocal() before this adapter performs IO. */
export class PersonalStoicheionSource implements PrivatePathAdapter{
  readonly id='personal.stoicheion';#owner:string;#scope:string;#ports:StoicheionSourcePorts;
  constructor(ownerId:string,scopeId:string,ports:StoicheionSourcePorts){assertTechnical(ownerId);assertTechnical(scopeId);this.#owner=ownerId;this.#scope=scopeId;this.#ports=ports;}
  #prefix(){return `genesis-stoicheion-workspace-v1:${this.#owner}:`;}
  #reveals(){return `genesis-stoicheion-draws-v2:timeline:reveal:${this.#owner}:`;}
  async captureLocal():Promise<Uint8Array>{
    this.#ports.assertCurrent();const storage=this.#ports.storage,keys=new Set<string>();
    for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key?.startsWith(this.#prefix())||key?.startsWith(this.#reveals()))keys.add(key);if(keys.size>10000)throw new Error('E2EE_JOURNAL_LIMIT');}
    keys.add(`genesis-workspace-device-key-v2:${this.#owner}`);keys.add(`genesis-data-generation-v1:${this.#owner}`);
    const entries=[...keys].sort().flatMap(key=>{const value=storage.getItem(key);return value===null?[]:[{key,value}];});
    const snapshot:Snapshot={protocol:1,ownerId:this.#owner,scopeId:this.#scope,capturedAt:new Date().toISOString(),memory:this.#ports.memory(),entries};
    if(snapshot.memory.ownerId!==this.#owner)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
    const result=encoder.encode(JSON.stringify(snapshot));this.#ports.assertCurrent();if(result.length>MAX){result.fill(0);throw new Error('E2EE_SNAPSHOT_TOO_LARGE');}return result;
  }
  #decode(bytes:Uint8Array):Snapshot{
    if(bytes.length<1||bytes.length>MAX)invalid();const value=parse(decoder.decode(bytes));exactKeys(value,['protocol','ownerId','scopeId','capturedAt','memory','entries']);
    if(value.protocol!==1||value.ownerId!==this.#owner||value.scopeId!==this.#scope||!Array.isArray(value.entries)||value.entries.length>10002)invalid();time(value.capturedAt);
    exactKeys(value.memory,['ownerId','legacyKey','generation','reconciliationRequired','current','draws','timeline','nativeDraws']);
    if(value.memory.ownerId!==this.#owner||typeof value.memory.legacyKey!=='string'||typeof value.memory.reconciliationRequired!=='boolean'||!Array.isArray(value.memory.draws))invalid();integer(value.memory.generation);
    const seen=new Set<string>();for(const row of value.entries){exactKeys(row,['key','value']);if(typeof row.key!=='string'||typeof row.value!=='string'||seen.has(row.key)
      ||!row.key.startsWith(this.#prefix())&&!row.key.startsWith(this.#reveals())&&!['genesis-workspace-device-key-v2:','genesis-data-generation-v1:'].some(prefix=>row.key===prefix+this.#owner))invalid();seen.add(row.key);}
    return value as unknown as Snapshot;
  }
  async reconcile(local:Uint8Array,previous:readonly Uint8Array[],context?:MigrationSourceContext):Promise<{complete:boolean;content:MigrationContent[]}>{
    this.#ports.assertCurrent();if(!context||context.ownerId!==this.#owner||context.scopeId!==this.#scope)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
    const snapshot=this.#decode(local),entries=new Map(snapshot.entries.map(row=>[row.key,row.value]));
    if(snapshot.memory.reconciliationRequired||entries.has(`genesis-data-generation-v1:${this.#owner}`)&&entries.get(`genesis-data-generation-v1:${this.#owner}`)!==String(snapshot.memory.generation))throw new Error('E2EE_STOICHEION_GENERATION_REVIEW_REQUIRED');
    for(const bytes of previous){const old=this.#decode(bytes);if(canonicalJson(old.entries)!==canonicalJson(snapshot.entries)||canonicalJson(old.memory)!==canonicalJson(snapshot.memory))throw new Error('E2EE_STOICHEION_HISTORY_REVIEW_REQUIRED');}
    const remote=await this.#ports.legacyStoicheion(context);this.#ports.assertCurrent();
    exactKeys(remote,['protocol','ownerId','scopeId','migrationId','fence','sourceHash','legacyGeneration','checkpointHash','directoryRevision','workspace','draws','spreadCards','timelineSessions','timelineWindows','legacyKey']);
    if(remote.protocol!==1||remote.ownerId!==this.#owner||remote.scopeId!==this.#scope||remote.migrationId!==context.migrationId||remote.fence!==context.fence||remote.sourceHash!==context.sourceHash)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
    integer(remote.legacyGeneration);integer(remote.directoryRevision,1);decodeE2eeBytes(remote.checkpointHash,32);
    if(remote.legacyGeneration!==snapshot.memory.generation||context.generation<=remote.legacyGeneration)throw new Error('E2EE_STOICHEION_GENERATION_REVIEW_REQUIRED');
    exactKeys(remote.legacyKey,['keyMode','key']);if(!['account','client','empty'].includes(String(remote.legacyKey.keyMode)))invalid();
    const rawKeys:string[]=[],keys:CryptoKey[]=[],content:MigrationContent[]=[];let completed=false;
    try{
      if(snapshot.memory.legacyKey)rawKeys.push(snapshot.memory.legacyKey);
      const stored=entries.get(`genesis-workspace-device-key-v2:${this.#owner}`);if(stored){const value=parse(stored);object(value);if(typeof value.key!=='string')invalid();rawKeys.push(value.key);}
      if(this.#ports.openLegacy&&(rawKeys.length||remote.legacyKey.key!==null))throw new Error('E2EE_KEY_BRIDGE_FORBIDDEN');
      if(remote.legacyKey.keyMode==='account'&&!this.#ports.openLegacy){if(typeof remote.legacyKey.key!=='string')throw new Error('E2EE_LEGACY_KEY_UNAVAILABLE');rawKeys.push(remote.legacyKey.key);}else if(remote.legacyKey.key!==null)invalid();
      for(const raw of new Set(rawKeys)){const bytes=b64(raw,32);try{keys.push(await crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['decrypt']));}finally{bytes.fill(0);}}
      const open=async(envelope:unknown,purpose:string)=>{object(envelope);const iv=b64(envelope.iv,12),cipher=b64(envelope.ciphertext,16,MAX);let opened:Uint8Array|undefined;
        if(this.#ports.openLegacy){this.#ports.assertCurrent();const value=await this.#ports.openLegacy({iv:envelope.iv as string,ciphertext:envelope.ciphertext as string},purpose);this.#ports.assertCurrent();return value;}
        for(const key of keys){try{opened=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:encoder.encode(`genesis-mindmap-v1:${this.#owner}:${purpose}`)},key,cipher));break;}catch{/* Captured historical keys only. */}}
        if(!opened)throw new Error(keys.length?'E2EE_LEGACY_STOICHEION_CORRUPT':'E2EE_LEGACY_KEY_UNAVAILABLE');try{return parse(decoder.decode(opened));}finally{opened.fill(0);this.#ports.assertCurrent();}};
      let combined=empty(),remoteRevision=0;
      if(remote.workspace!==null){exactKeys(remote.workspace,['revision','iv','ciphertext','updatedAt']);integer(remote.workspace.revision,1);time(remote.workspace.updatedAt);combined=document(await open(remote.workspace,'stoicheion-workspace:v1'));remoteRevision=remote.workspace.revision;}
      const prefix=this.#prefix(),localRows=new Map([...entries].filter(([key])=>key.startsWith(prefix)));
      const storage={get length(){return localRows.size;},key:(index:number)=>[...localRows.keys()][index]??null,getItem:(key:string)=>localRows.get(key)??null,setItem:()=>{throw new Error('E2EE_SOURCE_MUTATION');},removeItem:()=>{throw new Error('E2EE_SOURCE_MUTATION');}};
      const branches=new EncryptedPendingJournal(prefix+'pending').read(storage),heads=new Set(branches.map(branch=>branch.head.key)),known=new Set(branches.flatMap(branch=>branch.entries.map(entry=>entry.key)));
      for(const key of localRows.keys())if(!known.has(key))throw new Error('E2EE_STOICHEION_FORMAT_UNSUPPORTED');
      const history:{key:string;expectedRevision:number;document:RestorationDocument;base:RestorationDocument}[]=[];
      for(const branch of branches)for(const entry of branch.entries){const pending=parse(entry.raw);exactKeys(pending,['envelope','base']);object(pending.envelope);integer(pending.envelope.expectedRevision);
        if(pending.envelope.expectedRevision>remoteRevision)throw new Error('E2EE_STOICHEION_REMOTE_ROLLBACK');
        const value=document(await open(pending.envelope,'stoicheion-workspace:v1')),base=document(await open(pending.base,'stoicheion-pending-base:v1'));
        history.push({key:entry.key,expectedRevision:pending.envelope.expectedRevision,document:value,base});if(heads.has(entry.key)){try{combined=mergeRestorationDocuments(base,value,combined);}catch{throw new Error('E2EE_STOICHEION_CONFLICT_REVIEW_REQUIRED');}}}
      const current=snapshot.memory.current;if(current!==null){exactKeys(current,['document','base','revision']);integer(current.revision);if(current.revision>remoteRevision)throw new Error('E2EE_STOICHEION_REMOTE_ROLLBACK');
        const value=document(current.document),base=document(current.base);try{combined=mergeRestorationDocuments(base,value,combined);}catch{throw new Error('E2EE_STOICHEION_CONFLICT_REVIEW_REQUIRED');}}
      let count=0;for(const field of ['draws','spreadCards','timelineSessions','timelineWindows']as const){if(!Array.isArray(remote[field]))invalid();count+=remote[field].length;if(count>10000)throw new Error('E2EE_SOURCE_TOO_LARGE');}
      const drawIds=new Set<string>(),sessionIds=new Set<string>(),spreadIds=new Set<string>(),windowIds=new Set<string>();
      const draws=(remote.draws as unknown[]).map(row=>{exactKeys(row,['dayKey','kind','seed','firstDrawAt','updatedAt']);date(row.dayKey);integer(row.seed,0,0xffffffff);time(row.firstDrawAt);time(row.updatedAt);
        const id=row.dayKey+':'+row.kind;if(!['daily','spread','timeline'].includes(String(row.kind))||drawIds.has(id))invalid();drawIds.add(id);return row;});
      const spreadCards=(remote.spreadCards as unknown[]).map(row=>{exactKeys(row,['dayKey','sourceSeed','revision','cardsJson','updatedAt']);date(row.dayKey);integer(row.sourceSeed,0,0xffffffff);integer(row.revision,1);time(row.updatedAt);
        if(typeof row.cardsJson!=='string'||spreadIds.has(row.dayKey)||!draws.some(draw=>draw.dayKey===row.dayKey&&draw.kind==='spread'&&draw.seed===row.sourceSeed))invalid();spreadIds.add(row.dayKey);
        return{dayKey:row.dayKey,sourceSeed:row.sourceSeed,revision:row.revision,cards:cards(parse(row.cardsJson),row.sourceSeed),updatedAt:row.updatedAt};});
      const timelineSessions=(remote.timelineSessions as unknown[]).map(row=>{exactKeys(row,['periodKey','dayKey','seed','revision','createdAt','updatedAt']);date(row.dayKey);date(row.periodKey);integer(row.seed,0,0xffffffff);integer(row.revision);time(row.createdAt);time(row.updatedAt);
        if(stoicheionWeekStart(row.dayKey)!==row.periodKey||sessionIds.has(row.periodKey))invalid();sessionIds.add(row.periodKey);return row;});
      const timelineWindows=(remote.timelineWindows as unknown[]).map(row=>{exactKeys(row,['periodKey','position','firstRevealedAt','lastRerolledAt']);date(row.periodKey);integer(row.position,0,2);time(row.firstRevealedAt);if(row.lastRerolledAt!==null)time(row.lastRerolledAt);
        const id=row.periodKey+':'+row.position;if(!sessionIds.has(row.periodKey)||windowIds.has(id)||row.position>0&&!windowIds.has(row.periodKey+':'+(row.position-1)))invalid();windowIds.add(id);return row;});
      const localDraws=snapshot.memory.draws.map(row=>clientDraw(row)),timeline=snapshot.memory.timeline===null?null:clientTimeline(snapshot.memory.timeline),native=snapshot.memory.nativeDraws===null?null:nativeHistory(snapshot.memory.nativeDraws);
      const reveals=[...entries].filter(([key])=>key.startsWith(this.#reveals())).map(([key,value])=>{const suffix=key.slice(this.#reveals().length),match=/^(\d{4}-\d{2}-\d{2}):(\d{1,10}):([12])$/.exec(suffix);if(!match||!['1','2','3'].includes(value))return invalid();date(match[1]);integer(Number(match[2]),0,0xffffffff);
        return{dayKey:match[1],seed:Number(match[2]),count:Number(value)};});
      content.push({domain:'stoicheion',objectId:'personal-stoicheion-workspace-v1',bytes:encoder.encode(JSON.stringify({protocol:1,ownerId:this.#owner,document:combined}))});
      if(history.length||current)content.push({domain:'stoicheion',objectId:'personal-stoicheion-local-history-v1',bytes:encoder.encode(JSON.stringify({protocol:1,ownerId:this.#owner,snapshots:history,mounted:current}))});
      content.push({domain:'stoicheion',objectId:'personal-stoicheion-draw-history-v1',bytes:encoder.encode(JSON.stringify({protocol:1,ownerId:this.#owner,server:{draws,spreadCards,timelineSessions,timelineWindows},device:{draws:localDraws,timeline,native,reveals}}))});
      if(content.reduce((n,row)=>n+row.bytes.length,0)>MAX)throw new Error('E2EE_MIGRATION_TOO_LARGE');this.#ports.assertCurrent();completed=true;return{complete:true,content};
    }finally{rawKeys.fill('');keys.length=0;if(!completed)content.forEach(row=>row.bytes.fill(0));}
  }
}
