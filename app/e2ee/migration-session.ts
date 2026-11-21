import {canonicalE2eeValue,snapshotE2eeValue,type SignedE2eeCommand,type WireValue} from './commands.ts';
import {ProtectedRemoteOriginal,describeRemoteOriginal,withRemoteOriginal,type RemoteOriginalRegistration,type RemoteOriginalReference,type RemoteOriginalOptions} from './remote-original.ts';
import type {MigrationSourceContext} from './migration.ts';
import type {E2eeHttpObservation} from './http-observation.ts';

export type MigrationLegacyAction='legacy-workspace'|'legacy-aurora'|'legacy-stoicheion'|'legacy-advice'|'legacy-tasks'|'legacy-diary'|'legacy-mindmaps'|'legacy-physis'|'legacy-reminders'|'legacy-archives'|'legacy-shared-mindmaps'|'legacy-private-path';
type Page=Readonly<{table:string;offset:number;byteOffset?:number;pathId?:string}>;
type Response=Record<string,WireValue>;
type Binding=Readonly<{ownerId:string;scopeId:string;deviceId:string;checkpointHash:string;directoryRevision:number;securityEpoch:number}>;
export type MigrationPlanningSession=Readonly<{
 context:MigrationSourceContext;
 assertBinding(binding:Binding):void;
 requestLegacy(context:MigrationSourceContext,action:MigrationLegacyAction,page:Page|undefined,
  send:(packet:SignedE2eeCommand,observation:E2eeHttpObservation,signal:AbortSignal)=>Promise<Response>,validate?:()=>void):Promise<Response>;
}>;
type Hooks<T>={
 context:MigrationSourceContext;binding:Binding;assertCurrent:()=>void;
 /** These are private coordinator closures under its ALREADY held whole-job
  * fence. They must never call the public fence-taking reservation API. */
 packet:(action:MigrationLegacyAction,page:Page|undefined)=>Promise<SignedE2eeCommand>;
 original:(packet:SignedE2eeCommand,current:()=>void)=>RemoteOriginalOptions;
 reserve:(registration:RemoteOriginalRegistration,packet:SignedE2eeCommand,current:()=>void)=>Promise<void>;
 complete:(registration:RemoteOriginalRegistration,packet:SignedE2eeCommand,reference:RemoteOriginalReference,current:()=>void)=>Promise<void>;
 finish:()=>Promise<T>;
};
const actions=new Set<MigrationLegacyAction>(['legacy-workspace','legacy-aurora','legacy-stoicheion','legacy-advice','legacy-tasks','legacy-diary','legacy-mindmaps','legacy-physis','legacy-reminders','legacy-archives','legacy-shared-mindmaps','legacy-private-path']);
function same(left:unknown,right:unknown){
 const a=canonicalE2eeValue(left as WireValue),b=canonicalE2eeValue(right as WireValue);
 try{return a.length===b.length&&a.every((byte,index)=>byte===b[index]);}finally{a.fill(0);b.fill(0);}
}

/** One revocable, sequential, awaited session owns reserve -> complete HTTP
 * observation -> authenticated body EOF -> durable ownership binding. It never
 * upgrades a metadata marker to a body proof and never releases a fence while
 * its borrowed request/observer can still publish. Only coordinator finish
 * returns technical references; a consumer cannot return a derived result. */
