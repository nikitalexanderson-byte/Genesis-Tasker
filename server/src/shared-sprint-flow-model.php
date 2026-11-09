<?php
declare(strict_types=1);
require_once __DIR__.'/shared-reports-history.php';

/** SQLite legacy instants without an offset mean UTC, including in browser payloads. */
function genesisSprintFlowInstant(mixed $value):mixed
{
    if(genesisReportTime($value)===null)return $value;
    return (new DateTimeImmutable($value,new DateTimeZone('UTC')))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.u\Z');
}

/** Pure projection of server observations. No current snapshot is backdated into history. */
function genesisSprintFlowTask(mixed $value):?array
{
    if(!is_array($value))return null;
    foreach(['taskId','statusId','done','active','revision','sprintId','storyPoints','estimateHours'] as $key)if(!array_key_exists($key,$value))return null;
    if(!is_string($value['taskId'])||$value['taskId']===''||!is_bool($value['done'])||!is_bool($value['active'])||!is_int($value['revision'])||$value['revision']<1)return null;
    if((!is_string($value['statusId'])&&($value['active']||$value['statusId']!==null))||$value['statusId']==='')return null;
    if($value['sprintId']!==null&&(!is_string($value['sprintId'])||$value['sprintId']===''))return null;
    foreach(['storyPoints','estimateHours'] as $key){
        $number=$value[$key];
        if($number!==null&&(!is_int($number)&&!is_float($number)||!is_finite((float)$number)||$number<0||$number>1000000))return null;
    }
    foreach(['storyPoints','estimateHours'] as $key)if($value[$key]!==null)$value[$key]=round((float)$value[$key],2);
    return array_intersect_key($value,array_flip(['taskId','statusId','done','active','revision','sprintId','storyPoints','estimateHours']));
}

/** Called only on decrypted, access-filtered audit rows, never on client-submitted history. */
function genesisSprintFlowEvent(array $event):array
{
    $details=$event['details']??json_decode($event['details_json']??'{}',true,128);
    $details=is_array($details)?$details:[];$report=$details['reportState']??null;
    $task=$event['task_id']??$event['object_id']??'';$state=null;$outside=false;
    if(is_array($report)&&($report['version']??null)===1){
        $planning=$report['planning']??null;
        if(is_array($planning)&&($planning['version']??null)===1&&count(array_intersect(['sprintId','storyPoints','estimateHours'],array_keys($planning)))===3)$state=genesisSprintFlowTask([
            'taskId'=>$task,'statusId'=>$report['statusId']??null,'done'=>$report['done']??null,'active'=>$report['active']??null,
            'revision'=>$report['revision']??null,'sprintId'=>$planning['sprintId']??null,
            'storyPoints'=>$planning['storyPoints']??null,'estimateHours'=>$planning['estimateHours']??null,
        ]);
        $outside=($report['active']??null)===false&&in_array($report['kind']??null,['left','removed'],true);
    }
    return ['id'=>(string)($event['id']??''),'sequence'=>(int)($event['sequence']??0),'at'=>genesisSprintFlowInstant($event['created_at']??null),
        'taskId'=>(string)$task,'action'=>(string)($event['action']??''),'state'=>$state,'outside'=>$outside,
        'revision'=>is_int($report['revision']??null)?$report['revision']:null];
}

function genesisSprintFlowInside(?array $task,string $sprint):bool
{
    return $task!==null&&$task['active']&&$task['sprintId']===$sprint;
}

function genesisSprintFlowEmpty():array{return ['tasks'=>0,'knownValue'=>0.0,'unestimated'=>0];}

function genesisSprintFlowAccumulate(array &$total,array $task,string $unit,int $direction):void
{
    $total['tasks']+=$direction;
    $value=match($unit){'tasks'=>1,'points'=>$task['storyPoints'],'hours'=>$task['estimateHours']};
    if($value===null)$total['unestimated']+=$direction;
    else $total['knownValue']=round($total['knownValue']+$direction*$value,2);
}

function genesisSprintFlowTotals(array $states,string $sprint,string $unit,?callable $accept=null):array
{
    $total=genesisSprintFlowEmpty();
    foreach($states as $task)if(genesisSprintFlowInside($task,$sprint)&&(!$accept||$accept($task)))genesisSprintFlowAccumulate($total,$task,$unit,1);
    return $total;
}

/**
 * start/terminal: {id, sequence, at, plan, outcomes?}. events use genesisSprintFlowEvent.
 * Events are causally ordered by SQLite sequence, including identical timestamps.
 * Returned states and source IDs are internal evidence, to be filtered/paginated by the read API.
 */
