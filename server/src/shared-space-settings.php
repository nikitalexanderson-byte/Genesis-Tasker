<?php
declare(strict_types=1);

function genesisSharedPermissionInput(mixed $input): ?array
{
    if ($input === null) return null;
    $keys = ['createProjects', 'editTasks', 'organizeTasks', 'comment', 'manageProjects', 'inviteMembers'];
    if (!is_array($input) || array_diff(array_keys($input), $keys) || array_diff($keys, array_keys($input))) {
        throw new InvalidArgumentException('INVALID_SPACE_PERMISSIONS');
    }
    foreach ($input as $value) if (!is_bool($value)) throw new InvalidArgumentException('INVALID_SPACE_PERMISSIONS');
    return $input;
}

function genesisSharedPermissions(string $spaceRole, mixed $json = null, bool $organize = false, ?string $projectRole = null, bool $projectRestricted = false): array
{
    $owner = $spaceRole === 'owner';
    $manager = in_array($spaceRole, ['owner', 'admin'], true);
    $role = $projectRole ?? ($manager ? 'manager' : ($spaceRole === 'guest' ? 'viewer' : 'member'));
    $defaults = [
        'createProjects' => $spaceRole !== 'guest',
        'editTasks' => in_array($role, ['owner', 'manager', 'member'], true),
        'organizeTasks' => $manager || in_array($role, ['owner', 'manager'], true) || ($organize && $role === 'member'),
        'comment' => in_array($role, ['owner', 'manager', 'member', 'commenter'], true),
        'manageProjects' => in_array($role, ['owner', 'manager'], true),
        'inviteMembers' => in_array($role, ['owner', 'manager'], true),
    ];
    if ($owner) return array_fill_keys(array_keys($defaults), true);
    $permissions=$json===null||$json===''?$defaults:(genesisSharedPermissionInput(json_decode((string)$json,true,512,JSON_THROW_ON_ERROR))??$defaults);
    if($projectRestricted&&!$manager){
        foreach(['createProjects','manageProjects','inviteMembers'] as $key)$permissions[$key]=false;
        if($projectRole!==null){
            $permissions['editTasks']=$permissions['editTasks']&&$projectRole==='member';
            $permissions['organizeTasks']=$permissions['organizeTasks']&&$projectRole==='member';
            $permissions['comment']=$permissions['comment']&&in_array($projectRole,['member','commenter'],true);
        }
    }
    return $permissions;
}

function genesisSharedSpacePermission(array $space, string $permission): bool
{
    return genesisSharedPermissions($space['member_role'], $space['permissions_json'] ?? null,
        (int)($space['can_organize_tasks'] ?? 0) === 1,null,(bool)($space['project_access_restricted']??false))[$permission] ?? false;
}

