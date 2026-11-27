import { languageDirection } from "./region-language";
import {createRoot} from 'react-dom/client';
import {BackupPanel,type BackupPanelRuntime} from './BackupPanel';
import {BACKUP_NOTICE_VERSION,materializeServerBackup,type FrozenDevice} from './backup-device';
import {prepareBackupRestore} from './backup-restore';
import {BACKUP_MAX_FILE,type BackupPayload} from './backup-format';
import {metricsFor,type GenesisUser} from './cloud-sync';
import {habitLifecycleState} from './habit-lifecycle';
import type {BackupDocumentAccess} from './backup-restore';
import {materializeBackupJournalChoices} from './backup-private-journals';
import {nativeBackupOperations} from './backup-native-operations';
import {acceptNativeBackupReply,assertNativeBackupSession} from './backup-native-replies';
import {readNativeBackupFile} from './backup-native-file';
import {nativeBackupValueRetainer} from './backup-native-values';
import './globals.css';import './experimental-theme.css';import './dark-theme.css';import './dark-palettes.css';import './universal-ui.css';
import './backup-native.css';
type Boot={ownerId:string;language:string;dark:boolean;palette:string;colors:Record<string,string>};
type Bridge={postMessage:(value:string)=>void;postChunk:(id:string,index:number,last:boolean,value:string)=>void;getHistory:()=>string|null;setHistory:(value:string,operationId:string)=>void;currentSession:(operationId:string)=>boolean;
 retainValueChunk:(name:string,id:string,index:number,last:boolean,text:string,operationId:string)=>string;
 retainValueManifest:(raw:string,operationId:string)=>string};
