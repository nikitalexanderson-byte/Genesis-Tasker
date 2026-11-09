<?php
declare(strict_types=1);

function genesisSharedLabels(string $userId, string $spaceId): array
{
    genesisSharedRequireEnabled($userId);
    genesisSharedSpaceAccess($spaceId, $userId);
    $query = genesisDb()->prepare('SELECT id, title, color, position, revision FROM shared_space_labels WHERE space_id = :space ORDER BY position, id');
    $query->execute(['space' => $spaceId]);
    return $query->fetchAll();
}

function genesisSharedLabelAccess(string $userId, string $spaceId): void
{
    genesisSharedRequireEnabled($userId);
    if (!genesisSharedSpacePermission(genesisSharedSpaceAccess($spaceId, $userId), 'manageProjects')) {
        throw new GenesisSharedAccessException('SHARED_SPACE_FORBIDDEN', 403);
    }
}

function genesisSharedSaveLabel(string $userId, string $spaceId, ?string $labelId, array $input): array
{
    genesisSharedLabelAccess($userId, $spaceId);
    $title = genesisSharedTitle($input['title'] ?? null, 40);
    $color = genesisSharedCategoryColor($input['color'] ?? '#2d6c68');
    $db = genesisDb();$ownsTransaction=!$db->inTransaction();if($ownsTransaction)genesisBeginWriteTransaction($db);
    try {
        genesisSharedLabelAccess($userId, $spaceId);
        if ($labelId !== null) {
            $query = $db->prepare('SELECT * FROM shared_space_labels WHERE id = :id AND space_id = :space');
            $query->execute(['id' => $labelId, 'space' => $spaceId]); $old = $query->fetch();
            if (!$old) throw new GenesisSharedAccessException();
            if (!is_int($input['expectedRevision'] ?? null) || $input['expectedRevision'] !== (int)$old['revision']) throw new GenesisSharedAccessException('LABEL_CONFLICT', 409);
            $query = $db->prepare('UPDATE shared_space_labels SET title = :title, color = :color, revision = revision + 1 WHERE id = :id AND revision = :revision');
            $query->execute(['title' => $title, 'color' => $color, 'id' => $labelId, 'revision' => $old['revision']]);
            if ($query->rowCount() !== 1) throw new GenesisSharedAccessException('LABEL_CONFLICT', 409);
            $position = (int)$old['position']; $revision = (int)$old['revision'] + 1;
        } else {
            $query = $db->prepare('SELECT COUNT(*) AS total, COALESCE(MAX(position), -1) AS lastPosition FROM shared_space_labels WHERE space_id = :space');
            $query->execute(['space' => $spaceId]); $summary = $query->fetch();
            if ((int)$summary['total'] >= 50) throw new GenesisSharedAccessException('LABEL_LIMIT', 409);
            $labelId = genesisUuid(); $position = (int)$summary['lastPosition'] + 1; $revision = 1;
            $db->prepare('INSERT INTO shared_space_labels (id, space_id, title, color, position) VALUES (:id, :space, :title, :color, :position)')->execute([
                'id' => $labelId, 'space' => $spaceId, 'title' => $title, 'color' => $color, 'position' => $position]);
        }
        genesisSharedLabelAudit($userId, $spaceId, isset($old) ? 'label.updated' : 'label.created', $labelId, ['objectTitle' => $title]);
        if($ownsTransaction)$db->commit();
        return ['id' => $labelId, 'title' => $title, 'color' => $color, 'position' => $position, 'revision' => $revision];
    } catch (Throwable $error) {if($ownsTransaction&&$db->inTransaction())$db->rollBack();throw $error;}
}

