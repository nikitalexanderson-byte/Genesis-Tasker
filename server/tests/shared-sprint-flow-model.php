<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')throw new RuntimeException('CLI only');
require __DIR__.'/../src/shared-sprint-flow-model.php';
function sfCheck(bool $value,string $message):void{if(!$value)throw new RuntimeException($message);}
function sfTask(string $id,int|float|null $points=1,int|float|null $hours=1,array $extra=[]):array{
    return genesisSprintFlowTask(['taskId'=>$id,'statusId'=>'todo','done'=>false,'active'=>true,'revision'=>1,'sprintId'=>'sprint-a','storyPoints'=>$points,'estimateHours'=>$hours,...$extra]);
}
function sfEvent(int $sequence,array $task,string $action='task.updated',?string $at=null):array{
    return ['id'=>'event-'.$sequence,'sequence'=>$sequence,'at'=>$at??'2026-10-19T10:01:00Z','taskId'=>$task['taskId'],'action'=>$action,'state'=>$task,'outside'=>false,'revision'=>$task['revision']];
}
function sfStart(array $plan,array $outside=[]):array{return ['id'=>'start','sequence'=>10,'at'=>'2026-10-19T10:00:00Z','plan'=>$plan,'outsidePlan'=>$outside];}
$asOf='2026-10-19T11:00:00Z';$checks=[];

// Ten committed tasks, four done, six carried: closure must retain six unfinished.
$plan=[];for($i=0;$i<10;$i++)$plan[]=sfTask('task-'.$i);
$states=array_column($plan,null,'taskId');$events=[];
for($i=0;$i<4;$i++){$task=$states['task-'.$i]=sfTask('task-'.$i,1,1,['statusId'=>'done','done'=>true,'revision'=>2]);$events[]=sfEvent(20+$i,$task);}
$terminal=['id'=>'complete','sequence'=>50,'at'=>'2026-10-19T10:03:00Z','plan'=>array_values($states),'outcomes'=>[]];
for($i=4;$i<10;$i++){$id='task-'.$i;$terminal['outcomes'][$id]='sprint-b';$events[]=sfEvent(30+$i,sfTask($id,1,1,['revision'=>2,'sprintId'=>'sprint-b']),'task.updated','2026-10-19T10:02:00Z');}
$flow=genesisSprintFlowFold('sprint-a','tasks',sfStart($plan),$terminal,$events,$asOf);$summary=$flow['summary'];
sfCheck($summary['plan']['value']===10.0&&$summary['delivered']['value']===4.0&&$summary['remaining']['value']===6.0&&$summary['carried']['value']===6.0,'Carry-over became completion or erased the terminal remainder');
sfCheck($flow['historyComplete']&&count($flow['carrySourceIds'])===6&&$summary['removed']['tasks']===0,'Atomic completion carries were counted as ordinary scope removal');
sfCheck(min(array_column(array_column($flow['series'],'remaining'),'value'))===6.0,'Burndown fabricated a zero before terminal plan');
sfCheck(end($flow['series'])['connectPrevious'],'Matching terminal evidence introduced an artificial gap');$checks[]='terminal carry and causal ordering';
sfCheck(end($flow['series'])['wipStatuses']->todo['value']===6.0&&(!isset(end($flow['series'])['wipStatuses']->done)||end($flow['series'])['wipStatuses']->done['value']===0.0),'Per-status WIP included completed work');

