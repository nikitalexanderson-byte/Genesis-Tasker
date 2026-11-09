<?php
declare(strict_types=1);
require_once __DIR__.'/shared-templates.php';
require_once __DIR__.'/template-starters.php';

function genesisTemplateObject(mixed $value):array
{
    if($value instanceof stdClass)$value=(array)$value;
    if(!is_array($value)||$value&&array_is_list($value))throw new InvalidArgumentException('TEMPLATE_INVALID');
    return $value;
}

function genesisTemplateApplyInput(array $input):array
{
    if(array_diff(array_keys($input),['spaceId','projectId','parentProjectId','boardStatusId','anchorDate','title','include','statusMap','categoryMap','fieldMap','optionMap','memberMap','fieldValues','language','operationId','fingerprint']))throw new InvalidArgumentException('TEMPLATE_INVALID');
    $result=['spaceId'=>genesisTemplateKey($input['spaceId']??null),'language'=>genesisTemplateLanguage($input['language']??'ru')];
    foreach(['projectId','parentProjectId','boardStatusId'] as $key)$result[$key]=genesisTemplateNullableKey($input[$key]??null);
    if(!is_string($input['anchorDate']??null))throw new InvalidArgumentException('TEMPLATE_DATE_INVALID');
    genesisCalendarDate($input['anchorDate']);$result['anchorDate']=$input['anchorDate'];
    if($result['anchorDate']<'1900-01-01'||$result['anchorDate']>'2100-12-31')throw new InvalidArgumentException('TEMPLATE_DATE_OUTSIDE_RANGE');
    $result['title']=isset($input['title'])?genesisSharedTitle($input['title']):null;
    $flags=['descriptions','tags','labels','customFields','assignees','checklists','subtasks','dependencies','dates','approvals'];
    $include=genesisTemplateObject($input['include']??[]);
    if(array_diff(array_keys($include),$flags))throw new InvalidArgumentException('TEMPLATE_INVALID');
    foreach($flags as $flag){$result['include'][$flag]=$include[$flag]??true;if(!is_bool($result['include'][$flag]))throw new InvalidArgumentException('TEMPLATE_INVALID');}
    foreach(['statusMap','categoryMap','fieldMap','optionMap','memberMap','fieldValues'] as $key){
        $result[$key]=genesisTemplateObject($input[$key]??[]);
        if(count($result[$key])>500)throw new InvalidArgumentException('TEMPLATE_INVALID');
    }
    foreach(['statusMap','categoryMap','fieldMap','memberMap'] as $key)foreach($result[$key] as $source=>$target){genesisTemplateKey($source);genesisTemplateNullableKey($target);}
    foreach(['optionMap','fieldValues'] as $key)foreach($result[$key] as $source=>&$values){genesisTemplateKey($source);$values=genesisTemplateObject($values);if(count($values)>200)throw new InvalidArgumentException('TEMPLATE_INVALID');}unset($values);
    foreach($result['optionMap'] as $options)foreach($options as $source=>$target){genesisTemplateKey($source);genesisTemplateNullableKey($target);}
    return $result;
}

/** Predict exactly the existing C6 inheritance for new projects, without creating a grant. */
function genesisTemplateDestinationMembers(string $actor,string $spaceId,?string $projectId,?string $parentId):array
{
    $db=genesisDb();
    if($projectId!==null){
        $q=$db->prepare('SELECT m.user_id AS id,u.display_name AS title,m.role FROM shared_project_members m JOIN shared_space_members sm ON sm.space_id=? AND sm.user_id=m.user_id JOIN users u ON u.id=m.user_id WHERE m.project_id=? ORDER BY m.user_id');
        $q->execute([$spaceId,$projectId]);return $q->fetchAll();
    }
    $q=$db->prepare('SELECT id,parent_id AS parentId FROM shared_projects WHERE space_id=?');$q->execute([$spaceId]);$projects=$q->fetchAll();
    // @ is deliberately outside the public ID grammar, so this cannot match an existing grant.
    $projects[]=['id'=>'@template-root','parentId'=>$parentId];
    $q=$db->prepare('SELECT m.user_id AS id,u.display_name AS title,m.role,m.all_projects,m.project_access_restricted FROM shared_space_members m JOIN users u ON u.id=m.user_id WHERE m.space_id=? ORDER BY m.user_id');$q->execute([$spaceId]);$rows=$q->fetchAll();$members=[];
    foreach($rows as $row){
        $role=$row['id']===$actor?'owner':(in_array($row['role'],['owner','admin'],true)?'manager':((bool)$row['all_projects']?($row['role']==='member'?'member':'viewer'):null));
        if((bool)$row['project_access_restricted']&&!in_array($row['role'],['owner','admin'],true)){
            $q=$db->prepare("SELECT project_id AS projectId,CASE WHEN excluded=1 THEN 'none' ELSE role END AS role,include_descendants AS includeDescendants FROM shared_member_project_grants WHERE space_id=? AND user_id=?");$q->execute([$spaceId,$row['id']]);
            $role=genesisSharedProjectAccessRoles($projects,$q->fetchAll())['@template-root']??null;
        }
        if($role!==null)$members[]=['id'=>$row['id'],'title'=>$row['title'],'role'=>$role];
    }
    return $members;
}

