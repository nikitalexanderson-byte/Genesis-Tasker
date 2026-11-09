<?php
declare(strict_types=1);

function genesisWorkflowError(string $code,array $details=[]):never {
    throw new GenesisSharedAccessException($code,409,$details);
}
function genesisWorkflowConfig(string $projectId):array {
    $rows=genesisPlanningRows('SELECT * FROM shared_project_workflows WHERE project_id=?',[$projectId]);$row=$rows[0]??null;
    return ['enabled'=>$row?(bool)$row['enabled']:false,'revision'=>(int)($row['revision']??0),
        ...($row?genesisPlanningOpen($row['definition_json']):['statuses'=>[],'transitions'=>[]])];
}
function genesisWorkflowStatuses(string $projectId):array {
    return array_column(genesisPlanningRows('SELECT id,is_done FROM shared_project_statuses WHERE project_id=? AND is_chaos=0 ORDER BY position,id',[$projectId]),null,'id');
}
function genesisWorkflowRole(array $project):string {
    return $project['space_member_role']==='owner'?'owner':$project['member_role'];
}
function genesisWorkflowCounts(string $projectId):array {
    return array_map('intval',array_column(genesisPlanningRows('SELECT status_id,COUNT(*) AS n FROM shared_tasks_read WHERE project_id=? AND archived_at IS NULL GROUP BY status_id',[$projectId]),'n','status_id'));
}
/** Archived/trash settings remain repairable with current ACL before a guarded restore. */
function genesisWorkflowAccess(string $actor,string $projectId,string $permission='read'):array {
    return genesisSharedTrashProjectAccess($actor,$projectId,$permission==='manage'?'manageProjects':'read');
}
function genesisWorkflowWrite(string $actor,string $projectId,array $input,callable $work):array {
    $db=genesisDb();$owns=!$db->inTransaction();if($owns)genesisBeginWriteTransaction($db);
    try {
        $project=genesisWorkflowAccess($actor,$projectId,'manage');if((int)$project['is_inbox'])throw new InvalidArgumentException('WORKFLOW_PROJECT_REQUIRED');
        $request=genesisSharedRequestId($input);if($request===null)throw new InvalidArgumentException('INVALID_SHARED_REQUEST_ID');
        $operation='workflow.settings';$hash=hash('sha256',genesisPlanningJson(genesisPlanningCanonical([$operation,$input])));
        $receipts=genesisPlanningRows('SELECT * FROM shared_planning_receipts WHERE actor_id=? AND request_id=?',[$actor,$request]);
        if($receipts){$receipt=$receipts[0];if($receipt['project_id']!==$projectId||$receipt['operation']!==$operation||!hash_equals($hash,$receipt['payload_hash']))throw new GenesisSharedAccessException('SHARED_REQUEST_ID_CONFLICT',409);$result=genesisPlanningOpen($receipt['response_json']);if($owns)$db->commit();return $result;}
        $result=$work($project);$db->prepare('INSERT INTO shared_planning_receipts VALUES(?,?,?,?,?,?,?)')->execute([$actor,$request,$projectId,$operation,$hash,genesisPlanningSeal($result),genesisNow()]);
        if($owns)$db->commit();return $result;
    }catch(Throwable $error){if($owns&&$db->inTransaction())$db->rollBack();throw $error;}
}
/** Whitelisted fields use existing normalized data, including C3 and G2. */
function genesisWorkflowFields(array $row,array $required):array {
    $values=[];$columns=['description'=>'description','assigneeId'=>'assignee_id','dueDate'=>'due_date','startDate'=>'start_date','categoryId'=>'category_id'];
    foreach($columns as $field=>$column)if(in_array($field,$required,true))$values[$field]=$field==='description'?genesisSharedContentDecrypt((string)$row[$column]):$row[$column];
    if(array_intersect($required,['storyPoints','estimateHours']))$values+=genesisPlanningTaskValues($row['id']);
    if(in_array('labels',$required,true))$values['labels']=genesisSharedLabelIds('task',$row['id']);
    $custom=null;foreach($required as $field)if(str_starts_with($field,'custom:')){$custom??=genesisSharedCustomTaskValues($row['id']);$values[$field]=$custom[substr($field,7)]??null;}
    return $values;
}
function genesisWorkflowRequired(array $row,array $rule):void {
    $fields=$rule['requiredFields'];if(!$fields)return;$values=genesisWorkflowFields($row,$fields);$missing=[];
    foreach($fields as $field){$value=$values[$field]??null;if($value===null||$value===[]||is_string($value)&&trim($value)==='')$missing[]=$field;}
    if($missing)genesisWorkflowError('WORKFLOW_REQUIRED_FIELDS',['taskId'=>$row['id'],'statusId'=>$row['status_id'],'fields'=>$missing]);
}
function genesisWorkflowRules(string $actor,array $project,array $input):array {
    $statuses=genesisWorkflowStatuses($project['id']);$rules=$input['statuses']??null;$transitions=$input['transitions']??null;
    if(!is_array($rules)||!array_is_list($rules)||count($rules)!==count($statuses)||!is_array($transitions)||!array_is_list($transitions)||count($transitions)>930)throw new InvalidArgumentException('WORKFLOW_INVALID');
    // Workflow access above already includes repairable projects in trash. The regular
    // C3 reader deliberately hides those projects, so read only scoped definitions here.
    $fields=array_column(genesisPlanningRows('SELECT id,archived_at FROM shared_custom_fields WHERE space_id=? AND (project_id IS NULL OR project_id=?)',[$project['space_id'],$project['id']]),null,'id');
    $normalized=[];$core=['description','assigneeId','dueDate','startDate','categoryId','labels','storyPoints','estimateHours'];
    foreach($rules as $rule){
        if(!is_array($rule)||array_diff(array_keys($rule),['statusId','wipLimit','requiredFields'])||!is_string($rule['statusId']??null)||!isset($statuses[$rule['statusId']])||isset($normalized[$rule['statusId']])||!array_key_exists('wipLimit',$rule)
            ||!is_array($rule['requiredFields']??null)||!array_is_list($rule['requiredFields'])||count($rule['requiredFields'])>208)throw new InvalidArgumentException('WORKFLOW_INVALID');
        $limit=$rule['wipLimit'];if($limit!==null&&(!is_int($limit)||$limit<0||$limit>1000000||$statuses[$rule['statusId']]['is_done']))throw new InvalidArgumentException('WORKFLOW_INVALID');
        foreach($rule['requiredFields'] as $field){
            if(!is_string($field))throw new InvalidArgumentException('WORKFLOW_INVALID');
            if(in_array($field,$core,true))continue;
            $custom=str_starts_with($field,'custom:')?($fields[substr($field,7)]??null):null;
            if(!$custom||$custom['archived_at']!==null)throw new InvalidArgumentException('WORKFLOW_FIELD_UNAVAILABLE');
        }
        $required=array_values(array_unique($rule['requiredFields']));sort($required);$normalized[$rule['statusId']]=['statusId'=>$rule['statusId'],'wipLimit'=>$limit,'requiredFields'=>$required];
    }
    $edges=[];$seen=[];$entry=false;
    foreach($transitions as $edge){
        if(!is_array($edge)||array_diff(array_keys($edge),['fromStatusId','toStatusId','roles'])||!array_key_exists('fromStatusId',$edge)||$edge['fromStatusId']!==null&&(!is_string($edge['fromStatusId'])||!isset($statuses[$edge['fromStatusId']]))
            ||!is_string($edge['toStatusId']??null)||!isset($statuses[$edge['toStatusId']])||$edge['fromStatusId']===$edge['toStatusId']||!is_array($edge['roles']??null)||!array_is_list($edge['roles'])||!$edge['roles']||count($edge['roles'])>5)throw new InvalidArgumentException('WORKFLOW_INVALID');
        foreach($edge['roles'] as $role)if(!in_array($role,['owner','manager','member','commenter','viewer'],true))throw new InvalidArgumentException('WORKFLOW_INVALID');
        $key=($edge['fromStatusId']??'').':'.$edge['toStatusId'];if(isset($seen[$key]))throw new InvalidArgumentException('WORKFLOW_INVALID');$seen[$key]=true;
        $roles=array_values(array_unique($edge['roles']));sort($roles);$edges[$key]=['fromStatusId'=>$edge['fromStatusId'],'toStatusId'=>$edge['toStatusId'],'roles'=>$roles];
        if($edge['fromStatusId']===null&&in_array('owner',$roles,true))$entry=true;
    }
    if(!$entry)genesisWorkflowError('WORKFLOW_NO_SAFE_ENTRY');
    $safe=[];foreach($statuses as $id=>$status)if((int)$status['is_done'])$safe[$id]=true;
    do{$count=count($safe);foreach($edges as $edge)if($edge['fromStatusId']!==null&&isset($safe[$edge['toStatusId']])&&in_array('owner',$edge['roles'],true))$safe[$edge['fromStatusId']]=true;}while(count($safe)>$count);
    if(count($safe)!==count($statuses))genesisWorkflowError('WORKFLOW_NO_SAFE_EXIT');
    ksort($normalized);ksort($edges);return ['statuses'=>array_values($normalized),'transitions'=>array_values($edges)];
}
function genesisWorkflowAssertWip(string $projectId,array $config):void {
    if(!$config['enabled'])return;$counts=genesisWorkflowCounts($projectId);
    foreach($config['statuses'] as $rule)if($rule['wipLimit']!==null&&($counts[$rule['statusId']]??0)>$rule['wipLimit'])genesisWorkflowError('WORKFLOW_WIP_LIMIT',['statusId'=>$rule['statusId'],'limit'=>$rule['wipLimit'],'count'=>$counts[$rule['statusId']]]);
}
function genesisWorkflowAssertProject(string $actor,string $projectId):void {
    $config=genesisWorkflowConfig($projectId);if(!$config['enabled'])return;
    genesisWorkflowAccess($actor,$projectId);$rules=array_column($config['statuses'],null,'statusId');
    foreach(genesisPlanningRows('SELECT * FROM shared_tasks_read WHERE project_id=? AND archived_at IS NULL',[$projectId]) as $row){
        if(!isset($rules[$row['status_id']]))genesisWorkflowError('WORKFLOW_STATUS_UNCONFIGURED',['statusId'=>$row['status_id']]);genesisWorkflowRequired($row,$rules[$row['status_id']]);
    }
    genesisWorkflowAssertWip($projectId,$config);
}
/** Called after all task/custom/planning writes, while the existing SQLite writer lock is held. */
function genesisWorkflowTask(string $actor,string $projectId,string $id,?array $before=null,bool $restoring=false,bool $checkWip=true):void {
    // C5's temporary open statuses/checklist links are not committed task states.
    // Its final entry rules, roles, fields and WIP are validated together before commit.
    if(GenesisDataHistoricalScope::active())return;
    $config=genesisWorkflowConfig($projectId);if(!$config['enabled'])return;
    if(!genesisDb()->inTransaction())throw new LogicException('Workflow validation requires a write transaction');
    $rows=genesisPlanningRows('SELECT * FROM shared_tasks WHERE id=? AND project_id=?',[$id,$projectId]);if(!$rows)throw new GenesisSharedAccessException();$task=$rows[0];
    if($restoring&&$task['archived_at']!==null)return;
    $target=$task['status_id'];
    if(str_starts_with($target,'chaos-'))return; // Unplaced tasks enter board workflow only when assigned to a board.
    $rules=array_column($config['statuses'],null,'statusId');if(!isset($rules[$target]))genesisWorkflowError('WORKFLOW_STATUS_UNCONFIGURED',['statusId'=>$target]);
    $from=$before!==null&&$before['project_id']===$projectId?$before['status_id']:null;
    if($from!==null&&str_starts_with($from,'chaos-'))$from=null;
    if(!$restoring&&$from!==$target){
        $project=genesisSharedProjectAccess($projectId,$actor);$role=genesisWorkflowRole($project);$allowed=false;$found=false;
        foreach($config['transitions'] as $edge)if($edge['fromStatusId']===$from&&$edge['toStatusId']===$target){$found=true;$allowed=in_array($role,$edge['roles'],true);break;}
        if(!$allowed)genesisWorkflowError($found?'WORKFLOW_ROLE_FORBIDDEN':'WORKFLOW_TRANSITION_FORBIDDEN',['fromStatusId'=>$from,'statusId'=>$target]);
    }
    genesisWorkflowRequired($task,$rules[$target]);
    // C5 applies archived/completed historical metadata only after building the entire graph.
    if($checkWip&&($restoring||$before===null||$before['project_id']!==$projectId||$from!==$target))genesisWorkflowAssertWip($projectId,$config);
}
function genesisWorkflowStatusEdit(string $projectId):void {
    if(genesisWorkflowConfig($projectId)['enabled'])genesisWorkflowError('WORKFLOW_STATUS_EDIT_REQUIRES_DISABLE');
}
/** A referenced C3 definition cannot be retired/moved out from under an enabled workflow. */
function genesisWorkflowCustomFieldEdit(string $id,?string $destination,bool $unavailable):void {
    foreach(genesisPlanningRows('SELECT project_id,definition_json FROM shared_project_workflows WHERE enabled=1') as $row){
        if(!$unavailable&&($destination===null||$destination===$row['project_id']))continue;
        foreach(genesisPlanningOpen($row['definition_json'])['statuses'] as $rule)if(in_array('custom:'.$id,$rule['requiredFields'],true))genesisWorkflowError('WORKFLOW_FIELD_IN_USE');
    }
}
function genesisSharedWorkflow(string $actor,string $projectId):array {
    $db=genesisDb();$owns=!$db->inTransaction();if($owns)$db->beginTransaction();
    try {
        $project=genesisWorkflowAccess($actor,$projectId);
        // A settings projection must also work before restore, without reading hidden tasks.
        $context=['project'=>['id'=>$projectId,'title'=>$project['title'],'role'=>$project['member_role'],'permissions'=>$project['permissions']],
            'statuses'=>genesisPlanningRows('SELECT id,title,position,is_done AS isDone,revision FROM shared_project_statuses WHERE project_id=? AND is_chaos=0 ORDER BY position,id',[$projectId]),
            'customFieldDefinitions'=>array_map('genesisSharedCustomFieldRecord',genesisPlanningRows('SELECT * FROM shared_custom_fields WHERE space_id=? AND (project_id IS NULL OR project_id=?) ORDER BY position,id',[$project['space_id'],$projectId]))];
        $result=['config'=>genesisWorkflowConfig($projectId),'counts'=>genesisWorkflowCounts($projectId),'context'=>$context];
        if($owns)$db->commit();return $result;
    }catch(Throwable $error){if($owns&&$db->inTransaction())$db->rollBack();throw $error;}
}
function genesisSharedSaveWorkflow(string $actor,string $projectId,array $input):array {
    return genesisWorkflowWrite($actor,$projectId,$input,function($project)use($actor,$projectId,$input){
        $old=genesisWorkflowConfig($projectId);
        if(!is_int($input['expectedRevision']??null)||$input['expectedRevision']!==$old['revision'])genesisWorkflowError('WORKFLOW_CONFLICT');
        if(!is_bool($input['enabled']??null)||array_diff(array_keys($input),['requestId','expectedRevision','enabled','statuses','transitions']))throw new InvalidArgumentException('WORKFLOW_INVALID');
        $definition=array_key_exists('statuses',$input)||array_key_exists('transitions',$input)||$input['enabled']?genesisWorkflowRules($actor,$project,$input):array_intersect_key($old,array_flip(['statuses','transitions']));
        $config=['enabled'=>$input['enabled'],'revision'=>$old['revision']+1,...$definition];$now=genesisNow();$sealed=genesisPlanningSeal($definition);$db=genesisDb();
        $db->prepare('INSERT INTO shared_project_workflows(project_id,enabled,definition_json,revision,updated_at,updated_by) VALUES(?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET enabled=excluded.enabled,definition_json=excluded.definition_json,revision=excluded.revision,updated_at=excluded.updated_at,updated_by=excluded.updated_by')->execute([$projectId,(int)$config['enabled'],$sealed,$config['revision'],$now,$actor]);
        if($config['enabled'])genesisWorkflowAssertProject($actor,$projectId);
        $db->prepare('INSERT INTO shared_project_workflow_versions VALUES(?,?,?,?,?,?)')->execute([$projectId,$config['revision'],(int)$config['enabled'],$sealed,$now,$actor]);
        genesisSharedAudit($projectId,$actor,'workflow.settings',$projectId,['workflowRevision'=>$config['revision'],'changes'=>['enabled'=>['from'=>$old['enabled'],'to'=>$config['enabled']]]]);
        return ['config'=>$config,'counts'=>genesisWorkflowCounts($projectId)];
    });
}
function genesisSharedWorkflowHistory(string $actor,string $projectId,?int $before=null):array {
    genesisWorkflowAccess($actor,$projectId);
    if($before!==null&&$before<1)throw new InvalidArgumentException('WORKFLOW_INVALID');
    $rows=genesisPlanningRows('SELECT * FROM shared_project_workflow_versions WHERE project_id=? AND revision<? ORDER BY revision DESC LIMIT 51',[$projectId,$before??PHP_INT_MAX]);$items=[];
    foreach(array_slice($rows,0,50) as $row)$items[]=['revision'=>(int)$row['revision'],'enabled'=>(bool)$row['enabled'],'createdAt'=>$row['created_at'],'actorId'=>$row['actor_id'],...genesisPlanningOpen($row['definition_json'])];
    return ['versions'=>$items,'nextCursor'=>count($rows)>50?(int)$rows[49]['revision']:null];
}
