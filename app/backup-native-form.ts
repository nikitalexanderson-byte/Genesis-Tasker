import type {BackupMigrationForm} from './backup-migration-memory.ts';
import {nativeBackupFileOrigin} from './backup-native-file.ts';

type Ports={check:()=>void;operationId:()=>string;
 submit:(id:string,index:number,last:boolean,text:string,operationId:string)=>string};
/** Synchronous acknowledgement precedes the React state update. Only a file ID
 * references native-owned bytes; neither paths nor provider URIs are exposed. */
export function retainNativeBackupForm(form:BackupMigrationForm,ports:Ports){
 ports.check();let file:unknown=null;
 if(form.file){const origin=nativeBackupFileOrigin(form.file);if(!origin)throw new Error('E2EE_ARCHIVE_FILE_ORIGIN_REQUIRED');
  file={id:origin.id,name:form.file.name,type:form.file.type,size:form.file.size,lastModified:form.file.lastModified};}
 const raw=JSON.stringify({protocol:1,state:form.state,settled:form.settled,file});
 const bytes=new TextEncoder().encode(raw);try{if(bytes.length>32*1024*1024)throw new Error('E2EE_SOURCE_TOO_LARGE');}finally{bytes.fill(0);}
 const id=crypto.randomUUID(),token=ports.operationId();
 for(let offset=0,index=0;offset<raw.length;offset+=131072,index++){
  ports.check();const result=ports.submit(id,index,offset+131072>=raw.length,raw.slice(offset,offset+131072),token);
  if(result!=='')throw new Error(/^(?:E2EE|BACKUP)_[A-Z_]{1,100}$/.test(result)?result:'BACKUP_NATIVE_FAILED');
 }
 ports.check();
}
