<?php
declare(strict_types=1);
require_once __DIR__ . '/recurrence.php';
require_once __DIR__ . '/background-jobs.php';

function genesisSharedSeriesSettings(mixed $value): array
{
    if(!is_array($value)||!in_array($value['timing']??null,['schedule','after-completion'],true)
        ||!is_int($value['limit']??null)||$value['limit']<1||$value['limit']>1000
        ||!is_int($value['delayDays']??null)||$value['delayDays']<1||$value['delayDays']>366
        ||!is_bool($value['cloneChildren']??null)) throw new InvalidArgumentException('SERIES_INVALID');
    $rule=genesisRecurrenceRule($value['recurrence']??null);
    $excluded=$value['excludedDates']??[];
    if(!is_array($excluded)||!array_is_list($excluded)||count($excluded)>1000)throw new InvalidArgumentException('SERIES_INVALID');
    foreach($excluded as $date)if(!is_string($date)||!genesisSharedTaskDate($date))throw new InvalidArgumentException('SERIES_INVALID');
    $excluded=array_values(array_unique($excluded));sort($excluded);
    return ['timing'=>$value['timing'],'limit'=>$value['limit'],'delayDays'=>$value['delayDays'],
        'cloneChildren'=>$value['cloneChildren'],'excludedDates'=>$excluded,'recurrence'=>$rule];
}

/** Explicit snapshot of saved content, never comments/files or external task dependencies. */
function genesisSharedSeriesTemplate(string $actor,string $projectId,string $rootId,bool $children): array
{
    $db=genesisDb();$ids=[$rootId];$rows=[];
    for($i=0;$i<count($ids);$i++){
        if($i>=20)throw new InvalidArgumentException('SERIES_TEMPLATE_LIMIT');
        $q=$db->prepare('SELECT * FROM shared_tasks_read WHERE id=? AND project_id=?');$q->execute([$ids[$i],$projectId]);$row=$q->fetch();$q->closeCursor();
        if(!$row)throw new InvalidArgumentException('SERIES_SOURCE_UNAVAILABLE');
        genesisSharedProjectAccess($projectId,$actor,'write');
        $rows[]=$row;
        if($children){$q=$db->prepare('SELECT id FROM shared_tasks_read WHERE parent_task_id=? ORDER BY created_at,id');$q->execute([$row['id']]);array_push($ids,...$q->fetchAll(PDO::FETCH_COLUMN));}
    }
    $root=$rows[0];$anchor=$root['due_date']??$root['start_date'];
    $open=$db->prepare('SELECT id FROM shared_project_statuses WHERE project_id=? AND is_done=0 AND is_chaos=0 ORDER BY position,id LIMIT 1');$open->execute([$projectId]);$fallback=$open->fetchColumn();$open->closeCursor();
    if(!$fallback)throw new InvalidArgumentException('SERIES_TEMPLATE_UNAVAILABLE');
    $nodes=[];
    foreach($rows as $row){
        $status=$db->prepare('SELECT is_done FROM shared_project_statuses WHERE id=?');$status->execute([$row['status_id']]);$done=(bool)$status->fetchColumn();$status->closeCursor();
        $lists=json_decode($row['checklists_json'],true,512,JSON_THROW_ON_ERROR);
        foreach($lists as &$list)foreach($list['items'] as &$item){
            $item['done']=false;
            $item['dueOffset']=$item['dueDate']===null?null:($anchor===null?0:genesisCalendarDayNumber($item['dueDate'])-genesisCalendarDayNumber($anchor));
            if(!in_array($item['linkedTaskId']??null,$ids,true))$item['linkedTaskId']=null;
        }unset($list,$item);
        $offset=static fn(?string $date)=>$date===null?null:($anchor===null?0:genesisCalendarDayNumber($date)-genesisCalendarDayNumber($anchor));
        $nodes[]=['sourceId'=>$row['id'],'parentSourceId'=>$row['id']===$rootId?null:$row['parent_task_id'],
            'title'=>$row['title'],'description'=>$row['description'],'tags'=>json_decode($row['tags_json'],true),
            'entryType'=>$row['entry_type'],'statusId'=>$done?(str_starts_with($row['status_id'],'chaos-')?genesisSharedProjectInboxStatus($db,$projectId,false):$fallback):$row['status_id'],'categoryId'=>$row['category_id'],
            'assigneeId'=>$row['assignee_id'],'priority'=>(int)$row['priority'],'checklists'=>$lists,
            'customFields'=>(object)genesisSharedCustomTaskValues($row['id']),
            'dueOffset'=>$row['id']===$rootId?0:$offset($row['due_date']),'startOffset'=>$offset($row['start_date']),
            'startTime'=>$row['start_time'],'endTime'=>$row['end_time'],'labelIds'=>genesisSharedLabelIds('task',$row['id']),
            'dependsOnSources'=>array_values(array_intersect(genesisSharedDependencyIds($row['id']),$ids)),
            'approverIds'=>array_column(genesisSharedTaskApprovals($row['id']),'userId')];
    }
    genesisSharedSeriesValidateTemplate($projectId,$nodes);
    return $nodes;
}

