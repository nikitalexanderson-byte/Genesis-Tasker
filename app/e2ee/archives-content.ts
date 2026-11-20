import {assertTechnical,exactKeys} from './keys.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {validateLegacyPhysisEnvelope} from './physis-legacy.ts';

type Row=Record<string,unknown>;
type Envelope={iv:string;ciphertext:string};
export type ArchiveContentReaderPorts={assertCurrent:()=>void;
 openAccount:(ownerId:string,envelope:Envelope,purpose:string)=>Promise<string>;
 openPhysis?:(ownerId:string,id:string,envelope:unknown)=>Promise<string>};
export type ArchivePlainEntry={source:string;metadata:Row;rawDocument:string|null;document:unknown};
export type ArchivePlainContent={format:'genesis-archive-plaintext-v1';ownerId:string;kind:'operations'|'tables';execution:'history-only';entries:ArchivePlainEntry[]};
type Plan={source:string;metadata:Row;envelope?:Envelope;purpose?:string;physis?:{id:string;envelope:unknown}};
const MAX=64*1024*1024,TOTAL=128*1024*1024,encoder=new TextEncoder();
const tables={
 workspace_blobs:['ciphertext','iv','version','updated_at','minimum_writer_protocol','writer_protocol_version'],
 personal_mindmaps:['id','schema_version','revision','ciphertext','iv','updated_at'],
 personal_mindmap_versions:['map_id','revision','schema_version','ciphertext','iv','updated_at'],
 personal_mindmap_deletions:['map_id','deleted_at'],
 personal_diary_notes:['id','revision','schema_version','iv','ciphertext','payload_hash','updated_at'],
 personal_diary_deletions:['id','revision','local_only','updated_at'],
 personal_diary_settings:['sync_enabled','revision','command_hash','removed_count','updated_at'],
 personal_diary_dreams:['note_id','dream_day','time_zone'],
 dream_journal_preferences:['today_mode','revision','updated_at'],
 stoicheion_workspaces:['revision','iv','ciphertext','payload_hash','updated_at'],
 aurora_workspaces:['revision','iv','ciphertext','payload_hash','updated_at'],
 personal_recovered_tasks:['id','revision','iv','ciphertext','updated_at'],
 personal_recovered_task_deletions:['id','revision','updated_at'],
 physis_records:['id','revision','sequence','updated_at','deleted_at','envelope_json'],
} as const;
export const LEGACY_BACKUP_CONTENT_TABLES=Object.freeze(Object.keys(tables));
function invalid():never{throw new Error('E2EE_ARCHIVE_CONTENT_INVALID');}
function object(value:unknown):asserts value is Row{if(!value||typeof value!=='object'||Array.isArray(value))invalid();}
function integer(value:unknown,min=0):asserts value is number{if(!Number.isSafeInteger(value)||(value as number)<min)invalid();}
function text(value:unknown,max=4096):asserts value is string{if(typeof value!=='string'||value.length>max)invalid();}
function id(value:unknown):asserts value is string{if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(value))invalid();}
function allowed(value:unknown,fields:readonly string[]):asserts value is Row{object(value);if(Reflect.ownKeys(value).some(key=>typeof key!=='string'||!fields.includes(key)))throw new Error('E2EE_ARCHIVE_FORMAT_UNSUPPORTED');}
function base64(value:unknown,min:number,max=min):asserts value is string {
 text(value,Math.ceil(max/3)*4);if(value.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))invalid();
 const padding=value.endsWith('==')?2:value.endsWith('=')?1:0,length=value.length/4*3-padding;
 if(length<min||length>max)invalid();const index='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.indexOf(value[value.length-padding-1]);
 if(padding===2&&(index&15)!==0||padding===1&&(index&3)!==0)invalid();
}
function envelope(value:Row):Envelope{base64(value.iv,12);base64(value.ciphertext,16,MAX+16);return{iv:value.iv,ciphertext:value.ciphertext};}
function parse(raw:unknown,max=MAX){return parseLegacyMigrationJson(raw,'E2EE_ARCHIVE_CONTENT_INVALID',max);}
function metadata(row:Row,removed:readonly string[]){return Object.fromEntries(Object.entries(row).filter(([name])=>!removed.includes(name)));}
function inputMetadata(row:Row){
 for(const name of ['expectedVersion','version','writerProtocol','minimumWriterProtocol','expectedRevision','schemaVersion'])if(row[name]!==undefined)integer(row[name]);
 for(const name of ['operationId'])if(row[name]!==undefined){text(row[name],128);if(!row[name])invalid();}
 for(const name of ['quotaUsage','metrics','dream'])if(row[name]!==undefined)object(row[name]);
 return metadata(row,['iv','ciphertext']);
}
/** These readers only replace authenticated OLD envelopes with original JSON
 * plaintext inside inert history. They expose no restoration/HTTP/rights port,
 * do not activate records, and never return a category completeness assertion.
 * Call only after the complete protected source capture. Capabilities must pin
 * the supplied originals and keep every old key out of native JavaScript. */