/** Only server-side state enters this digest; no hidden project metadata is returned to the client. */
function genesisTemplateDestinationState(string $actor,array $options):array
{
    $db=genesisDb();$spaceId=$options['spaceId'];$space=genesisSharedSpaceAccess($spaceId,$actor);$project=null;$parent=null;
    foreach(['projectId','parentProjectId'] as $key)if($options[$key]!==null){
        $row=genesisSharedProjectAccess($options[$key],$actor,'write');if($row['space_id']!==$spaceId)throw new GenesisSharedAccessException();
        genesisSharedRequireTaskProject($row);
        if($key==='projectId')$project=$row;else $parent=$row;
    }
    $queries=[
        'members'=>['SELECT user_id,role,all_projects,project_access_restricted,project_access_revision,permissions_json,can_organize_tasks FROM shared_space_members WHERE space_id=? ORDER BY user_id',[$spaceId]],
        'tree'=>['SELECT id,parent_id,revision,archived_at FROM shared_projects WHERE space_id=? ORDER BY id',[$spaceId]],
        'grants'=>['SELECT user_id,project_id,role,include_descendants,excluded FROM shared_member_project_grants WHERE space_id=? ORDER BY user_id,project_id',[$spaceId]],
    ];$state=[$space,$project,$parent];foreach($queries as [$sql,$values]){$q=$db->prepare($sql);$q->execute($values);$state[]=$q->fetchAll();}
    $fields=genesisSharedCustomFields($actor,$spaceId,$project['id']??null);if($project===null)$fields=array_values(array_filter($fields,static fn($f)=>$f['projectId']===null));
    $labels=genesisSharedLabels($actor,$spaceId);$statuses=[];$categories=[];
    if($project!==null){
        $q=$db->prepare('SELECT id,title,is_done AS isDone,revision FROM shared_project_statuses WHERE project_id=? AND is_chaos=0 ORDER BY position,id');$q->execute([$project['id']]);$statuses=$q->fetchAll();
        $q=$db->prepare('SELECT id,title,color,revision FROM shared_project_categories WHERE project_id=? ORDER BY position,id');$q->execute([$project['id']]);$categories=$q->fetchAll();
        $q=$db->prepare('SELECT user_id,role FROM shared_project_members WHERE project_id=? ORDER BY user_id');$q->execute([$project['id']]);$state[]=$q->fetchAll();
    }
    if($parent!==null){$q=$db->prepare('SELECT id,revision FROM shared_project_statuses WHERE project_id=? AND is_chaos=0 ORDER BY id');$q->execute([$parent['id']]);$state[]=$q->fetchAll();}
    $q=$db->prepare('SELECT COUNT(*) FROM shared_custom_fields WHERE space_id=? AND archived_at IS NULL');$q->execute([$spaceId]);$fieldCount=(int)$q->fetchColumn();
    $members=genesisTemplateDestinationMembers($actor,$spaceId,$options['projectId'],$options['parentProjectId']);
    $q=$db->prepare("SELECT name,amount FROM resource_quota_limits WHERE name IN('projects_per_space','projects_per_user','tasks_per_project','tasks_per_user') ORDER BY name");$q->execute();$limits=array_column($q->fetchAll(),'amount','name');
    $q=$db->prepare("SELECT COUNT(*) FROM shared_projects WHERE space_id=? AND parent_id IS NULL AND is_inbox=0 AND kind='project'");$q->execute([$spaceId]);$spaceProjects=(int)$q->fetchColumn();
    $q=$db->prepare('SELECT user_id FROM resource_space_owners WHERE space_id=?');$q->execute([$spaceId]);$owner=$q->fetchColumn();
    $q=$db->prepare("SELECT COUNT(*) FROM shared_projects p JOIN resource_space_owners o ON o.space_id=p.space_id WHERE o.user_id=? AND p.parent_id IS NULL AND p.is_inbox=0 AND p.kind='project'");$q->execute([$owner]);$ownerProjects=(int)$q->fetchColumn();
    $q=$db->prepare('SELECT COUNT(*) FROM shared_tasks t JOIN shared_projects p ON p.id=t.project_id JOIN resource_space_owners o ON o.space_id=p.space_id WHERE o.user_id=?');$q->execute([$owner]);$ownerTasks=(int)$q->fetchColumn();
    $projectTasks=0;if($project!==null){$q=$db->prepare('SELECT COUNT(*) FROM shared_tasks WHERE project_id=?');$q->execute([$project['id']]);$projectTasks=(int)$q->fetchColumn();}
    $planProjects=genesisSharedOwnerResourceUsage($spaceId,'shared-projects');
    $quota=compact('limits','spaceProjects','ownerProjects','ownerTasks','projectTasks','planProjects');
    $digest=hash('sha256',json_encode([$state,$fields,$labels,$statuses,$categories,$members,$fieldCount,$quota],JSON_THROW_ON_ERROR));
    return compact('space','project','parent','fields','labels','statuses','categories','members','fieldCount','digest','quota');
}