// Count, points and hours are independent. Zero is estimated; null is unknown effort.
$zero=sfTask('zero',0,1);$unestimated=sfTask('null',null,null);$outside=sfTask('outside',2,0,['sprintId'=>null,'revision'=>4]);$events=[];
$entered=sfTask('outside',2,0,['revision'=>5]);$events[]=sfEvent(20,$entered);
$estimatedZero=sfTask('zero',5,1,['revision'=>2]);$events[]=sfEvent(21,$estimatedZero);
$estimatedNull=sfTask('null',0,null,['revision'=>2]);$events[]=sfEvent(22,$estimatedNull);
$completed=sfTask('null',0,null,['revision'=>3,'statusId'=>'done','done'=>true]);$events[]=sfEvent(23,$completed);
$changedDone=sfTask('null',3,null,['revision'=>4,'statusId'=>'done','done'=>true]);$events[]=sfEvent(24,$changedDone);
$events[]=sfEvent(25,sfTask('null',3,null,['revision'=>5]));
$events[]=sfEvent(26,sfTask('null',3,null,['revision'=>6,'statusId'=>'done','done'=>true]));
$events[]=sfEvent(27,sfTask('outside',2,0,['revision'=>6,'sprintId'=>null]));
$events[]=sfEvent(28,sfTask('zero',5,1,['revision'=>3,'active'=>false]),'task.archived');
$events[]=sfEvent(29,sfTask('zero',5,1,['revision'=>4]),'task.unarchived');
$start=sfStart([$zero,$unestimated],[$outside]);
$points=genesisSprintFlowFold('sprint-a','points',$start,null,$events,$asOf);$s=$points['summary'];
sfCheck($s['plan']['value']===0.0&&$s['plan']['tasks']===2&&$s['plan']['unestimated']===1,'Zero and null were conflated');
sfCheck($s['scope']['value']===8.0&&$s['scope']['unestimated']===0&&$s['estimateDelta']===8.0&&$s['unestimatedDelta']===-1,'Scope/estimate bridge is wrong');
sfCheck($s['plan']['value']+$s['added']['knownValue']-$s['removed']['knownValue']+$s['estimateDelta']===$s['scope']['value'],'Plan plus actual changes does not explain final scope');
sfCheck($s['completionTransitions']===2&&count($s['completedTaskIds'])===1&&count($s['reopenedTaskIds'])===1&&$s['delivered']['value']===3.0,'Reopen/re-complete or estimate edit multiplied delivery');
$hours=genesisSprintFlowFold('sprint-a','hours',$start,null,$events,$asOf);$count=genesisSprintFlowFold('sprint-a','tasks',$start,null,$events,$asOf);
sfCheck($hours['summary']['scope']['value']===1.0&&$hours['summary']['scope']['unestimated']===1&&$hours['summary']['estimateDelta']===0.0,'Points leaked into hours');
sfCheck($count['summary']['scope']['value']===2.0&&$count['summary']['scope']['unestimated']===0,'Effort estimates changed task count');$checks[]='scope, estimates, independent units, reopen and restore';

// Already completed at launch is reported separately, not as new delivery.
$already=sfTask('old-done',5,2,['done'=>true,'statusId'=>'done']);
$old=genesisSprintFlowFold('sprint-a','points',sfStart([$already]),null,[],$asOf);
sfCheck($old['summary']['alreadyDone']['value']===5.0&&$old['summary']['committed']['value']===0.0&&$old['summary']['delivered']['value']===0.0,'Pre-start completion became sprint delivery');
$none=genesisSprintFlowFold('sprint-a','points',null,null,[sfEvent(20,$already)],$asOf);sfCheck(!$none['available']&&$none['summary']===null&&!$none['series'],'Current state fabricated a missing start plan');$checks[]='honest start boundary';

