<?php
declare(strict_types=1);
require_once __DIR__.'/shared-planning.php';

const GENESIS_DATA_FORMAT='genesis.shared-data';
const GENESIS_DATA_FILE_LIMIT=20*1024*1024;

function genesisDataInvalid(string $code='DATA_INVALID'):never{throw new InvalidArgumentException($code);}
function genesisDataList(mixed $value,int $limit):array{
    if(!is_array($value)||!array_is_list($value)||count($value)>$limit)genesisDataInvalid();return $value;
}
function genesisDataObject(mixed $value,array $keys):array{
    if($value instanceof stdClass)$value=(array)$value;
    if(!is_array($value)||$value&&array_is_list($value)||array_diff(array_keys($value),$keys))genesisDataInvalid();return $value;
}
function genesisDataKey(mixed $value):string{
    if(!is_string($value)||!preg_match('/^[a-zA-Z0-9:_-]{1,100}$/D',$value))genesisDataInvalid('DATA_REFERENCE_INVALID');return $value;
}
function genesisDataNullableKey(mixed $value):?string{return $value===null?null:genesisDataKey($value);}
function genesisDataDate(mixed $value):?string{
    if($value===null)return null;if(!is_string($value))genesisDataInvalid('DATA_DATE_INVALID');
    try{genesisCalendarDate($value);}catch(Throwable){genesisDataInvalid('DATA_DATE_INVALID');}
    if($value<'1900-01-01'||$value>'2100-12-31')genesisDataInvalid('DATA_DATE_INVALID');return $value;
}
function genesisDataInstant(mixed $value):?string{
    if($value===null)return null;
    if(!is_string($value)||!preg_match('/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/D',$value,$m)
        ||!checkdate((int)$m[2],(int)$m[3],(int)$m[1])||(int)$m[4]>23||(int)$m[5]>59||(int)$m[6]>59)genesisDataInvalid('DATA_DATE_INVALID');
    try{new DateTimeImmutable($value);}catch(Throwable){genesisDataInvalid('DATA_DATE_INVALID');}return $value;
}
function genesisDataBool(mixed $value):bool{if(!is_bool($value))genesisDataInvalid();return $value;}
function genesisDataRefs(mixed $value,array $allowed):array{
    $result=[];foreach(genesisDataList($value,50000) as $key){$key=genesisDataKey($key);if(!isset($allowed[$key]))genesisDataInvalid('DATA_REFERENCE_INVALID');$result[$key]=true;}return array_keys($result);
}
function genesisDataUrl(mixed $value):?string{
    if($value===null||$value==='')return null;if(!is_string($value)||strlen($value)>4096||preg_match('/[\x00-\x20\x7f]/',$value))genesisDataInvalid('DATA_URL_INVALID');
    $parts=parse_url($value);if(!$parts||!in_array(strtolower($parts['scheme']??''),['http','https'],true)||empty($parts['host'])||isset($parts['user'])||isset($parts['pass']))genesisDataInvalid('DATA_URL_INVALID');return $value;
}
function genesisDataEmpty(string $title=''):array{
    return ['format'=>GENESIS_DATA_FORMAT,'version'=>1,'exportedAt'=>null,'calendarMode'=>'profane',
        'calendarContext'=>['version'=>2,'timeZone'=>'Europe/Moscow','gregorianYearStart'=>'january'],'space'=>['title'=>$title],
        'members'=>[],'projects'=>[],'labels'=>[],'fields'=>[],'tasks'=>[],'comments'=>[],'history'=>[],'attachments'=>[],'series'=>[],'templates'=>[],'notices'=>[]];
}

