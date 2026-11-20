import {assertTechnical,exactKeys} from './keys.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import type {NativeBackupValueManifest} from '../backup-native-values.ts';

type Row=Record<string,unknown>;
type Context=Readonly<{ownerId:string;sessionEpoch:number;viewId:string}>;
type Value=Readonly<{id:string;name:string;rawJson:string;value:unknown}>;
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,encoder=new TextEncoder(),MAX=48*1024*1024;
function invalid():never{throw new Error('E2EE_ARCHIVE_SOURCE_INVALID');}
function integer(value:unknown):asserts value is number{if(!Number.isSafeInteger(value)||(value as number)<0)invalid();}
function identifier(value:unknown):asserts value is string{if(typeof value!=='string'||!uuid.test(value))invalid();}
function text(value:unknown,max:number):asserts value is string{if(typeof value!=='string'||value.length>max)invalid();}
function fieldName(value:unknown):asserts value is string{
 text(value,64);if(!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)||['__proto__','prototype','constructor'].includes(value))invalid();
}
function selectedFile(value:unknown):NativeBackupValueManifest['file'] {
 if(value===null)return null;
 exactKeys(value,['id','name','type','size','lastModified']);identifier(value.id);text(value.name,4096);text(value.type,1024);integer(value.size);
 if(value.size>24*1024*1024||!Number.isSafeInteger(value.lastModified))invalid();
 return Object.freeze({...value}) as NonNullable<NativeBackupValueManifest['file']>;
}

/** Staged source-only v2 reader. The enclosing forms collector MUST verify
 * original owner/view/epoch, native frame integrity and selected binary origin.
 * Every raw candidate, including unreferenced values, is validated/preserved.
 * No key/HTTP/restore/prune port and no complete or executable authority. */
export function normalizeNativeArchiveValues(input:unknown,expected:Context,current:()=>void){
 const context=Object.freeze({...expected});
 assertTechnical(context.ownerId);identifier(context.viewId);integer(context.sessionEpoch);current();
 exactKeys(input,['protocol','ownerId','sessionEpoch','viewId','rawManifest','rawManifests','values']);
 if(input.protocol!==2||input.ownerId!==context.ownerId||input.sessionEpoch!==context.sessionEpoch||input.viewId!==context.viewId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
 if(!Array.isArray(input.values)||input.values.length>10000||!Array.isArray(input.rawManifests)||input.values.length+input.rawManifests.length>10000)invalid();
 const rawManifest=input.rawManifest;
 if(rawManifest!==null)text(rawManifest,32768);
 let budget=0;
 const charge=(raw:string)=>{const bytes=encoder.encode(raw);try{budget+=bytes.length;if(budget>MAX)throw new Error('E2EE_SOURCE_TOO_LARGE');}finally{bytes.fill(0);}};
 const values:Value[]=[],byId=new Map<string,Value>();
 for(const row of input.values){
  current();exactKeys(row,['id','name','rawJson']);identifier(row.id);fieldName(row.name);text(row.rawJson,MAX);
  if(byId.has(row.id))invalid();charge(row.rawJson);
  const value=Object.freeze({id:row.id,name:row.name,rawJson:row.rawJson,value:parseLegacyMigrationJson(row.rawJson,'E2EE_ARCHIVE_SOURCE_INVALID',MAX)});
  values.push(value);byId.set(row.id,value);
 }
 const parseManifest=(raw:string)=>{
  current();text(raw,32768);charge(raw);
  const parsed=parseLegacyMigrationJson(raw,'E2EE_ARCHIVE_SOURCE_INVALID',128*1024);exactKeys(parsed,['protocol','fields','settled','file']);
  if(parsed.protocol!==2||typeof parsed.settled!=='boolean'||!Array.isArray(parsed.fields)||parsed.fields.length>64)invalid();
  const names=new Set<string>(),fields:{name:string;id:string}[]=[],entries:[string,unknown][]=[];
  for(const row of parsed.fields){
   exactKeys(row,['name','id']);identifier(row.id);fieldName(row.name);
   if(names.has(row.name))invalid();names.add(row.name);
   const value=byId.get(row.id);if(!value||value.name!==row.name)throw new Error('E2EE_ARCHIVE_VALUE_ORIGIN_REQUIRED');
   fields.push(Object.freeze({name:row.name,id:row.id}));entries.push([row.name,value.value]);
  }
  return Object.freeze({manifest:Object.freeze({protocol:2 as const,fields:Object.freeze(fields),settled:parsed.settled,file:selectedFile(parsed.file)}),state:Object.freeze(Object.fromEntries(entries))});
 };
 const rawManifests=input.rawManifests.map(raw=>{text(raw,32768);return raw;});
 if(rawManifest===null?rawManifests.length!==0:rawManifests.at(-1)!==rawManifest)throw new Error('E2EE_ARCHIVE_MANIFEST_HISTORY_REQUIRED');
 const manifests=rawManifests.map(parseManifest),active=manifests.at(-1);
 const manifest:NativeBackupValueManifest|null=active?.manifest??null,state:Readonly<Row>|null=active?.state??null;
 current();return Object.freeze({protocol:2 as const,execution:'source-input' as const,ownerId:context.ownerId,sessionEpoch:context.sessionEpoch,viewId:context.viewId,
  rawManifest,rawManifests:Object.freeze(rawManifests),manifests:Object.freeze(manifests),manifest,state,values:Object.freeze(values)});
}