/** Build a stable, reviewable plan. Its keys are portable aliases, never newly generated database IDs. */
function genesisSharedTemplatePlan(string $actor,string $id,array $input):array
{
    genesisSharedRequireEnabled($actor);$options=genesisTemplateApplyInput($input);$record=genesisSharedTemplateSource($actor,$id,$options['language']);
    $manifest=genesisTemplateManifest($record['manifest']);$include=$options['include'];$new=$manifest['kind']==='project';
    if($new&&$options['projectId']!==null||!$new&&($options['projectId']===null||$options['parentProjectId']!==null||$options['boardStatusId']!==null))throw new InvalidArgumentException('TEMPLATE_DESTINATION_INVALID');
    $destination=genesisTemplateDestinationState($actor,$options);$space=$destination['space'];$db=genesisDb();$blockers=[];$notices=$record['notices'];
    if($new&&!genesisSharedSpacePermission($space,'createProjects'))throw new GenesisSharedAccessException('SHARED_SPACE_FORBIDDEN',403);
    if($new)genesisSharedBoardPlacement($actor,$space['id'],$options['parentProjectId'],$options['boardStatusId']);
    $projects=[];foreach($manifest['projects'] as $i=>$project){
        $projects[$project['key']]=[...$project,'title'=>$new&&$i===0&&$options['title']!==null?$options['title']:$project['title'],'description'=>$include['descriptions']?$project['description']:'','tags'=>$include['tags']?$project['tags']:[]];
    }
    if($new){$permissions=genesisSharedPermissions($space['member_role'],$space['permissions_json'],(bool)$space['can_organize_tasks'],'owner',(bool)$space['project_access_restricted']);
        if($manifest['tasks']&&!$permissions['editTasks'])$blockers[]=['code'=>'SHARED_PROJECT_FORBIDDEN'];
        if(array_filter($projects,static fn($project)=>(bool)$project['categories'])&&!$permissions['manageProjects'])$blockers[]=['code'=>'TEMPLATE_CATEGORY_CREATE_FORBIDDEN'];}
    $sourceStatuses=[];$sourceCategories=[];foreach($projects as $project){array_push($sourceStatuses,...$project['statuses']);array_push($sourceCategories,...$project['categories']);}
    $mappingKeys=['statusMap'=>array_column($sourceStatuses,'key'),'categoryMap'=>array_column($sourceCategories,'key'),'fieldMap'=>array_column($manifest['fields'],'key'),'optionMap'=>array_column($manifest['fields'],'key')];
    foreach($mappingKeys as $kind=>$keys)if(array_diff(array_keys($options[$kind]),$keys)||$new&&$options[$kind])throw new InvalidArgumentException('TEMPLATE_REFERENCE_INVALID');
    $sourceFields=array_column($manifest['fields'],null,'key');$targetFields=array_column($destination['fields'],null,'id');$fieldSpecs=[];$fieldRefs=[];
    if($include['customFields'])foreach($sourceFields as $key=>$field){
        if($new){
            foreach($projects as $projectKey=>$project)if($field['projectKey']===null||$field['projectKey']===$projectKey){
                $ref='new:'.$projectKey.':'.$key;$fieldRefs[$projectKey][$key]=$ref;$fieldSpecs[$ref]=[...$field,'ref'=>$ref,'sourceKey'=>$key,'projectKey'=>$projectKey];
            }
        }else{
            $mapped=array_key_exists($key,$options['fieldMap'])?$options['fieldMap'][$key]:null;
            if(!array_key_exists($key,$options['fieldMap'])){
                if(isset($targetFields[$key]))$mapped=$key;
                else{$matches=array_filter($targetFields,static fn($f)=>$f['type']===$field['type']&&$f['title']===$field['title']);if(count($matches)===1)$mapped=array_key_first($matches);}
            }
            if($mapped!==null&&(!isset($targetFields[$mapped])||$targetFields[$mapped]['type']!==$field['type']))throw new InvalidArgumentException('TEMPLATE_FIELD_MAPPING_INVALID');
            $fieldRefs[$manifest['projects'][0]['key']][$key]=$mapped;
            if($mapped===null)$notices[]=['code'=>'FIELD_NOT_MAPPED','fieldKey'=>$key,'title'=>$field['title']];
        }
    }
    if($fieldSpecs&&!in_array($space['member_role'],['owner','admin'],true))$blockers[]=['code'=>'TEMPLATE_FIELD_CREATE_FORBIDDEN'];
    if($fieldSpecs&&$destination['fieldCount']+count($fieldSpecs)>200)$blockers[]=['code'=>'CUSTOM_FIELD_LIMIT'];
    $labelMap=[];$createLabels=[];
    if($include['labels'])foreach($manifest['labels'] as $label){
        $match=null;foreach($destination['labels'] as $target)if($target['title']===$label['title']&&$target['color']===$label['color']){$match=$target['id'];break;}
        if($match!==null)$labelMap[$label['key']]=$match;
        elseif(genesisSharedSpacePermission($space,'manageProjects')){$labelMap[$label['key']]='new:'.$label['key'];$createLabels[$label['key']]=$label;}
        else{$labelMap[$label['key']]=null;$notices[]=['code'=>'LABEL_NOT_AVAILABLE','labelKey'=>$label['key'],'title'=>$label['title']];}
    }
    if($createLabels&&count($destination['labels'])+count($createLabels)>50)$blockers[]=['code'=>'LABEL_LIMIT'];
    $members=array_column($destination['members'],null,'id');
    $member=function(?string $source,string $taskKey,string $purpose,?string $itemKey=null)use($options,$members,&$notices,&$blockers):?string{
        if($source===null)return null;$mapped=array_key_exists($source,$options['memberMap'])?$options['memberMap'][$source]:$source;
        if($mapped!==null&&!isset($members[$mapped]))$mapped=null;
        if($mapped===null){$notice=['code'=>$purpose==='approver'?'APPROVER_NOT_AVAILABLE':'ASSIGNEE_NOT_AVAILABLE','taskKey'=>$taskKey,'sourceUserId'=>$source];if($itemKey!==null)$notice['itemKey']=$itemKey;
            if($purpose==='approver')$blockers[]=$notice;else $notices[]=$notice;}
        return $mapped;
    };
    $tasks=[];foreach($manifest['tasks'] as $task)if($include['subtasks']||$task['parentKey']===null)$tasks[$task['key']]=$task;
    foreach($notices as $i=>$notice)if($notice['code']==='FORMER_APPROVER_UNAVAILABLE'){
        $task=$tasks[$notice['taskKey']]??null;
        if(!$task||!$include['approvals']||!$task['approvalRequired']){unset($notices[$i]);continue;}
        $required=(int)($notice['requiredApproverCount']??count($task['approverIds'])+1);
        if(count($task['approverIds'])<$required)$blockers[]=['code'=>'TEMPLATE_APPROVERS_REQUIRED','taskKey'=>$task['key']];else unset($notices[$i]);
    }$notices=array_values($notices);
    $quota=$destination['quota'];$limits=$quota['limits'];$projectCount=$new?count($projects):0;
    $planProjectCount=$new&&$options['parentProjectId']===null?count(array_filter($projects,static fn($project)=>$project['kind']==='project'&&$project['parentKey']===null)):0;
    if($planProjectCount&&$quota['planProjects']['limit']!==null&&$quota['planProjects']['count']+$planProjectCount>$quota['planProjects']['limit'])
        $blockers[]=['code'=>'SUBSCRIPTION_QUOTA_shared-projects'];
    $perProject=[];foreach($tasks as $task)$perProject[$task['projectKey']]=($perProject[$task['projectKey']]??0)+1;
    if($planProjectCount&&($quota['spaceProjects']+$planProjectCount>(int)$limits['projects_per_space']||$quota['ownerProjects']+$planProjectCount>(int)$limits['projects_per_user'])
        ||$tasks&&$quota['ownerTasks']+count($tasks)>(int)$limits['tasks_per_user']||(!$new&&$tasks&&$quota['projectTasks']+count($tasks)>(int)$limits['tasks_per_project'])
        ||$new&&$perProject&&max($perProject)>(int)$limits['tasks_per_project'])$blockers[]=['code'=>'TEMPLATE_RESOURCE_LIMIT'];
    if(count($tasks)!==count($manifest['tasks']))$notices[]=['code'=>'SUBTASKS_EXCLUDED','count'=>count($manifest['tasks'])-count($tasks)];
    foreach(['descriptions','tags','labels','customFields','assignees','checklists','dependencies','dates','approvals'] as $flag)if(!$include[$flag])$notices[]=['code'=>'OPTION_EXCLUDED','option'=>$flag];
    $resolveDate=function(?array $offset,string $taskKey,string $field,?string $itemKey=null)use($manifest,$options,&$notices,&$blockers):?string{
        if($offset===null||!$options['include']['dates'])return null;
        try{$resolved=genesisTemplateDate($options['anchorDate'],$offset,$manifest['calendarMode'],$manifest['calendarContext']);}
        catch(RangeException){$blockers[]=['code'=>'TEMPLATE_DATE_OUTSIDE_RANGE','taskKey'=>$taskKey,'field'=>$field];return null;}
        if($resolved['clamped']){$notice=['code'=>'TEMPLATE_DATE_CLAMPED','taskKey'=>$taskKey,'field'=>$field,'date'=>$resolved['date'],'offset'=>$offset,'calendarMode'=>$manifest['calendarMode']];if($itemKey!==null)$notice['itemKey']=$itemKey;$notices[]=$notice;}
        return $resolved['date'];
    };
    $statuses=array_column($destination['statuses'],null,'id');$categories=array_column($destination['categories'],null,'id');$mappedTasks=[];
    foreach($tasks as $key=>$task){
        $project=$projects[$task['projectKey']];$sourceStatuses=array_column($project['statuses'],null,'key');$sourceStatus=$sourceStatuses[$task['statusKey']];
        $statusRef=$task['statusKey'];
        if($new){if($sourceStatus['isDone'])foreach($project['statuses'] as $s)if(!$s['isDone']){$statusRef=$s['key'];break;}}
        else{
            $statusRef=$options['statusMap'][$task['statusKey']]??null;
            if($statusRef!==null&&(!isset($statuses[$statusRef])||(bool)$statuses[$statusRef]['isDone']))throw new InvalidArgumentException('TEMPLATE_STATUS_MAPPING_INVALID');
            if($statusRef===null){foreach($statuses as $s)if(!(bool)$s['isDone']&&($s['id']===$task['statusKey']||$s['title']===$sourceStatus['title'])){$statusRef=$s['id'];break;}}
            if($statusRef===null)foreach($statuses as $s)if(!(bool)$s['isDone']){$statusRef=$s['id'];break;}
            if($statusRef===null)$blockers[]=['code'=>'TEMPLATE_OPEN_STATUS_REQUIRED','taskKey'=>$key];
        }
        if($sourceStatus['isDone'])$notices[]=['code'=>'TASK_COMPLETION_RESET','taskKey'=>$key];
        elseif(!$new&&$statusRef!==null&&$statuses[$statusRef]['title']!==$sourceStatus['title'])$notices[]=['code'=>'STATUS_MAPPED','taskKey'=>$key,'title'=>$statuses[$statusRef]['title']];
        $categoryRef=$task['categoryKey'];if(!$new&&$categoryRef!==null){
            $sourceCategory=array_column($project['categories'],null,'key')[$categoryRef];$mapped=array_key_exists($categoryRef,$options['categoryMap'])?$options['categoryMap'][$categoryRef]:null;
            if(!array_key_exists($categoryRef,$options['categoryMap']))foreach($categories as $category)if($category['id']===$categoryRef||$category['title']===$sourceCategory['title']){$mapped=$category['id'];break;}
            if($mapped!==null&&!isset($categories[$mapped]))throw new InvalidArgumentException('TEMPLATE_CATEGORY_MAPPING_INVALID');
            if($mapped===null)$notices[]=['code'=>'CATEGORY_NOT_AVAILABLE','taskKey'=>$key,'title'=>$sourceCategory['title']];$categoryRef=$mapped;
        }
        $values=[];
        if($include['customFields'])foreach((array)$task['customValues'] as $source=>$value){
            $ref=$fieldRefs[$task['projectKey']][$source]??null;
            if($ref===null){$blockers[]=['code'=>'TEMPLATE_FIELD_VALUE_UNMAPPED','taskKey'=>$key,'fieldKey'=>$source];continue;}
            if(array_key_exists($ref,$values)){$blockers[]=['code'=>'TEMPLATE_FIELD_MAPPING_COLLISION','taskKey'=>$key,'fieldRef'=>$ref];continue;}
            if(array_key_exists($ref,$options['fieldValues'][$key]??[])){$values[$ref]=$options['fieldValues'][$key][$ref];continue;}
            $field=$new?$fieldSpecs[$ref]:$targetFields[$ref];
            if(!$new&&in_array($field['type'],['select','multi'],true)){
                $mapped=[];$sourceOptions=array_column($sourceFields[$source]['options'],null,'id');
                foreach($field['type']==='select'?[$value]:$value as $option){
                    $target=$options['optionMap'][$source][$option]??null;
                    if($target===null)foreach($field['options'] as $choice)if(!$choice['archived']&&($choice['id']===$option||$choice['title']===$sourceOptions[$option]['title'])){$target=$choice['id'];break;}
                    if($target===null){$blockers[]=['code'=>'CUSTOM_FIELD_OPTION_UNAVAILABLE','taskKey'=>$key,'fieldRef'=>$ref];continue;}$mapped[]=$target;
                }
                $value=$field['type']==='select'?($mapped[0]??null):$mapped;
            }
            $values[$ref]=$value;
        }
        $applicable=$targetFields;foreach($fieldSpecs as $ref=>$field)if($field['projectKey']===$task['projectKey'])$applicable[$ref]=$field;
        foreach(genesisTemplateObject($options['fieldValues'][$key]??[]) as $ref=>$value){if(!isset($applicable[$ref]))throw new InvalidArgumentException('TEMPLATE_FIELD_MAPPING_INVALID');$values[$ref]=$value;}
        foreach($values as $ref=>$value){
            try{$value=genesisSharedCustomValue($applicable[$ref],$value);if($value===null)unset($values[$ref]);else $values[$ref]=$value;}
            catch(InvalidArgumentException $error){$blockers[]=['code'=>$error->getMessage(),'taskKey'=>$key,'fieldRef'=>$ref];unset($values[$ref]);}
        }
        foreach($applicable as $ref=>$field)if($field['required']&&!array_key_exists($ref,$values))$blockers[]=['code'=>'CUSTOM_FIELD_REQUIRED','taskKey'=>$key,'fieldRef'=>$ref,'title'=>$field['title']];
        $due=$resolveDate($task['due'],$key,'dueDate');$start=$resolveDate($task['start'],$key,'startDate');
        $times=['startTime'=>$include['dates']?$task['startTime']:null,'endTime'=>$include['dates']?$task['endTime']:null];
        try{genesisSharedSchedule(['startDate'=>$start,...$times],null,$due);}catch(InvalidArgumentException $error){$blockers[]=['code'=>$error->getMessage(),'taskKey'=>$key];}
        $lists=[];if($include['checklists'])foreach($task['checklists'] as $list){$items=[];foreach($list['items'] as $item){
            $linked=$item['linkedTaskKey'];if($linked!==null&&!isset($tasks[$linked])){$notices[]=['code'=>'CHECKLIST_LINK_EXCLUDED','taskKey'=>$key,'itemKey'=>$item['key']];$linked=null;}
            $items[]=['key'=>$item['key'],'title'=>$item['title'],'assigneeId'=>$include['assignees']?$member($item['assigneeId'],$key,'assignee',$item['key']):null,
                'dueDate'=>$resolveDate($item['due'],$key,'checklistDue',$item['key']),'linkedTaskKey'=>$linked];
        }$lists[]=['key'=>$list['key'],'title'=>$list['title'],'items'=>$items];}
        $approvers=[];if($include['approvals']&&$task['approvalRequired']){
            $notices[]=['code'=>'APPROVAL_CONFIRMATIONS_RESET','taskKey'=>$key];
            foreach($task['approverIds'] as $approver){$mapped=$member($approver,$key,'approver');if($mapped!==null)$approvers[]=$mapped;}
            $approvers=array_values(array_unique($approvers));if(!$approvers)$blockers[]=['code'=>'TEMPLATE_APPROVERS_REQUIRED','taskKey'=>$key];
        }
        $dependencies=$include['dependencies']?array_values(array_intersect($task['dependsOnKeys'],array_keys($tasks))):[];
        if($include['dependencies']&&count($dependencies)!==count($task['dependsOnKeys']))$notices[]=['code'=>'DEPENDENCIES_EXCLUDED','taskKey'=>$key];
        $mappedTasks[$key]=['key'=>$key,'projectKey'=>$task['projectKey'],'parentKey'=>$task['parentKey'],'title'=>!$new&&$task['parentKey']===null&&$options['title']!==null?$options['title']:$task['title'],
            'description'=>$include['descriptions']?$task['description']:'','entryType'=>$task['entryType'],'priority'=>$task['priority'],'tags'=>$include['tags']?$task['tags']:[],'statusRef'=>$statusRef,'categoryRef'=>$categoryRef,'sourceStatusKey'=>$task['statusKey'],'sourceCategoryKey'=>$task['categoryKey'],
            'labelKeys'=>$include['labels']?$task['labelKeys']:[],'assigneeId'=>$include['assignees']?$member($task['assigneeId'],$key,'assignee'):null,'approverIds'=>$approvers,
            'dueDate'=>$due,'startDate'=>$start,...$times,'checklists'=>$lists,'customValues'=>$values,'dependsOnKeys'=>$dependencies,'storyPoints'=>$task['storyPoints'],'estimateHours'=>$task['estimateHours']];
    }
    foreach($options['fieldValues'] as $key=>$unused)if(!isset($tasks[$key]))throw new InvalidArgumentException('TEMPLATE_REFERENCE_INVALID');
    $fingerprint=hash('sha256',json_encode([$id,$record['revision'],$manifest,$options,$destination['digest']],JSON_THROW_ON_ERROR));
    return ['templateId'=>$id,'revision'=>$record['revision'],'kind'=>$manifest['kind'],'calendarMode'=>$manifest['calendarMode'],'calendarContext'=>$manifest['calendarContext'],
        'options'=>$options,'fingerprint'=>$fingerprint,'projects'=>array_values($projects),'tasks'=>array_values($mappedTasks),'newFields'=>array_values($fieldSpecs),'fields'=>$destination['fields'],
        'sourceFields'=>$manifest['fields'],'fieldMappings'=>$fieldRefs,
        'members'=>$destination['members'],'statuses'=>$destination['statuses'],'categories'=>$destination['categories'],'createLabels'=>array_values($createLabels),'labelMap'=>$labelMap,
        'notices'=>$notices,'blockers'=>$blockers,'canApply'=>!$blockers];
}

