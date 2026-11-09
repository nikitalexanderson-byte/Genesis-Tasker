<?php
declare(strict_types=1);
require_once __DIR__.'/shared-automations.php';

/** Chain provenance is internal and encrypted; clients cannot select it. Called in the audit transaction. */
function genesisAutomationQueue(array $rule,string $key,?array $task,array $payload):void
{
    $db=genesisDb();$context=$GLOBALS['genesisAutomationContext']??null;
    if(!empty($context['dryRun']))return;
    $chain=$context['chainId']??genesisUuid();$visited=$context['visited']??[];$error=null;
    if(in_array($rule['id'],$visited,true)||count($visited)>=8)$error='AUTOMATION_LOOP_GUARD';
    $q=$db->prepare('SELECT COUNT(*) FROM shared_automation_runs WHERE chain_id=?');$q->execute([$chain]);if((int)$q->fetchColumn()>=50)$error='AUTOMATION_CHAIN_LIMIT';
    $q=$db->prepare('SELECT COUNT(*) FROM shared_automation_runs WHERE rule_id=? AND created_at>=?');$q->execute([$rule['id'],gmdate('Y-m-d\TH:i:s\Z',time()-3600)]);if((int)$q->fetchColumn()>=100)$error='AUTOMATION_RATE_LIMIT';
    $payload+=['visited'=>$visited,'chainId'=>$chain];$id=genesisUuid();$now=genesisNow();
    $q=$db->prepare('INSERT OR IGNORE INTO shared_automation_runs(id,rule_id,rule_revision,trigger_key,task_id,task_revision,chain_id,payload_json,state,error_code,created_at,finished_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
    $q->execute([$id,$rule['id'],(int)$rule['revision'],$key,$task['id']??null,$task['revision']??null,$chain,genesisAutomationEncode($payload),$error?'skipped':'pending',$error,$now,$error?$now:null]);
    if($q->rowCount()&&!$error)genesisBackgroundEnqueue('shared-automation','automation:'.$id.':0',['runId'=>$id,'retry'=>0]);
}

function genesisAutomationCapture(string $eventId,string $projectId,string $action,string $objectId,array $details):void
{
    if(!in_array($action,['task.created','task.updated','task.moved_in'],true)||!empty($GLOBALS['genesisAutomationContext']['dryRun']))return;
    $db=genesisDb();$q=$db->prepare('SELECT * FROM shared_tasks_read WHERE id=? AND project_id=?');$q->execute([$objectId,$projectId]);$task=$q->fetch();if(!$task||$task['archived_at']!==null)return;
    $types=[];if($action==='task.created')$types[]='created';
    if($action!=='task.created'&&(isset($details['changes']['statusId'])||isset($details['changes']['approval'])&&$task['completed_at']!==null))$types[]='status';
    if($action!=='task.created'&&isset($details['changes']['assigneeId']))$types[]='assignee';
    if($task['completed_at']!==null&&($action==='task.created'||isset($details['changes']['statusId'])||isset($details['changes']['approval'])))$types[]='completed';
    if(!$types)return;
    $q=$db->prepare('SELECT * FROM shared_automation_rules WHERE project_id=? AND enabled=1 AND deleted_at IS NULL ORDER BY id LIMIT 100');$q->execute([$projectId]);
    foreach($q->fetchAll() as $rule){$definition=genesisAutomationDecode($rule['definition_json']);$type=$definition['trigger']['type'];
        if(in_array($type,$types,true))genesisAutomationQueue($rule,'event:'.$eventId,['id'=>$task['id'],'revision'=>(int)$task['revision']],['type'=>$type,'eventId'=>$eventId,'dueDate'=>$task['due_date'],'completed'=>$task['completed_at']!==null]);
    }
}

/** Bounded fair scans; each page has an immutable ID cursor, each civil schedule slot has a durable key. */
function genesisAutomationScan(?string $at=null):void
{
    $db=genesisDb();$clock=new DateTimeImmutable($at??genesisNow());$q=$db->query('SELECT * FROM shared_automation_rules WHERE enabled=1 AND deleted_at IS NULL AND owner_id IS NOT NULL ORDER BY checked_at,id LIMIT 20');$rules=$q->fetchAll();$deadline=microtime(true)+4;
    foreach($rules as $rule){
        if(microtime(true)>$deadline)break;$definition=genesisAutomationDecode($rule['definition_json']);$trigger=$definition['trigger'];
        $db->prepare('UPDATE shared_automation_rules SET checked_at=? WHERE id=?')->execute([genesisNow(),$rule['id']]);
        if(!in_array($trigger['type'],['schedule','dueSoon','due'],true))continue;
        $zone=new DateTimeZone($definition['calendarContext']['timeZone']);$local=$clock->setTimezone($zone);$today=$local->format('Y-m-d');
        if($local->format('H:i')<$trigger['time'])$through=genesisCalendarAddDays($today,-1);else $through=$today;
        genesisBeginWriteTransaction($db);
        try{
            $q=$db->prepare('SELECT * FROM shared_automation_rules WHERE id=? AND revision=? AND enabled=1 AND deleted_at IS NULL');$q->execute([$rule['id'],$rule['revision']]);$current=$q->fetch();if(!$current){$db->commit();continue;}$rule=$current;
            if($trigger['type']==='schedule'){
                $baseline=max($trigger['recurrence']['rangeStart'],(new DateTimeImmutable($rule['updated_at']))->setTimezone($zone)->format('Y-m-d'));
                $date=$rule['cursor_date']??genesisCalendarAddDays($baseline,-1);$after=$rule['scan_after_id'];
                for($checked=0;$checked<7&&microtime(true)<$deadline;$checked++){
                    $slot=$after!==''?$date:genesisCalendarAddDays($date,1);if($slot>$through)break;
                    $matching=genesisRecurrenceMatches($trigger['recurrence']['rangeStart'],$trigger['recurrence'],$slot);
                    if($matching&&$trigger['target']==='project')genesisAutomationQueue($rule,'slot:'.$rule['revision'].':'.$slot,null,['type'=>'schedule','scheduledDate'=>$slot]);
                    elseif($matching){
                        $q=$db->prepare("SELECT t.id,t.revision FROM shared_tasks_read t WHERE t.project_id=? AND t.archived_at IS NULL AND t.id>? AND NOT EXISTS(SELECT 1 FROM shared_data_import_records ir WHERE ir.kind='task' AND ir.target_id=t.id AND ir.initial_revision>=t.revision) ORDER BY t.id LIMIT 101");$q->execute([$rule['project_id'],$after]);$tasks=$q->fetchAll();
                        foreach(array_slice($tasks,0,100) as $task)genesisAutomationQueue($rule,'slot:'.$rule['revision'].':'.$slot.':'.$task['id'],$task,['type'=>'schedule','scheduledDate'=>$slot]);
                        if(count($tasks)>100){$date=$slot;$after=$tasks[99]['id'];break;}
                    }
                    $date=$slot;$after='';
                }
                $db->prepare('UPDATE shared_automation_rules SET cursor_date=?,scan_after_id=? WHERE id=? AND revision=?')->execute([$date,$after,$rule['id'],$rule['revision']]);
            }elseif($through===$today){
                $soon=$trigger['type']==='dueSoon';$bound=$soon?genesisCalendarAddDays($today,$trigger['leadDays']):$today;
                $q=$db->prepare("SELECT t.id,t.revision,t.due_date,COALESCE(s.due_version,1) AS due_version FROM shared_tasks_read t LEFT JOIN shared_notification_task_state s ON s.task_id=t.id WHERE t.project_id=? AND t.archived_at IS NULL AND t.completed_at IS NULL AND t.due_date IS NOT NULL AND t.id>? AND t.due_date<=? AND NOT EXISTS(SELECT 1 FROM shared_data_import_records ir WHERE ir.kind='task' AND ir.target_id=t.id AND ir.initial_revision>=t.revision)".($soon?' AND t.due_date>?':'').' ORDER BY t.id LIMIT 101');
                $values=[$rule['project_id'],$rule['scan_after_id'],$bound];if($soon)$values[]=$today;$q->execute($values);$tasks=$q->fetchAll();
                foreach(array_slice($tasks,0,100) as $task)genesisAutomationQueue($rule,'due:'.$rule['revision'].':'.$task['id'].':'.$task['due_version'].':'.$task['due_date'],$task,['type'=>$trigger['type'],'scheduledDate'=>$today,'dueDate'=>$task['due_date']]);
                $db->prepare('UPDATE shared_automation_rules SET scan_after_id=? WHERE id=? AND revision=?')->execute([count($tasks)>100?$tasks[99]['id']:'',$rule['id'],$rule['revision']]);
            }
            $db->commit();
        }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
    }
}

/** A compound rule updates a task once, then applies templates and enqueues existing notification deliveries. */
function genesisAutomationEffects(array $rule,array $definition,?array $task,array $payload,string $runId):array
{
    $actor=$rule['owner_id'];$project=genesisSharedProjectAccess($rule['project_id'],$actor,'write');$patch=[];$labels=$task['labelIds']??[];$due=$task['dueDate']??null;$notices=[];
    foreach($definition['actions'] as $action){
        switch($action['type']){
            case 'status':$patch['statusId']=$action['value'];break;
            case 'assignee':$patch['assigneeId']=$action['value']??null;break;
            case 'priority':$patch['priority']=$action['value'];break;
            case 'addLabels':$labels=array_values(array_unique([...$labels,...$action['value']]));$patch['labelIds']=$labels;break;
            case 'removeLabels':$labels=array_values(array_diff($labels,$action['value']));$patch['labelIds']=$labels;break;
            case 'custom':$patch['customFields'][$action['fieldId']]=$action['value'];break;
            case 'due':
                if($action['mode']==='clear')$due=null;
                elseif($action['mode']==='set')$due=$action['date'];
                else{if($due===null)throw new GenesisSharedAccessException('AUTOMATION_DUE_REQUIRED',409);$shift=genesisTemplateDate($due,$action['offset'],$definition['calendarMode'],$definition['calendarContext']);$due=$shift['date'];if($shift['clamped'])$notices[]='TEMPLATE_DATE_CLAMPED';}
                $patch['dueDate']=$due;break;
        }
    }
    if($patch){
        if(!$task)throw new InvalidArgumentException('AUTOMATION_TASK_REQUIRED');
        $task=genesisSharedTask($actor,$rule['project_id'],[...$patch,'expectedRevision'=>(int)$task['revision'],'requestId'=>$runId],$task['id']);
    }
    $result=['updated'=>$patch!==[],'patch'=>$patch,'createdTaskCount'=>0,'notifications'=>0,'notices'=>$notices];
    foreach($definition['actions'] as $index=>$action){
        if($action['type']==='createTemplate'){
            if($task&&$payload['type']==='completed'){
                $q=genesisDb()->prepare('SELECT 1 FROM shared_series_instances WHERE task_id=?');$q->execute([$task['id']]);if($q->fetchColumn())throw new GenesisSharedAccessException('AUTOMATION_SERIES_DUPLICATE',409);
            }
            $anchor=$payload['scheduledDate']??(new DateTimeImmutable(genesisNow()))->setTimezone(new DateTimeZone($definition['calendarContext']['timeZone']))->format('Y-m-d');
            $options=[...$action['options'],'spaceId'=>$project['space_id'],'projectId'=>$project['id'],'anchorDate'=>$anchor];
            $preview=genesisSharedPreviewTemplate($actor,$action['templateId'],$options);
            if(!$preview['canApply'])throw new GenesisSharedAccessException('AUTOMATION_TEMPLATE_BLOCKED',409);
            if($result['createdTaskCount']+count($preview['tasks'])>50)throw new GenesisSharedAccessException('AUTOMATION_EFFECT_LIMIT',409);
            $receipt=genesisSharedApplyTemplate($actor,$action['templateId'],[...$options,'fingerprint'=>$preview['fingerprint'],'operationId'=>'automation:'.$runId.':'.$index]);
            $result['createdTaskCount']+=$receipt['taskCount'];$result['notices']=[...$result['notices'],...array_column($receipt['notices'],'code')];
        }
        if($action['type']==='notify'){
            $event=genesisSharedAudit($project['id'],$actor,'automation.notification',$task['id']??$project['id'],['taskId'=>$task['id']??null,'automationId'=>$rule['id'],'message'=>$action['message']]);
            foreach($action['recipientIds'] as $recipient){
                if(!genesisNotificationEligible($recipient,$project['id']))throw new GenesisSharedAccessException('AUTOMATION_RECIPIENT_UNAVAILABLE',409);
                genesisNotificationRecipient($event,$recipient,'changes',$task?genesisNotificationTask($task['id']):null);$result['notifications']++;
            }
        }
    }
    return $result;
}

function genesisAutomationSafeError(Throwable $error):string
{
    $code=$error->getMessage();
    if(preg_match('/^(?:AUTOMATION|CUSTOM_FIELD|TEMPLATE|WORKFLOW|SHARED_PROJECT|SHARED_TASK|INVALID_|TASK_)[A-Z_]*$/D',$code))return $code;
    return 'AUTOMATION_ACTION_REJECTED';
}

/** All effects and the run receipt are inside background-jobs' transaction and lease acknowledgement. */
function genesisAutomationPerform(array $job):string
{
    $db=genesisDb();$q=$db->prepare('SELECT * FROM shared_automation_runs WHERE id=?');$q->execute([$job['runId']??'']);$run=$q->fetch();
    if(!$run||$run['state']!=='pending'||(int)$run['retry_count']!==($job['retry']??0))return 'cancelled';
    $q=$db->prepare('SELECT * FROM shared_automation_rules WHERE id=?');$q->execute([$run['rule_id']]);$rule=$q->fetch();$payload=genesisAutomationDecode($run['payload_json']);
    $state='cancelled';$error=null;$result=null;$previous=$GLOBALS['genesisAutomationContext']??null;
    $db->exec('SAVEPOINT automation_effects');
    try{
        if(!$rule||!$rule['owner_id']||!(bool)$rule['enabled']||$rule['deleted_at']!==null||(int)$rule['revision']!==(int)$run['rule_revision'])throw new GenesisSharedAccessException('AUTOMATION_STALE',409);
        genesisSharedRequireEnabled($rule['owner_id']);$project=genesisSharedProjectAccess($rule['project_id'],$rule['owner_id'],'write');
        $definition=genesisAutomationDefinition($rule['owner_id'],$project,genesisAutomationDecode($rule['definition_json']));$task=null;
        if($run['task_id']!==null){
            $task=genesisSharedGetTask($rule['owner_id'],$project['id'],$run['task_id']);
            if((int)$task['revision']!==(int)$run['task_revision']||$task['archivedAt']!==null)throw new GenesisSharedAccessException('AUTOMATION_STALE',409);
            if(in_array($payload['type'],['dueSoon','due'],true)&&($task['completedAt']!==null||$task['dueDate']!==$payload['dueDate']))throw new GenesisSharedAccessException('AUTOMATION_STALE',409);
        }
        if(!genesisAutomationMatches($definition,$project['id'],$task)){$state='skipped';$error='AUTOMATION_CONDITIONS_NOT_MET';}
        else{
            $GLOBALS['genesisAutomationContext']=['chainId'=>$run['chain_id'],'visited'=>[...$payload['visited'],$rule['id']]];
            $result=genesisAutomationEffects($rule,$definition,$task,$payload,$run['id']);$state='succeeded';
        }
        $db->exec('RELEASE SAVEPOINT automation_effects');
    }catch(GenesisSharedAccessException|InvalidArgumentException|RangeException $failure){
        $db->exec('ROLLBACK TO SAVEPOINT automation_effects');$db->exec('RELEASE SAVEPOINT automation_effects');$error=genesisAutomationSafeError($failure);
        $state=in_array($error,['AUTOMATION_STALE','SHARED_PROJECT_NOT_FOUND','SHARED_PROJECT_FORBIDDEN','SHARED_PROJECTS_DISABLED'],true)?'cancelled':'failed';
    }finally{$GLOBALS['genesisAutomationContext']=$previous;}
    $db->prepare('UPDATE shared_automation_runs SET state=?,attempts=attempts+1,error_code=?,result_json=?,finished_at=? WHERE id=?')->execute([$state,$error,$result?genesisAutomationEncode($result):null,genesisNow(),$run['id']]);
    return $state==='cancelled'?'cancelled':'succeeded';
}

function genesisAutomationJobError(array $job,string $code,bool $failed):void
{
    $payload=genesisAutomationDecode($job['payload']);
    genesisDb()->prepare("UPDATE shared_automation_runs SET attempts=attempts+1,state=?,error_code=?,finished_at=? WHERE id=? AND retry_count=? AND state='pending'")
        ->execute([$failed?'failed':'pending',$code,$failed?genesisNow():null,$payload['runId']??'',(int)($payload['retry']??0)]);
}

/** Uses the real validators within a rolled-back savepoint; no durable tasks, jobs, receipts or notifications. */
function genesisSharedAutomationPreview(string $actor,string $projectId,array $input):array
{
    genesisAutomationKeys($input,['definition','taskId','ownerId']);$db=genesisDb();genesisBeginWriteTransaction($db);$previous=$GLOBALS['genesisAutomationContext']??null;
    try{
        genesisSharedRequireEnabled($actor);$project=genesisSharedProjectAccess($projectId,$actor,'write');$owner=$input['ownerId']??$actor;
        if(!is_string($owner)||$owner!==$actor&&!$project['permissions']['manageProjects'])throw new GenesisSharedAccessException('SHARED_PROJECT_FORBIDDEN',403);
        $definition=genesisAutomationDefinition($actor,$project,$input['definition']??null);
        genesisSharedRequireEnabled($owner);$definition=genesisAutomationDefinition($owner,genesisSharedProjectAccess($projectId,$owner,'write'),$definition);
        $taskId=$input['taskId']??null;$task=null;
        if($taskId!==null){genesisSharedGetTask($actor,$projectId,genesisTemplateKey($taskId));$task=genesisSharedGetTask($owner,$projectId,$taskId);}
        if(!$task&&!($definition['trigger']['type']==='schedule'&&$definition['trigger']['target']==='project'))throw new InvalidArgumentException('AUTOMATION_TASK_REQUIRED');
        $matches=genesisAutomationMatches($definition,$projectId,$task);$GLOBALS['genesisAutomationContext']=['dryRun'=>true];
        $effect=$matches?genesisAutomationEffects(['id'=>'preview','owner_id'=>$owner,'project_id'=>$projectId],$definition,$task,['type'=>$definition['trigger']['type']],genesisUuid()):null;
        $result=['matches'=>$matches,'ownerId'=>$owner,'taskId'=>$taskId,'taskRevision'=>$task['revision']??null,'effects'=>$effect,'dryRun'=>true];$db->rollBack();return $result;
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}finally{$GLOBALS['genesisAutomationContext']=$previous;}
}
