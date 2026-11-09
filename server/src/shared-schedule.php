<?php
declare(strict_types=1);

function genesisSharedSchedule(array $input, ?array $existing, ?string $dueDate): array
{
    $startDate = array_key_exists('startDate', $input) ? $input['startDate'] : ($existing['start_date'] ?? null);
    if ($startDate !== null && (!is_string($startDate) || !preg_match('/\A\d{4}-\d{2}-\d{2}\z/', $startDate)
        || !checkdate((int)substr($startDate, 5, 2), (int)substr($startDate, 8, 2), (int)substr($startDate, 0, 4)))) {
        throw new InvalidArgumentException('INVALID_START_DATE');
    }
    if ($startDate !== null && $dueDate !== null && $startDate > $dueDate) throw new InvalidArgumentException('INVALID_TASK_RANGE');
    $times = [];
    foreach (['startTime' => 'start_time', 'endTime' => 'end_time'] as $field => $column) {
        $value = array_key_exists($field, $input) ? $input[$field] : ($existing[$column] ?? null);
        if ($value !== null && (!is_string($value) || !preg_match('/\A(?:[01]\d|2[0-3]):[0-5]\d\z/', $value))) throw new InvalidArgumentException('INVALID_TASK_TIME');
        $times[$field] = $value;
    }
    if (($times['startTime'] === null) !== ($times['endTime'] === null)) throw new InvalidArgumentException('TASK_TIME_PAIR_REQUIRED');
    if ($times['startTime'] !== null && ($startDate ?? $dueDate) === null) throw new InvalidArgumentException('TASK_DATE_REQUIRED');
    if ($times['startTime'] !== null && ($startDate ?? $dueDate) === ($dueDate ?? $startDate) && $times['startTime'] >= $times['endTime']) throw new InvalidArgumentException('INVALID_TASK_TIME_RANGE');
    return ['startDate' => $startDate] + $times;
}

function genesisSharedDependencyIds(string $id): array
{
    $query = genesisDb()->prepare('SELECT predecessor_id FROM shared_task_dependencies WHERE task_id = :id ORDER BY predecessor_id');
    $query->execute(['id' => $id]); return $query->fetchAll(PDO::FETCH_COLUMN);
}

/** Run in the task transaction. Old clients may omit the dependency field. */
function genesisSharedAssignDependencies(string $projectId, string $id, array $input): array
{
    if (!array_key_exists('dependsOnIds', $input)) return genesisSharedDependencyIds($id);
    $ids = $input['dependsOnIds'];
    if (!is_array($ids) || !array_is_list($ids) || count($ids) > 50 || array_filter($ids, static fn($value) => !is_string($value))) throw new InvalidArgumentException('INVALID_DEPENDENCIES');
    $ids = array_values(array_unique($ids)); sort($ids);
    $db = genesisDb(); $check = $db->prepare('SELECT 1 FROM shared_tasks_read WHERE id = :id AND project_id = :project');
    foreach ($ids as $predecessor) {
        if ($predecessor === $id) throw new InvalidArgumentException('DEPENDENCY_CYCLE');
        $check->execute(['id' => $predecessor, 'project' => $projectId]);
        if (!$check->fetchColumn()) throw new InvalidArgumentException('INVALID_DEPENDENCIES');
    }
    $query = $db->prepare('SELECT d.task_id, d.predecessor_id FROM shared_task_dependencies d JOIN shared_tasks_read t ON t.id = d.task_id WHERE t.project_id = :project');
    $query->execute(['project' => $projectId]); $graph = [];
    foreach ($query->fetchAll() as $edge) $graph[$edge['task_id']][] = $edge['predecessor_id'];
    $stack = $ids; $seen = [];
    while ($stack) {
        $node = array_pop($stack);
        if ($node === $id) throw new InvalidArgumentException('DEPENDENCY_CYCLE');
        if (isset($seen[$node])) continue;
        $seen[$node] = true;
        foreach ($graph[$node] ?? [] as $next) $stack[] = $next;
    }
    $db->prepare('DELETE FROM shared_task_dependencies WHERE task_id = :id')->execute(['id' => $id]);
    $insert = $db->prepare('INSERT INTO shared_task_dependencies (task_id, predecessor_id) VALUES (:id, :predecessor)');
    foreach ($ids as $predecessor) $insert->execute(['id' => $id, 'predecessor' => $predecessor]);
    return $ids;
}

function genesisSharedDetachDependencies(string $projectId, string $taskId, string $userId): void
{
    $db = genesisDb();
    $query = $db->prepare('SELECT task_id FROM shared_task_dependencies WHERE predecessor_id = :id');
    $query->execute(['id' => $taskId]);
    foreach ($query->fetchAll(PDO::FETCH_COLUMN) as $dependent) {
        $before = genesisSharedDependencyIds($dependent);
        $db->prepare('DELETE FROM shared_task_dependencies WHERE task_id = :task AND predecessor_id = :predecessor')->execute(['task' => $dependent, 'predecessor' => $taskId]);
        $db->prepare('UPDATE shared_tasks SET revision = revision + 1, updated_by = :user, updated_at = :now WHERE id = :id')->execute(['id' => $dependent, 'user' => $userId, 'now' => genesisNow()]);
        genesisSharedAudit($projectId, $userId, 'task.updated', $dependent, ['changes' => ['dependsOnIds' => ['from' => $before, 'to' => genesisSharedDependencyIds($dependent)]]]);
    }
    $db->prepare('DELETE FROM shared_task_dependencies WHERE task_id = :id')->execute(['id' => $taskId]);
}