// Legacy/missing observations and jumps interrupt lines; endpoints may later recover.
$one=sfTask('one');$legacy=sfEvent(20,$one);$legacy['state']=null;$legacy['revision']=null;
$recovered=sfEvent(22,sfTask('one',2,1,['revision'=>3]));
$partial=genesisSprintFlowFold('sprint-a','points',sfStart([$one]),null,[$legacy,$recovered],$asOf);
sfCheck(!$partial['historyComplete']&&$partial['series'][1]['scope']['value']===null&&!$partial['series'][2]['connectPrevious'],'Missing observation became a continuous line');
sfCheck($partial['summary']['scope']['value']===2.0&&$partial['summary']['delivered']['value']===null&&$partial['summary']['scopeChangeCoverage']==='partial','Recovered state concealed unknown history');
$jump=genesisSprintFlowFold('sprint-a','tasks',sfStart([$one]),null,[sfEvent(20,sfTask('one',1,1,['revision'=>4,'done'=>true,'statusId'=>'done']))],$asOf);
sfCheck(!$jump['historyComplete']&&!$jump['series'][1]['connectPrevious']&&$jump['summary']['delivered']['value']===null,'Revision gap fabricated throughput');
$invalid=sfEvent(20,$one);$invalid['at']='not-a-timestamp';$badTime=genesisSprintFlowFold('sprint-a','tasks',sfStart([$one]),null,[$invalid],$asOf);
sfCheck(!$badTime['historyComplete']&&end($badTime['series'])['scope']['value']===null,'Invalid final timestamp disappeared from coverage');
$opaque=genesisSprintFlowFold('sprint-a','tasks',sfStart([['unavailable'=>true]]),null,[],$asOf);sfCheck($opaque['summary']['plan']['value']===null&&$opaque['summary']['plan']['unknownTasks']===1,'Unavailable task became zero work');$checks[]='unknown and partial coverage';

// Identical timestamps use stable sequence; replaying an event is not another completion.
$born=sfTask('born');$created=sfEvent(20,$born,'task.created');$done=sfEvent(21,sfTask('born',1,1,['done'=>true,'statusId'=>'done','revision'=>2]));$estimate=sfEvent(22,sfTask('born',7,1,['done'=>true,'statusId'=>'done','revision'=>3]));
$same=genesisSprintFlowFold('sprint-a','points',sfStart([]),null,[$estimate,$done,$created,$done],$asOf);
sfCheck($same['historyComplete']&&$same['summary']['completionTransitions']===1&&$same['summary']['delivered']['value']===7.0,'Timestamp tie/replayed event changed causal delivery');
sfCheck(array_column($same['series'],'sequence')===[10,20,21,22,22],'Causal sequence differs');$checks[]='timestamp ties and duplicate events';

// Old server events lack planning; the adapter must not invent null estimates/membership.
$raw=['id'=>'raw','sequence'=>1,'created_at'=>'2026-10-19T10:01:00Z','object_id'=>'one','action'=>'task.updated','details'=>['reportState'=>['version'=>1,'done'=>false,'active'=>true,'statusId'=>'todo','revision'=>1]]];
sfCheck(genesisSprintFlowEvent($raw)['state']===null,'Legacy event manufactured planning data');
$raw['details']['reportState']['planning']=['version'=>1,'sprintId'=>'sprint-a','storyPoints'=>0,'estimateHours'=>null];$observation=genesisSprintFlowEvent($raw);
sfCheck($observation['state']['storyPoints']===0.0&&$observation['state']['estimateHours']===null,'Adapter lost explicit zero/null');
$raw['created_at']='2026-10-19 10:01:00';sfCheck(genesisSprintFlowEvent($raw)['at']==='2026-10-19T10:01:00.000000Z','Legacy UTC instant became browser-local time');
unset($raw['details']['reportState']['planning']['storyPoints']);sfCheck(genesisSprintFlowEvent($raw)['state']===null,'Truncated planning observation became known');$checks[]='strict observation adapter';

// Reconciliation is an explicit observation NOW, never an invented task mutation in the past.
$other=sfTask('other');$middle=sfEvent(20,sfTask('other',3,1,['revision'=>2]));
$late=sfEvent(30,sfTask('one',7,1,['revision'=>4]),'task.updated','2026-10-19T10:02:00Z');
$intermediate=genesisSprintFlowFold('sprint-a','points',sfStart([$one,$other]),null,[$middle,$late],$asOf);
sfCheck($intermediate['series'][1]['scope']['value']===null&&$intermediate['series'][1]['historyGap'],'A later revision gap left fabricated intermediate aggregates');
$snapshot=genesisSprintFlowFold('sprint-a','points',sfStart([$one,$other]),null,[$middle],$asOf,[sfTask('one',7,1,['revision'=>4]),sfTask('other',3,1,['revision'=>2])]);
sfCheck(!$snapshot['historyComplete']&&$snapshot['summary']['scope']['value']===10.0&&$snapshot['summary']['delivered']['value']===null,'Current snapshot was backdated into complete history');
sfCheck($snapshot['series'][1]['scope']['value']===null&&end($snapshot['series'])['sourceKind']==='current-snapshot'&&end($snapshot['series'])['sourceId']===null,'Snapshot invented an audit source or hid an earlier hole');$checks[]='retroactive coverage and explicit current boundary';

