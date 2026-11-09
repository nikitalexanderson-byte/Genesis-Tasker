<?php
declare(strict_types=1);
function genesisSharedReviewRoot(array $project):array {
 $seen=[];
 while($project['parent_id']!==null){if(isset($seen[$project['id']]))throw new RuntimeException('Project hierarchy cycle');$seen[$project['id']]=true;
  $q=genesisDb()->prepare('SELECT * FROM shared_projects WHERE id=? AND space_id=?');$q->execute([$project['parent_id'],$project['space_id']]);$parent=$q->fetch();if(!$parent)break;$project=$parent;}
 return $project;
}
function genesisSharedReviewPolicy(string $rootId):array {
 $q=genesisDb()->prepare('SELECT * FROM shared_project_review_policies WHERE project_id=?');$q->execute([$rootId]);$row=$q->fetch();
 $defaults=['enabled'=>false,'checked'=>['group'=>'editors','userIds'=>[]],'confirmed'=>['group'=>'organizers','userIds'=>[]],'deletable'=>['group'=>'organizers','userIds'=>[]]];
 return ['revision'=>(int)($row['revision']??0),'policy'=>$row?json_decode($row['policy_json'],true,16,JSON_THROW_ON_ERROR):$defaults];
}
function genesisSharedReviewSettings(string $userId,string $projectId,?array $input=null):array {
 genesisSharedRequireEnabled($userId);$project=genesisSharedProjectAccess($projectId,$userId);$root=genesisSharedReviewRoot($project);
 $canManage=false;try{genesisSharedProjectAccess($root['id'],$userId,'manage');$canManage=true;}catch(GenesisSharedAccessException){}
 $q=genesisDb()->prepare('SELECT m.user_id AS userId,u.display_name AS displayName FROM shared_project_members m JOIN users u ON u.id=m.user_id JOIN shared_space_members sm ON sm.space_id=? AND sm.user_id=m.user_id WHERE m.project_id=?');$q->execute([$root['space_id'],$root['id']]);$members=$q->fetchAll();
 if($input!==null){
  if(!$canManage)throw new GenesisSharedAccessException('SHARED_PROJECT_FORBIDDEN',403);
  if(!is_int($input['expectedRevision']??null)||!is_array($input['policy']??null)||!is_bool($input['policy']['enabled']??null))throw new InvalidArgumentException('INVALID_REVIEW_POLICY');
  $policy=['enabled'=>$input['policy']['enabled']];$ids=array_column($members,'userId');
  foreach(['checked','confirmed','deletable'] as $kind){$rule=$input['policy'][$kind]??null;
   if(!is_array($rule)||!in_array($rule['group']??'', ['everyone','editors','organizers','selected'],true)||!is_array($rule['userIds']??null)||!array_is_list($rule['userIds'])||count($rule['userIds'])>100)throw new InvalidArgumentException('INVALID_REVIEW_POLICY');
   foreach($rule['userIds'] as $id)if(!is_string($id)||!in_array($id,$ids,true))throw new InvalidArgumentException('INVALID_REVIEW_PARTICIPANT');
   $policy[$kind]=['group'=>$rule['group'],'userIds'=>array_values(array_unique($rule['userIds']))];
  }
  $db=genesisDb();genesisBeginWriteTransaction($db);try{genesisSharedProjectAccess($root['id'],$userId,'manage');$current=genesisSharedReviewPolicy($root['id']);
   if($current['revision']!==$input['expectedRevision'])throw new GenesisSharedAccessException('SHARED_PROJECT_CONFLICT',409);
   $db->prepare('INSERT INTO shared_project_review_policies VALUES(?,?,?) ON CONFLICT(project_id) DO UPDATE SET revision=excluded.revision,policy_json=excluded.policy_json')->execute([$root['id'],$current['revision']+1,json_encode($policy,JSON_THROW_ON_ERROR)]);
   $db->commit();
  }catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
 }
 return ['rootProjectId'=>$root['id'],'rootTitle'=>$root['title'],'canManage'=>$canManage,'members'=>$members]+genesisSharedReviewPolicy($root['id']);
}
function genesisSharedReviewAllowed(array $rule,array $project,string $userId):bool {
 return match($rule['group']){'everyone'=>true,'editors'=>$project['permissions']['editTasks'],'organizers'=>$project['permissions']['organizeTasks']||$project['permissions']['manageProjects'],'selected'=>in_array($userId,$rule['userIds'],true),default=>false};
}
function genesisSharedReviewIndex(string $userId,array $project,?array $taskIds=null):array {
 $root=genesisSharedReviewRoot($project);$policy=genesisSharedReviewPolicy($root['id'])['policy'];
 $allowed=[];foreach(['checked','confirmed','deletable'] as $kind)$allowed[$kind]=$policy['enabled']&&genesisSharedReviewAllowed($policy[$kind],$project,$userId);
 $filter=$taskIds===null?'':' AND t.id IN ('.implode(',',array_fill(0,count($taskIds),'?')).')';
 $q=genesisDb()->prepare('SELECT r.task_id AS taskId,r.user_id AS userId,r.kind,u.display_name AS displayName,r.reviewed_at AS reviewedAt FROM shared_task_reviews r JOIN shared_tasks t ON t.id=r.task_id AND t.revision=r.task_revision JOIN users u ON u.id=r.user_id WHERE t.project_id=?'.$filter);$q->execute([$project['id'],...($taskIds??[])]);$index=[];
 foreach($q->fetchAll() as $row)$index[$row['taskId']][]=$row;
 return ['enabled'=>$policy['enabled'],'allowed'=>$allowed,'entries'=>$index];
}
function genesisSharedReviewTask(string $userId,string $projectId,string $taskId,array $input):array {
 genesisSharedRequireEnabled($userId);
 if(!in_array($input['kind']??'', ['checked','confirmed','deletable'],true)||!is_bool($input['enabled']??null)||!is_int($input['expectedRevision']??null))throw new InvalidArgumentException('INVALID_TASK_REVIEW');
 $db=genesisDb();genesisBeginWriteTransaction($db);try{
  $project=genesisSharedProjectAccess($projectId,$userId);$root=genesisSharedReviewRoot($project);$policy=genesisSharedReviewPolicy($root['id'])['policy'];
  if(!$policy['enabled']||!genesisSharedReviewAllowed($policy[$input['kind']],$project,$userId))throw new GenesisSharedAccessException('SHARED_PROJECT_FORBIDDEN',403);
  $q=$db->prepare('SELECT t.revision,t.completed_at,s.is_done FROM shared_tasks_read t JOIN shared_project_statuses s ON s.id=t.status_id WHERE t.id=? AND t.project_id=?');$q->execute([$taskId,$projectId]);$task=$q->fetch();
  if(!$task)throw new GenesisSharedAccessException();
  if((int)$task['revision']!==$input['expectedRevision'])throw new GenesisSharedAccessException('SHARED_TASK_CONFLICT',409);
  if(!$task['is_done']||!$task['completed_at'])throw new GenesisSharedAccessException('TASK_NOT_COMPLETED',409);
  if($input['enabled'])$db->prepare('INSERT INTO shared_task_reviews VALUES(?,?,?,?,?) ON CONFLICT(task_id,user_id,kind) DO UPDATE SET task_revision=excluded.task_revision,reviewed_at=excluded.reviewed_at')->execute([$taskId,$userId,$input['kind'],$task['revision'],genesisNow()]);
  else $db->prepare('DELETE FROM shared_task_reviews WHERE task_id=? AND user_id=? AND kind=?')->execute([$taskId,$userId,$input['kind']]);
  $db->commit();return ['ok'=>true];
 }catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
}