function genesisSharedDeleteLabel(string $userId, string $spaceId, string $labelId, array $input): void
{
    genesisSharedLabelAccess($userId, $spaceId);
    if (!is_int($input['expectedRevision'] ?? null)) throw new InvalidArgumentException('EXPECTED_REVISION_REQUIRED');
    $db = genesisDb(); $db->beginTransaction();
    try {
        genesisSharedLabelAccess($userId, $spaceId);
        $query = $db->prepare('SELECT title FROM shared_space_labels WHERE id = :id AND space_id = :space');
        $query->execute(['id' => $labelId, 'space' => $spaceId]); $title = $query->fetchColumn();
        if ($title === false) throw new GenesisSharedAccessException();
        foreach (['task' => ['shared_tasks', 'shared_task_labels', 'task_id'], 'project' => ['shared_projects', 'shared_project_labels', 'project_id']] as $kind => [$table, $links, $column]) {
            $assigned = $db->prepare("SELECT e.id" . ($kind === 'task' ? ', e.project_id AS projectId' : ', e.id AS projectId') . " FROM $table e JOIN $links l ON l.$column = e.id WHERE l.label_id = :label");
            $assigned->execute(['label' => $labelId]);
            foreach ($assigned->fetchAll() as $entity) {
                $ids = genesisSharedLabelIds($kind, $entity['id']);
                $db->prepare("UPDATE $table SET revision = revision + 1, updated_at = :now WHERE id = :id")->execute(['now' => genesisNow(), 'id' => $entity['id']]);
                genesisSharedAudit($entity['projectId'], $userId, $kind . '.updated', $entity['id'], ['changes' => ['labelIds' => ['from' => $ids, 'to' => array_values(array_diff($ids, [$labelId]))]]]);
            }
        }
        $query = $db->prepare('DELETE FROM shared_space_labels WHERE id = :id AND space_id = :space AND revision = :revision');
        $query->execute(['id' => $labelId, 'space' => $spaceId, 'revision' => $input['expectedRevision']]);
        if ($query->rowCount() !== 1) throw new GenesisSharedAccessException('LABEL_CONFLICT', 409);
        genesisSharedLabelAudit($userId, $spaceId, 'label.deleted', $labelId, ['objectTitle' => $title]);
        $db->commit();
    } catch (Throwable $error) { $db->rollBack(); throw $error; }
}

function genesisSharedLabelAudit(string $userId, string $spaceId, string $action, string $labelId, array $details): void
{
    $query = genesisDb()->prepare('SELECT id FROM shared_projects WHERE space_id = :space AND archived_at IS NULL');
    $query->execute(['space' => $spaceId]);
    foreach ($query->fetchAll(PDO::FETCH_COLUMN) as $projectId) genesisSharedAudit($projectId, $userId, $action, $labelId, $details);
}

function genesisSharedLabelIds(string $kind, string $id): array
{
    $table = $kind === 'task' ? 'shared_task_labels' : 'shared_project_labels';
    $column = $kind === 'task' ? 'task_id' : 'project_id';
    $query = genesisDb()->prepare("SELECT label_id FROM $table WHERE $column = :id ORDER BY label_id");
    $query->execute(['id' => $id]); return $query->fetchAll(PDO::FETCH_COLUMN);
}

/** Called in the entity transaction; omitted labelIds preserve assignments for old clients. */
function genesisSharedAssignLabels(string $spaceId, string $kind, string $id, array $input): array
{
    if (!array_key_exists('labelIds', $input)) return genesisSharedLabelIds($kind, $id);
    $ids = $input['labelIds'];
    if (!is_array($ids) || !array_is_list($ids) || count($ids) > 50 || array_filter($ids, static fn($value) => !is_string($value) || !preg_match('/\A[a-f0-9-]{36}\z/', $value))) throw new InvalidArgumentException('INVALID_LABELS');
    $ids = array_values(array_unique($ids)); sort($ids);
    $db = genesisDb();
    $check = $db->prepare('SELECT 1 FROM shared_space_labels WHERE id = :id AND space_id = :space');
    foreach ($ids as $labelId) {
        $check->execute(['id' => $labelId, 'space' => $spaceId]);
        if (!$check->fetchColumn()) throw new InvalidArgumentException('INVALID_LABELS');
    }
    $table = $kind === 'task' ? 'shared_task_labels' : 'shared_project_labels';
    $column = $kind === 'task' ? 'task_id' : 'project_id';
    $db->prepare("DELETE FROM $table WHERE $column = :id")->execute(['id' => $id]);
    $insert = $db->prepare("INSERT INTO $table ($column, label_id) VALUES (:id, :label)");
    foreach ($ids as $labelId) $insert->execute(['id' => $id, 'label' => $labelId]);
    return $ids;
}
