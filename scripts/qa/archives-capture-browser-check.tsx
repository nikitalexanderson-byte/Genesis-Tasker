import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BackupPanel,type BackupPanelRuntime} from '../../app/BackupPanel';
import {sealBackup,type BackupPayload} from '../../app/backup-format';
import type {GenesisUser} from '../../app/cloud-sync';
import {captureWebArchiveInventory} from '../../app/e2ee/archives-web-source';
import {clearBackupMigrationMemory} from '../../app/backup-migration-memory';
import {createRecoveryKit} from '../../app/e2ee/keys';
import {UnlockedWebDevice,IndexedDbDeviceKeyStorage} from '../../app/e2ee/device-vault';
import {IndexedDbE2eeStorage} from '../../app/e2ee/storage';
import {checkWholeBackupOperation} from './archives-whole-operation-browser';

const owner='synthetic-archive-'+crypto.randomUUID(),key=btoa('b'.repeat(32)),canary='Synthetic unsent archive '+crypto.randomUUID();
const at='2026-11-19T12:00:00Z',payload:BackupPayload={schema:1,backupId:crypto.randomUUID(),source:'device_snapshot',ownerId:owner,createdAt:at,client:'web',billingEvidence:null,
 sections:[{id:'workspace',source:'device',completeness:'partial',capturedAt:at,revision:0,count:1,pending:1,notices:[],data:{document:{tasks:[{id:'synthetic-task',title:canary}]}}}]};
const file=await sealBackup(payload,key);let commits=0,downloads=0,previews=0;
const report:{synthetic:true;runtime:string;checks:{name:string;passed:boolean}[];status:string;error?:string}={synthetic:true,runtime:navigator.userAgent,checks:[],status:'READY'};
const update=()=>{document.querySelector('#result')!.textContent=JSON.stringify(report,null,2);document.title=report.status+' GENESIS archive capture';};
function check(name:string,passed:boolean){report.checks.push({name,passed});if(!passed)throw new Error('BROWSER_ARCHIVE_CAPTURE_FAILED');}
const unavailable=async():Promise<never>=>{throw new Error('SYNTHETIC_UNUSED_PORT');};
const runtime:BackupPanelRuntime={authorizeBackup:async()=>({ownerId:owner,generation:0}),freezeBackupDevice:()=>({owner,at,sources:{},sync:{} as never,storage:{}}),
 materializeDeviceBackup:async()=>payload,materializeServerBackup:async()=>payload,retainBackupSafety:async()=>({persistent:true}),
 prepareBackupRestore:async()=>({operations:[{section:'workspace',input:{iv:'exact-old-preview-iv',ciphertext:'exact-old-preview-ciphertext'}}],added:1,changed:0,skipped:0,removed:0,workspaceRemovals:[],notices:[]}),
 backupNeedsReconciliation:()=>false,backupRequest:async<T,>(path:string)=>{
  if(path==='/status')return{enabled:true,noticeVersion:'synthetic',generation:0,driveEnabled:false,serverSigningConfigured:false} as T;
  if(path==='/preview'){previews++;return{stageId:'exact-uncertain-stage',digest:'b'.repeat(64),counts:{workspace:1},expiresIn:1800} as T;}
  commits++;throw new Error('SYNTHETIC_UNEXPECTED_RESTORE');
 },captureAccountSessionGuard:()=>()=>{},holdBackupStaleChanges:unavailable,download:async()=>{downloads++;},
 readFile:async()=>new File([file],'selected.genesisbackup',{type:'application/octet-stream',lastModified:1700000000123})};

