<?php
declare(strict_types=1);
require_once __DIR__ . '/notification-preferences.php';
require_once __DIR__ . '/shared-notification-inbox.php';
require_once __DIR__ . '/shared-notification-delivery.php';

function genesisNotificationTask(string $taskId): ?array
{
    $q=genesisDb()->prepare('SELECT id,project_id,created_by,updated_by,assignee_id,due_date,completed_at,archived_at FROM shared_tasks_history_read WHERE id=?');$q->execute([$taskId]);$task=$q->fetch();$q->closeCursor();return$task?:null;
}

function genesisSharedTaskWatch(string $userId,string $projectId,string $taskId,?array $input=null): array
{
    genesisSharedRequireEnabled($userId);genesisSharedProjectAccess($projectId,$userId,'read',true);
    $task=genesisNotificationTask($taskId);if(!$task||$task['project_id']!==$projectId)throw new GenesisSharedAccessException();
    $db=genesisDb();
    if($input!==null){
        if(!is_bool($input['watching']??null))throw new InvalidArgumentException('INVALID_NOTIFICATION_SETTINGS');genesisBeginWriteTransaction($db);
        try{genesisSharedProjectAccess($projectId,$userId,'read',true);$current=genesisNotificationTask($taskId);if(!$current||$current['project_id']!==$projectId)throw new GenesisSharedAccessException();
            $db->prepare('INSERT INTO shared_task_watchers(task_id,user_id,created_at,watching) VALUES(?,?,?,?) ON CONFLICT(task_id,user_id) DO UPDATE SET watching=excluded.watching')->execute([$taskId,$userId,genesisNow(),$input['watching']?1:0]);$db->commit();
        }catch(Throwable$e){if($db->inTransaction())$db->rollBack();throw$e;}
    }
    return['watching'=>genesisNotificationWatching($userId,$task)];
}

function genesisNotificationWatching(string $userId,array $task): bool
{
    $q=genesisDb()->prepare('SELECT watching FROM shared_task_watchers WHERE task_id=? AND user_id=?');$q->execute([$task['id'],$userId]);$value=$q->fetchColumn();$q->closeCursor();if($value!==false)return(bool)$value;
    $q=genesisDb()->prepare('SELECT imported FROM shared_notification_task_state WHERE task_id=?');$q->execute([$task['id']]);$imported=(bool)$q->fetchColumn();$q->closeCursor();return!$imported&&in_array($userId,[$task['created_by'],$task['assignee_id']],true);
}

function genesisNotificationWatchers(array $task): array
{
    $q=genesisDb()->prepare('SELECT user_id FROM shared_task_watchers WHERE task_id=? AND watching=1');$q->execute([$task['id']]);$ids=$q->fetchAll(PDO::FETCH_COLUMN);$q->closeCursor();
    foreach([$task['created_by'],$task['assignee_id']]as$id)if($id&&genesisNotificationWatching($id,$task))$ids[]=$id;return array_values(array_unique($ids));
}

function genesisNotificationEligible(string $userId,string $projectId): bool
{
    $q=genesisDb()->prepare('SELECT 1 FROM users u JOIN shared_project_members pm ON pm.user_id=u.id JOIN shared_projects p ON p.id=pm.project_id JOIN shared_space_members sm ON sm.space_id=p.space_id AND sm.user_id=u.id WHERE u.id=? AND p.id=? AND u.shared_projects_enabled=1 AND p.archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM shared_trash tr WHERE tr.kind=\'project\' AND tr.object_id=p.id)');
    $q->execute([$userId,$projectId]);$ok=(bool)$q->fetchColumn();$q->closeCursor();if(!$ok)return false;try{genesisSharedRequireEnabled($userId);return true;}catch(GenesisSharedAccessException){return false;}
}

/** One audit identity per recipient, even when assignment, mention and watch audiences overlap. */
function genesisNotificationRecipient(string $eventId,string $userId,string $kind,?array $task,?int $dueVersion=null,?int $approvalVersion=null): void
{
    $db=genesisDb();$q=$db->prepare('SELECT project_id FROM shared_audit_events WHERE id=?');$q->execute([$eventId]);$project=$q->fetchColumn();$q->closeCursor();
    if(!$project||!genesisNotificationEligible($userId,$task['project_id']??$project))return;
    $db->prepare('INSERT OR IGNORE INTO shared_notification_recipients(event_id,user_id,kind,task_id,due_version,approval_version) VALUES(?,?,?,?,?,?)')->execute([$eventId,$userId,$kind,$task['id']??null,$dueVersion,$approvalVersion]);
    if(!$db->query('SELECT changes()')->fetchColumn())return;
    genesisNotificationEnqueue($eventId,$userId,$kind);
}