/** Resolve the one-time workspace relocation without rewriting encrypted saved templates. */
function genesisSharedSeriesSavedTemplate(array $series): array
{
    $nodes=json_decode(genesisSharedContentDecrypt($series['template_json']),true,512,JSON_THROW_ON_ERROR);
    $q=genesisDb()->prepare('SELECT inbox_project_id FROM shared_workspace_inbox_relocations WHERE destination_project_id=?');
    $q->execute([$series['project_id']]);$roots=$q->fetchAll(PDO::FETCH_COLUMN);$q->closeCursor();
    if($roots)foreach($nodes as &$node){
        $status=genesisDb()->prepare('SELECT project_id FROM shared_project_statuses WHERE id=?');$status->execute([$node['statusId']]);$original=$status->fetchColumn();$status->closeCursor();
        if(in_array($original,$roots,true))$node['statusId']=genesisSharedProjectInboxStatus(genesisDb(),$series['project_id'],false);
    }unset($node);
    return $nodes;
}

function genesisSharedSeriesValidateTemplate(string $projectId,array $nodes): void
{
    $db=genesisDb();
    foreach($nodes as $node){
        $q=$db->prepare('SELECT 1 FROM shared_project_statuses WHERE id=? AND project_id=? AND is_done=0');
        $q->execute([$node['statusId'],$projectId]);
        if(!$q->fetchColumn())throw new InvalidArgumentException('SERIES_TEMPLATE_UNAVAILABLE');
        $members=array_merge($node['approverIds'],[$node['assigneeId']]);
        foreach($node['checklists'] as $list)foreach($list['items'] as $item)$members[]=$item['assigneeId']??null;
        foreach(array_unique(array_filter($members)) as $member){
            $q=$db->prepare('SELECT 1 FROM shared_project_members pm JOIN shared_projects p ON p.id=pm.project_id JOIN shared_space_members sm ON sm.space_id=p.space_id AND sm.user_id=pm.user_id WHERE pm.project_id=? AND pm.user_id=?');
            $q->execute([$projectId,$member]);
            if(!$q->fetchColumn())throw new InvalidArgumentException('SERIES_TEMPLATE_UNAVAILABLE');
        }
    }
}

function genesisSharedSeriesAccess(string $actor,string $projectId,string $id,bool $write=false): array
{
    genesisSharedRequireEnabled($actor);genesisSharedProjectAccess($projectId,$actor,$write?'organize':'read');
    if($write)genesisSharedProjectAccess($projectId,$actor,'write');
    $q=genesisDb()->prepare('SELECT * FROM shared_task_series WHERE id=? AND project_id=?');$q->execute([$id,$projectId]);$row=$q->fetch();
    if(!$row)throw new GenesisSharedAccessException();
    return $row;
}

function genesisSharedSeriesForTask(string $actor,string $projectId,string $taskId): ?array
{
    genesisSharedGetTask($actor,$projectId,$taskId,true);
    $q=genesisDb()->prepare('SELECT s.id,s.project_id FROM shared_series_instances i JOIN shared_task_series s ON s.id=i.series_id WHERE i.task_id=?');$q->execute([$taskId]);$row=$q->fetch();
    if(!$row)return null;
    return genesisSharedSeriesRead($actor,$row['project_id'],$row['id']);
}

