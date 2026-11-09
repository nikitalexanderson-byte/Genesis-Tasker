<?php
declare(strict_types=1);
require_once __DIR__.'/shared-data-export.php';
require_once __DIR__.'/shared-data-native.php';

/** Server-only scope: no input flag can suppress normal task audits or validation. */
final class GenesisDataHistoricalScope{
    private static int $depth=0;
    public static function active():bool{return self::$depth>0;}
    public static function run(callable $work):mixed{self::$depth++;try{return $work();}finally{self::$depth--;}}
}
function genesisDataHash(mixed $value):string{
    $canonical=static function(mixed $value)use(&$canonical):mixed{if($value instanceof stdClass)$value=(array)$value;if(is_array($value)){if(!array_is_list($value))ksort($value,SORT_STRING);foreach($value as &$item)$item=$canonical($item);unset($item);}return $value;};return hash('sha256',genesisDataJson($canonical($value)));
}
function genesisDataImportInput(array $input):array{
    genesisDataObject($input,['format','content','parse','spaceId','projectId','parentProjectId','memberMap','statusMap','labelMap','fieldMap','optionMap','fieldDefaults','operationId','fingerprint']);
    $format=$input['format']??null;$content=$input['content']??null;if(!in_array($format,['json','csv','trello'],true)||!is_string($content)||!mb_check_encoding($content,'UTF-8')||preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F]/',$content))genesisDataInvalid();
    if(strlen($content)>GENESIS_DATA_FILE_LIMIT)throw new GenesisResourceLimitException(413,'DATA_FILE_TOO_LARGE');
    $parse=genesisDataObject($input['parse']??[],['title','openTitle','doneTitle','calendarMode','calendarContext','delimiter','dateFormat','columns','customColumns','doneStatusKeys']);
    $parse+=['title'=>'Import','openTitle'=>'Open','doneTitle'=>'Done'];
    try{$decoded=$format==='csv'?null:json_decode(preg_replace('/^\xEF\xBB\xBF/','',$content),true,256,JSON_THROW_ON_ERROR);}catch(JsonException){genesisDataInvalid('DATA_JSON_INVALID');}
    $data=match($format){'json'=>genesisDataManifest($decoded),'csv'=>genesisDataFromCsv($content,$parse),default=>genesisDataFromTrello($decoded,$parse)};
    $source=$format==='csv'?str_replace("\r\n","\n",preg_replace('/^\xEF\xBB\xBF/','',$content)):$decoded;
    if(is_array($source))unset($source['exportedAt']);$sourceHash=genesisDataHash([$format,$source]);
    $options=['spaceId'=>genesisDataKey($input['spaceId']??null),'projectId'=>genesisDataNullableKey($input['projectId']??null),'parentProjectId'=>genesisDataNullableKey($input['parentProjectId']??null)];
    if($options['projectId']!==null&&$options['parentProjectId']!==null)genesisDataInvalid('DATA_DESTINATION_INVALID');
    foreach(['memberMap','statusMap','labelMap'] as $key){$rows=$key==='memberMap'?$data['members']:($key==='labelMap'?$data['labels']:array_merge(...array_column($data['projects'],'statuses')));$options[$key]=genesisDataObject($input[$key]??[],array_column($rows,'key'));foreach($options[$key] as $target)genesisDataNullableKey($target);}
    $options['fieldMap']=genesisDataObject($input['fieldMap']??[],array_column($data['fields'],'key'));foreach($options['fieldMap'] as $target)genesisDataKey($target);
    $options['optionMap']=genesisDataObject($input['optionMap']??[],array_column($data['fields'],'key'));$byKey=array_column($data['fields'],null,'key');foreach($options['optionMap'] as $key=>&$map){$map=genesisDataObject($map,array_column($byKey[$key]['options'],'id'));foreach($map as $target)genesisDataKey($target);}unset($map);
    $options['fieldDefaults']=genesisTemplateObject($input['fieldDefaults']??[]);if(count($options['fieldDefaults'])>200)genesisDataInvalid();
    return compact('format','data','sourceHash','options');
}

