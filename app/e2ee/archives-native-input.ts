import {assertTechnical,exactKeys} from './keys.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';

type Row=Record<string,unknown>;
export type NativeArchiveDocument=Readonly<{scope:string;kind:string;encrypted:string;revision:number}>;
export type NativeSafetyArchivePlan=Readonly<{kind:string;context:string;ciphertext:string;orphan:boolean;
 requiresAuthentication:true;originals:readonly NativeArchiveDocument[]}>;
export type NativeProtectedArchive=Readonly<{raw:string;scope:string;capturedAt:string;preferences:Row;
 documents:readonly Readonly<{kind:string;encrypted:string;revision:number}>[];
 tasks:readonly Readonly<{id:string;encrypted:string;revision:number;deleted:boolean}>[];
 outbox:readonly Readonly<{entityId:string;revision:number;operationId:string;state:string}>[]}>;
const MAX_PLAIN=64*1024*1024,MAX_TOTAL=128*1024*1024,CHUNK=256*1024;
const MAX_CIPHER=Math.ceil((MAX_PLAIN+28)/3)*4,encoder=new TextEncoder();
const chunkPattern=/^(backup-safety:[A-Za-z0-9_.:+-]{1,256})\/chunk\/(0|[1-9][0-9]{0,3})$/;
const rootPattern=/^backup-safety:[A-Za-z0-9_.:+-]{1,256}$/;
function invalid():never{throw new Error('E2EE_ARCHIVE_NATIVE_INPUT_INVALID');}
function integer(value:unknown,min=0,max=Number.MAX_SAFE_INTEGER):asserts value is number{
 if(!Number.isSafeInteger(value)||(value as number)<min||(value as number)>max)invalid();
}
function text(value:unknown,maximum=4096):asserts value is string{if(typeof value!=='string'||value.length<1||value.length>maximum)invalid();}
function object(value:unknown):asserts value is Row{if(!value||typeof value!=='object'||Array.isArray(value))invalid();}
function time(value:unknown):asserts value is string{text(value,100);if(!Number.isFinite(Date.parse(value)))invalid();}
async function accountScope(ownerId:string,current:()=>void){
 assertTechnical(ownerId);current();const raw=encoder.encode(ownerId);let digest:Uint8Array|undefined;
 try{digest=new Uint8Array(await crypto.subtle.digest('SHA-256',raw));current();return 'account-'+Array.from(digest,byte=>byte.toString(16).padStart(2,'0')).join('').slice(0,32);}
 finally{raw.fill(0);digest?.fill(0);}
}
function parse(raw:unknown,maximum:number){return parseLegacyMigrationJson(raw,'E2EE_ARCHIVE_NATIVE_INPUT_INVALID',maximum);}
function framedCiphertext(value:string){
 // Framing alone is not authentication. Avoid decoding/allocating another copy
 // of a potentially64MiB plaintext's padded native ciphertext here.
 if(value.length<40||value.length>MAX_CIPHER||value.length%4!==0)invalid();
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',padding=value.endsWith('==')?2:value.endsWith('=')?1:0,end=value.length-padding;
 for(let index=0;index<end;index++)if(alphabet.indexOf(value[index])<0)invalid();
 const last=alphabet.indexOf(value[end-1]);if(padding===2&&(last&15)!==0||padding===1&&(last&3)!==0)invalid();
 const length=value.length/4*3-padding;if(length<28||length>MAX_PLAIN+28)invalid();
}

/** Common strict reader for the exact protected-state-v1 written by native
 * BackupSafetyStore. No Keystore/HTTP/restore port exists. Original JSON remains
 * intact; returned preferences/queues are SOURCE INPUT, never restored authority.
 * Nested old ciphers still require authenticated, owner-bound native readers. */
