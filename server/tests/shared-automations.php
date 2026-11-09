<?php
declare(strict_types=1);
require_once __DIR__ . '/shared-fixture-plan.php';
if(PHP_SAPI!=='cli'||getenv('GENESIS_IMPROVEMENTS_TEST')!=='isolated')throw new RuntimeException('Explicit isolated test environment required.');
require __DIR__.'/../src/bootstrap.php';
$config=genesisConfig();$ciDirectory=getenv('GENESIS_LOCAL_CI_DIR')?:getenv('GENESIS_SMOKE_ROOT');
$browser=$config['app_url']==='http://127.0.0.1:4338'&&basename($config['db_path'])==='improvements-test.sqlite';
$ci=$config['app_url']==='https://localhost.invalid'&&is_string($ciDirectory)&&$ciDirectory!==''&&str_replace('\\','/',$config['db_path'])===str_replace('\\','/',$ciDirectory).'/genesis.sqlite';
if(!$browser&&!$ci)throw new RuntimeException('Non-fixture refused.');
foreach(['repository','google','shared-projects','shared-google'] as $module)require_once __DIR__.'/../src/'.$module.'.php';
function auCheck(bool $ok,string $message):void { if(!$ok)throw new RuntimeException($message); }
function auReject(callable $action,string $code):void { try{$action();}catch(InvalidArgumentException|GenesisSharedAccessException $e){auCheck($e->getMessage()===$code,'Unexpected '.$e->getMessage().' instead of '.$code);return;}throw new RuntimeException('Expected '.$code); }
$db=genesisDb();$spaceId=null;$actors=[];
try{
    foreach(['owner','member','viewer','outsider'] as $role){$tag='c2-'.genesisUuid();$id=genesisUpsertGoogleUser(['email_verified'=>true,'sub'=>$tag,'email'=>$tag.'@example.invalid','name'=>'C2 isolated '.$role],[],false)['id'];genesisTestEnableSharedProjects($id);$actors[$role]=$id;}
    $owner=$actors['owner'];$space=genesisSharedCreateSpace($owner,['title'=>'C2 isolated']);$spaceId=$space['id'];$project=genesisSharedCreateProject($owner,$spaceId,['title'=>'C2 rules']);$projectId=$project['id'];
    foreach(['member'=>'member','viewer'=>'guest'] as $role=>$spaceRole){
        $db->prepare('INSERT INTO shared_space_members(space_id,user_id,role,joined_at) VALUES(?,?,?,?)')->execute([$spaceId,$actors[$role],$spaceRole,genesisNow()]);
        $db->prepare('INSERT INTO shared_project_members(project_id,user_id,role,joined_at) VALUES(?,?,?,?)')->execute([$projectId,$actors[$role],$role==='member'?'member':'viewer',genesisNow()]);
    }
    $q=$db->prepare('SELECT id,is_done FROM shared_project_statuses WHERE project_id=? ORDER BY position');$q->execute([$projectId]);$statuses=$q->fetchAll();$open=$statuses[0]['id'];$doing=$statuses[1]['id'];$done=$statuses[count($statuses)-1]['id'];
    $label=genesisSharedSaveLabel($owner,$spaceId,null,['title'=>'C2 label','color'=>'#abcdef'])['id'];
    $makeField=static function(string $type)use($owner,$spaceId,$projectId):string{
        $draft=['id'=>genesisUuid(),'projectId'=>$projectId,'title'=>'C2 '.$type,'type'=>$type,'options'=>[],'position'=>0,'required'=>false,'showCard'=>true,'showList'=>true,'archived'=>false,'expectedRevision'=>0];
        $preview=genesisSharedPreviewCustomField($owner,$spaceId,$draft);
        return genesisSharedSaveCustomField($owner,$spaceId,[...$draft,'operationId'=>genesisUuid(),'fingerprint'=>$preview['fingerprint']])['field']['id'];
    };
    $number=$makeField('number');$flag=$makeField('checkbox');
    $today=gmdate('Y-m-d');$context=['version'=>2,'timeZone'=>'UTC','gregorianYearStart'=>'march'];
    $definition=static fn(string $type,array $actions,array $conditions=[])=>['schemaVersion'=>1,'trigger'=>['type'=>$type],'conditions'=>$conditions,'actions'=>$actions,'calendarMode'=>'profane','calendarContext'=>$context];
    $save=static fn(array $def,array $extra=[])=>genesisSharedSaveAutomation($owner,$projectId,['operationId'=>genesisUuid(),'title'=>'C2 rule','enabled'=>true,'definition'=>$def,...$extra]);
    $create=static fn(array $extra=[])=>genesisSharedTask($owner,$projectId,['title'=>'C2 task','statusId'=>$open,'dueDate'=>'2024-01-31',...$extra]);
    $runs=static fn(string $id)=>genesisSharedAutomationRuns($owner,$projectId,$id)['runs'];
    $runFor=static fn(string $id,string $task)=>array_values(array_filter($runs($id),static fn($run)=>$run['taskId']===$task))[0];
    $runState=static function(string $id)use($db):string{$q=$db->prepare('SELECT state FROM shared_automation_runs WHERE id=?');$q->execute([$id]);return $q->fetchColumn();};
    $perform=static function(string $id,int $retry=0)use($db):string{$job=genesisBackgroundClaim(null,'automation:'.$id.':'.$retry);auCheck($job!==null,'Expected runnable automation');return genesisBackgroundPerform($job);};
    $typed=[['field'=>'custom','fieldId'=>$number,'operator'=>'eq','value'=>0],['field'=>'custom','fieldId'=>$flag,'operator'=>'eq','value'=>false]];
    $command=['operationId'=>genesisUuid(),'title'=>'Typed changes','enabled'=>true,'definition'=>$definition('created',[
        ['type'=>'priority','value'=>2],['type'=>'assignee','value'=>$actors['member']],['type'=>'addLabels','value'=>[$label]],
        ['type'=>'custom','fieldId'=>$flag,'value'=>true],['type'=>'due','mode'=>'shift','offset'=>['amount'=>1,'unit'=>'month']],
    ],$typed)];
    auReject(fn()=>genesisSharedSaveAutomation($owner,$projectId,[...$command,'operationId'=>genesisUuid(),'deleted'=>true]),'AUTOMATION_INVALID');
    $rule=genesisSharedSaveAutomation($owner,$projectId,$command);auCheck(genesisSharedSaveAutomation($owner,$projectId,$command)===$rule,'Rule retry duplicated or changed its receipt');
    auReject(fn()=>genesisSharedSaveAutomation($owner,$projectId,[...$command,'title'=>'Reused']),'AUTOMATION_OPERATION_REUSED');
    auReject(fn()=>genesisSharedSaveAutomation($owner,$projectId,['operationId'=>genesisUuid(),'expectedRevision'=>0,'enabled'=>false],$rule['id']),'AUTOMATION_CONFLICT');
    auReject(fn()=>genesisSharedAutomations($actors['outsider'],$projectId),'SHARED_PROJECT_NOT_FOUND');
    auReject(fn()=>genesisSharedSaveAutomation($actors['viewer'],$projectId,['operationId'=>genesisUuid(),'title'=>'No','definition'=>$command['definition']]),'SHARED_PROJECT_FORBIDDEN');
    $task=$create(['customFields'=>[$number=>0,$flag=>false]]);$run=$runs($rule['id'])[0];$job=genesisBackgroundClaim(null,'automation:'.$run['id'].':0');auCheck($job!==null,'Creation was not captured');
    auCheck(genesisBackgroundClaim(null,'automation:'.$run['id'].':0')===null,'Two workers obtained one lease');
    auCheck(genesisBackgroundPerform($job)==='succeeded','Typed rule failed');$changed=genesisSharedGetTask($owner,$projectId,$task['id']);
    auCheck($changed['priority']===2&&$changed['assigneeId']===$actors['member']&&$changed['dueDate']==='2024-02-29'&&in_array($label,$changed['labelIds'],true),'Compound changes lost a field or calendar month');
    auCheck(((array)$changed['customFields'])[$flag]===true,'Checkbox action not typed');
    auCheck(genesisBackgroundPerform($job)==='superseded'&&genesisSharedGetTask($owner,$projectId,$task['id'])['revision']===$changed['revision'],'Duplicate acknowledgement ran effects again');
    $notMatched=$create(['customFields'=>[$number=>0,$flag=>true]]);$run=$runFor($rule['id'],$notMatched['id']);$perform($run['id']);auCheck($runState($run['id'])==='skipped','False was confused with missing/true');
    $stale=$create(['customFields'=>[$number=>0,$flag=>false]]);$staleRun=$runFor($rule['id'],$stale['id']);genesisSharedTask($owner,$projectId,['expectedRevision'=>$stale['revision'],'priority'=>3],$stale['id']);$perform($staleRun['id']);
    auCheck($runState($staleRun['id'])==='cancelled','Stale task job was not cancelled');
    $pending=$create(['customFields'=>[$number=>0,$flag=>false]]);$pausedRun=$runFor($rule['id'],$pending['id']);$rule=genesisSharedSaveAutomation($owner,$projectId,['operationId'=>genesisUuid(),'expectedRevision'=>$rule['revision'],'enabled'=>false],$rule['id']);$perform($pausedRun['id']);auCheck($runState($pausedRun['id'])==='cancelled','Paused rule still ran');
    $template=genesisSharedSaveTemplate($owner,$spaceId,$projectId,['operationId'=>genesisUuid(),'title'=>'C2 task template','sourceProjectId'=>$projectId,'sourceTaskId'=>$task['id'],'capture'=>['calendarMode'=>'profane','calendarContext'=>$context,'anchorDate'=>'2024-01-31']]);
    $templateAction=['type'=>'createTemplate','templateId'=>$template['id'],'options'=>['include'=>['customFields'=>false,'approvals'=>false,'assignees'=>false]]];
    $count=static function()use($db):array{$result=[];foreach(['shared_tasks','shared_audit_events','shared_notification_recipients','shared_notification_outbox','shared_mutation_receipts','shared_template_operations','shared_automation_runs','background_jobs'] as $table)$result[$table]=(int)$db->query('SELECT COUNT(*) FROM '.$table)->fetchColumn();return $result;};
    $previewDef=$definition('status',[['type'=>'priority','value'=>3],$templateAction,['type'=>'notify','recipientIds'=>[$owner],'message'=>'Наша кириллица']]);$before=$count();
    $preview=genesisSharedAutomationPreview($owner,$projectId,['definition'=>$previewDef,'taskId'=>$task['id']]);
    auCheck($preview['dryRun']&&$preview['effects']['createdTaskCount']===1&&$count()===$before,'Dry run wrote tasks, receipts, jobs, logs or notifications');
    // A crash after effects but before ack must roll back both the task and its operation receipts.
    $crashRule=$save($definition('created',[['type'=>'priority','value'=>1],$templateAction]));$crashTask=$create();$crashRun=$runs($crashRule['id'])[0];$lease=genesisBackgroundClaim(null,'automation:'.$crashRun['id'].':0');$before=$count();
    $state=genesisBackgroundPerform($lease,static function(string $kind,array $payload):string{genesisAutomationPerform($payload);throw new RuntimeException('Synthetic crash after effects before ack');});
    auCheck($state==='pending'&&$count()===$before&&genesisSharedGetTask($owner,$projectId,$crashTask['id'])['priority']===0,'Crash leaked partial effects');
    $db->prepare("UPDATE background_jobs SET available_at=? WHERE unique_key=?")->execute([genesisNow(),'automation:'.$crashRun['id'].':0']);$perform($crashRun['id']);
    auCheck($runState($crashRun['id'])==='succeeded'&&$count()['shared_tasks']===$before['shared_tasks']+1,'Crash retry did not create exactly one task');
    $crashRule=genesisSharedSaveAutomation($owner,$projectId,['operationId'=>genesisUuid(),'expectedRevision'=>$crashRule['revision'],'enabled'=>false],$crashRule['id']);
    // Recursive creation is stopped at the next invocation, with a visible loop diagnostic.
    $loop=$save($definition('created',[$templateAction]));$loopTask=$create();$loopRun=$runs($loop['id'])[0];$perform($loopRun['id']);$loopRuns=$runs($loop['id']);
    auCheck(count($loopRuns)===2&&in_array('AUTOMATION_LOOP_GUARD',array_column($loopRuns,'errorCode'),true),'Self loop was not diagnosed and bounded');
    $loop=genesisSharedSaveAutomation($owner,$projectId,['operationId'=>genesisUuid(),'expectedRevision'=>$loop['revision'],'enabled'=>false],$loop['id']);
    $mutualA=$save($definition('created',[$templateAction]));$mutualB=$save($definition('created',[$templateAction]));$beforeMutual=$count()['shared_tasks'];$mutualTask=$create();
    for($round=0;$round<12;$round++){
        $q=$db->prepare("SELECT id FROM shared_automation_runs WHERE rule_id IN(?,?) AND state='pending' ORDER BY created_at,id LIMIT 1");$q->execute([$mutualA['id'],$mutualB['id']]);$next=$q->fetchColumn();if(!$next)break;$perform($next);
    }
    $q=$db->prepare("SELECT COUNT(*) FROM shared_automation_runs WHERE rule_id IN(?,?) AND state='pending'");$q->execute([$mutualA['id'],$mutualB['id']]);auCheck((int)$q->fetchColumn()===0&&$count()['shared_tasks']<=$beforeMutual+5,'Mutual creation loop escaped its provenance bounds');
    foreach([$mutualA,$mutualB] as $mutual)genesisSharedSaveAutomation($owner,$projectId,['operationId'=>genesisUuid(),'expectedRevision'=>$mutual['revision'],'enabled'=>false],$mutual['id']);
    $retryRule=$save($definition('created',[['type'=>'priority','value'=>1]]));$retryTask=$create();$retryRun=$runFor($retryRule['id'],$retryTask['id']);$key='automation:'.$retryRun['id'].':0';
    for($attempt=0;$attempt<5;$attempt++){
        $db->prepare('UPDATE background_jobs SET available_at=? WHERE unique_key=?')->execute([genesisNow(),$key]);$lease=genesisBackgroundClaim(null,$key);auCheck($lease!==null,'Retry lease missing');
        genesisBackgroundPerform($lease,static function():never{throw new RuntimeException('Synthetic transient storage failure');});
    }
    auCheck($runState($retryRun['id'])==='failed','Exhausted retries were not visible in the actual run log');
    $retryCommand=['operationId'=>genesisUuid(),'expectedRevision'=>$retryRule['revision']];$manual=genesisSharedRetryAutomation($owner,$projectId,$retryRule['id'],$retryRun['id'],$retryCommand);
    auCheck(genesisSharedRetryAutomation($owner,$projectId,$retryRule['id'],$retryRun['id'],$retryCommand)===$manual,'Lost manual-retry response duplicated a job');$perform($retryRun['id'],1);auCheck($runState($retryRun['id'])==='succeeded','Manual retry could not recover');
    $retryRule=genesisSharedSaveAutomation($owner,$projectId,['operationId'=>genesisUuid(),'expectedRevision'=>$retryRule['revision'],'enabled'=>false],$retryRule['id']);
    $approvalRule=$save($definition('completed',[['type'=>'priority','value'=>2]]));$approvalTask=$create(['approvalRequired'=>true,'approverIds'=>[$owner,$actors['member']]]);
    genesisSharedApproveTask($owner,$projectId,$approvalTask['id']);auCheck($runs($approvalRule['id'])===[],'A preliminary approval triggered completion');
    genesisSharedApproveTask($actors['member'],$projectId,$approvalTask['id']);$approvedRuns=$runs($approvalRule['id']);auCheck(count($approvedRuns)===1,'Actual approved completion was not captured');$perform($approvedRuns[0]['id']);
    $approvalRule=genesisSharedSaveAutomation($owner,$projectId,['operationId'=>genesisUuid(),'expectedRevision'=>$approvalRule['revision'],'enabled'=>false],$approvalRule['id']);
    // Rule ownership changes never retain privileges and cancel jobs belonging to the prior revision.
    $owned=$save($definition('created',[['type'=>'priority','value'=>1]]),['ownerId'=>$actors['member']]);$ownedTask=$create();$ownedRun=$runs($owned['id'])[0];
    $db->prepare('DELETE FROM shared_project_members WHERE project_id=? AND user_id=?')->execute([$projectId,$actors['member']]);$perform($ownedRun['id']);auCheck($runs($owned['id'])[0]['state']==='cancelled','Revoked owner kept write privileges');
    $db->prepare('INSERT INTO shared_project_members(project_id,user_id,role,joined_at) VALUES(?,?,?,?)')->execute([$projectId,$actors['member'],'member',genesisNow()]);
    auReject(fn()=>genesisSharedSaveAutomation($actors['member'],$projectId,['operationId'=>genesisUuid(),'expectedRevision'=>$owned['revision'],'ownerId'=>$owner],$owned['id']),'SHARED_PROJECT_FORBIDDEN');
    $owned=genesisSharedSaveAutomation($owner,$projectId,['operationId'=>genesisUuid(),'expectedRevision'=>$owned['revision'],'enabled'=>false],$owned['id']);
    // Each supported event trigger is captured. Completion remains the real approved completion.
    foreach(['status','assignee','completed'] as $type){
        $eventRule=$save($definition($type,[['type'=>'priority','value'=>2]]));$eventTask=$create();
        $patch=$type==='assignee'?['assigneeId'=>$actors['member']]:['statusId'=>$type==='completed'?$done:$doing];
        $eventTask=genesisSharedTask($owner,$projectId,['expectedRevision'=>$eventTask['revision'],...$patch],$eventTask['id']);$list=$runs($eventRule['id']);auCheck(count($list)===1,'Missing '.$type.' trigger');$perform($list[0]['id']);auCheck($runs($eventRule['id'])[0]['state']==='succeeded','Event action failed for '.$type);
        $eventRule=genesisSharedSaveAutomation($owner,$projectId,['operationId'=>genesisUuid(),'expectedRevision'=>$eventRule['revision'],'enabled'=>false],$eventRule['id']);
    }
    $schedule=['type'=>'schedule','target'=>'project','time'=>'00:00','recurrence'=>['mode'=>'classic','pattern'=>'daily','interval'=>1,'rangeStart'=>$today,'rangeEnd'=>'','days'=>[1],'months'=>[],'pyatas'=>[],'calendarContext'=>$context]];
    $scheduled=$save([...$definition('schedule',[$templateAction]),'trigger'=>$schedule]);
    $due=$save([...$definition('due',[['type'=>'priority','value'=>1]]),'trigger'=>['type'=>'due','time'=>'00:00']]);
    $soon=$save([...$definition('dueSoon',[['type'=>'priority','value'=>1]]),'trigger'=>['type'=>'dueSoon','time'=>'00:00','leadDays'=>2]]);
    $dueTask=$create(['dueDate'=>$today]);$soonTask=$create(['dueDate'=>genesisCalendarAddDays($today,1)]);
    genesisAutomationScan($today.'T23:59:00Z');$scheduleRuns=$runs($scheduled['id']);auCheck(count($scheduleRuns)===1,'Schedule slot missing');$perform($scheduleRuns[0]['id']);genesisAutomationScan($today.'T23:59:00Z');auCheck(count($runs($scheduled['id']))===1,'Same schedule slot was queued twice');
    auCheck(in_array($dueTask['id'],array_column($runs($due['id']),'taskId'),true),'Due trigger missing');auCheck(in_array($soonTask['id'],array_column($runs($soon['id']),'taskId'),true),'Due-soon trigger missing');
    $dueRun=array_values(array_filter($runs($due['id']),static fn($r)=>$r['taskId']===$dueTask['id']))[0];$perform($dueRun['id']);auCheck(genesisSharedGetTask($owner,$projectId,$dueTask['id'])['priority']===1,'Scheduled task action failed');
    $soonRun=array_values(array_filter($runs($soon['id']),static fn($r)=>$r['taskId']===$soonTask['id']))[0];genesisSharedTask($owner,$projectId,['expectedRevision'=>$soonTask['revision'],'dueDate'=>genesisCalendarAddDays($today,20)],$soonTask['id']);$perform($soonRun['id']);auCheck(in_array('AUTOMATION_STALE',array_column($runs($soon['id']),'errorCode'),true),'Changed due date did not cancel old reminder action');
    $notificationRule=$save([...$definition('schedule',[['type'=>'notify','recipientIds'=>[$owner],'message'=>'Наша кириллица · 日本語']]),'trigger'=>$schedule]);genesisAutomationScan($today.'T23:59:00Z');$notificationRun=$runs($notificationRule['id'])[0];$perform($notificationRun['id']);
    $inbox=genesisNotificationInbox($owner)['notifications'];$notes=array_values(array_filter($inbox,static fn($item)=>$item['action']==='automation.notification'));
    auCheck(count($notes)===1&&$notes[0]['commentBody']==='Наша кириллица · 日本語','Project notification missing from the existing inbox or user text was translated');
    auCheck(count(genesisNotificationDestination($owner,$notes[0]['id']))>0,'Automation notification lacks a valid destination');
    $q=$db->prepare('SELECT title,definition_json FROM shared_automation_rules WHERE id=?');$q->execute([$notificationRule['id']]);$raw=$q->fetch();auCheck(str_starts_with($raw['title'],GENESIS_SHARED_CONTENT_PREFIX)&&str_starts_with($raw['definition_json'],GENESIS_SHARED_CONTENT_PREFIX),'Automation content was stored in plaintext');
    auCheck($db->query('PRAGMA foreign_key_check')->fetchAll()===[],'Automation effects broke a foreign key');
    echo "Automations: encrypted CRUD/CAS/replay and ACL, typed0/false, compound calendar actions, dry-run rollback, lease exclusion, crash-before-ack retry, stale/pause/revoked owner, bounded loops and all seven triggers passed.\n";
}finally{
    if($db->inTransaction())$db->rollBack();
    if($spaceId){$q=$db->prepare('SELECT r.id FROM shared_automation_runs r JOIN shared_automation_rules a ON a.id=r.rule_id JOIN shared_projects p ON p.id=a.project_id WHERE p.space_id=?');$q->execute([$spaceId]);foreach($q->fetchAll(PDO::FETCH_COLUMN) as $id)$db->prepare('DELETE FROM background_jobs WHERE unique_key LIKE ?')->execute(['automation:'.$id.':%']);$db->prepare('DELETE FROM shared_spaces WHERE id=?')->execute([$spaceId]);}
    foreach($actors as $actor)$db->prepare('DELETE FROM users WHERE id=?')->execute([$actor]);
}
