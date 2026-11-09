<?php
declare(strict_types=1);
require_once __DIR__.'/shared-reports-history.php';

function genesisReportInput(array $input):array{
    if(array_diff(array_keys($input),['filter','from','to','calendarMode','calendarContext','cycleStartStatusIds']))throw new InvalidArgumentException('REPORT_INVALID');
    $filter=$input['filter']??[];if(!is_array($filter)||$filter&&array_is_list($filter)||strlen(genesisDataJson($filter))>8000)throw new InvalidArgumentException('INVALID_TASK_FILTER');
    $from=genesisDataDate($input['from']??null);$to=genesisDataDate($input['to']??null);if($from===null||$to===null||$from>$to||(new DateTimeImmutable($from))->diff(new DateTimeImmutable($to))->days>=3660)throw new InvalidArgumentException('REPORT_PERIOD_INVALID');
    $mode=$input['calendarMode']??'profane';if(!in_array($mode,['profane','sacred','lunar'],true))throw new InvalidArgumentException('REPORT_INVALID');$context=genesisCalendarContext($input['calendarContext']??null,'Europe/Moscow',2);if($context['version']!==2)throw new InvalidArgumentException('REPORT_CONTEXT_INVALID');
    $starts=genesisSharedQueryIds($input['cycleStartStatusIds']??[]);return ['filter'=>$filter,'from'=>$from,'to'=>$to,'calendarMode'=>$mode,'calendarContext'=>$context,'cycleStartStatusIds'=>$starts];
}

function genesisReportTempIds(string $table,array $ids):void{
    if(!in_array($table,['genesis_report_projects','genesis_report_tasks'],true))throw new LogicException('Invalid report temp table');$db=genesisDb();$db->exec('CREATE TEMP TABLE IF NOT EXISTS '.$table.'(id TEXT PRIMARY KEY)');$db->exec('DELETE FROM '.$table);$q=$db->prepare('INSERT INTO '.$table.' VALUES(?)');foreach(array_unique($ids) as $id)$q->execute([$id]);
}

/** Scope metadata only: suitable for a small periodic revoke/change check. */
function genesisReportState(string $actor,array $options,string $asOf):array{
    genesisSharedRequireEnabled($actor);[$filter,$sort,$view]=genesisSharedViewQuery($actor,$options['filter'],'position');$scope=genesisSharedQueryScope($actor,$filter);[$where,$values]=genesisSharedTaskPredicate($actor,$filter,$scope);
    genesisReportTempIds('genesis_report_projects',array_column($scope,'id'));$projects=genesisDataRows('SELECT p.id,p.space_id AS spaceId,p.title FROM shared_projects p JOIN genesis_report_projects rp ON rp.id=p.id ORDER BY p.id');
    $statuses=genesisDataRows('SELECT s.id,s.project_id AS projectId,s.title,s.is_done AS isDone,s.revision FROM shared_project_statuses s JOIN genesis_report_projects rp ON rp.id=s.project_id ORDER BY s.project_id,s.position,s.id');foreach($statuses as &$status){$status['isDone']=(bool)$status['isDone'];$status['revision']=(int)$status['revision'];}unset($status);$statusIndex=array_column($statuses,null,'id');
    foreach($options['cycleStartStatusIds'] as $id)if(!isset($statusIndex[$id])||$statusIndex[$id]['isDone'])throw new GenesisSharedAccessException('REPORT_STATUS_CHANGED',409);
    $members=genesisDataRows("SELECT DISTINCT m.user_id AS id,COALESCE(u.display_name,'') AS title FROM shared_project_members m JOIN genesis_report_projects rp ON rp.id=m.project_id LEFT JOIN users u ON u.id=m.user_id ORDER BY m.user_id");
    $fields=[];$projectSet=array_fill_keys(array_column($scope,'id'),true);foreach(array_unique(array_column($scope,'space_id')) as $space)foreach(genesisSharedCustomFields($actor,$space) as $field)if($field['projectId']===null||isset($projectSet[$field['projectId']]))$fields[]=$field;
    $audit=genesisDataRows('SELECT COUNT(*) AS n,COALESCE(MAX(e.rowid),0) AS last FROM shared_audit_events e JOIN genesis_report_projects rp ON rp.id=e.project_id');
    $fingerprint=genesisDataHash([$actor,$options,$filter,$view,$scope,$statuses,$members,$fields,$audit,$asOf]);return compact('filter','scope','where','values','projects','statuses','statusIndex','members','fields','fingerprint');
}