function genesisSharedSeriesRead(string $actor,string $projectId,string $id): array
{
    $row=genesisSharedSeriesAccess($actor,$projectId,$id);$rule=json_decode($row['rule_json'],true,32,JSON_THROW_ON_ERROR);
    $zone=$rule['recurrence']['calendarContext']['timeZone'];$today=(new DateTimeImmutable('now',new DateTimeZone($zone)))->format('Y-m-d');
    $dates=[];$waiting=false;
    if((int)$row['generated_count']<$rule['limit']){
        if($rule['timing']==='after-completion'){
            $candidate=genesisSharedSeriesAfterCandidate($row,$rule);
            if($candidate)$dates[]=$candidate['date'];else $waiting=true;
        }else for($date=max($today,genesisCalendarAddDays($row['cursor_date'],1)),$i=0;$i<1830&&$date<='2100-12-31'&&count($dates)<5;$date=genesisCalendarAddDays($date,1),$i++){
            if($rule['recurrence']['rangeEnd']!==''&&$date>$rule['recurrence']['rangeEnd'])break;
            if(genesisRecurrenceMatches($rule['recurrence']['rangeStart'],$rule['recurrence'],$date)&&!in_array($date,$rule['excludedDates'],true))$dates[]=$date;
            if(count($dates)>=$rule['limit']-(int)$row['generated_count'])break;
        }
    }
    $q=genesisDb()->prepare('SELECT i.task_id,i.original_date,i.ordinal,i.state,t.project_id FROM shared_series_instances i LEFT JOIN shared_tasks_history_read t ON t.id=i.task_id WHERE i.series_id=? ORDER BY i.ordinal DESC LIMIT 30');
    $q->execute([$id]);$instances=[];
    foreach($q->fetchAll() as $instance){
        if($instance['task_id']!==null){
            if(!$instance['project_id'])continue;
            try{genesisSharedProjectAccess($instance['project_id'],$actor);}catch(GenesisSharedAccessException){continue;}
        }
        $instances[]=['taskId'=>$instance['task_id'],'projectId'=>$instance['project_id'],'date'=>$instance['original_date'],'ordinal'=>(int)$instance['ordinal'],'state'=>$instance['state']];
    }
    return ['id'=>$id,'projectId'=>$projectId,'sourceTaskId'=>$row['source_task_id'],'revision'=>(int)$row['revision'],
        'paused'=>(bool)$row['paused'],'settings'=>$rule,'generatedCount'=>(int)$row['generated_count'],'lastError'=>$row['last_error'],
        'nextDates'=>$dates,'waitingForCompletion'=>$waiting,'templateTaskCount'=>count(json_decode(genesisSharedContentDecrypt($row['template_json']),true)),
        'instances'=>$instances,'workerCompletedAt'=>genesisDb()->query('SELECT completed_at FROM background_worker_state WHERE id=1')->fetchColumn()?:null];
}

function genesisSharedSeriesPreview(string $actor,string $projectId,string $taskId,array $input): array
{
    genesisSharedProjectAccess($projectId,$actor,'organize');
    $task=genesisSharedGetTask($actor,$projectId,$taskId);
    if((int)($input['taskRevision']??0)!==$task['revision'])throw new GenesisSharedAccessException('SHARED_TASK_CONFLICT',409);
    $settings=genesisSharedSeriesSettings($input['settings']??null);
    if(!empty($input['seriesId'])&&empty($input['refreshTemplate'])){
        $series=genesisSharedSeriesAccess($actor,$projectId,(string)$input['seriesId'],true);
        $template=genesisSharedSeriesSavedTemplate($series);
        genesisSharedSeriesValidateTemplate($projectId,$template);
    }else $template=genesisSharedSeriesTemplate($actor,$projectId,$taskId,$settings['cloneChildren']);
    return ['taskCount'=>count($template),'checklistCount'=>array_sum(array_map(static fn($n)=>count($n['checklists']),$template)),
        'preservesExistingInstances'=>true,'copiesDiscussion'=>false,'copiesFiles'=>false];
}

