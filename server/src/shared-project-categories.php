<?php
declare(strict_types=1);

function genesisSharedProjectCategories(string $userId, string $spaceId): array
{
    genesisSharedRequireEnabled($userId);
    genesisSharedSpaceAccess($spaceId, $userId);
    $query = genesisDb()->prepare('SELECT id, title, color, position, revision FROM shared_space_project_categories
        WHERE space_id = :space ORDER BY position, id');
    $query->execute(['space' => $spaceId]);
    return $query->fetchAll();
}

function genesisSharedProjectCategoryAccess(string $userId, string $spaceId): void
{
    genesisSharedRequireEnabled($userId);
    if (!genesisSharedSpacePermission(genesisSharedSpaceAccess($spaceId, $userId), 'manageProjects')) {
        throw new GenesisSharedAccessException('SHARED_SPACE_FORBIDDEN', 403);
    }
}

function genesisSharedValidateProjectCategory(string $spaceId, mixed $categoryId, string $kind): ?string
{
    if ($categoryId === null || $categoryId === '') return null;
    if (!is_string($categoryId) || $kind !== 'project') throw new InvalidArgumentException('INVALID_PROJECT_CATEGORY');
    $query = genesisDb()->prepare('SELECT 1 FROM shared_space_project_categories WHERE id = :id AND space_id = :space');
    $query->execute(['id' => $categoryId, 'space' => $spaceId]);
    if (!$query->fetchColumn()) throw new InvalidArgumentException('INVALID_PROJECT_CATEGORY');
    return $categoryId;
}

function genesisSharedSaveProjectCategory(string $userId, string $spaceId, array $input, ?string $categoryId = null): array
{
    genesisSharedProjectCategoryAccess($userId, $spaceId);
    $title = genesisSharedTitle($input['title'] ?? null, 80);
    $color = genesisSharedCategoryColor($input['color'] ?? '#2d6c68');
    $db = genesisDb();
    $db->beginTransaction();
    try {
        genesisSharedProjectCategoryAccess($userId, $spaceId);
        if ($categoryId !== null) {
            $query = $db->prepare('SELECT * FROM shared_space_project_categories WHERE id = :id AND space_id = :space');
            $query->execute(['id' => $categoryId, 'space' => $spaceId]);
            $existing = $query->fetch();
            if (!$existing) throw new GenesisSharedAccessException();
            if (!is_int($input['expectedRevision'] ?? null) || $input['expectedRevision'] !== (int)$existing['revision']) {
                throw new GenesisSharedAccessException('CATEGORY_CONFLICT', 409);
            }
            $query = $db->prepare('UPDATE shared_space_project_categories SET title = :title, color = :color,
                revision = revision + 1 WHERE id = :id AND revision = :expected');
            $query->execute(['title' => $title, 'color' => $color, 'id' => $categoryId, 'expected' => $existing['revision']]);
            if ($query->rowCount() !== 1) throw new GenesisSharedAccessException('CATEGORY_CONFLICT', 409);
            $position = (int)$existing['position'];
            $revision = (int)$existing['revision'] + 1;
        } else {
            $query = $db->prepare('SELECT COUNT(*) AS total, COALESCE(MAX(position), -1) AS lastPosition
                FROM shared_space_project_categories WHERE space_id = :space');
            $query->execute(['space' => $spaceId]);
            $summary = $query->fetch();
            if ((int)$summary['total'] >= 50) throw new GenesisSharedAccessException('CATEGORY_LIMIT', 409);
            $categoryId = genesisUuid(); $position = (int)$summary['lastPosition'] + 1; $revision = 1;
            $db->prepare('INSERT INTO shared_space_project_categories (id, space_id, title, color, position)
                VALUES (:id, :space, :title, :color, :position)')->execute([
                    'id' => $categoryId, 'space' => $spaceId, 'title' => $title, 'color' => $color, 'position' => $position]);
        }
        $db->commit();
        return compact('title', 'color', 'position', 'revision') + ['id' => $categoryId];
    } catch (Throwable $error) { $db->rollBack(); throw $error; }
}

function genesisSharedDeleteProjectCategory(string $userId, string $spaceId, string $categoryId, array $input): void
{
    genesisSharedProjectCategoryAccess($userId, $spaceId);
    if (!is_int($input['expectedRevision'] ?? null)) throw new InvalidArgumentException('EXPECTED_REVISION_REQUIRED');
    $db = genesisDb(); $db->beginTransaction();
    try {
        genesisSharedProjectCategoryAccess($userId, $spaceId);
        $query = $db->prepare('SELECT revision FROM shared_space_project_categories WHERE id = :id AND space_id = :space');
        $query->execute(['id' => $categoryId, 'space' => $spaceId]);
        $revision = $query->fetchColumn();
        if ($revision === false || (int)$revision !== $input['expectedRevision']) throw new GenesisSharedAccessException('CATEGORY_CONFLICT', 409);
        $db->prepare('UPDATE shared_projects SET category_id = NULL, revision = revision + 1, updated_at = :now
            WHERE space_id = :space AND category_id = :category')->execute([
                'now' => genesisNow(), 'space' => $spaceId, 'category' => $categoryId]);
        $db->prepare('DELETE FROM shared_space_project_categories WHERE id = :id AND space_id = :space')
            ->execute(['id' => $categoryId, 'space' => $spaceId]);
        $db->commit();
    } catch (Throwable $error) { $db->rollBack(); throw $error; }
}
