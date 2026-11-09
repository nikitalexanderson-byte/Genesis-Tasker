<?php
declare(strict_types=1);
require_once __DIR__.'/template-capture.php';

function genesisSharedTemplateLibrary(string $actor,string $spaceId,string $projectId,bool $write=false):array
{
    genesisSharedRequireEnabled($actor);$project=genesisSharedProjectAccess($projectId,$actor,$write?'write':'read',true);
    if($project['space_id']!==$spaceId)throw new GenesisSharedAccessException();return $project;
}

function genesisSharedTemplateAccess(string $actor,string $id,bool $write=false,bool $deleted=false):array
{
    $q=genesisDb()->prepare('SELECT * FROM shared_templates WHERE id=?');$q->execute([$id]);$row=$q->fetch();
    if(!$row||!$deleted&&$row['deleted_at']!==null)throw new GenesisSharedAccessException('TEMPLATE_UNAVAILABLE',404);
    $project=genesisSharedTemplateLibrary($actor,$row['space_id'],$row['project_id'],$write);
    if($write&&$row['owner_id']!==$actor&&!$project['permissions']['manageProjects'])throw new GenesisSharedAccessException('TEMPLATE_FORBIDDEN',403);
    $q=genesisDb()->prepare('SELECT project_id FROM shared_template_sources WHERE template_id=?');$q->execute([$id]);
    foreach($q->fetchAll(PDO::FETCH_COLUMN) as $source){
        try{genesisSharedProjectAccess($source,$actor,'read',true);}catch(GenesisSharedAccessException){throw new GenesisSharedAccessException('TEMPLATE_SOURCE_SCOPE_UNAVAILABLE',403);}
    }
    $row['can_edit']=$project['permissions']['editTasks']&&($row['owner_id']===$actor||$project['permissions']['manageProjects']);
    $row['library_permissions']=$project['permissions'];
    return $row;
}

function genesisSharedTemplateRecord(array $row,bool $content=true):array
{
    $result=['id'=>$row['id'],'spaceId'=>$row['space_id'],'projectId'=>$row['project_id'],'ownerId'=>$row['owner_id'],
        'title'=>genesisSharedContentDecrypt($row['title']),'kind'=>$row['kind'],'revision'=>(int)$row['revision'],
        'deleted'=>$row['deleted_at']!==null,'projectCount'=>(int)$row['project_count'],'taskCount'=>(int)$row['task_count'],'updatedAt'=>$row['updated_at'],'system'=>false,'canEdit'=>(bool)($row['can_edit']??false)];
    if($content){$result['manifest']=genesisTemplateManifest(json_decode(genesisSharedContentDecrypt($row['manifest_json']),true,256,JSON_THROW_ON_ERROR));
        $result['notices']=json_decode(genesisSharedContentDecrypt($row['source_notices_json']),true,128,JSON_THROW_ON_ERROR);$result['libraryPermissions']=$row['library_permissions']??null;}
    return $result;
}

function genesisSharedTemplateOperation(string $actor,string $operation,string $kind,string $hash):?array
{
    if(!preg_match('/^[a-zA-Z0-9:_-]{1,100}$/D',$operation))throw new InvalidArgumentException('TEMPLATE_OPERATION_REQUIRED');
    $q=genesisDb()->prepare('SELECT * FROM shared_template_operations WHERE actor_id=? AND operation_id=?');$q->execute([$actor,$operation]);$row=$q->fetch();
    if(!$row)return null;
    if($row['kind']!==$kind||!hash_equals($row['request_hash'],$hash))throw new GenesisSharedAccessException('TEMPLATE_OPERATION_REUSED',409);
    return json_decode(genesisSharedContentDecrypt($row['result_json']),true,128,JSON_THROW_ON_ERROR);
}
function genesisSharedTemplateReceipt(string $actor,string $operation,string $kind,string $hash,array $result):void
{
    genesisDb()->prepare('INSERT INTO shared_template_operations VALUES(?,?,?,?,?,?)')->execute([$actor,$operation,$kind,$hash,genesisSharedContentEncrypt(json_encode($result,JSON_THROW_ON_ERROR)),genesisNow()]);
}

