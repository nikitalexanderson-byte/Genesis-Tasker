<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli' || getenv('GENESIS_MINDMAPS_TEST') !== 'isolated') exit(1);
require __DIR__.'/../src/bootstrap.php';
$fixtureRoot = getenv('GENESIS_FULL_QA') === 'isolated' ? str_replace('\\', '/', (string)getenv('GENESIS_MINDMAPS_FIXTURE_ROOT')) : '';
$outputRoot = str_replace('\\', '/', dirname(__DIR__, 2) . '/output/');
if ($fixtureRoot !== '' && (!str_starts_with($fixtureRoot, $outputRoot) || !is_file($fixtureRoot . '/owner.json'))) throw new RuntimeException('Unowned fixture directory refused.');
$fixtureDatabase = ($fixtureRoot !== '' ? $fixtureRoot : rtrim($outputRoot, '/')) . '/mindmaps-test.sqlite';
if (str_replace('\\','/',genesisConfig()['db_path']) !== $fixtureDatabase) throw new RuntimeException('Non-fixture DB refused.');
foreach (['repository','google','shared-projects','mindmaps','shared-mindmaps','shared-maintenance'] as $module) require __DIR__.'/../src/'.$module.'.php';
function mapCheck(bool $ok,string $message):void {if(!$ok)throw new RuntimeException($message);}
function mapReject(callable $work,int $status):void {try{$work();}catch(GenesisSharedAccessException|GenesisResourceLimitException $e){mapCheck($e->status===$status,'Wrong status:'.$e->getMessage());return;}throw new RuntimeException('Forbidden or stale write succeeded');}
$users=[];$spaces=[];$tag=genesisUuid();
try {
 // Lifetime membership enables the product; project roles still control each operation.
 foreach(['owner','member','viewer','outsider'] as $role){$u=genesisUpsertGoogleUser(['email_verified'=>true,'sub'=>$tag.$role,'email'=>$role.'-'.$tag.'@example.invalid','name'=>$role],[],false);$users[$role]=$u['id'];genesisDb()->prepare("UPDATE users SET subscription_plan='premium4life',subscription_valid_until=NULL WHERE id=?")->execute([$u['id']]);genesisUpdateAccountPreferences($u['id'],['sharedProjectsEnabled'=>true]);}
 $space=genesisSharedCreateSpace($users['owner'],['title'=>'Shared map fixture']);$spaces[]=$space['id'];
 $other=genesisSharedCreateSpace($users['owner'],['title'=>'Other fixture']);$spaces[]=$other['id'];
 foreach(['member'=>'member','viewer'=>'guest'] as $who=>$role)genesisDb()->prepare('INSERT INTO shared_space_members(space_id,user_id,role,joined_at) VALUES(?,?,?,?)')->execute([$space['id'],$users[$who],$role,genesisNow()]);
 $project=genesisSharedCreateProject($users['owner'],$space['id'],['title'=>'Fixture project','layout'=>'list']);
 // New opaque envelopes protect advanced documents against destructive old-client saves.
 $personalId=genesisUuid();$sealed=['schemaVersion'=>2,'expectedRevision'=>0,'operationId'=>genesisUuid(),'iv'=>base64_encode(random_bytes(12)),'ciphertext'=>base64_encode(random_bytes(32))];
 genesisSaveMindmap($users['owner'],$personalId,$sealed);
 $oldClient=$sealed;$oldClient['schemaVersion']=1;$oldClient['expectedRevision']=1;$oldClient['operationId']=genesisUuid();
 mapReject(fn()=>genesisSaveMindmap($users['owner'],$personalId,$oldClient),409);
 mapReject(fn()=>genesisDeleteMindmap($users['owner'],$personalId,['expectedRevision'=>1]),409);
 mapCheck(genesisMindmaps($users['owner'])[0]['schemaVersion']===2,'Advanced envelope downgraded');
 genesisDeleteMindmap($users['owner'],$personalId,['expectedRevision'=>1,'schemaVersion'=>2]);
 foreach(['member'=>'member','viewer'=>'viewer'] as $who=>$role)genesisDb()->prepare('INSERT OR IGNORE INTO shared_project_members(project_id,user_id,role,joined_at) VALUES(?,?,?,?)')->execute([$project['id'],$users[$who],$role,genesisNow()]);
 $id=genesisUuid();$root=genesisUuid();$node=genesisUuid();
 $doc=['schemaVersion'=>1,'id'=>$id,'title'=>'Distinctive secret map title','description'=>'Description survives','projectId'=>null,'pinned'=>false,'archived'=>false,'nodes'=>[['id'=>$root,'parentId'=>null,'kind'=>'idea','text'=>'Root','note'=>''],['id'=>$node,'parentId'=>$root,'kind'=>'idea','text'=>'Real shared task','note'=>'']], 'links'=>[]];
 $input=['schemaVersion'=>1,'expectedRevision'=>0,'operationId'=>genesisUuid(),'document'=>$doc];
 $saved=genesisSaveSharedMindmap($users['owner'],$space['id'],$id,$input);mapCheck($saved['revision']===1,'First revision');
 mapCheck(genesisSaveSharedMindmap($users['member'],$space['id'],$id,$input)['revision']===1,'Cross-member retry duplicated map');
 mapCheck(genesisSharedMindmaps($users['member'],$space['id'])[0]['document']['description']===$doc['description'],'Member cannot read description');
 mapCheck(genesisSharedMindmaps($users['owner'],$other['id'])===[],'Cross-space list leaked');
 mapReject(fn()=>genesisSharedMindmaps($users['outsider'],$space['id']),404);
 mapReject(fn()=>genesisSaveSharedMindmap($users['viewer'],$space['id'],$id,$input),403);
 $changed=$input;$changed['document']['title']='Changed';mapReject(fn()=>genesisSaveSharedMindmap($users['owner'],$space['id'],$id,$changed),409);
 $changed['operationId']=genesisUuid();$changed['expectedRevision']=1;
 genesisSaveSharedMindmap($users['member'],$space['id'],$id,$changed);
 $stale=$input;$stale['operationId']=genesisUuid();mapReject(fn()=>genesisSaveSharedMindmap($users['owner'],$space['id'],$id,$stale),409);
 $q=genesisDb()->prepare('SELECT content FROM shared_mindmaps WHERE space_id=?');$q->execute([$space['id']]);$stored=$q->fetchColumn();
 mapCheck(str_starts_with($stored,GENESIS_SHARED_CONTENT_PREFIX)&&!str_contains($stored,'Description survives'),'Plaintext at rest');
 mapCheck(count(genesisSharedMindmaps($users['owner'],$space['id'],$id))===2,'History missing');
 $snapshot=genesisSharedProjectSnapshot($users['owner'],$project['id']);$status=$snapshot['statuses'][0]['id'];
 $taskInput=['title'=>'Created from thought','statusId'=>$status,'mindmapSource'=>['mapId'=>$id,'nodeId'=>$node]];
 $task=genesisSharedTask($users['owner'],$project['id'],$taskInput);
 // Root-specific settings are optional and do not change task completion permissions.
 $settings=genesisSharedReviewSettings($users['owner'],$project['id']);mapCheck(!$settings['policy']['enabled'],'Review unexpectedly required');
 $policy=$settings['policy'];$policy['enabled']=true;$policy['checked']=['group'=>'selected','userIds'=>[$users['viewer']]];
 genesisSharedReviewSettings($users['owner'],$project['id'],['policy'=>$policy,'expectedRevision'=>0]);
 mapReject(fn()=>genesisSharedReviewSettings($users['member'],$project['id'],['policy'=>$policy,'expectedRevision'=>1]),403);
 $doneStatus=genesisSharedCreateStatus($users['owner'],$project['id'],['title'=>'Done','isDone'=>true]);
 $done=genesisSharedTask($users['owner'],$project['id'],['statusId'=>$doneStatus['id'],'expectedRevision'=>$task['revision']],$task['id']);
 genesisSharedReviewTask($users['viewer'],$project['id'],$task['id'],['kind'=>'checked','enabled'=>true,'expectedRevision'=>$done['revision']]);
 mapReject(fn()=>genesisSharedReviewTask($users['viewer'],$project['id'],$task['id'],['kind'=>'confirmed','enabled'=>true,'expectedRevision'=>$done['revision']]),403);
 genesisSharedReviewTask($users['owner'],$project['id'],$task['id'],['kind'=>'confirmed','enabled'=>true,'expectedRevision'=>$done['revision']]);
 $reviewed=genesisSharedProjectSnapshot($users['owner'],$project['id'])['tasks'][0];mapCheck(count($reviewed['review']['entries'])===2,'Reviews missing');
 genesisSharedTrashTask($users['owner'],$project['id'],$task['id'],['expectedRevision'=>$done['revision'],'retentionDays'=>7]);
 mapCheck(genesisSharedProjectSnapshot($users['owner'],$project['id'])['tasks']===[],'Trashed task visible');
 $trash=genesisSharedTrashList($users['owner'],$space['id']);mapCheck($trash[0]['retentionDays']===7,'Retention not stored');
 mapReject(fn()=>genesisSharedRestoreTrash($users['viewer'],$space['id'],'task',$task['id'],[]),403);
 genesisSharedRestoreTrash($users['owner'],$space['id'],'task',$task['id'],[]);
 $restored=genesisSharedProjectSnapshot($users['owner'],$project['id'])['tasks'][0];mapCheck($restored['id']===$task['id']&&count($restored['review']['entries'])===2,'Restore lost identity or reviews');
 // Changing the task invalidates attestations; repeating deletion never creates another task.
 $changedTask=genesisSharedTask($users['owner'],$project['id'],['title'=>'Changed after review','expectedRevision'=>$restored['revision']],$task['id']);
 mapCheck(genesisSharedProjectSnapshot($users['owner'],$project['id'])['tasks'][0]['review']['entries']===[],'Stale attestation survived task edit');
 $file=base64_encode('Project file to expire');genesisSharedTask($users['owner'],$project['id'],['attachments'=>[['name'=>'fixture.txt','data'=>'data:text/plain;base64,'.$file]],'expectedRevision'=>$changedTask['revision']],$task['id']);
 $db=genesisDb();$now=genesisNow();$before=gmdate('Y-m-d\TH:i:s\Z',time()-29*86400);
 $db->prepare('UPDATE shared_projects SET archived_at=? WHERE id=?')->execute([$before,$project['id']]);
 $imageId=genesisUuid();$imageRoot=genesisUuid();$pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=';
 $imageDoc=['schemaVersion'=>1,'id'=>$imageId,'title'=>'Retained map text','projectId'=>$project['id'],'pinned'=>false,'archived'=>false,'nodes'=>[['id'=>$imageRoot,'parentId'=>null,'kind'=>'idea','text'=>'Keep this text','note'=>'Keep this note','presentation'=>['image'=>['data'=>$pixel,'alt'=>'Test pixel','fit'=>'contain']]]],'links'=>[]];
 genesisSaveSharedMindmap($users['owner'],$space['id'],$imageId,['schemaVersion'=>1,'expectedRevision'=>0,'operationId'=>genesisUuid(),'document'=>$imageDoc]);
 // A consistent SQLite runtime backup includes additive schemas and encrypted snapshots.
 $backup=dirname(__DIR__,2).'/output/migration-fixture-'.genesisUuid().'.sqlite';
 try {$q->closeCursor();$db->exec('VACUUM INTO '.$db->quote($backup));$copy=new PDO('sqlite:'.$backup);mapCheck($copy->query('PRAGMA integrity_check')->fetchColumn()==='ok','Migration backup corrupt');mapCheck((int)$copy->query('SELECT COUNT(*) FROM shared_mindmap_versions')->fetchColumn()>0,'Backup lost map history');$copy=null;}finally{if(is_file($backup))unlink($backup);}
 genesisSharedMaintenance($now);mapCheck(count(genesisSharedTaskAttachments($task['id']))===1,'Files removed before 30 days');
 $db->prepare('UPDATE shared_projects SET archived_at=NULL WHERE id=?')->execute([$project['id']]);genesisSharedMaintenance(genesisSharedTrashExpiry($now,60));mapCheck(count(genesisSharedTaskAttachments($task['id']))===1,'Restored active project lost files');
 $db->prepare('UPDATE shared_projects SET archived_at=? WHERE id=?')->execute([gmdate('Y-m-d\TH:i:s\Z',time()-31*86400),$project['id']]);
 genesisSharedMaintenance($now);mapCheck(genesisSharedTaskAttachments($task['id'])===[],'Expired project files remain');
 foreach(genesisSharedMindmaps($users['owner'],$space['id'],$imageId) as $version){mapCheck(!isset($version['document']['nodes'][0]['presentation']['image']),'Map history retained expired image');mapCheck($version['document']['nodes'][0]['text']==='Keep this text','Retention removed map text');}
 genesisDeleteSharedMindmap($users['owner'],$space['id'],$imageId,['expectedRevision'=>2]);
 $db->prepare('UPDATE shared_projects SET archived_at=NULL WHERE id=?')->execute([$project['id']]);

 $retry=genesisSharedTask($users['member'],$project['id'],$taskInput);mapCheck($retry['id']===$task['id'],'Two members duplicated one thought');
 mapReject(fn()=>genesisDeleteSharedMindmap($users['owner'],$space['id'],$id,['expectedRevision'=>1]),409);
 genesisDeleteSharedMindmap($users['member'],$space['id'],$id,['expectedRevision'=>2]);
 mapCheck(genesisSharedMindmaps($users['owner'],$space['id'])===[],'Deleted map remains');
 mapCheck(in_array($task['id'],array_column(genesisSharedProjectSnapshot($users['owner'],$project['id'])['tasks'],'id'),true),'Map deletion removed task');
 mapReject(fn()=>genesisSaveSharedMindmap($users['owner'],$space['id'],$id,$changed),409);
 genesisDb()->prepare('DELETE FROM shared_space_members WHERE space_id=? AND user_id=?')->execute([$space['id'],$users['member']]);
 mapReject(fn()=>genesisSharedMindmaps($users['member'],$space['id']),404);
 $current=genesisSharedProjectSnapshot($users['owner'],$project['id'])['project'];
 genesisSharedTrashProject($users['owner'],$project['id'],['expectedRevision'=>$current['revision'],'retentionDays'=>3]);
 mapReject(fn()=>genesisSharedProjectSnapshot($users['owner'],$project['id']),404);
 genesisSharedRestoreTrash($users['owner'],$space['id'],'project',$project['id'],[]);
 mapCheck(genesisSharedProjectSnapshot($users['owner'],$project['id'])['project']['id']===$project['id'],'Project restore failed');
 $liveTask=genesisSharedProjectSnapshot($users['owner'],$project['id'])['tasks'][0];
 genesisSharedTrashTask($users['owner'],$project['id'],$liveTask['id'],['expectedRevision'=>$liveTask['revision'],'retentionDays'=>1]);
 genesisSharedMaintenance(genesisSharedTrashExpiry(genesisNow(),2));
 mapCheck(genesisSharedTrashList($users['owner'],$space['id'])===[],'Expired trash remains');
 echo "PASS review policy, selected reviewers, confirmation ACL, invalidation, task/project trash restore and file/trash retention.\n";
 echo "PASS shared maps: space/account isolation, ACL, encrypted content, CAS, cross-member idempotency, history, deletion and task preservation.\n";
}finally{foreach($spaces as $spaceId)genesisDb()->prepare('DELETE FROM shared_spaces WHERE id=?')->execute([$spaceId]);foreach($users as $uid)genesisDb()->prepare('DELETE FROM users WHERE id=?')->execute([$uid]);}
