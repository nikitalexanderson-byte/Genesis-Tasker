<?php
declare(strict_types=1);
require_once __DIR__.'/template-manifest.php';

/** A consistent content snapshot. Every included project is rechecked; a hidden child never leaks through a template. */
function genesisSharedTemplateCapture(string $actor,string $projectId,?string $taskId,array $options):array
{
    genesisSharedRequireEnabled($actor);$context=genesisCalendarContext($options['calendarContext']??null,'Europe/Moscow',2);
    if($context['version']!==2||!in_array($options['calendarMode']??null,['profane','sacred','lunar'],true)
        ||array_diff(array_keys($options),['calendarMode','calendarContext','anchorDate']))throw new InvalidArgumentException('TEMPLATE_INVALID');
    $db=genesisDb();$owns=!$db->inTransaction();if($owns)$db->beginTransaction();
    try{
        $root=genesisSharedProjectAccess($projectId,$actor,'read',true);$spaceId=$root['space_id'];
        if($taskId===null&&(bool)$root['is_inbox'])throw new InvalidArgumentException('TEMPLATE_SOURCE_NOT_PROJECT');
        $projectIds=[$projectId];$sources=[];$projectRows=[];$taskRows=[];$notices=[];
        for($i=0;$i<count($projectIds);$i++){
            if($i>=50)throw new GenesisResourceLimitException(409,'TEMPLATE_PROJECT_LIMIT');
            $id=$projectIds[$i];
            try{$row=genesisSharedProjectAccess($id,$actor,'read',true);}catch(GenesisSharedAccessException){throw new GenesisSharedAccessException('TEMPLATE_SOURCE_SCOPE_UNAVAILABLE',403);}
            $sources[]=$id;$projectRows[$id]=$row;
            if($taskId===null){
                $q=$db->prepare("SELECT id FROM shared_projects WHERE parent_id=? AND NOT EXISTS(SELECT 1 FROM shared_trash tr WHERE tr.kind='project' AND tr.object_id=shared_projects.id) ORDER BY created_at,id");$q->execute([$id]);
                array_push($projectIds,...$q->fetchAll(PDO::FETCH_COLUMN));
                if(count($projectIds)!==count(array_unique($projectIds)))throw new InvalidArgumentException('PROJECT_CYCLE');
            }
        }
        if($taskId!==null){
            $ids=[$taskId];
            for($i=0;$i<count($ids);$i++){
                if($i>=500)throw new GenesisResourceLimitException(409,'TEMPLATE_TASK_LIMIT');
                $q=$db->prepare('SELECT * FROM shared_tasks_read WHERE id=? AND project_id=?');$q->execute([$ids[$i],$projectId]);$row=$q->fetch();
                if(!$row)throw new GenesisSharedAccessException('TEMPLATE_SOURCE_UNAVAILABLE',404);$taskRows[$row['id']]=$row;
                $q=$db->prepare('SELECT id FROM shared_tasks_read WHERE parent_task_id=? ORDER BY created_at,id');$q->execute([$row['id']]);array_push($ids,...$q->fetchAll(PDO::FETCH_COLUMN));
                if(count($ids)!==count(array_unique($ids)))throw new InvalidArgumentException('TASK_RELATION_CYCLE');
            }
        }else{
            foreach($projectIds as $id){
                $q=$db->prepare('SELECT * FROM shared_tasks_read WHERE project_id=? ORDER BY created_at,id LIMIT 501');$q->execute([$id]);
                foreach($q->fetchAll() as $row)$taskRows[$row['id']]=$row;
                if(count($taskRows)>500)throw new GenesisResourceLimitException(409,'TEMPLATE_TASK_LIMIT');
            }
        }
        $anchor=$options['anchorDate']??($taskId!==null?($taskRows[$taskId]['due_date']??$taskRows[$taskId]['start_date']):null)
            ??(new DateTimeImmutable('now',new DateTimeZone($context['timeZone'])))->format('Y-m-d');
        genesisCalendarDate($anchor);
        $offset=static fn(?string $date):?array=>$date===null?null:['amount'=>genesisCalendarDayNumber($date)-genesisCalendarDayNumber($anchor),'unit'=>'day'];
        $allLabels=array_column(genesisSharedLabels($actor,$spaceId),null,'id');$labelIds=[];$projects=[];$fields=[];$openStatuses=[];
        foreach($projectRows as $id=>$row){
            $q=$db->prepare('SELECT id,title,is_done,color,task_title_lines,visible_task_count,image_url FROM shared_project_statuses WHERE project_id=? AND is_chaos=0 ORDER BY position,id');$q->execute([$id]);$statusRows=$q->fetchAll();
            foreach($statusRows as $status)if(!(bool)$status['is_done']){$openStatuses[$id]=$status;break;}
            $statuses=array_map(static fn($s)=>['key'=>$s['id'],'title'=>$s['title'],'isDone'=>(bool)$s['is_done'],'color'=>$s['color'],
                'taskTitleLines'=>(int)($s['task_title_lines']??($s['is_done']?2:0)),'visibleTaskCount'=>(int)($s['visible_task_count']??($s['is_done']?5:0))],$statusRows);
            foreach($statusRows as $status)if(!empty($status['image_url']))$notices[]=['code'=>'BOARD_IMAGE_EXCLUDED','projectKey'=>$id,'title'=>$status['title']];
            $q=$db->prepare('SELECT id,title,color FROM shared_project_categories WHERE project_id=? ORDER BY position,id');$q->execute([$id]);
            $categories=array_map(static fn($c)=>['key'=>$c['id'],'title'=>$c['title'],'color'=>$c['color']],$q->fetchAll());
            $labels=genesisSharedLabelIds('project',$id);foreach($labels as $label)$labelIds[$label]=true;
            $projects[]=['key'=>$id,'parentKey'=>$id===$projectId?null:$row['parent_id'],'title'=>$row['title'],'description'=>$row['description'],
                'layout'=>$row['layout'],'kind'=>$row['kind'],'statuses'=>$statuses,'categories'=>$categories,'labelKeys'=>$labels,
                'tags'=>json_decode($row['tags_json'],true,32,JSON_THROW_ON_ERROR),'boardStatusKey'=>$id===$projectId?null:$row['board_status_id']];
            if($row['archived_at']!==null)$notices[]=['code'=>'PROJECT_ARCHIVE_RESET','projectKey'=>$id];
            if(!empty($row['image_url']))$notices[]=['code'=>'PROJECT_IMAGE_EXCLUDED','projectKey'=>$id];
            foreach(genesisSharedCustomFields($actor,$spaceId,$id,true) as $field){
                if($field['archived']){$notices[]=['code'=>'ARCHIVED_FIELD_EXCLUDED','projectKey'=>$id,'title'=>$field['title']];continue;}
                $fields[$field['id']]=['key'=>$field['id'],'projectKey'=>$field['projectId'],'title'=>$field['title'],'type'=>$field['type'],'options'=>$field['options'],
                    'required'=>$field['required'],'showCard'=>$field['showCard'],'showList'=>$field['showList'],'position'=>$field['position']];
            }
            $q=$db->prepare('SELECT COUNT(*) FROM shared_tasks_history_read WHERE project_id=? AND archived_at IS NOT NULL');$q->execute([$id]);$archived=(int)$q->fetchColumn();
            if($archived)$notices[]=['code'=>'ARCHIVED_TASKS_EXCLUDED','projectKey'=>$id,'count'=>$archived];
        }
        // Parents precede children even when a task was reparented after its original creation.
        $ordered=[];$remaining=$taskRows;
        while($remaining){$advanced=false;foreach($remaining as $id=>$row){
            if($row['parent_task_id']!==null&&isset($remaining[$row['parent_task_id']]))continue;
            $ordered[$id]=$row;unset($remaining[$id]);$advanced=true;
        }if(!$advanced)throw new InvalidArgumentException('TASK_RELATION_CYCLE');}
        $tasks=[];
        foreach($ordered as $id=>$row){
            // Keep template schema v1 readable by installed clients. A new copy of an inbox
            // task starts on the first open board, with the normal mapping notice; its source stays intact.
            if(str_starts_with($row['status_id'],'chaos-')){
                $open=$openStatuses[$row['project_id']]??null;
                if($open===null)throw new InvalidArgumentException('TEMPLATE_OPEN_STATUS_REQUIRED');
                $row['status_id']=$open['id'];$notices[]=['code'=>'STATUS_MAPPED','taskKey'=>$id,'title'=>$open['title']];
            }
            $labels=genesisSharedLabelIds('task',$id);foreach($labels as $label)$labelIds[$label]=true;
            $dependencies=genesisSharedDependencyIds($id);$outside=array_values(array_diff($dependencies,array_keys($taskRows)));
            if($outside)$notices[]=['code'=>'EXTERNAL_DEPENDENCIES_EXCLUDED','taskKey'=>$id,'count'=>count($outside)];
            $lists=[];foreach(json_decode($row['checklists_json'],true,64,JSON_THROW_ON_ERROR) as $list){$items=[];
                foreach($list['items'] as $item){$linked=$item['linkedTaskId']??null;
                    if(!empty($item['done']))$notices[]=['code'=>'CHECKLIST_COMPLETION_RESET','taskKey'=>$id,'itemKey'=>$item['id']];
                    if($linked!==null&&(!isset($taskRows[$linked])||$taskRows[$linked]['project_id']!==$row['project_id'])){$notices[]=['code'=>'EXTERNAL_CHECKLIST_LINK_EXCLUDED','taskKey'=>$id];$linked=null;}
                    $items[]=['key'=>$item['id'],'title'=>$item['title'],'assigneeId'=>$item['assigneeId']??null,'due'=>$offset($item['dueDate']??null),'linkedTaskKey'=>$linked];
                }
                $lists[]=['key'=>$list['id'],'title'=>$list['title'],'items'=>$items];
            }
            $values=genesisSharedCustomTaskValues($id);$kept=array_intersect_key($values,$fields);
            if(count($kept)!==count($values))$notices[]=['code'=>'UNAVAILABLE_FIELD_VALUES_EXCLUDED','taskKey'=>$id,'count'=>count($values)-count($kept)];
            $approvals=genesisSharedTaskApprovals($id);$approvers=array_values(array_filter(array_column($approvals,'userId'),'is_string'));
            if(count($approvers)!==count($approvals))$notices[]=['code'=>'FORMER_APPROVER_UNAVAILABLE','taskKey'=>$id,'count'=>count($approvals)-count($approvers),'requiredApproverCount'=>count($approvals)];
            $tasks[]=['key'=>$id,'projectKey'=>$row['project_id'],'parentKey'=>$id===$taskId||!isset($taskRows[$row['parent_task_id']??''])?null:$row['parent_task_id'],
                'title'=>$row['title'],'description'=>$row['description'],'entryType'=>$row['entry_type'],'statusKey'=>$row['status_id'],'categoryKey'=>$row['category_id'],
                'priority'=>(int)$row['priority'],'tags'=>json_decode($row['tags_json'],true,32,JSON_THROW_ON_ERROR),'assigneeId'=>$row['assignee_id'],'approvalRequired'=>(bool)$approvals,'approverIds'=>$approvers,
                'labelKeys'=>$labels,'dependsOnKeys'=>array_values(array_intersect($dependencies,array_keys($taskRows))),
                'due'=>$offset($row['due_date']),'start'=>$offset($row['start_date']),'startTime'=>$row['start_time'],'endTime'=>$row['end_time'],
                'checklists'=>$lists,'customValues'=>(object)$kept,...array_intersect_key(genesisPlanningTaskValues($row['id']),['storyPoints'=>true,'estimateHours'=>true])];
            if($row['completed_at']!==null)$notices[]=['code'=>'TASK_COMPLETION_RESET','taskKey'=>$id];
            $q=$db->prepare('SELECT (SELECT COUNT(*) FROM shared_task_attachments WHERE task_id=?)+(SELECT COUNT(*) FROM shared_task_images WHERE task_id=?)+(SELECT COUNT(*) FROM shared_comments WHERE task_id=?)');$q->execute([$id,$id,$id]);$privateCount=(int)$q->fetchColumn();
            if($privateCount)$notices[]=['code'=>'PRIVATE_CONTENT_EXCLUDED','taskKey'=>$id,'count'=>$privateCount];
        }
        $labels=[];foreach(array_keys($labelIds) as $id){if(!isset($allLabels[$id]))throw new InvalidArgumentException('TEMPLATE_REFERENCE_INVALID');$label=$allLabels[$id];$labels[]=['key'=>$id,'title'=>$label['title'],'color'=>$label['color']];}
        $manifest=genesisTemplateManifest(['schemaVersion'=>1,'kind'=>$taskId===null?'project':'task','calendarMode'=>$options['calendarMode'],'calendarContext'=>$context,
            'projects'=>$projects,'labels'=>$labels,'fields'=>array_values($fields),'tasks'=>$tasks]);
        if($owns)$db->commit();return ['manifest'=>$manifest,'sourceProjectIds'=>$sources,'sourceSpaceId'=>$spaceId,'sourceAnchor'=>$anchor,'notices'=>$notices];
    }catch(Throwable $error){if($owns&&$db->inTransaction())$db->rollBack();throw $error;}
}
