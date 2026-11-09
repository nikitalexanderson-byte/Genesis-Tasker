<?php
declare(strict_types=1);

/** Invoked by template-apply.php inside its isolated, disposable space. */
function taGraphIntegrations(string $owner,string $space,string $library,string $member,array $context):void
{
    $db=genesisDb();$checks=0;
    $check=static function(bool $ok,string $message)use(&$checks):void{taCheck($ok,$message);$checks++;};
    $reject=static function(callable $work,string $code)use(&$checks):void{taReject($work,$code);$checks++;};
    $number=static fn(array $task,string $field,float $expected):bool=>isset($task[$field])&&(is_int($task[$field])||is_float($task[$field]))&&(float)$task[$field]===$expected;
    $project=genesisSharedCreateProject($owner,$space,['title'=>'C1 B1 B2 C2 C5 graph'])['id'];
    $statuses=genesisSharedProjectSnapshot($owner,$project)['statuses'];
    $open=array_values(array_filter($statuses,static fn($status)=>!$status['isDone']))[0]['id'];
    $done=array_values(array_filter($statuses,static fn($status)=>(bool)$status['isDone']))[0]['id'];
    $importProject=genesisSharedCreateProject($owner,$space,['title'=>'Graph import destination'])['id'];
    $setRole=static function(?string $role,?string $importRole='member')use($owner,$space,$library,$project,$importProject,$member):void{
        $grants=[['projectId'=>$library,'role'=>'viewer','includeDescendants'=>false]];
        if($role!==null)$grants[]=['projectId'=>$project,'role'=>$role,'includeDescendants'=>false];
        if($importRole!==null)$grants[]=['projectId'=>$importProject,'role'=>$importRole,'includeDescendants'=>false];
        $access=['allProjects'=>false,'grants'=>$grants];$preview=genesisSharedPreviewProjectAccess($owner,$space,$member,$access);
        genesisSharedSaveProjectAccess($owner,$space,$member,[...$access,'operationId'=>genesisUuid(),'expectedFingerprint'=>$preview['fingerprint']]);
    };
    $setRole('member');
    $manifest=['schemaVersion'=>1,'kind'=>'task','calendarMode'=>'profane','calendarContext'=>$context,
        'projects'=>[['key'=>'root','title'=>'Graph','kind'=>'project','layout'=>'list','statuses'=>[
            ['key'=>'open','title'=>'Open','isDone'=>false],['key'=>'done','title'=>'Done','isDone'=>true]]]],
        'tasks'=>[['key'=>'parent','projectKey'=>'root','title'=>'Graph parent','statusKey'=>'open','priority'=>3,'storyPoints'=>0,'estimateHours'=>1.5,
            'checklists'=>[['key'=>'list','title'=>'Linked graph','items'=>[['key'=>'item','title'=>'Graph child','linkedTaskKey'=>'child','due'=>['amount'=>1,'unit'=>'month']]]]]],
            ['key'=>'child','projectKey'=>'root','title'=>'Graph child','parentKey'=>'parent','statusKey'=>'open','priority'=>1,'storyPoints'=>2,'estimateHours'=>0]]];
    $template=genesisSharedSaveTemplate($owner,$space,$library,['operationId'=>genesisUuid(),'title'=>'Graph integration','manifest'=>$manifest])['id'];
    $options=['spaceId'=>$space,'projectId'=>$project,'anchorDate'=>'2024-01-31','statusMap'=>['open'=>$open,'done'=>$done]];
    $preview=genesisSharedPreviewTemplate($member,$template,$options);$check($preview['canApply'],'Member could not preview the linked graph');
    $command=[...$options,'operationId'=>genesisUuid(),'fingerprint'=>$preview['fingerprint']];
    $receipt=genesisSharedApplyTemplate($member,$template,$command);
    $parent=genesisSharedGetTask($owner,$project,$receipt['taskIds']['parent']);$child=genesisSharedGetTask($owner,$project,$receipt['taskIds']['child']);
    $check($parent['checklists'][0]['items'][0]['linkedTaskId']===$child['id']&&$child['parentTaskId']===$parent['id'],'Applied graph links do not point at its new child');
    $check($number($parent,'storyPoints',0)&&$number($parent,'estimateHours',1.5)&&$number($child,'estimateHours',0),'Applied graph lost independent zero/decimal estimates');
    $check($parent['checklists'][0]['items'][0]['dueDate']==='2024-02-29','Linked checklist relative month was not clamped to the leap day');
    $count=static fn():int=>(int)genesisDb()->query('SELECT COUNT(*) FROM shared_tasks')->fetchColumn();
    $before=$count();$check(genesisSharedApplyTemplate($member,$template,$command)===$receipt&&$count()===$before,'Template replay duplicated the graph');
    $setRole('viewer');$reject(fn()=>genesisSharedApplyTemplate($member,$template,$command),'SHARED_PROJECT_FORBIDDEN');
    $setRole(null);$reject(fn()=>genesisSharedApplyTemplate($member,$template,$command),'SHARED_PROJECT_NOT_FOUND');$setRole('member');
    $rule=genesisSharedSaveAutomation($owner,$project,['operationId'=>genesisUuid(),'title'=>'Complete parent then seed graph','enabled'=>true,'ownerId'=>$member,
        'definition'=>['schemaVersion'=>1,'trigger'=>['type'=>'completed'],'conditions'=>[['field'=>'priority','operator'=>'eq','value'=>3]],
            'actions'=>[['type'=>'createTemplate','templateId'=>$template,'options'=>['statusMap'=>['open'=>$open,'done'=>$done]]]],
            'calendarMode'=>'profane','calendarContext'=>$context]]);
    $reject(fn()=>genesisSharedTask($member,$project,['expectedRevision'=>$parent['revision'],'statusId'=>$done],$parent['id']),'SHARED_PROJECT_FORBIDDEN');
    $reject(fn()=>genesisSharedTask($owner,$project,['expectedRevision'=>$parent['revision'],'statusId'=>$done],$parent['id']),'TASK_CHILDREN_INCOMPLETE');
    $check(genesisSharedAutomationRuns($owner,$project,$rule['id'])['runs']===[],'Rejected parent completion enqueued an automation');
    $child=genesisSharedTask($owner,$project,['expectedRevision'=>$child['revision'],'statusId'=>$done],$child['id']);
    $parent=genesisSharedTask($owner,$project,['expectedRevision'=>$parent['revision'],'statusId'=>$done],$parent['id']);
    $runs=genesisSharedAutomationRuns($owner,$project,$rule['id'])['runs'];
    $first=array_values(array_filter($runs,static fn($run)=>$run['taskId']===$parent['id']))[0];
    $setRole('viewer');$job=genesisBackgroundClaim(null,'automation:'.$first['id'].':0');$check($job!==null,'Completion job was not queued');
    $before=$count();genesisBackgroundPerform($job);
    $state=genesisPlanningRows('SELECT state,error_code FROM shared_automation_runs WHERE id=?',[$first['id']])[0];
    $check($state['state']==='cancelled'&&$state['error_code']==='SHARED_PROJECT_FORBIDDEN'&&$count()===$before,'Revoked write access still let the queued rule create a graph');
    $setRole('member');
    $parent=genesisSharedTask($owner,$project,['expectedRevision'=>$parent['revision'],'statusId'=>$open],$parent['id']);
    $parent=genesisSharedTask($owner,$project,['expectedRevision'=>$parent['revision'],'statusId'=>$done],$parent['id']);
    $runs=genesisSharedAutomationRuns($owner,$project,$rule['id'])['runs'];
    $next=array_values(array_filter($runs,static fn($run)=>$run['taskId']===$parent['id']&&$run['id']!==$first['id']))[0];
    $job=genesisBackgroundClaim(null,'automation:'.$next['id'].':0');$check($job!==null,'Recompleted parent did not create a fresh job');
    $before=$count();genesisBackgroundPerform($job);
    $state=genesisPlanningRows('SELECT state FROM shared_automation_runs WHERE id=?',[$next['id']])[0]['state'];
    $check($state==='succeeded'&&$count()===$before+2,'Completion rule did not atomically create exactly one new graph');
    $after=$count();$check(genesisBackgroundPerform($job)==='superseded'&&$count()===$after,'A replayed worker acknowledgement duplicated the graph');
    $generated=genesisPlanningRows('SELECT id,parent_task_id FROM shared_tasks_read WHERE project_id=? AND id NOT IN (?,?)',[$project,$parent['id'],$child['id']]);
    $generatedParentId=array_values(array_filter($generated,static fn($row)=>$row['parent_task_id']===null))[0]['id'];
    $generatedChildId=array_values(array_filter($generated,static fn($row)=>$row['parent_task_id']===$generatedParentId))[0]['id'];
    $generatedParent=genesisSharedGetTask($owner,$project,$generatedParentId);$generatedChild=genesisSharedGetTask($owner,$project,$generatedChildId);
    $check($generatedParent['completedAt']===null&&$generatedChild['completedAt']===null&&!$generatedParent['checklists'][0]['items'][0]['done']
        &&$generatedParent['checklists'][0]['items'][0]['linkedTaskId']===$generatedChildId,'Worker copied completion state or linked its checklist to the original child');
    $check($number($generatedParent,'storyPoints',0)&&$number($generatedParent,'estimateHours',1.5)&&$number($generatedChild,'estimateHours',0),'Worker graph lost zero/decimal estimates');
    $reject(fn()=>genesisSharedTask($owner,$project,['expectedRevision'=>$generatedParent['revision'],'statusId'=>$done],$generatedParentId),'TASK_CHILDREN_INCOMPLETE');
    $export=genesisSharedDataExport($owner,$space,['scope'=>'project','projectId'=>$project]);
    $importStatuses=genesisSharedProjectSnapshot($owner,$importProject)['statuses'];
    $importDone=array_values(array_filter($importStatuses,static fn($status)=>(bool)$status['isDone']))[0]['id'];
    $statusMap=[];$targets=array_column($importStatuses,null,'title');
    foreach($statuses as $status)$statusMap[$status['id']]=$targets[$status['title']]['id'];
    $historicalRule=genesisSharedSaveAutomation($owner,$importProject,['operationId'=>genesisUuid(),'title'=>'Historical imports remain quiet','enabled'=>true,
        'definition'=>['schemaVersion'=>1,'trigger'=>['type'=>'created'],'conditions'=>[],'actions'=>[['type'=>'priority','value'=>2]],'calendarMode'=>'profane','calendarContext'=>$context]]);
    $input=['format'=>'json','content'=>$export['content'],'spaceId'=>$space,'projectId'=>$importProject,'statusMap'=>$statusMap];
    $preview=genesisSharedDataPreview($member,$input);
    $check(!$preview['canApply']&&in_array('DATA_ORGANIZE_REQUIRED',array_column($preview['blockers'],'code'),true),'Preview promised an import that requires unavailable status permissions');
    $before=$count();$reject(fn()=>genesisSharedDataApply($member,[...$input,'operationId'=>genesisUuid(),'fingerprint'=>$preview['fingerprint']]),'DATA_APPLY_BLOCKED');
    $check($count()===$before,'Blocked historical graph import left staged tasks');
    $sample=genesisDataEmpty('Open status permissions');$sample['calendarContext']=$context;
    $sample['projects']=[['key'=>'p','title'=>'Status mapping','kind'=>'project','layout'=>'list','statuses'=>array_map(static fn($status)=>[
        'key'=>$status['id'],'title'=>$status['title'],'isDone'=>(bool)$status['isDone']],$statuses)]];
    $secondOpen=array_values(array_filter($statuses,static fn($status)=>!$status['isDone']&&$status['id']!==$open))[0]['id'];
    $sample['tasks']=[['key'=>'sample','projectKey'=>'p','title'=>'Secondary unfinished status','statusKey'=>$secondOpen]];
    $secondary=genesisSharedDataPreview($member,[...$input,'content'=>genesisDataJson($sample)]);
    $check(!$secondary['canApply']&&in_array('DATA_ORGANIZE_REQUIRED',array_column($secondary['blockers'],'code'),true),'Another unfinished status bypassed the organization preflight');
    $sample['tasks'][0]['statusKey']=$open;$initial=genesisSharedDataPreview($member,[...$input,'content'=>genesisDataJson($sample)]);
    $check($initial['canApply']&&$count()===$before,'A normal initial-status import was unnecessarily blocked or preview wrote tasks');
    genesisSharedAssignMemberPermissions($owner,$space,$member,['categoryId'=>null,'permissions'=>[
        'createProjects'=>true,'editTasks'=>true,'organizeTasks'=>true,'comment'=>true,'manageProjects'=>false,'inviteMembers'=>false]]);
    $preview=genesisSharedDataPreview($member,$input);$check($preview['canApply'],'Exported graph could not be previewed with status permission: '.json_encode($preview['blockers'],JSON_THROW_ON_ERROR));
    $import=[...$input,'operationId'=>genesisUuid(),'fingerprint'=>$preview['fingerprint']];$imported=genesisSharedDataApply($member,$import);
    $importParent=genesisSharedGetTask($owner,$importProject,$imported['taskIds'][$generatedParentId]);
    $importChild=genesisSharedGetTask($owner,$importProject,$imported['taskIds'][$generatedChildId]);
    $check($imported['taskCount']===4&&$importChild['parentTaskId']===$importParent['id']&&$importParent['checklists'][0]['items'][0]['linkedTaskId']===$importChild['id'],
        'Export/import retained source IDs instead of mapping both graph links');
    $check($importParent['priority']===3&&$importChild['priority']===1&&$number($importParent,'storyPoints',0)&&$number($importParent,'estimateHours',1.5)&&$number($importChild,'estimateHours',0),
        'Export/import lost priority or known zero/decimal estimates');
    $check(genesisSharedAutomationRuns($owner,$importProject,$historicalRule['id'])['runs']===[],'Historical graph import triggered a live create automation');
    $before=$count();$check(genesisSharedDataApply($member,$import)===$imported&&$count()===$before,'Import replay duplicated the task graph');
    $reject(fn()=>genesisSharedTask($owner,$importProject,['expectedRevision'=>$importParent['revision'],'statusId'=>$importDone],$importParent['id']),'TASK_CHILDREN_INCOMPLETE');
    $setRole('member','viewer');$before=$count();
    $check(genesisSharedDataApply($member,$import)===$imported&&$count()===$before,'Readable committed import receipt was not a read-only exact replay');
    $reject(fn()=>genesisSharedDataPreview($member,$input),'SHARED_PROJECT_FORBIDDEN');
    $reject(fn()=>genesisSharedDataApply($member,[...$import,'operationId'=>genesisUuid()]),'SHARED_PROJECT_FORBIDDEN');
    $setRole('member',null);$reject(fn()=>genesisSharedDataApply($member,$import),'SHARED_PROJECT_NOT_FOUND');
    $check($db->query('PRAGMA foreign_key_check')->fetchAll()===[],'Cross-feature graph left invalid foreign keys');
    echo "Task graph integrations: {$checks} checks passed for template/checklist/parent, current-role replay, revoked queued worker, recompletion, estimates and historical JSON exchange.\n";
}
