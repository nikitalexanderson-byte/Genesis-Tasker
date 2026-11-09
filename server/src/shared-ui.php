<?php
declare(strict_types=1);

function genesisSharedUiState(string $userId, string $spaceId, ?array $input = null): array
{
    genesisSharedRequireEnabled($userId);
    genesisSharedSpaceAccess($spaceId, $userId);
    $visible = array_column(genesisSharedProjects($userId, $spaceId), 'id');
    $db = genesisDb();
    if ($input !== null) {
        $ids = $input['expandedIds'] ?? null;
        if (!is_array($ids) || !array_is_list($ids) || count($ids) > 100
            || array_filter($ids, static fn($id) => !is_string($id) || !in_array($id, $visible, true))) {
            throw new InvalidArgumentException('INVALID_SHARED_UI_STATE');
        }
        $db->prepare('INSERT INTO shared_space_ui (user_id, space_id, expanded_json, updated_at)
            VALUES (:user, :space, :expanded, :now) ON CONFLICT(user_id, space_id) DO UPDATE
            SET expanded_json = excluded.expanded_json, updated_at = excluded.updated_at')->execute([
                'user' => $userId, 'space' => $spaceId,
                'expanded' => json_encode(array_values(array_unique($ids)), JSON_THROW_ON_ERROR), 'now' => genesisNow(),
            ]);
    }
    $query = $db->prepare('SELECT expanded_json FROM shared_space_ui WHERE user_id = :user AND space_id = :space');
    $query->execute(['user' => $userId, 'space' => $spaceId]);
    $ids = json_decode($query->fetchColumn() ?: '[]', true, 512, JSON_THROW_ON_ERROR);
    return ['expandedIds' => array_values(array_intersect($ids, $visible))];
}

function genesisSharedBoardPlacement(string $userId, string $spaceId, mixed $parentId, mixed $statusId): ?string
{
    if ($statusId === null || $statusId === '') return null;
    if (!is_string($parentId) || !is_string($statusId)) throw new InvalidArgumentException('INVALID_BOARD_DESTINATION');
    $parent = genesisSharedProjectAccess($parentId, $userId, 'write');
    if ($parent['space_id'] !== $spaceId) throw new GenesisSharedAccessException();
    $query = genesisDb()->prepare('SELECT id FROM shared_project_statuses WHERE id = :id AND project_id = :project AND is_chaos=0');
    $query->execute(['id' => $statusId, 'project' => $parentId]);
    if (!$query->fetchColumn()) throw new InvalidArgumentException('INVALID_BOARD_DESTINATION');
    return $statusId;
}

function genesisSharedBoardImage(mixed $value): string
{
    if (!is_string($value) || strlen($value) > 750000) throw new InvalidArgumentException('INVALID_BOARD_IMAGE');
    if ($value === '' || preg_match('/\Adata:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+\/=]+\z/', $value)) return $value;
    if (filter_var($value, FILTER_VALIDATE_URL) && parse_url($value, PHP_URL_SCHEME) === 'https') return $value;
    throw new InvalidArgumentException('INVALID_BOARD_IMAGE');
}

function genesisSharedSpaceInvite(string $userId, string $spaceId, array $input): array
{
    genesisSharedRequireEnabled($userId);
    $space = genesisSharedSpaceAccess($spaceId, $userId);
    if (!genesisSharedSpacePermission($space, 'inviteMembers')) throw new GenesisSharedAccessException('SHARED_SPACE_FORBIDDEN', 403);
    $email = mb_strtolower(trim((string)($input['email'] ?? '')));
    if (!genesisIsValidEmail($email) || !preg_match('/@(gmail|googlemail)\.com\z/', $email)) {
        throw new InvalidArgumentException('GMAIL_ADDRESS_REQUIRED');
    }
    $role = $input['role'] ?? 'member';
    if (!in_array($role, ['admin', 'member', 'guest'], true)) throw new InvalidArgumentException('INVALID_ROLE');
    if ($role === 'admin' && $space['member_role'] !== 'owner') throw new GenesisSharedAccessException('SHARED_SPACE_FORBIDDEN', 403);
    $permissions = genesisSharedPermissionInput($input['permissions'] ?? null);
    $granted = $permissions ?? genesisSharedPermissions($role);
    $own = genesisSharedPermissions($space['member_role'], $space['permissions_json'], (int)$space['can_organize_tasks'] === 1);
    foreach ($granted as $key => $value) if ($value && !$own[$key]) throw new GenesisSharedAccessException('PERMISSION_ESCALATION', 403);
    $permissionsJson = $permissions === null ? null : json_encode($permissions, JSON_THROW_ON_ERROR);
    $db = genesisDb();
    $member = $db->prepare('SELECT 1 FROM shared_space_members m JOIN users u ON u.id = m.user_id
        WHERE m.space_id = :space AND u.email = :email COLLATE NOCASE');
    $member->execute(['space' => $spaceId, 'email' => $email]);
    if ($member->fetchColumn()) throw new InvalidArgumentException('ALREADY_SPACE_MEMBER');
    $id = genesisUuid(); $now = genesisNow(); $expires = gmdate('Y-m-d\TH:i:s\Z', time() + 7 * 86400);
    $ownsTransaction = !$db->inTransaction();
    if ($ownsTransaction) $db->beginTransaction();
    try {
        $currentSpace = genesisSharedSpaceAccess($spaceId, $userId);
        if (!genesisSharedSpacePermission($currentSpace, 'inviteMembers')) throw new GenesisSharedAccessException('SHARED_SPACE_FORBIDDEN', 403);
        $db->prepare('UPDATE shared_space_invitations SET revoked_at = :now WHERE space_id = :space
            AND email = :email COLLATE NOCASE AND consumed_at IS NULL AND revoked_at IS NULL')->execute([
                'now' => $now, 'space' => $spaceId, 'email' => $email,
            ]);
        $db->prepare('INSERT INTO shared_space_invitations (id, space_id, email, role, assigned_role, permissions_json, created_by, created_at, expires_at)
            VALUES (:id, :space, :email, :role, :assigned, :permissions, :user, :now, :expires)')->execute([
                'id' => $id, 'space' => $spaceId, 'email' => $email, 'role' => $role === 'guest' ? 'guest' : 'member', 'assigned' => $role, 'permissions' => $permissionsJson,
                'user' => $userId, 'now' => $now, 'expires' => $expires,
            ]);
        if ($ownsTransaction) $db->commit();
    } catch (Throwable $error) { if ($ownsTransaction && $db->inTransaction()) $db->rollBack(); throw $error; }
    return ['id' => $id, 'expiresAt' => $expires];
}

