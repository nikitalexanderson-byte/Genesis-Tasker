<?php
declare(strict_types=1);
require_once __DIR__ . '/shared-fixture-plan.php';
require dirname(__DIR__).'/src/bootstrap.php';require dirname(__DIR__).'/src/repository.php';require dirname(__DIR__).'/src/google.php';require dirname(__DIR__).'/src/shared-projects.php';
require_once dirname(__DIR__).'/src/shared-maintenance.php';
if(!in_array(parse_url(genesisConfig()['app_url'],PHP_URL_HOST),['127.0.0.1','localhost.invalid'],true))throw new RuntimeException('Isolated configuration required');
function lifecycleExpect(bool $ok,string $why):void {if(!$ok)throw new RuntimeException($why);}
function lifecycleReject(callable $action,string $code):void {try{$action();}catch(GenesisSharedAccessException|InvalidArgumentException $e){lifecycleExpect($e->getMessage()===$code,'Expected '.$code.', got '.$e->getMessage());return;}throw new RuntimeException('Expected '.$code);}
$db=genesisDb();$owner='lifecycle-'.bin2hex(random_bytes(5));$manager=$owner.'-manager';$space=null;
foreach([$owner,$manager] as $id){$db->prepare('INSERT INTO users(id,google_sub,email,created_at,updated_at) VALUES(?,?,?,?,?)')->execute([$id,$id,$id.'@example.invalid',genesisNow(),genesisNow()]);genesisTestEnableSharedProjects($id);}
try {
 $space=genesisSharedCreateSpace($owner,['title'=>'Lifecycle fixture']);$sid=$space['id'];$p=genesisSharedCreateProject($owner,$sid,['title'=>'Lifecycle project']);$pid=$p['id'];
 $db->prepare("INSERT INTO shared_space_members(space_id,user_id,role,joined_at) VALUES(?,?,'member',?)")->execute([$sid,$manager,genesisNow()]);
 $db->prepare("INSERT INTO shared_project_members(project_id,user_id,role,joined_at) VALUES(?,?,'manager',?)")->execute([$pid,$manager,genesisNow()]);
 $status=genesisSharedProjectSnapshot($owner,$pid)['statuses'][0]['id'];
 $parent=genesisSharedTask($owner,$pid,['title'=>'Parent','statusId'=>$status,'priority'=>3,'checklists'=>[['id'=>'c','title'=>'Preserve','items'=>[]]],'attachments'=>[['name'=>'Keep.txt','data'=>'data:text/plain;base64,'.base64_encode('Keep file')]]]);
 $child=genesisSharedTask($owner,$pid,['title'=>'Child','statusId'=>$status,'parentTaskId'=>$parent['id'],'dueDate'=>'2026-10-20']);
 $comment=genesisUuid();$db->prepare('INSERT INTO shared_comments(id,task_id,author_id,body,created_at) VALUES(?,?,?,?,?)')->execute([$comment,$child['id'],$owner,'Preserved comment',genesisNow()]);
 $archive=['archived'=>true,'expectedRevision'=>$parent['revision'],'requestId'=>genesisUuid()];
 $result=genesisSharedArchiveTask($owner,$pid,$parent['id'],$archive);
 lifecycleExpect($result['affected']===2,'Archive omitted child');lifecycleExpect(genesisSharedArchiveTask($owner,$pid,$parent['id'],$archive)===$result,'Archive retry duplicated changes');
 lifecycleReject(fn()=>genesisSharedArchiveTask($owner,$pid,$parent['id'],[...$archive,'expectedRevision'=>$result['revision']]),'SHARED_REQUEST_ID_CONFLICT');
 lifecycleExpect(genesisSharedQueryTasks($owner,['projectIds'=>[$pid]])['total']===0,'Archive remains active');
 lifecycleExpect(genesisSharedQueryTasks($owner,['projectIds'=>[$pid],'archived'=>true])['total']===2,'Archive listing incomplete');
 lifecycleExpect(genesisSharedQueryTasks($owner,['projectIds'=>[$pid],'parentTaskId'=>$parent['id'],'includeArchived'=>true])['total']===1,'Archived child disappeared from parent navigation');
 lifecycleExpect(genesisSharedReadTaskAttachment($manager,$parent['id'],$parent['attachments'][0]['id'])['bytes']==='Keep file','Archived file cannot be read');
 lifecycleExpect(count(genesisSharedComments($manager,$pid,$child['id']))===1,'Archived comments cannot be read');
 lifecycleExpect(count(genesisSharedActivity($manager,$pid,$parent['id'],null)['events'])>0,'Archived history cannot be read');
 $archivedChild=genesisSharedGetTask($owner,$pid,$child['id'],true);
 lifecycleReject(fn()=>genesisSharedArchiveTask($owner,$pid,$child['id'],['archived'=>false,'expectedRevision'=>$archivedChild['revision']]),'RESTORE_PARENT_FIRST');
 $unarchive=['archived'=>false,'expectedRevision'=>$result['revision'],'requestId'=>genesisUuid()];
 $restored=genesisSharedArchiveTask($owner,$pid,$parent['id'],$unarchive);
 lifecycleExpect(genesisSharedArchiveTask($owner,$pid,$parent['id'],$unarchive)===$restored,'Unarchive retry changed response');
 lifecycleReject(fn()=>genesisSharedArchiveTask($owner,$pid,$parent['id'],[...$unarchive,'expectedRevision'=>999]),'SHARED_REQUEST_ID_CONFLICT');
 lifecycleExpect($restored['affected']===2,'Restore omitted children');
 $current=genesisSharedGetTask($owner,$pid,$parent['id']);
 lifecycleExpect($current['priority']===3 && $current['checklists'][0]['title']==='Preserve','Archive changed fields');
 $trash=['expectedRevision'=>$current['revision'],'retentionDays'=>7,'requestId'=>genesisUuid()];$deleted=genesisSharedDeleteTask($owner,$pid,$parent['id'],$trash);
 lifecycleExpect($deleted['affected']===2,'Trash omitted child');lifecycleExpect(genesisSharedDeleteTask($owner,$pid,$parent['id'],$trash)===$deleted,'Trash retry changed response');
 lifecycleReject(fn()=>genesisSharedDeleteTask($owner,$pid,$parent['id'],[...$trash,'retentionDays'=>14]),'SHARED_REQUEST_ID_CONFLICT');
 $items=genesisSharedTrashList($owner,$sid);lifecycleExpect(count($items)===1 && $items[0]['canPurge'],'Trash root list/permission wrong');
 lifecycleExpect(!genesisSharedTrashList($manager,$sid)[0]['canPurge'],'Manager received permanent delete permission');
 $retention=['retentionDays'=>10,'expectedExpiresAt'=>$items[0]['expiresAt'],'requestId'=>genesisUuid()];
 $retained=genesisSharedRestoreTrash($owner,$sid,'task',$parent['id'],$retention);
 lifecycleExpect(genesisSharedRestoreTrash($owner,$sid,'task',$parent['id'],$retention)===$retained,'Retention retry changed response');
 lifecycleReject(fn()=>genesisSharedRestoreTrash($owner,$sid,'task',$parent['id'],[...$retention,'retentionDays'=>12]),'SHARED_REQUEST_ID_CONFLICT');
 $items=genesisSharedTrashList($owner,$sid);
 $restore=['expectedExpiresAt'=>$items[0]['expiresAt'],'requestId'=>genesisUuid()];$r=genesisSharedRestoreTrash($owner,$sid,'task',$parent['id'],$restore);
 lifecycleExpect(genesisSharedRestoreTrash($owner,$sid,'task',$parent['id'],$restore)===$r,'Restore retry not idempotent');
 lifecycleReject(fn()=>genesisSharedRestoreTrash($owner,$sid,'task',$parent['id'],[...$restore,'expectedExpiresAt'=>'changed']),'SHARED_REQUEST_ID_CONFLICT');
 lifecycleExpect(genesisSharedGetTask($owner,$pid,$child['id'])['parentTaskId']===$parent['id'],'Restored relationship lost');
 $q=$db->prepare('SELECT body FROM shared_comments_read WHERE id=?');$q->execute([$comment]);lifecycleExpect($q->fetchColumn()==='Preserved comment','Comment lost');$q->closeCursor();
 $current=genesisSharedGetTask($owner,$pid,$parent['id']);genesisSharedTrashTask($owner,$pid,$parent['id'],['expectedRevision'=>$current['revision']]);$item=genesisSharedTrashList($owner,$sid)[0];
 $purge=['confirmPermanent'=>true,'expectedExpiresAt'=>$item['expiresAt'],'requestId'=>genesisUuid()];
 lifecycleReject(fn()=>genesisSharedPurgeTask($manager,$sid,$parent['id'],$purge),'SHARED_PROJECT_FORBIDDEN');
 lifecycleReject(fn()=>genesisSharedPurgeTask($owner,$sid,$parent['id'],['confirmPermanent'=>false]),'PERMANENT_DELETE_CONFIRMATION_REQUIRED');
 $purged=genesisSharedPurgeTask($owner,$sid,$parent['id'],$purge);lifecycleExpect($purged['affected']===2,'Purge omitted branch');lifecycleExpect(genesisSharedPurgeTask($owner,$sid,$parent['id'],$purge)===$purged,'Purge retry failed');
 lifecycleReject(fn()=>genesisSharedPurgeTask($owner,$sid,$parent['id'],[...$purge,'expectedExpiresAt'=>'changed']),'SHARED_REQUEST_ID_CONFLICT');
 $q=$db->prepare('SELECT COUNT(*) FROM shared_comments WHERE id=?');$q->execute([$comment]);lifecycleExpect((int)$q->fetchColumn()===0,'Purge left comments');$q->closeCursor();
 lifecycleExpect(genesisSharedTrashList($owner,$sid)===[],'Purge left trash tombstones');
 // A child already in the trash keeps its own deadline when the parent is deleted later.
 $root=genesisSharedTask($owner,$pid,['title'=>'Retention parent','statusId'=>$status]);
 $early=genesisSharedTask($owner,$pid,['title'=>'Independent child','statusId'=>$status,'parentTaskId'=>$root['id']]);
 $grouped=genesisSharedTask($owner,$pid,['title'=>'Grouped child','statusId'=>$status,'parentTaskId'=>$root['id']]);
 $db->prepare("INSERT INTO shared_google_projection_links(task_id,user_id,destination,google_id,synced_at) VALUES(?,?,'calendar',?,?)")->execute([$grouped['id'],$owner,$owner.'-google',genesisNow()]);
 $independent=genesisSharedTrashTask($owner,$pid,$early['id'],['expectedRevision'=>$early['revision'],'retentionDays'=>7]);
 genesisSharedTrashTask($owner,$pid,$root['id'],['expectedRevision'=>$root['revision'],'retentionDays'=>1]);
 $q=$db->prepare('SELECT root_id,expires_at FROM shared_trash WHERE object_id=?');$q->execute([$early['id']]);$saved=$q->fetch();$q->closeCursor();
 lifecycleExpect($saved['root_id']===$early['id']&&$saved['expires_at']===$independent['expiresAt'],'Parent shortened independent retention');
 $db->prepare('DELETE FROM shared_project_members WHERE project_id=? AND user_id=?')->execute([$pid,$manager]);
 lifecycleReject(fn()=>genesisSharedRestoreTrash($manager,$sid,'task',$root['id'],[]),'SHARED_PROJECT_NOT_FOUND');
 lifecycleReject(fn()=>genesisSharedReadTaskAttachment($manager,$root['id'],'missing'),'SHARED_PROJECT_NOT_FOUND');
 genesisSharedMaintenance(genesisSharedTrashExpiry(genesisNow(),2));
 $q=$db->prepare('SELECT parent_task_id FROM shared_tasks WHERE id=?');$q->execute([$early['id']]);$remaining=$q->fetch();$q->closeCursor();
 lifecycleExpect($remaining!==false&&$remaining['parent_task_id']===null,'Expiry deleted an independently retained child');
 $q=$db->prepare('SELECT COUNT(*) FROM shared_google_projection_cleanup WHERE google_id=?');$q->execute([$owner.'-google']);lifecycleExpect((int)$q->fetchColumn()===1,'Expiry duplicated Google cleanup');$q->closeCursor();
 lifecycleExpect(count(genesisSharedTrashList($owner,$sid))===1,'Expiry ignored grouped children or independent root');
 echo "Task lifecycle: archive/restore, subtrees, preserved fields/comments, recoverable legacy delete, retention, ACL, explicit purge and retry receipts passed.\n";
}finally{if($db->inTransaction())$db->rollBack();if($space)$db->prepare('DELETE FROM shared_spaces WHERE id=?')->execute([$space['id']]);foreach([$owner,$manager]as$id){$db->prepare('DELETE FROM shared_google_projection_cleanup WHERE user_id=?')->execute([$id]);$db->prepare('DELETE FROM users WHERE id=?')->execute([$id]);}}
