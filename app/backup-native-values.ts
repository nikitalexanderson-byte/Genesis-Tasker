import type {BackupMigrationForm} from './backup-migration-memory.ts';
import {nativeBackupFileOrigin} from './backup-native-file.ts';

/** Staged local-only transport. It is not wired into the production renderer
 * until the native receiver and complete source preservation are implemented. */
export type NativeBackupValueManifest=Readonly<{protocol:2;fields:readonly Readonly<{name:string;id:string}>[];
 settled:boolean;file:Readonly<{id:string;name:string;type:string;size:number;lastModified:number}>|null}>;
type Ports={check:()=>void;operationId:()=>string;
 value:(name:string,id:string,index:number,last:boolean,text:string,operationId:string)=>string;
 commit:(manifest:string,operationId:string)=>string};
type Value=Readonly<{raw:string;id:string}>;
const MAX=96*1024*1024,CHUNK=131072;
function acknowledge(result:string){if(result!=='')throw new Error(/^(?:E2EE|BACKUP)_[A-Z_]{1,100}$/.test(result)?result:'BACKUP_NATIVE_FAILED');}

/** Serializes every current value before publication, then reuses only EXACT
 * serialized matches. Object identity alone would miss an in-place change.
 * The accepted cache changes only after the complete manifest is acknowledged.
 * Raw strings stay in this view's memory, never plaintext storage or HTTP. */
export function nativeBackupValueRetainer(ports:Ports){
 let accepted=new Map<string,Value>(),previousManifest='',closed=false;
 const check=()=>{if(closed)throw new Error('BACKUP_VIEW_CLOSED');ports.check();};
 return{
  retain(form:BackupMigrationForm){
   check();let file:NativeBackupValueManifest['file']=null;
   if(form.file){const origin=nativeBackupFileOrigin(form.file);if(!origin)throw new Error('E2EE_ARCHIVE_FILE_ORIGIN_REQUIRED');
    file={id:origin.id,name:form.file.name,type:form.file.type,size:form.file.size,lastModified:form.file.lastModified};}
   if(typeof form.settled!=='boolean'||!form.state||typeof form.state!=='object'||Array.isArray(form.state))throw new Error('E2EE_ARCHIVE_SOURCE_INVALID');
   const state=form.state as Record<string,unknown>;
   const candidates:{name:string;raw:string;previous:Value|undefined}[]=[],names=Object.keys(state);
   if(names.length>64)throw new Error('E2EE_SOURCE_TOO_LARGE');
   let characters=JSON.stringify({protocol:1,state:{},settled:form.settled,file}).length;
   for(const name of names){
    if(!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)||['__proto__','prototype','constructor'].includes(name))throw new Error('E2EE_ARCHIVE_SOURCE_INVALID');
    const raw=JSON.stringify(state[name]);if(raw===undefined)continue;
    characters+=JSON.stringify(name).length+1+raw.length+(candidates.length?1:0);
    if(characters>MAX)throw new Error('E2EE_SOURCE_TOO_LARGE');
    const previous=accepted.get(name);
    // Do not keep a second large serialization when its content is unchanged.
    candidates.push({name,raw:previous?.raw===raw?previous.raw:raw,previous});
   }
   const skeleton:NativeBackupValueManifest={protocol:2,fields:candidates.map(row=>({name:row.name,id:'00000000-0000-0000-0000-000000000000'})),settled:form.settled,file};
   if(JSON.stringify(skeleton).length>32768)throw new Error('E2EE_SOURCE_TOO_LARGE');
   check();const token=ports.operationId(),next=new Map<string,Value>(),fields:{name:string;id:string}[]=[];
   for(const row of candidates){
    let value=row.previous;
    if(!value||value.raw!==row.raw){
     const id=crypto.randomUUID();
     for(let offset=0,index=0;offset<row.raw.length;offset+=CHUNK,index++){
      check();acknowledge(ports.value(row.name,id,index,offset+CHUNK>=row.raw.length,row.raw.slice(offset,offset+CHUNK),token));
     }
     value={raw:row.raw,id};
    }
    next.set(row.name,value);fields.push({name:row.name,id:value.id});
   }
   const manifest:NativeBackupValueManifest={protocol:2,fields,settled:form.settled,file},raw=JSON.stringify(manifest);
   if(raw.length>32768)throw new Error('E2EE_SOURCE_TOO_LARGE');
   check();if(raw!==previousManifest){acknowledge(ports.commit(raw,token));check();}
   accepted=next;previousManifest=raw;
  },
  clear(){accepted.clear();previousManifest='';closed=true;},
  toString:()=> 'NativeBackupValueRetainer([redacted])',
 };
}