function genesisSharedSpaceInvitations(string $userId): array
{
    $user = genesisSharedRequireEligible($userId);
    $query = genesisDb()->prepare("SELECT i.id, COALESCE(NULLIF(i.assigned_role, ''), i.role) AS role, i.expires_at AS expiresAt,
        s.title AS spaceTitle, '' AS projectTitle, 'space' AS scope,
        COALESCE(NULLIF(u.display_name, ''), 'GENESIS') AS inviterName
        FROM shared_space_invitations i JOIN shared_spaces s ON s.id = i.space_id
        JOIN users u ON u.id = i.created_by WHERE i.email = :email COLLATE NOCASE
        AND i.consumed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > :now ORDER BY i.created_at DESC");
    $query->execute(['email' => $user['email'], 'now' => genesisNow()]);
    return $query->fetchAll();
}

function genesisSharedRespondSpaceInvitation(string $userId, string $id, bool $accept): ?array
{
    $user = genesisSharedRequireEligible($userId);
    $db = genesisDb();
    $query = $db->prepare('SELECT * FROM shared_space_invitations WHERE id = :id');
    $query->execute(['id' => $id]);
    if (!$query->fetch()) return null;
    $db->beginTransaction();
    try {
        $query->execute(['id' => $id]); $invite = $query->fetch(); $now = genesisNow();
        if (!$invite || strcasecmp($invite['email'], $user['email']) !== 0 || $invite['consumed_at']
            || $invite['revoked_at'] || $invite['expires_at'] <= $now) throw new GenesisSharedAccessException('INVITATION_UNAVAILABLE', 409);
        if ($accept) {
            $role = $invite['assigned_role'] ?: $invite['role'];
            $inviter = genesisSharedSpaceAccess($invite['space_id'], $invite['created_by']);
            $own = genesisSharedPermissions($inviter['member_role'], $inviter['permissions_json'], (int)$inviter['can_organize_tasks'] === 1);
            $granted = genesisSharedPermissions($role, $invite['permissions_json']);
            if (!$own['inviteMembers'] || ($role === 'admin' && $inviter['member_role'] !== 'owner')
                || array_filter($granted, static fn($value, $key) => $value && !$own[$key], ARRAY_FILTER_USE_BOTH)) {
                throw new GenesisSharedAccessException('INVITATION_UNAVAILABLE', 409);
            }
            $db->prepare('UPDATE users SET shared_projects_enabled = 1, updated_at = :now WHERE id = :user')
                ->execute(['now' => $now, 'user' => $userId]);
            $db->prepare("INSERT INTO shared_space_members (space_id, user_id, role, joined_at, all_projects, permissions_json)
                VALUES (:space, :user, :role, :now, 1, :permissions)
                ON CONFLICT(space_id, user_id) DO UPDATE SET all_projects = 1,
                permissions_json = COALESCE(shared_space_members.permissions_json, excluded.permissions_json),
                role = CASE WHEN shared_space_members.role IN ('owner', 'admin', 'member')
                    THEN shared_space_members.role ELSE excluded.role END")->execute([
                    'space' => $invite['space_id'], 'user' => $userId, 'role' => $role, 'now' => $now, 'permissions' => $invite['permissions_json'],
                ]);
            $db->prepare("INSERT INTO shared_project_members (project_id, user_id, role, joined_at)
                SELECT p.id, :user, :role, :now FROM shared_projects p WHERE p.space_id = :space AND p.archived_at IS NULL
                ON CONFLICT(project_id, user_id) DO UPDATE SET role = CASE
                    WHEN shared_project_members.role IN ('owner', 'manager', 'member', 'commenter')
                    THEN shared_project_members.role ELSE excluded.role END")->execute([
                    'user' => $userId, 'role' => $role === 'guest' ? 'viewer' : ($role === 'admin' ? 'manager' : 'member'),
                    'now' => $now, 'space' => $invite['space_id'],
                ]);
        }
        $field = $accept ? 'consumed_at' : 'revoked_at';
        $db->prepare("UPDATE shared_space_invitations SET {$field} = :now WHERE id = :id")->execute(['now' => $now, 'id' => $id]);
        $db->commit();
        return ['ok' => true, 'spaceId' => $invite['space_id'], 'projectId' => ''];
    } catch (Throwable $error) { $db->rollBack(); throw $error; }
}