function genesisDataImportPlan(string $actor,array $parsed):array{
    genesisSharedRequireEnabled($actor);$data=$parsed['data'];$options=$parsed['options'];$new=$options['projectId']===null;
    $destination=genesisTemplateDestinationState($actor,$options);$space=$destination['space'];$blockers=[];$notices=$data['notices'];
    $issue=static function(string $code,string $field='')use(&$blockers):void{$blockers[]=['code'=>$code,'field'=>$field];};
    if($new&&$options['parentProjectId']===null)foreach($data['projects'] as $project)
        if($project['kind']==='task-list'&&$project['parentKey']===null)$issue('SHARED_PROJECT_REQUIRED',$project['key']);
    if($new&&!genesisSharedSpacePermission($space,'createProjects'))$issue('SHARED_SPACE_FORBIDDEN');
    if(!$new&&count($data['projects'])!==1)$issue('DATA_TREE_DESTINATION_REQUIRED');
    if(!$new&&($data['projects'][0]['categories']||$data['projects'][0]['description']!==''||$data['projects'][0]['archivedAt']!==null))$notices[]=['code'=>'DATA_PROJECT_SETTINGS_UNCHANGED','field'=>''];
    $permissions=$new?genesisSharedPermissions($space['member_role'],$space['permissions_json'],(bool)$space['can_organize_tasks'],'owner',(bool)$space['project_access_restricted']):$destination['project']['permissions'];
    if($data['tasks']&&!$permissions['editTasks']||$data['comments']&&!$permissions['comment']||array_filter($data['projects'],static fn($p)=>(bool)$p['categories'])&&!$permissions['manageProjects'])$issue('SHARED_PROJECT_FORBIDDEN');
    $members=array_column($destination['members'],null,'id');$memberMap=[];foreach($data['members'] as $member){$key=$member['key'];$mapped=$options['memberMap'][$key]??(isset($members[$key])?$key:null);if(!array_key_exists($key,$options['memberMap'])&&!isset($members[$key]))$issue('DATA_MEMBER_MAPPING_REQUIRED',$key);if($mapped!==null&&!isset($members[$mapped]))$issue('DATA_MEMBER_UNAVAILABLE',$key);if($mapped===null)$notices[]=['code'=>'DATA_MEMBER_UNASSIGNED','field'=>$member['title']];$memberMap[$key]=$mapped;}
    $statusMap=[];$targetStatuses=array_column($destination['statuses'],null,'id');$sourceStatuses=[];$initialStatuses=[];
    $destinationOpen=null;foreach($destination['statuses'] as $status)if(!(bool)$status['isDone']){$destinationOpen=$status['id'];break;}
    foreach($data['projects'] as $project){
        $initialStatuses[$project['key']]=$destinationOpen;
        if($new)foreach($project['statuses'] as $status)if(!$status['isDone']){$initialStatuses[$project['key']]=$status['key'];break;}
    }
    foreach($data['projects'] as $project)foreach($project['statuses'] as $status){$sourceStatuses[$status['key']]=$status;if($status['isChaos']&&!$new){$statusMap[$status['key']]=($status['isDone']?'chaos-done:':'chaos-open:').$options['projectId'];continue;}if($new){$statusMap[$status['key']]=$status['key'];continue;}$target=$options['statusMap'][$status['key']]??null;
        if($target===null)$issue('DATA_STATUS_MAPPING_REQUIRED',$status['key']);elseif(!isset($targetStatuses[$target]))$issue('DATA_STATUS_UNAVAILABLE',$status['key']);elseif((bool)$targetStatuses[$target]['isDone']!==$status['isDone'])$issue('DATA_STATUS_KIND_MISMATCH',$status['key']);$statusMap[$status['key']]=$target;
    }
    $targetLabels=array_column($destination['labels'],null,'id');$labelMap=[];$newLabels=[];foreach($data['labels'] as $label){$target=$options['labelMap'][$label['key']]??(isset($targetLabels[$label['key']])?$label['key']:'new');if(array_key_exists($label['key'],$options['labelMap']))$target=$options['labelMap'][$label['key']];
        if($target==='new'){$newLabels[]=$label;if(!genesisSharedSpacePermission($space,'manageProjects'))$issue('SHARED_SPACE_FORBIDDEN',$label['key']);}elseif($target!==null&&!isset($targetLabels[$target]))$issue('DATA_LABEL_UNAVAILABLE',$label['key']);elseif($target===null)$notices[]=['code'=>'DATA_LABEL_EXCLUDED','field'=>$label['title']];$labelMap[$label['key']]=$target;}
    if(count($newLabels)+count($targetLabels)>50)$issue('LABEL_LIMIT');
    $fields=[];$fieldCount=0;$targetFields=array_column($destination['fields'],null,'id');$fieldMap=[];$optionMap=[];
    foreach($data['fields'] as $field){$key=$field['key'];$targetId=$options['fieldMap'][$key]??(!$field['archived']&&isset($targetFields[$key])&&$targetFields[$key]['type']===$field['type']?$key:'new');$target=$targetId==='new'?null:($targetFields[$targetId]??null);$fieldMap[$key]=$targetId;
        if($targetId!=='new'&&(!$target||$target['type']!==$field['type']||$field['archived']))$issue('CUSTOM_FIELD_UNAVAILABLE',$key);
        if($target){$optionMap[$key]=[];foreach($field['options'] as $choice){$matches=array_values(array_filter($target['options'],static fn($item)=>!$item['archived']&&$item['title']===$choice['title']));$targetChoice=$options['optionMap'][$key][$choice['id']]??(in_array($choice['id'],array_column($target['options'],'id'),true)?$choice['id']:(count($matches)===1?$matches[0]['id']:null));$optionMap[$key][$choice['id']]=$targetChoice;}
            $notices[]=['code'=>'DATA_DESTINATION_FIELDS_UNCHANGED','field'=>$field['title']];
        }elseif(!in_array($space['member_role'],['owner','admin'],true))$issue('DATA_FIELD_CREATE_FORBIDDEN',$key);
        $scopes=$field['projectKey']===null?array_column($data['projects'],'key'):[$field['projectKey']];foreach($scopes as $project){$fields[$project][$key]=[...$field,'targetId'=>$target['id']??null];if(!$target&&!$field['archived'])$fieldCount++;}
        if(!$target&&$field['projectKey']===null)$notices[]=['code'=>'DATA_SPACE_FIELD_NARROWED','field'=>$field['title']];
    }
    $defaults=[];foreach($options['fieldDefaults'] as $id=>$value){if(!isset($targetFields[$id]))genesisDataInvalid('CUSTOM_FIELD_UNAVAILABLE');$normalized=genesisSharedCustomValue($targetFields[$id],$value);if($normalized!==null)$defaults[$id]=$normalized;}
    if($fieldCount+$destination['fieldCount']>200)$issue('CUSTOM_FIELD_LIMIT');
    $tasks=array_column($data['tasks'],null,'key');$children=[];foreach($tasks as $task)if($task['parentKey']!==null)$children[$task['parentKey']][]=$task['key'];
    $targetValues=[];$organizationBlocked=false;foreach($tasks as $task){$key=$task['key'];$targetValues[$key]=$defaults;$assignedFields=[];try{genesisSharedSchedule($task,null,$task['dueDate']);}catch(InvalidArgumentException $error){$issue($error->getMessage(),$key);}if(count($task['dependsOnKeys'])>50)$issue('INVALID_DEPENDENCIES',$key);
        // Apply stages every task in the first open status, then restores its mapped status.
        // That second mutation requires organizeTasks, even for a different unfinished status.
        $targetStatus=$statusMap[$task['statusKey']]??null;
        if(!$permissions['organizeTasks']&&$targetStatus!==null&&$targetStatus!==$initialStatuses[$task['projectKey']]&&!$organizationBlocked){$issue('DATA_ORGANIZE_REQUIRED');$organizationBlocked=true;}
        foreach($task['dependsOnKeys'] as $ref)if($tasks[$ref]['projectKey']!==$task['projectKey'])$issue('DATA_REFERENCE_INVALID',$key);
        foreach($fields[$task['projectKey']]??[] as $field)if(!$field['archived']&&$field['required']&&!array_key_exists($field['key'],(array)$task['customValues']))$issue('CUSTOM_FIELD_REQUIRED',$key);
        foreach($fields[$task['projectKey']]??[] as $source=>$field){$target=$field['targetId'];if($target===null)continue;if(isset($assignedFields[$target]))$issue('TEMPLATE_FIELD_MAPPING_COLLISION',$field['title']);$assignedFields[$target]=true;$values=(array)$task['customValues'];if(!array_key_exists($source,$values))continue;$value=$values[$source];
            try{if(in_array($field['type'],['select','multi'],true)){$mapped=array_map(static fn($option)=>$optionMap[$source][$option]??null,$field['type']==='select'?[$value]:$value);if(in_array(null,$mapped,true))throw new InvalidArgumentException('CUSTOM_FIELD_UNAVAILABLE');$value=$field['type']==='select'?$mapped[0]:$mapped;}$targetValues[$key][$target]=genesisSharedCustomValue($targetFields[$target],$value);}catch(InvalidArgumentException|GenesisSharedAccessException $error){$issue($error->getMessage(),$key);}
        }
        foreach($destination['fields'] as $field)if($field['required']&&!$field['archived']&&!array_key_exists($field['id'],$targetValues[$key]))$issue('CUSTOM_FIELD_REQUIRED',$field['title']);
        $done=$sourceStatuses[$task['statusKey']]['isDone'];if($done){foreach($children[$key]??[] as $child)if(!$sourceStatuses[$tasks[$child]['statusKey']]['isDone'])$issue('TASK_CHILDREN_INCOMPLETE',$key);foreach($task['checklists'] as $list)foreach($list['items'] as $item)if($item['linkedTaskKey']!==null?!$sourceStatuses[$tasks[$item['linkedTaskKey']]['statusKey']]['isDone']:!$item['done'])$issue('TASK_CHECKLIST_INCOMPLETE',$key);}
        if($task['approvals'])$notices[]=['code'=>'DATA_APPROVAL_HISTORY_ONLY','field'=>$task['title']];
    }
    $quota=$destination['quota'];$limits=$quota['limits'];$count=count($data['tasks']);$newProjects=$new?count($data['projects']):0;$perProject=[];foreach($tasks as $task)$perProject[$task['projectKey']]=($perProject[$task['projectKey']]??0)+1;
    $planProjectCount=$new&&$options['parentProjectId']===null?count(array_filter($data['projects'],static fn($project)=>$project['kind']==='project'&&$project['parentKey']===null)):0;
    if($planProjectCount&&$quota['planProjects']['limit']!==null&&$quota['planProjects']['count']+$planProjectCount>$quota['planProjects']['limit'])$issue('SUBSCRIPTION_QUOTA_shared-projects');
    if($planProjectCount&&($quota['spaceProjects']+$planProjectCount>($limits['projects_per_space']??PHP_INT_MAX)||$quota['ownerProjects']+$planProjectCount>($limits['projects_per_user']??PHP_INT_MAX))||$quota['ownerTasks']+$count>($limits['tasks_per_user']??PHP_INT_MAX))$issue('DATA_RESOURCE_LIMIT');
    foreach($perProject as $amount)if($amount+($new?0:$quota['projectTasks'])>($limits['tasks_per_project']??PHP_INT_MAX))$issue('DATA_RESOURCE_LIMIT');
    $notices[]=['code'=>'DATA_HISTORY_NO_REPLAY','field'=>''];if($data['attachments'])$notices[]=['code'=>'DATA_ATTACHMENTS_METADATA_ONLY','field'=>''];if($data['series']||$data['templates'])$notices[]=['code'=>'DATA_SCHEDULES_METADATA_ONLY','field'=>''];
    $blockers=array_values(array_unique($blockers,SORT_REGULAR));$notices=array_values(array_unique($notices,SORT_REGULAR));
    $fingerprint=genesisDataHash([$parsed,$destination['digest']]);$destinationKey=($new?'tree:'.($options['parentProjectId']??'root'):'project:'.$options['projectId']);
    return ['fingerprint'=>$fingerprint,'sourceHash'=>$parsed['sourceHash'],'destinationKey'=>$destinationKey,'data'=>$data,'options'=>$options,'memberMap'=>$memberMap,'statusMap'=>$statusMap,'labelMap'=>$labelMap,'fields'=>$fields,'fieldMap'=>$fieldMap,'optionMap'=>$optionMap,'targetValues'=>$targetValues,'destinationFields'=>$destination['fields'],'newLabels'=>$newLabels,'destinationMembers'=>$destination['members'],'destinationStatuses'=>$destination['statuses'],'destinationLabels'=>$destination['labels'],'blockers'=>$blockers,'notices'=>$notices,'canApply'=>!$blockers,'projectCount'=>$newProjects,'taskCount'=>$count];
}
function genesisSharedDataPreview(string $actor,array $input):array{
    genesisRequireFeature($actor,'data-export');
    $parsed=genesisDataImportInput($input);$db=genesisDb();$owns=!$db->inTransaction();if($owns)$db->beginTransaction();try{$plan=genesisDataImportPlan($actor,$parsed);if($owns)$db->commit();return $plan;}catch(Throwable $error){if($owns&&$db->inTransaction())$db->rollBack();throw $error;}
}