function genesisSharedPreviewTemplate(string $actor,string $id,array $input):array
{
    $db=genesisDb();$owns=!$db->inTransaction();if($owns)$db->beginTransaction();
    try{$plan=genesisSharedTemplatePlan($actor,$id,$input);if($owns)$db->commit();return $plan;}
    catch(Throwable $error){if($owns&&$db->inTransaction())$db->rollBack();throw $error;}
}

/** New IDs and all standard task validation; no source grants/files/discussions/subscriptions are copied. */
function genesisSharedApplyTemplate(string $actor,string $id,array $input):array
{
    $options=genesisTemplateApplyInput($input);$operation=$input['operationId']??null;$expected=$input['fingerprint']??null;
    if(!is_string($operation)||!is_string($expected)||!preg_match('/^[a-f0-9]{64}$/D',$expected))throw new InvalidArgumentException('TEMPLATE_OPERATION_REQUIRED');
    $hash=hash('sha256',json_encode([$id,$options,$expected],JSON_THROW_ON_ERROR));$db=genesisDb();$owns=!$db->inTransaction();$savepoint=null;
    if($owns)genesisBeginWriteTransaction($db);else{$savepoint='template_apply_'.bin2hex(random_bytes(8));$db->exec('SAVEPOINT '.$savepoint);}
    try{
        genesisSharedRequireEnabled($actor);genesisSharedTemplateSource($actor,$id,$options['language']);genesisSharedSpaceAccess($options['spaceId'],$actor);
        if($options['projectId']!==null)genesisSharedProjectAccess($options['projectId'],$actor,'write');
        if($options['parentProjectId']!==null)genesisSharedProjectAccess($options['parentProjectId'],$actor,'write');
        $replay=genesisSharedTemplateOperation($actor,$operation,'template.apply',$hash);
        if($replay!==null){foreach(array_unique(array_values($replay['projectIds'])) as $projectId)genesisSharedProjectAccess($projectId,$actor,'read',true);if($owns)$db->commit();else $db->exec('RELEASE '.$savepoint);return $replay;}
        $plan=genesisSharedTemplatePlan($actor,$id,$input);
        if(!hash_equals($expected,$plan['fingerprint']))throw new GenesisSharedAccessException('TEMPLATE_PREVIEW_CHANGED',409);
        if(!$plan['canApply'])throw new GenesisSharedAccessException('TEMPLATE_APPLY_BLOCKED',409);
        $new=$plan['kind']==='project';$spaceId=$options['spaceId'];$projectIds=[];$statusIds=[];$categoryIds=[];$fieldIds=[];$optionIds=[];$taskIds=[];$checklistIds=[];$labelIds=[];
        foreach($plan['createLabels'] as $label)$labelIds[$label['key']]=genesisSharedSaveLabel($actor,$spaceId,null,['title'=>$label['title'],'color'=>$label['color']])['id'];
        foreach($plan['labelMap'] as $key=>$ref)if($ref!==null&&!str_starts_with($ref,'new:'))$labelIds[$key]=$ref;
        $labels=static fn(array $keys):array=>array_values(array_intersect_key($labelIds,array_fill_keys($keys,true)));
        foreach($plan['projects'] as $project){$key=$project['key'];
            if(!$new){$projectIds[$key]=$options['projectId'];continue;}
            $parent=$project['parentKey']===null?$options['parentProjectId']:$projectIds[$project['parentKey']];
            $board=$project['parentKey']===null?$options['boardStatusId']:($project['boardStatusKey']===null?null:$statusIds[$project['boardStatusKey']]);
            $definitions=array_map(static function($s){unset($s['key']);return $s;},$project['statuses']);
            $created=genesisSharedCreateProject($actor,$spaceId,['title'=>$project['title'],'description'=>$project['description'],'tags'=>$project['tags'],'kind'=>$project['kind'],'layout'=>$project['layout'],
                'parentId'=>$parent,'boardStatusId'=>$board,'statuses'=>$definitions,'labelIds'=>$options['include']['labels']?$labels($project['labelKeys']):[]]);$projectIds[$key]=$created['id'];
            $q=$db->prepare('SELECT id FROM shared_project_statuses WHERE project_id=? AND is_chaos=0 ORDER BY position,id');$q->execute([$created['id']]);$ids=$q->fetchAll(PDO::FETCH_COLUMN);
            foreach($project['statuses'] as $i=>$status)$statusIds[$status['key']]=$ids[$i];
            foreach($project['categories'] as $category)$categoryIds[$category['key']]=genesisSharedCreateCategory($actor,$created['id'],['title'=>$category['title'],'color'=>$category['color']])['id'];
        }
        foreach($plan['newFields'] as $field){$ref=$field['ref'];$fieldIds[$ref]=genesisUuid();$choices=[];
            foreach($field['options'] as $option){$optionIds[$ref][$option['id']]=genesisUuid();$choices[]=[...$option,'id'=>$optionIds[$ref][$option['id']]];}
            $definition=['id'=>$fieldIds[$ref],'title'=>$field['title'],'type'=>$field['type'],'projectId'=>$projectIds[$field['projectKey']],'options'=>$choices,'position'=>$field['position'],
                'required'=>$field['required'],'showCard'=>$field['showCard'],'showList'=>$field['showList'],'archived'=>false,'expectedRevision'=>0];
            $preview=genesisSharedPreviewCustomField($actor,$spaceId,$definition);
            genesisSharedSaveCustomField($actor,$spaceId,[...$definition,'operationId'=>genesisUuid(),'fingerprint'=>$preview['fingerprint']]);
        }
        $fieldSpecs=array_column($plan['newFields'],null,'ref');$createdTasks=[];
        foreach($plan['tasks'] as $task){$values=[];$lists=[];
            if(!$new){$statusIds[$task['sourceStatusKey']]=$task['statusRef'];if($task['sourceCategoryKey']!==null)$categoryIds[$task['sourceCategoryKey']]=$task['categoryRef'];}
            foreach($task['customValues'] as $ref=>$value){$field=$fieldSpecs[$ref]??null;
                if($field!==null&&in_array($field['type'],['select','multi'],true))$value=$field['type']==='select'?$optionIds[$ref][$value]:array_map(static fn($v)=>$optionIds[$ref][$v],$value);
                $values[$fieldIds[$ref]??$ref]=$value;
            }
            foreach($task['checklists'] as $list){$listId=genesisUuid();$checklistIds[$list['key']]=$listId;$items=[];
                foreach($list['items'] as $item){$itemId=genesisUuid();$checklistIds[$item['key']]=$itemId;$items[]=['id'=>$itemId,'title'=>$item['title'],'done'=>false,'assigneeId'=>$item['assigneeId'],'dueDate'=>$item['dueDate']];}
                $lists[]=['id'=>$listId,'title'=>$list['title'],'items'=>$items];
            }
            $created=GenesisPlanningSeedScope::run(fn()=>genesisSharedTask($actor,$projectIds[$task['projectKey']],['title'=>$task['title'],'description'=>$task['description'],'entryType'=>$task['entryType'],'priority'=>$task['priority'],'tags'=>$task['tags'],
                'statusId'=>$new?$statusIds[$task['statusRef']]:$task['statusRef'],'categoryId'=>$new?($categoryIds[$task['categoryRef']]??null):$task['categoryRef'],
                'assigneeId'=>$task['assigneeId'],'labelIds'=>$labels($task['labelKeys']),'dueDate'=>$task['dueDate'],'startDate'=>$task['startDate'],'startTime'=>$task['startTime'],'endTime'=>$task['endTime'],
                'parentTaskId'=>$task['parentKey']===null?null:$taskIds[$task['parentKey']],'checklists'=>$lists,'customFields'=>$values,
                'approvalRequired'=>(bool)$task['approverIds'],'approverIds'=>$task['approverIds'],'storyPoints'=>$task['storyPoints'],'estimateHours'=>$task['estimateHours']]));
            $taskIds[$task['key']]=$created['id'];$createdTasks[$task['key']]=$created;
        }
        // All endpoints now exist. Links are internal to this validated manifest and new ID map.
        foreach($plan['tasks'] as $task){$taskId=$taskIds[$task['key']];$projectId=$projectIds[$task['projectKey']];$linked=false;$lists=$createdTasks[$task['key']]['checklists'];
            foreach($task['checklists'] as $i=>$list)foreach($list['items'] as $j=>$item)if($item['linkedTaskKey']!==null){$lists[$i]['items'][$j]['linkedTaskId']=$taskIds[$item['linkedTaskKey']];$linked=true;}
            if($linked){genesisSharedTaskDetailsSave($taskId,['priority'=>$task['priority'],'parentId'=>$task['parentKey']===null?null:$taskIds[$task['parentKey']],'checklists'=>$lists]);
                genesisSharedAudit($projectId,$actor,'task.updated',$taskId,['changes'=>['checklists'=>['from'=>$createdTasks[$task['key']]['checklists'],'to'=>$lists]]]);}
            if($task['dependsOnKeys'])genesisSharedTask($actor,$projectId,['expectedRevision'=>$createdTasks[$task['key']]['revision'],'dependsOnIds'=>array_map(static fn($key)=>$taskIds[$key],$task['dependsOnKeys'])],$taskId);
        }
        $result=['operationId'=>$operation,'templateId'=>$id,'rootProjectId'=>reset($projectIds),'rootTaskId'=>$plan['tasks']?$taskIds[$plan['tasks'][0]['key']]:null,
            'projectIds'=>$projectIds,'statusIds'=>$statusIds,'categoryIds'=>$categoryIds,'fieldIds'=>$fieldIds,'optionIds'=>$optionIds,'labelIds'=>$labelIds,'taskIds'=>$taskIds,'checklistIds'=>$checklistIds,
            'projectCount'=>$new?count($projectIds):0,'taskCount'=>count($taskIds),'notices'=>$plan['notices']];
        genesisSharedAudit($result['rootProjectId'],$actor,'template.applied',$id,['taskCount'=>count($taskIds),'projectCount'=>$result['projectCount']]);
        genesisSharedTemplateReceipt($actor,$operation,'template.apply',$hash,$result);
        if($owns)$db->commit();else $db->exec('RELEASE '.$savepoint);return $result;
    }catch(Throwable $error){if($db->inTransaction()){if($owns)$db->rollBack();elseif($savepoint!==null){$db->exec('ROLLBACK TO '.$savepoint);$db->exec('RELEASE '.$savepoint);}}throw $error;}
}
