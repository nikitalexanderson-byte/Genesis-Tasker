<?php
declare(strict_types=1);

/** All totals come from current project AND space membership, never cached client lists. */
function genesisSharedOverview(string $userId, ?string $spaceId = null): array
{
    genesisSharedRequireEnabled($userId);
    $db = genesisDb();
    $values = ['user' => $userId];
    if ($spaceId !== null) {
        genesisSharedSpaceAccess($spaceId, $userId);
        $values['space'] = $spaceId;
    }
    $scope = ' FROM shared_projects p
        JOIN shared_project_members m ON m.project_id = p.id AND m.user_id = :user
        JOIN shared_space_members sm ON sm.space_id = p.space_id AND sm.user_id = m.user_id';
    if ($spaceId !== null) $scope .= ' AND p.space_id = :space';
    $query = $db->prepare('SELECT COUNT(*) AS projects,
        COALESCE(SUM(p.parent_id IS NULL), 0) AS rootProjects,
        COALESCE(SUM(p.parent_id IS NOT NULL), 0) AS subprojects' . $scope .
        " WHERE p.archived_at IS NULL AND p.is_inbox = 0 AND p.kind = 'project'");
    $query->execute($values); $totals = $query->fetch();
    $query = $db->prepare('SELECT COUNT(*) AS tasks,
        COALESCE(SUM(t.completed_at IS NULL), 0) AS openTasks,
        COALESCE(SUM(t.completed_at IS NOT NULL), 0) AS completedTasks' . $scope .
        ' JOIN shared_tasks_read t ON t.project_id = p.id WHERE p.archived_at IS NULL');
    $query->execute($values); $totals += $query->fetch();
    $totals += genesisNotificationUnreadCounts($userId,$spaceId);
    return array_map('intval', $totals);
}

/** A bounded inbox page; a cursor also lets unread items older than 100 be reviewed. */
function genesisSharedInbox(string $userId, string $before = '', bool $unreadOnly = false): array
{
    return genesisNotificationInbox($userId,$before,$unreadOnly);
}

function genesisSharedReadInbox(string $userId, array $input): void
{
    genesisNotificationRead($userId,$input);
}

/** Read only the task and comments the client actually displayed, regardless of entry route. */
function genesisSharedReadTaskUpdates(string $userId, string $projectId, string $taskId, array $input): array
{
    genesisSharedRequireEnabled($userId);
    $ids = $input['commentIds'] ?? [];
    if (!is_array($ids) || !array_is_list($ids) || count($ids) > 200 ||
        array_filter($ids, static fn($id) => !is_string($id) || !preg_match('/\A[a-f0-9-]{36}\z/', $id))) {
        throw new InvalidArgumentException('INVALID_COMMENT_IDS');
    }
    $db = genesisDb(); $db->beginTransaction();
    try {
        genesisSharedProjectAccess($projectId, $userId);
        $query = $db->prepare('SELECT id FROM shared_tasks_history_read WHERE id = :task AND project_id = :project');
        $query->execute(['task' => $taskId, 'project' => $projectId]);
        if ($query->fetchColumn() === false) throw new GenesisSharedAccessException('TASK_NOT_FOUND', 404);
        $sql=genesisNotificationInboxSql($userId,null,false,true,'all');$commentCondition='';
        if($ids){$keys=[];foreach(array_values(array_unique($ids))as$i=>$id){$keys[]=':shown'.$i;$sql['values']['shown'.$i]=$id;}$commentCondition=' OR e.object_id IN ('.implode(',',$keys).')';}
        // A viewed task also acknowledges its visible events from previous projects after a move.
        // Comment IDs still describe exactly which discussion entries the client displayed.
        $query=$db->prepare('INSERT OR IGNORE INTO shared_notification_reads(event_id,user_id,read_at) SELECT e.id,:user,:now'.$sql['from'].$sql['where']." AND COALESCE(n.task_id,e.task_id,t.id,CASE WHEN e.action LIKE 'task.%' THEN e.object_id END)=:task AND (e.action<>'comment.created'".$commentCondition.')');
        $query->execute($sql['values']+['task'=>$taskId,'now'=>genesisNow()]);
        // Discussion read state is independent of notification channel/type opt-outs.
        if($ids){
            $shown=implode(',',array_fill(0,count($ids),'?'));
            $ack=$db->prepare("INSERT OR IGNORE INTO shared_notification_reads(event_id,user_id,read_at)
                SELECT e.id,?,? FROM shared_audit_events_read e JOIN shared_comments_read c ON c.id=e.object_id
                WHERE e.action='comment.created' AND c.task_id=? AND c.id IN ($shown)");
            $ack->execute([$userId,genesisNow(),$taskId,...$ids]);
        }
        $overview = genesisSharedOverview($userId);
        $db->commit();
        return ['ok' => true, 'overview' => $overview];
    } catch (Throwable $error) { $db->rollBack(); throw $error; }
}
