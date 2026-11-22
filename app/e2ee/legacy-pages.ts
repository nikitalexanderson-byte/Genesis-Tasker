import {exactKeys,assertTechnical} from './keys.ts';
import {decodeE2eeBytes} from './envelope.ts';
import type {MigrationSourceContext} from './migration.ts';

type Row=Record<string,unknown>;
export type LegacyPersonalSource='mindmaps'|'physis'|'reminders';
export type LegacyPersonalPagePorts={assertCurrent:()=>void;readPage:(context:MigrationSourceContext,table:string,offset:number)=>Promise<unknown>};
const tables={mindmaps:['maps','versions','receipts','deletions'],physis:['owners','records','usedIds','receipts'],
 reminders:['habitProfiles','habitDevices','habitDeliveries','adviceDays','adviceDeliveries','sharedPreferences']} as const;
const encoder=new TextEncoder(),MAX_PAGE=16*1024*1024,MAX_TOTAL=512*1024*1024;
function invalid():never{throw new Error('E2EE_LEGACY_PAGE_INVALID');}
function integer(value:unknown,min=0):asserts value is number{if(!Number.isSafeInteger(value)||(value as number)<min||(value as number)>Number.MAX_SAFE_INTEGER-1)invalid();}
function object(value:unknown):asserts value is Row{if(!value||typeof value!=='object'||Array.isArray(value))invalid();}
function key(value:unknown,opaque:boolean):{keyMode:'account'|'client'|'empty';key:string|null}{
 exactKeys(value,['keyMode','key']);if(!['account','client','empty'].includes(String(value.keyMode)))invalid();
 if(value.keyMode==='account'){
  if(opaque){if(value.key!==null)throw new Error('E2EE_KEY_BRIDGE_FORBIDDEN');}
  else{
   if(typeof value.key!=='string'||value.key.length!==44||!/^[A-Za-z0-9+/]{43}=$/.test(value.key))invalid();
   try{const raw=atob(value.key);if(raw.length!==32||btoa(raw)!==value.key)invalid();}catch{invalid();}
  }
 }else if(value.key!==null)invalid();
 return{keyMode:value.keyMode as 'account'|'client'|'empty',key:value.key as string|null};
}

/** Transport completeness only. Private row schemas, duplicate logical IDs and
 * locked legacy vaults still require the category's lossless reconciliation.
 * No source edits, acknowledgement, ordinary sync or provider replay. */
export async function collectLegacyPersonalPages(context:MigrationSourceContext,source:LegacyPersonalSource,ports:LegacyPersonalPagePorts,
 options:{opaqueKeys?:boolean}={}):Promise<Row>{
 if(!Object.hasOwn(tables,source))invalid();const names=tables[source],opaque=options.opaqueKeys===true;context=Object.freeze({...context});
 assertTechnical(context.ownerId);assertTechnical(context.scopeId);assertTechnical(context.migrationId);integer(context.fence,1);integer(context.generation,1);decodeE2eeBytes(context.sourceHash,32).fill(0);
 const result:Row={};let header:Row|undefined,totals:Row|undefined,oldKey:{keyMode:'account'|'client'|'empty';key:string|null}={keyMode:'empty',key:null};
 let bytes=0,pages=0;
 for(const table of names){
  const rows:unknown[]=[];let offset=0;
  for(;;){
   ports.assertCurrent();if(++pages>10000)throw new Error('E2EE_SOURCE_TOO_LARGE');
   const page=structuredClone(await ports.readPage(context,table,offset));ports.assertCurrent();
   exactKeys(page,['protocol','ownerId','scopeId','migrationId','fence','sourceHash','legacyGeneration','checkpointHash','directoryRevision','table','offset','totals','rows','nextOffset','legacyKey']);
   if(page.protocol!==1||page.ownerId!==context.ownerId||page.scopeId!==context.scopeId||page.migrationId!==context.migrationId||page.fence!==context.fence||page.sourceHash!==context.sourceHash)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
   integer(page.legacyGeneration);integer(page.directoryRevision,1);decodeE2eeBytes(page.checkpointHash,32).fill(0);
   if(page.legacyGeneration>=context.generation)throw new Error('E2EE_GENERATION_REVIEW_REQUIRED');
   if(page.table!==table||page.offset!==offset||!Array.isArray(page.rows)||page.rows.length>128)invalid();
   const size=encoder.encode(JSON.stringify(page)).length;bytes+=size;if(size>MAX_PAGE||bytes>MAX_TOTAL)throw new Error('E2EE_SOURCE_TOO_LARGE');
   exactKeys(page.totals,names);let totalCount=0;for(const name of names){integer(page.totals[name]);totalCount+=page.totals[name] as number;}
   if(totalCount>1000000)throw new Error('E2EE_SOURCE_TOO_LARGE');
   const identity={protocol:page.protocol,ownerId:page.ownerId,scopeId:page.scopeId,migrationId:page.migrationId,fence:page.fence,sourceHash:page.sourceHash,
    legacyGeneration:page.legacyGeneration,checkpointHash:page.checkpointHash,directoryRevision:page.directoryRevision};
   if(!header){header=identity;totals=structuredClone(page.totals);}
   else{
    for(const name of Object.keys(header))if(header[name]!==identity[name as keyof typeof identity])invalid();
    for(const name of names)if(totals![name]!==page.totals[name])invalid();
   }
   const old=key(page.legacyKey,opaque);
   if(source==='reminders'&&old.keyMode!=='empty')invalid();
   if(old.keyMode!=='empty'){
    if(oldKey.keyMode!=='empty'&&(oldKey.keyMode!==old.keyMode||oldKey.key!==old.key))invalid();oldKey=old;
   }
   const total=page.totals[table] as number,next=offset+page.rows.length;
   if(next>total||page.nextOffset!==(next<total?next:null)||next<total&&next===offset)invalid();
   // Do not normalize/project row JSON here. The category must retain unknown
   // private fields or refuse before it can mark this source complete.
   for(const row of page.rows){object(row);rows.push(row);}
   if(page.nextOffset===null){if(rows.length!==total)invalid();break;}
   integer(page.nextOffset,1);offset=page.nextOffset;
  }
  result[table]=rows;
 }
 ports.assertCurrent();return{...header,...result,legacyKey:oldKey};
}
