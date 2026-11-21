package ru.genesis.calendar.security

/** Same composed product sequence as web. The caller supplies actual feature
 * factories, native account/device lifetime and persistent client deny marker. */
internal object E2eeProductMigration{
    class Target(val ownerId:String,val scopeId:String,val kind:String,val resourceId:String)
    class Options(val target:Target,val migration:E2eeMigration,val sources:E2eeMigrationSources,val router:E2eeMigrationSourceReadRouter,
        val staged:E2eeStagedMigrationOptions,val planning:E2eeStreamedPlanningOptions,val content:E2eeStreamedContentPlanningOptions,
        val network:(E2eeMigrationSession)->E2eeLegacyReadTransport,val assertCurrent:()->Unit,val finalizeClientDeny:suspend()->Unit,
        val progress:(String)->Unit={})
    private suspend fun capture(target:Target,context:E2eeMigrationSourceContext,ports:E2eeLegacyReadTransport,inventory:E2eePrivatePaths,catalogue:E2eePrivatePathCatalogue,current:()->Unit){
        current();check(context.ownerId==target.ownerId&&context.scopeId==target.scopeId){"E2EE_SCOPE_BINDING_MISMATCH"}
        if(target.kind=="personal"){
            for(read in listOf(ports::legacyWorkspace,ports::legacyTasks,ports::legacyDiary,ports::legacyAurora,ports::legacyStoicheion,ports::legacyAdvice)){current();read(context);current()}
            E2eeLegacyPersonalPages.collect(context,"mindmaps",current,ports::legacyMindmapsPage)
            E2eeLegacyPersonalPages.collect(context,"physis",current,ports::legacyPhysisPage)
            E2eeLegacyPersonalPages.collect(context,"reminders",current,ports::legacyRemindersPage)
            E2eeLegacyArchiveFragments.collect(context,current,ports::legacyArchiveFragment);current()
        }
        for(path in inventory.required(target.kind).filter{target.kind!="personal"||it.id=="personal.local-work"}){
            E2eePrivatePathFragments.collect(context,target.kind,target.resourceId,path.id,catalogue.tables(target.kind,path.id),current,ports::legacyPrivatePathFragment);current()
        }
    }
    suspend fun run(options:Options,catalogue:E2eePrivatePathCatalogue){
        val target=options.target;val migration=options.migration;val sources=options.sources;val current=options.assertCurrent
        sources.assertBinding(target.ownerId,target.scopeId,target.kind);val local=sources.stagedCapture();val reconciliation=sources.stagedReconciliation();current()
        var status=migration.status();current()
        if(status?.phase=="active"){options.finalizeClientDeny();current();options.progress("active");return}
        if(status==null){options.progress("snapshot");migration.prepareStaged(local,options.staged);current();status=migration.status()}
        if(status?.protocol!=5){
            options.progress("sources");val captured=migration.withStreamedPlanning(options.planning){session->
                val network=options.network(session);options.router.use(network){capture(target,session.context,network,options.planning.inventory,catalogue,current)}
            };current()
            val ticket=captured.ticket;val context=E2eeMigrationSourceContext(target.ownerId,target.scopeId,ticket.migrationId,ticket.fence,ticket.sourceHash,ticket.generation)
            options.progress("reconciliation");val planned=migration.planStreamedContent(options.content){session->
                E2eeOriginalSourceReplay(session,current).use{replay->options.router.use(replay){
                    val coverage=reconciliation.run(session.sources,context,{path,record->session.emit(path,record)},current);replay.drain();current();coverage
                }}
            };current();migration.adoptStreamedContentPlan(planned.plan,options.planning);current()
        }
        options.progress("uploading");check(migration.runStreamed(options.planning)=="active"){"E2EE_MIGRATION_UNVERIFIED"};current()
        options.finalizeClientDeny();current();options.progress("active")
    }
}