/** Creation/update/skip is one idempotent transaction. A stale editor cannot replace a newer series. */
function genesisSharedSeriesSave(string $actor,string $projectId,string $taskId,array $input,?string $seriesId=null): array
{
    genesisSharedRequireEnabled($actor);$db=genesisDb();genesisBeginWriteTransaction($db);
    try {
        genesisSharedProjectAccess($projectId,$actor,'organize');genesisSharedProjectAccess($projectId,$actor,'write');
        $requestId=genesisSharedRequestId($input);
        if($requestId===null)throw new InvalidArgumentException('SERIES_REQUEST_REQUIRED');
        $resource=$seriesId??$taskId;$action=$seriesId?'series.update':'series.create';
        $payloadHash=genesisSharedMutationPayloadHash($action,$input,['projectId'=>$projectId,'taskId'=>$taskId]);
        $receipt=genesisSharedMutationReceipt($db,$actor,$requestId,$action,$resource, $payloadHash);
        if($receipt!==null){$db->commit();return $receipt;}
        $old=$seriesId?genesisSharedSeriesAccess($actor,$projectId,$seriesId,true):null;
        if($old&&(!isset($input['expectedRevision'])||(int)$input['expectedRevision']!==(int)$old['revision']))throw new GenesisSharedAccessException('SERIES_CONFLICT',409);
        $task=genesisSharedGetTask($actor,$projectId,$taskId);
        if((int)($input['taskRevision']??0)!==$task['revision'])throw new GenesisSharedAccessException('SHARED_TASK_CONFLICT',409);
        if(!$old){
            $q=$db->prepare('SELECT 1 FROM shared_series_instances WHERE task_id=?');$q->execute([$taskId]);
            if($q->fetchColumn())throw new GenesisSharedAccessException('SERIES_EXISTS',409);$q->closeCursor();
        }else{
            $q=$db->prepare('SELECT 1 FROM shared_series_instances WHERE series_id=? AND task_id=?');$q->execute([$seriesId,$taskId]);
            if(!$q->fetchColumn())throw new GenesisSharedAccessException();$q->closeCursor();
        }
        $settings=genesisSharedSeriesSettings($input['settings']??null);
        if(!is_bool($input['paused']??false)||!is_bool($input['refreshTemplate']??false))throw new InvalidArgumentException('SERIES_INVALID');
        $template=(!$old||!empty($input['refreshTemplate']))
            ? genesisSharedSeriesTemplate($actor,$projectId,$taskId,$settings['cloneChildren'])
            : genesisSharedSeriesSavedTemplate($old);
        if($old&&$settings['cloneChildren']!==json_decode($old['rule_json'],true)['cloneChildren']&&empty($input['refreshTemplate']))throw new InvalidArgumentException('SERIES_REFRESH_REQUIRED');
        genesisSharedSeriesValidateTemplate($projectId,$template);
        $now=genesisNow();$id=$seriesId??genesisUuid();$paused=(int)($input['paused']??(bool)($old['paused']??false));
        if($old)$db->prepare('UPDATE shared_task_series SET owner_id=?,rule_json=?,template_json=?,paused=?,source_task_id=?,revision=revision+1,last_error=NULL,updated_at=? WHERE id=?')
            ->execute([$actor,json_encode($settings,JSON_THROW_ON_ERROR),genesisSharedContentEncrypt(json_encode($template,JSON_THROW_ON_ERROR)),$paused,!empty($input['refreshTemplate'])?$taskId:$old['source_task_id'],$now,$id]);
        else{
            $db->prepare('INSERT INTO shared_task_series(id,project_id,source_task_id,owner_id,rule_json,template_json,paused,cursor_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
                ->execute([$id,$projectId,$taskId,$actor,json_encode($settings,JSON_THROW_ON_ERROR),genesisSharedContentEncrypt(json_encode($template,JSON_THROW_ON_ERROR)),$paused,genesisCalendarAddDays($settings['recurrence']['rangeStart'],-1),$now,$now]);
            $date=$task['dueDate']??$settings['recurrence']['rangeStart'];
            $db->prepare("INSERT INTO shared_series_instances VALUES(?,?,?,?,1,'created',?)")->execute([$id,'date:'.$date,$taskId,$date,$now]);
        }
        genesisSharedAudit($projectId,$actor,$old?'series.updated':'series.created',$taskId,['seriesId'=>$id,'revision'=>$old?(int)$old['revision']+1:1,'paused'=>(bool)$paused]);
        $result=genesisSharedSeriesRead($actor,$projectId,$id);
        genesisSharedSaveMutationReceipt($db,$actor,$requestId,$action,$resource,$result, $payloadHash);
        $db->commit();return $result;
    }catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
}

function genesisSharedSeriesAfterCandidate(array $series,array $settings): ?array
{
    $q=genesisDb()->prepare("SELECT i.*,t.completed_at,t.revision FROM shared_series_instances i LEFT JOIN shared_tasks_read t ON t.id=i.task_id WHERE i.series_id=? AND i.state='created' ORDER BY i.ordinal DESC LIMIT 1");
    $q->execute([$series['id']]);$previous=$q->fetch();$q->closeCursor();
    $zone=new DateTimeZone($settings['recurrence']['calendarContext']['timeZone']);
    $q=genesisDb()->prepare('SELECT ordinal,state,original_date FROM shared_series_instances WHERE series_id=? ORDER BY ordinal DESC LIMIT 1');
    $q->execute([$series['id']]);$latest=$q->fetch();$q->closeCursor();
    if(!$latest || ($latest['state']!=='skipped' && (!$previous||!$previous['completed_at'])))return null;
    $base=$latest['state']==='skipped'?$latest['original_date']:(new DateTimeImmutable($previous['completed_at']))->setTimezone($zone)->format('Y-m-d');
    $date=genesisCalendarAddDays($base,$settings['delayDays']);
    if($date<'1900-01-01'||$date>'2100-12-31'||($settings['recurrence']['rangeEnd']!==''&&$date>$settings['recurrence']['rangeEnd']))return null;
    return ['date'=>max($date,$settings['recurrence']['rangeStart']),
        'triggerRevision'=>$previous['revision']??0,
        'key'=>$latest['state']==='skipped'?'after-skip:'.$latest['ordinal']:'after:'.$previous['task_id']];
}

/** Skips one open instance, retaining its content and tree in the existing task archive. */
function genesisSharedSeriesSkip(string $actor,string $projectId,string $taskId,array $input): array
{
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        $seriesId=(string)($input['seriesId']??'');
        $series=genesisSharedSeriesAccess($actor,$projectId,$seriesId,true);
        $request=genesisSharedRequestId($input);
        if($request===null)throw new InvalidArgumentException('SERIES_REQUEST_REQUIRED');
        $payloadHash=genesisSharedMutationPayloadHash('series.skip',$input,['projectId'=>$projectId]);
        $receipt=genesisSharedMutationReceipt($db,$actor,$request,'series.skip',$taskId, $payloadHash);
        if($receipt!==null){$db->commit();return $receipt;}
        if(($input['expectedRevision']??null)!==(int)$series['revision'])throw new GenesisSharedAccessException('SERIES_CONFLICT',409);
        $task=genesisSharedGetTask($actor,$projectId,$taskId);
        if(($input['taskRevision']??null)!==$task['revision'])throw new GenesisSharedAccessException('SHARED_TASK_CONFLICT',409);
        if($task['completedAt'])throw new InvalidArgumentException('SERIES_COMPLETED_INSTANCE');
        $q=$db->prepare("SELECT 1 FROM shared_series_instances WHERE task_id=? AND series_id=? AND state='created'");
        $q->execute([$taskId,$seriesId]);
        if(!$q->fetchColumn())throw new GenesisSharedAccessException();$q->closeCursor();
        genesisSharedArchiveTask($actor,$projectId,$taskId,['archived'=>true,'expectedRevision'=>$task['revision']]);
        $db->prepare("UPDATE shared_series_instances SET state='skipped' WHERE task_id=? AND series_id=?")->execute([$taskId,$seriesId]);
        $db->prepare('UPDATE shared_task_series SET revision=revision+1,updated_at=? WHERE id=?')->execute([genesisNow(),$seriesId]);
        genesisSharedAudit($projectId,$actor,'series.instance.skipped',$taskId,['seriesId'=>$seriesId]);
        $result=genesisSharedSeriesRead($actor,$projectId,$seriesId);
        genesisSharedSaveMutationReceipt($db,$actor,$request,'series.skip',$taskId,$result, $payloadHash);
        $db->commit();return $result;
    }catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
}