export async function parseNativeProtectedArchive(raw:unknown,ownerId:string,current:()=>void):Promise<NativeProtectedArchive>{
 current();const value=parse(raw,MAX_PLAIN);exactKeys(value,['format','scope','capturedAt','preferences','documents','tasks','outbox']);
 if(value.format!=='native-protected-state-v1')invalid();time(value.capturedAt);object(value.preferences);
 for(const name of ['documents','tasks','outbox'])if(!Array.isArray(value[name])||value[name].length>10000)invalid();
 const documents:NativeProtectedArchive['documents'][number][]=[],tasks:NativeProtectedArchive['tasks'][number][]=[],outbox:NativeProtectedArchive['outbox'][number][]=[];
 const kinds=new Set<string>(),ids=new Set<string>(),operations=new Set<string>();
 for(const candidate of value.documents as unknown[]){
  exactKeys(candidate,['kind','encrypted','revision']);text(candidate.kind);text(candidate.encrypted,MAX_PLAIN);integer(candidate.revision);
  if(kinds.has(candidate.kind))invalid();kinds.add(candidate.kind);
  documents.push(Object.freeze({kind:candidate.kind,encrypted:candidate.encrypted,revision:candidate.revision}));
 }
 for(const candidate of value.tasks as unknown[]){
  exactKeys(candidate,['id','encrypted','revision','deleted']);text(candidate.id);text(candidate.encrypted,MAX_PLAIN);integer(candidate.revision);
  if(ids.has(candidate.id)||typeof candidate.deleted!=='boolean')invalid();ids.add(candidate.id);
  tasks.push(Object.freeze({id:candidate.id,encrypted:candidate.encrypted,revision:candidate.revision,deleted:candidate.deleted}));
 }
 for(const candidate of value.outbox as unknown[]){
  exactKeys(candidate,['entityId','revision','operationId','state']);text(candidate.entityId);text(candidate.operationId);text(candidate.state,100);integer(candidate.revision);
  if(operations.has(candidate.operationId))invalid();operations.add(candidate.operationId);
  outbox.push(Object.freeze({entityId:candidate.entityId,revision:candidate.revision,operationId:candidate.operationId,state:candidate.state}));
 }
 const scope=await accountScope(ownerId,current);if(value.scope!==scope)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');current();
 return Object.freeze({raw:raw as string,scope,capturedAt:value.capturedAt,preferences:value.preferences,
  documents:Object.freeze(documents),tasks:Object.freeze(tasks),outbox:Object.freeze(outbox)});
}

/** Assemble all retained native safety groups before any old-key opening call.
 * Missing-root contiguous groups remain explicit orphan candidates; only a later
 * successful AEAD open can establish they are complete. Never invent an empty
 * snapshot, prune a row, trust a manifest as content, or return complete=true. */
export async function planNativeSafetyArchives(input:unknown,ownerId:string,current:()=>void):Promise<readonly NativeSafetyArchivePlan[]>{
 current();if(!Array.isArray(input)||input.length>10000)invalid();
 const groups=new Map<string,{root?:NativeArchiveDocument;parts:Map<number,NativeArchiveDocument>}>(),seen=new Set<string>();let size=0;
 const rows:NativeArchiveDocument[]=[];
 for(const candidate of input){
  exactKeys(candidate,['scope','kind','encrypted','revision']);text(candidate.scope,100);text(candidate.kind,512);text(candidate.encrypted,CHUNK);integer(candidate.revision);
  const match=chunkPattern.exec(candidate.kind);if(!match&&!rootPattern.test(candidate.kind)||seen.has(candidate.kind))invalid();seen.add(candidate.kind);
  const bytes=encoder.encode(candidate.encrypted);size+=bytes.length;bytes.fill(0);if(size>MAX_TOTAL)throw new Error('E2EE_SOURCE_TOO_LARGE');
  const row=Object.freeze({...candidate}) as NativeArchiveDocument;rows.push(row);const kind=match?match[1]:candidate.kind;
  const group=groups.get(kind)??{parts:new Map<number,NativeArchiveDocument>()};groups.set(kind,group);
  if(match){const index=Number(match[2]);if(index>=4096)invalid();group.parts.set(index,row);}else group.root=row;
 }
 const scope=await accountScope(ownerId,current);if(rows.some(row=>row.scope!==scope))throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
 const result:NativeSafetyArchivePlan[]=[];
 for(const [kind,group]of [...groups].sort(([left],[right])=>left<right?-1:left>right?1:0)){
  current();let expected:number|undefined,count=group.parts.size;
  if(group.root){const manifest=parse(group.root.encrypted,16*1024);exactKeys(manifest,['chunks','length']);integer(manifest.chunks,1,4096);integer(manifest.length,40,MAX_CIPHER);
   count=manifest.chunks;expected=manifest.length;if(group.parts.size!==count)throw new Error('E2EE_ARCHIVE_NATIVE_HISTORY_REVIEW_REQUIRED');}
  if(count<1||count>4096)throw new Error('E2EE_ARCHIVE_NATIVE_HISTORY_REVIEW_REQUIRED');
  const parts:NativeArchiveDocument[]=[];
  for(let index=0;index<count;index++){const row=group.parts.get(index);if(!row)throw new Error('E2EE_ARCHIVE_NATIVE_HISTORY_REVIEW_REQUIRED');
   if(index<count-1&&row.encrypted.length!==CHUNK)throw new Error('E2EE_ARCHIVE_NATIVE_HISTORY_REVIEW_REQUIRED');parts.push(row);}
  const ciphertext=parts.map(row=>row.encrypted).join('');if(expected!==undefined&&ciphertext.length!==expected)throw new Error('E2EE_ARCHIVE_NATIVE_HISTORY_REVIEW_REQUIRED');
  framedCiphertext(ciphertext);current();result.push(Object.freeze({kind,context:`${scope}/${kind}`,ciphertext,orphan:!group.root,
   requiresAuthentication:true,originals:Object.freeze([...(group.root?[group.root]:[]),...parts])}));
 }
 current();return Object.freeze(result);
}
