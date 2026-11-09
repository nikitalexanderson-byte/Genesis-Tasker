<?php
declare(strict_types=1);

function genesisNotificationInboxSql(string $userId,?string $spaceId=null,bool $delivery=false,bool $includeHiddenInbox=false,string $channel='inbox'): array
{
    $db=genesisDb();$today=[];
    $db->sqliteCreateFunction('genesis_notification_day',static function(?string $zone)use(&$today):string{
        $zone??=genesisConfig()['timezone']??'UTC';return$today[$zone]??= (new DateTimeImmutable(genesisNow()))->setTimezone(new DateTimeZone($zone))->format('Y-m-d');
    },1);
    $kind="COALESCE(n.kind,CASE WHEN e.action='comment.created' AND EXISTS(SELECT 1 FROM shared_comment_mentions cm WHERE cm.comment_id=e.object_id AND cm.user_id=:user) THEN 'mentions' WHEN e.action='comment.created' THEN 'comments' WHEN e.action='project.created' THEN 'projects' WHEN e.action='task.created' THEN 'created' ELSE 'changes' END)";
    $explicit="EXISTS(SELECT 1 FROM shared_task_watchers w WHERE w.task_id=t.id AND w.user_id=:user AND w.watching=1)";
    $watch="($explicit OR (COALESCE(ns.imported,0)=0 AND (t.created_by=:user OR t.assignee_id=:user) AND NOT EXISTS(SELECT 1 FROM shared_task_watchers w WHERE w.task_id=t.id AND w.user_id=:user AND w.watching=0)))";
    $from=" FROM shared_audit_events_read e
        LEFT JOIN shared_notification_recipients n ON n.event_id=e.id AND n.user_id=:user
        LEFT JOIN shared_notification_events captured ON captured.event_id=e.id
        LEFT JOIN shared_tasks_history_read t ON t.id=COALESCE(n.task_id,e.task_id,CASE WHEN e.action LIKE 'task.%' THEN e.object_id END) AND t.project_id=e.project_id
        JOIN shared_projects p ON p.id=e.project_id AND p.archived_at IS NULL
        JOIN shared_project_members pm ON pm.project_id=p.id AND pm.user_id=:user
        JOIN shared_space_members sm ON sm.space_id=p.space_id AND sm.user_id=pm.user_id
        LEFT JOIN users actor ON actor.id=e.actor_id
        LEFT JOIN shared_comments_read c ON c.id=e.object_id AND e.action='comment.created' AND c.task_id=t.id
        LEFT JOIN shared_notification_reads r ON r.event_id=e.id AND r.user_id=:user
        LEFT JOIN shared_notification_preferences pref ON pref.user_id=:user
        LEFT JOIN shared_notification_task_state ns ON ns.task_id=t.id";
    // Creation history stays discoverable for newly added members; this does not enqueue past external deliveries.
    $typeFilter=$channel==='all'?'1=1':($channel==='email'?"COALESCE(json_extract(pref.settings_json,'$.emailTypes.'||($kind)),json_extract(pref.settings_json,'$.types.'||($kind)),1)=1":"COALESCE(json_extract(pref.settings_json,'$.types.'||($kind)),1)=1");
    $where=" WHERE (n.user_id IS NOT NULL OR (e.actor_id IS NOT :user AND (e.action IN ('project.created','task.created') OR (captured.event_id IS NULL AND e.action IN ('project.updated','invitation.accepted','member.role_changed','task.updated','task.moved_in','task.moved_out','comment.created')))))
        AND (e.action IN ('project.created','project.updated','invitation.accepted','member.role_changed','automation.notification') OR t.id IS NOT NULL OR e.task_id IS NOT NULL)
        AND NOT EXISTS(SELECT 1 FROM shared_trash tr WHERE (tr.kind='project' AND tr.object_id=p.id) OR (tr.kind='task' AND tr.object_id=COALESCE(n.task_id,e.task_id,t.id)))
        AND ($typeFilter)
        AND (COALESCE(n.kind,'')<>'approvalRequest' OR (n.approval_version=ns.approval_version AND EXISTS(SELECT 1 FROM shared_task_approvals a WHERE a.task_id=t.id AND a.user_id=:user AND a.approved_at IS NULL)))
        AND (COALESCE(n.kind,'') NOT IN ('dueSoon','overdue') OR (
            t.completed_at IS NULL AND t.archived_at IS NULL AND t.due_date IS NOT NULL AND n.due_version=ns.due_version
            AND (COALESCE(ns.imported,0)=0 OR $explicit)
            AND (t.assignee_id=:user OR $watch)
            AND ((n.kind='overdue' AND t.due_date<genesis_notification_day(json_extract(pref.settings_json,'$.timeZone')))
                OR (n.kind='dueSoon' AND t.due_date>=genesis_notification_day(json_extract(pref.settings_json,'$.timeZone'))
                    AND t.due_date<=date(genesis_notification_day(json_extract(pref.settings_json,'$.timeZone')),'+'||COALESCE(json_extract(pref.settings_json,'$.reminderDays'),1)||' days')))))";
    if($delivery)$where.=" AND r.event_id IS NULL AND (t.id IS NOT NULL OR (e.task_id IS NULL AND e.action NOT LIKE 'task.%')) AND (t.id IS NULL OR COALESCE(n.kind,'') NOT IN ('changes','comments') OR $watch)";
    elseif(!$includeHiddenInbox)$where.=" AND COALESCE(json_extract(pref.settings_json,'$.channels.inbox'),1)=1";
    $values=['user'=>$userId];if($spaceId!==null){$where.=' AND p.space_id=:space';$values['space']=$spaceId;}
    return compact('from','where','values','kind');
}

