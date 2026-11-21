import {createRoot} from 'react-dom/client';
import {GnoWizard} from './GnoWizard';
import {AuroraRepository,type Sealed} from './repository';
import {createNativeAuroraAccess,type NativeAuroraBridge} from './native-access';
import {snapshotFromSavedDraw,createTemporalTriad} from './draw-policy';
import type {AuroraHost} from './host';
import {AuroraPrivateRepository} from '../e2ee/aurora-product';
import type {FeatureDocumentPort,FeatureDocumentView} from '../e2ee/feature-document';
import {validateDocument,type AuroraDocument,type AuroraResultSeal} from './session';
import {verifyPreparedSolution} from './result';
import '../globals.css';
import '../experimental-theme.css';
import '../dark-theme.css';
import '../dark-palettes.css';
import '../universal-ui.css';
import './native.css';
type Boot={ownerId:string;language:string;client:'android'|'android-play';privateMode?:boolean;source:Parameters<typeof snapshotFromSavedDraw>[0]|null;temporal?:Parameters<typeof createTemporalTriad>[0]|null;dark:boolean;palette:string;colors:Record<string,string>};
type NativeBridge=NativeAuroraBridge&{postMessage:(message:string)=>void;contentSize?:(height:number,width:number,fillViewport:boolean)=>void};
declare global{interface Window{GenesisAuroraBridge:NativeBridge;GenesisAuroraRuntime:{init:(payload:string)=>void;resolve:(id:string,payload:string)=>void;requestClose:()=>boolean;theme:(payload:string)=>void}}}
const decode=(payload:string)=>JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload),c=>c.charCodeAt(0))));
const pending=new Map<string,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
function rpc<T>(method:string,payload:unknown={}):Promise<T>{
 const id=crypto.randomUUID();return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{pending.delete(id);reject(new Error('AURORA_NATIVE_TIMEOUT'));},35000);
  pending.set(id,{resolve:resolve as (value:unknown)=>void,reject,timer});window.GenesisAuroraBridge.postMessage(JSON.stringify({id,method,payload}));
 });
}
function applyTheme(boot:Pick<Boot,'dark'|'palette'|'colors'>){
 document.documentElement.dataset.genesisTheme=boot.dark?'standart-dark':'standart';document.documentElement.dataset.genesisPalette=boot.palette;
 for(const [name,value]of Object.entries(boot.colors))if(/^--[a-z-]+$/.test(name)&&/^#[a-f0-9]{6,8}$/i.test(value))document.documentElement.style.setProperty(name,value);
}
let initialized=false;
window.GenesisAuroraRuntime={
 init(payload){if(initialized)return;initialized=true;const boot=decode(payload) as Boot;applyTheme(boot);document.documentElement.dataset.auroraNative='true';
  const fitViewport=()=>{
   const height=window.visualViewport?.height||window.innerHeight||document.documentElement.clientHeight;
   if(height>0)document.documentElement.style.setProperty('--aurora-native-height',`${Math.floor(height)}px`);
  };
  fitViewport();window.addEventListener('resize',fitViewport);window.visualViewport?.addEventListener('resize',fitViewport);
  let measuredDialog: HTMLElement | null = null;
  const reportContentSize=()=>{
   if(measuredDialog)window.GenesisAuroraBridge.contentSize?.(Math.ceil(measuredDialog.scrollHeight),document.documentElement.clientWidth,measuredDialog.matches('.gno-dialog'));
  };
  const sizeObserver=new ResizeObserver(reportContentSize);
  const watchContent=()=>{
   const dialog=document.querySelector<HTMLElement>('.gno-dialog, .aurora-dialog');
   if(dialog!==measuredDialog){sizeObserver.disconnect();measuredDialog=dialog;if(dialog)sizeObserver.observe(dialog);}
   reportContentSize();
  };
  new MutationObserver(watchContent).observe(document.getElementById('root')!,{subtree:true,childList:true,characterData:true});
  const access=createNativeAuroraAccess(window.GenesisAuroraBridge,rpc);
  const unboundStorage=()=>{throw new Error('E2EE_INVALID_LEGACY_OPERATION');};
  const documentCall=async(action:string,extra:Record<string,unknown>={})=>{
   const view=await rpc<FeatureDocumentView<AuroraDocument>>('privateDocument',{action,...extra});
   await validateDocument(view.document,boot.ownerId);await validateDocument(view.base,boot.ownerId);if(view.conflict)await validateDocument(view.conflict.document,boot.ownerId);return view;
  };
  const privateDocument:FeatureDocumentPort<AuroraDocument>={read:(refresh=true)=>documentCall('read',{refresh}),
   write:async document=>{await validateDocument(document,boot.ownerId);return documentCall('write',{document});},
   resolve:async(document,revision)=>{await validateDocument(document,boot.ownerId);return documentCall('resolve',{document,revision});},flush:()=>documentCall('flush')};
  const repo=boot.privateMode?new AuroraPrivateRepository(boot.ownerId,privateDocument):new AuroraRepository(boot.ownerId,{get length(){return unboundStorage();},key:unboundStorage,getItem:unboundStorage,setItem:unboundStorage,removeItem:unboundStorage},access);
  let taskPending:Promise<unknown>|null=null;
  const host:AuroraHost={ownerId:boot.ownerId,language:boot.language,client:boot.client,canAddTask:true,load:()=>repo.load(),save:value=>repo.save(value),syncState:()=>repo.syncState,
   conflictVersions:()=>repo.conflictVersions(),recoverConflict:(ids,now)=>repo.recoverAsCopy(ids,now),
   sealResult:(value,id)=>boot.privateMode?rpc<AuroraResultSeal>('privateSealResult',{id,value}):access.seal(value,`aurora-result:v1:${id}`),
   prepareResult:async value=>{if(boot.privateMode){if('kind'in value&&(value.kind!=='aurora-e2ee-reference-v1'||value.objectId!==`aurora-result-live:${value.id}`))throw new Error('AURORA_RESULT_MISMATCH');
    const solution=await rpc('privateLocalResult',{manifest:value});await verifyPreparedSolution(solution,value);await rpc('privatePublishResult',{id:value.id,methodVersion:value.methodVersion});return;}
    if('kind'in value)throw new Error('AURORA_RESULT_MISMATCH');await access.request('/aurora-results',{method:'POST',body:JSON.stringify(value)});},
   readResult:async id=>{const row=await rpc<{id:string;solution:Sealed&{kind:string}}>('billing',{path:`/billing/modeling/results/${id}`,method:'GET',body:null});if(row.id!==id)throw new Error('AURORA_RESULT_MISMATCH');
    if(boot.privateMode)return{id,solution:await rpc('privateOpenResult',{id,reference:row.solution})};
    if(row.solution.kind!=='aurora-encrypted-solution-v1')throw new Error('AURORA_RESULT_MISMATCH');return {id,solution:await access.open(row.solution,`aurora-result:v1:${id}`)};},
   billing:<T,>(path:string,init:RequestInit={})=>rpc<T>('billing',{path,method:init.method??'GET',body:init.body?JSON.parse(String(init.body)):null}),
   openCheckout:url=>void rpc('checkout',{url}).catch(()=>undefined),addTask:value=>{taskPending=rpc('task',value);},speak:pronunciation=>void rpc('speak',{pronunciation}).catch(()=>undefined),close:()=>void(taskPending??Promise.resolve()).then(()=>rpc('close')).catch(()=>undefined)};
  const primary=boot.source?snapshotFromSavedDraw(boot.source):null,temporal=boot.temporal?createTemporalTriad(boot.temporal):null;
  createRoot(document.getElementById('root')!,{onUncaughtError:()=>{void rpc('loadFailed').catch(()=>undefined);}}).render(<GnoWizard host={host} primary={primary} temporal={temporal}/>);
 },
 resolve(id,payload){const call=pending.get(id);if(!call)return;pending.delete(id);clearTimeout(call.timer);const response=decode(payload);
  if(response.error){const error=Object.assign(new Error(String(response.error)),{status:response.status??0});call.reject(error);}else call.resolve(response.value);
 },
 requestClose(){const close=document.querySelector<HTMLButtonElement>('.gno-header .dialog-close-button, .gno-header button[aria-label], .aurora-header button');if(!close||close.disabled)return false;close.click();return true;},
 theme(payload){applyTheme(decode(payload));},
};
