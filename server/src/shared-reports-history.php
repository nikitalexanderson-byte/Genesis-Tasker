<?php
declare(strict_types=1);

/** Parse stored instants only, never relative dates or the server's default timezone. */
function genesisReportTime(mixed $value):?float{
    if(!is_string($value)||!preg_match('/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})?$/D',$value))return null;
    try{$time=new DateTimeImmutable($value,new DateTimeZone('UTC'));$errors=DateTimeImmutable::getLastErrors();return $errors&&($errors['warning_count']||$errors['error_count'])?null:(float)$time->format('U.u');}catch(Throwable){return null;}
}

/** Trusted server observation, captured with the mutation; historical C5 scope exits before this hook. */
function genesisSharedReportEventState(string $project,string $action,string $task,array $details):?array{
    if(!str_starts_with($action,'task.'))return null;
    $q=genesisDb()->prepare("SELECT t.project_id,t.status_id,t.assignee_id,t.completed_at,t.archived_at,t.updated_at,t.revision,EXISTS(SELECT 1 FROM shared_trash tr WHERE tr.kind='task' AND tr.object_id=t.id) AS trashed FROM shared_tasks t WHERE t.id=?");$q->execute([$task]);$row=$q->fetch();
    if(!$row)return ['version'=>1,'statusId'=>null,'done'=>false,'active'=>false,'revision'=>null,'kind'=>'removed','at'=>genesisNow(),'beforeDone'=>null,'beforeStatusId'=>null];
    $inside=$row['project_id']===$project;$kind=match($action){'task.created'=>'created','task.moved_out'=>'left','task.moved_in'=>'entered','task.archived'=>'archived','task.deleted'=>'removed','task.restored','task.unarchived'=>'restored',default=>'state'};
    $before=$details['reportBefore']??[];$doneBefore=$before['completed']??($details['changes']['isDone']['from']??null);$statusBefore=$before['statusId']??($details['changes']['statusId']['from']??null);
    return ['version'=>1,'statusId'=>$inside?$row['status_id']:null,'done'=>$inside&&$row['completed_at']!==null,'active'=>$inside&&!$row['trashed']&&$row['archived_at']===null&&$kind!=='left','revision'=>(int)$row['revision'],'kind'=>$kind,
        'at'=>in_array($kind,['removed','restored','left','entered'],true)?genesisNow():$row['updated_at'],'beforeDone'=>is_bool($doneBefore)?$doneBefore:null,'beforeStatusId'=>is_string($statusBefore)?$statusBefore:null,
        'planning'=>$inside?['version'=>1,'assigneeId'=>$row['assignee_id'],...genesisPlanningTaskValues($task)]:null];
}

/** A legacy name alone is not a status identity; a changed definition alone is not its historical semantics. */
function genesisReportPoint(array $event,array $statuses):array{
    $details=json_decode($event['details_json']??'{}',true,128);$details=is_array($details)?$details:[];$state=$details['reportState']??null;$time=genesisReportTime($event['created_at']??null);$action=$event['action'];
    $result=['time'=>$time,'sequence'=>(int)($event['sequence']??0),'eventId'=>$event['id'],'projectId'=>$event['project_id'],'action'=>$action,'known'=>false,'created'=>$action==='task.created','revision'=>null];
    if(is_array($state)&&($state['version']??null)===1&&is_bool($state['done']??null)&&is_bool($state['active']??null)&&array_key_exists('statusId',$state)&&($state['statusId']===null||is_string($state['statusId']))){
        $at=genesisReportTime($state['at']??null);return [...$result,'time'=>$at??$time,'known'=>true,'revision'=>is_int($state['revision']??null)?$state['revision']:null,'statusId'=>$state['statusId'],'done'=>$state['done'],'active'=>$state['active'],'kind'=>$state['kind']??'state','beforeDone'=>is_bool($state['beforeDone']??null)?$state['beforeDone']:null,'beforeStatusId'=>is_string($state['beforeStatusId']??null)?$state['beforeStatusId']:null,
            'entry'=>$action==='task.created'||in_array($state['kind']??null,['entered','restored'],true)||isset($state['beforeStatusId'])&&$state['beforeStatusId']!==$state['statusId']];
    }
    $refs=$details['referenceIds']['statusId']??[];$status=$refs['to']??($event['board_id']??null);$definition=is_string($status)?($statuses[$status]??null):null;
    if(in_array($action,['task.archived','task.deleted','task.moved_out','task.purged'],true))return [...$result,'known'=>true,'statusId'=>null,'done'=>false,'active'=>false,'kind'=>'left','beforeDone'=>null,'beforeStatusId'=>null,'entry'=>false];
    $done=$details['changes']['isDone']['to']??null;if(!is_bool($done))$done=$definition&&(int)$definition['revision']===1?(bool)$definition['isDone']:null;
    if(!$definition||$definition['projectId']!==$event['project_id']||$done===null)return $result;
    $from=$refs['from']??null;$before=$details['changes']['isDone']['from']??null;if(!is_bool($before)&&is_string($from)&&isset($statuses[$from])&&(int)$statuses[$from]['revision']===1)$before=(bool)$statuses[$from]['isDone'];
    $kind=match($action){'task.created'=>'created','task.moved_in'=>'entered','task.unarchived','task.restored'=>'restored',default=>'state'};
    return [...$result,'known'=>true,'statusId'=>$status,'done'=>$done,'active'=>true,'kind'=>$kind,'beforeDone'=>is_bool($before)?$before:null,'beforeStatusId'=>is_string($from)?$from:null,'entry'=>$action==='task.created'||in_array($kind,['entered','restored'],true)||is_string($from)&&$from!==$status];
}

