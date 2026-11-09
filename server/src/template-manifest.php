<?php
declare(strict_types=1);
require_once __DIR__.'/template-dates.php';
require_once __DIR__.'/shared-planning.php';

function genesisTemplateKey(mixed $value):string
{
    if(!is_string($value)||!preg_match('/^[a-zA-Z0-9:_-]{1,100}$/D',$value))throw new InvalidArgumentException('TEMPLATE_INVALID');
    return $value;
}
function genesisTemplateList(mixed $value,int $limit):array
{
    if(!is_array($value)||!array_is_list($value)||count($value)>$limit)throw new InvalidArgumentException('TEMPLATE_INVALID');return $value;
}
function genesisTemplateNullableKey(mixed $value):?string{return $value===null?null:genesisTemplateKey($value);}
function genesisTemplateOffset(mixed $value):?array
{
    if($value===null)return null;
    if(!is_array($value)||array_diff(array_keys($value),['amount','unit'])||!is_int($value['amount']??null)||!in_array($value['unit']??null,['day','month','year'],true))throw new InvalidArgumentException('TEMPLATE_DATE_INVALID');
    if(abs($value['amount'])>match($value['unit']){'day'=>74000,'month'=>2400,default=>200})throw new InvalidArgumentException('TEMPLATE_DATE_INVALID');
    return ['amount'=>$value['amount'],'unit'=>$value['unit']];
}
function genesisTemplateKeys(mixed $value,array $allowed):array
{
    $values=genesisTemplateList($value,500);$out=[];
    foreach($values as $value){$key=genesisTemplateKey($value);if(!isset($allowed[$key])||isset($out[$key]))throw new InvalidArgumentException('TEMPLATE_REFERENCE_INVALID');$out[$key]=true;}
    return array_keys($out);
}

