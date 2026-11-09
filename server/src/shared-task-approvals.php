<?php
declare(strict_types=1);

function genesisSharedTaskApprovals(string $taskId): array
{
    $query = genesisDb()->prepare('SELECT a.user_id AS userId, a.approved_at AS approvedAt,
        COALESCE(NULLIF(u.display_name, \'\'), u.email, \'Бывший участник\') AS displayName
        FROM shared_task_approvals a LEFT JOIN users u ON u.id = a.user_id WHERE a.task_id = :task ORDER BY a.id');
    $query->execute(['task' => $taskId]);
    return $query->fetchAll();
}

function genesisSharedApprovalIndex(string $projectId): array
{
    $query = genesisDb()->prepare('SELECT a.task_id, a.user_id AS userId, a.approved_at AS approvedAt,
        COALESCE(NULLIF(u.display_name, \'\'), u.email, \'Бывший участник\') AS displayName
        FROM shared_task_approvals a JOIN shared_tasks_read t ON t.id = a.task_id LEFT JOIN users u ON u.id = a.user_id
        WHERE t.project_id = :project ORDER BY a.id');
    $query->execute(['project' => $projectId]); $index = [];
    foreach ($query->fetchAll() as $row) { $taskId = $row['task_id']; unset($row['task_id']); $index[$taskId][] = $row; }
    return $index;
}

function genesisSharedRequireTaskApproval(string $taskId): void
{
    $query = genesisDb()->prepare('SELECT COUNT(*) FROM shared_task_approvals WHERE task_id = :task AND approved_at IS NULL');
    $query->execute(['task' => $taskId]);
    if ((int)$query->fetchColumn() > 0) throw new GenesisSharedAccessException('Закрытие задачи должны подтвердить все выбранные участники.', 409);
}

function genesisSharedResetTaskApprovals(string $taskId): void
{
    genesisDb()->prepare('UPDATE shared_task_approvals SET approved_at = NULL WHERE task_id = :task')->execute(['task' => $taskId]);
}

/** Called inside the task write transaction; omitted fields preserve legacy behavior. */
function genesisSharedConfigureTaskApprovals(string $userId, string $projectId, string $taskId, array $input, ?array $existing, bool $done): void
{
    if (!array_key_exists('approvalRequired', $input)) return;
    if (!is_bool($input['approvalRequired'])) throw new InvalidArgumentException('INVALID_TASK_APPROVAL');
    $project = genesisSharedProjectAccess($projectId, $userId);
    if ($existing && $existing['created_by'] !== $userId && !$project['permissions']['manageProjects']) throw new GenesisSharedAccessException();
    $ids = $input['approvalRequired'] ? ($input['approverIds'] ?? null) : [];
    if (!is_array($ids) || !array_is_list($ids) || count($ids) > 200 || ($input['approvalRequired'] && !$ids)
        || array_filter($ids, static fn($id) => !is_string($id) || strlen($id) > 100)) throw new InvalidArgumentException('Выберите участников, которые должны подтвердить выполнение.');
    $ids = array_values(array_unique($ids));
    $member = genesisDb()->prepare('SELECT 1 FROM shared_project_members pm JOIN shared_projects p ON p.id = pm.project_id
        JOIN shared_space_members sm ON sm.space_id = p.space_id AND sm.user_id = pm.user_id WHERE pm.project_id = :project AND pm.user_id = :user');
    foreach ($ids as $id) {
        $member->execute(['project' => $projectId, 'user' => $id]);
        if (!$member->fetchColumn()) throw new InvalidArgumentException('INVALID_TASK_APPROVER');
    }
    $old = array_column(genesisSharedTaskApprovals($taskId), 'userId');
    $sorted = $ids; sort($old); sort($sorted);
    if ($old === $sorted) return;
    if ($done) throw new GenesisSharedAccessException('Сначала верните задачу в работу, чтобы изменить подтверждения.', 409);
    genesisDb()->prepare('DELETE FROM shared_task_approvals WHERE task_id = :task')->execute(['task' => $taskId]);
    $insert = genesisDb()->prepare('INSERT INTO shared_task_approvals (id, task_id, user_id) VALUES (:id, :task, :user)');
    foreach ($ids as $id) $insert->execute(['id' => genesisUuid(), 'task' => $taskId, 'user' => $id]);
    if ($ids) genesisSharedAudit($projectId,$userId,'task.approval_requested',$taskId);
}

function genesisSharedApproveTask(string $userId, string $projectId, string $taskId): array
{
    genesisSharedRequireEnabled($userId);
    $db = genesisDb(); genesisBeginWriteTransaction($db);
    try {
        genesisSharedProjectAccess($projectId, $userId);
        $query = $db->prepare('SELECT t.* FROM shared_tasks_read t JOIN shared_task_approvals a ON a.task_id = t.id
            WHERE t.id = :task AND t.project_id = :project AND a.user_id = :user');
        $query->execute(['task' => $taskId, 'project' => $projectId, 'user' => $userId]);
        $task = $query->fetch();
        if (!$task) throw new GenesisSharedAccessException();
        $status = $db->prepare('SELECT id FROM shared_project_statuses WHERE project_id = :project AND is_done = 1 AND is_chaos=0 ORDER BY position LIMIT 1');
        $status->execute(['project' => $projectId]); $doneId = $status->fetchColumn();
        if (!$doneId) throw new GenesisSharedAccessException('Добавьте доску для выполненных задач.', 409);
        if (str_starts_with($task['status_id'],'chaos-')) $doneId=genesisSharedProjectInboxStatus($db,$projectId,true);
        $now = genesisNow();
        $approved = $db->prepare('UPDATE shared_task_approvals SET approved_at = :now WHERE task_id = :task AND user_id = :user AND approved_at IS NULL');
        $approved->execute(['now' => $now, 'task' => $taskId, 'user' => $userId]);
        if ($approved->rowCount()) {
            $remaining = $db->prepare('SELECT COUNT(*) FROM shared_task_approvals WHERE task_id = :task AND approved_at IS NULL');
            $remaining->execute(['task' => $taskId]); $complete = (int)$remaining->fetchColumn() === 0;
            if ($complete) genesisSharedRequireTaskChildrenComplete($taskId);
            $db->prepare('UPDATE shared_tasks SET status_id = :status, completed_by = :actor, completed_at = :completed,
                updated_by = :user, updated_at = :now, revision = revision + 1 WHERE id = :task')->execute([
                'status' => $complete ? $doneId : $task['status_id'], 'actor' => $complete ? $userId : null,
                'completed' => $complete ? $now : null, 'user' => $userId, 'now' => $now, 'task' => $taskId]);
            genesisWorkflowTask($userId,$projectId,$taskId,$task);
            genesisSharedAudit($projectId, $userId, 'task.updated', $taskId, ['objectTitle' => $task['title'],'reportBefore'=>['statusId'=>$task['status_id'],'completed'=>$task['completed_at']!==null], 'changes' => ['approval' => ['from' => false, 'to' => true]]]);
        }
        $db->commit();
        return genesisSharedGetTask($userId, $projectId, $taskId);
    } catch (Throwable $error) { if ($db->inTransaction()) $db->rollBack(); throw $error; }
}
