import {IndexedDbLegacyTransportMarkers,WebLegacyTransportGate,WebMigrationTransportFence} from '../../app/e2ee/legacy-transport-fence.ts';
import type {LegacyOperationPermit} from '../../app/e2ee/legacy-transport-fence.ts';
import {loadGenesisSession,loadSavedAdvice,e2eeRequest,updateAccountPreferences,personalDocumentAccess,restoreOfflineWorkspaceSession} from '../../app/cloud-sync';
import {MindmapRepository} from '../../app/mindmaps-storage';
import {newMindmap} from '../../app/mindmaps-model';
import {RestorationRepository} from '../../app/stoicheion-restoration-storage';
import {AuroraRepository,emptyAuroraDocument} from '../../app/aurora/repository';
import {requireLegacyTransportWorker} from '../../app/e2ee/legacy-worker-client.ts';

// Synthetic browser-only API harness. The loopback server exposes no repository
// files, secrets, real account session or production/provider endpoints.
let markers=new IndexedDbLegacyTransportMarkers(),gate=new WebLegacyTransportGate(markers,navigator.locks);
const pending=new Map<string,Promise<unknown>>(),releases=new Map<string,()=>void>();
const operationPermits=new Map<string,LegacyOperationPermit>();
const state:Record<string,unknown>={ready:true,secureContext:isSecureContext};
const editors=new Map<string,{owner:string;save:()=>Promise<unknown>;pending:()=>Promise<unknown>;sources:()=>[string,string|null][]}>();
function report(){document.querySelector('#result')!.textContent=JSON.stringify(state,null,2);}
async function probe(){const response=await fetch('/private-probe');return await response.json();}
function hold(owner:string){
  const promise=gate.request(owner,()=>{},async()=>{
    state[`${owner}:entered`]=true;report();await new Promise<void>(resolve=>releases.set(owner,resolve));
    const result=await probe();state[`${owner}:parsed`]=true;report();return result;
  });pending.set(owner,promise);return 'queued';
}
const api={
  async initEditor(kind:string){
    const user=await loadGenesisSession();if(!user)throw new Error('fixture owner missing');
    const owner=user.uid,key=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    localStorage.setItem(`genesis-workspace-device-key-v2:${owner}`,JSON.stringify({key,recoveryCode:key}));
    if(!restoreOfflineWorkspaceSession(owner))throw new Error('fixture key restore failed');
    const sources=()=>Object.keys(localStorage).filter(key=>['genesis-mindmaps:','genesis-shared-mindmaps:','genesis-aurora-workspace-v1:','genesis-stoicheion-workspace-v1:'].some(prefix=>key.startsWith(prefix+owner+':'))).sort().map(key=>[key,localStorage.getItem(key)] as [string,string|null]);
    let save:()=>Promise<unknown>;
    if(kind==='mindmaps'||kind==='shared'){
      const repo=new MindmapRepository(owner,kind==='shared'?'synthetic-space':undefined),document=newMindmap('Synthetic private browser map');
      save=()=>repo.save(document,()=>{});
    }else if(kind==='aurora'){
      const repo=new AuroraRepository(owner,localStorage,personalDocumentAccess(owner));save=()=>repo.save(emptyAuroraDocument(owner));
    }else if(kind==='restoration'){
      const repo=new RestorationRepository(owner,localStorage);save=()=>repo.save({version:1,works:[],removed:[]});
    }else throw new Error('invalid fixture editor');
    editors.set(kind,{owner,save,pending:async()=>{},sources});return owner;
  },
  startEditor(kind:string){
    const editor=editors.get(kind);if(!editor)throw new Error('fixture editor missing');
    const promise=editor.save();editor.pending=()=>promise;
    // Observe rejected work immediately while retaining the exact public outcome.
    void promise.catch(()=>{});return true;
  },
  async waitEditor(kind:string){const editor=editors.get(kind);if(!editor)throw new Error('fixture editor missing');try{await editor.pending();return{ok:true};}catch(error){return{ok:false,error:(error as Error).message};}},
  editorSources(kind:string){return editors.get(kind)?.sources();},
  async editorControl(action:string,kind:string){if(!['hold','release','state'].includes(action))throw new Error('invalid fixture action');return await(await fetch('/editor-controls/'+action+'?kind='+encodeURIComponent(kind))).json();},
  hold,
  holdOperation(owner:string){
    const work=gate.withOperation(owner,()=>{},async permit=>{
      operationPermits.set(owner,permit);state[`${owner}:operation-entered`]=true;report();
      await new Promise<void>(resolve=>releases.set(owner,resolve));
      await gate.borrow(permit,owner,()=>{},probe);
      gate.assertOperation(permit,owner);state[`${owner}:local-committed`]=true;report();return true;
    });pending.set(owner,work);return 'queued';
  },
  async reuseOperation(owner:string){try{await gate.borrow(operationPermits.get(owner)!,owner,()=>{},probe);return{ok:true};}catch(error){return{ok:false,error:(error as Error).message};}},
  release(owner:string){releases.get(owner)?.();},
  wait(owner:string){return pending.get(owner);},
  state(){return state;},
  async request(owner:string){try{return{ok:true,result:await gate.request(owner,()=>{},probe)};}catch(error){return{ok:false,error:(error as Error).message};}},
  async freeze(owner:string){
    const fence=new WebMigrationTransportFence(gate,owner,`personal:${owner}`,()=>{});
    await fence.withFence(async()=>{state[`${owner}:snapshot`]=true;report();});return await fence.token();
  },
  freezeHeld(owner:string){
    const fence=new WebMigrationTransportFence(gate,owner,`personal:${owner}`,()=>{});
    pending.set(owner,fence.withFence(async()=>{
      state[`${owner}:snapshot`]=true;report();await new Promise<void>(resolve=>releases.set(owner,resolve));
    }));return 'queued';
  },
  marker(owner:string){return markers.get(owner);},
  async active(owner:string){const row=await markers.get(owner);if(!row)throw new Error('fixture missing');await markers.commit(owner,row,{...row,phase:'active'});},
  async remove(owner:string){try{const row=await markers.get(owner);await markers.commit(owner,row,null);return{ok:true};}catch(error){return{ok:false,error:(error as Error).message};}},
  async reopen(){await markers.close();markers=new IndexedDbLegacyTransportMarkers();gate=new WebLegacyTransportGate(markers,navigator.locks);},
  async count(){return (await(await fetch('/probe-count')).json()).count;},
  async corruptMarker(owner:string){
    await new Promise<void>((resolve,reject)=>{
      const request=indexedDB.open('genesis-e2ee-legacy-transport-v1',1);
      request.onerror=()=>reject(new Error('fixture database unavailable'));
      request.onsuccess=()=>{
        const db=request.result,transaction=db.transaction('scopes','readwrite');
        transaction.objectStore('scopes').put(null,owner);
        transaction.oncomplete=()=>{db.close();resolve();};transaction.onerror=transaction.onabort=()=>{db.close();reject(new Error('fixture write failed'));};
      };
    });
  },
  async productSession(){return(await loadGenesisSession())?.uid??null;},
  async resetProfile(){const response=await fetch('/profile-legacy');if(!response.ok)throw new Error('fixture reset failed');return(await response.json()).owner;},
  async activeProfile(){await fetch('/profile-active');return(await loadGenesisSession())?.uid??null;},
  async productRequest(){try{await loadSavedAdvice({id:'advice-synthetic',dayKey:'2026-11-18',collection:'aurora'});return{ok:true};}catch(error){return{ok:false,error:(error as Error).message};}},
  productStatus(){return e2eeRequest('/status');},
  async productPreferences(privateContent:boolean){try{await updateAccountPreferences(privateContent?{advicePreferences:{enabled:false}}:{language:'en'});return{ok:true};}catch(error){return{ok:false,error:(error as Error).message};}},
  async workerProbe(){try{await requireLegacyTransportWorker();return{ok:true};}catch(error){return{ok:false,error:(error as Error).message};}},
  async registerWorker(){
    await navigator.serviceWorker.register('/worker.js',{scope:'/',updateViaCache:'none'});await navigator.serviceWorker.ready;
    if(!navigator.serviceWorker.controller)await new Promise<void>((resolve,reject)=>{
      const changed=()=>{clearTimeout(timer);navigator.serviceWorker.removeEventListener('controllerchange',changed);resolve();};
      const timer=setTimeout(()=>{navigator.serviceWorker.removeEventListener('controllerchange',changed);reject(new Error('fixture worker claim failed'));},10000);
      navigator.serviceWorker.addEventListener('controllerchange',changed);if(navigator.serviceWorker.controller)changed();
    });await requireLegacyTransportWorker();return{ok:true};
  },
  async workerFreeze(owner:string){const fence=new WebMigrationTransportFence(gate,owner,`personal:${owner}`,()=>{},()=>requireLegacyTransportWorker());await fence.withFence(async()=>{state[`${owner}:snapshot`]=true;report();});return await fence.token();},
  async oldRequest(path:string,init?:RequestInit){const response=await fetch('/api'+path,init);return{status:response.status,payload:await response.json()};},
  oldSlow(id:string){pending.set(id,api.oldRequest('/workspace/slow?id='+encodeURIComponent(id)));return 'queued';},
  async slowStatus(){return await(await fetch('/slow-status')).json();},
  async releaseSlow(id:string){return await fetch('/release-slow?id='+encodeURIComponent(id));},
  async counters(){return await(await fetch('/probe-count')).json();},
};
Object.assign(globalThis,{genesisTransportFixture:api});report();