function genesisSharedSeriesEnqueue(): void
{
    $q=genesisDb()->query("SELECT * FROM shared_task_series WHERE paused=0 AND owner_id IS NOT NULL AND generated_count<json_extract(rule_json,'$.limit') ORDER BY checked_at,id LIMIT 100");
    foreach($q->fetchAll() as $series){
        // Rotate every inspected row, including waiting/future/error cases.
        genesisDb()->prepare('UPDATE shared_task_series SET checked_at=? WHERE id=?')->execute([genesisNow(),$series['id']]);
        $settings=json_decode($series['rule_json'],true,32,JSON_THROW_ON_ERROR);
        if((int)$series['generated_count']>=$settings['limit'])continue;
        $today=(new DateTimeImmutable('now',new DateTimeZone($settings['recurrence']['calendarContext']['timeZone'])))->format('Y-m-d');
        if($settings['timing']==='schedule'&&$series['cursor_date']>=$today)continue;
        $trigger='';
        if($settings['timing']==='after-completion'){
            $candidate=genesisSharedSeriesAfterCandidate($series,$settings);
            if(!$candidate||$candidate['date']>$today)continue;
            $trigger=':'.$candidate['key'].':'.$candidate['date'].':'.$candidate['triggerRevision'];
        }
        $key='series:'.$series['id'].':'.$series['revision'].':'.$series['cursor_date'].':'.$series['generated_count'].':'.$today;
        genesisBackgroundEnqueue('shared-series',$key.$trigger,['seriesId'=>$series['id'],'revision'=>(int)$series['revision'],'throughDate'=>$today]);
    }
}

