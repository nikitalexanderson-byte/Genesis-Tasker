<?php
declare(strict_types=1);

function genesisSharedChanges(array $before, array $after): array
{
    $changes = [];
    foreach ($after as $field => $value) {
        $old = $before[$field] ?? null;
        if ($old !== $value) $changes[$field] = ['from' => is_string($old) ? mb_substr($old, 0, 500) : $old,
            'to' => is_string($value) ? mb_substr($value, 0, 500) : $value];
    }
    return $changes;
}

/** Save readable names with the event so later renames/deletions do not erase context. */
function genesisSharedReadableChanges(array $details): array
{
    if(isset($details['changes']['sprintId']))foreach(['from','to'] as $direction){$id=$details['changes']['sprintId'][$direction]??null;$details['referenceIds']['sprintId'][$direction]=$id;
        if(is_string($id)){$rows=genesisPlanningRows('SELECT content_json FROM shared_sprints WHERE id=?',[$id]);$details['changes']['sprintId'][$direction]=$rows?genesisPlanningOpen($rows[0]['content_json'])['title']:null;}
    }
    if(isset($details['changes']['customFields'])){
        $ids=array_unique(array_merge(array_keys($details['changes']['customFields']['from']),array_keys($details['changes']['customFields']['to'])));
        $definitions=[];foreach($ids as $id){$q=genesisDb()->prepare('SELECT * FROM shared_custom_fields WHERE id=?');$q->execute([$id]);if($row=$q->fetch())$definitions[]=genesisSharedCustomFieldRecord($row);}
        $details['customFieldDefinitions']=$definitions;
    }
    $queries = ['statusId' => 'SELECT title FROM shared_project_statuses WHERE id = :id',
        'boardStatusId' => 'SELECT title FROM shared_project_statuses WHERE id = :id',
        'categoryId' => 'SELECT title FROM shared_project_categories WHERE id = :id UNION ALL SELECT title FROM shared_space_project_categories WHERE id = :id LIMIT 1',
        'projectId' => 'SELECT title FROM shared_projects WHERE id = :id', 'parentId' => 'SELECT title FROM shared_projects WHERE id = :id',
        'assigneeId' => 'SELECT display_name FROM users WHERE id = :id', 'labelIds' => 'SELECT title FROM shared_space_labels WHERE id = :id',
        'dependsOnIds' => 'SELECT title FROM shared_tasks_read WHERE id = :id'];
    foreach ($details['changes'] ?? [] as $field => $change) {
        if (!isset($queries[$field])) continue;
        $query = genesisDb()->prepare($queries[$field]);
        foreach (['from', 'to'] as $direction) {
            $value = $change[$direction] ?? null;
            $resolve = static function ($id) use ($query) {
                if ($id === null || $id === '') return null;
                $query->execute(['id' => $id]); return $query->fetchColumn() ?: 'Удалённый объект';
            };
            $details['changes'][$field][$direction] = is_array($value) ? array_map($resolve, $value) : $resolve($value);
        }
    }
    return $details;
}

function genesisSharedEventContext(string $projectId, string $action, string $objectId, array $details): array
{
    $db = genesisDb();
    if (str_starts_with($action, 'task.') || str_starts_with($action, 'comment.')) {
        $query = $db->prepare(str_starts_with($action, 'comment.')
            ? 'SELECT t.id, t.status_id, t.title FROM shared_tasks_read t JOIN shared_comments_read c ON c.task_id = t.id WHERE c.id = :id AND t.project_id = :project'
            : 'SELECT id, status_id, title FROM shared_tasks_read WHERE id = :id AND project_id = :project');
        $query->execute(['id' => $objectId, 'project' => $projectId]); $task = $query->fetch();
        if ($task) $details += ['taskId' => $task['id'], 'boardId' => $task['status_id'], 'objectTitle' => $task['title']];
    } elseif (str_starts_with($action, 'status.')) {
        $query = $db->prepare('SELECT title FROM shared_project_statuses WHERE id = :id AND project_id = :project');
        $query->execute(['id' => $objectId, 'project' => $projectId]);
        $details += ['boardId' => $objectId, 'objectTitle' => $query->fetchColumn() ?: ''];
    } elseif (str_starts_with($action, 'project.')) {
        $query = $db->prepare('SELECT title FROM shared_projects WHERE id = :id');
        $query->execute(['id' => $objectId]); $details += ['objectTitle' => $query->fetchColumn() ?: ''];
    }
    return $details;
}

