import {createRoot} from 'react-dom/client';
import {AuroraWizard} from './AuroraWizard';
import {AuroraRepository,type AuroraAccess,type Sealed} from './repository';
import {snapshotFromSavedDraw} from './draw-policy';
import type {AuroraHost} from './host';
import '../globals.css';
import '../experimental-theme.css';
import '../dark-theme.css';
import '../dark-palettes.css';
import '../universal-ui.css';
import './native.css';
type Boot={ownerId:string;language:string;client:'android'|'android-play';source:Parameters<typeof snapshotFromSavedDraw>[0]|null;dark:boolean;palette:string;colors:Record<string,string>};
type NativeBridge={postMessage:(message:string)=>void;getItem:(key:string)=>string|null;setItem:(key:string,value:string)=>void;removeItem:(key:string)=>void};
declare global{interface Window{GenesisAuroraBridge:NativeBridge;GenesisAuroraRuntime:{init:(payload:string)=>void;resolve:(id:string,payload:string)=>void;requestClose:()=>void;theme:(payload:string)=>void}}}
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
  const access:AuroraAccess={check(){},request:<T,>(path:string,init:RequestInit={})=>rpc<T>('request',{path,method:init.method??'GET',body:init.body?JSON.parse(String(init.body)):null}),
   seal:(value,scope)=>rpc<Sealed>('seal',{value,scope}),open:<T,>(value:Sealed,scope:string)=>rpc<T>('open',{value,scope})};
  const repo=new AuroraRepository(boot.ownerId,{getItem:key=>window.GenesisAuroraBridge.getItem(key)||null,setItem:(key,value)=>window.GenesisAuroraBridge.setItem(key,value),removeItem:key=>window.GenesisAuroraBridge.removeItem(key)},access);
  let taskPending:Promise<unknown>|null=null;
  const host:AuroraHost={ownerId:boot.ownerId,language:boot.language,client:boot.client,canAddTask:true,load:()=>repo.load(),save:value=>repo.save(value),syncState:()=>repo.syncState,
   conflictVersions:()=>repo.conflictVersions(),recoverConflict:(ids,now)=>repo.recoverAsCopy(ids,now),
   sealResult:(value,id)=>access.seal(value,`aurora-result:v1:${id}`),prepareResult:async value=>{await access.request('/aurora-results',{method:'POST',body:JSON.stringify(value)});},
   readResult:async id=>{const row=await rpc<{id:string;solution:Sealed&{kind:string}}>('billing',{path:`/billing/modeling/results/${id}`,method:'GET',body:null});if(row.id!==id||row.solution.kind!=='aurora-encrypted-solution-v1')throw new Error('AURORA_RESULT_MISMATCH');return {id,solution:await access.open(row.solution,`aurora-result:v1:${id}`)};},
   billing:<T,>(path:string,init:RequestInit={})=>rpc<T>('billing',{path,method:init.method??'GET',body:init.body?JSON.parse(String(init.body)):null}),
   openCheckout:url=>void rpc('checkout',{url}).catch(()=>undefined),addTask:value=>{taskPending=rpc('task',value);},speak:pronunciation=>void rpc('speak',{pronunciation}).catch(()=>undefined),close:()=>void(taskPending??Promise.resolve()).then(()=>rpc('close')).catch(()=>undefined)};
  const primary=boot.source?snapshotFromSavedDraw(boot.source):null;createRoot(document.getElementById('root')!).render(<AuroraWizard host={host} primary={primary}/>);
 },
 resolve(id,payload){const call=pending.get(id);if(!call)return;pending.delete(id);clearTimeout(call.timer);const response=decode(payload);
  if(response.error){const error=Object.assign(new Error(String(response.error)),{status:response.status??0});call.reject(error);}else call.resolve(response.value);
 },
 requestClose(){document.querySelector<HTMLButtonElement>('.aurora-header button')?.click();},
 theme(payload){applyTheme(decode(payload));},
};
