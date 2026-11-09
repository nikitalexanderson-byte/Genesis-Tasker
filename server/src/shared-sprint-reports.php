<?php
declare(strict_types=1);
require_once __DIR__.'/shared-sprint-flow-model.php';

/** Read within the caller's consistent SQLite snapshot. Historical names are never a source of current access. */
function genesisSprintReportPlan(string $actor,string $projectId,string $sprintId,string $unit,string $asOf):array
{
    genesisSharedRequireEnabled($actor);$project=genesisSharedProjectAccess($projectId,$actor);
    if((int)$project['is_inbox']===1)throw new InvalidArgumentException('PLANNING_PROJECT_REQUIRED');
    $sprint=genesisPlanningSprintRecord(genesisPlanningSprint($projectId,$sprintId));
    if(!in_array($unit,['tasks','points','hours'],true))throw new InvalidArgumentException('SPRINT_REPORT_UNIT_INVALID');
    $db=genesisDb();$start=null;$terminal=null;$ids=[];$sources=[];
    $lifecycle=genesisPlanningRows("SELECT e.*,r.rowid AS sequence FROM shared_audit_events_read e JOIN shared_audit_events r ON r.id=e.id WHERE e.project_id=? AND e.object_id=? AND e.action IN ('sprint.started','sprint.completed') ORDER BY r.rowid",[$projectId,$sprintId]);
    foreach($lifecycle as $event){
        $details=json_decode($event['details_json'],true,128);$details=is_array($details)?$details:[];
        $entry=['id'=>$event['id'],'sequence'=>(int)$event['sequence'],'at'=>genesisSprintFlowInstant($event['created_at']),'plan'=>$details['plan']??null,'outcomes'=>$details['outcomes']??[],
            'sprint'=>$details['sprint']??null];
        if($event['action']==='sprint.started'){
            if($start!==null)throw new GenesisSharedAccessException('SPRINT_REPORT_HISTORY_INVALID',409);$start=$entry;
        }else{
            if($terminal!==null)throw new GenesisSharedAccessException('SPRINT_REPORT_HISTORY_INVALID',409);$terminal=$entry;
        }
        foreach(is_array($entry['plan'])?$entry['plan']:[] as $task)if(is_array($task)&&is_string($task['taskId']??null))$ids[$task['taskId']]=true;
        $sources[$event['id']]=['id'=>$event['id'],'sequence'=>(int)$event['sequence'],'at'=>$entry['at'],'action'=>$event['action'],'kind'=>'lifecycle'];
    }
    $from=$start['sequence']??PHP_INT_MAX;$to=$terminal['sequence']??PHP_INT_MAX;
    $query=$db->prepare("SELECT e.*,r.rowid AS sequence FROM shared_audit_events_read e JOIN shared_audit_events r ON r.id=e.id WHERE e.project_id=? AND e.action LIKE 'task.%' AND r.rowid>? AND r.rowid<? ORDER BY r.rowid");
    $query->execute([$projectId,$from,$to]);$events=[];
    while($row=$query->fetch()){
        if(count($events)>=20000)throw new GenesisSharedAccessException('SPRINT_REPORT_TOO_LARGE',413);
        $event=genesisSprintFlowEvent($row);if($event['taskId']!=='')$ids[$event['taskId']]=true;
        $events[]=$event;
    }
    $query->closeCursor();
    // Last pre-start observations are evidence for backlog entry/revisions. No current state is backdated.
    $query=$db->prepare("SELECT e.*,r.rowid AS sequence FROM shared_audit_events_read e JOIN shared_audit_events r ON r.id=e.id JOIN (SELECT MAX(rowid) AS sequence FROM shared_audit_events WHERE project_id=? AND action LIKE 'task.%' AND rowid<? GROUP BY COALESCE(task_id,object_id)) latest ON latest.sequence=r.rowid ORDER BY r.rowid");
    $query->execute([$projectId,$from]);$outside=[];
    while($row=$query->fetch()){
        if(count($outside)>=20000)throw new GenesisSharedAccessException('SPRINT_REPORT_TOO_LARGE',413);
        $event=genesisSprintFlowEvent($row);if($event['taskId']!=='')$ids[$event['taskId']]=true;$outside[]=$event;
    }
    $query->closeCursor();
    foreach(genesisPlanningRows('SELECT id FROM shared_tasks_history_read WHERE project_id=?',[$projectId]) as $row)$ids[$row['id']]=true;
    if(count($ids)>20000)throw new GenesisSharedAccessException('SPRINT_REPORT_TOO_LARGE',413);
    genesisReportTempIds('genesis_report_tasks',array_keys($ids));
    $rows=genesisPlanningRows('SELECT t.id,t.project_id,t.title,t.status_id,t.assignee_id,t.completed_at,t.archived_at,t.revision,a.sprint_id AS planning_sprint_id,a.estimates_json AS planning_estimates,0 AS trashed
        FROM shared_tasks_history_read t JOIN genesis_report_tasks rt ON rt.id=t.id
        JOIN shared_projects p ON p.id=t.project_id JOIN shared_project_members m ON m.project_id=p.id AND m.user_id=?
        JOIN shared_space_members sm ON sm.space_id=p.space_id AND sm.user_id=m.user_id LEFT JOIN shared_task_planning a ON a.task_id=t.id
        WHERE NOT EXISTS(SELECT 1 FROM shared_trash tr WHERE tr.kind=\'project\' AND tr.object_id=p.id) ORDER BY t.id',[$actor]);
    $readable=[];$current=[];
    foreach($rows as $row){
        $state=genesisPlanningTaskState($row);$readable[$row['id']]=['id'=>$row['id'],'title'=>$row['title'],'projectId'=>$row['project_id'],'archived'=>$row['archived_at']!==null,'revision'=>(int)$row['revision']];
        if($row['project_id']===$projectId)$current[]=$state;
    }
    $safePlan=static function(mixed $plan)use($readable):?array{
        if(!is_array($plan)||!array_is_list($plan))return null;$result=[];
        foreach($plan as $raw){$id=is_array($raw)?($raw['taskId']??null):null;$result[]=is_string($id)&&isset($readable[$id])?$raw:(is_string($id)?['taskId'=>$id,'unavailable'=>true]:['unavailable'=>true]);}
        return $result;
    };
    if($start){$start['plan']=$safePlan($start['plan']);$start['outsidePlan']=[];}
    if($terminal){
        $terminal['plan']=$safePlan($terminal['plan']);$safe=[];
        foreach(is_array($terminal['outcomes'])?$terminal['outcomes']:[] as $id=>$target)if(isset($readable[$id])&&($target===null||is_string($target)))$safe[$id]=$target;
        $terminal['outcomes']=$safe;
    }
    foreach($outside as $event){
        $id=$event['taskId'];
        if(isset($readable[$id])&&$event['state']!==null&&$start)$start['outsidePlan'][]=$event['state'];
        if(isset($readable[$id]))$sources[$event['id']]=[...$event,'kind'=>'pre-start'];
    }
    foreach($events as &$event){
        if(!isset($readable[$event['taskId']])){$event['state']=null;$event['outside']=false;$event['revision']=null;}
        $sources[$event['id']]=[...$event,'kind'=>'task'];
    }unset($event);
    // The frozen launch context controls grouping, independent of today's display settings.
    $launchData=$start['sprint']??null;
    $trustedContext=$start===null||is_array($launchData)&&($launchData['calendarContext']['version']??null)===2
        &&in_array($launchData['calendarMode']??null,['profane','sacred','lunar'],true)&&genesisDataDate($launchData['startDate']??null)!==null&&genesisDataDate($launchData['endDate']??null)!==null;
    $launch=$start!==null&&$trustedContext?$launchData:$sprint;
    $context=genesisCalendarContext($launch['calendarContext']??$sprint['calendarContext']);
    $flow=$trustedContext?genesisSprintFlowFold($sprintId,$unit,$start,$terminal,$events,$asOf,$sprint['state']==='completed'?null:$current,['resolution'=>'day','timeZone'=>$context['timeZone']])
        :['available'=>false,'reason'=>'launch-context-missing','unit'=>$unit,'series'=>[],'summary'=>null,'gaps'=>[]];
    if($trustedContext&&$sprint['state']==='completed'&&(!$terminal||!is_array($terminal['plan'])||empty($flow['terminal']))){
        $flow=['available'=>false,'reason'=>'terminal-observation-missing','unit'=>$unit,'series'=>[],'summary'=>null,'gaps'=>[]];
    }
    $statuses=genesisPlanningRows('SELECT id,title,color,position,revision,is_done AS isDone FROM shared_project_statuses WHERE project_id=? ORDER BY position,id',[$projectId]);
    $access=array_intersect_key($project,array_flip(['id','revision','archived_at','member_role','space_member_role','space_permissions_json','can_organize_tasks','project_access_restricted','permissions']));
    $fingerprint=genesisDataHash([$actor,$unit,$asOf,$access,$sprint,$statuses,$start,$terminal,$events,$outside,$readable,$current]);
    // Internal unavailable identities are useful for exact unknown counts but must never leave the API.
    $public=$flow;unset($public['initialStates'],$public['currentStates'],$public['scopeChanges'],$public['carrySourceIds']);
    foreach($public['gaps'] as &$gap)if(isset($gap['taskId'])&&!isset($readable[$gap['taskId']])){unset($gap['taskId']);$gap['unavailable']=true;}unset($gap);
    if(isset($public['summary'])){
        $public['scopeChangeCount']=count($flow['scopeChanges']);
        foreach(['completedTaskIds'=>'completedTasksCount','reopenedTaskIds'=>'reopenedTasksCount'] as $key=>$countKey){$public['summary'][$countKey]=count($public['summary'][$key]);unset($public['summary'][$key]);}
    }
    $output=['asOf'=>$asOf,'projectId'=>$projectId,'sprint'=>$sprint,'launch'=>['startDate'=>$launch['startDate'],'endDate'=>$launch['endDate'],'calendarMode'=>$launch['calendarMode'],'calendarContext'=>$context,'estimateUnit'=>$launch['estimateUnit']??$sprint['estimateUnit']],
        'flow'=>$public,'statuses'=>$statuses];
    return compact('output','fingerprint','flow','readable','sources','start','terminal');
}

function genesisSprintReportToken(string $actor,string $project,string $sprint,mixed $token):array
{
    $payload=is_string($token)&&strlen($token)<32000?json_decode(genesisDecrypt($token)??'',true,32):null;
    if(!is_array($payload)||($payload['version']??null)!==1||($payload['kind']??null)!=='sprint-flow'||($payload['actor']??null)!==$actor
        ||($payload['project']??null)!==$project||($payload['sprint']??null)!==$sprint||!is_string($payload['fingerprint']??null)
        ||!in_array($payload['unit']??null,['tasks','points','hours'],true)||!is_string($payload['asOf']??null))throw new InvalidArgumentException('REPORT_TOKEN_INVALID');
    $at=genesisReportTime($payload['asOf']);if($at===null||$at<time()-86400||$at>time()+30)throw new GenesisSharedAccessException('REPORT_CHANGED',409);return $payload;
}

function genesisSharedSprintReport(string $actor,string $project,string $sprint,array $input):array
{
    if(array_diff(array_keys($input),['unit']))throw new InvalidArgumentException('REPORT_INVALID');
    $db=genesisDb();$owns=!$db->inTransaction();if($owns)$db->beginTransaction();
    try{
        genesisSharedRequireEnabled($actor);genesisSharedProjectAccess($project,$actor);
        $record=genesisPlanningSprintRecord(genesisPlanningSprint($project,$sprint));$unit=$input['unit']??$record['estimateUnit']??genesisPlanningConfig($project)['estimateUnit'];
        if(!is_string($unit))throw new InvalidArgumentException('SPRINT_REPORT_UNIT_INVALID');
        $asOf=genesisNow();$plan=genesisSprintReportPlan($actor,$project,$sprint,$unit,$asOf);
        $token=genesisEncrypt(genesisDataJson(['version'=>1,'kind'=>'sprint-flow','actor'=>$actor,'project'=>$project,'sprint'=>$sprint,'unit'=>$unit,'asOf'=>$asOf,'fingerprint'=>$plan['fingerprint']]));
        if($owns)$db->commit();return [...$plan['output'],'token'=>$token];
    }catch(Throwable $error){if($owns&&$db->inTransaction())$db->rollBack();throw $error;}
}

function genesisSharedSprintReportCheck(string $actor,string $project,string $sprint,array $input):array
{
    if(array_diff(array_keys($input),['token']))throw new InvalidArgumentException('REPORT_INVALID');$payload=genesisSprintReportToken($actor,$project,$sprint,$input['token']??null);
    $db=genesisDb();$owns=!$db->inTransaction();if($owns)$db->beginTransaction();
    try{
        $plan=genesisSprintReportPlan($actor,$project,$sprint,$payload['unit'],$payload['asOf']);
        if(!hash_equals($plan['fingerprint'],$payload['fingerprint']))throw new GenesisSharedAccessException('REPORT_CHANGED',409);
        if($owns)$db->commit();return ['unchanged'=>true];
    }catch(Throwable $error){if($owns&&$db->inTransaction())$db->rollBack();throw $error;}
}

/** Exact, current-access sources. A stale token is rejected BEFORE any cached page can be returned. */
function genesisSharedSprintReportSources(string $actor,string $project,string $sprint,array $input):array
{
    if(array_diff(array_keys($input),['token','kind','metric','taskId','date','cursor']))throw new InvalidArgumentException('REPORT_INVALID');
    $payload=genesisSprintReportToken($actor,$project,$sprint,$input['token']??null);$kind=$input['kind']??'tasks';$metric=$input['metric']??'scope';$taskId=$input['taskId']??null;$date=$input['date']??null;
    if(!in_array($kind,['tasks','events','changes'],true)||!is_string($metric)||strlen($metric)>120||$taskId!==null&&(!is_string($taskId)||strlen($taskId)>200))throw new InvalidArgumentException('REPORT_INVALID');
    if($date!==null&&($kind==='tasks'||!is_string($date)||genesisDataDate($date)!==$date))throw new InvalidArgumentException('REPORT_INVALID');
    $position=0;$scope=[$kind,$metric,$taskId,$date];
    if(isset($input['cursor'])){
        $cursor=is_string($input['cursor'])&&strlen($input['cursor'])<4096?json_decode(genesisDecrypt($input['cursor'])??'',true,16):null;
        if(!is_array($cursor)||($cursor['actor']??null)!==$actor||($cursor['fingerprint']??null)!==$payload['fingerprint']||($cursor['scope']??null)!==$scope||!is_int($cursor['position']??null)||$cursor['position']<0)throw new InvalidArgumentException('REPORT_TOKEN_INVALID');
        $position=$cursor['position'];
    }
    $db=genesisDb();$owns=!$db->inTransaction();if($owns)$db->beginTransaction();
    try{
        $plan=genesisSprintReportPlan($actor,$project,$sprint,$payload['unit'],$payload['asOf']);
        if(!hash_equals($plan['fingerprint'],$payload['fingerprint']))throw new GenesisSharedAccessException('REPORT_CHANGED',409);
        if($taskId!==null&&!isset($plan['readable'][$taskId]))throw new GenesisSharedAccessException();
        if($date!==null&&!in_array($date,array_column($plan['flow']['series'],'date'),true))throw new InvalidArgumentException('REPORT_METRIC_INVALID');
        $flow=$plan['flow'];$items=[];$unavailable=0;
        if($kind==='tasks'){
            if(!in_array($metric,['plan','alreadyDone','committed','scope','remaining','done','delivered','carried','reopened'],true))throw new InvalidArgumentException('REPORT_METRIC_INVALID');
            $states=in_array($metric,['plan','alreadyDone','committed'],true)?($flow['initialStates']??[]):($flow['currentStates']??[]);
            $completed=array_fill_keys($flow['summary']['completedTaskIds']??[],true);$reopened=array_fill_keys($flow['summary']['reopenedTaskIds']??[],true);$carry=$plan['terminal']['outcomes']??[];
            foreach($states as $id=>$state){
                if($metric==='reopened')continue;
                if(!genesisSprintFlowInside($state,$sprint)||!isset($plan['readable'][$id])||$taskId!==null&&$id!==$taskId)continue;
                $keep=match($metric){'alreadyDone','done'=>$state['done'],'committed','remaining'=>!$state['done'],'delivered'=>$state['done']&&isset($completed[$id]),'carried'=>!$state['done']&&array_key_exists($id,$carry),'reopened'=>isset($reopened[$id]),default=>true};
                if($keep)$items[]=[...$plan['readable'][$id],'observed'=>$state];
            }
            if($metric==='reopened')foreach($reopened as $id=>$_)if(isset($plan['readable'][$id])&&($taskId===null||$taskId===$id))$items[]=[...$plan['readable'][$id],'observed'=>$states[$id]??null];
            usort($items,static fn($a,$b)=>strcmp($a['id'],$b['id']));$unavailable=$flow['summary'][$metric]['unknownTasks']??0;
        }elseif($kind==='changes'){
            foreach($flow['scopeChanges']??[] as $change)if(isset($plan['readable'][$change['taskId']])&&($taskId===null||$taskId===$change['taskId']))$items[]=[...$change,'task'=>$plan['readable'][$change['taskId']]];
        }else{
            $used=[];foreach($flow['series']??[] as $sample)if($sample['sourceId'])$used[$sample['sourceId']]=true;
            foreach($flow['scopeChanges']??[] as $change)$used[$change['sourceId']]=true;
            foreach($flow['carrySourceIds']??[] as $id)$used[$id]=true;
            foreach($flow['gaps']??[] as $gap)if(isset($gap['sourceId']))$used[$gap['sourceId']]=true;
            if($plan['start'])$used[$plan['start']['id']]=true;if($plan['terminal'])$used[$plan['terminal']['id']]=true;
            // A sampled day still has ALL its underlying observations, including completion/reopen.
            $related=[];foreach($flow['initialStates']??[] as $id=>$state)if($state['sprintId']===$sprint)$related[$id]=true;
            foreach($flow['currentStates']??[] as $id=>$state)if($state['sprintId']===$sprint)$related[$id]=true;
            foreach($flow['scopeChanges']??[] as $change)$related[$change['taskId']]=true;
            foreach($plan['sources'] as $source){
                $id=$source['taskId']??null;if($taskId!==null&&$id!==$taskId)continue;
                if(!isset($used[$source['id']])&&($id===null||!isset($related[$id])))continue;
                if($id!==null&&!isset($plan['readable'][$id])){$items[]=['id'=>$source['id'],'sequence'=>$source['sequence'],'at'=>$source['at'],'action'=>$source['action'],'unavailable'=>true];continue;}
                $item=['id'=>$source['id'],'sequence'=>$source['sequence'],'at'=>$source['at'],'action'=>$source['action'],'kind'=>$source['kind']];
                if($id!==null)$item+=['task'=>$plan['readable'][$id],'observed'=>$source['state'],'leftScope'=>$source['outside'],'completionCarry'=>in_array($source['id'],$flow['carrySourceIds']??[],true)];$items[]=$item;
            }
            usort($items,static fn($a,$b)=>$a['sequence']<=>$b['sequence']);
        }
        if($date!==null){$zone=new DateTimeZone($plan['output']['launch']['calendarContext']['timeZone']);$items=array_values(array_filter($items,static fn($item)=>genesisReportTime($item['at']??null)!==null&&(new DateTimeImmutable($item['at']))->setTimezone($zone)->format('Y-m-d')===$date));}
        $total=count($items);$page=array_slice($items,$position,100);$next=$position+count($page);
        $nextCursor=$next<$total?genesisEncrypt(genesisDataJson(['actor'=>$actor,'fingerprint'=>$payload['fingerprint'],'scope'=>$scope,'position'=>$next])):null;
        if($owns)$db->commit();return ['items'=>$page,'total'=>$total,'unavailable'=>$unavailable,'nextCursor'=>$nextCursor,'asOf'=>$payload['asOf']];
    }catch(Throwable $error){if($owns&&$db->inTransaction())$db->rollBack();throw $error;}
}