function genesisReportOverlap(float $a,float $b,float $from,float $to):bool{return $a<$to&&$b>$from;}
function genesisReportPlan(string $actor,array $options,string $asOf):array{
    $db=genesisDb();$state=genesisReportState($actor,$options,$asOf);$asOfTime=genesisReportTime($asOf);if($asOfTime===null)throw new InvalidArgumentException('REPORT_INVALID');$zone=new DateTimeZone($options['calendarContext']['timeZone']);
    $begin=(float)(new DateTimeImmutable($options['from'].'T00:00:00',$zone))->format('U');$end=(float)(new DateTimeImmutable(genesisCalendarAddDays($options['to'],1).'T00:00:00',$zone))->format('U');
    $today=(new DateTimeImmutable($asOf))->setTimezone($zone);$rows=genesisDataRows('SELECT t.id,t.project_id,t.status_id,t.assignee_id,t.created_at,t.completed_at,t.archived_at,t.revision,t.due_date,t.start_time,t.end_time FROM shared_tasks_history_read t WHERE '.$state['where'].' ORDER BY t.id',$state['values']);$tasks=array_column($rows,null,'id');genesisReportTempIds('genesis_report_tasks',array_keys($tasks));
    $selection=[];$add=static function(string $key,string $id)use(&$selection):void{$selection[$key][$id]=true;};
    [$overWhere,$overValues]=genesisSharedTaskPredicate($actor,['includeArchived'=>true,'overdueDate'=>$today->format('Y-m-d'),'overdueTime'=>$today->format('H:i')],$state['scope']);
    foreach(genesisDataRows('SELECT t.id FROM shared_tasks_history_read t JOIN genesis_report_tasks rt ON rt.id=t.id WHERE '.$overWhere,$overValues) as $row)$add('overdue',$row['id']);
    $ages=[];$memberGroups=[];$memberNames=array_column($state['members'],'title','id');
    foreach($tasks as $id=>$task){$add('all',$id);$complete=$task['completed_at']!==null;$add($complete?'completed':'open',$id);$member=$task['assignee_id']??'unassigned';$add('member:'.$member,$id);$add('member-'.($complete?'completed:':'open:').$member,$id);if($member==='unassigned')$add('unassigned',$id);$memberGroups[$member]=true;
        if(!$complete){$created=genesisReportTime($task['created_at']);$age=$created===null||$created>$asOfTime?null:$asOfTime-$created;$bucket=$age===null?'unknown':($age<7*86400?'week':($age<30*86400?'month':($age<90*86400?'quarter':'older')));$ages[$id]=$age;$add('age:'.$bucket,$id);}
    }
    // Resolve former assignees only when actually present on a readable selected task.
    foreach(array_keys($memberGroups) as $id)if($id!=='unassigned'&&!isset($memberNames[$id])){$name=genesisDataRows('SELECT display_name FROM users WHERE id=?',[$id]);$memberNames[$id]=$name[0]['display_name']??'';}
    $histories=[];$points=[];$current=null;$starts=array_fill_keys($options['cycleStartStatusIds'],true);
    $query=$db->query("SELECT rt.id AS selected_id,e.*,r.rowid AS sequence FROM shared_audit_events_read e JOIN shared_audit_events r ON r.id=e.id JOIN genesis_report_tasks rt ON rt.id=COALESCE(e.task_id,CASE WHEN e.action LIKE 'task.%' THEN e.object_id END) JOIN genesis_report_projects rp ON rp.id=e.project_id WHERE e.action LIKE 'task.%' ORDER BY rt.id,e.created_at,r.rowid");
    while($event=$query->fetch()){$id=$event['selected_id'];if($current!==null&&$current!==$id){$histories[$current]=genesisReportTaskHistory($tasks[$current],$points,$starts,$asOfTime);$points=[];}$current=$id;$points[]=genesisReportPoint($event,$state['statusIndex']);}
    if($current!==null)$histories[$current]=genesisReportTaskHistory($tasks[$current],$points,$starts,$asOfTime);$query->closeCursor();
    $days=[];for($date=$options['from'];$date<=$options['to'];$date=genesisCalendarAddDays($date,1)){$dayStart=(float)(new DateTimeImmutable($date.'T00:00:00',$zone))->format('U');$dayEnd=(float)(new DateTimeImmutable(genesisCalendarAddDays($date,1).'T00:00:00',$zone))->format('U');$days[$date]=['date'=>$date,'from'=>$dayStart,'to'=>$dayEnd,'unknown'=>0,'eligible'=>0];}
    $stages=[];$cycles=[];$eligibleCycle=0;
    foreach($tasks as $id=>$task){$history=$histories[$id]??genesisReportTaskHistory($task,[],$starts,$asOfTime);$created=genesisReportTime($task['created_at']);$completed=genesisReportTime($task['completed_at']);
        foreach($history['segments'] as $segment){$from=max($begin,$segment['from']);$to=min($end,$asOfTime,$segment['to']);if($to<$from||!genesisReportOverlap($segment['from'],$segment['to']+0.000001,$begin,min($end,$asOfTime+0.000001)))continue;$status=$segment['statusId'];$key='stage:'.$status;$stages[$status]=($stages[$status]??0)+max(0,$to-$from);$add($key,$id);}
        $unknown=false;foreach($history['unknown'] as $gap)if(genesisReportOverlap($gap['from'],$gap['to'],$begin,min($end,$asOfTime))){$unknown=true;break;}if($unknown)$add('history:unknown',$id);
        $last=$history['lastCompletion'];$completionTime=$last['time']??$completed;if($task['completed_at']!==null&&$completionTime!==null&&$completionTime>=$begin&&$completionTime<$end&&$completionTime<=$asOfTime){$eligibleCycle++;$known=$last!==null&&$last['seconds']!==null;$add($known?'cycle:known':'cycle:unknown',$id);if($known)$cycles[]=$last['seconds'];}
        foreach($history['changes'] as $change){if($change['time']<$begin||$change['time']>=$end||$change['time']>$asOfTime)continue;$date=(new DateTimeImmutable('@'.(int)$change['time']))->setTimezone($zone)->format('Y-m-d');$add('day:'.$date.':'.$change['type'],$id);}
        foreach($days as $date=>&$day){if($day['from']>$asOfTime||$created!==null&&$created>=$day['to'])continue;$day['eligible']++;foreach($history['unknown'] as $gap)if(genesisReportOverlap($gap['from'],$gap['to'],$day['from'],min($day['to'],$asOfTime))){$day['unknown']++;$add('day:'.$date.':unknown',$id);break;}}unset($day);
    }
    $estimates=genesisPlanningReportEstimates($tasks,$state['projects'],$add);
    $metric=static fn(string $key):array=>['key'=>$key,'count'=>count($selection[$key]??[])];$summary=[];foreach(['all','open','completed','overdue','unassigned'] as $key)$summary[$key]=$metric($key);
    $members=[];foreach(array_keys($memberGroups) as $id)$members[]=['id'=>$id,'title'=>$id==='unassigned'?null:($memberNames[$id]??''),'all'=>$metric('member:'.$id),'open'=>$metric('member-open:'.$id),'completed'=>$metric('member-completed:'.$id)];
    $stageRows=[];foreach($stages as $id=>$seconds){$status=$state['statusIndex'][$id]??null;$stageRows[]=['id'=>$id,'title'=>$status['title']??null,'projectId'=>$status['projectId']??null,'seconds'=>$seconds,'tasks'=>$metric('stage:'.$id)];}
    $ageRows=[];foreach(['week','month','quarter','older','unknown'] as $id)$ageRows[]=['id'=>$id,'tasks'=>$metric('age:'.$id)];
    $daily=[];foreach($days as $date=>$day){$coverage=$day['from']>$asOfTime?'future':($day['eligible']===0&&$tasks?'unknown':($day['unknown']===0?'observed':($day['unknown']===$day['eligible']?'unknown':'partial')));$daily[]=['date'=>$date,'coverage'=>$coverage,'created'=>$metric('day:'.$date.':created'),'completed'=>$metric('day:'.$date.':completed'),'reopened'=>$metric('day:'.$date.':reopened'),'unknown'=>$metric('day:'.$date.':unknown')];}
    sort($cycles,SORT_NUMERIC);$n=count($cycles);$mean=$n?array_sum($cycles)/$n:null;$median=$n?($cycles[(int)floor(($n-1)/2)]+$cycles[(int)floor($n/2)])/2:null;
    $cycle=['meanSeconds'=>$mean,'medianSeconds'=>$median,'eligible'=>$eligibleCycle,'known'=>$metric('cycle:known'),'unknown'=>$metric('cycle:unknown')];
    $catalog=['projects'=>$state['projects'],'statuses'=>$state['statuses'],'members'=>$state['members'],'customFieldDefinitions'=>$state['fields']];$output=['asOf'=>$asOf,'period'=>['from'=>$options['from'],'to'=>$options['to'],'calendarMode'=>$options['calendarMode'],'calendarContext'=>$options['calendarContext']],'filter'=>$state['filter'],'summary'=>$summary,'members'=>$members,'stages'=>$stageRows,'ages'=>$ageRows,'daily'=>$daily,'cycle'=>$cycle,'unknown'=>$metric('history:unknown'),'catalog'=>$catalog,'estimates'=>$estimates];
    return ['output'=>$output,'selection'=>$selection,'fingerprint'=>$state['fingerprint']];
}

