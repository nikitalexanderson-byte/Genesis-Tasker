import type {MigrationContentStream} from './content-plan.ts';
import type {RemoteOriginalRegistration,RemoteOriginalReference} from './remote-original.ts';
import type {StagedSourceInput} from './staged-reconciliation.ts';
import type {MigrationCoverage} from './migration.ts';

export type MigrationContentPlanningSession=Readonly<{sources:StagedSourceInput;
 originals:readonly Readonly<{registration:RemoteOriginalRegistration;completion:RemoteOriginalReference}>[];
 withOriginal:(id:string,consume:(bytes:AsyncIterable<Uint8Array>)=>Promise<void>)=>Promise<void>;
 emit:(path:string,record:MigrationContentStream)=>Promise<void>}>;
type Hooks<T>={sources:StagedSourceInput;originals:MigrationContentPlanningSession['originals'];assertCurrent:()=>void;
 withOriginal:(id:string,consume:(bytes:AsyncIterable<Uint8Array>)=>Promise<void>,current:()=>void)=>Promise<void>;
 emit:(path:string,record:MigrationContentStream,current:()=>void)=>Promise<void>;
 finish:(coverage:readonly MigrationCoverage[])=>Promise<T>};

/** Await and revoke every original/output loan before the coordinator's single
 * job fence is released. Caught IO failures and unawaited outputs stay sticky. */
export async function withOwnedContentPlanning<T>(hooks:Hooks<T>,build:(session:MigrationContentPlanningSession)=>Promise<readonly MigrationCoverage[]>):Promise<T>{
 let live=true,accepting=true,reading=false,writing=false,failed=false,failure:unknown;
 const pending=new Set<Promise<void>>();
 const current=()=>{hooks.assertCurrent();if(!live)throw new Error('E2EE_CONTENT_SESSION_CLOSED');};
 const remember=(error:unknown)=>{if(!failed){failed=true;failure=error;}};
 const track=(role:'read'|'write',operation:(current:()=>void)=>Promise<void>)=>{
  try{current();if(!accepting)throw new Error('E2EE_CONTENT_SESSION_CLOSED');if(role==='read'?reading:writing)throw new Error('E2EE_CONTENT_SESSION_BUSY');
   if(role==='read')reading=true;else writing=true;
  }catch(error){remember(error);const rejected=Promise.reject<void>(error);void rejected.catch(()=>{});return rejected;}
  const task=(async()=>{current();await operation(current);})().catch(error=>{remember(error);throw error;}).finally(()=>{
   if(role==='read')reading=false;else writing=false;pending.delete(task);
  });pending.add(task);void task.catch(()=>{});return task;
 };
 const session:MigrationContentPlanningSession=Object.freeze({sources:hooks.sources,originals:hooks.originals,
  withOriginal:(id,consume)=>track('read',guard=>hooks.withOriginal(id,consume,guard)),
  emit:(path,record)=>track('write',guard=>hooks.emit(path,record,guard))});
 try{
  current();const coverage=await build(session);accepting=false;current();
  if(pending.size)throw new Error('E2EE_CONTENT_SESSION_NOT_AWAITED');if(failed)throw failure;
  const result=await hooks.finish(coverage);current();return result;
 }finally{accepting=false;live=false;await Promise.allSettled([...pending]);}
}