/** New shifted deadlines must stay inside the selectable range; saved history is unchanged. */
function genesisSharedSeriesShiftDate(string $date,?int $offset): ?string
{
    if($offset===null)return null;
    $shifted=genesisCalendarAddDays($date,$offset);
    if($shifted<'1900-01-01'||$shifted>'2100-12-31')throw new InvalidArgumentException('SERIES_INVALID');
    return $shifted;
}

/** Caller holds the writer lock. IDs are recorded atomically with the generated tree. */
function genesisSharedSeriesMaterialize(array $series,array $settings,string $key,string $date): bool
{
    $db=genesisDb();$q=$db->prepare('SELECT 1 FROM shared_series_instances WHERE series_id=? AND occurrence_key=?');$q->execute([$series['id'],$key]);
    if($q->fetchColumn()){$q->closeCursor();return false;}$q->closeCursor();
    $ordinal=(int)$series['generated_count']+1;
    if(in_array($date,$settings['excludedDates'],true)){
        $db->prepare("INSERT INTO shared_series_instances VALUES(?,?,NULL,?,?,'skipped',?)")->execute([$series['id'],$key,$date,$ordinal,genesisNow()]);
        return true;
    }
    $nodes=genesisSharedSeriesSavedTemplate($series);
    genesisSharedSeriesValidateTemplate($series['project_id'],$nodes);
    $ids=[];$newLists=[];$created=[];
    foreach($nodes as $node){
        $q=$db->prepare('SELECT 1 FROM shared_project_statuses WHERE id=? AND project_id=? AND is_done=0');
        $q->execute([$node['statusId'],$series['project_id']]);
        if(!$q->fetchColumn())throw new InvalidArgumentException('SERIES_TEMPLATE_UNAVAILABLE');$q->closeCursor();
        $lists=$node['checklists'];
        foreach($lists as &$list){$list['id']=genesisUuid();foreach($list['items'] as &$item){
            $item['id']=genesisUuid();$item['done']=false;$item['linkedTaskId']=null;
            $item['dueDate']=genesisSharedSeriesShiftDate($date,$item['dueOffset']);unset($item['dueOffset']);
        }unset($item);}unset($list);
        $offset=static fn($n)=>genesisSharedSeriesShiftDate($date,$n);
        $input=['title'=>$node['title'],'description'=>$node['description'],'tags'=>$node['tags'],'entryType'=>$node['entryType'],
            'statusId'=>$node['statusId'],'categoryId'=>$node['categoryId'],'assigneeId'=>$node['assigneeId'],
            'priority'=>$node['priority'],'checklists'=>$lists,'parentTaskId'=>$ids[$node['parentSourceId']]??null,
            'customFields'=>(array)($node['customFields']??[]),
            'dueDate'=>$offset($node['dueOffset']),'startDate'=>$offset($node['startOffset']),'startTime'=>$node['startTime'],'endTime'=>$node['endTime'],
            'labelIds'=>$node['labelIds'],'approvalRequired'=>(bool)$node['approverIds'],'approverIds'=>$node['approverIds']];
        // Permissions, members, status, approval configuration and all task validators run again.
        $task=genesisSharedTask($series['owner_id'],$series['project_id'],$input);
        $ids[$node['sourceId']]=$task['id'];$created[$node['sourceId']]=$task;$newLists[$node['sourceId']]=$lists;
    }
    foreach($nodes as $node){
        $task=$created[$node['sourceId']];$lists=$newLists[$node['sourceId']];$links=false;
        foreach($node['checklists'] as $li=>$list)foreach($list['items'] as $ii=>$item)if(isset($ids[$item['linkedTaskId']??''])){
            $lists[$li]['items'][$ii]['linkedTaskId']=$ids[$item['linkedTaskId']];$links=true;
        }
        if($links)$db->prepare('UPDATE shared_tasks SET checklists_json=? WHERE id=?')->execute([json_encode($lists,JSON_THROW_ON_ERROR),$task['id']]);
        $deps=array_values(array_filter(array_map(static fn($id)=>$ids[$id]??null,$node['dependsOnSources'])));
        if($deps)genesisSharedAssignDependencies($series['project_id'],$task['id'],['dependsOnIds'=>$deps]);
    }
    $root=$created[$nodes[0]['sourceId']]['id'];
    $db->prepare("INSERT INTO shared_series_instances VALUES(?,?,?,?,?,'created',?)")->execute([$series['id'],$key,$root,$date,$ordinal,genesisNow()]);
    genesisSharedAudit($series['project_id'],$series['owner_id'],'series.instance.created',$root,['seriesId'=>$series['id'],'occurrenceDate'=>$date,'ordinal'=>$ordinal]);
    return true;
}