declare global {interface Window {GenesisBackupBridge:Bridge;GenesisBackupRuntime:{init:(value:string)=>void;resolve:(id:string,value:string)=>void;resolveChunk:(id:string,value:string,index:number,last:boolean)=>void}}}
const decode=(value:string)=>JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value),c=>c.charCodeAt(0))));
const pending=new Map<string,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>;method:string;operationId:string}>();
let operations:ReturnType<typeof nativeBackupOperations>|undefined;
const currentSession=(operationId:string)=>window.GenesisBackupBridge.currentSession(operationId);
const check=()=>assertNativeBackupSession(currentSession,operations?.token()??'');
function rpc<T>(method:string,payload:Record<string,unknown>={}):Promise<T>{
 const id=crypto.randomUUID();return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{pending.delete(id);reject(new Error('BACKUP_NATIVE_TIMEOUT'));},180000);
  const token=operations?.token();
  const submitted=token&&!['operationBegin','operationEnd','restart'].includes(method)?{...payload,operationId:token}:payload;
  pending.set(id,{resolve:resolve as (value:unknown)=>void,reject,timer,method,operationId:typeof submitted.operationId==='string'?submitted.operationId:''});
  const raw=JSON.stringify({id,method,payload:submitted});
  if(raw.length<=131072)window.GenesisBackupBridge.postMessage(raw);else for(let offset=0,index=0;offset<raw.length;offset+=131072,index++)window.GenesisBackupBridge.postChunk(id,index,offset+131072>=raw.length,raw.slice(offset,offset+131072));
 });
}
let initialized=false;const responseChunks=new Map<string,string>();
window.GenesisBackupRuntime={
 init(value){if(initialized)return;initialized=true;const boot=decode(value) as Boot;
  operations=nativeBackupOperations({begin:operationId=>rpc('operationBegin',{operationId}),end:operationId=>rpc('operationEnd',{operationId}),restart:()=>rpc('restart')});
  document.documentElement.lang=boot.language; document.documentElement.dir=languageDirection(boot.language);document.documentElement.dataset.genesisTheme=boot.dark?'standart-dark':'standart';document.documentElement.dataset.genesisPalette=boot.palette;
  for(const [name,color] of Object.entries(boot.colors))if(/^--[a-z-]+$/.test(name)&&/^#[a-f0-9]{6,8}$/i.test(color))document.documentElement.style.setProperty(name,color);
  // The history preference contains only timestamps. Native form retention
  // separately encrypts accepted input in private no-backup frames.
  const historyKey=`genesis-backup-history-v1:${boot.ownerId}`;
  Object.defineProperty(window,'localStorage',{value:{getItem:(key:string)=>key===historyKey?window.GenesisBackupBridge.getHistory():null,
   setItem:(key:string,value:string)=>{if(key!==historyKey||value.length>500)throw Error('BACKUP_STORAGE_SCOPE');window.GenesisBackupBridge.setHistory(value,operations!.token());},removeItem(){},clear(){},key:()=>null,length:0}});
  let needs=false;
  const access:BackupDocumentAccess={check,request:<T,>(path:string,init:RequestInit={})=>rpc<T>('request',{path,method:init.method??'GET',body:init.body?JSON.parse(String(init.body)):null}),
   open:<T,>(value:{iv:string;ciphertext:string},scope:string)=>rpc<T>('open',{value,scope}),seal:(value:unknown,scope:string)=>rpc('seal',{value,scope})};
  const backupRequest:BackupPanelRuntime['backupRequest']=async <T,>(path:string,body?:unknown)=>{
   const response=await rpc<T&{needsReconciliation?:boolean}>('request',{path:'/backup/v1'+path,method:body===undefined?'GET':'POST',body:body??null});
   if(response.needsReconciliation!==undefined)needs=response.needsReconciliation;return response;
  };
  type NativeFrozen=FrozenDevice&{nativeSnapshot:BackupPayload};
  const retainedValues=nativeBackupValueRetainer({check,operationId:()=>operations!.formToken(),
   value:(...args)=>window.GenesisBackupBridge.retainValueChunk(...args),commit:(...args)=>window.GenesisBackupBridge.retainValueManifest(...args)});
  window.addEventListener('pagehide',()=>retainedValues.clear(),{once:true});
  const runtime:BackupPanelRuntime={backupRequest,
   retainForm:form=>retainedValues.retain(form),
   withOperation:(owner,action)=>{if(owner!==boot.ownerId)throw new Error('BACKUP_OWNER');return operations!.run(()=>action(runtime));},
   authorizeBackup:()=>backupRequest('/authorize',{noticeVersion:BACKUP_NOTICE_VERSION}),
   freezeBackupDevice:async owner=>({owner,at:new Date().toISOString(),sources:{},sync:{},storage:{},nativeSnapshot:await rpc<BackupPayload>('capture')}) as unknown as NativeFrozen,
   retainBackupSafety:async frozen=>{await rpc('retain',{snapshot:(frozen as NativeFrozen).nativeSnapshot});return {persistent:true};},
   materializeDeviceBackup:async frozen=>materializeBackupJournalChoices(await rpc<BackupPayload>('materialize',{snapshot:(frozen as NativeFrozen).nativeSnapshot})),
   materializeServerBackup:(owner,evidence)=>materializeServerBackup(owner,evidence,{access,openWorkspace:(_owner,envelope)=>access.open(envelope,'workspace')}),
   prepareBackupRestore:(payload,owner,selected,mode,choices)=>prepareBackupRestore(payload,owner,selected,mode,{access,current:()=>rpc('current'),
    sealWorkspace:async(_owner,document,version)=>({...await access.seal(document,'workspace'),expectedVersion:version,version:version+1,writerProtocol:9,minimumWriterProtocol:9,
      quotaUsage:{'personal-projects':document.projects.map(row=>row.id),habits:document.habits.filter(row=>habitLifecycleState(row).status!=='deleted').map(row=>row.id)},metrics:metricsFor([],document.projects,document.habits.length)})},choices),
   captureAccountSessionGuard:()=>check,backupNeedsReconciliation:()=>needs,
   holdBackupStaleChanges:async()=>{await rpc('reconcile');},restart:()=>operations!.requestRestart(),
   download:async(content,id)=>{
    if(content.length>BACKUP_MAX_FILE)throw Error('BACKUP_TOO_LARGE');await rpc('exportBegin',{length:content.length,id});
    for(let offset=0;offset<content.length;offset+=131072)await rpc('exportChunk',{offset,text:content.slice(offset,offset+131072)});
    await rpc('exportSave');
   },
   readFile:()=>readNativeBackupFile({choose:()=>rpc('importChoose'),chunk:(id,offset)=>rpc('importChunk',{id,offset}),clear:id=>rpc('importClear',{id}),check}),
  };
  createRoot(document.getElementById('root')!).render(<BackupPanel user={{uid:boot.ownerId,language:boot.language} as GenesisUser} runtime={runtime}/>);
 },
 resolveChunk(id,value,index,last){
  if(!pending.has(id))return;if(index===0)responseChunks.set(id,'');
  const current=responseChunks.get(id);if(current===undefined||current.length!==index*131072||current.length+value.length>48*1024*1024)throw Error('BACKUP_TRANSFER');
  responseChunks.set(id,current+value);if(last){responseChunks.delete(id);window.GenesisBackupRuntime.resolve(id,current+value);}
 },
 resolve(id,value){const call=pending.get(id);if(!call)return;pending.delete(id);clearTimeout(call.timer);
  try{call.resolve(acceptNativeBackupReply(call.method,call.operationId,decode(value),currentSession));}
  catch(error){call.reject(new Error(error instanceof Error&&/^[A-Z][A-Z0-9_]{0,127}$/.test(error.message)?error.message:'BACKUP_NATIVE_FAILED'));}
 },
};
