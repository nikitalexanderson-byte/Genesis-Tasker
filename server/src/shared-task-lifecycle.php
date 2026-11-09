<?php
declare(strict_types=1);

/** Relationships remain within a project; a branch is archived/restored together. */
function genesisSharedTaskBranch(PDO $db,string $projectId,string $taskId):array {
 $q=$db->prepare('WITH RECURSIVE branch AS (SELECT id FROM shared_tasks WHERE id=? AND project_id=? UNION SELECT t.id FROM branch b CROSS JOIN shared_tasks t ON t.parent_task_id=b.id WHERE t.project_id=?) SELECT t.id,t.archived_at FROM branch b CROSS JOIN shared_tasks t ON b.id=t.id');
 $q->execute([$taskId,$projectId,$projectId]);return $q->fetchAll();
}
function genesisSharedArchiveTask(string $userId,string $projectId,string $taskId,array $input):array {
 if(!is_bool($input['archived']??null)||!is_int($input['expectedRevision']??null))throw new InvalidArgumentException('INVALID_TASK_REVISION');
 $db=genesisDb();$ownsTransaction=!$db->inTransaction();if($ownsTransaction)genesisBeginWriteTransaction($db);try {
  genesisSharedProjectAccess($projectId,$userId,'organize');
  $requestId=genesisSharedRequestId($input);$action=$input['archived']?'task.archive':'task.unarchive';
  $payloadHash=genesisSharedMutationPayloadHash($action,$input,['projectId'=>$projectId]);
  $receipt=genesisSharedMutationReceipt($db,$userId,$requestId,$action,$taskId, $payloadHash);
  if($receipt!==null){if($ownsTransaction)$db->commit();return $receipt;}
  $q=$db->prepare('SELECT * FROM shared_tasks_history_read WHERE id=? AND project_id=?');$q->execute([$taskId,$projectId]);$task=$q->fetch();
  if(!$task)throw new GenesisSharedAccessException();
  if((int)$task['revision']!==$input['expectedRevision'])throw new GenesisSharedAccessException('SHARED_TASK_CONFLICT',409);
  $archived=$input['archived'];$affected=0;$now=genesisNow();
  if($archived && $task['archived_at']===null) {
   foreach(genesisSharedTaskBranch($db,$projectId,$taskId) as $row){
    $q=$db->prepare("UPDATE shared_tasks SET archived_at=?,archive_root_id=?,revision=revision+1,updated_at=?,updated_by=? WHERE id=? AND archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM shared_trash tr WHERE tr.kind='task' AND tr.object_id=shared_tasks.id)");
    $q->execute([$now,$taskId,$now,$userId,$row['id']]);
    if($q->rowCount()){$affected++;genesisSharedTrashGoogleCleanup($db,$row['id']);genesisSharedAudit($projectId,$userId,'task.archived',$row['id'],['rootId'=>$taskId]);}
   }
  } elseif(!$archived && $task['archived_at']!==null) {
   if($task['archive_root_id']!==null && $task['archive_root_id']!==$taskId)throw new GenesisSharedAccessException('RESTORE_PARENT_FIRST',409);
   if($task['parent_task_id']!==null){
    $q=$db->prepare('SELECT completed_at FROM shared_tasks_read WHERE id=? AND project_id=?');$q->execute([$task['parent_task_id'],$projectId]);$parent=$q->fetch();
    if(!$parent)throw new GenesisSharedAccessException('RESTORE_PARENT_FIRST',409);
    if($parent['completed_at']!==null && $task['completed_at']===null)throw new GenesisSharedAccessException('TASK_PARENT_COMPLETED',409);
   }
   $q=$db->prepare('SELECT id FROM shared_tasks_history_read WHERE project_id=? AND (id=? OR archive_root_id=?) AND archived_at IS NOT NULL');$q->execute([$projectId,$taskId,$taskId]);
   foreach($q->fetchAll() as $row){
    $db->prepare('UPDATE shared_tasks SET archived_at=NULL,archive_root_id=NULL,revision=revision+1,updated_at=?,updated_by=? WHERE id=?')->execute([$now,$userId,$row['id']]);
    genesisWorkflowTask($userId,$projectId,$row['id'],null,true);
    genesisSharedAudit($projectId,$userId,'task.unarchived',$row['id'],['rootId'=>$taskId]);$affected++;
   }
  }
  $q=$db->prepare('SELECT revision FROM shared_tasks WHERE id=?');$q->execute([$taskId]);
  $result=['ok'=>true,'id'=>$taskId,'projectId'=>$projectId,'revision'=>(int)$q->fetchColumn(),'affected'=>$affected,'archived'=>$archived];
  genesisSharedSaveMutationReceipt($db,$userId,$requestId,$action,$taskId,$result, $payloadHash);if($ownsTransaction)$db->commit();return $result;
 }catch(Throwable $error){if($ownsTransaction&&$db->inTransaction())$db->rollBack();throw $error;}
}
function genesisSharedCanPurgeTasks(array $project):bool {
 return in_array($project['space_member_role'],['owner','admin'],true) && $project['permissions']['manageProjects'];
}
/** Only an explicit, current trash entry can be irreversibly removed by an owner/admin. */
function genesisSharedPurgeTask(string $userId,string $spaceId,string $taskId,array $input):array {
 if(($input['confirmPermanent']??null)!==true)throw new InvalidArgumentException('PERMANENT_DELETE_CONFIRMATION_REQUIRED');
 $db=genesisDb();genesisBeginWriteTransaction($db);try {
  genesisSharedSpaceAccess($spaceId,$userId);$requestId=genesisSharedRequestId($input);
  $payloadHash=genesisSharedMutationPayloadHash('task.purge',$input,['spaceId'=>$spaceId]);
  $receipt=genesisSharedMutationReceipt($db,$userId,$requestId,'task.purge',$taskId, $payloadHash);
  if($receipt!==null){$p=genesisSharedTrashProjectAccess($userId,$receipt['projectId'],'manageProjects');if(!genesisSharedCanPurgeTasks($p))throw new GenesisSharedAccessException('SHARED_PROJECT_FORBIDDEN',403);$db->commit();return $receipt;}
  $q=$db->prepare("SELECT * FROM shared_trash WHERE kind='task' AND object_id=? AND space_id=? AND root_id=object_id");$q->execute([$taskId,$spaceId]);$row=$q->fetch();if(!$row)throw new GenesisSharedAccessException();
  $project=genesisSharedTrashProjectAccess($userId,$row['project_id'],'manageProjects');
  if(!genesisSharedCanPurgeTasks($project))throw new GenesisSharedAccessException('SHARED_PROJECT_FORBIDDEN',403);
  if(($input['expectedExpiresAt']??null)!==$row['expires_at'])throw new GenesisSharedAccessException('SHARED_TASK_CONFLICT',409);
  $q=$db->prepare("SELECT object_id FROM shared_trash WHERE kind='task' AND root_id=? AND project_id=? AND space_id=?");$q->execute([$taskId,$row['project_id'],$spaceId]);$ids=array_column($q->fetchAll(),'object_id');
  foreach($ids as $id){genesisSharedTrashGoogleCleanup($db,$id);genesisSharedDetachDependencies($row['project_id'],$id,$userId);$db->prepare('DELETE FROM shared_tasks WHERE id=?')->execute([$id]);}
  $db->prepare("DELETE FROM shared_trash WHERE kind='task' AND root_id=? AND space_id=?")->execute([$taskId,$spaceId]);
  genesisSharedAudit($row['project_id'],$userId,'task.purged',$taskId,['count'=>count($ids)]);
  $result=['ok'=>true,'id'=>$taskId,'projectId'=>$row['project_id'],'affected'=>count($ids)];genesisSharedSaveMutationReceipt($db,$userId,$requestId,'task.purge',$taskId,$result, $payloadHash);
  $db->commit();return $result;
 }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}
