<?php
declare(strict_types=1);

/** Points stay within each project's scale. Missing estimates have their own exact selection. */
function genesisPlanningReportEstimates(array $tasks,array $projects,callable $add):array {
    $stored=genesisPlanningRows('SELECT p.* FROM shared_task_planning p JOIN genesis_report_tasks rt ON rt.id=p.task_id');$values=[];
    foreach($stored as $row)$values[$row['task_id']]=genesisPlanningOpen($row['estimates_json']);
    $groups=[];$members=[];$available=false;$unestimated=0;
    foreach($projects as $project){$id=$project['id'];$groups[$id]=genesisPlanningEmptyTotals();if(genesisPlanningConfig($id)['enabled'])$available=true;}
    foreach($tasks as $id=>$task){
        $project=$task['project_id'];$member=$task['assignee_id']??'unassigned';$estimates=$values[$id]??['storyPoints'=>null,'estimateHours'=>null];
        $state=['done'=>$task['completed_at']!==null,...$estimates];genesisPlanningAddTotals($groups[$project],$state);
        if(!isset($members[$project][$member]))$members[$project][$member]=genesisPlanningEmptyTotals();genesisPlanningAddTotals($members[$project][$member],$state);
        if($estimates['storyPoints']!==null||$estimates['estimateHours']!==null)$available=true;else $unestimated++;
        foreach(['estimate:'.$project,'estimate:'.$project.':member:'.$member] as $prefix){$add($prefix.':all',$id);
            foreach(['points'=>'storyPoints','hours'=>'estimateHours'] as $unit=>$field)$add($prefix.':'.$unit.($estimates[$field]===null?':missing':':known'),$id);
        }
    }
    $render=static function(array $total,string $prefix):array{
        $result=['all'=>['key'=>$prefix.':all','count'=>$total['count']]];
        foreach(['points','hours'] as $unit)$result[$unit]=['value'=>$total[$unit]['value'],
            'estimated'=>['key'=>$prefix.':'.$unit.':known','count'=>$total['count']-$total[$unit]['unestimated']],
            'unestimated'=>['key'=>$prefix.':'.$unit.':missing','count'=>$total[$unit]['unestimated']]];
        return $result;
    };
    $output=[];foreach($groups as $id=>$total){$people=[];foreach($members[$id]??[] as $member=>$memberTotal)$people[]=['id'=>$member,...$render($memberTotal,'estimate:'.$id.':member:'.$member)];
        $output[]=['projectId'=>$id,...$render($total,'estimate:'.$id),'members'=>$people];}
    return ['available'=>$available,'unestimated'=>$unestimated,'points'=>null,'hours'=>null,'projects'=>$output];
}
function genesisPlanningReportMetrics(array $estimates):array {
    $keys=[];foreach($estimates['projects'] as $project)foreach([$project,...$project['members']] as $group){$keys[]=$group['all']['key'];foreach(['points','hours'] as $unit)foreach(['estimated','unestimated'] as $kind)$keys[]=$group[$unit][$kind]['key'];}return $keys;
}