/** Creation and editing store independent snapshots; created tasks never retain a live reference to this content. */
function genesisSharedSaveTemplate(string $actor,string $spaceId,string $projectId,array $input,?string $id=null):array
{
    if(array_diff(array_keys($input),['operationId','title','manifest','expectedRevision','deleted','sourceTaskId','capture','sourceProjectId','cloneTemplateId'])||!is_string($input['operationId']??null))throw new InvalidArgumentException('TEMPLATE_INVALID');
    $operation=$input['operationId'];$hash=hash('sha256',json_encode([$spaceId,$projectId,$id,$input],JSON_THROW_ON_ERROR));$db=genesisDb();$owns=!$db->inTransaction();if($owns)genesisBeginWriteTransaction($db);
    try{
        genesisSharedTemplateLibrary($actor,$spaceId,$projectId,true);
        $old=$id===null?null:genesisSharedTemplateAccess($actor,$id,true,true);
        if($old&&($old['space_id']!==$spaceId||$old['project_id']!==$projectId))throw new GenesisSharedAccessException();
        $replay=genesisSharedTemplateOperation($actor,$operation,'template.save',$hash);
        if($replay!==null){if($owns)$db->commit();return $replay;}
        if($old&&($input['expectedRevision']??null)!==(int)$old['revision'])throw new GenesisSharedAccessException('TEMPLATE_CONFLICT',409);
        $sources=[];$notices=$old?json_decode(genesisSharedContentDecrypt($old['source_notices_json']),true,128,JSON_THROW_ON_ERROR):[];
        if(isset($input['cloneTemplateId'])){
            if($old||isset($input['capture'])||!is_string($input['cloneTemplateId']))throw new InvalidArgumentException('TEMPLATE_INVALID');
            if(!str_starts_with($input['cloneTemplateId'],'system:')){
                $original=genesisSharedTemplateAccess($actor,$input['cloneTemplateId']);if($original['space_id']!==$spaceId)throw new GenesisSharedAccessException();
                $q=$db->prepare('SELECT project_id FROM shared_template_sources WHERE template_id=?');$q->execute([$original['id']]);$sources=$q->fetchAll(PDO::FETCH_COLUMN);
                $notices=json_decode(genesisSharedContentDecrypt($original['source_notices_json']),true,128,JSON_THROW_ON_ERROR);
            }elseif(!in_array($input['cloneTemplateId'],['system:event','system:publication','system:launch','system:control'],true))throw new InvalidArgumentException('TEMPLATE_INVALID');
        }
        if(array_key_exists('capture',$input)){
            if($old||isset($input['manifest'])||!is_array($input['capture'])||!is_string($input['sourceProjectId']??null))throw new InvalidArgumentException('TEMPLATE_INVALID');
            $taskId=$input['sourceTaskId']??null;if($taskId!==null&&!is_string($taskId))throw new InvalidArgumentException('TEMPLATE_INVALID');
            $captured=genesisSharedTemplateCapture($actor,$input['sourceProjectId'],$taskId,$input['capture']);
            if($captured['sourceSpaceId']!==$spaceId)throw new GenesisSharedAccessException('TEMPLATE_SOURCE_SCOPE_UNAVAILABLE',403);
            $manifest=$captured['manifest'];$sources=$captured['sourceProjectIds'];$notices=$captured['notices'];
        }else{
            if(isset($input['sourceTaskId'])||isset($input['sourceProjectId']))throw new InvalidArgumentException('TEMPLATE_INVALID');
            $previous=$old?json_decode(genesisSharedContentDecrypt($old['manifest_json']),true,256,JSON_THROW_ON_ERROR):null;
            $draft=$input['manifest']??$previous;
            if($old&&is_array($draft)&&is_array($draft['tasks']??null)){$before=array_column($previous['tasks'],null,'key');foreach($draft['tasks'] as &$task)if(is_array($task)&&is_string($task['key']??null))foreach(['storyPoints','estimateHours'] as $field)if(!array_key_exists($field,$task)&&array_key_exists($field,$before[$task['key']]??[]))$task[$field]=$before[$task['key']][$field];unset($task);}
            $manifest=genesisTemplateManifest($draft);
        }
        $title=genesisSharedTitle($input['title']??null,160);$deleted=$input['deleted']??false;if(!is_bool($deleted))throw new InvalidArgumentException('TEMPLATE_INVALID');
        $plain=json_encode($manifest,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);if(strlen($plain)>5_000_000)throw new GenesisResourceLimitException(413,'TEMPLATE_SIZE_LIMIT');
        $now=genesisNow();$id=$old['id']??genesisUuid();
        if(!$old){
            $q=$db->prepare('SELECT COUNT(*) FROM shared_templates WHERE space_id=? AND deleted_at IS NULL');$q->execute([$spaceId]);if((int)$q->fetchColumn()>=500)throw new GenesisResourceLimitException(409,'TEMPLATE_LIMIT');
            $db->prepare('INSERT INTO shared_templates(id,space_id,project_id,owner_id,title,kind,manifest_json,source_notices_json,project_count,task_count,deleted_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
                ->execute([$id,$spaceId,$projectId,$actor,genesisSharedContentEncrypt($title),$manifest['kind'],genesisSharedContentEncrypt($plain),genesisSharedContentEncrypt(json_encode($notices,JSON_THROW_ON_ERROR)),count($manifest['projects']),count($manifest['tasks']),$deleted?$now:null,$now,$now]);
            foreach($sources as $source)$db->prepare('INSERT INTO shared_template_sources VALUES(?,?)')->execute([$id,$source]);
        }else{
            if($old['deleted_at']!==null&&!$deleted){$q=$db->prepare('SELECT COUNT(*) FROM shared_templates WHERE space_id=? AND deleted_at IS NULL');$q->execute([$spaceId]);if((int)$q->fetchColumn()>=500)throw new GenesisResourceLimitException(409,'TEMPLATE_LIMIT');}
            $db->prepare('UPDATE shared_templates SET title=?,kind=?,manifest_json=?,project_count=?,task_count=?,revision=revision+1,deleted_at=?,updated_at=? WHERE id=?')
                ->execute([genesisSharedContentEncrypt($title),$manifest['kind'],genesisSharedContentEncrypt($plain),count($manifest['projects']),count($manifest['tasks']),$deleted?$now:null,$now,$id]);
        }
        $result=['id'=>$id,'revision'=>$old?(int)$old['revision']+1:1,'deleted'=>$deleted];
        genesisSharedTemplateReceipt($actor,$operation,'template.save',$hash,$result);
        genesisSharedAudit($projectId,$actor,$deleted?'template.deleted':($old?($old['deleted_at']!==null?'template.restored':'template.updated'):'template.created'),$id,['objectTitle'=>$title]);
        if($owns)$db->commit();return $result;
    }catch(Throwable $error){if($owns&&$db->inTransaction())$db->rollBack();throw $error;}
}

function genesisSharedTemplates(string $actor,string $spaceId,?string $projectId=null,bool $deleted=false,?string $cursor=null):array
{
    genesisSharedRequireEnabled($actor);genesisSharedSpaceAccess($spaceId,$actor);
    if($projectId!==null)genesisSharedTemplateLibrary($actor,$spaceId,$projectId);
    $db=genesisDb();$owns=!$db->inTransaction();if($owns)$db->beginTransaction();
    try{
        $sql=" FROM shared_templates t JOIN shared_projects p ON p.id=t.project_id JOIN shared_project_members m ON m.project_id=p.id AND m.user_id=?
            JOIN shared_space_members sm ON sm.space_id=p.space_id AND sm.user_id=m.user_id WHERE t.space_id=? AND t.deleted_at IS ".($deleted?'NOT ':'')."NULL
            AND NOT EXISTS(SELECT 1 FROM shared_trash tr WHERE tr.kind='project' AND tr.object_id=p.id)
            AND NOT EXISTS(SELECT 1 FROM shared_template_sources s WHERE s.template_id=t.id AND NOT EXISTS(
                SELECT 1 FROM shared_projects sp JOIN shared_project_members pm ON pm.project_id=sp.id AND pm.user_id=m.user_id
                JOIN shared_space_members ssm ON ssm.space_id=sp.space_id AND ssm.user_id=pm.user_id WHERE sp.id=s.project_id
                AND NOT EXISTS(SELECT 1 FROM shared_trash tr WHERE tr.kind='project' AND tr.object_id=sp.id)))";
        $values=[$actor,$spaceId];if($projectId!==null){$sql.=' AND t.project_id=?';$values[]=$projectId;}
        $q=$db->prepare('SELECT t.id,t.revision'.$sql.' ORDER BY t.id');$q->execute($values);$visible=$q->fetchAll();$fingerprint=hash('sha256',json_encode($visible,JSON_THROW_ON_ERROR));$total=count($visible);
        if($cursor!==null&&$cursor!==''){
            $state=strlen($cursor)<16000?json_decode(genesisDecrypt($cursor)??'',true):null;
            if(!is_array($state)||!isset($state['fingerprint'],$state['updatedAt'],$state['id']))throw new InvalidArgumentException('TEMPLATE_PAGE_INVALID');
            if(!hash_equals($fingerprint,$state['fingerprint']))throw new GenesisSharedAccessException('TEMPLATE_LIST_CHANGED',409);
            $sql.=' AND (t.updated_at<? OR (t.updated_at=? AND t.id>?))';array_push($values,$state['updatedAt'],$state['updatedAt'],$state['id']);
        }
        $q=$db->prepare('SELECT t.id,t.space_id,t.project_id,t.owner_id,t.title,t.kind,t.revision,t.deleted_at,t.updated_at,t.project_count,t.task_count'.$sql.' ORDER BY t.updated_at DESC,t.id LIMIT 51');$q->execute($values);$rows=$q->fetchAll();$hasMore=count($rows)>50;if($hasMore)array_pop($rows);$last=$rows?end($rows):null;
        $nextCursor=$hasMore?genesisEncrypt(json_encode(['fingerprint'=>$fingerprint,'updatedAt'=>$last['updated_at'],'id'=>$last['id']],JSON_THROW_ON_ERROR)):null;
        $templates=array_map(static fn($row)=>genesisSharedTemplateRecord($row,false),$rows);if($owns)$db->commit();return compact('templates','total','hasMore','nextCursor');
    }catch(Throwable $error){if($owns&&$db->inTransaction())$db->rollBack();throw $error;}
}
