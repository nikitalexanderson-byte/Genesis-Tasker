import {assertTechnical} from './keys.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {captureSharedEditorIndexedOriginals} from '../shared-editor-indexed-storage.ts';
import {captureLocalWorkMigrationMemory} from '../local-work-migration-memory.ts';
import type {PrivateScopeKind} from './private-paths.ts';
import {capturePrivateLocalValues} from './local-work-values.ts';
import {captureMountedBackupMigrationSources} from '../backup-sources.ts';
import {materializePersonalMigrationSources} from '../personal-migration-memory.ts';

export type PrivatePathLocalEntry={store:string;key:string;raw:string;content:unknown;spaceId:string|null;projectId:string|null};
export type PrivatePathLocalInventory={platform:'web'|'android';entries:PrivatePathLocalEntry[];editors:unknown[];inventoryVersion:1};
const encoder=new TextEncoder(),MAX=64*1024*1024;
type Target={ownerId:string;kind:PrivateScopeKind;resourceId:string;pathId:string};
/** Enumerate unmounted owner journals from BOTH stores, not just React state.
 * Decryption is local and pinned to the captured key/purpose; capture never
 * drains a command or invokes a network/restore endpoint. */
export async function captureWebPrivatePathLocal(target:Target,ports:{storage:Pick<Storage,'length'|'key'|'getItem'>;assertCurrent:()=>void;
 open:(envelope:{iv:string;ciphertext:string},purpose:string)=>Promise<string>}):Promise<PrivatePathLocalInventory>{
 const binding=Object.freeze({...target});assertTechnical(binding.ownerId);assertTechnical(binding.resourceId);ports.assertCurrent();
 const draft=`genesis-shared-work-drafts-v1:${binding.ownerId}:`,maps=`genesis-shared-mindmaps:${binding.ownerId}:`,pending=`genesis-pending-mutations-v2:${binding.ownerId}`;
 const readStorage=()=>{const rows:{key:string;raw:string}[]=[];for(let i=0;i<ports.storage.length;i++){
  const key=ports.storage.key(i);if(!key||!key.startsWith(draft)&&!key.startsWith(maps)&&key!==pending&&!key.startsWith(pending+':'))continue;
  const raw=ports.storage.getItem(key);if(raw!==null)rows.push({key,raw});if(rows.length>10000)throw new Error('E2EE_SOURCE_TOO_LARGE');
 }return rows.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);};
 const stored=readStorage(),mounted=await capturePrivateLocalValues(captureLocalWorkMigrationMemory(binding.ownerId),ports.assertCurrent) as ReturnType<typeof captureLocalWorkMigrationMemory>,indexed=await captureSharedEditorIndexedOriginals(binding.ownerId,ports.assertCurrent);ports.assertCurrent();
 const productForms=binding.kind==='personal'?await captureMountedBackupMigrationSources(binding.ownerId,ports.assertCurrent):null;ports.assertCurrent();
 const personalForms=binding.kind==='personal'?await materializePersonalMigrationSources(binding.ownerId,ports.assertCurrent):null;ports.assertCurrent();
 const entries:PrivatePathLocalEntry[]=[];let size=0;
 const parse=(raw:string)=>parseLegacyMigrationJson(raw,'E2EE_LOCAL_WORK_SOURCE_INVALID',MAX);
 for(const [store,rows]of [['localStorage',stored],['indexedDB',indexed]] as const)for(const row of rows){
  ports.assertCurrent();size+=encoder.encode(row.raw).length;if(size>MAX)throw new Error('E2EE_SOURCE_TOO_LARGE');
  const value=parse(row.raw);let content:unknown=value,spaceId:string|null=null,projectId:string|null=null;
  if(row.key.startsWith(draft)){
   const match=/^([^:]+):([^:]+):([^:]+)$/.exec(row.key.slice(draft.length));
   if(!match||!value||typeof value!=='object'||Array.isArray(value))throw new Error('E2EE_LOCAL_WORK_SOURCE_INVALID');
   const envelope=value as Record<string,unknown>;if(envelope.version!==1||envelope.id!==match[3]||typeof envelope.iv!=='string'||typeof envelope.ciphertext!=='string')throw new Error('E2EE_LOCAL_WORK_SOURCE_INVALID');
   const opened=parse(await ports.open({iv:envelope.iv,ciphertext:envelope.ciphertext},`shared-work-draft:${match[1]}:${match[2]}:${match[3]}`));ports.assertCurrent();
   if(!opened||typeof opened!=='object'||Array.isArray(opened))throw new Error('E2EE_LOCAL_WORK_SOURCE_INVALID');const plain=opened as Record<string,unknown>;
   if(plain.userId!==binding.ownerId||plain.projectId!==match[1]||plain.purpose!==match[2]||plain.id!==match[3]||plain.at!==envelope.at)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
   projectId=match[1];const editor=plain.value as Record<string,unknown>|null;spaceId=typeof editor?.spaceId==='string'?editor.spaceId:null;content=plain;
  }else if(row.key.startsWith(maps)){
   // These entries include maps for multiple projects. Keep them exclusively
   // in personal.local-work until map ownership is authenticated by its source.
   if(binding.kind!=='personal')continue;
   const split=row.key.slice(maps.length).indexOf(':');if(split<1)throw new Error('E2EE_LOCAL_WORK_SOURCE_INVALID');
   spaceId=row.key.slice(maps.length,maps.length+split);const suffix=row.key.slice(maps.length+split+1);
   const open=async(packet:unknown,purpose:string)=>{if(!packet||typeof packet!=='object'||Array.isArray(packet))throw new Error('E2EE_LOCAL_WORK_SOURCE_INVALID');const item=packet as Record<string,unknown>;
    if(typeof item.iv!=='string'||typeof item.ciphertext!=='string')throw new Error('E2EE_LOCAL_WORK_SOURCE_INVALID');return parse(await ports.open({iv:item.iv,ciphertext:item.ciphertext},`shared:${spaceId}:${purpose}`));};
   if(suffix==='cache'){if(!Array.isArray(value))throw new Error('E2EE_LOCAL_WORK_SOURCE_INVALID');const records=[];for(const packet of value){const item=packet as Record<string,unknown>;if(typeof item?.id!=='string')throw new Error('E2EE_LOCAL_WORK_SOURCE_INVALID');records.push({metadata:item,document:await open(item,`map:${item.id}`)});}content=records;}
   else{const parts=suffix.split(':');const type=parts[0],id=parts.at(-1);if(!id||!['draft','request','view','conversion'].includes(type))throw new Error('E2EE_LOCAL_WORK_SOURCE_INVALID');
    const purpose=type==='view'?`view:${id}`:type==='conversion'?`conversion:${parts[1]}:${parts[2]}`:`map:${id}`;content={metadata:value,document:await open(value,purpose)};}
  }else{
   if(binding.kind!=='personal')continue;
   // A captured queue is not a credential or an executable new-generation job.
   // Headers remain in the protected original only.
   const sanitize=(item:unknown):unknown=>{if(Array.isArray(item))return item.map(sanitize);if(!item||typeof item!=='object')return item;
    return Object.fromEntries(Object.entries(item).filter(([key])=>!['headers','authorization','cookie','csrf','accessToken','refreshToken'].includes(key)).map(([key,child])=>[key,sanitize(child)]));};content=sanitize(value);
  }
  if(binding.kind==='project'&&projectId!==binding.resourceId||binding.kind==='space'&&(spaceId!==binding.resourceId||projectId!==null&&projectId!==binding.resourceId))continue;
  entries.push({store,key:row.key,raw:row.raw,content,spaceId,projectId});
 }
 const afterIndexed=await captureSharedEditorIndexedOriginals(binding.ownerId,ports.assertCurrent);ports.assertCurrent();
 const afterMounted=await capturePrivateLocalValues(captureLocalWorkMigrationMemory(binding.ownerId),ports.assertCurrent);ports.assertCurrent();
 const afterProductForms=binding.kind==='personal'?await captureMountedBackupMigrationSources(binding.ownerId,ports.assertCurrent):null;ports.assertCurrent();
 const afterPersonalForms=binding.kind==='personal'?await materializePersonalMigrationSources(binding.ownerId,ports.assertCurrent):null;ports.assertCurrent();
 if(JSON.stringify(stored)!==JSON.stringify(readStorage())||JSON.stringify(indexed)!==JSON.stringify(afterIndexed)||JSON.stringify(mounted)!==JSON.stringify(afterMounted)||JSON.stringify(productForms)!==JSON.stringify(afterProductForms)||JSON.stringify(personalForms)!==JSON.stringify(afterPersonalForms))throw new Error('E2EE_LOCAL_WORK_CAPTURE_CHANGED');
 const editors=mounted.filter(row=>binding.kind==='personal'||binding.kind==='project'&&row.projectId===binding.resourceId||binding.kind==='space'&&row.spaceId===binding.resourceId&&row.projectId===binding.resourceId);
 if(productForms!==null)editors.push({ownerId:binding.ownerId,spaceId:'personal',projectId:binding.ownerId,source:'mounted-product-sources-v1',mounted:true,value:productForms});
 if(personalForms!==null)editors.push({ownerId:binding.ownerId,spaceId:'personal',projectId:binding.ownerId,source:'personal-product-sources-v1',mounted:true,value:personalForms});
 if(editors.length>1000)throw new Error('E2EE_SOURCE_TOO_LARGE');
 return{platform:'web',inventoryVersion:1,entries,editors};
}
