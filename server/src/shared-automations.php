<?php
declare(strict_types=1);
require_once __DIR__.'/automation-definition.php';

function genesisAutomationEncode(array $value):string { return genesisSharedContentEncrypt(json_encode($value,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR)); }
function genesisAutomationDecode(string $value):array { return json_decode(genesisSharedContentDecrypt($value),true,128,JSON_THROW_ON_ERROR); }
function genesisAutomationRule(string $actor,string $projectId,string $id,bool $write=false):array
{
    genesisSharedRequireEnabled($actor);$project=genesisSharedProjectAccess($projectId,$actor,$write?'write':'read');
    $q=genesisDb()->prepare('SELECT * FROM shared_automation_rules WHERE id=? AND project_id=?');$q->execute([$id,$projectId]);$row=$q->fetch();
    if(!$row)throw new GenesisSharedAccessException();
    $row['can_manage']=$project['permissions']['manageProjects']||$project['permissions']['editTasks']&&$row['owner_id']===$actor;$row['viewer_id']=$actor;
    if($write&&!$row['can_manage'])throw new GenesisSharedAccessException('SHARED_PROJECT_FORBIDDEN',403);
    return $row;
}
function genesisAutomationVisibleDefinition(string $actor,array $definition):array
{
    foreach($definition['actions'] as &$action)if($action['type']==='createTemplate'){
        try{genesisSharedTemplateSource($actor,$action['templateId'],'ru');}
        catch(GenesisSharedAccessException|InvalidArgumentException){$action=['type'=>'createTemplate','templateId'=>'','options'=>[],'unavailable'=>true];}
    }unset($action);return $definition;
}
function genesisAutomationRecord(array $row,bool $content=true):array
{
    $record=['id'=>$row['id'],'projectId'=>$row['project_id'],'ownerId'=>$row['owner_id'],'title'=>genesisSharedContentDecrypt($row['title']),
        'enabled'=>(bool)$row['enabled'],'revision'=>(int)$row['revision'],'deleted'=>$row['deleted_at']!==null,
        'canManage'=>(bool)($row['can_manage']??false),'createdAt'=>$row['created_at'],'updatedAt'=>$row['updated_at']];
    if($content)$record['definition']=genesisAutomationVisibleDefinition($row['viewer_id'],genesisAutomationDecode($row['definition_json']));
    return $record;
}
function genesisAutomationOperation(string $actor,string $id,string $hash):?array
{
    if(!preg_match('/^[a-zA-Z0-9:_-]{1,100}$/D',$id))throw new InvalidArgumentException('AUTOMATION_OPERATION_REQUIRED');
    $q=genesisDb()->prepare('SELECT * FROM shared_automation_operations WHERE actor_id=? AND operation_id=?');$q->execute([$actor,$id]);$row=$q->fetch();
    if(!$row)return null;if(!hash_equals($row['request_hash'],$hash))throw new GenesisSharedAccessException('AUTOMATION_OPERATION_REUSED',409);
    return genesisAutomationDecode($row['result_json']);
}
function genesisAutomationReceipt(string $actor,string $id,string $hash,array $result):void
{
    genesisDb()->prepare('INSERT INTO shared_automation_operations VALUES(?,?,?,?,?)')->execute([$actor,$id,$hash,genesisAutomationEncode($result),genesisNow()]);
}

function genesisSharedAutomations(string $actor,string $projectId,bool $deleted=false,?string $cursor=null):array
{
    genesisSharedRequireEnabled($actor);$project=genesisSharedProjectAccess($projectId,$actor);$values=[$projectId];$after='';
    if($cursor!==null){$cursor=genesisTemplateKey($cursor);$after=' AND id>?';$values[]=$cursor;}
    $q=genesisDb()->prepare('SELECT * FROM shared_automation_rules WHERE project_id=? AND deleted_at IS '.($deleted?'NOT NULL':'NULL').$after.' ORDER BY id LIMIT 51');$q->execute($values);$rows=$q->fetchAll();
    $records=[];foreach(array_slice($rows,0,50) as $row){$row['can_manage']=$project['permissions']['manageProjects']||$project['permissions']['editTasks']&&$row['owner_id']===$actor;$records[]=genesisAutomationRecord($row,false);}
    return ['rules'=>$records,'nextCursor'=>count($rows)>50?$rows[49]['id']:null,
        'canCreate'=>(bool)$project['permissions']['editTasks'],'workerCompletedAt'=>genesisDb()->query('SELECT completed_at FROM background_worker_state WHERE id=1')->fetchColumn()?:null];
}