function genesisSprintFlowFold(string $sprint,string $unit,?array $start,?array $terminal,array $events,string $asOf,?array $current=null,array $seriesOptions=[]):array
{
    if(!in_array($unit,['tasks','points','hours'],true))throw new InvalidArgumentException('SPRINT_REPORT_UNIT_INVALID');
    $resolution=$seriesOptions['resolution']??'event';
    if(!in_array($resolution,['event','day'],true))throw new InvalidArgumentException('SPRINT_REPORT_RESOLUTION_INVALID');
    try{$zone=new DateTimeZone($seriesOptions['timeZone']??'UTC');}catch(Throwable){throw new InvalidArgumentException('SPRINT_REPORT_CONTEXT_INVALID');}
    $asOfTime=genesisReportTime($asOf);if($asOfTime===null)throw new InvalidArgumentException('SPRINT_REPORT_TIME_INVALID');
    $from=$start?genesisReportTime($start['at']??null):null;
    if($from===null||$from>$asOfTime||!is_array($start['plan']??null)||!array_is_list($start['plan'])||!is_int($start['sequence']??null)||$start['sequence']<1||!is_string($start['id']??null)||$start['id']==='')return ['available'=>false,'reason'=>'start-observation-missing','unit'=>$unit,'series'=>[],'summary'=>null,'gaps'=>[]];

    $gaps=[];$unknown=[];$opaque=0;$states=[];$lastSequence=[];$historyComplete=true;
    $readPlan=static function(array $plan)use(&$opaque,&$unknown,&$historyComplete):array{
        $result=[];
        foreach($plan as $raw){
            $task=genesisSprintFlowTask($raw);
            if($task===null){if(is_array($raw)&&is_string($raw['taskId']??null)&&$raw['taskId']!=='')$unknown[$raw['taskId']]=true;else $opaque++;$historyComplete=false;continue;}
            if(isset($result[$task['taskId']])){$unknown[$task['taskId']]=true;$historyComplete=false;continue;}
            $result[$task['taskId']]=$task;
        }
        foreach($unknown as $id=>$_)unset($result[$id]);return $result;
    };
    $states=$readPlan($start['plan']);
    // Outside states must come from observations at/before start, not today's backlog.
    foreach($start['outsidePlan']??[] as $raw){$task=genesisSprintFlowTask($raw);if($task&&$task['sprintId']!==$sprint&&!isset($states[$task['taskId']]))$states[$task['taskId']]=$task;}
    $initial=$states;
    foreach($states as $id=>$_)$lastSequence[$id]=$start['sequence'];
    $initialUnknown=$opaque+count($unknown);
    $to=$terminal?genesisReportTime($terminal['at']??null):null;
    if($terminal!==null&&($to===null||$to<$from||$to>$asOfTime||($terminal['sequence']??0)<=$start['sequence']||!is_array($terminal['plan']??null)||!array_is_list($terminal['plan']))){
        $gaps[]=['reason'=>'invalid-terminal-observation'];$terminal=null;$historyComplete=false;
    }
    $stopSequence=$terminal['sequence']??PHP_INT_MAX;$to=$terminal?$to:$asOfTime;
    usort($events,static fn($a,$b)=>$a['sequence']<=>$b['sequence']);

    // Completion moves are atomic with the terminal plan, but their audit rows precede it.
    // Match each carry by its exact pre-move revision and destination, never by timestamp alone.
    $carryEvents=[];$terminalStates=[];
    if($terminal){
        foreach($terminal['plan'] as $raw){$task=genesisSprintFlowTask($raw);if($task)$terminalStates[$task['taskId']]=$task;}
        foreach($events as $event){
            $id=$event['taskId'];$before=$terminalStates[$id]??null;$after=$event['state'];
            if($before&&array_key_exists($id,$terminal['outcomes']??[])&&$event['action']==='task.updated'
                &&$event['sequence']>$start['sequence']&&$event['sequence']<$stopSequence&&$after!==null
                &&$after['revision']===$before['revision']+1&&!$before['done']&&$before['active']
                &&$before['sprintId']===$sprint&&$after['active']&&!$after['done']&&$after['sprintId']===$terminal['outcomes'][$id]
                &&$after['statusId']===$before['statusId']&&$after['storyPoints']===$before['storyPoints']&&$after['estimateHours']===$before['estimateHours'])$carryEvents[$event['id']]=true;
        }
    }

    $scope=genesisSprintFlowEmpty();$open=genesisSprintFlowEmpty();$done=genesisSprintFlowEmpty();$statuses=[];$wipStatuses=[];
    $apply=static function(?array $task,int $direction)use(&$scope,&$open,&$done,&$statuses,&$wipStatuses,$sprint,$unit):void{
        if(!genesisSprintFlowInside($task,$sprint))return;
        genesisSprintFlowAccumulate($scope,$task,$unit,$direction);
        if($task['done'])genesisSprintFlowAccumulate($done,$task,$unit,$direction);else genesisSprintFlowAccumulate($open,$task,$unit,$direction);
        $status=$task['statusId'];$statuses[$status]??=genesisSprintFlowEmpty();genesisSprintFlowAccumulate($statuses[$status],$task,$unit,$direction);
        if(!$task['done']){$wipStatuses[$status]??=genesisSprintFlowEmpty();genesisSprintFlowAccumulate($wipStatuses[$status],$task,$unit,$direction);}
    };
    foreach($states as $task)$apply($task,1);
    $series=[];
    $point=static function(string $at,int $sequence,string $source,bool $connect,string $kind='event')use(&$series,&$scope,&$open,&$done,&$statuses,&$wipStatuses,&$unknown,&$opaque,$resolution,$zone):void{
        $missing=$opaque+count($unknown);$metric=static fn(array $total):array=>[...$total,'value'=>$missing?null:$total['knownValue']];
        $byStatus=[];foreach($statuses as $id=>$total)$byStatus[$id]=$metric($total);$byWipStatus=[];foreach($wipStatuses as $id=>$total)$byWipStatus[$id]=$metric($total);
        $sample=['at'=>$at,'date'=>(new DateTimeImmutable($at))->setTimezone($zone)->format('Y-m-d'),'sequence'=>$sequence,'firstSequence'=>$sequence,'sourceId'=>$source!==''?$source:null,'sourceKind'=>$kind,'sourceCount'=>1,'connectPrevious'=>$connect,'coverage'=>$missing?'partial':'observed','unknownTasks'=>$missing,
            'scope'=>$metric($scope),'remaining'=>$metric($open),'done'=>$metric($done),'wip'=>$metric($open),'statuses'=>(object)$byStatus,'wipStatuses'=>(object)$byWipStatus];
        $last=count($series)-1;
        if($resolution==='day'&&$kind==='event'&&$last>=0&&$series[$last]['sourceKind']==='event'&&$series[$last]['date']===$sample['date']){
            $sample['firstSequence']=$series[$last]['firstSequence'];$sample['sourceCount']+=$series[$last]['sourceCount'];
            $sample['connectPrevious']=$sample['connectPrevious']&&$series[$last]['connectPrevious'];
            $sample['gapWithinBucket']=($series[$last]['gapWithinBucket']??false)||$series[$last]['coverage']!=='observed'||$sample['coverage']!=='observed';
            $series[$last]=$sample;
        }else $series[]=$sample;
    };
    $point($start['at'],$start['sequence'],$start['id'],false,'start');
    $changes=[];$completions=[];$reopens=[];$completionTransitions=0;$seen=[];$lastTime=$from;$lastSource=$start['id'];$lastEventSequence=$start['sequence'];
    $added=genesisSprintFlowEmpty();$removed=genesisSprintFlowEmpty();$estimateDelta=0.0;$unestimatedDelta=0;
    foreach($events as $event){
        if($event['sequence']<=$start['sequence']||$event['sequence']>=$stopSequence||isset($seen[$event['id']]))continue;
        $seen[$event['id']]=true;$time=genesisReportTime($event['at']);
        if($time!==null&&$time>$asOfTime)continue;
        $id=$event['taskId'];$before=$states[$id]??null;$after=$event['state'];$revision=$event['revision']??$after['revision']??null;
        if(isset($carryEvents[$event['id']]))continue;
        $firstKnown=$before!==null||$event['action']==='task.created'&&$revision===1;
        $sequential=$firstKnown&&($before===null||$revision===$before['revision']||$revision===$before['revision']+1);
        $chronological=$time!==null&&$time>=$lastTime;
        if(!$sequential||!$chronological){$historyComplete=false;$gaps[]=['taskId'=>$id,'sourceId'=>$event['id'],'fromSequence'=>$lastSequence[$id]??$start['sequence'],'toSequence'=>$event['sequence'],'reason'=>!$chronological?'invalid-event-time':($firstKnown?'revision-gap':'first-observation-gap')];}
        if($event['outside']&&$after===null){
            $after=['taskId'=>$id,'statusId'=>null,'done'=>false,'active'=>false,'revision'=>$revision??($before['revision']??1),
                'sprintId'=>null,'storyPoints'=>null,'estimateHours'=>null];
        }
        $apply($before,-1);
        if($after===null||!$chronological){
            unset($states[$id]);$unknown[$id]=true;$historyComplete=false;
            if($after===null)$gaps[]=['taskId'=>$id,'sourceId'=>$event['id'],'reason'=>'state-observation-missing'];
            if($time!==null&&$time>=$lastTime)$point($event['at'],$event['sequence'],$event['id'],false);
            $lastSequence[$id]=$event['sequence'];$lastSource=$event['id'];$lastEventSequence=$event['sequence'];continue;
        }
        $wasUnknown=isset($unknown[$id]);unset($unknown[$id]);$states[$id]=$after;$apply($after,1);
        $insideBefore=genesisSprintFlowInside($before,$sprint);$insideAfter=genesisSprintFlowInside($after,$sprint);
        $knownChange=$sequential&&!$wasUnknown;
        if($knownChange&&$insideBefore!==$insideAfter){
            $kind=$insideAfter?'added':'removed';$task=$insideAfter?$after:$before;
            if($insideAfter)genesisSprintFlowAccumulate($added,$task,$unit,1);else genesisSprintFlowAccumulate($removed,$task,$unit,1);
            $changes[]=['sourceId'=>$event['id'],'taskId'=>$id,'at'=>$event['at'],'sequence'=>$event['sequence'],'kind'=>$kind,'before'=>$before,'after'=>$after];
        }elseif($knownChange&&$insideBefore&&$insideAfter&&($before['storyPoints']!==$after['storyPoints']||$before['estimateHours']!==$after['estimateHours'])){
            $a=$unit==='points'?$before['storyPoints']:($unit==='hours'?$before['estimateHours']:1);
            $b=$unit==='points'?$after['storyPoints']:($unit==='hours'?$after['estimateHours']:1);
            $estimateDelta=round($estimateDelta+($b??0)-($a??0),2);$unestimatedDelta+=(int)($b===null)-(int)($a===null);
            $changes[]=['sourceId'=>$event['id'],'taskId'=>$id,'at'=>$event['at'],'sequence'=>$event['sequence'],'kind'=>'estimate','before'=>$before,'after'=>$after];
        }
        if($knownChange&&$insideAfter&&$after['done']&&($insideBefore&&!$before['done']||$before===null&&$event['action']==='task.created')){
            $completions[$id]=$event['id'];$completionTransitions++;
        }
        if($knownChange&&$insideBefore&&$insideAfter&&$before['done']&&!$after['done'])$reopens[$id]=$event['id'];
        $changed=$before!==$after||$wasUnknown;
        if($changed)$point($event['at'],$event['sequence'],$event['id'],$knownChange&&$chronological);
        $lastTime=$time;$lastSequence[$id]=$event['sequence'];$lastSource=$event['id'];$lastEventSequence=$event['sequence'];
    }

    if($terminal){
        // The terminal plan is captured BEFORE carries. Never use post-carry current membership here.
        $observed=array_filter($states,static fn($task)=>$task['sprintId']===$sprint);ksort($observed);ksort($terminalStates);
        $matches=$observed===$terminalStates&&$opaque===0&&!$unknown&&$to>=$lastTime;
        if(!$matches){$historyComplete=false;$gaps[]=['sourceId'=>$terminal['id'],'fromSequence'=>$start['sequence'],'toSequence'=>$terminal['sequence'],'reason'=>'terminal-plan-reconciliation'];}
        $opaque=0;$unknown=[];$states=$readPlan($terminal['plan']);
        $scope=genesisSprintFlowEmpty();$open=genesisSprintFlowEmpty();$done=genesisSprintFlowEmpty();$statuses=[];$wipStatuses=[];
        foreach($states as $task)$apply($task,1);
        $point($terminal['at'],$terminal['sequence'],$terminal['id'],$matches,'terminal');
    }elseif($current!==null){
        $observed=array_filter($states,static fn($task)=>$task['sprintId']===$sprint);ksort($observed);
        $opaque=0;$unknown=[];$latest=$readPlan($current);$inside=array_filter($latest,static fn($task)=>$task['sprintId']===$sprint);ksort($inside);
        $matches=$observed===$inside;
        if(!$matches){
            $historyComplete=false;
            foreach(array_unique([...array_keys($observed),...array_keys($inside)]) as $id)if(($observed[$id]??null)!==($inside[$id]??null)){
                $gaps[]=['taskId'=>$id,'fromSequence'=>$lastSequence[$id]??$start['sequence'],'toSequence'=>null,'reason'=>'current-snapshot-reconciliation'];
            }
        }
        $states=$latest;$scope=genesisSprintFlowEmpty();$open=genesisSprintFlowEmpty();$done=genesisSprintFlowEmpty();$statuses=[];$wipStatuses=[];
        foreach($states as $task)$apply($task,1);
        $point($asOf,$lastEventSequence,'',$matches,'current-snapshot');
    }elseif($lastTime<$asOfTime||$unknown||$opaque){
        $point($asOf,$lastEventSequence,$lastSource,false,'as-of-boundary');
    }
    // A later revision/snapshot can prove a hole BEFORE its own observation. Break every
    // intermediate aggregate, including points emitted for other tasks during that hole.
    foreach($series as &$sample){
        if(in_array($sample['sourceKind'],['start','terminal','current-snapshot'],true))continue;
        $affected=[];$overlap=false;
        foreach($gaps as $gap)if(isset($gap['fromSequence'])&&$sample['sequence']>$gap['fromSequence']){
            if(!isset($gap['toSequence'])||$sample['firstSequence']<$gap['toSequence'])$overlap=true;
            if(!isset($gap['toSequence'])||$sample['sequence']<$gap['toSequence'])$affected[$gap['taskId']??'unavailable']=true;
        }
        if($overlap){$sample['connectPrevious']=false;$sample['gapWithinBucket']=true;}
        if(!$affected)continue;
        $sample['coverage']='partial';$sample['historyGap']=true;
        foreach(['scope','remaining','done','wip'] as $key)foreach(['value','knownValue','tasks','unestimated'] as $field)$sample[$key][$field]=null;
        foreach(['statuses','wipStatuses'] as $key){$buckets=(array)$sample[$key];foreach($buckets as &$bucket)foreach(['value','knownValue','tasks','unestimated'] as $field)$bucket[$field]=null;unset($bucket);$sample[$key]=(object)$buckets;}
    }unset($sample);
    $currentUnknown=$opaque+count($unknown);$finish=static fn(array $value,int $missing):array=>[...$value,'value'=>$missing?null:$value['knownValue'],'unknownTasks'=>$missing];
    $delivered=genesisSprintFlowTotals($states,$sprint,$unit,static fn($task)=>$task['done']&&isset($completions[$task['taskId']]));
    $carried=[];if($terminal)foreach($terminal['outcomes']??[] as $id=>$_)if(isset($states[$id])&&$states[$id]['active']&&!$states[$id]['done'])$carried[$id]=$states[$id];
    return ['available'=>true,'unit'=>$unit,'resolution'=>$resolution,'timeZone'=>$zone->getName(),'from'=>$start['at'],'to'=>$terminal?$terminal['at']:$asOf,'terminal'=>$terminal!==null,
        'historyComplete'=>$historyComplete,'series'=>$series,'scopeChanges'=>$changes,'gaps'=>$gaps,'carrySourceIds'=>array_keys($carryEvents),
        'summary'=>[
            'plan'=>$finish(genesisSprintFlowTotals($initial,$sprint,$unit),$initialUnknown),
            'alreadyDone'=>$finish(genesisSprintFlowTotals($initial,$sprint,$unit,static fn($task)=>$task['done']),$initialUnknown),
            'committed'=>$finish(genesisSprintFlowTotals($initial,$sprint,$unit,static fn($task)=>!$task['done']),$initialUnknown),
            'scope'=>$finish($scope,$currentUnknown),'remaining'=>$finish($open,$currentUnknown),'done'=>$finish($done,$currentUnknown),
            'delivered'=>[...$finish($delivered,$currentUnknown),'value'=>$historyComplete?$delivered['knownValue']:null,'historyComplete'=>$historyComplete],
            'carried'=>$finish(genesisSprintFlowTotals($carried,$sprint,$unit),$currentUnknown),
            'added'=>$added,'removed'=>$removed,'estimateDelta'=>$estimateDelta,'unestimatedDelta'=>$unestimatedDelta,
            'scopeChangeCoverage'=>$historyComplete?'observed':'partial','completionTransitions'=>$completionTransitions,'completedTaskIds'=>array_keys($completions),'reopenedTaskIds'=>array_keys($reopens),
        ],'initialStates'=>$initial,'currentStates'=>$states];
}
