import {withWebBackupRuntime} from '../../app/backup-web-operations';
import {restoreOfflineWorkspaceSession,captureAccountSessionGuard,backupRequest,backupNeedsReconciliation,holdBackupStaleChanges} from '../../app/cloud-sync';
import {freezeBackupDevice,materializeDeviceBackup,materializeServerBackup,retainBackupSafety,authorizeBackup} from '../../app/backup-device';
import {prepareBackupRestore} from '../../app/backup-restore';
import {registerBackupSource} from '../../app/backup-sources';
import type {BackupPanelRuntime} from '../../app/BackupPanel';
import {WebLegacyTransportGate,WebMigrationTransportFence,IndexedDbLegacyTransportMarkers,legacyTransportLock} from '../../app/e2ee/legacy-transport-fence';
import {readNativeBackupFile,nativeBackupFileOrigin} from '../../app/backup-native-file';
import {registerBackupMigrationEditor,captureBackupMigrationEditors} from '../../app/backup-migration-memory';

/** Real browser LockManager/IDB/crypto and actual cloud backup ports. Network is
 * forbidden by the own loopback page's CSP. Only synthetic owner/key/data exist. */
export async function checkWholeBackupOperation(check:(name:string,passed:boolean)=>void){
 const owner='synthetic-backup-job-'+crypto.randomUUID(),key=btoa('c'.repeat(32));
 localStorage.setItem(`genesis-workspace-device-key-v2:${owner}`,JSON.stringify({key,recoveryCode:key}));
 check('whole-backup check restores only its synthetic offline workspace',restoreOfflineWorkspaceSession(owner));
 const current=captureAccountSessionGuard(),markers=new IndexedDbLegacyTransportMarkers();
 const fence=new WebMigrationTransportFence(new WebLegacyTransportGate(markers,navigator.locks),owner,`personal:${owner}`,current);
 let release!:()=>void,entered!:()=>void;
 const waiting=new Promise<void>(resolve=>{entered=resolve;}),resume=new Promise<void>(resolve=>{release=resolve;});
 const history=`genesis-backup-history-v1:${owner}`;let downloads=0,captured=false,captures=0;
 const remove=registerBackupSource('workspace',{owner,capture:()=>({tasks:[{id:'synthetic-only-copy',title:'Unsent synthetic content'}]})});
 const base:BackupPanelRuntime={authorizeBackup,backupRequest,backupNeedsReconciliation,captureAccountSessionGuard,holdBackupStaleChanges,
  freezeBackupDevice:async candidate=>{captures++;entered();await resume;return freezeBackupDevice(candidate);},
  materializeDeviceBackup,materializeServerBackup,retainBackupSafety,
  prepareBackupRestore:(payload,candidate,selected,mode,choices)=>prepareBackupRestore(payload,candidate,selected,mode,undefined,choices),
  download:async()=>{downloads++;}};
 let job:Promise<void>|undefined,migration:Promise<void>|undefined;
 try{
  job=withWebBackupRuntime(owner,base,async runtime=>{
   const frozen=await runtime.freezeBackupDevice(owner);await runtime.retainBackupSafety(frozen);
   const payload=await runtime.materializeDeviceBackup(frozen);await runtime.download('synthetic encrypted file',payload.backupId);
   localStorage.setItem(history,'final synthetic receipt');
  });
  await waiting;migration=fence.withFence(async()=>{captured=true;
   check('real migration observes final backup receipt and file completion together',downloads===1&&localStorage.getItem(history)==='final synthetic receipt');
  });
  let queued=false;
  for(let attempt=0;attempt<200;attempt++){
   const locks=await navigator.locks.query();queued=(locks.pending??[]).some(row=>row.name===legacyTransportLock(owner)&&row.mode==='exclusive');
   if(queued)break;await new Promise(resolve=>setTimeout(resolve,10));
  }
  check('actual owner Web Lock blocks an exclusive migration during the backup wait',queued&&!captured);
  release();await job;await migration;
  const safety=Array.from({length:localStorage.length},(_,index)=>localStorage.key(index)).find(name=>name?.startsWith(`genesis-backup-safety-v1:${owner}:`));
  check('real backup safety storage contains an encrypted copy without its private canary',!!safety&&!localStorage.getItem(safety)!.includes('Unsent synthetic content'));
  let refused=false;try{await withWebBackupRuntime(owner,base,async runtime=>{await runtime.freezeBackupDevice(owner);});}
  catch(error){refused=error instanceof Error&&error.message==='E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN';}
  check('actual durable fence denies a new backup job before any new source capture',refused&&captures===1);
 }finally{release();await Promise.allSettled([job,migration].filter((value):value is Promise<void>=>!!value));remove();await markers.close();}

 const bytes=Uint8Array.from({length:98317},(_,index)=>index%256),id=crypto.randomUUID();
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');
 const info={protocol:1,id,length:bytes.length,name:'исходный-α.genesisbackup',type:'APPLICATION/JSON',lastModified:1700000000123,declaredSize:bytes.length+7,sha256:hash};
 let cleared=false;
 const file=await readNativeBackupFile({check:current,choose:async()=>info,clear:async value=>{cleared=value===id;return cleared;},chunk:async(value,offset)=>{
  const nextOffset=Math.min(offset+98304,bytes.length),part=bytes.subarray(offset,nextOffset);let raw='';for(const byte of part)raw+=String.fromCharCode(byte);
  return{id:value,offset,bytes:btoa(raw).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,''),nextOffset,eof:nextOffset===bytes.length};
 }});
 const actual=new Uint8Array(await file.arrayBuffer());
 check('actual Chromium File preserves every invalid UTF8 byte across multiple native-style chunks',actual.length===bytes.length&&actual.every((value,index)=>value===bytes[index])&&cleared);
 check('original native metadata survives Chromium MIME normalization',file.type==='application/json'&&nativeBackupFileOrigin(file)?.type==='APPLICATION/JSON'&&nativeBackupFileOrigin(file)?.declaredSize===bytes.length+7);
 const detach=registerBackupMigrationEditor(owner,'native-binary-file',()=>({state:{operationId:'exact uncertain native transfer'},file,settled:true}));
 try{
  const [entry]=await captureBackupMigrationEditors(owner,current);
  check('actual capture retains native provenance and the exact binary file',entry.file?.nativeOrigin?.sha256===hash&&entry.file?.size===bytes.length&&entry.file?.name===info.name);
 }finally{detach();actual.fill(0);bytes.fill(0);}
}