export async function withOwnedMigrationPlanning<T>(hooks:Hooks<T>,consume:(session:MigrationPlanningSession)=>Promise<void>):Promise<T>{
 const context=Object.freeze(snapshotE2eeValue(hooks.context)),binding=Object.freeze(snapshotE2eeValue(hooks.binding));
 let live=true,accepting=true,busy=false,failed=false,failure:unknown;
 const pending=new Set<Promise<unknown>>(),observers=new Set<ProtectedRemoteOriginal>(),controllers=new Set<AbortController>();
 const remember=(error:unknown)=>{if(!failed){failed=true;failure=error;}};
 const current=()=>{hooks.assertCurrent();if(!live)throw new Error('E2EE_STREAMED_SESSION_CLOSED');};
 const available=()=>{current();if(!accepting)throw new Error('E2EE_STREAMED_SESSION_CLOSED');};
 const session:MigrationPlanningSession=Object.freeze({context,
  assertBinding(candidate:Binding){try{available();if(!same(candidate,binding))throw new Error('E2EE_SCOPE_BINDING_MISMATCH');}catch(error){remember(error);throw error;}},
  requestLegacy(source:MigrationSourceContext,action:MigrationLegacyAction,page:Page|undefined,send:(packet:SignedE2eeCommand,observation:E2eeHttpObservation,signal:AbortSignal)=>Promise<Response>,validate?:()=>void){
   let requestPage:Page|undefined,entered=false;
   try{available();if(busy)throw new Error('E2EE_STREAMED_REQUEST_BUSY');busy=true;entered=true;validate?.();if(!same(source,context)||!actions.has(action)||typeof send!=='function')throw new Error('E2EE_SCOPE_BINDING_MISMATCH');requestPage=page===undefined?undefined:snapshotE2eeValue(page);}
   catch(error){if(entered)busy=false;remember(error);const refusal=Promise.reject<Response>(error);void refusal.catch(()=>{});return refusal;}
   const task=Promise.resolve().then(async()=>{
    current();const packet=snapshotE2eeValue(await hooks.packet(action,requestPage));current();
    if(packet.command.action!==action)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
    const options={...hooks.original(packet,current),assertCurrent:current},capture=await ProtectedRemoteOriginal.create(options);
    observers.add(capture);const controller=new AbortController();controllers.add(controller);
    try{
     current();const registered=capture.registration();await hooks.reserve(registered,packet,current);current();
     let value:Response|undefined,sendFailed=false,sendError:unknown;
     try{value=await send(snapshotE2eeValue(packet),capture,controller.signal);}catch(error){sendFailed=true;sendError=error;}
     current();
     const read={vault:options.vault,target:options.target,capacity:options.capacity,assertCurrent:current};
     let descriptor;
     try{descriptor=await describeRemoteOriginal(read,registered.id);}catch(error){current();if(sendFailed&&error instanceof Error&&error.message==='E2EE_REMOTE_ORIGINAL_MISSING')throw sendError;throw error;}current();
     if(!same(descriptor.registration,registered))throw new Error('E2EE_CORRUPT_STREAMED_OWNERSHIP');
     if(descriptor.phase==='complete'){
      const proof=await withRemoteOriginal(read,registered.id,async source=>{for await(const bytes of source)bytes.fill(0);});current();
      if(!proof.complete||proof.manifestHash===null||proof.size!==descriptor.size||proof.rawHash!==descriptor.rawHash||proof.manifestHash!==descriptor.manifestHash)throw new Error('E2EE_CORRUPT_STREAMED_OWNERSHIP');
      await hooks.complete(registered,packet,Object.freeze({id:proof.id,size:proof.size,rawHash:proof.rawHash,manifestHash:proof.manifestHash}),current);current();
     }else if(!sendFailed)throw new Error('E2EE_REMOTE_ORIGINAL_INCOMPLETE');
     if(sendFailed)throw sendError;
     if(value===undefined)throw new Error('E2EE_INVALID_RESPONSE');return value;
    }finally{capture.close();observers.delete(capture);controllers.delete(controller);controller.abort();}
   });
   const observed=task.catch(error=>{remember(error);throw error;}).finally(()=>{busy=false;pending.delete(observed);});
   pending.add(observed);void observed.catch(()=>{});return observed;
  }
 });
 try{
  current();const result=await consume(session);accepting=false;current();
  if(result!==undefined)throw new Error('E2EE_STREAMED_RESULT_FORBIDDEN');
  if(pending.size)throw new Error('E2EE_STREAMED_REQUEST_NOT_AWAITED');
  if(failed)throw failure;
  const receipt=await hooks.finish();current();return receipt;
 }finally{
  accepting=false;live=false;for(const observer of observers)observer.close();for(const controller of controllers)controller.abort();
  await Promise.allSettled([...pending]);
 }
}