$daily=genesisSprintFlowFold('sprint-a','points',$start,null,$events,$asOf,null,['resolution'=>'day','timeZone'=>'Pacific/Kiritimati']);
sfCheck($daily['summary']===$points['summary']&&count($daily['series'])===3&&$daily['series'][1]['sourceCount']===10,'Daily chart sampling changed factual totals or omitted source count');
sfCheck($daily['series'][1]['date']==='2026-10-20','Daily grouping ignored the saved timezone');
$dailyGap=genesisSprintFlowFold('sprint-a','points',sfStart([$one,$other]),null,[$middle,$late],$asOf,null,['resolution'=>'day','timeZone'=>'UTC']);
sfCheck($dailyGap['series'][1]['scope']['value']===10.0&&!$dailyGap['series'][1]['connectPrevious']&&$dailyGap['series'][1]['gapWithinBucket'],'Daily grouping concealed a historical gap after endpoint recovery');$checks[]='daily sampling and saved calendar timezone';
sfCheck(genesisSprintFlowTask(['taskId'=>'bad','statusId'=>'todo','done'=>false,'active'=>true,'revision'=>1,'sprintId'=>'sprint-a','storyPoints'=>1.0e300,'estimateHours'=>null])===null,'Corrupt effort overflowed aggregate arithmetic');
$badPlan=sfStart([]);$badPlan['plan']=['taskId'=>'not-a-list'];sfCheck(!genesisSprintFlowFold('sprint-a','tasks',$badPlan,null,[],$asOf)['available'],'A malformed plan invented an unavailable task count');
$badRow=genesisSprintFlowFold('sprint-a','tasks',sfStart(['not-a-task']),null,[],$asOf);sfCheck($badRow['summary']['plan']['value']===null,'A malformed plan entry became known zero');$checks[]='corrupt observation bounds and shapes';

// The supported event ceiling over three years: aggregate actual observations without truncating days.
$longStart=sfStart([sfTask('long',1,0)]);$longStart['at']='2023-01-01T00:00:00Z';$longEvents=[];
for($i=1;$i<=20000;$i++){
    $done=$i%2===0;$state=sfTask('long',($i%20)/2,0,['revision'=>$i+1,'statusId'=>$done?'done':'todo','done'=>$done]);
    $time=gmdate('Y-m-d\TH:i:s\Z',strtotime($longStart['at'])+$i*4800);
    $longEvents[]=sfEvent(10+$i,$state,'task.updated',$time);
}
$long=genesisSprintFlowFold('sprint-a','points',$longStart,null,$longEvents,'2026-02-01T00:00:00Z',null,['resolution'=>'day','timeZone'=>'Europe/Moscow']);
sfCheck($long['historyComplete']&&count($long['series'])>1000,'Multi-year history was truncated or lost coverage');
sfCheck($long['summary']['completionTransitions']===10000&&$long['summary']['scope']['value']===0.0&&$long['summary']['scope']['unestimated']===0,'Reopening, zero estimates or event ordering corrupted a large history');
sfCheck(array_sum(array_column(array_filter($long['series'],static fn($sample)=>$sample['sourceKind']==='event'),'sourceCount'))===20000,'Day buckets lost underlying source observations');
$checks[]='20000 actual events over three years, exact reopening/zero estimates and source coverage';

echo json_encode(['pass'=>true,'groups'=>count($checks),'checks'=>$checks],JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR)."\n";
