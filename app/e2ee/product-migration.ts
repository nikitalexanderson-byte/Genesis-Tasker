import {collectLegacyPersonalPages} from './legacy-pages.ts';
import {collectLegacyArchiveFragments} from './archive-fragments.ts';
import {collectPrivatePathFragments} from './private-path-fragments.ts';
import {requiredPrivatePaths,type PrivateScopeKind} from './private-paths.ts';
import {createOriginalSourceReplay,MigrationSourceReadRouter,type LegacyReadPorts} from './source-replay.ts';
import type {E2eeMigrationSources} from './migration-sources.ts';
import type {E2eeMigration,StreamedPlanningOptions,StreamedContentPlanningOptions,MigrationSourceContext,MigrationPlanningSession} from './migration.ts';
import type {StagedMigrationOptions} from './migration-stage.ts';

type Target={ownerId:string;scopeId:string;kind:PrivateScopeKind;resourceId:string};
/** Collect every declared server family while the original-aware signed HTTP
 * session is live. Returned plaintext is not persisted or used as a side channel;
 * semantic reconciliation reads the authenticated original response later. */
export async function capturePrivateScopeServerSources(target:Target,context:MigrationSourceContext,ports:LegacyReadPorts,assertCurrent:()=>void){
 assertCurrent();if(context.ownerId!==target.ownerId||context.scopeId!==target.scopeId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
 if(target.kind==='personal'){
  for(const read of [ports.legacyWorkspace,ports.legacyTasks,ports.legacyDiary,ports.legacyAurora,ports.legacyStoicheion,ports.legacyAdvice]){assertCurrent();await read.call(ports,context);assertCurrent();}
  for(const source of ['mindmaps','physis','reminders'] as const){
   const read=source==='mindmaps'?ports.legacyMindmapsPage:source==='physis'?ports.legacyPhysisPage:ports.legacyRemindersPage;
   await collectLegacyPersonalPages(context,source,{assertCurrent,readPage:(value,table,offset)=>read.call(ports,value,table,offset)});assertCurrent();
  }
  await collectLegacyArchiveFragments(context,{assertCurrent,readFragment:(value,table,offset,byteOffset)=>ports.legacyArchiveFragment(value,table,offset,byteOffset)});assertCurrent();
 }
 for(const path of requiredPrivatePaths(target.kind).filter(path=>target.kind!=='personal'||path.id==='personal.local-work')){
  await collectPrivatePathFragments(context,{kind:target.kind,resourceId:target.resourceId,pathId:path.id},{assertCurrent,
   read:(value,pathId,table,offset,byteOffset)=>ports.legacyPrivatePathFragment(value,pathId,table,offset,byteOffset),...(ports.legacyPrivatePathBatch?{readBatch:(value:MigrationSourceContext,pathId:string,table:string,offset:number,byteOffset:number)=>ports.legacyPrivatePathBatch!(value,pathId,table,offset,byteOffset)}:{})});assertCurrent();
 }
}

/** Complete implementation path: local protected capture -> signed originals ->
 * source reconciliation -> complete plan adoption -> upload/readback -> commit.
 * Every callback is bound to one owner/device; no missing category can be filled
 * with an empty adapter. A failure leaves originals and immutable plans intact. */
export async function migratePrivateProductScope(options:{target:Target;migration:E2eeMigration;sources:E2eeMigrationSources;router:MigrationSourceReadRouter;
 staged:StagedMigrationOptions;planning:StreamedPlanningOptions;content:StreamedContentPlanningOptions;
 network:(session:MigrationPlanningSession)=>LegacyReadPorts;assertCurrent:()=>void;finalizeClientDeny:()=>Promise<void>;
 progress?:(phase:'snapshot'|'sources'|'reconciliation'|'uploading'|'active')=>void}){
 const {target,migration,sources,router,assertCurrent}=options;sources.assertBinding(target.ownerId,target.scopeId,target.kind);
 const capture=sources.stagedCapture(),reconcile=sources.stagedReconciliation();assertCurrent();
 let status=await migration.status();assertCurrent();
 if(status?.phase==='active'){await options.finalizeClientDeny();assertCurrent();options.progress?.('active');return;}
 if(!status||status.phase==='cancelled'){
  options.progress?.('snapshot');await migration.prepareRetainedStaged(capture,options.staged,options.planning);assertCurrent();status=await migration.status();
 }
 if(status?.protocol!==5){
  options.progress?.('sources');const captured=await migration.withStreamedPlanning(async session=>{
   const network=options.network(session);await router.use(network,()=>capturePrivateScopeServerSources(target,session.context,network,assertCurrent));
  },options.planning);assertCurrent();
  const context:MigrationSourceContext={ownerId:target.ownerId,scopeId:target.scopeId,migrationId:captured.ticket.migrationId,fence:captured.ticket.fence,sourceHash:captured.ticket.sourceHash,generation:captured.ticket.generation};
  options.progress?.('reconciliation');const planned=await migration.planStreamedContent(async session=>{
   const replay=createOriginalSourceReplay(session,assertCurrent);
   try{return await router.use(replay.port,async()=>{const coverage=await reconcile.run(session.sources,context,session.emit,assertCurrent);await replay.drain();assertCurrent();return coverage;});}
   finally{replay.close();}
  },options.content);assertCurrent();
  await migration.adoptStreamedContentPlan(planned.plan,options.planning);assertCurrent();
 }
 options.progress?.('uploading');const phase=await migration.runStreamed(options.planning);assertCurrent();
 if(phase!=='active')throw new Error('E2EE_MIGRATION_UNVERIFIED');await options.finalizeClientDeny();assertCurrent();options.progress?.('active');
}
