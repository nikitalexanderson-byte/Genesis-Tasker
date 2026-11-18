import {assertTechnical,exactKeys} from './keys.ts';
import {decodeE2eeBytes} from './envelope.ts';
import type {PrivatePathAdapter} from './migration-sources.ts';
import type {MigrationSourceContext,MigrationContent} from './migration.ts';
import {EncryptedPendingJournal} from '../encrypted-pending-journal.ts';
import {backupJson} from '../backup-format.ts';
import {canonicalJson} from '../aurora/forecast.ts';
import {decodeAuroraStorage} from '../aurora/storage-compatibility.ts';
import {validateDocument,type AuroraDocument,type PreparedAuroraResult} from '../aurora/session.ts';
import {emptyAuroraDocument,mergeAuroraDocuments} from '../aurora/repository.ts';
import {verifyPreparedSolution,type VerifiedAuroraSolution} from '../aurora/result.ts';

const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true}),MAX=16*1024*1024;
type Row=Record<string,unknown>;
export type AuroraMigrationMemory={ownerId:string;legacyKey:string;generation:number;reconciliationRequired:boolean;
  current:{document:AuroraDocument;base:AuroraDocument;revision:number}|null};
type Snapshot={protocol:1;ownerId:string;scopeId:string;capturedAt:string;memory:AuroraMigrationMemory;entries:{key:string;value:string}[]};
export type AuroraSourcePorts={storage:Pick<Storage,'getItem'|'key'|'length'>;memory:()=>AuroraMigrationMemory;assertCurrent:()=>void;
  legacyAurora:(context:MigrationSourceContext)=>Promise<unknown>};
function invalid():never{throw new Error('E2EE_AURORA_SOURCE_INVALID');}
function object(value:unknown):asserts value is Row{if(!value||typeof value!=='object'||Array.isArray(value))invalid();}
function integer(value:unknown,min=0):asserts value is number{if(!Number.isSafeInteger(value)||(value as number)<min||(value as number)>=Number.MAX_SAFE_INTEGER)invalid();}
function time(value:unknown):asserts value is string{if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))invalid();}
function parse(raw:string):unknown{try{return backupJson(raw,MAX);}catch{throw new Error('E2EE_AURORA_SOURCE_INVALID');}}
function b64(value:unknown,min:number,max=min):Uint8Array<ArrayBuffer>{
  if(typeof value!=='string'||value.length>Math.ceil(max/3)*4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))return invalid();
  const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));if(bytes.length<min||bytes.length>max)return invalid();return bytes;
}
const sha=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))),n=>n.toString(16).padStart(2,'0')).join('');

/** Actual personal.aurora source: read-only local capture, then signed historical
 * source read, authenticated legacy decryption, three-way reconciliation and
 * portable result/history content. The product coordinator must supply its
 * persistent owner fence and a synchronous capture of every mounted editor.
 * No source is acknowledged/deleted and no legacy key enters output content.
 */
