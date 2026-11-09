<?php
declare(strict_types=1);

function genesisSharedTaskDate(mixed $value): ?string
{
    if ($value === null || $value === '') return null;
    if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}$/D', $value)
        || !checkdate((int)substr($value, 5, 2), (int)substr($value, 8, 2), (int)substr($value, 0, 4))) {
        throw new InvalidArgumentException('INVALID_DUE_DATE');
    }
    return $value;
}

function genesisSharedChecklistId(mixed $value): string
{
    if (!is_string($value) || !preg_match('/^[a-zA-Z0-9_-]{1,100}$/D', $value)) throw new InvalidArgumentException('INVALID_CHECKLIST');
    return $value;
}

/** Checklists share the task revision/receipt, so a stale whole-form save cannot erase a teammate's item. */
function genesisSharedNormalizeChecklists(string $projectId, mixed $value, array $old = []): array
{
    if (!is_array($value) || !array_is_list($value) || count($value) > 20) throw new InvalidArgumentException('INVALID_CHECKLIST');
    $previous = [];
    foreach ($old as $list) foreach ($list['items'] as $item) $previous[$item['id']] = $item;
    $seen = []; $total = 0; $result = [];
    $member = genesisDb()->prepare('SELECT 1 FROM shared_project_members m JOIN shared_projects p ON p.id=m.project_id
        JOIN shared_space_members sm ON sm.space_id=p.space_id AND sm.user_id=m.user_id WHERE m.project_id=? AND m.user_id=?');
    foreach ($value as $list) {
        if (!is_array($list) || !is_array($list['items'] ?? null) || !array_is_list($list['items'])) throw new InvalidArgumentException('INVALID_CHECKLIST');
        $id = genesisSharedChecklistId($list['id'] ?? null);
        if (isset($seen[$id])) throw new InvalidArgumentException('INVALID_CHECKLIST');
        $seen[$id] = true;
        $items = [];
        foreach ($list['items'] as $item) {
            if (!is_array($item) || ++$total > 300 || !is_bool($item['done'] ?? null)) throw new InvalidArgumentException('INVALID_CHECKLIST');
            $itemId = genesisSharedChecklistId($item['id'] ?? null);
            if (isset($seen[$itemId])) throw new InvalidArgumentException('INVALID_CHECKLIST');
            $seen[$itemId] = true;
            $assignee = $item['assigneeId'] ?? null;
            if ($assignee !== null) {
                if (!is_string($assignee)) throw new InvalidArgumentException('INVALID_ASSIGNEE');
                $member->execute([$projectId, $assignee]);
                // A departed assignee may be retained in history, but cannot be newly assigned.
                if (!$member->fetchColumn() && $assignee !== ($previous[$itemId]['assigneeId'] ?? null)) throw new InvalidArgumentException('INVALID_ASSIGNEE');
            }
            $linked = $previous[$itemId]['linkedTaskId'] ?? null;
            if (($item['linkedTaskId'] ?? null) !== $linked && empty($item['linkUnavailable'])) throw new InvalidArgumentException('INVALID_CHECKLIST_LINK');
            $items[] = ['id' => $itemId, 'title' => genesisSharedTitle($item['title'] ?? null, 500),
                'done' => $linked ? false : $item['done'], 'assigneeId' => $assignee,
                'dueDate' => genesisSharedTaskDate($item['dueDate'] ?? null), 'linkedTaskId' => $linked];
        }
        $result[] = ['id' => $id, 'title' => genesisSharedTitle($list['title'] ?? null), 'items' => $items];
    }
    return $result;
}

/** Parents and predecessors use the same task identity, project boundary and cycle checks. */
function genesisSharedTaskParent(string $projectId, string $id, mixed $parentId): ?string
{
    if ($parentId === null || $parentId === '') return null;
    if (!is_string($parentId) || $parentId === $id) throw new InvalidArgumentException('TASK_RELATION_CYCLE');
    $db = genesisDb();
    $parent = $db->prepare('SELECT parent_task_id, completed_at FROM shared_tasks_read WHERE id=? AND project_id=?');
    $seen = [$id => true]; $cursor = $parentId;
    while ($cursor !== null) {
        if (isset($seen[$cursor])) throw new InvalidArgumentException('TASK_RELATION_CYCLE');
        $seen[$cursor] = true;
        $parent->execute([$cursor, $projectId]); $row = $parent->fetch();
        if (!$row) throw new InvalidArgumentException('TASK_PARENT_UNAVAILABLE');
        if ($cursor === $parentId && $row['completed_at'] !== null) throw new InvalidArgumentException('TASK_PARENT_COMPLETED');
        $cursor = $row['parent_task_id'];
    }
    return $parentId;
}

function genesisSharedChecklistsComplete(array $lists): bool
{
    $query = genesisDb()->prepare('SELECT completed_at FROM shared_tasks_read WHERE id=?');
    foreach ($lists as $list) foreach ($list['items'] as $item) {
        if ($item['linkedTaskId'] ?? null) {
            $query->execute([$item['linkedTaskId']]);
            if (!$query->fetchColumn()) return false;
        } elseif (!$item['done']) return false;
    }
    return true;
}

/** Every completion path (form, drag/drop, approval, later bulk/worker) calls this guard. */
function genesisSharedRequireTaskChildrenComplete(string $taskId, ?array $checklists = null): void
{
    $db = genesisDb();
    $children = $db->prepare('SELECT COUNT(*) FROM shared_tasks_history_read WHERE parent_task_id=? AND completed_at IS NULL');
    $children->execute([$taskId]);
    if ((int)$children->fetchColumn() > 0) throw new GenesisSharedAccessException('TASK_CHILDREN_INCOMPLETE', 409);
    if ($checklists === null) {
        $q = $db->prepare('SELECT checklists_json FROM shared_tasks_history_read WHERE id=?'); $q->execute([$taskId]);
        $checklists = json_decode($q->fetchColumn() ?: '[]', true, 512, JSON_THROW_ON_ERROR);
    }
    if (!genesisSharedChecklistsComplete($checklists)) throw new GenesisSharedAccessException('TASK_CHECKLIST_INCOMPLETE', 409);
}

function genesisSharedTaskDetailsInput(string $projectId, string $id, array $input, ?array $existing, bool $done): array
{
    $priority = $input['priority'] ?? (int)($existing['priority'] ?? 0);
    if (!is_int($priority) || $priority < 0 || $priority > 3) throw new InvalidArgumentException('INVALID_TASK_PRIORITY');
    $old = json_decode($existing['checklists_json'] ?? '[]', true, 512, JSON_THROW_ON_ERROR);
    $checklists = array_key_exists('checklists', $input) ? genesisSharedNormalizeChecklists($projectId, $input['checklists'], $old) : $old;
    $parentId = $existing['parent_task_id'] ?? null;
    if (array_key_exists('parentTaskId', $input) && $input['parentTaskId'] !== $parentId) $parentId = genesisSharedTaskParent($projectId, $id, $input['parentTaskId']);
    if (!$done && $parentId !== null) {
        $q = genesisDb()->prepare('SELECT completed_at FROM shared_tasks_history_read WHERE id=?'); $q->execute([$parentId]);
        if ($q->fetchColumn()) throw new GenesisSharedAccessException('TASK_PARENT_COMPLETED', 409);
    }
    if ($done) genesisSharedRequireTaskChildrenComplete($id, $checklists);
    return compact('priority', 'parentId', 'checklists');
}

function genesisSharedTaskDetailsSave(string $id, array $details): void
{
    genesisDb()->prepare('UPDATE shared_tasks SET priority=?,parent_task_id=?,checklists_json=? WHERE id=?')->execute([
        $details['priority'], $details['parentId'], json_encode($details['checklists'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), $id]);
}

/** Read a single task independently of its position in the project page. */
function genesisSharedGetTask(string $userId, string $projectId, string $taskId, bool $archived = false): array
{
    genesisSharedRequireEnabled($userId);
    $project = genesisSharedProjectAccess($projectId, $userId);
    $q = genesisDb()->prepare('SELECT * FROM ' . ($archived ? 'shared_tasks_history_read' : 'shared_tasks_read') . ' WHERE id=? AND project_id=?');
    $q->execute([$taskId, $projectId]); $row = $q->fetch();
    if (!$row) throw new GenesisSharedAccessException();
    return genesisSharedHydrateTasks($userId, [$row], [$projectId => $project])[0];
}

function genesisSharedConvertChecklistItem(string $userId, string $projectId, string $taskId, array $input): array
{
    genesisSharedRequireEnabled($userId); $db = genesisDb(); genesisBeginWriteTransaction($db);
    try {
        genesisSharedProjectAccess($projectId, $userId, 'write');
        $requestId = genesisSharedRequestId($input);
        $payloadHash = genesisSharedMutationPayloadHash('checklist.convert',$input,['projectId'=>$projectId]);
        $receipt = genesisSharedMutationReceipt($db, $userId, $requestId, 'checklist.convert', $taskId, $payloadHash);
        if ($receipt !== null) { $db->commit(); return $receipt; }
        $q = $db->prepare('SELECT * FROM shared_tasks_read WHERE id=? AND project_id=?'); $q->execute([$taskId, $projectId]); $task = $q->fetch();
        if (!$task) throw new GenesisSharedAccessException();
        $lists = json_decode($task['checklists_json'], true, 512, JSON_THROW_ON_ERROR);
        foreach ($lists as &$list) foreach ($list['items'] as &$item) {
            if ($item['id'] !== ($input['itemId'] ?? null)) continue;
            // A different request retry of an already converted item also returns the same task.
            if ($item['linkedTaskId'] ?? null) {
                $result = genesisSharedGetTask($userId, $projectId, $item['linkedTaskId']);
                $response = ['taskId' => $result['id'], 'projectId' => $projectId];
                genesisSharedSaveMutationReceipt($db,$userId,$requestId,'checklist.convert',$taskId,$response,$payloadHash);
                $db->commit(); return $response;
            }
            if ((int)$task['revision'] !== ($input['expectedRevision'] ?? null)) throw new GenesisSharedAccessException('SHARED_TASK_CONFLICT', 409);
            if ($task['completed_at'] !== null) throw new GenesisSharedAccessException('TASK_PARENT_COMPLETED', 409);
            $statusId = $task['status_id'];
            $created = genesisSharedTask($userId, $projectId, ['title' => $item['title'], 'statusId' => $statusId,
                'assigneeId' => $item['assigneeId'], 'dueDate' => $item['dueDate'], 'priority' => (int)$task['priority']]);
            $item['linkedTaskId'] = $created['id']; $item['done'] = false;
            $db->prepare('UPDATE shared_tasks SET checklists_json=?, revision=revision+1, updated_at=?,updated_by=? WHERE id=?')
                ->execute([json_encode($lists, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), genesisNow(), $userId, $taskId]);
            genesisSharedAudit($projectId, $userId, 'task.updated', $taskId, ['changes'=>['checklistConversion'=>['from'=>$input['itemId'],'to'=>$created['id']]]]);
            $result = ['taskId' => $created['id'], 'projectId' => $projectId];
            genesisSharedSaveMutationReceipt($db, $userId, $requestId, 'checklist.convert', $taskId, $result, $payloadHash);
            $db->commit(); return $result;
        }
        throw new GenesisSharedAccessException();
    } catch (Throwable $error) { if ($db->inTransaction()) $db->rollBack(); throw $error; }
}
