import type {BackupPanelRuntime} from './BackupPanel';
import {withBackupOperation} from './cloud-sync';
import {BACKUP_NOTICE_VERSION,materializeDeviceBackup,materializeServerBackup,retainBackupSafety} from './backup-device';
import {prepareBackupRestore} from './backup-restore';

/** Explicit operation-bound ports cover the whole job, not a mutable global
 * permit. Nested crypto/IO/file work is tracked and drained before exclusion
 * ends; it cannot reacquire a lock behind its own waiting migration. */
export async function withWebBackupRuntime<T>(ownerId:string,base:BackupPanelRuntime,action:(runtime:BackupPanelRuntime)=>Promise<T>):Promise<T>{
 const current=base.captureAccountSessionGuard();current();let restart=false;
 const result=await withBackupOperation(ownerId,async ports=>{
  const owner=(candidate:string)=>{ports.access.check();if(candidate!==ownerId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');};
  const bound:BackupPanelRuntime={...base,withOperation:undefined,
   restart:()=>{ports.access.check();restart=true;},
   backupRequest:ports.request,authorizeBackup:()=>ports.request('/authorize',{noticeVersion:BACKUP_NOTICE_VERSION}),
   freezeBackupDevice:candidate=>ports.run(async()=>{owner(candidate);return base.freezeBackupDevice(candidate);}),
   materializeDeviceBackup:frozen=>ports.run(async()=>{owner(frozen.owner);return materializeDeviceBackup(frozen,ports.access);}),
   retainBackupSafety:frozen=>ports.run(async()=>{owner(frozen.owner);return retainBackupSafety(frozen,localStorage,ports.access);}),
   materializeServerBackup:(candidate,evidence)=>ports.run(async()=>{owner(candidate);return materializeServerBackup(candidate,evidence,{access:ports.access,openWorkspace:ports.openWorkspace});}),
   prepareBackupRestore:(payload,candidate,selected,mode,choices)=>ports.run(async()=>{owner(candidate);return prepareBackupRestore(payload,candidate,selected,mode,
    {access:ports.access,current:ports.current,sealWorkspace:ports.sealWorkspace},choices);}),
   captureAccountSessionGuard:()=>ports.access.check,
   holdBackupStaleChanges:candidate=>ports.run(async()=>{owner(candidate);return ports.hold();}),
   download:(content,id)=>ports.run(async()=>{await base.download(content,id);}),
   readFile:base.readFile?()=>ports.run(()=>base.readFile!()):undefined,
  };
  const result=await action(bound);ports.access.check();return result;
 });
 current();if(restart)(base.restart??(()=>window.location.reload()))();return result;
}