export class PersonalAuroraSource implements PrivatePathAdapter {
  readonly id='personal.aurora';#owner:string;#scope:string;#ports:AuroraSourcePorts;
  constructor(ownerId:string,scopeId:string,ports:AuroraSourcePorts){assertTechnical(ownerId);assertTechnical(scopeId);this.#owner=ownerId;this.#scope=scopeId;this.#ports=ports;}
  #prefix(){return `genesis-aurora-workspace-v1:${this.#owner}:`;}
  async captureLocal():Promise<Uint8Array>{
    this.#ports.assertCurrent();const storage=this.#ports.storage,prefix=this.#prefix(),keys=new Set<string>();
    for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key?.startsWith(prefix))keys.add(key);if(keys.size>1025)throw new Error('E2EE_JOURNAL_LIMIT');}
    keys.add(`genesis-workspace-device-key-v2:${this.#owner}`);keys.add(`genesis-data-generation-v1:${this.#owner}`);
    const entries=[...keys].sort().flatMap(key=>{const value=storage.getItem(key);return value===null?[]:[{key,value}];});
    const value:Snapshot={protocol:1,ownerId:this.#owner,scopeId:this.#scope,capturedAt:new Date().toISOString(),memory:this.#ports.memory(),entries};
    if(value.memory.ownerId!==this.#owner)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
    const result=encoder.encode(JSON.stringify(value));this.#ports.assertCurrent();
    if(result.length>MAX){result.fill(0);throw new Error('E2EE_SNAPSHOT_TOO_LARGE');}return result;
  }
  #decode(bytes:Uint8Array):Snapshot {
    if(bytes.length<1||bytes.length>MAX)invalid();const value=parse(decoder.decode(bytes));
    exactKeys(value,['protocol','ownerId','scopeId','capturedAt','memory','entries']);
    if(value.protocol!==1||value.ownerId!==this.#owner||value.scopeId!==this.#scope||!Array.isArray(value.entries)||value.entries.length>1027)invalid();time(value.capturedAt);
    exactKeys(value.memory,['ownerId','legacyKey','generation','reconciliationRequired','current']);
    if(value.memory.ownerId!==this.#owner||typeof value.memory.legacyKey!=='string'||typeof value.memory.reconciliationRequired!=='boolean')invalid();integer(value.memory.generation);
    const keys=new Set<string>();for(const row of value.entries){exactKeys(row,['key','value']);if(typeof row.key!=='string'||typeof row.value!=='string'||keys.has(row.key)
      ||!row.key.startsWith(this.#prefix())&&!['genesis-workspace-device-key-v2:','genesis-data-generation-v1:'].some(prefix=>row.key===prefix+this.#owner))invalid();keys.add(row.key);}
    return value as unknown as Snapshot;
  }
  async reconcile(local:Uint8Array,previous:readonly Uint8Array[],context?:MigrationSourceContext):Promise<{complete:boolean;content:MigrationContent[]}> {
    this.#ports.assertCurrent();if(!context||context.ownerId!==this.#owner||context.scopeId!==this.#scope)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
    const snapshot=this.#decode(local),entries=new Map(snapshot.entries.map(row=>[row.key,row.value]));
    if(snapshot.memory.reconciliationRequired||entries.has(`genesis-data-generation-v1:${this.#owner}`)
      &&entries.get(`genesis-data-generation-v1:${this.#owner}`)!==String(snapshot.memory.generation))throw new Error('E2EE_AURORA_GENERATION_REVIEW_REQUIRED');
    for(const bytes of previous){const old=this.#decode(bytes);if(canonicalJson(old.entries)!==canonicalJson(snapshot.entries)||canonicalJson(old.memory)!==canonicalJson(snapshot.memory))throw new Error('E2EE_AURORA_HISTORY_REVIEW_REQUIRED');}
    const remote=await this.#ports.legacyAurora(context);this.#ports.assertCurrent();
    exactKeys(remote,['protocol','ownerId','scopeId','migrationId','fence','sourceHash','legacyGeneration','checkpointHash','directoryRevision','workspace','results','legacyKey']);
    if(remote.protocol!==1||remote.ownerId!==this.#owner||remote.scopeId!==this.#scope||remote.migrationId!==context.migrationId
      ||remote.fence!==context.fence||remote.sourceHash!==context.sourceHash)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
    integer(remote.legacyGeneration);integer(remote.directoryRevision,1);decodeE2eeBytes(remote.checkpointHash,32);
    if(remote.legacyGeneration!==snapshot.memory.generation||context.generation<=remote.legacyGeneration)throw new Error('E2EE_AURORA_GENERATION_REVIEW_REQUIRED');
    exactKeys(remote.legacyKey,['keyMode','key']);if(!['account','client','empty'].includes(String(remote.legacyKey.keyMode)))invalid();
    const rawKeys:string[]=[],keys:CryptoKey[]=[],content:MigrationContent[]=[];let completed=false;
    try {
      if(snapshot.memory.legacyKey)rawKeys.push(snapshot.memory.legacyKey);
      const deviceKey=entries.get(`genesis-workspace-device-key-v2:${this.#owner}`);if(deviceKey){const device=parse(deviceKey);object(device);if(typeof device.key!=='string')invalid();rawKeys.push(device.key);}
      if(remote.legacyKey.keyMode==='account'){if(typeof remote.legacyKey.key!=='string')throw new Error('E2EE_LEGACY_KEY_UNAVAILABLE');rawKeys.push(remote.legacyKey.key);}
      else if(remote.legacyKey.key!==null)invalid();
      for(const raw of new Set(rawKeys)){const bytes=b64(raw,32);try{keys.push(await crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['decrypt']));}finally{bytes.fill(0);}}
      const open=async(envelope:unknown,scope:string):Promise<unknown>=>{
        object(envelope);const iv=b64(envelope.iv,12),ciphertext=b64(envelope.ciphertext,16,MAX);let opened:Uint8Array|undefined;
        for(const key of keys){try{opened=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:encoder.encode(`genesis-mindmap-v1:${this.#owner}:${scope}`)},key,ciphertext));break;}catch{/* Only captured legacy epochs; never manufacture a replacement. */}}
        if(!opened)throw new Error(keys.length?'E2EE_LEGACY_AURORA_CORRUPT':'E2EE_LEGACY_KEY_UNAVAILABLE');
        try{return parse(decoder.decode(opened));}finally{opened.fill(0);this.#ports.assertCurrent();}
      };
      const document=async(value:unknown)=>{
        try{return await validateDocument(await decodeAuroraStorage(value as AuroraDocument),this.#owner);}
        catch{throw new Error('E2EE_AURORA_DOCUMENT_REVIEW_REQUIRED');}
      };
      let combined=emptyAuroraDocument(this.#owner),remoteRevision=0;
      if(remote.workspace!==null){exactKeys(remote.workspace,['revision','iv','ciphertext','updatedAt']);integer(remote.workspace.revision,1);time(remote.workspace.updatedAt);
        combined=await document(await open(remote.workspace,'aurora-workspace:v1'));remoteRevision=remote.workspace.revision;}
      const prefix=this.#prefix(),localRows=new Map([...entries].filter(([key])=>key.startsWith(prefix))),history:{key:string;expectedRevision:number;document:AuroraDocument;base:AuroraDocument}[]=[];
      const storage={get length(){return localRows.size;},key:(i:number)=>[...localRows.keys()][i]??null,getItem:(key:string)=>localRows.get(key)??null,
        setItem:()=>{throw new Error('E2EE_SOURCE_MUTATION');},removeItem:()=>{throw new Error('E2EE_SOURCE_MUTATION');}};
      const branches=new EncryptedPendingJournal(prefix+'pending').read(storage),heads=new Set(branches.map(branch=>branch.head.key));
      const knownKeys=new Set([prefix+'cache',...branches.flatMap(branch=>branch.entries.map(entry=>entry.key))]);
      for(const key of localRows.keys())if(!knownKeys.has(key))throw new Error('E2EE_AURORA_FORMAT_UNSUPPORTED');
      const allDocuments:AuroraDocument[]=[combined];let cachedHistory:{revision:number;document:AuroraDocument}|null=null;
      const cache=localRows.get(prefix+'cache');if(cache){const envelope=parse(cache);object(envelope);integer(envelope.revision,1);
        if(envelope.revision>remoteRevision)throw new Error('E2EE_AURORA_REMOTE_ROLLBACK');
        const value=await document(await open(envelope,'aurora-workspace:v1'));cachedHistory={revision:envelope.revision,document:value};allDocuments.push(value);}
      for(const branch of branches)for(const entry of branch.entries){
        const pending=parse(entry.raw);exactKeys(pending,['envelope','base']);object(pending.envelope);integer(pending.envelope.expectedRevision);
        if(pending.envelope.expectedRevision>remoteRevision)throw new Error('E2EE_AURORA_REMOTE_ROLLBACK');
        const value=await document(await open(pending.envelope,'aurora-workspace:v1')),base=await document(await open(pending.base,'aurora-workspace-base:v1'));
        history.push({key:entry.key,expectedRevision:pending.envelope.expectedRevision,document:value,base});allDocuments.push(value,base);
        if(heads.has(entry.key)){try{combined=await mergeAuroraDocuments(base,value,combined);}catch{throw new Error('E2EE_AURORA_CONFLICT_REVIEW_REQUIRED');}}
      }
      const current=snapshot.memory.current;
      if(current!==null){exactKeys(current,['document','base','revision']);integer(current.revision);if(current.revision>remoteRevision)throw new Error('E2EE_AURORA_REMOTE_ROLLBACK');
        const value=await document(current.document),base=await document(current.base);allDocuments.push(value,base);
        try{combined=await mergeAuroraDocuments(base,value,combined);}catch{throw new Error('E2EE_AURORA_CONFLICT_REVIEW_REQUIRED');}}
      const results=new Map<string,{id:string;methodVersion:string;contextHash:string;forecastHashes:string[];solution:VerifiedAuroraSolution;createdAt:string|null}>();
      const addResult=async(manifest:PreparedAuroraResult,solution:unknown,createdAt:string|null)=>{
        if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(manifest.id)
          ||manifest.methodVersion!=='aurora-two-circles-v2'||!/^[a-f0-9]{64}$/.test(manifest.contextHash)||!Array.isArray(manifest.forecastHashes)
          ||manifest.forecastHashes.length<1||manifest.forecastHashes.length>5||new Set(manifest.forecastHashes).size!==manifest.forecastHashes.length
          ||manifest.forecastHashes.some(hash=>typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash)))throw new Error('E2EE_AURORA_RESULT_REVIEW_REQUIRED');
        let verified:VerifiedAuroraSolution;try{verified=await verifyPreparedSolution(solution,manifest);}catch{throw new Error('E2EE_AURORA_RESULT_REVIEW_REQUIRED');}
        const old=results.get(manifest.id);if(old&&canonicalJson(old.solution)!==canonicalJson(verified))throw new Error('E2EE_AURORA_RESULT_IMMUTABLE');
        results.set(manifest.id,{id:manifest.id,methodVersion:manifest.methodVersion,contextHash:manifest.contextHash,forecastHashes:manifest.forecastHashes,solution:verified,createdAt:createdAt??old?.createdAt??null});
      };
      for(const value of allDocuments)for(const session of value.sessions)for(const manifest of session.preparedResults)
        await addResult(manifest,await open(manifest,`aurora-result:v1:${manifest.id}`),null);
      if(!Array.isArray(remote.results)||remote.results.length>10000)invalid();const ids=new Set<string>();
      for(const row of remote.results){exactKeys(row,['id','methodVersion','solutionJson','resultHash','createdAt']);
        if(typeof row.id!=='string'||ids.has(row.id)||typeof row.methodVersion!=='string'||typeof row.solutionJson!=='string'||typeof row.resultHash!=='string')invalid();ids.add(row.id);time(row.createdAt);
        if(await sha(row.methodVersion+':'+row.solutionJson)!==row.resultHash)throw new Error('E2EE_LEGACY_AURORA_CORRUPT');
        const solution=parse(row.solutionJson);object(solution);
        if(solution.kind!=='aurora-encrypted-solution-v1'||row.methodVersion!=='aurora-two-circles-v2')throw new Error('E2EE_AURORA_RESULT_REVIEW_REQUIRED');
        const manifest={...solution,id:row.id,methodVersion:row.methodVersion} as PreparedAuroraResult;
        await addResult(manifest,await open(manifest,`aurora-result:v1:${manifest.id}`),row.createdAt);
      }
      for(const session of combined.sessions){if(session.resultId&&!results.has(session.resultId))throw new Error('E2EE_AURORA_RESULT_MISSING');}
      content.push({domain:'aurora',objectId:'personal-aurora-workspace-v1',bytes:encoder.encode(JSON.stringify({protocol:1,ownerId:this.#owner,document:combined,resultIds:[...results.keys()].sort()}))});
      if(history.length||cachedHistory||current)content.push({domain:'aurora',objectId:'personal-aurora-local-history-v1',bytes:encoder.encode(JSON.stringify({protocol:1,ownerId:this.#owner,snapshots:history,cache:cachedHistory,mounted:current}))});
      for(const row of [...results.values()].sort((a,b)=>a.id.localeCompare(b.id,'en')))content.push({domain:'aurora',objectId:'aurora-result:'+row.id,bytes:encoder.encode(JSON.stringify({protocol:1,ownerId:this.#owner,...row}))});
      if(content.reduce((n,row)=>n+row.bytes.length,0)>MAX){content.forEach(row=>row.bytes.fill(0));throw new Error('E2EE_MIGRATION_TOO_LARGE');}
      this.#ports.assertCurrent();completed=true;return {complete:true,content};
    }finally{rawKeys.fill('');keys.length=0;if(!completed)content.forEach(row=>row.bytes.fill(0));}
  }
}