function genesisSharedSeriesGenerate(array $payload): string
{
    $db=genesisDb();$q=$db->prepare('SELECT * FROM shared_task_series WHERE id=?');$q->execute([$payload['seriesId']??'']);$series=$q->fetch();$q->closeCursor();
    if(!$series||$series['paused']||(int)$series['revision']!==($payload['revision']??null))return 'cancelled';
    if(!$series['owner_id'])throw new GenesisSharedAccessException('SHARED_PROJECT_FORBIDDEN',403);
    genesisSharedRequireEnabled($series['owner_id']);
    genesisSharedProjectAccess($series['project_id'],$series['owner_id'],'organize');genesisSharedProjectAccess($series['project_id'],$series['owner_id'],'write');
    $settings=json_decode($series['rule_json'],true,32,JSON_THROW_ON_ERROR);
    $actualToday=(new DateTimeImmutable('now',new DateTimeZone($settings['recurrence']['calendarContext']['timeZone'])))->format('Y-m-d');
    $through=min($payload['throughDate']??$actualToday,$actualToday,'2100-12-31');
    if((int)$series['generated_count']>=$settings['limit'])return 'cancelled';
    if($settings['timing']==='after-completion'){
        $candidate=genesisSharedSeriesAfterCandidate($series,$settings);
        if($candidate&&$candidate['date']<=$through && genesisSharedSeriesMaterialize($series,$settings,$candidate['key'],$candidate['date']))$series['generated_count']++;
    }else{
        $made=0;
        for($i=0,$date=genesisCalendarAddDays($series['cursor_date'],1);$i<366&&$date<=$through&&$made<5&&(int)$series['generated_count']<$settings['limit'];$i++,$date=genesisCalendarAddDays($date,1)){
            $series['cursor_date']=$date;
            if(genesisRecurrenceMatches($settings['recurrence']['rangeStart'],$settings['recurrence'],$date)
                &&genesisSharedSeriesMaterialize($series,$settings,'date:'.$date,$date)){$series['generated_count']++;$made++;}
        }
    }
    $db->prepare('UPDATE shared_task_series SET cursor_date=?,generated_count=?,last_error=NULL,updated_at=? WHERE id=?')
        ->execute([$series['cursor_date'],$series['generated_count'],genesisNow(),$series['id']]);
    return 'succeeded';
}