function genesisNotificationUnreadCounts(string $userId,?string $spaceId=null): array
{
    $sql=genesisNotificationInboxSql($userId,$spaceId);
    $q=genesisDb()->prepare("SELECT COALESCE(SUM(e.action='task.created'),0) AS newTasks,
        COALESCE(SUM(e.action='project.created'),0) AS newProjects,COALESCE(SUM(e.action='comment.created'),0) AS newComments,
        COALESCE(SUM(e.action NOT IN ('task.created','project.created','comment.created')),0) AS newNotifications".$sql['from'].$sql['where'].' AND r.event_id IS NULL');
    $q->execute($sql['values']);$result=$q->fetch();$q->closeCursor();return array_map('intval',$result);
}

function genesisNotificationInbox(string $userId,string $before='',bool $unread=false,int $limit=50,?string $eventId=null): array
{
    genesisSharedRequireEnabled($userId);$sql=genesisNotificationInboxSql($userId);$db=genesisDb();$values=$sql['values'];$filter='';
    if($eventId!==null){$filter.=' AND e.id=:event';$values['event']=$eventId;}
    if($before!==''){
        if(!preg_match('/\A[a-f0-9-]{36}\z/D',$before))throw new InvalidArgumentException('INVALID_NOTIFICATION_CURSOR');
        // A cursor is opaque navigation state, never a means to inspect an inaccessible event.
        $q=$db->prepare('SELECT e.created_at'.$sql['from'].$sql['where'].' AND e.id=:cursor');$q->execute($values+['cursor'=>$before]);$time=$q->fetchColumn();$q->closeCursor();
        if($time===false)throw new InvalidArgumentException('INVALID_NOTIFICATION_CURSOR');$filter.=' AND (e.created_at<:time OR (e.created_at=:time AND e.id<:before))';$values+=['time'=>$time,'before'=>$before];
    }
    if($unread)$filter.=' AND r.event_id IS NULL';$limit=max(1,min(100,$limit));
    $q=$db->prepare('SELECT e.id,e.action,e.created_at AS createdAt,'.$sql['kind'].' AS kind,
        COALESCE(t.id,e.task_id,e.object_id) AS objectId,p.id AS projectId,p.title AS projectTitle,p.space_id AS spaceId,
        COALESCE(NULLIF(actor.display_name,\'\'),\'GENESIS\') AS actorName,CASE WHEN e.task_id IS NOT NULL OR e.action LIKE \'task.%\' THEN COALESCE(t.title,json_extract(e.details_json,\'$.objectTitle\')) END AS taskTitle,t.archived_at AS archivedAt,t.due_date AS dueDate,
        COALESCE(substr(c.body,1,180),substr(json_extract(e.details_json,\'$.message\'),1,1000)) AS commentBody,c.id AS commentId,CASE WHEN r.event_id IS NULL THEN 0 ELSE 1 END AS isRead'
        .$sql['from'].$sql['where'].$filter.' ORDER BY e.created_at DESC,e.id DESC LIMIT '.($limit+1));
    $q->execute($values);$rows=$q->fetchAll();$q->closeCursor();$settings=genesisNotificationPreferences($userId)['settings'];$preview=genesisNotificationQuietUntil($settings)===null;$user=genesisFindUser($userId);
    $items=array_map(static function($row)use($preview,$settings,$user){$row['isRead']=(int)$row['isRead'];$row['previewAllowed']=$preview;$row['timeZone']=$settings['timeZone'];$row['timeFormat']=$user['time_format']??'24h';$row['gregorianYearStart']=$user['gregorian_year_start']??'january';return$row;},array_slice($rows,0,$limit));
    return['notifications'=>$items,'nextCursor'=>count($rows)>$limit?$rows[$limit-1]['id']:null];
}

function genesisNotificationRead(string $userId,array $input): void
{
    genesisSharedRequireEnabled($userId);$ids=$input['eventIds']??[];$all=($input['all']??false)===true;$read=$input['read']??true;
    if(!is_bool($read)||!is_array($ids)||!array_is_list($ids)||count($ids)>100||array_filter($ids,static fn($id)=>!is_string($id)||!preg_match('/\A[a-f0-9-]{36}\z/D',$id)))throw new InvalidArgumentException('INVALID_NOTIFICATION_IDS');
    if(!$all&&!$ids)return;$db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        $sql=genesisNotificationInboxSql($userId);$values=$sql['values'];$filter='';
        if(!$all){$keys=[];foreach(array_values(array_unique($ids))as$i=>$id){$keys[]=':event'.$i;$values['event'.$i]=$id;}$filter=' AND e.id IN ('.implode(',',$keys).')';}
        $q=$db->prepare('SELECT e.id'.$sql['from'].$sql['where'].$filter);$q->execute($values);$visible=$q->fetchAll(PDO::FETCH_COLUMN);$q->closeCursor();
        if(!$all&&array_diff($ids,$visible))throw new GenesisSharedAccessException();
        $write=$db->prepare($read?'INSERT OR IGNORE INTO shared_notification_reads(event_id,user_id,read_at) VALUES(?,?,?)':'DELETE FROM shared_notification_reads WHERE event_id=? AND user_id=?');
        foreach($visible as$id)$write->execute($read?[$id,$userId,genesisNow()]:[$id,$userId]);$db->commit();
    }catch(Throwable$e){if($db->inTransaction())$db->rollBack();throw$e;}
}

function genesisNotificationDestination(string $userId,string $eventId): array
{
    $items=genesisNotificationInbox($userId,'',false,1,$eventId)['notifications'];if(!$items)throw new GenesisSharedAccessException();$item=$items[0];
    $destination=['spaceId'=>$item['spaceId'],'projectId'=>$item['projectId']];
    if($item['taskTitle']!==null){$task=genesisNotificationTask($item['objectId']);if(!$task)throw new GenesisSharedAccessException();$project=genesisSharedProjectAccess($task['project_id'],$userId,'read',true);$destination=['spaceId'=>$project['space_id'],'projectId'=>$project['id'],'taskId'=>$task['id']];}
    return[...$destination,
        ...($item['commentId']?['taskAction'=>'comments','commentId'=>$item['commentId']]:[])];
}