async function materialize(ownerId:string,kind:ArchivePlainContent['kind'],plans:Plan[],ports:ArchiveContentReaderPorts):Promise<ArchivePlainContent>{
 const entries:ArchivePlainEntry[]=[];let size=0;
 for(const plan of plans){
  ports.assertCurrent();let raw:string|null=null,document:unknown=null;
  if(plan.envelope)raw=await ports.openAccount(ownerId,{...plan.envelope},plan.purpose!);
  else if(plan.physis){if(!ports.openPhysis)throw new Error('E2EE_ARCHIVE_PHYSIS_UNLOCK_REQUIRED');raw=await ports.openPhysis(ownerId,plan.physis.id,structuredClone(plan.physis.envelope));}
  ports.assertCurrent();if(plan.envelope||plan.physis){text(raw,MAX);document=parse(raw);object(document);}
  const entry={source:plan.source,metadata:plan.metadata,rawDocument:raw,document};
  const bytes=encoder.encode(JSON.stringify(entry));try{size+=bytes.length;if(size>TOTAL)throw new Error('E2EE_SOURCE_TOO_LARGE');}finally{bytes.fill(0);}
  entries.push(entry);
 }
 ports.assertCurrent();return{format:'genesis-archive-plaintext-v1',ownerId,kind,execution:'history-only',entries};
}
export async function readLegacyArchiveOperations(raw:unknown,ownerId:string,ports:ArchiveContentReaderPorts):Promise<ArchivePlainContent>{
 assertTechnical(ownerId);ports.assertCurrent();const value=parse(raw);if(!Array.isArray(value)||value.length>1000)invalid();
 const plans:Plan[]=[],seen=new Set<string>();
 // Preflight the complete original operation list before the first key call.
 for(const candidate of value){
  allowed(candidate,['section','id','input']);const section=candidate.section;
  if(typeof section!=='string'||!['workspace','mindmaps','diary','stoicheion','aurora','recovered-tasks'].includes(section))throw new Error('E2EE_ARCHIVE_FORMAT_UNSUPPORTED');
  if(candidate.id!==undefined&&typeof candidate.id!=='string')invalid();
  const identity=candidate.id??'';if(['mindmaps','diary','recovered-tasks'].includes(section))id(identity);else if(identity!=='')invalid();
  const source=`${section}:${identity}`;if(seen.has(source))invalid();seen.add(source);
  const input=candidate.input;
  allowed(input,section==='workspace'?['iv','ciphertext','expectedVersion','version','writerProtocol','minimumWriterProtocol','quotaUsage','metrics']:
   section==='mindmaps'?['iv','ciphertext','expectedRevision','schemaVersion','operationId']:
   section==='diary'?['iv','ciphertext','expectedRevision','schemaVersion','dream']:['iv','ciphertext','expectedRevision']);
  const purposes={workspace:'workspace',mindmaps:`map:${identity}`,diary:`diary-note:v1:${identity}`,stoicheion:'stoicheion-workspace:v1',aurora:'aurora-workspace:v1','recovered-tasks':`recovered-task:v1:${identity}`};
  plans.push({source,metadata:{section,id:identity,input:inputMetadata(input)},envelope:envelope(input),purpose:purposes[section as keyof typeof purposes]});
 }
 return materialize(ownerId,'operations',plans,ports);
}
export async function readLegacyArchiveTables(raw:unknown,ownerId:string,ports:ArchiveContentReaderPorts):Promise<ArchivePlainContent>{
 assertTechnical(ownerId);ports.assertCurrent();const value=parse(raw);exactKeys(value,LEGACY_BACKUP_CONTENT_TABLES);
 const plans:Plan[]=[];let count=0;
 for(const table of LEGACY_BACKUP_CONTENT_TABLES as (keyof typeof tables)[]){
  const rows=value[table];if(!Array.isArray(rows)||rows.length>50000)invalid();const seen=new Set<string>();
  if(['workspace_blobs','personal_diary_settings','dream_journal_preferences','stoicheion_workspaces','aurora_workspaces'].includes(table)&&rows.length>1)invalid();
  for(const row of rows){
   if(++count>50000)throw new Error('E2EE_SOURCE_TOO_LARGE');exactKeys(row,tables[table]);
   for(const field of ['version','revision','schema_version','sequence','minimum_writer_protocol','writer_protocol_version','local_only','sync_enabled','removed_count'])if(row[field]!==undefined)integer(row[field]);
   for(const field of ['id','map_id','note_id'])if(row[field]!==undefined)id(row[field]);
   for(const field of ['updated_at','deleted_at'])if(row[field]!==undefined&&row[field]!==null){text(row[field],100);if(!Number.isFinite(Date.parse(row[field] as string)))invalid();}
   if(row.local_only!==undefined&&![0,1].includes(row.local_only as number)||row.sync_enabled!==undefined&&![0,1].includes(row.sync_enabled as number))invalid();
   if(table==='dream_journal_preferences'&&!['off','morning','all-day'].includes(String(row.today_mode)))invalid();
   if(table==='personal_diary_dreams'){text(row.dream_day,10);text(row.time_zone,128);}
   for(const field of ['payload_hash','command_hash'])if(row[field]!==undefined){text(row[field],64);if(!/^[a-f0-9]{64}$/.test(row[field] as string))invalid();}
   const identity=String(row.id??row.map_id??row.note_id??'singleton')+(table==='personal_mindmap_versions'?':'+row.revision:'');
   if(seen.has(identity))invalid();seen.add(identity);const plan:Plan={source:`${table}:${identity}`,metadata:metadata(row,['iv','ciphertext','envelope_json'])};
   if(table==='physis_records'){
    if(typeof row.id!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(row.id))invalid();
    if(row.deleted_at===null){text(row.envelope_json,1024*1024);const packet=parse(row.envelope_json,1024*1024);object(packet);integer(packet.keyVersion,1);
     plan.physis={id:row.id as string,envelope:validateLegacyPhysisEnvelope(packet,packet.keyVersion)};
    }else if(row.envelope_json!==null)invalid();
   }else if(Object.hasOwn(row,'iv')){
    plan.envelope=envelope(row);plan.purpose=table==='workspace_blobs'?'workspace':table==='personal_mindmaps'?`map:${row.id}`:
     table==='personal_mindmap_versions'?`map:${row.map_id}`:table==='personal_diary_notes'?`diary-note:v1:${row.id}`:
     table==='stoicheion_workspaces'?'stoicheion-workspace:v1':table==='aurora_workspaces'?'aurora-workspace:v1':`recovered-task:v1:${row.id}`;
   }
   plans.push(plan);
  }
 }
 return materialize(ownerId,'tables',plans,ports);
}
