<?php
declare(strict_types=1);
require_once __DIR__ . '/shared-fixture-plan.php';
foreach(['bootstrap','repository','google','shared-projects']as$module)require dirname(__DIR__).'/src/'.$module.'.php';
if(!in_array(parse_url(genesisConfig()['app_url'],PHP_URL_HOST),['127.0.0.1','localhost.invalid'],true))throw new RuntimeException('Isolated configuration required');
function bulkLargeExpect(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);}
$db=genesisDb();$actor='bulk-large-'.bin2hex(random_bytes(5));$space=null;$started=microtime(true);
$db->prepare('INSERT INTO users(id,google_sub,email,created_at,updated_at) VALUES(?,?,?,?,?)')->execute([$actor,$actor,$actor.'@example.invalid',genesisNow(),genesisNow()]);genesisTestEnableSharedProjects($actor);
try{
 $space=genesisSharedCreateSpace($actor,['title'=>'Bulk large fixture']);$project=genesisSharedCreateProject($actor,$space['id'],['title'=>'Large project A']);$pid=$project['id'];$status=genesisSharedProjectSnapshot($actor,$pid)['statuses'][0]['id'];
 $projectB=genesisSharedCreateProject($actor,$space['id'],['title'=>'Large project B']);$pidB=$projectB['id'];$statusB=genesisSharedProjectSnapshot($actor,$pidB)['statuses'][0]['id'];
 genesisBeginWriteTransaction($db);$insert=$db->prepare('INSERT INTO shared_tasks(id,project_id,status_id,title,created_by,created_at,updated_at,updated_by,position) VALUES(?,?,?,?,?,?,?,?,?)');
 for($index=0;$index<10001;$index++)$insert->execute([$actor.'-'.$index,$index<6000?$pid:$pidB,$index<6000?$status:$statusB,'Bulk large '.$index,$actor,genesisNow(),genesisNow(),$actor,$index]);$db->commit();
 echo 'Bulk large: 10001 fixtures across two projects seeded in '.round(microtime(true)-$started,1)." seconds.\n";$started=microtime(true);
 $filter=['projectIds'=>[$pid,$pidB]];$first=genesisSharedQueryTasks($actor,$filter);
 bulkLargeExpect(count($first['tasks'])===100&&$first['total']===10001,'Initial page was not bounded');
 $preview=genesisSharedBulkPreview($actor,['requestId'=>genesisUuid(),'selection'=>['mode'=>'all','filter'=>$filter,'sort'=>'position','queryVersion'=>$first['queryVersion']],'action'=>['kind'=>'priority','priority'=>3]]);
 bulkLargeExpect($preview['counts']['selected']===10001&&count($preview['items'])===100,'Server snapshot omitted unloaded tasks or returned an unbounded report');
 genesisSharedTask($actor,$pid,['expectedRevision'=>1,'description'=>'Concurrent edit'],$actor.'-0');
 genesisSharedBulkConfirm($actor,$preview['id']);$report=$preview;$ticks=0;
 do{
  $report=genesisSharedBulkAdvance($actor,$preview['id']);bulkLargeExpect($report['retryAt']===null&&$report['state']!=='failed','Large operation entered an unexpected retry');
  if(++$ticks%50===0)echo 'Bulk large progress: '.$report['counts']['succeeded'].' succeeded, '.$report['counts']['pending']." pending.\n";
  if(microtime(true)-$started>300)throw new RuntimeException('Large operation exceeded the bounded test budget');
 }while($report['state']==='running');
 bulkLargeExpect($report['counts']['succeeded']===10000&&$report['counts']['skipped']===1&&$report['counts']['pending']===0,'Large operation lost exact per-item results');
 $seen=[];$after=0;
 do{
  $page=genesisSharedBulkReport($actor,$preview['id'],$after);bulkLargeExpect(count($page['items'])<=100,'Result page is unbounded');
  foreach($page['items']as$item){bulkLargeExpect(!isset($seen[$item['cursor']]),'Result cursor repeated an item');$seen[$item['cursor']]=true;}
  $after=$page['nextCursor'];
 }while($page['hasMore']);
 bulkLargeExpect(count($seen)===10001,'Result pagination lost unloaded tasks');
 $q=$db->prepare('SELECT COUNT(*) FROM shared_tasks WHERE project_id IN (?,?) AND priority=3');$q->execute([$pid,$pidB]);$changed=(int)$q->fetchColumn();$q->closeCursor();bulkLargeExpect($changed===10000,'Database outcome differs from the result');
 $priorityElapsed=microtime(true)-$started;
 $payload=str_repeat('Synthetic payload ',290);
 $db->prepare('UPDATE shared_tasks SET parent_task_id=?,description=? WHERE project_id=? AND id<>?')->execute([$actor.'-0',$payload,$pid,$actor.'-0']);
 $rootTask=genesisSharedGetTask($actor,$pid,$actor.'-0');$archiveStarted=microtime(true);
 $archive=genesisSharedBulkPreview($actor,['requestId'=>genesisUuid(),'selection'=>['mode'=>'page','items'=>[['id'=>$rootTask['id'],'projectId'=>$pid,'revision'=>$rootTask['revision']]]],'action'=>['kind'=>'archive']]);
 bulkLargeExpect($archive['counts']['selected']===1&&$archive['counts']['affected']===6000,'Large branch preview lost extra descendants');
 genesisSharedBulkConfirm($actor,$archive['id']);$archived=genesisSharedBulkAdvance($actor,$archive['id']);
 bulkLargeExpect($archived['state']==='done'&&$archived['counts']['succeeded']===6000,'Large branch archive was incomplete');
 $sample=genesisSharedGetTask($actor,$pid,$actor.'-5999',true);bulkLargeExpect($sample['description']===$payload&&$sample['archivedAt']!==null,'Large branch archive changed task content');
 bulkLargeExpect(memory_get_peak_usage(true)<64*1024*1024,'Bulk selection loaded too much data into PHP');
 echo 'Bulk large: 10001 server-selected tasks, 10000 changes, one conflict in '.round($priorityElapsed,1).' seconds; 6000-node branch with preserved payloads in '.round(microtime(true)-$archiveStarted,1).' seconds; exact bounded report and '.round(memory_get_peak_usage(true)/1024/1024,1)." MiB peak memory passed.\n";
}finally{
 if($db->inTransaction())$db->rollBack();
 $db->prepare("DELETE FROM background_jobs WHERE kind='shared-bulk' AND EXISTS(SELECT 1 FROM shared_bulk_operations o WHERE o.actor_id=? AND unique_key LIKE 'bulk:'||o.id||':%')")->execute([$actor]);
 if($space){
  $db->prepare('UPDATE shared_tasks SET parent_task_id=NULL WHERE project_id IN (SELECT id FROM shared_projects WHERE space_id=?)')->execute([$space['id']]);
  $db->prepare('DELETE FROM shared_spaces WHERE id=?')->execute([$space['id']]);
 }
 $db->prepare('DELETE FROM users WHERE id=?')->execute([$actor]);
}