async function acceptance(){
 let device:UnlockedWebDevice|undefined,recovery:Awaited<ReturnType<typeof createRecoveryKit>>|undefined;
 try{
  check('real secure Chromium File, WebCrypto and IndexedDB are available',isSecureContext&&!!crypto.subtle&&!!indexedDB&&typeof File==='function');
  const safetyKey=`genesis-backup-safety-v1:${owner}:expired`,heldKey=`genesis-backup-held-v1:${owner}:old`;
  localStorage.setItem(safetyKey,'{ "original":"expired raw ciphertext" }');localStorage.setItem(heldKey,'{ "duplicate":1,"duplicate":2 }');
  localStorage.setItem(`genesis-backup-safety-v1:${owner}-foreign:copy`,'foreign-canary');
  const before=JSON.stringify(Object.entries(localStorage).sort()),memorySafety={owner,at,storage:{original:canary}};
  const local=await captureWebArchiveInventory(owner,{storage:localStorage,memorySafety:()=>memorySafety,assertCurrent:()=>{}});
  const editor=local.editors.find(value=>value.source==='backup-panel'),state=editor?.state as Record<string,unknown>|undefined;
  check('actual BackupPanel survives navigation as a settled detached form',!!editor&&!editor.mounted&&editor.settled);
  check('selected SAF-style file keeps every original encrypted byte',!!editor?.file&&editor.file.name==='selected.genesisbackup'&&new TextDecoder().decode(Uint8Array.from(atob(editor.file.bytes.replaceAll('-','+').replaceAll('_','/')),char=>char.charCodeAt(0)))===file);
  check('unsubmitted input key is confined to the protected source input',state?.key===key);
  check('decoded preview content and selected section survive navigation',JSON.stringify(state?.payload).includes(canary)&&JSON.stringify(state?.selected)==='["workspace"]');
  check('uncertain stage and operation IDs remain exact inert data',(state?.stage as {stageId?:string})?.stageId==='exact-uncertain-stage'&&typeof state?.operationId==='string'&&state.operationId.length===36);
  check('preview was prepared exactly once with no restore or download',previews===1&&commits===0&&downloads===0);
  check('expired and duplicate raw originals remain byte exact',local.entries.some(row=>row.key===safetyKey&&row.value==='{ "original":"expired raw ciphertext" }')&&local.entries.some(row=>row.key===heldKey&&row.value==='{ "duplicate":1,"duplicate":2 }'));
  check('other-owner archives are never attributed',!JSON.stringify(local).includes('foreign-canary'));
  check('capture performs no local storage rewrite or prune',before===JSON.stringify(Object.entries(localStorage).sort()));
  recovery=await createRecoveryKit(owner);const storage=new IndexedDbE2eeStorage();device=await UnlockedWebDevice.provision(owner,recovery.secret,recovery.kit,storage,new IndexedDbDeviceKeyStorage());
  const bytes=new TextEncoder().encode(JSON.stringify(local));try{await device.vault.write([{domain:'local-snapshot',objectId:'archive-capture',value:bytes,expected:null}]);}finally{bytes.fill(0);}
  clearBackupMigrationMemory();localStorage.removeItem(safetyKey);localStorage.removeItem(heldKey);memorySafety.storage.original='deleted legacy memory';
  const disk=JSON.stringify(await Promise.all((await storage.list('')).map(id=>storage.get(id))));check('protected IndexedDB contains no plaintext private canary or independent archive input',!disk.includes(canary)&&!disk.includes(key));
  device.lock();device=await UnlockedWebDevice.unlock(owner,recovery.secret,new IndexedDbE2eeStorage(),new IndexedDbDeviceKeyStorage());
  const restored=await device.vault.read('local-snapshot','archive-capture');check('cold unlock reads the complete archive capture after originals were discarded by the fixture',!!restored);
  try{
   const value=JSON.parse(new TextDecoder().decode(restored!.value));check('selected import and unsent private content survive new-root cold readback',value.editors[0].file.bytes===editor!.file!.bytes&&JSON.stringify(value).includes(canary));
   check('in-memory quota safety copy survives independently of legacy storage',value.memorySafety.storage.original===canary);
  }finally{restored?.value.fill(0);}
  await checkWholeBackupOperation(check);
 }catch(error){report.error=error instanceof Error&&/^E2EE_[A-Z_]+$/.test(error.message)?error.message:'BROWSER_ARCHIVE_CAPTURE_FAILED';}
 finally{device?.lock();recovery?.secret.fill(0);clearBackupMigrationMemory();}
 report.status=report.error||report.checks.some(value=>!value.passed)?'FAIL':'PASS';update();
}
function Fixture(){const [mounted,setMounted]=useState(true),[started,setStarted]=useState(false);
 useEffect(()=>{if(started&&!mounted){report.status='RUNNING';update();void acceptance();}},[started,mounted]);
 return <main><h1>Synthetic archive capture acceptance</h1><p>Use this synthetic input key: <code>{key}</code>. Consent, save the key, choose/check the file and prepare a preview before detaching.</p>
  <button type="button" disabled={started} onClick={()=>{setMounted(false);setStarted(true);}}>Detach form and check protected capture</button>
  {mounted&&<BackupPanel user={{uid:owner,language:'en'} as GenesisUser} runtime={runtime}/>}
 </main>;
}
createRoot(document.querySelector('#root')!).render(<Fixture/>);update();
