import {exactKeys} from './keys.ts';
import {canonicalJson} from '../aurora/forecast.ts';
import {parseDiaryMigrationJson,type DiaryMigrationMemory} from './diary-source.ts';

type Row=Record<string,unknown>;
function invalid():never{throw new Error('E2EE_DIARY_SOURCE_INVALID');}
function object(value:unknown):asserts value is Row{if(!value||typeof value!=='object'||Array.isArray(value))invalid();}
function integer(value:unknown):asserts value is number{if(!Number.isSafeInteger(value)||(value as number)<0)invalid();}
function list(value:unknown):asserts value is unknown[]{if(!Array.isArray(value)||value.length>10000)invalid();}
/** Only native authenticates LocalCipher/Room data. Check its original JSON text
 * before JSONObject projection can hide duplicate decoded names. Old ciphertext
 * and native metadata remain inside the device-only source/output, never cloud. */
export function normalizeNativeDiaryCapture(input:unknown,assertCurrent:()=>void){
 assertCurrent();exactKeys(input,['protocol','ownerId','scopeId','capturedAt','generation','pendingGeneration','documents','caches','mounted','memory']);
 if(input.protocol!==1||typeof input.ownerId!=='string'||typeof input.scopeId!=='string'||typeof input.capturedAt!=='string'||!Number.isFinite(Date.parse(input.capturedAt)))invalid();
 integer(input.generation);if(input.pendingGeneration!==null)throw new Error('E2EE_DIARY_GENERATION_REVIEW_REQUIRED');list(input.documents);list(input.caches);
 exactKeys(input.memory,['ownerId','legacyKey','generation','reconciliationRequired','records','editors']);
 if(input.memory.ownerId!==input.ownerId||input.memory.legacyKey!==''||input.memory.generation!==input.generation||input.memory.reconciliationRequired!==false
  ||!Array.isArray(input.memory.records)||input.memory.records.length||!Array.isArray(input.memory.editors)||input.memory.editors.length)invalid();
 const kinds=new Set<string>();for(const row of input.documents){exactKeys(row,['kind','revision','encrypted']);if(typeof row.kind!=='string'||kinds.has(row.kind)||typeof row.encrypted!=='string'||!row.encrypted)invalid();integer(row.revision);kinds.add(row.kind);
  if(row.kind!=='diary-v1'&&row.kind!=='aurora-account-key'&&!/^diary-v1\/[a-f0-9-]{36}\/(?:0|[1-9]\d{0,3})$/.test(row.kind))throw new Error('E2EE_DIARY_FORMAT_UNSUPPORTED');
 }
 const names=new Set<string>(),roots:Row[]=[];let primary:Row|null=null;
 for(const row of input.caches){exactKeys(row,['source','plain']);if(typeof row.source!=='string'||typeof row.plain!=='string'||names.has(row.source)||row.source!=='diary-v1'&&!/^diary-v1\/[a-f0-9-]{36}$/.test(row.source))invalid();names.add(row.source);
  const value=parseDiaryMigrationJson(row.plain);exactKeys(value,['version','owner','hasCache','settings','dreamSettings','deleted','records','drafts']);
  if(value.version!==1||value.owner!==input.ownerId||typeof value.hasCache!=='boolean')throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  list(value.deleted);list(value.records);list(value.drafts);roots.push(value);if(row.source==='diary-v1')primary=value;
 }
 if(kinds.has('diary-v1')!==(primary!==null)||!primary&&input.caches.length)invalid();
 const generations=new Set([...kinds].filter(kind=>kind.startsWith('diary-v1/')).map(kind=>kind.split('/').slice(0,2).join('/')));
 const rootDocument=input.documents.find(row=>{object(row);return row.kind==='diary-v1';});
 if(rootDocument){object(rootDocument);const encrypted=rootDocument.encrypted as string,prefix='genesis-diary-chunks-v1:';
  if(encrypted.startsWith(prefix)){const manifest=parseDiaryMigrationJson(encrypted.slice(prefix.length));if(!Array.isArray(manifest)||manifest.length!==3)invalid();
   const [generation,count,length]=manifest;if(typeof generation!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(generation))invalid();integer(count);integer(length);if(count<1||count>4096)invalid();
   let size=0;for(let index=0;index<count;index++){const row=input.documents.find(row=>{object(row);return row.kind===`diary-v1/${generation}/${index}`;});if(!row)invalid();object(row);size+=(row.encrypted as string).length;}
   if(size!==length||[...kinds].filter(kind=>kind.startsWith(`diary-v1/${generation}/`)).length!==count)invalid();
  }
 }
 for(const generation of generations)if(!names.has(generation))throw new Error('E2EE_DIARY_NATIVE_HISTORY_REVIEW_REQUIRED');
 for(const source of names)if(source!=='diary-v1'&&!generations.has(source))invalid();
 if(primary)for(const value of roots)if(canonicalJson(value)!==canonicalJson(primary))throw new Error('E2EE_DIARY_NATIVE_HISTORY_REVIEW_REQUIRED');
 const records:unknown[]=[],editors:unknown[]=[];
 if(primary)for(const [kind,rows]of [['records',primary.records],['drafts',primary.drafts]]as const){list(rows);const seen=new Set<string>();
  for(const row of rows){exactKeys(row,['note','revision','draftKey','pending','pendingNote','localOnly','uploadId']);object(row.note);integer(row.revision);
   const key=kind==='records'?row.note.id:row.draftKey;if(typeof key!=='string'||!key||seen.has(key)||typeof row.localOnly!=='boolean'||(kind==='records')!==(row.draftKey===null)
    ||(row.pending===null)!==(row.pendingNote===null)||kind==='records'&&row.pending!==null)invalid();seen.add(key);
   records.push({...row,source:'room:'+key});
  }
 }
 if(input.mounted!==null){exactKeys(input.mounted,['records','editors']);list(input.mounted.records);list(input.mounted.editors);for(const row of input.mounted.records){object(row);records.push({...row,source:'mounted:'+String(row.draftKey??(row.note as Row)?.id)});}editors.push(...input.mounted.editors);}
 const prefix=`genesis-diary-v1:${input.ownerId}:`;
 const entries=[{key:prefix+'cache',value:null},{key:prefix+'deleted',value:primary?JSON.stringify(primary.deleted):null},
  {key:prefix+'settings',value:primary?JSON.stringify(primary.settings):null},{key:prefix+'dream-settings',value:primary?JSON.stringify(primary.dreamSettings):null}];
 const memory:DiaryMigrationMemory={ownerId:input.ownerId,legacyKey:'',generation:input.generation,reconciliationRequired:false,records,editors};
 assertCurrent();return{snapshot:{protocol:1,ownerId:input.ownerId,scopeId:input.scopeId,capturedAt:input.capturedAt,entries,memory},
  metadata:{protocol:1,ownerId:input.ownerId,documents:input.documents.map(row=>{object(row);return{kind:row.kind,revision:row.revision};}),caches:input.caches,mounted:input.mounted,execution:'history-only'}};
}
