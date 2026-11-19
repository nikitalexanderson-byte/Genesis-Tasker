import {exactKeys} from './keys.ts';
import {parseMindmapsMigrationJson,type MindmapsMigrationMemory} from './mindmaps-source.ts';

type Row=Record<string,unknown>;
function invalid():never{throw new Error('E2EE_MINDMAPS_SOURCE_INVALID');}
function object(value:unknown):asserts value is Row{if(!value||typeof value!=='object'||Array.isArray(value))invalid();}
function integer(value:unknown):asserts value is number{if(!Number.isSafeInteger(value)||(value as number)<0)invalid();}
function list(value:unknown):asserts value is unknown[]{if(!Array.isArray(value)||value.length>10000)invalid();}

/** Only native authenticates LocalCipher and opens old account wrappers. Keep
 * its original JSON text through duplicate-name validation before projection. */
export function normalizeNativeMindmapsCapture(input:unknown,assertCurrent:()=>void){
 assertCurrent();exactKeys(input,['protocol','ownerId','scopeId','capturedAt','generation','pendingGeneration','documents','caches','mounted','memory']);
 if(input.protocol!==1||typeof input.ownerId!=='string'||typeof input.scopeId!=='string'||typeof input.capturedAt!=='string'||!Number.isFinite(Date.parse(input.capturedAt)))invalid();
 integer(input.generation);if(input.pendingGeneration!==null)throw new Error('E2EE_MINDMAPS_GENERATION_REVIEW_REQUIRED');list(input.documents);list(input.caches);
 exactKeys(input.memory,['ownerId','legacyKey','generation','reconciliationRequired','records','editors','localWork']);
 if(input.memory.ownerId!==input.ownerId||input.memory.legacyKey!==''||input.memory.generation!==input.generation||input.memory.reconciliationRequired!==false)invalid();
 for(const name of ['records','editors','localWork']){list(input.memory[name]);if(input.memory[name].length)invalid();}
 const kinds=new Set<string>(),plain=new Map<string,unknown>();
 for(const row of input.documents){exactKeys(row,['kind','revision','encrypted']);if(typeof row.kind!=='string'||kinds.has(row.kind)||typeof row.encrypted!=='string'||!row.encrypted)invalid();integer(row.revision);kinds.add(row.kind);
  if(!['mindmaps','mindmap-conversion','aurora-account-key'].includes(row.kind)&&!/^mindmap-view:[a-zA-Z0-9_-]{1,100}$/.test(row.kind))throw new Error('E2EE_MINDMAPS_FORMAT_UNSUPPORTED');
 }
 for(const row of input.caches){exactKeys(row,['kind','plain']);if(typeof row.kind!=='string'||typeof row.plain!=='string'||!kinds.has(row.kind)||row.kind==='aurora-account-key'||plain.has(row.kind))invalid();plain.set(row.kind,parseMindmapsMigrationJson(row.plain));}
 if([...kinds].some(kind=>kind!=='aurora-account-key'&&!plain.has(kind)))invalid();
 const records:unknown[]=[],editors:unknown[]=[],localWork:unknown[]=[];
 const cache=plain.get('mindmaps');if(cache!==undefined){list(cache);const seen=new Set<string>();for(const row of cache){exactKeys(row,['document','revision','pending','pendingDocument','dirty']);object(row.document);integer(row.revision);
   if(typeof row.document.id!=='string'||seen.has(row.document.id)||typeof row.dirty!=='boolean'||(row.pending===null)!==(row.pendingDocument===null))invalid();seen.add(row.document.id);
   records.push({...row,source:'room:'+row.document.id});
  }}
 for(const [kind,value]of plain)if(kind!=='mindmaps'){object(value);if(kind==='mindmap-conversion')localWork.push({source:'room:'+kind,kind:'conversion',value});
  else localWork.push({source:'room:'+kind,kind:'view',mapId:kind.slice('mindmap-view:'.length),value});
 }
 if(input.mounted!==null){exactKeys(input.mounted,['records','editors']);list(input.mounted.records);list(input.mounted.editors);
  for(const row of input.mounted.records){object(row);object(row.document);records.push({...row,source:'mounted:'+row.document.id});}editors.push(...input.mounted.editors);
 }
 const memory:MindmapsMigrationMemory={ownerId:input.ownerId,legacyKey:'',generation:input.generation,reconciliationRequired:false,records,editors,localWork};
 assertCurrent();return{snapshot:{protocol:1,ownerId:input.ownerId,scopeId:input.scopeId,capturedAt:input.capturedAt,entries:[{key:`genesis-mindmaps:${input.ownerId}:cache`,value:null}],memory},
  metadata:{protocol:1,ownerId:input.ownerId,documents:input.documents.map(row=>{object(row);return{kind:row.kind,revision:row.revision};}),caches:input.caches,mounted:input.mounted,execution:'history-only'}};
}
