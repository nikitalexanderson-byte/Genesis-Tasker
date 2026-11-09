<?php
declare(strict_types=1);
require_once __DIR__ . '/shared-fixture-plan.php';
$root=dirname(__DIR__,2);
foreach(['bootstrap','repository','google','shared-projects']as$module)require $root.'/server/src/'.$module.'.php';
if(!in_array(parse_url(genesisConfig()['app_url'],PHP_URL_HOST),['127.0.0.1','localhost.invalid'],true))throw new RuntimeException('Isolated configuration required');
$db=genesisDb();
if(!$db->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='shared_bulk_operations'")->fetchColumn())throw new RuntimeException('Missing bulk migration');
function bulkExpect(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);}
function bulkDrain(string $id):void{for($i=0;$i<1000;$i++){
 $q=genesisDb()->prepare('SELECT actor_id,state FROM shared_bulk_operations WHERE id=?');$q->execute([$id]);$row=$q->fetch();$q->closeCursor();if($row['state']!=='running')return;
 $report=genesisSharedBulkAdvance($row['actor_id'],$id);if($report['retryAt']!==null)throw new RuntimeException('Unexpected background retry');
}throw new RuntimeException('Bulk did not converge');}
function bulkTestLease(string $id):array{
 $db=genesisDb();$q=$db->prepare('SELECT batch_number FROM shared_bulk_operations WHERE id=?');$q->execute([$id]);$batch=(int)$q->fetchColumn();$q->closeCursor();$key='bulk:'.$id.':'.$batch;
 $token=genesisUuid();$db->prepare("UPDATE background_jobs SET state='running',lease_token=?,lease_until=?,attempts=attempts+1 WHERE unique_key=?")->execute([$token,gmdate('Y-m-d\TH:i:s\Z',time()+30),$key]);
 $q=$db->prepare('SELECT * FROM background_jobs WHERE unique_key=?');$q->execute([$key]);$row=$q->fetch();$q->closeCursor();return$row;
}
function bulkSingle(string $actor,string $project,string $taskId,array $action):array{
 $task=genesisSharedGetTask($actor,$project,$taskId);
 $preview=genesisSharedBulkPreview($actor,['requestId'=>genesisUuid(),'selection'=>['mode'=>'page','items'=>[['id'=>$taskId,'projectId'=>$project,'revision'=>$task['revision']]]],'action'=>$action]);
 genesisSharedBulkConfirm($actor,$preview['id']);bulkDrain($preview['id']);$result=genesisSharedBulkReport($actor,$preview['id']);
 bulkExpect($result['counts']['succeeded']===1&&$result['counts']['pending']===0,'Single action failed: '.$action['kind']);return$result;
}
$prefix='bulk-'.bin2hex(random_bytes(4));$actor=$prefix.'-owner';$viewer=$prefix.'-viewer';$space=null;
foreach([$actor,$viewer]as$user){$db->prepare('INSERT INTO users(id,google_sub,email,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)')->execute([$user,$user,$user.'@example.invalid','Synthetic',genesisNow(),genesisNow()]);genesisTestEnableSharedProjects($user);}
try{
 $space=genesisSharedCreateSpace($actor,['title'=>'Bulk synthetic']);$project=genesisSharedCreateProject($actor,$space['id'],['title'=>'Bulk project']);$pid=$project['id'];
 $db->prepare("INSERT INTO shared_space_members(space_id,user_id,role,joined_at) VALUES(?,?,'guest',?)")->execute([$space['id'],$viewer,genesisNow()]);
 $db->prepare("INSERT INTO shared_project_members(project_id,user_id,role,joined_at) VALUES(?,?,'viewer',?)")->execute([$pid,$viewer,genesisNow()]);
 $statuses=genesisSharedProjectSnapshot($actor,$pid)['statuses'];$open=array_values(array_filter($statuses,fn($s)=>!$s['isDone']))[0]['id'];
 $tasks=[];for($i=0;$i<121;$i++)$tasks[]=genesisSharedTask($actor,$pid,['title'=>'Bulk '.$i,'statusId'=>$open,'dueDate'=>'2026-10-20']);
 $filter=['projectIds'=>[$pid]];$page=genesisSharedQueryTasks($actor,$filter);
 $scope=genesisSharedBulkScope($actor,['mode'=>'all','filter'=>$filter,'sort'=>'position','queryVersion'=>$page['queryVersion']]);
 bulkExpect($scope['total']===121&&count($scope['projects'])===1&&$scope['projects'][0]['id']===$pid&&$scope['projects'][0]['taskCount']===121&&count($scope['projects'][0]['statuses'])===count($statuses),'Bounded scope metadata lost tasks or project statuses');
 $pageScope=genesisSharedBulkScope($actor,['mode'=>'page','items'=>[['id'=>$tasks[0]['id'],'projectId'=>$pid,'revision'=>$tasks[0]['revision']]]]);
 bulkExpect($pageScope['total']===1&&$pageScope['projects'][0]['taskCount']===1,'Shown selection expanded to the whole filter');
 $request=['requestId'=>genesisUuid(),'selection'=>['mode'=>'all','filter'=>$filter,'queryVersion'=>$page['queryVersion']],'action'=>['kind'=>'priority','priority'=>3]];
 $preview=genesisSharedBulkPreview($actor,$request);bulkExpect($preview['counts']['selected']===121,'All-results selection stopped at first page');
 bulkExpect(genesisSharedBulkPreview($actor,$request)['id']===$preview['id'],'Preview retry created duplicate operation');
 $changed=genesisSharedTask($actor,$pid,['expectedRevision'=>1,'description'=>'Concurrent edit'],$tasks[0]['id']);
 genesisSharedBulkConfirm($actor,$preview['id']);bulkDrain($preview['id']);$report=genesisSharedBulkReport($actor,$preview['id']);
 bulkExpect($report['counts']['succeeded']===120&&$report['counts']['skipped']===1&&$report['counts']['pending']===0,'Concurrent edit or exact results lost');
 $sortedPage=genesisSharedQueryTasks($actor,$filter,null,100,'priority');
 $sortedPreview=genesisSharedBulkPreview($actor,['requestId'=>genesisUuid(),'selection'=>['mode'=>'all','filter'=>$filter,'sort'=>'priority','queryVersion'=>$sortedPage['queryVersion']],'action'=>['kind'=>'priority','priority'=>2]]);
 bulkExpect($sortedPreview['counts']['selected']===121,'All-results ignored current query sort');genesisSharedBulkCancel($actor,$sortedPreview['id']);
 $before=genesisSharedGetTask($actor,$pid,$tasks[1]['id']);genesisSharedBulkConfirm($actor,$preview['id']);bulkDrain($preview['id']);
 bulkExpect(genesisSharedGetTask($actor,$pid,$tasks[1]['id'])['revision']===$before['revision'],'Confirm retry applied mutation twice');
 $one=genesisSharedGetTask($actor,$pid,$tasks[1]['id']);
 $shift=genesisSharedBulkPreview($actor,['requestId'=>genesisUuid(),'selection'=>['mode'=>'page','items'=>[['id'=>$one['id'],'projectId'=>$pid,'revision'=>$one['revision']]]],'action'=>['kind'=>'due','mode'=>'shift','days'=>3]]);
 genesisSharedBulkConfirm($actor,$shift['id']);bulkDrain($shift['id']);genesisSharedBulkConfirm($actor,$shift['id']);bulkDrain($shift['id']);
 bulkExpect(genesisSharedGetTask($actor,$pid,$one['id'])['dueDate']==='2026-10-23','Retry repeated civil-day shift');
 $viewerPage=genesisSharedQueryTasks($viewer,$filter);$forbidden=genesisSharedBulkPreview($viewer,['requestId'=>genesisUuid(),'selection'=>['mode'=>'all','filter'=>$filter,'queryVersion'=>$viewerPage['queryVersion']],'action'=>['kind'=>'priority','priority'=>1]]);
 genesisSharedBulkConfirm($viewer,$forbidden['id']);bulkDrain($forbidden['id']);bulkExpect(genesisSharedBulkReport($viewer,$forbidden['id'])['counts']['skipped']===121,'Bulk bypassed per-item viewer ACL');
 $cancel=genesisSharedBulkPreview($actor,['requestId'=>genesisUuid(),'selection'=>['mode'=>'page','items'=>[['id'=>$changed['id'],'projectId'=>$pid,'revision'=>$changed['revision']]]],'action'=>['kind'=>'due','mode'=>'clear']]);
 genesisSharedBulkCancel($actor,$cancel['id']);genesisSharedBulkConfirm($actor,$cancel['id']);bulkDrain($cancel['id']);bulkExpect(genesisSharedGetTask($actor,$pid,$changed['id'])['dueDate']==='2026-10-20','Cancelled action changed a task');
 $raw=$db->prepare('SELECT payload FROM shared_bulk_operations WHERE id=?');$raw->execute([$preview['id']]);bulkExpect(!str_contains($raw->fetchColumn(),'queryVersion'),'Selection payload plaintext');$raw->closeCursor();
 $root=genesisSharedTask($actor,$pid,['title'=>'Archive root','statusId'=>$open]);
 $child=genesisSharedTask($actor,$pid,['title'=>'Archive child','statusId'=>$open,'parentTaskId'=>$root['id']]);
 $grandchild=genesisSharedTask($actor,$pid,['title'=>'Archive grandchild','statusId'=>$open,'parentTaskId'=>$child['id']]);
 $branch=genesisSharedBulkPreview($actor,['requestId'=>genesisUuid(),'selection'=>['mode'=>'page','items'=>[
  ['id'=>$root['id'],'projectId'=>$pid,'revision'=>$root['revision']],['id'=>$child['id'],'projectId'=>$pid,'revision'=>$child['revision']]]],'action'=>['kind'=>'archive']]);
 bulkExpect($branch['counts']['selected']===2&&$branch['counts']['affected']===3,'Archive preview omitted additional descendants');
 genesisSharedBulkConfirm($actor,$branch['id']);bulkDrain($branch['id']);$branchResult=genesisSharedBulkReport($actor,$branch['id']);
 bulkExpect($branchResult['counts']['succeeded']===3&&$branchResult['counts']['pending']===0,'Archive report omitted affected descendants');
 foreach([$root,$child,$grandchild]as$treeItem){$archived=genesisSharedGetTask($actor,$pid,$treeItem['id'],true);bulkExpect($archived['revision']===$treeItem['revision']+1&&$archived['archivedAt']!==null,'Selected descendant mutated twice or not archived');}
 $staleRoot=genesisSharedTask($actor,$pid,['title'=>'Stable scope root','statusId'=>$open]);
 $staleChild=genesisSharedTask($actor,$pid,['title'=>'Stable scope child','statusId'=>$open,'parentTaskId'=>$staleRoot['id']]);
 $stale=genesisSharedBulkPreview($actor,['requestId'=>genesisUuid(),'selection'=>['mode'=>'page','items'=>[['id'=>$staleRoot['id'],'projectId'=>$pid,'revision'=>$staleRoot['revision']]]],'action'=>['kind'=>'archive']]);
 $lateChild=genesisSharedTask($actor,$pid,['title'=>'Added after preview','statusId'=>$open,'parentTaskId'=>$staleRoot['id']]);
 genesisSharedBulkConfirm($actor,$stale['id']);bulkDrain($stale['id']);$staleResult=genesisSharedBulkReport($actor,$stale['id']);
 bulkExpect($staleResult['counts']['skipped']===2&&$staleResult['counts']['affected']===2,'Changed tree expanded or did not skip exact original scope');
 bulkExpect(genesisSharedGetTask($actor,$pid,$lateChild['id'])['archivedAt']===null,'New descendant was silently added after preview');
 $doneStatus=array_values(array_filter($statuses,fn($s)=>$s['isDone']))[0]['id'];
 $complete=genesisSharedBulkPreview($actor,['requestId'=>genesisUuid(),'selection'=>['mode'=>'page','items'=>[
  ['id'=>$staleRoot['id'],'projectId'=>$pid,'revision'=>$staleRoot['revision']],['id'=>$staleChild['id'],'projectId'=>$pid,'revision'=>$staleChild['revision']],['id'=>$lateChild['id'],'projectId'=>$pid,'revision'=>$lateChild['revision']]]],'action'=>['kind'=>'status','statusIds'=>[$pid=>$doneStatus]]]);
 genesisSharedBulkConfirm($actor,$complete['id']);bulkDrain($complete['id']);bulkExpect(genesisSharedBulkReport($actor,$complete['id'])['counts']['succeeded']===3,'Child-first completion did not preserve parent guards');
 $reopenItems=[];foreach([$staleRoot,$staleChild,$lateChild]as$treeItem){$current=genesisSharedGetTask($actor,$pid,$treeItem['id']);$reopenItems[]=['id'=>$current['id'],'projectId'=>$pid,'revision'=>$current['revision']];}
 $reopen=genesisSharedBulkPreview($actor,['requestId'=>genesisUuid(),'selection'=>['mode'=>'page','items'=>$reopenItems],'action'=>['kind'=>'status','statusIds'=>[$pid=>$open]]]);
 genesisSharedBulkConfirm($actor,$reopen['id']);bulkDrain($reopen['id']);bulkExpect(genesisSharedBulkReport($actor,$reopen['id'])['counts']['succeeded']===3,'Parent-first reopen did not preserve parent guards');
 $atomicTask=genesisSharedGetTask($actor,$pid,$tasks[2]['id']);
 $atomic=genesisSharedBulkPreview($actor,['requestId'=>genesisUuid(),'selection'=>['mode'=>'page','items'=>[['id'=>$atomicTask['id'],'projectId'=>$pid,'revision'=>$atomicTask['revision']]]],'action'=>['kind'=>'due','mode'=>'shift','days'=>2]]);
 genesisSharedBulkConfirm($actor,$atomic['id']);$oldLease=bulkTestLease($atomic['id']);
 $result=genesisBackgroundPerform($oldLease,static function(string $kind,array $payload):string{bulkExpect($kind==='shared-bulk','Wrong background kind');genesisSharedBulkBatch($payload);throw new RuntimeException('Synthetic failure between result and acknowledgement');});
 bulkExpect($result==='pending'&&genesisSharedGetTask($actor,$pid,$atomicTask['id'])['revision']===$atomicTask['revision']&&genesisSharedBulkReport($actor,$atomic['id'])['counts']['pending']===1,'Worker failure did not roll back mutation and result together');
 $newLease=bulkTestLease($atomic['id']);
 bulkExpect(genesisBackgroundPerform($oldLease,static fn(string $kind,array $payload):string=>genesisSharedBulkBatch($payload))==='superseded','Stale worker lease still mutated data');
 bulkExpect(genesisBackgroundPerform($newLease,static fn(string $kind,array $payload):string=>genesisSharedBulkBatch($payload))==='succeeded','Recovered worker failed');
 $afterAtomic=genesisSharedGetTask($actor,$pid,$atomicTask['id']);
 bulkExpect($afterAtomic['dueDate']==='2026-10-22'&&$afterAtomic['revision']===$atomicTask['revision']+1,'Recovered worker repeated date shift');
 bulkExpect(genesisBackgroundPerform($newLease,static fn(string $kind,array $payload):string=>genesisSharedBulkBatch($payload))==='superseded'&&genesisSharedGetTask($actor,$pid,$atomicTask['id'])['revision']===$afterAtomic['revision'],'Acknowledged job was applied twice');
 $scalarId=$tasks[3]['id'];
 $assigned=bulkSingle($actor,$pid,$scalarId,['kind'=>'assignee','assigneeId'=>$actor]);bulkExpect(genesisSharedGetTask($actor,$pid,$scalarId)['assigneeId']===$actor,'Assignee was not set');
 bulkExpect(!$assigned['actionInfo']['unavailable']&&is_string($assigned['actionInfo']['assigneeName']),'Current assignee name was not resolved');
 bulkSingle($actor,$pid,$scalarId,['kind'=>'assignee','assigneeId'=>null]);bulkExpect(genesisSharedGetTask($actor,$pid,$scalarId)['assigneeId']===null,'Assignee was not cleared');
 $label=genesisSharedSaveLabel($actor,$space['id'],null,['title'=>'Bulk label']);
 $labelled=bulkSingle($actor,$pid,$scalarId,['kind'=>'labels','mode'=>'add','labelIds'=>[$label['id']]]);bulkExpect(genesisSharedGetTask($actor,$pid,$scalarId)['labelIds']===[$label['id']],'Label was not added');
 bulkExpect(!$labelled['actionInfo']['unavailable']&&$labelled['actionInfo']['labels'][0]['title']==='Bulk label','Current label name was not resolved');
 bulkSingle($actor,$pid,$scalarId,['kind'=>'labels','mode'=>'remove','labelIds'=>[$label['id']]]);bulkExpect(genesisSharedGetTask($actor,$pid,$scalarId)['labelIds']===[],'Label was not removed');
 bulkSingle($actor,$pid,$scalarId,['kind'=>'due','mode'=>'set','date'=>'2026-12-15']);bulkExpect(genesisSharedGetTask($actor,$pid,$scalarId)['dueDate']==='2026-12-15','Due date was not set');
 bulkSingle($actor,$pid,$scalarId,['kind'=>'due','mode'=>'clear']);bulkExpect(genesisSharedGetTask($actor,$pid,$scalarId)['dueDate']===null,'Due date was not cleared');
 $destination=genesisSharedCreateProject($actor,$space['id'],['title'=>'Bulk move destination']);$targetStatus=genesisSharedProjectSnapshot($actor,$destination['id'])['statuses'][0]['id'];
 $moved=bulkSingle($actor,$pid,$scalarId,['kind'=>'move','projectId'=>$destination['id'],'statusId'=>$targetStatus]);
 bulkExpect(!$moved['actionInfo']['unavailable']&&$moved['actionInfo']['projectTitle']==='Bulk move destination'&&is_string($moved['actionInfo']['statusTitle']),'Destination names were not resolved');
 bulkExpect($moved['items'][0]['projectId']===$destination['id']&&$moved['items'][0]['available']&&$moved['items'][0]['title']==='Bulk 3','Move report did not link to the destination');
 $trashed=bulkSingle($actor,$destination['id'],$scalarId,['kind'=>'trash','retentionDays'=>7]);
 bulkExpect($trashed['items'][0]['trashed']&&!$trashed['items'][0]['available']&&$trashed['items'][0]['title']==='Bulk 3','Trash report lost authorized title or exposed an active link');
 $retryTask=genesisSharedGetTask($actor,$pid,$tasks[4]['id']);
 $retry=genesisSharedBulkPreview($actor,['requestId'=>genesisUuid(),'selection'=>['mode'=>'page','items'=>[['id'=>$retryTask['id'],'projectId'=>$pid,'revision'=>$retryTask['revision']]]],'action'=>['kind'=>'due','mode'=>'shift','days'=>1]]);
 genesisSharedBulkConfirm($actor,$retry['id']);$retryKey='bulk:'.$retry['id'].':0';
 for($attempt=1;$attempt<=5;$attempt++){
  $job=genesisBackgroundClaim(gmdate('Y-m-d\TH:i:s\Z',time()+3600),$retryKey);bulkExpect($job!==null,'Retry job was not claimed');
  bulkExpect(genesisBackgroundClaim(null,$retryKey)===null,'Concurrent worker claimed an active lease');
  $state=genesisBackgroundPerform($job,static function():string{throw new RuntimeException('Synthetic private failure');});
  if($attempt<5){bulkExpect($state==='pending'&&genesisBackgroundClaim(null,$retryKey)===null,'Retry backoff was bypassed');}
 }
 $failed=genesisSharedBulkReport($actor,$retry['id']);
 bulkExpect($failed['state']==='failed'&&$failed['counts']['failed']===1&&$failed['counts']['pending']===0&&$failed['errorCode']==='BACKGROUND_RETRY','Terminal failure was not visible and exact');
 bulkExpect(genesisSharedGetTask($actor,$pid,$retryTask['id'])['revision']===$retryTask['revision'],'Failed worker changed a task');
 genesisSharedBulkResume($actor,$retry['id']);genesisSharedBulkResume($actor,$retry['id']);
 genesisSharedBulkJobFailed($job,'BACKGROUND_LEASE_EXPIRED');
 bulkExpect(genesisSharedBulkReport($actor,$retry['id'])['state']==='running','Old failed batch cancelled a resumed operation');
 bulkDrain($retry['id']);$retried=genesisSharedGetTask($actor,$pid,$retryTask['id']);
 bulkExpect($retried['dueDate']==='2026-10-21'&&$retried['revision']===$retryTask['revision']+1,'Resume repeated or lost a date shift');
 $expiredTask=genesisSharedGetTask($actor,$pid,$tasks[5]['id']);
 $expired=genesisSharedBulkPreview($actor,['requestId'=>genesisUuid(),'selection'=>['mode'=>'page','items'=>[['id'=>$expiredTask['id'],'projectId'=>$pid,'revision'=>$expiredTask['revision']]]],'action'=>['kind'=>'priority','priority'=>1]]);
 genesisSharedBulkConfirm($actor,$expired['id']);bulkTestLease($expired['id']);
 $db->prepare("UPDATE background_jobs SET attempts=5,lease_until='2000-01-01T00:00:00Z' WHERE unique_key=?")->execute(['bulk:'.$expired['id'].':0']);
 bulkExpect(genesisBackgroundClaim(null,'bulk:'.$expired['id'].':0')===null&&genesisSharedBulkReport($actor,$expired['id'])['state']==='failed','Expired terminal lease left the operation running');
 genesisSharedBulkResume($actor,$expired['id']);bulkDrain($expired['id']);
 $cancelTask=genesisSharedGetTask($actor,$pid,$tasks[6]['id']);
 $cancelRunning=genesisSharedBulkPreview($actor,['requestId'=>genesisUuid(),'selection'=>['mode'=>'page','items'=>[['id'=>$cancelTask['id'],'projectId'=>$pid,'revision'=>$cancelTask['revision']]]],'action'=>['kind'=>'due','mode'=>'clear']]);
 genesisSharedBulkConfirm($actor,$cancelRunning['id']);$cancelJob=genesisBackgroundClaim(null,'bulk:'.$cancelRunning['id'].':0');genesisSharedBulkCancel($actor,$cancelRunning['id']);
 bulkExpect(genesisBackgroundPerform($cancelJob)==='cancelled'&&genesisSharedGetTask($actor,$pid,$cancelTask['id'])['revision']===$cancelTask['revision'],'Already claimed worker ignored cancellation');
 $db->prepare('DELETE FROM shared_project_members WHERE project_id=? AND user_id=?')->execute([$pid,$viewer]);
 $revoked=genesisSharedBulkReport($viewer,$forbidden['id']);
 bulkExpect(count($revoked['items'])===100&&$revoked['hasMore']&&!array_filter($revoked['items'],fn($item)=>isset($item['title'])||isset($item['id'])||isset($item['projectId'])||isset($item['projectTitle'])),'Report leaked revoked project content');
 $extraTask=genesisSharedGetTask($actor,$pid,$tasks[7]['id']);$extra=genesisSharedBulkPreview($actor,['requestId'=>genesisUuid(),'selection'=>['mode'=>'page','items'=>[['id'=>$extraTask['id'],'projectId'=>$pid,'revision'=>$extraTask['revision']]]],'action'=>['kind'=>'due','mode'=>'clear']]);genesisSharedBulkCancel($actor,$extra['id']);
 $history=genesisSharedBulkOperations($actor);bulkExpect(count($history['operations'])===20&&$history['hasMore']&&$history['nextCursor']!==null,'Recent operation history was not paginated');
 $older=genesisSharedBulkOperations($actor,$history['nextCursor']);bulkExpect($older['operations']&&!array_intersect(array_column($history['operations'],'id'),array_column($older['operations'],'id')),'Operation history repeated a page');
 $viewerHistory=genesisSharedBulkOperations($viewer);bulkExpect(count($viewerHistory['operations'])===1&&$viewerHistory['operations'][0]['id']===$forbidden['id'],'Operation history exposed another actor');
 echo "Bulk: 121 all-results, exact descendants, all actions, move/trash reports, ACL/revision, retry/cancel, tree/order guards, atomic result+ack, concurrent/stale/expired leases, terminal failure/resume, revoked reports and encryption passed.\n";
}finally{
 if($db->inTransaction())$db->rollBack();
 $db->prepare("DELETE FROM background_jobs WHERE kind='shared-bulk' AND EXISTS(SELECT 1 FROM shared_bulk_operations o WHERE o.actor_id IN (?,?) AND unique_key LIKE 'bulk:'||o.id||':%')")->execute([$actor,$viewer]);
 if($space){$db->prepare('UPDATE shared_tasks SET parent_task_id=NULL WHERE parent_task_id IS NOT NULL AND project_id IN (SELECT id FROM shared_projects WHERE space_id=?)')->execute([$space['id']]);$db->prepare('DELETE FROM shared_spaces WHERE id=?')->execute([$space['id']]);}
 foreach([$actor,$viewer]as$user){$db->prepare('DELETE FROM shared_google_projection_cleanup WHERE user_id=?')->execute([$user]);$db->prepare('DELETE FROM users WHERE id=?')->execute([$user]);}
}
