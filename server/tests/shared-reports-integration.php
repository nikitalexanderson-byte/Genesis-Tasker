<?php
declare(strict_types=1);
require_once __DIR__ . '/shared-fixture-plan.php';
if(PHP_SAPI!=='cli'||getenv('GENESIS_IMPROVEMENTS_TEST')!=='isolated')throw new RuntimeException('Explicit isolated test environment required.');
require __DIR__.'/../src/bootstrap.php';
$config=genesisConfig();$ciDirectory=getenv('GENESIS_LOCAL_CI_DIR')?:getenv('GENESIS_SMOKE_ROOT');
$browser=$config['app_url']==='http://127.0.0.1:4338'&&basename($config['db_path'])==='improvements-test.sqlite';
$ci=$config['app_url']==='https://localhost.invalid'&&$ciDirectory&&str_replace('\\','/',$config['db_path'])===str_replace('\\','/',$ciDirectory).'/genesis.sqlite';
if(!$browser&&!$ci)throw new RuntimeException('Non-fixture refused.');
foreach(['repository','google','shared-projects','shared-google'] as $module)require_once __DIR__.'/../src/'.$module.'.php';
function riCheck(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);}
function riReject(callable $work,string $code):void{
    try{$work();}catch(InvalidArgumentException|GenesisSharedAccessException $error){riCheck($error->getMessage()===$code,'Unexpected '.$error->getMessage().' instead of '.$code);return;}
    throw new RuntimeException('Expected '.$code);
}
function riHistory(array $task,array $starts):array{
    $rows=genesisDataRows('SELECT t.* FROM shared_tasks_history_read t WHERE t.id=?',[$task['id']]);
    $events=genesisDataRows('SELECT e.*,r.rowid AS sequence FROM shared_audit_events_read e JOIN shared_audit_events r ON r.id=e.id WHERE e.object_id=? ORDER BY r.rowid',[$task['id']]);
    $points=array_map(static fn($event)=>genesisReportPoint($event,[]),$events);
    return genesisReportTaskHistory($rows[0],$points,array_fill_keys($starts,true),genesisReportTime(genesisNow()));
}
$db=genesisDb();$owner=null;$space=null;
try{
    $tag='c4-integration-'.genesisUuid();$owner=genesisUpsertGoogleUser(['email_verified'=>true,'sub'=>$tag,'email'=>$tag.'@example.invalid','name'=>'C4 integration'],[],false)['id'];
    genesisTestEnableSharedProjects($owner);$space=genesisSharedCreateSpace($owner,['title'=>'C4 integrations'])['id'];
    $project=genesisSharedCreateProject($owner,$space,['title'=>'C4 source']);$pid=$project['id'];$statuses=genesisSharedProjectSnapshot($owner,$pid)['statuses'];$todo=$statuses[0]['id'];$doing=$statuses[1]['id'];$done=$statuses[2]['id'];
    $context=['version'=>2,'timeZone'=>'UTC','gregorianYearStart'=>'march'];$today=gmdate('Y-m-d');
    $options=['filter'=>['projectIds'=>[$pid]],'from'=>$today,'to'=>$today,'calendarMode'=>'profane','calendarContext'=>$context,'cycleStartStatusIds'=>[$doing]];
    $fields=[];
    foreach(['number','checkbox'] as $type){
        $draft=['id'=>genesisUuid(),'projectId'=>$pid,'title'=>'C4 '.$type,'type'=>$type,'options'=>[],'position'=>0,'required'=>false,'showCard'=>true,'showList'=>true,'archived'=>false,'expectedRevision'=>0];
        $preview=genesisSharedPreviewCustomField($owner,$space,$draft);
        $fields[$type]=genesisSharedSaveCustomField($owner,$space,[...$draft,'operationId'=>genesisUuid(),'fingerprint'=>$preview['fingerprint']])['field']['id'];
    }
    $typed=genesisSharedTask($owner,$pid,['title'=>'Typed filter','statusId'=>$doing,'customFields'=>[$fields['number']=>0,$fields['checkbox']=>false],'dueDate'=>$today]);
    $criteria=[['fieldId'=>$fields['number'],'op'=>'eq','value'=>0],['fieldId'=>$fields['checkbox'],'op'=>'eq','value'=>false]];
    $filter=['projectIds'=>[$pid],'customFields'=>$criteria];$viewDefinition=['version'=>1,'title'=>'C4 exact view','filter'=>$filter,'sort'=>'position','relative'=>'none','calendarMode'=>'lunar','calendarContext'=>$context];
    $view=genesisSharedViewSave($owner,['requestId'=>genesisUuid(),'spaceId'=>null,'visibility'=>'personal','definition'=>$viewDefinition]);
    foreach([$filter,['savedViewId'=>$view['id']],['viewDefinition'=>$viewDefinition]] as $selection){
        $report=genesisSharedReport($owner,[...$options,'filter'=>$selection]);$drill=genesisSharedReportTasks($owner,['token'=>$report['token'],'metric'=>'all']);
        riCheck($report['summary']['all']['count']===1&&array_column($drill['tasks'],'id')===[$typed['id']],'C3 zero/false or saved/unsaved view did not match source');
    }
    // Mutating the saved view must invalidate its own token too.
    $savedReport=genesisSharedReport($owner,[...$options,'filter'=>['savedViewId'=>$view['id']]]);
    genesisSharedViewSave($owner,['requestId'=>genesisUuid(),'expectedRevision'=>$view['revision'],'definition'=>[...$viewDefinition,'title'=>'Changed view']],$view['id']);
    riReject(fn()=>genesisSharedReportCheck($owner,$savedReport['token']),'REPORT_CHANGED');
    $stable=[];foreach(['profane','sacred','lunar'] as $mode){
        $report=genesisSharedReport($owner,[...$options,'calendarMode'=>$mode]);$stable[]=array_map(static fn($metric)=>$metric['count'],$report['summary']);
        riCheck($report['period']['from']===$today&&$report['period']['to']===$today&&$report['period']['calendarMode']===$mode,'Calendar display changed stored civil boundaries');
    }
    riCheck($stable[0]===$stable[1]&&$stable[1]===$stable[2],'Calendar display changed the selected task set');
    riReject(fn()=>genesisSharedReport($owner,[...$options,'from'=>'2024-01-01','to'=>'2035-01-01']),'REPORT_PERIOD_INVALID');

    // Exact local midnight clipping across a 23-hour DST day, rather than civil-day * 86400.
    $dstTask=genesisSharedTask($owner,$pid,['title'=>'DST interval','statusId'=>$doing]);
    $dstTask=genesisSharedTask($owner,$pid,['expectedRevision'=>$dstTask['revision'],'statusId'=>$done],$dstTask['id']);
    $events=genesisDataRows('SELECT e.id,e.details_json FROM shared_audit_events_read e JOIN shared_audit_events r ON r.id=e.id WHERE e.object_id=? ORDER BY r.rowid',[$dstTask['id']]);
    foreach($events as $index=>$event){$at=['2024-03-30T00:00:00Z','2024-04-02T00:00:00Z'][$index];$details=json_decode($event['details_json'],true);$details['reportState']['at']=$at;$db->prepare('UPDATE shared_audit_events SET created_at=?,details_json=? WHERE id=?')->execute([$at,genesisSharedContentEncrypt(genesisDataJson($details)),$event['id']]);}
    $db->prepare('UPDATE shared_tasks SET created_at=?,updated_at=?,completed_at=? WHERE id=?')->execute(['2024-03-30T00:00:00Z','2024-04-02T00:00:00Z','2024-04-02T00:00:00Z',$dstTask['id']]);
    foreach([['Europe/Berlin','2024-03-31',23],['Pacific/Kiritimati','2024-04-01',24]] as [$zone,$date,$expectedHours]){
        $clipped=genesisSharedReport($owner,[...$options,'filter'=>['projectIds'=>[$pid],'ids'=>[$dstTask['id']]],'from'=>$date,'to'=>$date,'calendarContext'=>[...$context,'timeZone'=>$zone]]);
        riCheck(array_sum(array_column($clipped['stages'],'seconds'))===$expectedHours*3600.0,'Local period boundary did not clip actual elapsed time: '.$zone);
        $drill=genesisSharedReportTasks($owner,['token'=>$clipped['token'],'metric'=>'stage:'.$doing]);riCheck(array_column($drill['tasks'],'id')===[$dstTask['id']],'Clipped stage task selection differs');
    }

    // A no-op revision remains observed, without producing user activity or notifications.
    $activity=count(genesisSharedActivity($owner,$pid,$typed['id'],null));$notifications=(int)$db->query('SELECT COUNT(*) FROM shared_notification_outbox')->fetchColumn();
    $typed=genesisSharedTask($owner,$pid,['expectedRevision'=>$typed['revision'],'title'=>$typed['title']],$typed['id']);
    riCheck(riHistory($typed,[$doing])['currentKnown'],'A no-op edit broke history continuity');
    riCheck(count(genesisSharedActivity($owner,$pid,$typed['id'],null))===$activity&&(int)$db->query('SELECT COUNT(*) FROM shared_notification_outbox')->fetchColumn()===$notifications,'Observation leaked user activity or notifications');

    $preview=genesisSharedBulkPreview($owner,['requestId'=>genesisUuid(),'selection'=>['mode'=>'page','items'=>[['id'=>$typed['id'],'projectId'=>$pid,'revision'=>$typed['revision']]]],'action'=>['kind'=>'status','statusIds'=>[$pid=>$done]]]);
    genesisSharedBulkConfirm($owner,$preview['id']);for($i=0;$i<5;$i++){$progress=genesisSharedBulkAdvance($owner,$preview['id']);if($progress['state']!=='running')break;}
    $typed=genesisSharedGetTask($owner,$pid,$typed['id']);riCheck($typed['completedAt']!==null&&riHistory($typed,[$doing])['lastCompletion']!==null,'Bulk completion lost report evidence');
    $gated=genesisSharedTask($owner,$pid,['title'=>'Approval report','statusId'=>$doing,'approvalRequired'=>true,'approverIds'=>[$owner]]);
    $gated=genesisSharedApproveTask($owner,$pid,$gated['id']);riCheck($gated['completedAt']!==null&&riHistory($gated,[$doing])['lastCompletion']!==null,'Approved completion lost report evidence');
    $archived=genesisSharedArchiveTask($owner,$pid,$gated['id'],['archived'=>true,'expectedRevision'=>$gated['revision'],'requestId'=>genesisUuid()]);
    $active=genesisSharedReport($owner,$options);$all=genesisSharedReport($owner,[...$options,'filter'=>['projectIds'=>[$pid],'includeArchived'=>true]]);
    riCheck($all['summary']['all']['count']===$active['summary']['all']['count']+1,'Report archive selection differs from source list');
    genesisSharedArchiveTask($owner,$pid,$gated['id'],['archived'=>false,'expectedRevision'=>$archived['revision'],'requestId'=>genesisUuid()]);
    $destination=genesisSharedCreateProject($owner,$space,['title'=>'C4 destination']);$destinationStatus=genesisSharedProjectSnapshot($owner,$destination['id'])['statuses'][0]['id'];
    $moved=genesisSharedTask($owner,$pid,['title'=>'Moves interrupt cycles','statusId'=>$doing]);
    genesisSharedMoveTask($owner,$pid,$moved['id'],['destinationProjectId'=>$destination['id'],'statusId'=>$destinationStatus,'expectedRevision'=>$moved['revision'],'position'=>0,'requestId'=>genesisUuid()]);
    $moved=genesisSharedGetTask($owner,$destination['id'],$moved['id']);riCheck(riHistory($moved,[$doing,$destinationStatus])['currentKnown'],'A move lost current history evidence');

    // Automation uses the ordinary mutation path; no artificial event replay is needed.
    $rule=genesisSharedSaveAutomation($owner,$pid,['operationId'=>genesisUuid(),'title'=>'C4 automatic stage','enabled'=>true,'definition'=>['schemaVersion'=>1,'trigger'=>['type'=>'created'],'conditions'=>[],'actions'=>[['type'=>'status','value'=>$doing]],'calendarMode'=>'profane','calendarContext'=>$context]]);
    $automatic=genesisSharedTask($owner,$pid,['title'=>'Automation report','statusId'=>$todo]);$runs=genesisSharedAutomationRuns($owner,$pid,$rule['id'])['runs'];$run=array_values(array_filter($runs,static fn($row)=>$row['taskId']===$automatic['id']))[0];
    $job=genesisBackgroundClaim(null,'automation:'.$run['id'].':0');riCheck($job!==null&&genesisBackgroundPerform($job)==='succeeded','Report integration automation failed');
    $automatic=genesisSharedGetTask($owner,$pid,$automatic['id']);riCheck($automatic['statusId']===$doing&&riHistory($automatic,[$doing])['currentKnown'],'Automation transition lost report evidence');

    $manifest=['schemaVersion'=>1,'kind'=>'project','calendarMode'=>'profane','calendarContext'=>$context,'projects'=>[['key'=>'root','title'=>'C4 template project','kind'=>'project','layout'=>'board','statuses'=>[['key'=>'open','title'=>'Work','isDone'=>false],['key'=>'done','title'=>'Done','isDone'=>true]]]],'tasks'=>[['key'=>'task','projectKey'=>'root','title'=>'Template task','statusKey'=>'open']]];
    $template=genesisSharedSaveTemplate($owner,$space,$pid,['operationId'=>genesisUuid(),'title'=>'C4 template','manifest'=>$manifest]);$apply=['spaceId'=>$space,'anchorDate'=>$today];$preview=genesisSharedPreviewTemplate($owner,$template['id'],$apply);
    $receipt=genesisSharedApplyTemplate($owner,$template['id'],[...$apply,'operationId'=>genesisUuid(),'fingerprint'=>$preview['fingerprint']]);
    $templateTask=genesisSharedQueryTasks($owner,['projectIds'=>[$receipt['rootProjectId']]])['tasks'][0];riCheck(riHistory($templateTask,[$templateTask['statusId']])['createdEvidenceAt']!==null,'New template task lacks real creation evidence');

    // Historical imports must remain unknown; source audit metadata is not a new live event.
    $data=genesisDataEmpty('C4 imported');$data['projects']=[['key'=>'root','title'=>'C4 history import','kind'=>'project','layout'=>'board','statuses'=>[['key'=>'open','title'=>'Work','isDone'=>false],['key'=>'done','title'=>'Done','isDone'=>true]]]];
    $data['tasks']=[['key'=>'old','projectKey'=>'root','title'=>'Historic task','statusKey'=>'done','createdAt'=>'2024-01-01T00:00:00Z','completedAt'=>'2024-01-02T00:00:00Z','updatedAt'=>'2024-01-02T00:00:00Z']];
    $data['history']=[['key'=>'old-event','projectKey'=>'root','taskKey'=>'old','actorTitle'=>'Source','action'=>'task.updated','createdAt'=>'2024-01-02T00:00:00Z','details'=>['changes'=>['isDone'=>['from'=>false,'to'=>true]]]]];
    $command=['format'=>'json','content'=>genesisDataJson($data),'spaceId'=>$space];$preview=genesisSharedDataPreview($owner,$command);riCheck($preview['canApply'],'Historical report fixture blocked');
    $receipt=genesisSharedDataApply($owner,[...$command,'operationId'=>genesisUuid(),'fingerprint'=>$preview['fingerprint']]);
    $importReport=genesisSharedReport($owner,[...$options,'filter'=>['projectIds'=>[$receipt['rootProjectId']]],'from'=>'2024-01-01','to'=>'2024-01-03','cycleStartStatusIds'=>[]]);
    riCheck($importReport['cycle']['known']['count']===0&&$importReport['cycle']['unknown']['count']===1&&$importReport['stages']===[]&&$importReport['daily'][0]['coverage']==='unknown','Imported historical metadata fabricated a measured cycle or zero history');
    riCheck($db->query('PRAGMA foreign_key_check')->fetchAll()===[],'Foreign keys broken');
    echo "C4 integrations: C3 zero/false, saved/unsaved views, civil calendar boundaries, no-op isolation, bulk, approval, archive, moves, C1/C2 evidence and C5 historical quarantine passed.\n";
}finally{
    if($db->inTransaction())$db->rollBack();
    if($space)$db->prepare('DELETE FROM shared_spaces WHERE id=?')->execute([$space]);
    if($owner)$db->prepare('DELETE FROM users WHERE id=?')->execute([$owner]);
}