function genesisNotificationEnqueue(string $eventId,string $userId,string $kind): void
{
    $settings=genesisNotificationPreferences($userId)['settings'];$capabilities=genesisNotificationCapabilities();$db=genesisDb();$available=genesisNotificationScheduleAt($settings);$now=genesisNow();
    foreach(['push','email']as$channel){
        if(!$settings['channels'][$channel]||!$capabilities[$channel]['available'])continue;
        if($channel==='push'&&empty($settings['types'][$kind]))continue;
        if($channel==='email'&&empty($settings['emailTypes'][$kind]))continue;
        if($channel==='push'){$q=$db->prepare('SELECT id FROM shared_push_subscriptions WHERE user_id=?');$q->execute([$userId]);$targets=$q->fetchAll(PDO::FETCH_COLUMN);$q->closeCursor();}else$targets=['email'];
        foreach($targets as$target){
            $bucket=$settings['frequency']==='immediate'?'event:'.$eventId:$settings['frequency'].':'.$available;
            $q=$db->prepare('SELECT id,state FROM shared_notification_outbox WHERE user_id=? AND channel=? AND target_id=? AND bucket_key=?');$q->execute([$userId,$channel,$target,$bucket]);$old=$q->fetch();$q->closeCursor();
            // A closed digest is immutable; a late event gets a new durable receipt.
            if($old&&$old['state']!=='pending'){$bucket.=':'.$eventId;$old=false;}
            $id=$old['id']??genesisUuid();
            $db->prepare('INSERT OR IGNORE INTO shared_notification_outbox(id,user_id,channel,target_id,bucket_key,available_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')->execute([$id,$userId,$channel,$target,$bucket,$available,$now,$now]);
            $db->prepare('INSERT OR IGNORE INTO shared_notification_delivery_items(delivery_id,event_id,user_id,channel,target_id) VALUES(?,?,?,?,?)')->execute([$id,$eventId,$userId,$channel,$target]);
            genesisBackgroundEnqueue('shared-notification','notification:'.$id,['deliveryId'=>$id],$available);
        }
    }
}

/** Raw IDs are retained only inside this call, before the human-readable audit conversion. */
function genesisNotificationCapture(string $eventId,string $projectId,string $actorId,string $action,string $objectId,array $details): void
{
    $db=genesisDb();$db->prepare('INSERT OR IGNORE INTO shared_notification_events(event_id) VALUES(?)')->execute([$eventId]);$taskId=$details['taskId']??(str_starts_with($action,'task.')?$objectId:null);$task=$taskId?genesisNotificationTask($taskId):null;
    if(str_starts_with($action,'task.')&&!$task)return;
    $recipients=[];$put=static function($id,string $kind)use(&$recipients,$actorId){if(is_string($id)&&$id!==''&&$id!==$actorId)$recipients[$id]=$kind;};
    if(in_array($action,['task.created','project.created','project.updated','invitation.accepted','member.role_changed'],true)){
        $kind=match($action){'task.created'=>'created','project.created'=>'projects',default=>'changes'};
        $q=$db->prepare('SELECT user_id FROM shared_project_members WHERE project_id=?');$q->execute([$projectId]);$members=$q->fetchAll(PDO::FETCH_COLUMN);$q->closeCursor();foreach($members as$id)$put($id,$kind);
    }
    if($task){
        $watchers=genesisNotificationWatchers($task);
        if($action==='comment.created')foreach($watchers as$id)$put($id,'comments');
        if(in_array($action,['task.updated','task.moved_in','task.archived','task.unarchived'],true))foreach($watchers as$id)$put($id,'changes');
        // moved_out / moved_in describe one transfer. Only the destination audit creates deliveries.
        if($action==='task.moved_out')return;
        $q=$db->prepare('SELECT * FROM shared_notification_task_state WHERE task_id=?');$q->execute([$task['id']]);$old=$q->fetch();$q->closeCursor();
        $changed=$old&&$old['due_date']!==$task['due_date'];$dueVersion=(int)($old['due_version']??1)+($changed?1:0);
        $reopened=$old&&(int)$old['completed']===1&&$task['completed_at']===null;
        $approvalVersion=(int)($old['approval_version']??1)+($action==='task.approval_requested'||$reopened?1:0);
        $imported=!$changed&&!isset($details['changes']['assigneeId'])?(int)($old['imported']??0):0;
        $db->prepare('INSERT INTO shared_notification_task_state(task_id,due_date,due_version,completed,approval_version,imported) VALUES(?,?,?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET due_date=excluded.due_date,due_version=excluded.due_version,completed=excluded.completed,approval_version=excluded.approval_version,imported=excluded.imported')
            ->execute([$task['id'],$task['due_date'],$dueVersion,$task['completed_at']!==null?1:0,$approvalVersion,$imported]);
        if(($action==='task.created'&&$task['assignee_id'])||isset($details['changes']['assigneeId'])){
            $put($task['assignee_id'],'assignment');$put($details['changes']['assigneeId']['from']??null,'assignment');foreach($watchers as$id)$put($id,'assignment');
        }
        if($action==='comment.created'){
            $q=$db->prepare('SELECT user_id FROM shared_comment_mentions WHERE comment_id=?');$q->execute([$objectId]);$mentions=$q->fetchAll(PDO::FETCH_COLUMN);$q->closeCursor();foreach($mentions as$id)$put($id,'mentions');
        }
        if($action==='task.approval_requested'||$reopened){
            $q=$db->prepare('SELECT user_id FROM shared_task_approvals WHERE task_id=? AND approved_at IS NULL');$q->execute([$task['id']]);$approvers=$q->fetchAll(PDO::FETCH_COLUMN);$q->closeCursor();foreach($approvers as$id)$put($id,'approvalRequest');
        }
        if(isset($details['changes']['approval'])){
            foreach([$task['created_by'],$task['assignee_id'],...$watchers]as$id)$put($id,'approvalResult');
            $q=$db->prepare('SELECT user_id FROM shared_task_approvals WHERE task_id=?');$q->execute([$task['id']]);$approvers=$q->fetchAll(PDO::FETCH_COLUMN);$q->closeCursor();foreach($approvers as$id)$put($id,'approvalResult');
        }
    }
    foreach($recipients as$id=>$kind)genesisNotificationRecipient($eventId,$id,$kind,$task,null,$kind==='approvalRequest'?$approvalVersion:null);
}
