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
function spCheck(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);}
function spReject(callable $work,string $code):void{
    try{$work();}catch(InvalidArgumentException|GenesisSharedAccessException $error){spCheck($error->getMessage()===$code,'Unexpected '.$error->getMessage().' instead of '.$code);return;}throw new RuntimeException('Expected '.$code);
}
function spSettings(string $actor,string $project,bool $enabled=true,string $unit='points'):array {
    return genesisSharedSavePlanning($actor,$project,['requestId'=>genesisUuid(),'expectedRevision'=>genesisPlanningConfig($project)['revision'],'enabled'=>$enabled,'estimateUnit'=>$unit]);
}
function spSprint(string $actor,string $project,string $title='Sprint'):array {
    return genesisSharedSaveSprint($actor,$project,['requestId'=>genesisUuid(),'expectedRevision'=>0,'title'=>$title,'goal'=>'План · <script>text only</script>',
        'startDate'=>'2026-10-18','endDate'=>'2026-10-31','calendarMode'=>'lunar','calendarContext'=>['version'=>2,'timeZone'=>'Europe/Berlin','gregorianYearStart'=>'march']])['sprint'];
}
function spTransition(string $actor,string $project,array $sprint,string $action,array $extra=[]):array {
    return genesisSharedTransitionSprint($actor,$project,$sprint['id'],['requestId'=>genesisUuid(),'expectedRevision'=>$sprint['revision'],'fingerprint'=>genesisPlanningFingerprint($project),'action'=>$action,...$extra])['sprint'];
}
$users=[];$space=null;$db=genesisDb();$checks=[];
try {
    $tag='planning-'.genesisUuid();foreach(['owner','member','viewer','outsider'] as $kind){$users[$kind]=genesisUpsertGoogleUser(['email_verified'=>true,'sub'=>$tag.$kind,'email'=>$tag.$kind.'@example.invalid','name'=>'Planning '.$kind],[],false)['id'];genesisTestEnableSharedProjects($users[$kind]);}
    $owner=$users['owner'];$space=genesisSharedCreateSpace($owner,['title'=>'Planning isolated'])['id'];
    foreach(['member'=>'member','viewer'=>'guest'] as $kind=>$role)$db->prepare('INSERT INTO shared_space_members(space_id,user_id,role,joined_at,all_projects) VALUES(?,?,?,?,1)')->execute([$space,$users[$kind],$role,genesisNow()]);
    $project=genesisSharedCreateProject($owner,$space,['title'=>'Planning A'])['id'];$other=genesisSharedCreateProject($owner,$space,['title'=>'Planning B'])['id'];
    $statuses=genesisSharedProjectSnapshot($owner,$project)['statuses'];$todo=$statuses[0]['id'];$done=$statuses[2]['id'];$checks[]='fixture';
    $task=genesisSharedTask($owner,$project,['title'=>'Unestimated legacy','statusId'=>$todo]);
    spReject(fn()=>genesisSharedTask($owner,$project,['expectedRevision'=>$task['revision'],'storyPoints'=>0],$task['id']),'PLANNING_DISABLED');
    spCheck(genesisSharedGetTask($owner,$project,$task['id'])['revision']===$task['revision'],'Disabled estimate partially wrote task');
    spCheck(!genesisSharedPlanning($owner,$project)['config']['enabled'],'Planning enabled implicitly');
    $ownerContext=genesisSharedPlanning($owner,$project)['context'];$viewerContext=genesisSharedPlanning($users['viewer'],$project)['context'];
    spCheck($ownerContext===['permissions'=>['editTasks'=>true,'organizeTasks'=>true,'manageProjects'=>true]],'Planning context is not minimal/current for owner');
    spCheck($viewerContext===['permissions'=>['editTasks'=>false,'organizeTasks'=>false,'manageProjects'=>false]],'Read-only planning context grants write permissions');
    spReject(fn()=>spSettings($users['viewer'],$project),'SHARED_PROJECT_FORBIDDEN');
    $input=['requestId'=>genesisUuid(),'expectedRevision'=>0,'enabled'=>true,'estimateUnit'=>'points'];
    $enabled=genesisSharedSavePlanning($owner,$project,$input);spCheck(genesisSharedSavePlanning($owner,$project,$input)===$enabled,'Settings replay diverged');
    spReject(fn()=>genesisSharedSavePlanning($owner,$project,[...$input,'estimateUnit'=>'hours']),'SHARED_REQUEST_ID_CONFLICT');
    spReject(fn()=>genesisSharedSavePlanning($owner,$project,[...$input,'requestId'=>genesisUuid()]),'PLANNING_CONFLICT');
    spSettings($owner,$other);$foreign=spSprint($owner,$other,'Foreign sprint');$a=spSprint($owner,$project,'Sprint A');$b=spSprint($owner,$project,'Sprint B');
    $invalid=['requestId'=>genesisUuid(),'expectedRevision'=>0,'title'=>'Invalid','startDate'=>'2026-02-30','endDate'=>'2026-03-14','calendarMode'=>'profane','calendarContext'=>['version'=>2,'timeZone'=>'UTC']];
    spReject(fn()=>genesisSharedSaveSprint($owner,$project,$invalid),'SPRINT_DATES_INVALID');
    spReject(fn()=>genesisSharedSaveSprint($owner,$project,[...$invalid,'startDate'=>'2026-03-01','calendarContext'=>['version'=>1,'timeZone'=>'UTC']]),'SPRINT_CONTEXT_INVALID');
    $checks[]='opt-in-authorization-config-cas-replay-and-calendar-validation';
    $taskInput=['requestId'=>genesisUuid(),'title'=>'Known zero','statusId'=>$todo,'sprintId'=>$a['id'],'storyPoints'=>0,'estimateHours'=>2.5,'assigneeId'=>$users['member']];
    $zero=genesisSharedTask($owner,$project,$taskInput);spCheck(genesisPlanningJson(genesisSharedTask($owner,$project,$taskInput))===genesisPlanningJson($zero),'Task estimate receipt replay diverged');
    $receipt=genesisPlanningRows('SELECT response_json FROM shared_mutation_receipts WHERE user_id=? AND request_id=?',[$owner,$taskInput['requestId']]);$stored=json_decode($receipt[0]['response_json'],true);
    spCheck(str_starts_with($stored['storyPoints']['planningValue'],GENESIS_SHARED_CONTENT_PREFIX)&&str_starts_with($stored['estimateHours']['planningValue'],GENESIS_SHARED_CONTENT_PREFIX),'Receipt stored plaintext estimates');
    $estimated=genesisSharedTask($owner,$project,['title'=>'Estimated','statusId'=>$todo,'sprintId'=>$a['id'],'storyPoints'=>3.5,'estimateHours'=>0]);
    $unknown=genesisSharedTask($owner,$project,['title'=>'Unestimated','statusId'=>$todo,'sprintId'=>$a['id']]);
    $legacy=genesisSharedTask($owner,$project,['expectedRevision'=>$zero['revision'],'title'=>'Legacy edit keeps estimates'],$zero['id']);
    spCheck($legacy['storyPoints']===0&&$legacy['estimateHours']===2.5&&$legacy['sprintId']===$a['id'],'Omitted legacy fields erased planning');
    $zero=$legacy;
    foreach([-1,1.111,'2',true,1000001] as $bad)spReject(fn()=>genesisSharedTask($owner,$project,['expectedRevision'=>$zero['revision'],'storyPoints'=>$bad],$zero['id']),'PLANNING_ESTIMATE_INVALID');
    spReject(fn()=>genesisSharedTask($owner,$project,['expectedRevision'=>$zero['revision'],'sprintId'=>$foreign['id']],$zero['id']),'SPRINT_NOT_FOUND');
    $planning=genesisSharedPlanning($owner,$project);$total=$planning['totals'][$a['id']];
    spCheck($total['count']===3&&$total['points']['value']===3.5&&$total['points']['unestimated']===1&&$total['hours']['value']===2.5&&$total['hours']['unestimated']===1,'Unit sums confused zero and missing');
    $by=(array)$planning['byAssignee'];spCheck((float)$by[$a['id']][$users['member']]['points']['value']===0.0&&$by[$a['id']][$users['member']]['points']['unestimated']===0,'Member zero treated as missing');
    spCheck(genesisSharedQueryTasks($owner,['projectIds'=>[$project],'backlog'=>true])['total']===1,'Backlog includes planned work');
    spCheck(genesisSharedQueryTasks($owner,['projectIds'=>[$project],'sprintId'=>$a['id']])['total']===3,'Sprint query differs from planning');
    foreach(genesisPlanningRows('SELECT estimates_json FROM shared_task_planning') as $row)spCheck(str_starts_with($row['estimates_json'],GENESIS_SHARED_CONTENT_PREFIX),'Plaintext estimates');
    foreach(genesisPlanningRows('SELECT content_json FROM shared_sprints') as $row)spCheck(str_starts_with($row['content_json'],GENESIS_SHARED_CONTENT_PREFIX),'Plaintext sprint content');
    $checks[]='separate-units-null-zero-assignee-totals-encryption-and-legacy-patch';
    $context=['version'=>2,'timeZone'=>'Europe/Berlin','gregorianYearStart'=>'march'];$today=gmdate('Y-m-d');
    $otherStatus=genesisSharedProjectSnapshot($owner,$other)['statuses'][0]['id'];genesisSharedTask($owner,$other,['title'=>'Different project scale','statusId'=>$otherStatus,'storyPoints'=>13,'estimateHours'=>7]);
    $report=genesisSharedReport($owner,['filter'=>['projectIds'=>[$project,$other]],'from'=>$today,'to'=>$today,'calendarMode'=>'profane','calendarContext'=>$context,'cycleStartStatusIds'=>[]]);
    $groups=array_column($report['estimates']['projects'],null,'projectId');
    spCheck($report['estimates']['available']&&$report['estimates']['points']===null&&$report['estimates']['hours']===null&&$groups[$project]['points']['value']===3.5&&(float)$groups[$other]['points']['value']===13.0,'Report mixed project point scales');
    $known=genesisSharedReportTasks($owner,['token'=>$report['token'],'metric'=>$groups[$project]['points']['estimated']['key']]);
    $missing=genesisSharedReportTasks($owner,['token'=>$report['token'],'metric'=>$groups[$project]['points']['unestimated']['key']]);
    spCheck($known['total']===2&&in_array($zero['id'],array_column($known['tasks'],'id'),true)&&$missing['total']===2,'Exact estimated/missing selections confused zero');
    $person=array_column($groups[$project]['members'],null,'id')[$users['member']];
    spCheck($person['points']['estimated']['count']===1&&$person['points']['unestimated']['count']===0,'Report assignee sums lost known zero');
    spSettings($owner,$project,true,'hours');spReject(fn()=>genesisSharedReportCheck($owner,$report['token']),'REPORT_CHANGED');spSettings($owner,$project,true,'points');
    $plain=genesisSharedCreateProject($owner,$space,['title'=>'Estimates retained while planning disabled'])['id'];
    $captured=genesisSharedTemplateCapture($owner,$project,$zero['id'],['calendarMode'=>'lunar','calendarContext'=>$context,'anchorDate'=>'2026-10-18']);
    spCheck($captured['manifest']['tasks'][0]['storyPoints']===0&&$captured['manifest']['tasks'][0]['estimateHours']===2.5,'Template capture lost estimates');
    $template=genesisSharedSaveTemplate($owner,$space,$plain,['operationId'=>genesisUuid(),'title'=>'Estimate template','manifest'=>$captured['manifest']]);
    $oldEditor=$captured['manifest'];foreach($oldEditor['tasks'] as &$row){unset($row['storyPoints'],$row['estimateHours']);}unset($row);
    genesisSharedSaveTemplate($owner,$space,$plain,['operationId'=>genesisUuid(),'expectedRevision'=>$template['revision'],'title'=>'Legacy template editor','manifest'=>$oldEditor],$template['id']);
    $options=['spaceId'=>$space,'projectId'=>$plain,'anchorDate'=>'2026-10-18'];$preview=genesisSharedPreviewTemplate($owner,$template['id'],$options);
    spCheck($preview['canApply'],'Estimate template preview blocked');
    $applied=genesisSharedApplyTemplate($owner,$template['id'],[...$options,'operationId'=>genesisUuid(),'fingerprint'=>$preview['fingerprint']]);
    $copy=genesisSharedGetTask($owner,$plain,$applied['taskIds'][$zero['id']]);
    spCheck($copy['storyPoints']===0&&$copy['estimateHours']===2.5&&$copy['sprintId']===null&&!genesisPlanningConfig($plain)['enabled'],'Template lost values, copied sprint membership or implicitly enabled planning');
    $export=genesisSharedDataExport($owner,$space,['scope'=>'project','projectId'=>$project,'calendarMode'=>'lunar','calendarContext'=>$context]);$portable=genesisDataManifest(json_decode($export['content'],true,256,JSON_THROW_ON_ERROR));
    $exported=array_column($portable['tasks'],null,'key');spCheck($exported[$zero['id']]['storyPoints']===0&&$exported[$zero['id']]['estimateHours']===2.5,'JSON export lost units');
    $csv=genesisDataToCsv($portable);$csvData=genesisDataFromCsv($csv,['title'=>'CSV estimates','openTitle'=>'Open','doneTitle'=>'Done','calendarMode'=>'profane','calendarContext'=>$context]);
    $csvTask=array_values(array_filter($csvData['tasks'],static fn($row)=>$row['title']===$zero['title']))[0];
    spCheck($csvTask['storyPoints']===0&&$csvTask['estimateHours']===2.5,'CSV roundtrip turned known zero into missing');
    $command=['format'=>'json','content'=>$export['content'],'spaceId'=>$space];$preview=genesisSharedDataPreview($owner,$command);spCheck($preview['canApply'],'Estimate import blocked');
    $receipt=genesisSharedDataApply($owner,[...$command,'operationId'=>genesisUuid(),'fingerprint'=>$preview['fingerprint']]);
    $imported=genesisSharedGetTask($owner,$receipt['rootProjectId'],$receipt['taskIds'][$zero['id']]);
    spCheck($imported['storyPoints']===0&&$imported['estimateHours']===2.5&&$imported['sprintId']===null&&!genesisPlanningConfig($receipt['rootProjectId'])['enabled'],'Import lost units or enabled advanced behavior');
    spCheck(!GenesisPlanningSeedScope::active(),'Estimate seed scope escaped its operation');
    $checks[]='c4-project-scales-source-selections-c1-legacy-editor-apply-and-c5-json-csv-import';
    $fingerprint=genesisPlanningFingerprint($project);$zero=genesisSharedTask($owner,$project,['expectedRevision'=>$zero['revision'],'estimateHours'=>4],$zero['id']);
    spReject(fn()=>genesisSharedTransitionSprint($owner,$project,$a['id'],['requestId'=>genesisUuid(),'expectedRevision'=>$a['revision'],'fingerprint'=>$fingerprint,'action'=>'start']),'PLANNING_CONFLICT');
    $startInput=['requestId'=>genesisUuid(),'expectedRevision'=>$a['revision'],'fingerprint'=>genesisPlanningFingerprint($project),'action'=>'start'];
    $started=genesisSharedTransitionSprint($owner,$project,$a['id'],$startInput);spCheck(genesisSharedTransitionSprint($owner,$project,$a['id'],$startInput)===$started,'Start replay duplicated baseline');$a=$started['sprint'];
    spReject(fn()=>spTransition($owner,$project,$b,'start'),'PLANNING_ACTIVE_SPRINT');
    spReject(fn()=>spSettings($owner,$project,false),'PLANNING_ACTIVE_SPRINT');
    spSettings($owner,$project,true,'hours');spCheck(genesisPlanningSprint($project,$a['id'])['estimate_unit']==='points','Unit switch rewrote active baseline');
    spCheck(genesisSharedGetTask($owner,$project,$zero['id'])['storyPoints']===0,'Unit switch converted or erased points');
    $checks[]='stale-baseline-one-active-sprint-and-frozen-unit';
    $estimated=genesisSharedTask($owner,$project,['expectedRevision'=>$estimated['revision'],'statusId'=>$done],$estimated['id']);
    spReject(fn()=>spTransition($owner,$project,$a,'complete'),'SPRINT_OUTCOMES_REQUIRED');
    $choices=[['taskId'=>$zero['id'],'expectedRevision'=>$zero['revision'],'destinationSprintId'=>$b['id']],['taskId'=>$unknown['id'],'expectedRevision'=>$unknown['revision'],'destinationSprintId'=>null]];
    spReject(fn()=>spTransition($owner,$project,$a,'complete',['outcomes'=>[$choices[0]]]),'SPRINT_OUTCOMES_REQUIRED');
    spReject(fn()=>spTransition($owner,$project,$a,'complete',['outcomes'=>[$choices[0],$choices[1],$choices[1]]]),'SPRINT_OUTCOMES_REQUIRED');
    $badChoices=$choices;$badChoices[1]['expectedRevision']--;
    spReject(fn()=>spTransition($owner,$project,$a,'complete',['outcomes'=>$badChoices]),'PLANNING_CONFLICT');
    spCheck(genesisSharedGetTask($owner,$project,$zero['id'])['sprintId']===$a['id'],'Failed completion partially moved a task');
    $beforeEvents=(int)$db->query('SELECT COUNT(*) FROM shared_audit_events')->fetchColumn();
    $db->exec("CREATE TEMP TRIGGER planning_late_failure BEFORE UPDATE ON shared_tasks WHEN NEW.id=".$db->quote($unknown['id'])." BEGIN SELECT RAISE(ABORT,'isolated late planning failure'); END");
    $completeInput=['requestId'=>genesisUuid(),'expectedRevision'=>$a['revision'],'fingerprint'=>genesisPlanningFingerprint($project),'action'=>'complete','outcomes'=>$choices];$failed=false;
    try{genesisSharedTransitionSprint($owner,$project,$a['id'],$completeInput);}catch(PDOException $error){$failed=str_contains($error->getMessage(),'isolated late planning failure');}
    $db->exec('DROP TRIGGER planning_late_failure');
    spCheck($failed&&(int)$db->query('SELECT COUNT(*) FROM shared_audit_events')->fetchColumn()===$beforeEvents&&genesisSharedGetTask($owner,$project,$zero['id'])['sprintId']===$a['id']&&genesisPlanningSprint($project,$a['id'])['state']==='active','Late failure leaked carry-over, audit or lifecycle state');
    $a=genesisSharedTransitionSprint($owner,$project,$a['id'],$completeInput)['sprint'];
    spCheck($a['state']==='completed'&&genesisSharedGetTask($owner,$project,$zero['id'])['sprintId']===$b['id']&&genesisSharedGetTask($owner,$project,$unknown['id'])['sprintId']===null,'Explicit carry-over failed');
    spCheck(genesisSharedGetTask($owner,$project,$estimated['id'])['sprintId']===$a['id'],'Completed task lost historical membership');
    spReject(fn()=>genesisSharedTask($owner,$project,['expectedRevision'=>$unknown['revision']+1,'sprintId'=>$a['id']],$unknown['id']),'SPRINT_COMPLETED');
    $events=genesisPlanningRows("SELECT details_json FROM shared_audit_events_read WHERE project_id=? AND action='sprint.started'",[$project]);spCheck(count($events)===1&&count(json_decode($events[0]['details_json'],true)['plan'])===3,'Immutable initial plan missing or duplicated');
    $checks[]='atomic-explicit-outcomes-and-real-baseline-history';
    $zero=genesisSharedGetTask($owner,$project,$zero['id']);$targetStatus=genesisSharedProjectSnapshot($owner,$other)['statuses'][0]['id'];
    genesisSharedMoveTask($owner,$project,$zero['id'],['expectedRevision'=>$zero['revision'],'destinationProjectId'=>$other,'statusId'=>$targetStatus,'position'=>0]);
    $moved=genesisSharedGetTask($owner,$other,$zero['id']);spCheck($moved['sprintId']===null&&$moved['storyPoints']===0&&$moved['estimateHours']===4,'Legacy move kept foreign sprint or lost unit values');
    spReject(fn()=>genesisSharedPlanning($users['outsider'],$project),'SHARED_PROJECT_NOT_FOUND');
    $access=['allProjects'=>false,'grants'=>[['projectId'=>$project,'role'=>'viewer','includeDescendants'=>false]]];$preview=genesisSharedPreviewProjectAccess($owner,$space,$users['member'],$access);
    genesisSharedSaveProjectAccess($owner,$space,$users['member'],[...$access,'expectedFingerprint'=>$preview['fingerprint'],'operationId'=>genesisUuid()]);
    spReject(fn()=>genesisSharedQueryTasks($users['member'],['sprintId'=>$foreign['id']]),'SHARED_PROJECT_NOT_FOUND');
    $activity=genesisSharedActivity($users['member'],$project,null,null)['events'];foreach($activity as $event)if($event['action']==='sprint.started')spCheck(!str_contains(genesisPlanningJson($event['details']),$zero['id']),'Historical baseline leaked moved inaccessible task');
    spReject(fn()=>genesisSharedSavePlanning($users['member'],$project,$input),'SHARED_PROJECT_FORBIDDEN');
    spCheck(!$db->query('PRAGMA foreign_key_check')->fetch(),'Planning broke foreign keys');$checks[]='move-detach-current-acl-history-redaction-and-revoke';
    echo genesisPlanningJson(['passed'=>$checks])."\n";
}finally{if($space)$db->prepare('DELETE FROM shared_spaces WHERE id=?')->execute([$space]);foreach($users as $id)$db->prepare('DELETE FROM users WHERE id=?')->execute([$id]);}
