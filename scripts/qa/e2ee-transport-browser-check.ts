import {IndexedDbLegacyTransportMarkers,WebLegacyTransportGate,WebMigrationTransportFence} from '../../app/e2ee/legacy-transport-fence.ts';
import {loadGenesisSession,loadSavedAdvice,e2eeRequest,updateAccountPreferences} from '../../app/cloud-sync';

// Synthetic browser-only API harness. The loopback server exposes no repository
// files, secrets, real account session or production/provider endpoints.
let markers=new IndexedDbLegacyTransportMarkers(),gate=new WebLegacyTransportGate(markers,navigator.locks);
const pending=new Map<string,Promise<unknown>>(),releases=new Map<string,()=>void>();
const state:Record<string,unknown>={ready:true,secureContext:isSecureContext};
function report(){document.querySelector('#result')!.textContent=JSON.stringify(state,null,2);}
async function probe(){const response=await fetch('/private-probe');return await response.json();}
function hold(owner:string){
  const promise=gate.request(owner,()=>{},async()=>{
    state[`${owner}:entered`]=true;report();await new Promise<void>(resolve=>releases.set(owner,resolve));
    const result=await probe();state[`${owner}:parsed`]=true;report();return result;
  });pending.set(owner,promise);return 'queued';
}
const api={
  hold,
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
  async activeProfile(){await fetch('/profile-active');return(await loadGenesisSession())?.uid??null;},
  async productRequest(){try{await loadSavedAdvice({id:'advice-synthetic',dayKey:'2026-11-18',collection:'aurora'});return{ok:true};}catch(error){return{ok:false,error:(error as Error).message};}},
  productStatus(){return e2eeRequest('/status');},
  async productPreferences(privateContent:boolean){try{await updateAccountPreferences(privateContent?{advicePreferences:{enabled:false}}:{language:'en'});return{ok:true};}catch(error){return{ok:false,error:(error as Error).message};}},
};
Object.assign(globalThis,{genesisTransportFixture:api});report();
