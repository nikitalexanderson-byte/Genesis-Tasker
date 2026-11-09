<?php
declare(strict_types=1);

/** Called by shared-workflows.php against its isolated, disposable space. */
function wfIntegrations(string $owner,string $space,array $users):array {
    $db=genesisDb();$checks=[];
    $project=genesisSharedCreateProject($owner,$space,['title'=>'Workflow integrations'])['id'];
    $source=genesisSharedCreateProject($owner,$space,['title'=>'Workflow sources'])['id'];
    $statuses=genesisSharedProjectSnapshot($owner,$project)['statuses'];[$todo,$doing,$done]=array_column($statuses,'id');
    $rules=wfRules($statuses);$rules['statuses'][2]['requiredFields']=[];wfSave($owner,$project,$rules);
    $first=genesisSharedTask($owner,$project,['title'=>'Bulk first','statusId'=>$todo]);
    $second=genesisSharedTask($owner,$project,['title'=>'Bulk second','statusId'=>$todo]);
    $bulk=genesisSharedBulkPreview($owner,['requestId'=>genesisUuid(),'selection'=>['mode'=>'page','items'=>array_map(static fn($task)=>['id'=>$task['id'],'projectId'=>$project,'revision'=>$task['revision']],[$first,$second])],
        'action'=>['kind'=>'status','statusIds'=>[$project=>$doing]]]);
    $report=genesisSharedBulkConfirm($owner,$bulk['id']);
    for($i=0;$i<10&&$report['state']==='running';$i++)$report=genesisSharedBulkAdvance($owner,$bulk['id']);
    $report=genesisSharedBulkReport($owner,$bulk['id']);
    wfCheck($report['counts']['succeeded']===1&&$report['counts']['skipped']===1&&in_array('WORKFLOW_WIP_LIMIT',array_column($report['items'],'code'),true),'Bulk bypassed WIP or lost its explanation');
    $occupied=genesisPlanningRows('SELECT * FROM shared_tasks_read WHERE project_id=? AND status_id=?',[$project,$doing])[0];
    $occupied=genesisSharedGetTask($owner,$project,$occupied['id']);$checks[]='enabled workflow bulk partial result';

    $context=['version'=>2,'timeZone'=>'UTC','gregorianYearStart'=>'march'];
    $manifest=['schemaVersion'=>1,'kind'=>'task','calendarMode'=>'profane','calendarContext'=>$context,
        'projects'=>[['key'=>'root','title'=>'Template project','layout'=>'board','kind'=>'project','statuses'=>[['key'=>'todo','title'=>'Todo','isDone'=>false],['key'=>'doing','title'=>'Doing','isDone'=>false],['key'=>'done','title'=>'Done','isDone'=>true]]]],
        'tasks'=>[['key'=>'parent','projectKey'=>'root','title'=>'Template parent','statusKey'=>'doing'],['key'=>'child','projectKey'=>'root','parentKey'=>'parent','title'=>'Template child','statusKey'=>'doing']]];
    $template=genesisSharedSaveTemplate($owner,$space,$source,['operationId'=>genesisUuid(),'title'=>'Workflow template','manifest'=>$manifest])['id'];
    $options=['spaceId'=>$space,'projectId'=>$project,'anchorDate'=>'2026-10-19','statusMap'=>['todo'=>$todo,'doing'=>$doing,'done'=>$done]];
    $counts=static function()use($db):array{$out=[];foreach(['shared_tasks','shared_audit_events','shared_template_operations','shared_data_imports','shared_data_import_records','shared_notification_outbox','shared_automation_runs'] as $table)$out[$table]=(int)$db->query('SELECT COUNT(*) FROM '.$table)->fetchColumn();return $out;};
    $before=$counts();$preview=genesisSharedPreviewTemplate($owner,$template,$options);wfCheck($preview['canApply'],'Template fixture invalid');
    wfReject(fn()=>genesisSharedApplyTemplate($owner,$template,[...$options,'operationId'=>genesisUuid(),'fingerprint'=>$preview['fingerprint']]),'WORKFLOW_TRANSITION_FORBIDDEN');
    wfCheck($counts()===$before,'Forbidden template entry leaked effects');
    $occupied=wfPatch($owner,$project,$occupied,['statusId'=>$todo]);
    $entryRules=$rules;$entryRules['transitions'][]=['fromStatusId'=>null,'toStatusId'=>$doing,'roles'=>['owner']];wfSave($owner,$project,$entryRules);
    $before=$counts();$preview=genesisSharedPreviewTemplate($owner,$template,$options);
    wfReject(fn()=>genesisSharedApplyTemplate($owner,$template,[...$options,'operationId'=>genesisUuid(),'fingerprint'=>$preview['fingerprint']]),'WORKFLOW_WIP_LIMIT');
    wfCheck($counts()===$before,'Second template task failure leaked its first task or receipt');$checks[]='enabled workflow C1 entry/WIP atomic rollback';

    $sourceStatus=genesisSharedProjectSnapshot($owner,$source)['statuses'][0]['id'];
    $transfer=genesisSharedTask($owner,$source,['title'=>'Transferred task','statusId'=>$sourceStatus]);
    wfSave($owner,$project,$rules);
    $move=['requestId'=>genesisUuid(),'expectedRevision'=>$transfer['revision'],'destinationProjectId'=>$project,'statusId'=>$doing,'position'=>0];
    wfReject(fn()=>genesisSharedMoveTask($owner,$source,$transfer['id'],$move),'WORKFLOW_TRANSITION_FORBIDDEN');
    wfCheck(genesisSharedGetTask($owner,$source,$transfer['id'])['revision']===$transfer['revision'],'Rejected transfer mutated its source');
    wfSave($owner,$project,$entryRules);$transfer=genesisSharedMoveTask($owner,$source,$transfer['id'],$move);
    wfCheck($transfer['projectId']===$project,'Allowed transfer failed');$checks[]='enabled workflow cross project entry';

    $definition=['schemaVersion'=>1,'trigger'=>['type'=>'created'],'conditions'=>[],
        'actions'=>[['type'=>'priority','value'=>3],['type'=>'status','value'=>$doing]],'calendarMode'=>'profane','calendarContext'=>$context];
    $rule=genesisSharedSaveAutomation($owner,$project,['operationId'=>genesisUuid(),'title'=>'Workflow queued rule','enabled'=>true,'definition'=>$definition]);
    $automated=genesisSharedTask($owner,$project,['title'=>'Automation blocked by WIP','statusId'=>$todo]);
    $runs=genesisSharedAutomationRuns($owner,$project,$rule['id'])['runs'];$run=array_values(array_filter($runs,static fn($row)=>$row['taskId']===$automated['id']))[0];
    $job=genesisBackgroundClaim(null,'automation:'.$run['id'].':0');wfCheck($job!==null,'Automation fixture did not enqueue');genesisBackgroundPerform($job);
    $result=genesisPlanningRows('SELECT state,error_code FROM shared_automation_runs WHERE id=?',[$run['id']])[0];
    $after=genesisSharedGetTask($owner,$project,$automated['id']);
    wfCheck($result['state']==='failed'&&$result['error_code']==='WORKFLOW_WIP_LIMIT'&&$after['statusId']===$todo&&$after['priority']===$automated['priority']&&$after['revision']===$automated['revision'],'Queued automation lost its explanation or partially wrote effects');
    genesisSharedSaveAutomation($owner,$project,['operationId'=>genesisUuid(),'expectedRevision'=>$rule['revision'],'enabled'=>false],$rule['id']);
    $transfer=wfPatch($owner,$project,$transfer,['statusId'=>$todo]);$checks[]='enabled workflow C2 real worker/rollback';

    $data=genesisDataEmpty('Workflow historical import');$data['calendarContext']=$context;$data['projects']=$manifest['projects'];
    $data['tasks']=[['key'=>'first','projectKey'=>'root','title'=>'Imported first','statusKey'=>'doing'],['key'=>'second','projectKey'=>'root','title'=>'Imported second','statusKey'=>'doing']];
    $command=['format'=>'json','content'=>genesisDataJson($data),'spaceId'=>$space,'projectId'=>$project,'statusMap'=>$options['statusMap']];
    wfSave($owner,$project,$rules);$before=$counts();$preview=genesisSharedDataPreview($owner,$command);wfCheck($preview['canApply'],'Import fixture invalid');
    wfReject(fn()=>genesisSharedDataApply($owner,[...$command,'operationId'=>genesisUuid(),'fingerprint'=>$preview['fingerprint']]),'WORKFLOW_TRANSITION_FORBIDDEN');
    wfCheck($counts()===$before&&!GenesisDataHistoricalScope::active(),'Forbidden import entry leaked effects/scope');
    wfSave($owner,$project,$entryRules);$before=$counts();$preview=genesisSharedDataPreview($owner,$command);
    wfReject(fn()=>genesisSharedDataApply($owner,[...$command,'operationId'=>genesisUuid(),'fingerprint'=>$preview['fingerprint']]),'WORKFLOW_WIP_LIMIT');
    wfCheck($counts()===$before,'Final import WIP rejection leaked staged graph/receipt');
    $data['tasks'][1]['archivedAt']='2026-10-18T10:00:00Z';$data['tasks'][1]['archiveRootKey']='second';$command['content']=genesisDataJson($data);
    $preview=genesisSharedDataPreview($owner,$command);$import=genesisSharedDataApply($owner,[...$command,'operationId'=>genesisUuid(),'fingerprint'=>$preview['fingerprint']]);
    wfCheck(genesisWorkflowCounts($project)[$doing]===1&&genesisSharedGetTask($owner,$project,$import['taskIds']['second'],true)['archivedAt']!==null,'Archived import consumed WIP or lost archive state');
    genesisSharedDataUndo($owner,$import['importId']);$checks[]='enabled workflow C5 final entry/WIP/archive atomicity';

    $repair=genesisSharedCreateProject($owner,$space,['title'=>'Workflow trash repair'])['id'];$repairStatuses=genesisSharedProjectSnapshot($owner,$repair)['statuses'];$repairRules=wfRules($repairStatuses);$repairRules['statuses'][2]['requiredFields']=[];$repairRules['statuses'][0]['requiredFields']=['description'];wfSave($owner,$repair,$repairRules);
    $repairTask=genesisSharedTask($owner,$repair,['title'=>'Needs later description','description'=>'Valid before legacy write','statusId'=>$repairStatuses[0]['id']]);
    $repairField=['id'=>genesisUuid(),'title'=>'Scoped repair field','type'=>'text','projectId'=>$repair,'options'=>[],'position'=>0,'required'=>false,'showCard'=>false,'showList'=>false,'archived'=>false,'expectedRevision'=>0];
    $fieldPreview=genesisSharedPreviewCustomField($owner,$space,$repairField);genesisSharedSaveCustomField($owner,$space,[...$repairField,'operationId'=>genesisUuid(),'fingerprint'=>$fieldPreview['fingerprint']]);
    $settings=genesisSharedWorkflow($owner,$repair);$readonly=genesisSharedWorkflow($users['viewer'],$repair);
    wfCheck($settings['context']['project']['permissions']['manageProjects']&&!$readonly['context']['project']['permissions']['manageProjects'],'Settings projection misstated current rights');
    wfCheck(array_column($settings['context']['statuses'],'id')===array_column($repairStatuses,'id'),'Settings projection lost status catalog');
    wfCheck(array_column($settings['context']['customFieldDefinitions'],'id')===[$repairField['id']],'Settings projection included another project field');
    wfCheck(!isset($settings['context']['tasks'],$settings['context']['members'])&&!str_contains(genesisDataJson($settings),$repairTask['title']),'Settings projection read hidden task content');
    genesisSharedSetArchived($owner,$repair,true);$archived=genesisSharedWorkflow($owner,$repair);
    wfCheck($archived['context']===$settings['context'],'Archived settings context changed');
    $archiveRows=array_column(genesisSharedArchivedProjects($owner,$space),null,'id');wfCheck($archiveRows[$repair]['permissions']['manageProjects'],'Archived list omitted repair permission');
    genesisSharedSetArchived($owner,$repair,false);
    genesisSharedTrashProject($owner,$repair,['expectedRevision'=>genesisSharedProjectSnapshot($owner,$repair)['project']['revision']]);
    $trashed=array_values(array_filter(genesisSharedTrashList($owner,$space),static fn($row)=>$row['kind']==='project'&&$row['id']===$repair))[0];
    $readonlyTrash=array_column(genesisSharedTrashList($users['viewer'],$space),null,'id');
    wfCheck($trashed['canManageWorkflow']&&!$readonlyTrash[$repair]['canManageWorkflow']&&$trashed['projectTitle']==='Workflow trash repair','Trash repair permission or identity is wrong');
    wfCheck(genesisSharedWorkflow($owner,$repair)['context']===$settings['context'],'Trash repair relied on an ordinary project snapshot');
    wfReject(fn()=>genesisSharedWorkflow($users['outsider'],$repair),'SHARED_PROJECT_NOT_FOUND');
    $db->prepare('DELETE FROM shared_project_members WHERE project_id=? AND user_id=?')->execute([$repair,$users['viewer']]);
    wfReject(fn()=>genesisSharedWorkflow($users['viewer'],$repair),'SHARED_PROJECT_NOT_FOUND');$checks[]='minimal live/archive/trash settings context and current ACL';
    // Simulate an older server that preserves definitions but cannot enforce them.
    $db->prepare('UPDATE shared_tasks SET description=? WHERE id=?')->execute([genesisSharedContentEncrypt(''),$repairTask['id']]);
    wfReject(fn()=>genesisSharedRestoreTrash($owner,$space,'project',$repair,['expectedExpiresAt'=>$trashed['expiresAt']]),'WORKFLOW_REQUIRED_FIELDS');
    wfCheck((bool)genesisPlanningRows("SELECT object_id FROM shared_trash WHERE kind='project' AND object_id=?",[$repair]),'Rejected project restore removed trash');
    $repairRules['statuses'][0]['requiredFields']=[];wfSave($owner,$repair,$repairRules);
    genesisSharedRestoreTrash($owner,$space,'project',$repair,['expectedExpiresAt'=>$trashed['expiresAt']]);
    wfCheck(genesisSharedGetTask($owner,$repair,$repairTask['id'])['title']===$repairTask['title'],'Project repair lost task');$checks[]='full workflow repair in project trash then guarded restore';
    return $checks;
}
