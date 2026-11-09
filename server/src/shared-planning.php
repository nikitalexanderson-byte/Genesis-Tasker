<?php
declare(strict_types=1);

/** Templates/imports preserve inert estimates on creation without enabling advanced behavior. */
final class GenesisPlanningSeedScope {
    private static int $depth=0;
    public static function active():bool{return self::$depth>0;}
    public static function run(callable $work):mixed{self::$depth++;try{return $work();}finally{self::$depth--;}}
}

function genesisPlanningRows(string $sql,array $values=[]):array {
    $query=genesisDb()->prepare($sql);$query->execute($values);return $query->fetchAll();
}
function genesisPlanningJson(mixed $value):string {return json_encode($value,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);}
function genesisPlanningOpen(string $value):array {return json_decode(genesisSharedContentDecrypt($value),true,128,JSON_THROW_ON_ERROR);}
function genesisPlanningSeal(array $value):string {return genesisSharedContentEncrypt(genesisPlanningJson($value));}
function genesisPlanningCanonical(mixed $value):mixed {
    if(!is_array($value))return $value;
    if(!array_is_list($value))ksort($value);
    return array_map('genesisPlanningCanonical',$value);
}
function genesisPlanningConfig(string $project):array {
    $rows=genesisPlanningRows('SELECT * FROM shared_project_planning WHERE project_id=?',[$project]);$row=$rows[0]??null;
    return ['enabled'=>$row?(bool)$row['enabled']:false,'estimateUnit'=>$row['estimate_unit']??'points','revision'=>(int)($row['revision']??0)];
}
function genesisPlanningRequire(array $project):array {
    if((int)$project['is_inbox']===1)throw new InvalidArgumentException('PLANNING_PROJECT_REQUIRED');
    $config=genesisPlanningConfig($project['id']);
    if(!$config['enabled'])throw new GenesisSharedAccessException('PLANNING_DISABLED',409);
    return $config;
}
function genesisPlanningExpected(array $input,int $revision):void {
    if(!is_int($input['expectedRevision']??null)||$input['expectedRevision']!==$revision)throw new GenesisSharedAccessException('PLANNING_CONFLICT',409);
}
/** Current authorization is checked even before a replay is returned. */
function genesisPlanningWrite(string $actor,string $projectId,array $input,string $operation,string $permission,callable $work):array {
    genesisSharedRequireEnabled($actor);$db=genesisDb();$owns=!$db->inTransaction();if($owns)genesisBeginWriteTransaction($db);
    try {
        $project=genesisSharedProjectAccess($projectId,$actor,$permission);
        if((int)$project['is_inbox']===1)throw new InvalidArgumentException('PLANNING_PROJECT_REQUIRED');
        $request=genesisSharedRequestId($input);if($request===null)throw new InvalidArgumentException('INVALID_SHARED_REQUEST_ID');
        $hash=hash('sha256',genesisPlanningJson(genesisPlanningCanonical([$operation,$input])));
        $rows=genesisPlanningRows('SELECT * FROM shared_planning_receipts WHERE actor_id=? AND request_id=?',[$actor,$request]);
        if($rows){$receipt=$rows[0];if($receipt['project_id']!==$projectId||$receipt['operation']!==$operation||!hash_equals($hash,$receipt['payload_hash']))throw new GenesisSharedAccessException('SHARED_REQUEST_ID_CONFLICT',409);
            $result=genesisPlanningOpen($receipt['response_json']);if($owns)$db->commit();return $result;}
        $result=$work($project);
        $db->prepare('INSERT INTO shared_planning_receipts VALUES(?,?,?,?,?,?,?)')->execute([$actor,$request,$projectId,$operation,$hash,genesisPlanningSeal($result),genesisNow()]);
        if($owns)$db->commit();return $result;
    }catch(Throwable $error){if($owns&&$db->inTransaction())$db->rollBack();throw $error;}
}
function genesisSharedSavePlanning(string $actor,string $projectId,array $input):array {
    return genesisPlanningWrite($actor,$projectId,$input,'planning.settings','manage',function($project)use($actor,$projectId,$input){
        $old=genesisPlanningConfig($projectId);genesisPlanningExpected($input,$old['revision']);
        if(!is_bool($input['enabled']??null)||!in_array($input['estimateUnit']??null,['points','hours'],true))throw new InvalidArgumentException('PLANNING_SETTINGS_INVALID');
        if(!$input['enabled']&&genesisPlanningRows("SELECT id FROM shared_sprints WHERE project_id=? AND state='active'",[$projectId]))throw new GenesisSharedAccessException('PLANNING_ACTIVE_SPRINT',409);
        genesisDb()->prepare('INSERT INTO shared_project_planning(project_id,enabled,estimate_unit,revision,updated_at,updated_by) VALUES(?,?,?,?,?,?)
            ON CONFLICT(project_id) DO UPDATE SET enabled=excluded.enabled,estimate_unit=excluded.estimate_unit,revision=excluded.revision,updated_at=excluded.updated_at,updated_by=excluded.updated_by')
            ->execute([$projectId,(int)$input['enabled'],$input['estimateUnit'],$old['revision']+1,genesisNow(),$actor]);
        $config=genesisPlanningConfig($projectId);$keys=['enabled'=>true,'estimateUnit'=>true];genesisSharedAudit($projectId,$actor,'planning.settings',$projectId,['changes'=>genesisSharedChanges(array_intersect_key($old,$keys),array_intersect_key($config,$keys))]);
        return ['config'=>$config];
    });
}
function genesisPlanningEstimate(mixed $value):int|float|null {
    if($value===null)return null;
    if((!is_int($value)&&!is_float($value))||!is_finite((float)$value)||$value<0||$value>1000000||abs($value*100-round($value*100))>0.000001)throw new InvalidArgumentException('PLANNING_ESTIMATE_INVALID');
    return $value==(int)$value?(int)$value:round($value,2);
}
function genesisPlanningTaskValues(string $task):array {
    $rows=genesisPlanningRows('SELECT * FROM shared_task_planning WHERE task_id=?',[$task]);
    $estimates=$rows?genesisPlanningOpen($rows[0]['estimates_json']):[];
    return ['sprintId'=>$rows[0]['sprint_id']??null,'storyPoints'=>$estimates['storyPoints']??null,'estimateHours'=>$estimates['estimateHours']??null];
}
function genesisPlanningSprint(string $projectId,string $id):array {
    $rows=genesisPlanningRows('SELECT * FROM shared_sprints WHERE id=? AND project_id=?',[$id,$projectId]);
    if(!$rows)throw new GenesisSharedAccessException('SPRINT_NOT_FOUND',404);return $rows[0];
}
function genesisPlanningSprintRecord(array $row):array {
    return ['id'=>$row['id'],'projectId'=>$row['project_id'],'state'=>$row['state'],'startDate'=>$row['start_date'],'endDate'=>$row['end_date'],
        'revision'=>(int)$row['revision'],'estimateUnit'=>$row['estimate_unit'],'createdAt'=>$row['created_at'],'updatedAt'=>$row['updated_at'],'startedAt'=>$row['started_at'],'completedAt'=>$row['completed_at'],...genesisPlanningOpen($row['content_json'])];
}
/** Missing fields preserve values for released clients, automation actions and partial task edits. */
function genesisPlanningTaskInput(string $actor,array $project,string $task,array $input,bool $creating=false):array {
    $old=genesisPlanningTaskValues($task);$next=$old;
    if(!array_intersect(array_keys($input),['sprintId','storyPoints','estimateHours']))return ['old'=>$old,'values'=>$next];
    if(!$creating||!GenesisPlanningSeedScope::active()||array_key_exists('sprintId',$input))genesisPlanningRequire($project);
    foreach(['storyPoints','estimateHours'] as $field)if(array_key_exists($field,$input))$next[$field]=genesisPlanningEstimate($input[$field]);
    if(array_key_exists('sprintId',$input)){
        $sprint=$input['sprintId'];if($sprint!==null&&(!is_string($sprint)||$sprint===''))throw new InvalidArgumentException('SPRINT_NOT_FOUND');
        if($sprint!==$old['sprintId']){
            genesisSharedProjectAccess($project['id'],$actor,'organize');
            if($sprint!==null&&genesisPlanningSprint($project['id'],$sprint)['state']==='completed')throw new GenesisSharedAccessException('SPRINT_COMPLETED',409);
        }
        $next['sprintId']=$sprint;
    }
    return ['old'=>$old,'values'=>$next];
}
function genesisPlanningSaveTask(string $task,array $value):void {
    genesisDb()->prepare('INSERT INTO shared_task_planning VALUES(?,?,?) ON CONFLICT(task_id) DO UPDATE SET sprint_id=excluded.sprint_id,estimates_json=excluded.estimates_json')
        ->execute([$task,$value['sprintId'],genesisPlanningSeal(['storyPoints'=>$value['storyPoints'],'estimateHours'=>$value['estimateHours']])]);
}
/** Immutable evidence has no task titles and does not pretend to cover time before observation. */
function genesisPlanningTaskState(array $row):array {
    $values=array_key_exists('planning_estimates',$row)?['sprintId'=>$row['planning_sprint_id'],...($row['planning_estimates']===null?['storyPoints'=>null,'estimateHours'=>null]:genesisPlanningOpen($row['planning_estimates']))]:genesisPlanningTaskValues($row['id']);
    return ['taskId'=>$row['id'],'statusId'=>$row['status_id'],'done'=>$row['completed_at']!==null,'active'=>$row['archived_at']===null&&!($row['trashed']??false),
        'revision'=>(int)$row['revision'],'assigneeId'=>$row['assignee_id'],...$values];
}
function genesisPlanningProjectRows(string $project):array {
    return genesisPlanningRows("SELECT t.*,a.sprint_id AS planning_sprint_id,a.estimates_json AS planning_estimates,EXISTS(SELECT 1 FROM shared_trash tr WHERE tr.kind='task' AND tr.object_id=t.id) AS trashed FROM shared_tasks t LEFT JOIN shared_task_planning a ON a.task_id=t.id WHERE t.project_id=? ORDER BY t.id",[$project]);
}
function genesisPlanningFingerprint(string $project):string {
    $rows=genesisPlanningProjectRows($project);$tasks=[];foreach($rows as $row)$tasks[]=genesisPlanningTaskState($row);
    $sprints=genesisPlanningRows('SELECT id,state,revision FROM shared_sprints WHERE project_id=? ORDER BY id',[$project]);
    $statuses=genesisPlanningRows('SELECT id,revision,is_done FROM shared_project_statuses WHERE project_id=? ORDER BY id',[$project]);
    return hash('sha256',genesisPlanningJson([genesisPlanningConfig($project),$sprints,$statuses,$tasks]));
}
function genesisPlanningEmptyTotals():array {
    return ['count'=>0,'completed'=>0,'points'=>['value'=>0,'unestimated'=>0],'hours'=>['value'=>0,'unestimated'=>0]];
}
function genesisPlanningAddTotals(array &$totals,array $task):void {
    $totals['count']++;$totals['completed']+=(int)$task['done'];
    foreach(['points'=>'storyPoints','hours'=>'estimateHours'] as $unit=>$field){
        if($task[$field]===null)$totals[$unit]['unestimated']++;
        else $totals[$unit]['value']=round($totals[$unit]['value']+$task[$field],2);
    }
}
function genesisSharedPlanning(string $actor,string $projectId):array {
    genesisSharedRequireEnabled($actor);$db=genesisDb();$owns=!$db->inTransaction();if($owns)$db->beginTransaction();
    try {
        $project=genesisSharedProjectAccess($projectId,$actor);if((int)$project['is_inbox']===1)throw new InvalidArgumentException('PLANNING_PROJECT_REQUIRED');
        $config=genesisPlanningConfig($projectId);$sprints=array_map('genesisPlanningSprintRecord',genesisPlanningRows('SELECT * FROM shared_sprints WHERE project_id=? ORDER BY start_date,id',[$projectId]));
        $states=array_column($sprints,'state','id');$totals=['backlog'=>genesisPlanningEmptyTotals()];$members=[];
        foreach($sprints as $sprint)$totals[$sprint['id']]=genesisPlanningEmptyTotals();
        foreach(genesisPlanningProjectRows($projectId) as $row){$task=genesisPlanningTaskState($row);if(!$task['active'])continue;
            $bucket=$task['sprintId'];if($bucket===null||($states[$bucket]??null)==='completed'&&!$task['done'])$bucket='backlog';
            if($bucket==='backlog'&&$task['done'])continue;
            genesisPlanningAddTotals($totals[$bucket],$task);$member=$task['assigneeId']??'unassigned';
            if(!isset($members[$bucket][$member]))$members[$bucket][$member]=genesisPlanningEmptyTotals();
            genesisPlanningAddTotals($members[$bucket][$member],$task);
        }
        $result=['config'=>$config,'sprints'=>$sprints,'totals'=>$totals,'byAssignee'=>(object)$members,'fingerprint'=>genesisPlanningFingerprint($projectId),
            'context'=>['permissions'=>array_intersect_key($project['permissions'],array_flip(['editTasks','organizeTasks','manageProjects']))]];
        if($owns)$db->commit();return $result;
    }catch(Throwable $error){if($owns&&$db->inTransaction())$db->rollBack();throw $error;}
}
function genesisSharedSaveSprint(string $actor,string $projectId,array $input,?string $id=null):array {
    return genesisPlanningWrite($actor,$projectId,$input,'sprint.save:'.($id??'new'),'organize',function($project)use($actor,$projectId,$input,$id){
        genesisPlanningRequire($project);$old=$id===null?null:genesisPlanningSprint($projectId,$id);genesisPlanningExpected($input,(int)($old['revision']??0));
        if($old&&$old['state']==='completed')throw new GenesisSharedAccessException('SPRINT_COMPLETED',409);
        $title=genesisSharedTitle($input['title']??null);$goal=genesisSharedText($input['goal']??'',5000);
        $from=$input['startDate']??null;$to=$input['endDate']??null;
        if(!is_string($from)||!is_string($to))throw new InvalidArgumentException('SPRINT_DATES_INVALID');
        try{$start=genesisCalendarDate($from);$end=genesisCalendarDate($to);}catch(InvalidArgumentException){throw new InvalidArgumentException('SPRINT_DATES_INVALID');}
        if($start>$end||$end->diff($start)->days>3660)throw new InvalidArgumentException('SPRINT_DATES_INVALID');
        if(!in_array($input['calendarMode']??null,['profane','sacred','lunar'],true)||($input['calendarContext']['version']??null)!==2)throw new InvalidArgumentException('SPRINT_CONTEXT_INVALID');
        $context=genesisCalendarContext($input['calendarContext']);$content=['title'=>$title,'goal'=>$goal,'calendarMode'=>$input['calendarMode'],'calendarContext'=>$context];
        $now=genesisNow();$sprintId=$id??genesisUuid();$db=genesisDb();
        if($old)$db->prepare('UPDATE shared_sprints SET start_date=?,end_date=?,content_json=?,revision=revision+1,updated_at=? WHERE id=?')->execute([$from,$to,genesisPlanningSeal($content),$now,$sprintId]);
        else $db->prepare('INSERT INTO shared_sprints(id,project_id,start_date,end_date,content_json,created_at,updated_at,created_by) VALUES(?,?,?,?,?,?,?,?)')->execute([$sprintId,$projectId,$from,$to,genesisPlanningSeal($content),$now,$now,$actor]);
        $sprint=genesisPlanningSprintRecord(genesisPlanningSprint($projectId,$sprintId));
        $keys=array_flip(['title','goal','startDate','endDate','calendarMode']);
        genesisSharedAudit($projectId,$actor,$old?'sprint.updated':'sprint.created',$sprintId,['sprintId'=>$sprintId,'objectTitle'=>$title,'sprint'=>$sprint,'changes'=>genesisSharedChanges($old?array_intersect_key(genesisPlanningSprintRecord($old),$keys):[],array_intersect_key($sprint,$keys))]);
        return ['sprint'=>$sprint];
    });
}
function genesisPlanningSprintPlan(string $projectId,string $sprintId):array {
    $plan=[];foreach(genesisPlanningProjectRows($projectId) as $row){$task=genesisPlanningTaskState($row);if($task['sprintId']===$sprintId)$plan[]=$task;}return $plan;
}
/** Lifecycle and every carry-over decision commit together or roll back together. */
function genesisSharedTransitionSprint(string $actor,string $projectId,string $id,array $input):array {
    return genesisPlanningWrite($actor,$projectId,$input,'sprint.transition:'.$id,'organize',function($project)use($actor,$projectId,$id,$input){
        $config=genesisPlanningRequire($project);$row=genesisPlanningSprint($projectId,$id);genesisPlanningExpected($input,(int)$row['revision']);
        if(!is_string($input['fingerprint']??null)||!hash_equals(genesisPlanningFingerprint($projectId),$input['fingerprint']))throw new GenesisSharedAccessException('PLANNING_CONFLICT',409);
        $action=$input['action']??null;$plan=genesisPlanningSprintPlan($projectId,$id);$db=genesisDb();$now=genesisNow();$outcomes=[];
        if($action==='start'){
            if($row['state']!=='planning')throw new GenesisSharedAccessException('SPRINT_STATE_INVALID',409);
            if(genesisPlanningRows("SELECT id FROM shared_sprints WHERE project_id=? AND state='active'",[$projectId]))throw new GenesisSharedAccessException('PLANNING_ACTIVE_SPRINT',409);
            $db->prepare("UPDATE shared_sprints SET state='active',estimate_unit=?,started_at=?,updated_at=?,revision=revision+1 WHERE id=?")->execute([$config['estimateUnit'],$now,$now,$id]);
        }elseif($action==='complete'){
            if($row['state']!=='active')throw new GenesisSharedAccessException('SPRINT_STATE_INVALID',409);
            $remaining=array_column(array_values(array_filter($plan,static fn($task)=>$task['active']&&!$task['done'])),null,'taskId');
            $choices=$input['outcomes']??null;
            if(!is_array($choices)||!array_is_list($choices))throw new InvalidArgumentException('SPRINT_OUTCOMES_REQUIRED');
            foreach($choices as $choice){
                if(!is_array($choice)||!is_string($choice['taskId']??null)||!isset($remaining[$choice['taskId']])||array_key_exists($choice['taskId'],$outcomes)||!array_key_exists('destinationSprintId',$choice))throw new InvalidArgumentException('SPRINT_OUTCOMES_REQUIRED');
                $task=$remaining[$choice['taskId']];if(($choice['expectedRevision']??null)!==$task['revision'])throw new GenesisSharedAccessException('PLANNING_CONFLICT',409);
                $target=$choice['destinationSprintId'];if($target!==null&&(!is_string($target)||$target===$id))throw new InvalidArgumentException('SPRINT_OUTCOMES_REQUIRED');
                if($target!==null&&genesisPlanningSprint($projectId,$target)['state']==='completed')throw new GenesisSharedAccessException('SPRINT_COMPLETED',409);
                $outcomes[$task['taskId']]=$target;
            }
            if(count($outcomes)!==count($remaining))throw new InvalidArgumentException('SPRINT_OUTCOMES_REQUIRED');
            foreach($outcomes as $taskId=>$target)genesisSharedTask($actor,$projectId,['expectedRevision'=>$remaining[$taskId]['revision'],'sprintId'=>$target],$taskId);
            $db->prepare("UPDATE shared_sprints SET state='completed',completed_at=?,updated_at=?,revision=revision+1 WHERE id=?")->execute([$now,$now,$id]);
        }else throw new InvalidArgumentException('SPRINT_STATE_INVALID');
        $sprint=genesisPlanningSprintRecord(genesisPlanningSprint($projectId,$id));
        genesisSharedAudit($projectId,$actor,$action==='start'?'sprint.started':'sprint.completed',$id,['sprintId'=>$id,'objectTitle'=>$sprint['title'],'sprint'=>$sprint,'plan'=>$plan,'outcomes'=>(object)$outcomes,'observedAt'=>$now]);
        return ['sprint'=>$sprint];
    });
}
/** Historical snapshots cannot reveal tasks that now belong to an inaccessible project. */
function genesisPlanningSafeDetails(string $actor,array $details):array {
    if(isset($details['plan'])&&is_array($details['plan']))foreach($details['plan'] as &$task){
        if(!genesisSharedReadableReference($actor,'task',(string)($task['taskId']??'')))$task=['unavailable'=>true];
    }unset($task);
    if(isset($details['outcomes']))foreach($details['outcomes'] as $taskId=>$target)if(!genesisSharedReadableReference($actor,'task',(string)$taskId))unset($details['outcomes'][$taskId]);
    // Used internally by reports; this observation is not an activity UI payload.
    unset($details['reportState']);return $details;
}
