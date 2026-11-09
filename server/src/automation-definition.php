<?php
declare(strict_types=1);
require_once __DIR__.'/recurrence.php';
require_once __DIR__.'/template-apply.php';

function genesisAutomationInvalid():never { throw new InvalidArgumentException('AUTOMATION_INVALID'); }
function genesisAutomationKeys(array $value,array $keys):void { if(array_diff(array_keys($value),$keys))genesisAutomationInvalid(); }
function genesisAutomationIds(mixed $value,int $limit=200):array
{
    if(!is_array($value)||!array_is_list($value)||count($value)>$limit)genesisAutomationInvalid();
    foreach($value as $id)genesisTemplateKey($id);
    return array_values(array_unique($value));
}

/** Store typed data, never executable expressions or arbitrary SQL/filter objects. */
function genesisAutomationDefinition(string $actor,array $project,mixed $raw):array
{
    if(!is_array($raw))genesisAutomationInvalid();
    genesisAutomationKeys($raw,['schemaVersion','trigger','conditions','actions','calendarMode','calendarContext']);
    if(($raw['schemaVersion']??null)!==1||!in_array($raw['calendarMode']??null,['profane','sacred','lunar'],true))genesisAutomationInvalid();
    $context=genesisCalendarContext($raw['calendarContext']??null,'Europe/Moscow',2);
    $trigger=$raw['trigger']??null;
    if(!is_array($trigger))genesisAutomationInvalid();
    genesisAutomationKeys($trigger,['type','leadDays','recurrence','time','target']);
    if(!in_array($trigger['type']??null,['created','status','assignee','completed','dueSoon','due','schedule'],true))genesisAutomationInvalid();
    $type=$trigger['type'];$normalized=['type'=>$type];
    if($type==='dueSoon'){
        $days=$trigger['leadDays']??1;if(!is_int($days)||$days<1||$days>366)genesisAutomationInvalid();$normalized['leadDays']=$days;
    }
    if(in_array($type,['schedule','dueSoon','due'],true)){
        $time=$trigger['time']??'09:00';if(!is_string($time)||!preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/D',$time))genesisAutomationInvalid();$normalized['time']=$time;
    }
    if($type==='schedule'){
        $rule=genesisRecurrenceRule($trigger['recurrence']??null);$rule['calendarContext']=$context;
        $target=$trigger['target']??'project';if(!in_array($target,['project','tasks'],true))genesisAutomationInvalid();
        $normalized+=['recurrence'=>$rule,'target'=>$target];
    }
    $conditions=$raw['conditions']??[];$actions=$raw['actions']??null;
    if(!is_array($conditions)||!array_is_list($conditions)||count($conditions)>20||!is_array($actions)||!array_is_list($actions)||count($actions)<1||count($actions)>10)genesisAutomationInvalid();
    $projectOnly=$type==='schedule'&&$normalized['target']==='project';
    $statuses=[];$q=genesisDb()->prepare('SELECT id FROM shared_project_statuses WHERE project_id=?');$q->execute([$project['id']]);$statuses=$q->fetchAll(PDO::FETCH_COLUMN);
    $fields=array_column(genesisSharedCustomFields($actor,$project['space_id'],$project['id']),null,'id');
    $labels=array_column(genesisSharedLabels($actor,$project['space_id']),null,'id');
    $q=genesisDb()->prepare('SELECT user_id FROM shared_project_members WHERE project_id=?');$q->execute([$project['id']]);$members=$q->fetchAll(PDO::FETCH_COLUMN);
    foreach($conditions as &$condition){
        if(!is_array($condition))genesisAutomationInvalid();genesisAutomationKeys($condition,['field','fieldId','operator','value']);
        $field=$condition['field']??null;$operator=$condition['operator']??'eq';
        if(!in_array($field,['project','status','label','assignee','priority','custom'],true)||$projectOnly&&$field!=='project')genesisAutomationInvalid();
        $allowed=$field==='label'?['contains','notContains']:['eq','ne','missing','present'];
        if($field==='priority')$allowed=[...$allowed,'gt','gte','lt','lte'];
        $definition=null;
        if($field==='custom'){
            $definition=$fields[$condition['fieldId']??'']??null;if(!$definition)throw new GenesisSharedAccessException('CUSTOM_FIELD_UNAVAILABLE',409);
            if(in_array($definition['type'],['number','date'],true))$allowed=[...$allowed,'gt','gte','lt','lte'];
            if($definition['type']==='multi')$allowed=[...$allowed,'contains','notContains'];
        }
        if(!in_array($operator,$allowed,true))genesisAutomationInvalid();
        $value=$condition['value']??null;
        if(!in_array($operator,['missing','present'],true)){
            if($definition){$value=genesisSharedCustomValue($definition,in_array($operator,['contains','notContains'],true)?[$value]:$value);if(in_array($operator,['contains','notContains'],true))$value=$value[0]??null;}
            elseif($field==='priority'&&(!is_int($value)||$value<0||$value>3))genesisAutomationInvalid();
            elseif($field==='project'&&$value!==$project['id']||$field==='status'&&!in_array($value,$statuses,true)||$field==='label'&&!isset($labels[$value??''])||$field==='assignee'&&$value!==null&&!in_array($value,$members,true))genesisAutomationInvalid();
        }
        $condition=['field'=>$field,'operator'=>$operator,'value'=>$value]+($definition?['fieldId'=>$definition['id']]:[]);
    }unset($condition);
    foreach($actions as &$action){
        if(!is_array($action))genesisAutomationInvalid();if(!empty($action['unavailable']))throw new GenesisSharedAccessException('AUTOMATION_TEMPLATE_BLOCKED',409);$kind=$action['type']??null;
        if(!in_array($kind,['status','assignee','priority','addLabels','removeLabels','due','custom','createTemplate','notify'],true)||$projectOnly&&!in_array($kind,['createTemplate','notify'],true))genesisAutomationInvalid();
        $keys=match($kind){'due'=>['type','mode','date','offset'],'custom'=>['type','fieldId','value'],'createTemplate'=>['type','templateId','options'],'notify'=>['type','recipientIds','message'],default=>['type','value']};
        genesisAutomationKeys($action,$keys);
        if($kind==='status'&&!in_array($action['value']??null,$statuses,true))genesisAutomationInvalid();
        if($kind==='assignee'&&($action['value']??null)!==null&&!in_array($action['value'],$members,true))throw new InvalidArgumentException('INVALID_ASSIGNEE');
        if($kind==='priority'&&(!is_int($action['value']??null)||$action['value']<0||$action['value']>3))genesisAutomationInvalid();
        if(in_array($kind,['addLabels','removeLabels'],true)){
            $action['value']=genesisAutomationIds($action['value']??null,30);foreach($action['value'] as $id)if(!isset($labels[$id]))genesisAutomationInvalid();
        }
        if($kind==='due'){
            if(!in_array($action['mode']??null,['set','shift','clear'],true))genesisAutomationInvalid();
            if($action['mode']==='set'){
                $date=genesisSharedTaskDate($action['date']??null);if($date===null||$date<'1900-01-01'||$date>'2100-12-31')genesisAutomationInvalid();
                $action=['type'=>'due','mode'=>'set','date'=>$date];
            }
            elseif($action['mode']==='shift'){
                $offset=$action['offset']??null;if(!is_array($offset))genesisAutomationInvalid();
                genesisTemplateDate('2000-06-15',$offset,$raw['calendarMode'],$context);$action=['type'=>'due','mode'=>'shift','offset'=>$offset];
            }else $action=['type'=>'due','mode'=>'clear'];
        }
        if($kind==='custom'){
            $field=$fields[$action['fieldId']??'']??null;if(!$field)throw new GenesisSharedAccessException('CUSTOM_FIELD_UNAVAILABLE',409);
            $action['value']=genesisSharedCustomValue($field,$action['value']??null);
        }
        if($kind==='createTemplate'){
            $template=genesisSharedTemplateSource($actor,genesisTemplateKey($action['templateId']??null),'ru');
            if($template['kind']!=='task')throw new InvalidArgumentException('AUTOMATION_TASK_TEMPLATE_REQUIRED');
            // A rule can only create tasks in its own project, never expand project access.
            $options=genesisTemplateApplyInput([...genesisTemplateObject($action['options']??[]),'spaceId'=>$project['space_id'],'projectId'=>$project['id'],'anchorDate'=>'2000-06-15']);
            if($options['parentProjectId']!==null||$options['boardStatusId']!==null)genesisAutomationInvalid();
            unset($options['anchorDate']);$action=['type'=>'createTemplate','templateId'=>$template['id'],'options'=>$options];
        }
        if($kind==='notify'){
            $ids=genesisAutomationIds($action['recipientIds']??null,50);if(!$ids||array_diff($ids,$members))genesisAutomationInvalid();
            $action=['type'=>'notify','recipientIds'=>$ids,'message'=>genesisSharedText($action['message']??'',1000)];
        }
    }unset($action);
    return ['schemaVersion'=>1,'trigger'=>$normalized,'conditions'=>$conditions,'actions'=>$actions,'calendarMode'=>$raw['calendarMode'],'calendarContext'=>$context];
}

function genesisAutomationMatches(array $definition,string $projectId,?array $task):bool
{
    foreach($definition['conditions'] as $condition){
        $field=$condition['field'];$actual=match($field){
            'project'=>$projectId,'status'=>$task['statusId']??null,'label'=>$task['labelIds']??[],
            'assignee'=>$task['assigneeId']??null,'priority'=>$task['priority']??null,
            'custom'=>((array)($task['customFields']??[]))[$condition['fieldId']]??null,
        };
        $wanted=$condition['value'];$exists=$actual!==null;
        $equal=(is_int($actual)||is_float($actual))&&(is_int($wanted)||is_float($wanted))?(float)$actual===(float)$wanted:$actual===$wanted;
        $ok=match($condition['operator']){
            'missing'=>!$exists,'present'=>$exists,'eq'=>$equal,'ne'=>!$equal,
            'contains'=>is_array($actual)&&in_array($wanted,$actual,true),'notContains'=>!is_array($actual)||!in_array($wanted,$actual,true),
            'gt'=>$exists&&$actual>$wanted,'gte'=>$exists&&$actual>=$wanted,'lt'=>$exists&&$actual<$wanted,'lte'=>$exists&&$actual<=$wanted,
        };if(!$ok)return false;
    }
    return true;
}