/** Portable content only. No permissions, files, discussions, subscriptions or executable expressions. */
function genesisTemplateManifest(mixed $input):array
{
    if(!is_array($input)||($input['schemaVersion']??null)!==1||!in_array($input['kind']??null,['task','project'],true)
        ||!in_array($input['calendarMode']??null,['profane','sacred','lunar'],true)
        ||!is_array($input['calendarContext']??null)||($input['calendarContext']['version']??null)!==2
        ||array_diff(array_keys($input),['schemaVersion','kind','calendarMode','calendarContext','projects','labels','fields','tasks']))throw new InvalidArgumentException('TEMPLATE_INVALID');
    $context=genesisCalendarContext($input['calendarContext'],'Europe/Moscow',2);
    $projects=[];$statuses=[];$categories=[];
    foreach(genesisTemplateList($input['projects']??null,50) as $project){
        if(!is_array($project)||array_diff(array_keys($project),['key','parentKey','title','description','layout','kind','statuses','categories','labelKeys','tags','boardStatusKey']))throw new InvalidArgumentException('TEMPLATE_INVALID');
        $key=genesisTemplateKey($project['key']??null);$parent=genesisTemplateNullableKey($project['parentKey']??null);
        if(isset($projects[$key])||$parent!==null&&(!is_string($parent)||!isset($projects[$parent]))||!in_array($project['layout']??null,['list','board'],true)||!in_array($project['kind']??null,['project','task-list'],true))throw new InvalidArgumentException('TEMPLATE_REFERENCE_INVALID');
        if(!$projects&&$parent!==null||$projects&&$parent===null)throw new InvalidArgumentException('TEMPLATE_REFERENCE_INVALID');
        $columns=[];$kinds=[];
        foreach(genesisTemplateList($project['statuses']??null,30) as $status){
            if(!is_array($status)||!is_bool($status['isDone']??null)||array_diff(array_keys($status),['key','title','isDone','color','taskTitleLines','visibleTaskCount']))throw new InvalidArgumentException('TEMPLATE_INVALID');
            $statusKey=genesisTemplateKey($status['key']??null);if(isset($statuses[$statusKey]))throw new InvalidArgumentException('TEMPLATE_REFERENCE_INVALID');
            $lines=$status['taskTitleLines']??($status['isDone']?2:0);$visible=$status['visibleTaskCount']??($status['isDone']?5:0);
            if(!is_int($lines)||$lines<0||$lines>3||!is_int($visible)||$visible<0||$visible>1000)throw new InvalidArgumentException('INVALID_BOARD_DISPLAY');
            $columns[]=['key'=>$statusKey,'title'=>genesisSharedTitle($status['title']??null,80),'isDone'=>$status['isDone'],
                'color'=>genesisSharedCategoryColor($status['color']??'#2d6c68'),'taskTitleLines'=>$lines,'visibleTaskCount'=>$visible];
            $statuses[$statusKey]=['projectKey'=>$key,'isDone'=>$status['isDone']];$kinds[(int)$status['isDone']]=true;
        }
        if(count($kinds)!==2)throw new InvalidArgumentException('TEMPLATE_OPEN_STATUS_REQUIRED');
        $projectCategories=[];
        foreach(genesisTemplateList($project['categories']??[],50) as $category){
            if(!is_array($category)||array_diff(array_keys($category),['key','title','color']))throw new InvalidArgumentException('TEMPLATE_INVALID');
            $categoryKey=genesisTemplateKey($category['key']??null);if(isset($categories[$categoryKey]))throw new InvalidArgumentException('TEMPLATE_REFERENCE_INVALID');
            $projectCategories[]=['key'=>$categoryKey,'title'=>genesisSharedTitle($category['title']??null,80),'color'=>genesisSharedCategoryColor($category['color']??'#2d6c68')];$categories[$categoryKey]=$key;
        }
        $board=genesisTemplateNullableKey($project['boardStatusKey']??null);
        if($board!==null&&(!isset($statuses[$board])||$statuses[$board]['projectKey']!==$parent))throw new InvalidArgumentException('TEMPLATE_REFERENCE_INVALID');
        $projects[$key]=['key'=>$key,'parentKey'=>$parent,'title'=>genesisSharedTitle($project['title']??null),'description'=>genesisSharedText($project['description']??'',5000),
            'layout'=>$project['layout'],'kind'=>$project['kind'],'statuses'=>$columns,'categories'=>$projectCategories,'boardStatusKey'=>$board,
            'labelKeys'=>$project['labelKeys']??[],'tags'=>genesisSharedTags($project['tags']??[])];
    }
    if(!$projects||$input['kind']==='task'&&count($projects)!==1)throw new InvalidArgumentException('TEMPLATE_INVALID');
    $labels=[];foreach(genesisTemplateList($input['labels']??[],50) as $label){
        if(!is_array($label)||array_diff(array_keys($label),['key','title','color']))throw new InvalidArgumentException('TEMPLATE_INVALID');
        $key=genesisTemplateKey($label['key']??null);if(isset($labels[$key]))throw new InvalidArgumentException('TEMPLATE_REFERENCE_INVALID');
        $labels[$key]=['key'=>$key,'title'=>genesisSharedTitle($label['title']??null,40),'color'=>genesisSharedCategoryColor($label['color']??'#2d6c68')];
    }
    foreach($projects as &$project)$project['labelKeys']=genesisTemplateKeys($project['labelKeys'],$labels);unset($project);
    $fields=[];foreach(genesisTemplateList($input['fields']??[],200) as $field){
        if(!is_array($field)||array_diff(array_keys($field),['key','projectKey','title','type','options','required','showCard','showList','position']))throw new InvalidArgumentException('TEMPLATE_INVALID');
        $key=genesisTemplateKey($field['key']??null);$projectKey=genesisTemplateNullableKey($field['projectKey']??null);
        if(isset($fields[$key])||$projectKey!==null&&!isset($projects[$projectKey])||!in_array($field['type']??null,['text','number','date','select','multi','checkbox','url'],true))throw new InvalidArgumentException('TEMPLATE_INVALID');
        foreach(['required','showCard','showList'] as $flag)if(!is_bool($field[$flag]??null))throw new InvalidArgumentException('TEMPLATE_INVALID');
        $position=$field['position']??0;if(!is_int($position)||abs($position)>100000)throw new InvalidArgumentException('TEMPLATE_INVALID');
        $options=[];foreach(genesisTemplateList($field['options']??[],10000) as $option){
            if(!is_array($option)||!is_bool($option['archived']??null)||array_diff(array_keys($option),['id','title','archived']))throw new InvalidArgumentException('TEMPLATE_INVALID');
            $id=genesisTemplateKey($option['id']??null);if(isset($options[$id]))throw new InvalidArgumentException('TEMPLATE_REFERENCE_INVALID');
            $options[$id]=['id'=>$id,'title'=>genesisSharedTitle($option['title']??null,160),'archived'=>$option['archived']];
        }
        if(count(array_filter($options,static fn($option)=>!$option['archived']))>200||strlen(json_encode(array_values($options),JSON_THROW_ON_ERROR))>1_000_000)throw new InvalidArgumentException('TEMPLATE_INVALID');
        if(!in_array($field['type'],['select','multi'],true)&&$options)throw new InvalidArgumentException('TEMPLATE_INVALID');
        $fields[$key]=['key'=>$key,'projectKey'=>$projectKey,'title'=>genesisSharedTitle($field['title']??null),'type'=>$field['type'],'options'=>array_values($options),
            'required'=>$field['required'],'showCard'=>$field['showCard'],'showList'=>$field['showList'],'position'=>$position];
    }
    $tasks=[];$checklistKeys=[];
    foreach(genesisTemplateList($input['tasks']??null,500) as $task){
        if(!is_array($task)||array_diff(array_keys($task),['key','projectKey','parentKey','title','description','entryType','statusKey','categoryKey','priority','tags','assigneeId','labelKeys','dependsOnKeys','due','start','startTime','endTime','checklists','customValues','approvalRequired','approverIds','storyPoints','estimateHours']))throw new InvalidArgumentException('TEMPLATE_INVALID');
        $key=genesisTemplateKey($task['key']??null);$project=genesisTemplateKey($task['projectKey']??null);$parent=genesisTemplateNullableKey($task['parentKey']??null);$status=genesisTemplateKey($task['statusKey']??null);$category=genesisTemplateNullableKey($task['categoryKey']??null);
        if(isset($tasks[$key])||!isset($projects[$project])||!isset($statuses[$status])||$statuses[$status]['projectKey']!==$project
            ||$parent!==null&&(!isset($tasks[$parent])||$tasks[$parent]['projectKey']!==$project)||$category!==null&&($categories[$category]??null)!==$project)throw new InvalidArgumentException('TEMPLATE_REFERENCE_INVALID');
        $priority=$task['priority']??0;if(!is_int($priority)||$priority<0||$priority>3)throw new InvalidArgumentException('TEMPLATE_INVALID');
        $assignee=$task['assigneeId']??null;if($assignee!==null)$assignee=genesisTemplateKey($assignee);
        $approval=$task['approvalRequired']??false;if(!is_bool($approval))throw new InvalidArgumentException('TEMPLATE_INVALID');
        $approvers=[];foreach(genesisTemplateList($task['approverIds']??[],200) as $id){$id=genesisTemplateKey($id);if(isset($approvers[$id]))throw new InvalidArgumentException('TEMPLATE_INVALID');$approvers[$id]=true;}
        if(!$approval&&$approvers)throw new InvalidArgumentException('TEMPLATE_INVALID');
        $entryType=genesisEntryType($task['entryType']??'task');if($entryType==='birthday')throw new InvalidArgumentException('TEMPLATE_INVALID');
        $times=[];foreach(['startTime','endTime'] as $field){$value=$task[$field]??null;if($value!==null&&(!is_string($value)||!preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/D',$value)))throw new InvalidArgumentException('TEMPLATE_DATE_INVALID');$times[$field]=$value;}
        if(($times['startTime']===null)!==($times['endTime']===null))throw new InvalidArgumentException('TEMPLATE_DATE_INVALID');
        $lists=[];$itemCount=0;
        foreach(genesisTemplateList($task['checklists']??[],20) as $list){
            if(!is_array($list)||array_diff(array_keys($list),['key','title','items']))throw new InvalidArgumentException('TEMPLATE_INVALID');
            $listKey=genesisTemplateKey($list['key']??null);if(isset($checklistKeys[$listKey]))throw new InvalidArgumentException('TEMPLATE_REFERENCE_INVALID');$checklistKeys[$listKey]=true;$items=[];
            foreach(genesisTemplateList($list['items']??null,300) as $item){
                if(!is_array($item)||++$itemCount>300||array_diff(array_keys($item),['key','title','assigneeId','due','linkedTaskKey']))throw new InvalidArgumentException('TEMPLATE_INVALID');
                $itemKey=genesisTemplateKey($item['key']??null);if(isset($checklistKeys[$itemKey]))throw new InvalidArgumentException('TEMPLATE_REFERENCE_INVALID');$checklistKeys[$itemKey]=true;
                $member=$item['assigneeId']??null;if($member!==null)$member=genesisTemplateKey($member);
                $items[]=['key'=>$itemKey,'title'=>genesisSharedTitle($item['title']??null,500),'assigneeId'=>$member,'due'=>genesisTemplateOffset($item['due']??null),'linkedTaskKey'=>genesisTemplateNullableKey($item['linkedTaskKey']??null)];
            }
            $lists[]=['key'=>$listKey,'title'=>genesisSharedTitle($list['title']??null),'items'=>$items];
        }
        $values=$task['customValues']??[];if($values instanceof stdClass)$values=(array)$values;if(!is_array($values)||$values&&array_is_list($values))throw new InvalidArgumentException('TEMPLATE_INVALID');$custom=[];
        foreach($values as $fieldKey=>$value){
            if(!isset($fields[$fieldKey])||$fields[$fieldKey]['projectKey']!==null&&$fields[$fieldKey]['projectKey']!==$project)throw new InvalidArgumentException('TEMPLATE_REFERENCE_INVALID');
            $value=genesisSharedCustomValue($fields[$fieldKey],$value,$value);if($value!==null)$custom[$fieldKey]=$value;
        }
        $tasks[$key]=['key'=>$key,'projectKey'=>$project,'parentKey'=>$parent,'title'=>genesisSharedTitle($task['title']??null),'description'=>genesisSharedText($task['description']??'',20000),
            'entryType'=>$entryType,'statusKey'=>$status,'categoryKey'=>$category,'priority'=>$priority,'tags'=>genesisSharedTags($task['tags']??[]),'assigneeId'=>$assignee,'approvalRequired'=>$approval,'approverIds'=>array_keys($approvers),
            'labelKeys'=>genesisTemplateKeys($task['labelKeys']??[],$labels),'dependsOnKeys'=>$task['dependsOnKeys']??[],'due'=>genesisTemplateOffset($task['due']??null),
            'start'=>genesisTemplateOffset($task['start']??null),...$times,'checklists'=>$lists,'customValues'=>(object)$custom,
            'storyPoints'=>genesisPlanningEstimate($task['storyPoints']??null),'estimateHours'=>genesisPlanningEstimate($task['estimateHours']??null)];
    }
    if(!$tasks&&$input['kind']==='task')throw new InvalidArgumentException('TEMPLATE_INVALID');
    foreach($tasks as &$task){
        $task['dependsOnKeys']=genesisTemplateKeys($task['dependsOnKeys'],$tasks);
        if(count($task['dependsOnKeys'])>50)throw new InvalidArgumentException('INVALID_DEPENDENCIES');
        foreach($task['dependsOnKeys'] as $dependency)if($dependency===$task['key']||$tasks[$dependency]['projectKey']!==$task['projectKey'])throw new InvalidArgumentException('TEMPLATE_REFERENCE_INVALID');
        foreach($task['checklists'] as $list)foreach($list['items'] as $item)if($item['linkedTaskKey']!==null&&(!isset($tasks[$item['linkedTaskKey']])||$tasks[$item['linkedTaskKey']]['projectKey']!==$task['projectKey']))throw new InvalidArgumentException('TEMPLATE_REFERENCE_INVALID');
    }unset($task);
    $visiting=[];$done=[];
    $requirements=[];foreach($tasks as $task){$requirements[$task['key']]=$task['dependsOnKeys'];foreach($task['checklists'] as $list)foreach($list['items'] as $item)if($item['linkedTaskKey']!==null)$requirements[$task['key']][]=$item['linkedTaskKey'];}
    foreach($tasks as $task)if($task['parentKey']!==null)$requirements[$task['parentKey']][]=$task['key'];
    $visit=function(string $key)use(&$visit,&$visiting,&$done,$requirements):void{if(isset($done[$key]))return;if(isset($visiting[$key]))throw new InvalidArgumentException('TASK_RELATION_CYCLE');$visiting[$key]=true;foreach($requirements[$key] as $dependency)$visit($dependency);unset($visiting[$key]);$done[$key]=true;};
    foreach(array_keys($tasks) as $key)$visit($key);
    if($input['kind']==='task'&&count(array_filter($tasks,static fn($task)=>$task['parentKey']===null))!==1)throw new InvalidArgumentException('TEMPLATE_INVALID');
    return ['schemaVersion'=>1,'kind'=>$input['kind'],'calendarMode'=>$input['calendarMode'],'calendarContext'=>$context,
        'projects'=>array_values($projects),'labels'=>array_values($labels),'fields'=>array_values($fields),'tasks'=>array_values($tasks)];
}