/** Portable content only: never ACL grants, authentication, external jobs or executable definitions. */
function genesisDataManifest(mixed $input):array{
    $data=genesisDataObject($input,array_keys(genesisDataEmpty()));
    if(($data['format']??null)!==GENESIS_DATA_FORMAT||($data['version']??null)!==1)genesisDataInvalid('DATA_VERSION_UNSUPPORTED');
    if(!in_array($data['calendarMode']??null,['profane','sacred','lunar'],true))genesisDataInvalid();
    $context=genesisCalendarContext($data['calendarContext']??null,'Europe/Moscow',2);if($context['version']!==2)genesisDataInvalid();
    $space=genesisDataObject($data['space']??[],['title']);$out=genesisDataEmpty(genesisSharedText($space['title']??'',160));
    $out['exportedAt']=genesisDataInstant($data['exportedAt']??null);$out['calendarMode']=$data['calendarMode'];$out['calendarContext']=$context;
    $members=[];foreach(genesisDataList($data['members']??[],20000) as $row){$row=genesisDataObject($row,['key','title']);$key=genesisDataKey($row['key']??null);if(isset($members[$key]))genesisDataInvalid('DATA_REFERENCE_INVALID');$members[$key]=['key'=>$key,'title'=>genesisSharedText($row['title']??'',160)];}
    $out['members']=array_values($members);$projects=[];$statuses=[];$categories=[];
    foreach(genesisDataList($data['projects']??null,1000) as $row){
        $row=genesisDataObject($row,['key','parentKey','boardStatusKey','title','description','kind','layout','tags','labelKeys','statuses','categories','archivedAt','createdAt']);
        $key=genesisDataKey($row['key']??null);$parent=genesisDataNullableKey($row['parentKey']??null);
        if(isset($projects[$key])||$parent!==null&&!isset($projects[$parent])||!in_array($row['layout']??null,['list','board'],true)||!in_array($row['kind']??null,['project','task-list'],true))genesisDataInvalid('DATA_REFERENCE_INVALID');
        $columns=[];$kinds=[];foreach(genesisDataList($row['statuses']??null,32) as $column){
            $column=genesisDataObject($column,['key','title','isDone','isChaos','color','taskTitleLines','visibleTaskCount']);$id=genesisDataKey($column['key']??null);if(isset($statuses[$id]))genesisDataInvalid('DATA_REFERENCE_INVALID');
            $done=genesisDataBool($column['isDone']??null);$lines=$column['taskTitleLines']??($done?2:0);$count=$column['visibleTaskCount']??($done?5:0);
            if(!is_int($lines)||$lines<0||$lines>3||!is_int($count)||$count<0||$count>1000)genesisDataInvalid();
            $columns[]=['key'=>$id,'title'=>genesisSharedTitle($column['title']??null,80),'isDone'=>$done,'isChaos'=>genesisDataBool($column['isChaos']??false),'color'=>genesisSharedCategoryColor($column['color']??'#2d6c68'),'taskTitleLines'=>$lines,'visibleTaskCount'=>$count];$statuses[$id]=['projectKey'=>$key,'isDone'=>$done];$kinds[(int)$done]=true;
        }
        if(count($kinds)!==2)genesisDataInvalid('DATA_OPEN_STATUS_REQUIRED');
        if(count(array_filter($columns,static fn($s)=>!$s['isChaos']))>30)genesisDataInvalid();
        foreach([false,true] as $done)if(count(array_filter($columns,static fn($s)=>$s['isChaos']&&$s['isDone']===$done))>1)genesisDataInvalid();
        $groups=[];foreach(genesisDataList($row['categories']??[],200) as $category){$category=genesisDataObject($category,['key','title','color']);$id=genesisDataKey($category['key']??null);if(isset($categories[$id]))genesisDataInvalid('DATA_REFERENCE_INVALID');$categories[$id]=$key;$groups[]=['key'=>$id,'title'=>genesisSharedTitle($category['title']??null,80),'color'=>genesisSharedCategoryColor($category['color']??'#2d6c68')];}
        $board=genesisDataNullableKey($row['boardStatusKey']??null);if($board!==null&&($statuses[$board]['projectKey']??null)!==$parent)genesisDataInvalid('DATA_REFERENCE_INVALID');
        $projects[$key]=['key'=>$key,'parentKey'=>$parent,'boardStatusKey'=>$board,'title'=>genesisSharedTitle($row['title']??null),'description'=>genesisSharedText($row['description']??'',5000),
            'kind'=>$row['kind'],'layout'=>$row['layout'],'tags'=>genesisSharedTags($row['tags']??[]),'labelKeys'=>$row['labelKeys']??[],'statuses'=>$columns,'categories'=>$groups,
            'archivedAt'=>genesisDataInstant($row['archivedAt']??null),'createdAt'=>genesisDataInstant($row['createdAt']??null)];
    }
    if(!$projects)genesisDataInvalid('DATA_EMPTY');
    $labels=[];foreach(genesisDataList($data['labels']??[],2000) as $row){$row=genesisDataObject($row,['key','title','color']);$key=genesisDataKey($row['key']??null);if(isset($labels[$key]))genesisDataInvalid('DATA_REFERENCE_INVALID');$labels[$key]=['key'=>$key,'title'=>genesisSharedTitle($row['title']??null,40),'color'=>genesisSharedCategoryColor($row['color']??'#2d6c68')];}
    foreach($projects as &$project)$project['labelKeys']=genesisDataRefs($project['labelKeys'],$labels);unset($project);
    $fields=[];foreach(genesisDataList($data['fields']??[],2000) as $row){
        $row=genesisDataObject($row,['key','projectKey','title','type','options','position','required','showCard','showList','archived','predecessorKey']);$key=genesisDataKey($row['key']??null);$project=genesisDataNullableKey($row['projectKey']??null);
        if(isset($fields[$key])||$project!==null&&!isset($projects[$project])||!in_array($row['type']??null,['text','number','date','select','multi','checkbox','url'],true))genesisDataInvalid('DATA_REFERENCE_INVALID');
        $options=[];foreach(genesisDataList($row['options']??[],10000) as $option){$option=genesisDataObject($option,['id','title','archived']);$id=genesisDataKey($option['id']??null);if(isset($options[$id]))genesisDataInvalid('DATA_REFERENCE_INVALID');$options[$id]=['id'=>$id,'title'=>genesisSharedTitle($option['title']??null,160),'archived'=>genesisDataBool($option['archived']??false)];}
        if(count(array_filter($options,static fn($option)=>!$option['archived']))>200||strlen(json_encode(array_values($options),JSON_THROW_ON_ERROR))>1_000_000)genesisDataInvalid();
        if(!in_array($row['type'],['select','multi'],true)&&$options)genesisDataInvalid();$position=$row['position']??0;if(!is_int($position)||abs($position)>100000)genesisDataInvalid();
        $fields[$key]=['key'=>$key,'projectKey'=>$project,'title'=>genesisSharedTitle($row['title']??null),'type'=>$row['type'],'options'=>array_values($options),'position'=>$position,
            'required'=>genesisDataBool($row['required']??false),'showCard'=>genesisDataBool($row['showCard']??true),'showList'=>genesisDataBool($row['showList']??true),'archived'=>genesisDataBool($row['archived']??false),'predecessorKey'=>genesisDataNullableKey($row['predecessorKey']??null)];
    }
    $checked=[];foreach($fields as $key=>$field){$path=[];$cursor=$key;while($cursor!==null&&!isset($checked[$cursor])){if(!isset($fields[$cursor])||isset($path[$cursor]))genesisDataInvalid('DATA_REFERENCE_INVALID');$path[$cursor]=true;$cursor=$fields[$cursor]['predecessorKey'];}$checked+=$path;}
    $tasks=[];$itemKeys=[];
    foreach(genesisDataList($data['tasks']??[],100000) as $row){
        $row=genesisDataObject($row,['key','projectKey','parentKey','statusKey','categoryKey','title','description','entryType','priority','tags','assigneeKey','labelKeys','dependsOnKeys','dueDate','startDate','startTime','endTime','checklists','customValues','approvals','completedAt','archivedAt','archiveRootKey','createdAt','updatedAt','storyPoints','estimateHours']);
        $key=genesisDataKey($row['key']??null);$project=genesisDataKey($row['projectKey']??null);$status=genesisDataKey($row['statusKey']??null);$category=genesisDataNullableKey($row['categoryKey']??null);$parent=genesisDataNullableKey($row['parentKey']??null);$member=genesisDataNullableKey($row['assigneeKey']??null);
        if(isset($tasks[$key])||!isset($projects[$project])||($statuses[$status]['projectKey']??null)!==$project||$category!==null&&($categories[$category]??null)!==$project||$member!==null&&!isset($members[$member]))genesisDataInvalid('DATA_REFERENCE_INVALID');
        $priority=$row['priority']??0;if(!is_int($priority)||$priority<0||$priority>3)genesisDataInvalid();$entry=$row['entryType']??'task';if(!in_array($entry,['task','meeting','event'],true))genesisDataInvalid();
        $start=$row['startTime']??null;$end=$row['endTime']??null;foreach([$start,$end] as $time)if($time!==null&&(!is_string($time)||!preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/D',$time)))genesisDataInvalid('DATA_DATE_INVALID');if(($start===null)!==($end===null))genesisDataInvalid('DATA_DATE_INVALID');
        $lists=[];$itemCount=0;foreach(genesisDataList($row['checklists']??[],20) as $list){
            $list=genesisDataObject($list,['key','title','items']);$id=genesisDataKey($list['key']??null);if(isset($itemKeys[$id]))genesisDataInvalid('DATA_REFERENCE_INVALID');$itemKeys[$id]=true;$items=[];
            foreach(genesisDataList($list['items']??[],300) as $item){$item=genesisDataObject($item,['key','title','done','assigneeKey','dueDate','linkedTaskKey']);$itemKey=genesisDataKey($item['key']??null);$assignee=genesisDataNullableKey($item['assigneeKey']??null);
                if(isset($itemKeys[$itemKey])||++$itemCount>300||$assignee!==null&&!isset($members[$assignee]))genesisDataInvalid('DATA_REFERENCE_INVALID');$itemKeys[$itemKey]=true;
                $items[]=['key'=>$itemKey,'title'=>genesisSharedTitle($item['title']??null,500),'done'=>genesisDataBool($item['done']??false),'assigneeKey'=>$assignee,'dueDate'=>genesisDataDate($item['dueDate']??null),'linkedTaskKey'=>genesisDataNullableKey($item['linkedTaskKey']??null)];}
            $lists[]=['key'=>$id,'title'=>genesisSharedTitle($list['title']??null),'items'=>$items];
        }
        $values=$row['customValues']??[];if($values instanceof stdClass)$values=(array)$values;if(!is_array($values)||$values&&array_is_list($values))genesisDataInvalid();$custom=[];
        foreach($values as $fieldKey=>$value){if(!isset($fields[$fieldKey])||$fields[$fieldKey]['projectKey']!==null&&$fields[$fieldKey]['projectKey']!==$project)genesisDataInvalid('DATA_REFERENCE_INVALID');$value=genesisSharedCustomValue($fields[$fieldKey],$value,$value);if($value!==null)$custom[$fieldKey]=$value;}
        $approvals=[];foreach(genesisDataList($row['approvals']??[],200) as $approval){$approval=genesisDataObject($approval,['memberKey','approvedAt']);$id=genesisDataKey($approval['memberKey']??null);if(!isset($members[$id]))genesisDataInvalid('DATA_REFERENCE_INVALID');$approvals[]=['memberKey'=>$id,'approvedAt'=>genesisDataInstant($approval['approvedAt']??null)];}
        $tasks[$key]=['key'=>$key,'projectKey'=>$project,'parentKey'=>$parent,'statusKey'=>$status,'categoryKey'=>$category,'title'=>genesisSharedTitle($row['title']??null),'description'=>genesisSharedText($row['description']??'',20000),
            'entryType'=>$entry,'priority'=>$priority,'tags'=>genesisSharedTags($row['tags']??[]),'assigneeKey'=>$member,'labelKeys'=>genesisDataRefs($row['labelKeys']??[],$labels),'dependsOnKeys'=>$row['dependsOnKeys']??[],
            'storyPoints'=>genesisPlanningEstimate($row['storyPoints']??null),'estimateHours'=>genesisPlanningEstimate($row['estimateHours']??null),
            'dueDate'=>genesisDataDate($row['dueDate']??null),'startDate'=>genesisDataDate($row['startDate']??null),'startTime'=>$start,'endTime'=>$end,'checklists'=>$lists,'customValues'=>(object)$custom,'approvals'=>$approvals,
            'completedAt'=>genesisDataInstant($row['completedAt']??null),'archivedAt'=>genesisDataInstant($row['archivedAt']??null),'archiveRootKey'=>genesisDataNullableKey($row['archiveRootKey']??null),'createdAt'=>genesisDataInstant($row['createdAt']??null),'updatedAt'=>genesisDataInstant($row['updatedAt']??null)];
    }
    foreach($tasks as &$task){if($task['parentKey']!==null&&($tasks[$task['parentKey']]['projectKey']??null)!==$task['projectKey'])genesisDataInvalid('DATA_REFERENCE_INVALID');$task['dependsOnKeys']=genesisDataRefs($task['dependsOnKeys'],$tasks);
        if($task['archiveRootKey']!==null&&(($tasks[$task['archiveRootKey']]['projectKey']??null)!==$task['projectKey']||$task['archivedAt']===null))genesisDataInvalid('DATA_REFERENCE_INVALID');
        foreach($task['checklists'] as $list)foreach($list['items'] as $item)if($item['linkedTaskKey']!==null&&($tasks[$item['linkedTaskKey']]['projectKey']??null)!==$task['projectKey'])genesisDataInvalid('DATA_REFERENCE_INVALID');
    }unset($task);
    // Linear queues: a reverse-ordered large file must not turn validation into quadratic work.
    $children=[];$queue=[];foreach($tasks as $key=>$task){if($task['parentKey']===null)$queue[]=$key;else $children[$task['parentKey']][]=$key;}
    $ordered=[];for($i=0;$i<count($queue);$i++){$key=$queue[$i];$ordered[$key]=$tasks[$key];foreach($children[$key]??[] as $child)$queue[]=$child;}
    if(count($ordered)!==count($tasks))genesisDataInvalid('DATA_RELATION_CYCLE');
    $pending=[];$dependents=[];$ready=[];
    foreach($tasks as $key=>$task){$links=[];foreach($task['checklists'] as $list)foreach($list['items'] as $item)if($item['linkedTaskKey']!==null)$links[]=$item['linkedTaskKey'];$refs=array_values(array_unique([...$task['dependsOnKeys'],...($children[$key]??[]),...$links]));$pending[$key]=count($refs);if(!$refs)$ready[]=$key;foreach($refs as $ref)$dependents[$ref][]=$key;}
    for($i=0;$i<count($ready);$i++)foreach($dependents[$ready[$i]]??[] as $dependent)if(--$pending[$dependent]===0)$ready[]=$dependent;
    if(count($ready)!==count($tasks))genesisDataInvalid('DATA_RELATION_CYCLE');
    $out['projects']=array_values($projects);$out['labels']=array_values($labels);$out['fields']=array_values($fields);$out['tasks']=array_values($ordered);
    $comments=[];foreach(genesisDataList($data['comments']??[],200000) as $row){$row=genesisDataObject($row,['key','projectKey','taskKey','boardStatusKey','authorKey','authorTitle','body','createdAt']);$key=genesisDataKey($row['key']??null);$task=genesisDataNullableKey($row['taskKey']??null);$project=$row['projectKey']??($tasks[$task??'']['projectKey']??null);$project=genesisDataKey($project);$board=genesisDataNullableKey($row['boardStatusKey']??null);
        if(isset($comments[$key])||!isset($projects[$project])||$task!==null&&($tasks[$task]['projectKey']??null)!==$project||$board!==null&&($statuses[$board]['projectKey']??null)!==$project)genesisDataInvalid('DATA_REFERENCE_INVALID');$comments[$key]=['key'=>$key,'projectKey'=>$project,'taskKey'=>$task,'boardStatusKey'=>$board,'authorKey'=>genesisDataNullableKey($row['authorKey']??null),'authorTitle'=>genesisSharedText($row['authorTitle']??'',160),'body'=>genesisSharedText($row['body']??'',5000),'createdAt'=>genesisDataInstant($row['createdAt']??null)];}$out['comments']=array_values($comments);
    foreach(['history','attachments','series','templates'] as $kind){$rows=[];foreach(genesisDataList($data[$kind]??[],200000) as $row){
        $keys=match($kind){'history'=>['key','projectKey','taskKey','actorTitle','action','createdAt','details'], 'attachments'=>['key','projectKey','taskKey','name','mimeType','size','url'], 'series'=>['key','projectKey','taskKey','settings'],default=>['key','projectKey','title','manifest']};
        $row=genesisDataObject($row,$keys);$key=genesisDataKey($row['key']??null);$project=genesisDataKey($row['projectKey']??null);$task=genesisDataNullableKey($row['taskKey']??null);
        if(isset($rows[$key])||!isset($projects[$project])||$task!==null&&($tasks[$task]['projectKey']??null)!==$project)genesisDataInvalid('DATA_REFERENCE_INVALID');
        $value=['key'=>$key,'projectKey'=>$project];if($kind!=='templates')$value['taskKey']=$task;
        if($kind==='history'){$details=$row['details']??new stdClass();if(strlen(json_encode($details,JSON_THROW_ON_ERROR))>100000)genesisDataInvalid();$value+=['actorTitle'=>genesisSharedText($row['actorTitle']??'',160),'action'=>genesisSharedText($row['action']??'',100),'createdAt'=>genesisDataInstant($row['createdAt']??null),'details'=>$details];}
        elseif($kind==='attachments'){$size=$row['size']??0;if(!is_int($size)||$size<0||$size>1000000000)genesisDataInvalid();$value+=['name'=>genesisSharedTitle($row['name']??null,500),'mimeType'=>genesisSharedText($row['mimeType']??'',200),'size'=>$size,'url'=>genesisDataUrl($row['url']??null)];}
        elseif($kind==='series')$value['settings']=genesisSharedSeriesSettings($row['settings']??null);
        else $value+=['title'=>genesisSharedTitle($row['title']??null,160),'manifest'=>genesisTemplateManifest($row['manifest']??null)];$rows[$key]=$value;
    }$out[$kind]=array_values($rows);}
    $out['notices']=[];foreach(genesisDataList($data['notices']??[],10000) as $notice){$notice=genesisDataObject($notice,['code','field']);$code=genesisDataKey($notice['code']??null);$out['notices'][]=['code'=>$code,'field'=>genesisSharedText($notice['field']??'',200)];}
    if(strlen(json_encode($out,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR))>GENESIS_DATA_FILE_LIMIT)throw new GenesisResourceLimitException(413,'DATA_FILE_TOO_LARGE');return $out;
}