function genesisReportToken(string $actor,string $token):array{
    $payload=strlen($token)<32000?json_decode(genesisDecrypt($token)??'',true,32):null;
    if(!is_array($payload)||($payload['version']??null)!==1||($payload['actor']??null)!==$actor||!is_string($payload['fingerprint']??null)||!is_string($payload['asOf']??null)||!is_array($payload['options']??null))throw new InvalidArgumentException('REPORT_TOKEN_INVALID');
    if((genesisReportTime($payload['asOf'])??0)<time()-86400)throw new GenesisSharedAccessException('REPORT_CHANGED',409);$payload['options']=genesisReportInput($payload['options']);return $payload;
}
function genesisSharedReport(string $actor,array $input):array{
    $options=genesisReportInput($input);$db=genesisDb();$owns=!$db->inTransaction();if($owns)$db->beginTransaction();try{$asOf=genesisNow();$plan=genesisReportPlan($actor,$options,$asOf);$token=genesisEncrypt(genesisDataJson(['version'=>1,'actor'=>$actor,'options'=>$options,'asOf'=>$asOf,'fingerprint'=>$plan['fingerprint']]));if($owns)$db->commit();return [...$plan['output'],'token'=>$token];}catch(Throwable $error){if($owns&&$db->inTransaction())$db->rollBack();throw $error;}
}
function genesisSharedReportCheck(string $actor,string $token):array{
    $payload=genesisReportToken($actor,$token);$state=genesisReportState($actor,$payload['options'],$payload['asOf']);if(!hash_equals($state['fingerprint'],$payload['fingerprint']))throw new GenesisSharedAccessException('REPORT_CHANGED',409);return ['unchanged'=>true];
}
function genesisSharedReportTasks(string $actor,array $input):array{
    if(array_diff(array_keys($input),['token','metric','cursor'])||!is_string($input['token']??null)||!is_string($input['metric']??null)||strlen($input['metric'])>300)throw new InvalidArgumentException('REPORT_INVALID');$payload=genesisReportToken($actor,$input['token']);$metric=$input['metric'];$cursor=$input['cursor']??null;$after='';
    if($cursor!==null){$position=is_string($cursor)&&strlen($cursor)<4096?json_decode(genesisDecrypt($cursor)??'',true):null;if(!is_array($position)||($position['metric']??null)!==$metric||($position['fingerprint']??null)!==$payload['fingerprint']||($position['actor']??null)!==$actor||!is_string($position['id']??null))throw new InvalidArgumentException('REPORT_TOKEN_INVALID');$after=$position['id'];}
    $db=genesisDb();$owns=!$db->inTransaction();if($owns)$db->beginTransaction();try{$plan=genesisReportPlan($actor,$payload['options'],$payload['asOf']);if(!hash_equals($plan['fingerprint'],$payload['fingerprint']))throw new GenesisSharedAccessException('REPORT_CHANGED',409);
        // Empty published metrics are valid selections too; arbitrary keys must not become an unfiltered query.
        $known=['all','open','completed','overdue','unassigned','history:unknown','cycle:known','cycle:unknown','age:week','age:month','age:quarter','age:older','age:unknown',...genesisPlanningReportMetrics($plan['output']['estimates'])];foreach($plan['output']['daily'] as $day)foreach(['created','completed','reopened','unknown'] as $kind)$known[]='day:'.$day['date'].':'.$kind;foreach($plan['output']['members'] as $member)foreach(['member:','member-open:','member-completed:'] as $prefix)$known[]=$prefix.$member['id'];foreach($plan['output']['stages'] as $stage)$known[]='stage:'.$stage['id'];if(!in_array($metric,$known,true))throw new InvalidArgumentException('REPORT_METRIC_INVALID');
        $ids=array_keys($plan['selection'][$metric]??[]);genesisReportTempIds('genesis_report_tasks',$ids);$rows=genesisDataRows('SELECT t.* FROM shared_tasks_history_read t JOIN genesis_report_tasks rt ON rt.id=t.id WHERE t.id>? ORDER BY t.id LIMIT 101',[$after]);$more=count($rows)>100;if($more)array_pop($rows);$tasks=genesisSharedHydrateTasks($actor,$rows);$last=$rows?end($rows)['id']:null;$nextCursor=$more?genesisEncrypt(genesisDataJson(['actor'=>$actor,'metric'=>$metric,'fingerprint'=>$payload['fingerprint'],'id'=>$last])):null;if($owns)$db->commit();return ['tasks'=>$tasks,'total'=>count($ids),'nextCursor'=>$nextCursor,'asOf'=>$payload['asOf']];
    }catch(Throwable $error){if($owns&&$db->inTransaction())$db->rollBack();throw $error;}
}
