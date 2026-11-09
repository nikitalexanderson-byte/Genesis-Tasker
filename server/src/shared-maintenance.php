<?php
declare(strict_types=1);
/** Existing cron only; exact relational objects, no filesystem traversal or production DB restoration. */
function genesisSharedMaintenance(?string $at=null):array {
 $at??=genesisNow();if(strtotime($at)===false)throw new InvalidArgumentException('INVALID_MAINTENANCE_TIME');
 $db=genesisDb();$db->exec('PRAGMA secure_delete = ON');genesisBeginWriteTransaction($db);
 $counts=['expiredTasks'=>0,'expiredProjects'=>0,'prunedFiles'=>0,'prunedMapImages'=>0];
 try {
  $q=$db->prepare("SELECT object_id FROM shared_trash WHERE kind='project' AND julianday(expires_at)<=julianday(?)");$q->execute([$at]);$roots=array_column($q->fetchAll(),'object_id');
  foreach($roots as $root){
   $q=$db->prepare('WITH RECURSIVE branch(id) AS (SELECT id FROM shared_projects WHERE id=? UNION SELECT p.id FROM shared_projects p JOIN branch b ON p.parent_id=b.id) SELECT id FROM branch');$q->execute([$root]);$ids=array_column($q->fetchAll(),'id');
   foreach($ids as $id){$q=$db->prepare('SELECT id FROM shared_tasks WHERE project_id=?');$q->execute([$id]);foreach($q->fetchAll() as $task)genesisSharedTrashGoogleCleanup($db,$task['id']);}
   foreach($ids as $id)foreach(['shared_mindmaps','shared_mindmap_versions'] as $table){$q=$db->prepare('SELECT * FROM '.$table.' WHERE project_id=?');$q->execute([$id]);foreach($q->fetchAll() as $row)genesisSharedPruneMapFiles($db,$table,$row,$at,true,$counts);}
   foreach(array_reverse($ids) as $id){$db->prepare("DELETE FROM shared_trash WHERE (kind='project' AND object_id=?) OR project_id=?")->execute([$id,$id]);$q=$db->prepare('DELETE FROM shared_projects WHERE id=?');$q->execute([$id]);$counts['expiredProjects']+=$q->rowCount();}
  }
  $q=$db->prepare("SELECT tr.object_id FROM shared_trash tr JOIN shared_tasks t ON t.id=tr.object_id WHERE tr.kind='task' AND julianday(tr.expires_at)<=julianday(?)");$q->execute([$at]);
  foreach($q->fetchAll() as $row){genesisSharedTrashGoogleCleanup($db,$row['object_id']);$q=$db->prepare('DELETE FROM shared_tasks WHERE id=?');$q->execute([$row['object_id']]);$counts['expiredTasks']+=$q->rowCount();$db->prepare("DELETE FROM shared_trash WHERE kind='task' AND object_id=?")->execute([$row['object_id']]);}
  $closed="SELECT id FROM shared_projects WHERE is_inbox=0 AND archived_at IS NOT NULL AND julianday(archived_at)<=julianday(?,'-30 days')";
  foreach(['shared_task_attachments','shared_task_images'] as $table){$q=$db->prepare('DELETE FROM '.$table.' WHERE task_id IN (SELECT id FROM shared_tasks WHERE project_id IN ('.$closed.'))');$q->execute([$at]);$counts['prunedFiles']+=$q->rowCount();}
  $q=$db->prepare("UPDATE shared_project_statuses SET image_url='',revision=revision+1 WHERE image_url LIKE 'data:image/%' AND project_id IN (".$closed.')');$q->execute([$at]);$counts['prunedFiles']+=$q->rowCount();

  // Indexed project ownership limits the scan to expired projects, including old snapshots.
  foreach(['shared_mindmaps','shared_mindmap_versions'] as $table){$q=$db->prepare('SELECT * FROM '.$table.' WHERE project_id IN ('.$closed.')');$q->execute([$at]);foreach($q->fetchAll() as $row)genesisSharedPruneMapFiles($db,$table,$row,$at,false,$counts);}
  $db->exec("DELETE FROM shared_trash WHERE (kind='task' AND NOT EXISTS(SELECT 1 FROM shared_tasks t WHERE t.id=shared_trash.object_id)) OR (kind='project' AND NOT EXISTS(SELECT 1 FROM shared_projects p WHERE p.id=shared_trash.object_id))");
  $db->commit();return $counts;
 }catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
}

function genesisSharedPruneMapFiles(PDO $db,string $table,array $row,string $at,bool $detach,array &$counts):void {
 $doc=json_decode(genesisSharedContentDecrypt($row['content']),true,64,JSON_THROW_ON_ERROR);$changed=$detach;
 if($detach)$doc['projectId']=null;
 foreach($doc['nodes'] as &$node)if(isset($node['presentation']['image'])){unset($node['presentation']['image']);$changed=true;$counts['prunedMapImages']++;}unset($node);if(!$changed)return;
 $content=genesisSharedContentEncrypt(json_encode($doc,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR));$projectId=$detach?null:$row['project_id'];
 if($table==='shared_mindmaps'){$revision=(int)$row['revision']+1;$db->prepare('UPDATE shared_mindmaps SET content=?,revision=?,updated_at=?,project_id=? WHERE space_id=? AND id=?')->execute([$content,$revision,$at,$projectId,$row['space_id'],$row['id']]);$db->prepare('INSERT INTO shared_mindmap_versions(space_id,map_id,revision,content,updated_at,project_id) VALUES(?,?,?,?,?,?)')->execute([$row['space_id'],$row['id'],$revision,$content,$at,$projectId]);$db->prepare('DELETE FROM shared_mindmap_versions WHERE space_id=? AND map_id=? AND revision<=?')->execute([$row['space_id'],$row['id'],$revision-20]);}
 else $db->prepare('UPDATE shared_mindmap_versions SET content=?,project_id=? WHERE space_id=? AND map_id=? AND revision=?')->execute([$content,$projectId,$row['space_id'],$row['map_id'],$row['revision']]);
}