function genesisSharedActivity(string $userId, string $projectId, ?string $taskId, ?string $boardId, string $before = ''): array
{
    genesisSharedRequireEnabled($userId);
    genesisSharedProjectAccess($projectId, $userId, 'read', true);
    $db = genesisDb(); $values = ['project' => $projectId]; $filter = " AND e.action <> 'task.observed'";
    if ($taskId !== null) {
        $query = $db->prepare('SELECT 1 FROM shared_tasks_history_read WHERE id = :id AND project_id = :project');
        $query->execute(['id' => $taskId, 'project' => $projectId]);
        if (!$query->fetchColumn()) throw new GenesisSharedAccessException();
        $filter .= " AND (e.action LIKE 'task.%' OR e.action = 'series.instance.created') AND (e.task_id = :task OR e.object_id = :task)
            AND NOT (e.action = 'task.moved_in' AND EXISTS (SELECT 1 FROM shared_audit_events_read paired
                WHERE paired.project_id = e.project_id AND paired.object_id = e.object_id AND paired.actor_id IS e.actor_id
                AND paired.action = 'task.moved_out' AND paired.created_at = e.created_at
                AND json_extract(paired.details_json, '$.changes') = json_extract(e.details_json, '$.changes')))";
        $values['task'] = $taskId;
    }
    if ($boardId !== null) {
        $query = $db->prepare('SELECT 1 FROM shared_project_statuses WHERE id = :id AND project_id = :project');
        $query->execute(['id' => $boardId, 'project' => $projectId]);
        if (!$query->fetchColumn()) throw new GenesisSharedAccessException();
        $filter .= " AND (e.board_id = :board OR e.object_id = :board OR json_extract(e.details_json, '$.destinationBoardId') = :board)"; $values['board'] = $boardId;
    }
    if ($before !== '') {
        $query = $db->prepare('SELECT created_at FROM shared_audit_events_read WHERE id = :id AND project_id = :project');
        $query->execute(['id' => $before, 'project' => $projectId]); $time = $query->fetchColumn();
        if ($time === false) throw new InvalidArgumentException('INVALID_ACTIVITY_CURSOR');
        $filter .= ' AND (e.created_at < :time OR (e.created_at = :time AND e.id < :before))';
        $values += ['time' => $time, 'before' => $before];
    }
    $query = $db->prepare('SELECT e.id, e.action, e.object_id AS objectId, e.task_id AS taskId, e.board_id AS boardId,
        e.created_at AS createdAt, e.details_json AS detailsJson,
        COALESCE(NULLIF(u.display_name, \'\'), \'Участник GENESIS\') AS actorName
        FROM shared_audit_events_read e LEFT JOIN users u ON u.id = e.actor_id
        WHERE e.project_id = :project' . $filter . ' ORDER BY e.created_at DESC, e.id DESC LIMIT 51');
    $query->execute($values); $items = $query->fetchAll(); $hasMore = count($items) > 50;
    $items = array_map(static function ($row) use($userId,$projectId) { $row['details'] = json_decode($row['detailsJson'], true) ?: [];
        unset($row['detailsJson']); return genesisSharedSafeActivityRow($userId,$projectId,$row); }, array_slice($items, 0, 50));
    return ['events' => $items, 'nextCursor' => $hasMore ? $items[49]['id'] : null];
}