/** Pure interval calculation. Missing history is carried as intervals, never fabricated zero time. */
function genesisReportTaskHistory(array $task,array $points,array $starts,float $asOf):array{
    usort($points,static fn($a,$b)=>($a['time']??INF)<=>($b['time']??INF)?:$a['sequence']<=>$b['sequence']);$previous=null;$cycle=null;$lastCompletion=null;$created=null;$segments=[];$gaps=[];$changes=[];$firstKnown=null;
    $createdAt=genesisReportTime($task['created_at']??null);$unknownFrom=$createdAt??-INF;$corrupt=false;
    foreach($points as $point){$at=$point['time'];if($at===null){$corrupt=true;continue;}if($at>$asOf)continue;
        if($point['created']){$created=$at;$changes[]=['type'=>'created','time'=>$at];}
        if(!$point['known']){if($previous!==null)$unknownFrom=min($unknownFrom,$previous['time']);$previous=null;$cycle=null;continue;}
        if($previous!==null&&$point['projectId']===$previous['projectId']&&$point['revision']!==null&&$previous['revision']!==null&&$point['revision']>$previous['revision']+1){$unknownFrom=$previous['time'];$previous=null;$cycle=null;}
        if($firstKnown===null)$firstKnown=$at;
        if($previous!==null){if($previous['active']&&!$previous['done']&&$previous['statusId']!==null)$segments[]=['from'=>$previous['time'],'to'=>$at,'statusId'=>$previous['statusId'],'projectId'=>$previous['projectId']];}
        elseif($unknownFrom<$at&&!$point['created'])$gaps[]=['from'=>$unknownFrom,'to'=>$at];
        $before=$point['beforeDone'];if($before===null&&$previous!==null&&$previous['projectId']===$point['projectId'])$before=$previous['done'];
        $boundary=in_array($point['kind'],['left','removed','archived','entered','restored'],true);if($boundary)$cycle=null;
        $entered=$point['entry']||$point['beforeDone']===true&&!$point['done']||$previous!==null&&($previous['statusId']!==$point['statusId']||$previous['done']&&!$point['done']);
        if($point['active']&&!$point['done']&&isset($starts[$point['statusId']??''])&&$entered)$cycle=$at;
        if(!$boundary&&$point['done']&&($before===false||$point['created'])){$changes[]=['type'=>'completed','time'=>$at];$lastCompletion=['time'=>$at,'seconds'=>$cycle===null?null:max(0,$at-$cycle),'eventId'=>$point['eventId']];$cycle=null;}
        elseif(!$boundary&&!$point['done']&&$before===true){$changes[]=['type'=>'reopened','time'=>$at];$lastCompletion=null;}
        if(!$point['active'])$cycle=null;$previous=$point;$unknownFrom=$at;
    }
    $matches=$previous!==null&&($previous['revision']===null||$previous['revision']===(int)($task['revision']??-1))&&$previous['projectId']===$task['project_id']&&$previous['statusId']===$task['status_id']&&$previous['done']===($task['completed_at']!==null)&&$previous['active']===($task['archived_at']===null);
    if($matches){if($previous['active']&&!$previous['done'])$segments[]=['from'=>$previous['time'],'to'=>$asOf,'statusId'=>$previous['statusId'],'projectId'=>$previous['projectId']];}
    else{$gaps[]=['from'=>$previous['time']??$unknownFrom,'to'=>$asOf];$lastCompletion=null;}
    if($created===null&&$createdAt!==null&&($firstKnown===null||$firstKnown>$createdAt))$gaps[]=['from'=>$createdAt,'to'=>$firstKnown??$asOf];
    if($corrupt){$segments=[];$lastCompletion=null;$gaps[]=['from'=>$createdAt??-INF,'to'=>$asOf];$matches=false;}
    return ['segments'=>$segments,'unknown'=>$gaps,'changes'=>$changes,'lastCompletion'=>$lastCompletion,'createdEvidenceAt'=>$created,'firstKnownAt'=>$firstKnown,'currentKnown'=>$matches];
}
