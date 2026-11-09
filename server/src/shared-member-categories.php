<?php
declare(strict_types=1);

function genesisSharedMemberCategories(string $userId, string $spaceId): array
{
    genesisSharedRequireEnabled($userId);
    genesisSharedSpaceAccess($spaceId, $userId);
    $query = genesisDb()->prepare('SELECT id, title, permissions_json, revision FROM shared_member_categories WHERE space_id = :space ORDER BY title, id');
    $query->execute(['space' => $spaceId]);
    return array_map(static function ($row) { $row['permissions'] = genesisSharedPermissionInput(json_decode($row['permissions_json'], true, 512, JSON_THROW_ON_ERROR)); unset($row['permissions_json']); return $row; }, $query->fetchAll());
}

function genesisSharedMemberCategory(string $userId, string $spaceId, array $input, ?string $id = null): array
{
    genesisSharedRequireEnabled($userId);
    $db = genesisDb(); genesisBeginWriteTransaction($db);
    try {
        $space = genesisSharedSpaceAccess($spaceId, $userId);
        if ($space['member_role'] !== 'owner') throw new GenesisSharedAccessException();
        $title = genesisSharedTitle($input['title'] ?? null, 80);
        $permissions = genesisSharedPermissionInput($input['permissions'] ?? null);
        if ($permissions === null) throw new InvalidArgumentException('INVALID_SPACE_PERMISSIONS');
        $creating = $id === null;
        $id ??= genesisUuid();
        $query = $db->prepare('SELECT * FROM shared_member_categories WHERE id = :id AND space_id = :space');
        $query->execute(['id' => $id, 'space' => $spaceId]); $existing = $query->fetch();
        if (!$creating && !$existing) throw new GenesisSharedAccessException();
        if ($existing && ($input['expectedRevision'] ?? null) !== (int)$existing['revision']) throw new GenesisSharedAccessException('CATEGORY_CONFLICT', 409);
        if (!$existing && array_key_exists('expectedRevision', $input)) throw new GenesisSharedAccessException();
        $duplicate = $db->prepare('SELECT 1 FROM shared_member_categories WHERE space_id = :space AND title = :title AND id <> :id');
        $duplicate->execute(['space' => $spaceId, 'title' => $title, 'id' => $id]);
        if ($duplicate->fetchColumn()) throw new InvalidArgumentException('Категория с таким названием уже есть.');
        $json = json_encode($permissions, JSON_THROW_ON_ERROR);
        if ($existing) $db->prepare('UPDATE shared_member_categories SET title = :title, permissions_json = :permissions, revision = revision + 1 WHERE id = :id')->execute(['title' => $title, 'permissions' => $json, 'id' => $id]);
        else $db->prepare('INSERT INTO shared_member_categories (id, space_id, title, permissions_json) VALUES (:id, :space, :title, :permissions)')->execute(['id' => $id, 'space' => $spaceId, 'title' => $title, 'permissions' => $json]);
        $members = $db->prepare("SELECT user_id FROM shared_space_members WHERE space_id = :space AND member_category_id = :category AND role <> 'owner'");
        $members->execute(['space' => $spaceId, 'category' => $id]);
        foreach ($members->fetchAll(PDO::FETCH_COLUMN) as $member) genesisSharedRevokeInvitationsByMember($member, null, $spaceId);
        $db->prepare("UPDATE shared_space_members SET permissions_json = :permissions, can_organize_tasks = :organize WHERE space_id = :space AND member_category_id = :category AND role <> 'owner'")
            ->execute(['permissions' => $json, 'organize' => (int)$permissions['organizeTasks'], 'space' => $spaceId, 'category' => $id]);
        $db->commit();
        return ['id' => $id, 'title' => $title, 'permissions' => $permissions, 'revision' => ($existing ? (int)$existing['revision'] : 0) + 1];
    } catch (Throwable $error) { if ($db->inTransaction()) $db->rollBack(); throw $error; }
}

function genesisSharedAssignMemberPermissions(string $userId, string $spaceId, string $memberId, array $input): void
{
    genesisSharedRequireEnabled($userId);
    $db = genesisDb(); genesisBeginWriteTransaction($db);
    try {
        $space = genesisSharedSpaceAccess($spaceId, $userId);
        if ($space['member_role'] !== 'owner') throw new GenesisSharedAccessException();
        $member = $db->prepare("SELECT 1 FROM shared_space_members WHERE space_id = :space AND user_id = :user AND role <> 'owner'");
        $member->execute(['space' => $spaceId, 'user' => $memberId]);
        if (!$member->fetchColumn()) throw new GenesisSharedAccessException();
        $categoryId = $input['categoryId'] ?? null;
        if ($categoryId !== null) {
            if (!is_string($categoryId)) throw new InvalidArgumentException('INVALID_MEMBER_CATEGORY');
            $category = $db->prepare('SELECT permissions_json FROM shared_member_categories WHERE id = :id AND space_id = :space');
            $category->execute(['id' => $categoryId, 'space' => $spaceId]); $json = $category->fetchColumn();
            if ($json === false) throw new InvalidArgumentException('INVALID_MEMBER_CATEGORY');
            $permissions = genesisSharedPermissionInput(json_decode($json, true, 512, JSON_THROW_ON_ERROR));
        } else {
            $permissions = genesisSharedPermissionInput($input['permissions'] ?? null);
            if ($permissions === null) throw new InvalidArgumentException('INVALID_SPACE_PERMISSIONS');
            $json = json_encode($permissions, JSON_THROW_ON_ERROR);
        }
        $db->prepare('UPDATE shared_space_members SET member_category_id = :category, permissions_json = :permissions, can_organize_tasks = :organize WHERE space_id = :space AND user_id = :user')
            ->execute(['category' => $categoryId, 'permissions' => $json, 'organize' => (int)$permissions['organizeTasks'], 'space' => $spaceId, 'user' => $memberId]);
        genesisSharedRevokeInvitationsByMember($memberId, null, $spaceId);
        $db->commit();
    } catch (Throwable $error) { if ($db->inTransaction()) $db->rollBack(); throw $error; }
}