function genesisSharedSaveAutomation(string $actor,string $projectId,array $input,?string $id=null):array
{
    genesisAutomationKeys($input,['operationId','expectedRevision','title','ownerId','enabled','deleted','definition']);
    if(!is_string($input['operationId']??null))genesisAutomationInvalid();$operation=$input['operationId'];$hash=hash('sha256',json_encode([$projectId,$id,$input],JSON_THROW_ON_ERROR));
    $db=genesisDb();$owns=!$db->inTransaction();if($owns)genesisBeginWriteTransaction($db);
    try{
        genesisSharedRequireEnabled($actor);$project=genesisSharedProjectAccess($projectId,$actor,'write');
        $old=$id===null?null:genesisAutomationRule($actor,$projectId,$id,true);
        $replay=genesisAutomationOperation($actor,$operation,$hash);if($replay!==null){$replay['definition']=genesisAutomationVisibleDefinition($actor,$replay['definition']);if($owns)$db->commit();return $replay;}
        if($old&&($input['expectedRevision']??null)!==(int)$old['revision'])throw new GenesisSharedAccessException('AUTOMATION_CONFLICT',409);
        $title=genesisSharedTitle($input['title']??($old?genesisSharedContentDecrypt($old['title']):null));
        $owner=$input['ownerId']??$old['owner_id']??$actor;$enabled=$input['enabled']??(bool)($old['enabled']??false);$deleted=$input['deleted']??($old&&$old['deleted_at']!==null);
        if(!is_string($owner)||!is_bool($enabled)||!is_bool($deleted)||(!$old&&$deleted))genesisAutomationInvalid();
        if($owner!==($old['owner_id']??$actor)&&!$project['permissions']['manageProjects'])throw new GenesisSharedAccessException('SHARED_PROJECT_FORBIDDEN',403);
        $changedDefinition=array_key_exists('definition',$input)||$owner!==($old['owner_id']??$actor)||$enabled||!$old;
        if($changedDefinition&&!$deleted){
            genesisSharedRequireEnabled($owner);$ownerProject=genesisSharedProjectAccess($projectId,$owner,'write');
            $definition=genesisAutomationDefinition($actor,$project,$input['definition']??($old?genesisAutomationDecode($old['definition_json']):null));
            // Assigning a rule cannot lend its editor the owner's access to a hidden template.
            $definition=genesisAutomationDefinition($owner,$ownerProject,$definition);
        }else $definition=genesisAutomationDecode($old['definition_json']);
        if(strlen(json_encode($definition,JSON_THROW_ON_ERROR))>200_000)throw new InvalidArgumentException('AUTOMATION_SIZE_LIMIT');
        $now=genesisNow();$id=$old['id']??genesisUuid();
        if(!$old){
            $q=$db->prepare('SELECT COUNT(*) FROM shared_automation_rules WHERE project_id=? AND deleted_at IS NULL');$q->execute([$projectId]);if((int)$q->fetchColumn()>=100)throw new GenesisSharedAccessException('AUTOMATION_RULE_LIMIT',409);
            $db->prepare('INSERT INTO shared_automation_rules(id,project_id,owner_id,title,definition_json,enabled,deleted_at,checked_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
                ->execute([$id,$projectId,$owner,genesisSharedContentEncrypt($title),genesisAutomationEncode($definition),$enabled&&!$deleted?1:0,$deleted?$now:null,$now,$now,$now]);
        }else{
            if($old['deleted_at']!==null&&!$deleted){$q=$db->prepare('SELECT COUNT(*) FROM shared_automation_rules WHERE project_id=? AND deleted_at IS NULL');$q->execute([$projectId]);if((int)$q->fetchColumn()>=100)throw new GenesisSharedAccessException('AUTOMATION_RULE_LIMIT',409);}
            $db->prepare("UPDATE shared_automation_rules SET owner_id=?,title=?,definition_json=?,enabled=?,revision=revision+1,deleted_at=?,cursor_date=NULL,scan_after_id='',updated_at=? WHERE id=?")
                ->execute([$owner,genesisSharedContentEncrypt($title),genesisAutomationEncode($definition),$enabled&&!$deleted?1:0,$deleted?$now:null,$now,$id]);
        }
        genesisSharedAudit($projectId,$actor,$old?'automation.updated':'automation.created',$id);
        $record=genesisAutomationRecord(genesisAutomationRule($actor,$projectId,$id));genesisAutomationReceipt($actor,$operation,$hash,$record);
        if($owns)$db->commit();return $record;
    }catch(Throwable $error){if($owns&&$db->inTransaction())$db->rollBack();throw $error;}
}

/** A log never resolves an inaccessible/moved task through its historical ID. */
function genesisSharedAutomationRuns(string $actor,string $projectId,string $id,?string $cursor=null):array
{
    genesisAutomationRule($actor,$projectId,$id);$db=genesisDb();
    // IDs are random: pagination is by an immutable (created_at,id) tuple, encoded as a run ID.
    $values=[$projectId,$id,$projectId];$filter='';
    if($cursor!==null){
        genesisTemplateKey($cursor);$q=$db->prepare('SELECT r.created_at FROM shared_automation_runs r LEFT JOIN shared_tasks_history_read t ON t.id=r.task_id AND t.project_id=? WHERE r.id=? AND r.rule_id=? AND (r.task_id IS NULL OR t.project_id=?)');$q->execute([$projectId,$cursor,$id,$projectId]);$stamp=$q->fetchColumn();if(!$stamp)throw new InvalidArgumentException('AUTOMATION_CURSOR_INVALID');
        $filter=' AND (r.created_at<? OR (r.created_at=? AND r.id<?))';array_push($values,$stamp,$stamp,$cursor);
    }
    $q=$db->prepare('SELECT r.*,t.title AS task_title FROM shared_automation_runs r LEFT JOIN shared_tasks_history_read t ON t.id=r.task_id AND t.project_id=? WHERE r.rule_id=? AND (r.task_id IS NULL OR t.project_id=?)'.$filter.' ORDER BY r.created_at DESC,r.id DESC LIMIT 51');$q->execute($values);$rows=$q->fetchAll();
    $runs=array_map(static fn($row)=>['id'=>$row['id'],'ruleId'=>$row['rule_id'],'revision'=>(int)$row['rule_revision'],'taskId'=>$row['task_id'],'taskTitle'=>$row['task_title'],'state'=>$row['state'],'attempts'=>(int)$row['attempts'],
        'retryCount'=>(int)$row['retry_count'],'errorCode'=>$row['error_code'],'result'=>$row['result_json']?genesisAutomationDecode($row['result_json']):null,'createdAt'=>$row['created_at'],'finishedAt'=>$row['finished_at']],array_slice($rows,0,50));
    return ['runs'=>$runs,'nextCursor'=>count($rows)>50?$rows[49]['id']:null];
}

function genesisSharedRetryAutomation(string $actor,string $projectId,string $id,string $runId,array $input):array
{
    genesisAutomationKeys($input,['operationId','expectedRevision']);if(!is_string($input['operationId']??null))genesisAutomationInvalid();
    $hash=hash('sha256',json_encode(['retry',$id,$runId,$input],JSON_THROW_ON_ERROR));$db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        $rule=genesisAutomationRule($actor,$projectId,$id,true);$replay=genesisAutomationOperation($actor,$input['operationId'],$hash);if($replay!==null){$db->commit();return $replay;}
        if(($input['expectedRevision']??null)!==(int)$rule['revision'])throw new GenesisSharedAccessException('AUTOMATION_CONFLICT',409);
        $q=$db->prepare('SELECT * FROM shared_automation_runs WHERE id=? AND rule_id=?');$q->execute([$runId,$id]);$run=$q->fetch();
        if(!$run||$run['state']!=='failed'||(int)$run['retry_count']>=3||!(bool)$rule['enabled']||$rule['deleted_at']!==null||(int)$run['rule_revision']!==(int)$rule['revision'])throw new GenesisSharedAccessException('AUTOMATION_RETRY_UNAVAILABLE',409);
        if($run['task_id']!==null)genesisSharedGetTask($actor,$projectId,$run['task_id']);
        $retry=(int)$run['retry_count']+1;$db->prepare("UPDATE shared_automation_runs SET state='pending',error_code=NULL,finished_at=NULL,retry_count=?,attempts=0 WHERE id=?")->execute([$retry,$runId]);
        genesisBackgroundEnqueue('shared-automation','automation:'.$runId.':'.$retry,['runId'=>$runId,'retry'=>$retry]);$result=['id'=>$runId,'state'=>'pending','retryCount'=>$retry];
        genesisAutomationReceipt($actor,$input['operationId'],$hash,$result);$db->commit();return $result;
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}