function genesisSharedSpaceSettings(string $userId, string $spaceId): array
{
    genesisSharedRequireEnabled($userId);
    $space = genesisSharedSpaceAccess($spaceId, $userId);
    if (!in_array($space['member_role'], ['owner', 'admin'], true)) throw new GenesisSharedAccessException('SHARED_SPACE_FORBIDDEN', 403);
    $db = genesisDb();
    $query = $db->prepare('SELECT m.user_id AS userId, m.role, m.permissions_json, m.can_organize_tasks, m.member_category_id AS categoryId,
        u.email, u.display_name AS displayName FROM shared_space_members m JOIN users u ON u.id = m.user_id
        WHERE m.space_id = :space ORDER BY m.joined_at LIMIT 200');
    $query->execute(['space' => $spaceId]);
    $members = array_map(static function (array $member): array {
        $member['permissions'] = genesisSharedPermissions($member['role'], $member['permissions_json'], (int)$member['can_organize_tasks'] === 1);
        unset($member['permissions_json'], $member['can_organize_tasks']);
        return $member;
    }, $query->fetchAll());
    $query = $db->prepare("SELECT id, email, COALESCE(NULLIF(assigned_role, ''), role) AS role, permissions_json,
        expires_at AS expiresAt FROM shared_space_invitations WHERE space_id = :space
        AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > :now ORDER BY created_at LIMIT 100");
    $query->execute(['space' => $spaceId, 'now' => genesisNow()]);
    $invitations = array_map(static function (array $invitation): array {
        $invitation['permissions'] = genesisSharedPermissions($invitation['role'], $invitation['permissions_json']);
        unset($invitation['permissions_json']); return $invitation;
    }, $query->fetchAll());
    return ['space' => ['id' => $space['id'], 'title' => $space['title'], 'description' => $space['description'],
        'revision' => (int)$space['revision'], 'role' => $space['member_role'], 'updatedAt' => $space['updated_at'],
        'projectQuota'=>genesisSharedProjectQuota(genesisSharedOwnerResourceUsage($spaceId,'shared-projects'))] + genesisSharedCoverInfo($space),
        'members' => $members, 'invitations' => $invitations];
}

function genesisSharedUpdateSpace(string $userId, string $spaceId, array $input): array
{
    genesisSharedRequireEnabled($userId);
    $title = genesisSharedTitle($input['title'] ?? null);
    $description = genesisSharedText($input['description'] ?? '', 5000);
    $expected = filter_var($input['expectedRevision'] ?? null, FILTER_VALIDATE_INT);
    if ($expected === false || $expected < 1) throw new InvalidArgumentException('EXPECTED_REVISION_REQUIRED');
    $db = genesisDb(); $db->beginTransaction();
    try {
        $space = genesisSharedSpaceAccess($spaceId, $userId);
        if (!in_array($space['member_role'], ['owner', 'admin'], true)) throw new GenesisSharedAccessException('SHARED_SPACE_FORBIDDEN', 403);
        $cover = genesisSharedCoverInput($input, $space);
        $query = $db->prepare('UPDATE shared_spaces SET title = :title, description = :description, cover_image = :image, cover_x = :x, cover_y = :y,
            revision = revision + 1, updated_at = :now WHERE id = :id AND revision = :expected');
        $query->execute(['title' => $title, 'description' => $description, 'now' => genesisNow(), 'id' => $spaceId, 'expected' => $expected] + $cover);
        if ($query->rowCount() !== 1) throw new GenesisSharedAccessException('SPACE_CONFLICT', 409);
        $db->commit(); return genesisSharedSpaceSettings($userId, $spaceId)['space'];
    } catch (Throwable $error) { if ($db->inTransaction()) $db->rollBack(); throw $error; }
}

function genesisSharedDeleteSpace(string $userId, string $spaceId, array $input): void
{
    genesisSharedRequireEnabled($userId);
    $expected = filter_var($input['expectedRevision'] ?? null, FILTER_VALIDATE_INT);
    if ($expected === false || $expected < 1) throw new InvalidArgumentException('EXPECTED_REVISION_REQUIRED');
    $db = genesisDb(); $db->beginTransaction();
    try {
        $space = genesisSharedSpaceAccess($spaceId, $userId);
        if ($space['member_role'] !== 'owner') throw new GenesisSharedAccessException('SHARED_SPACE_FORBIDDEN', 403);
        $query = $db->prepare('DELETE FROM shared_spaces WHERE id = :id AND revision = :expected');
        $query->execute(['id' => $spaceId, 'expected' => $expected]);
        if ($query->rowCount() !== 1) throw new GenesisSharedAccessException('SPACE_CONFLICT', 409);
        $db->commit();
    } catch (Throwable $error) { if ($db->inTransaction()) $db->rollBack(); throw $error; }
}

function genesisSharedRevokeSpaceInvitation(string $userId, string $spaceId, string $invitationId): void
{
    genesisSharedRequireEnabled($userId);
    $space = genesisSharedSpaceAccess($spaceId, $userId);
    if (!genesisSharedSpacePermission($space, 'inviteMembers')) throw new GenesisSharedAccessException('SHARED_SPACE_FORBIDDEN', 403);
    genesisDb()->prepare('UPDATE shared_space_invitations SET revoked_at = :now WHERE id = :id
        AND space_id = :space AND consumed_at IS NULL AND revoked_at IS NULL')->execute([
            'now' => genesisNow(), 'id' => $invitationId, 'space' => $spaceId]);
}
