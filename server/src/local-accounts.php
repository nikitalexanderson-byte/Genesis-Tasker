<?php
declare(strict_types=1);

/** Yandex ID accounts can share a workspace. Google remains separate. */
function genesisLocalAccountMembers(array $owner): array
{
    if (genesisUserProvider($owner) !== 'yandex') return [];
    $members = [[
        'id' => (string)$owner['id'], 'provider' => genesisUserProvider($owner),
        'email' => (string)$owner['email'], 'displayName' => (string)$owner['display_name'],
        'photoURL' => $owner['avatar_url'] ?: null, 'isPrimary' => true,
    ]];
    $query = genesisDb()->prepare('SELECT member_user_id, provider, email, display_name, avatar_url
        FROM linked_local_accounts WHERE owner_user_id = :owner ORDER BY position, created_at');
    $query->execute(['owner' => (string)$owner['id']]);
    foreach ($query->fetchAll() as $row) {
        if ($row['provider'] !== 'yandex') continue;
        $members[] = [
            'id' => (string)$row['member_user_id'], 'provider' => (string)$row['provider'],
            'email' => (string)$row['email'], 'displayName' => (string)$row['display_name'],
            'photoURL' => $row['avatar_url'] ?: null, 'isPrimary' => false,
        ];
    }
    foreach ($members as &$member) {
        $member['calendarConnected'] = $member['provider'] === 'yandex'
            && genesisYandexCalendarConnection($member['id']) !== null;
        $member['tasksConnected'] = $member['calendarConnected'];
    }
    unset($member);
    return $members;
}

function genesisLinkedLocalOwner(string $provider, string $uid): ?array
{
    $query = genesisDb()->prepare('SELECT owner_user_id FROM linked_local_accounts
        WHERE provider = :provider AND provider_uid = :uid LIMIT 1');
    $query->execute(['provider' => $provider, 'uid' => $uid]);
    $ownerId = $query->fetchColumn();
    return is_string($ownerId) ? genesisFindUser($ownerId) : null;
}

function genesisLocalMemberForOwner(string $ownerId, string $memberId): ?array
{
    $owner = genesisFindUser($ownerId);
    if ($owner === null || genesisUserProvider($owner) !== 'yandex') return null;
    foreach (genesisLocalAccountMembers($owner) as $member) {
        if (hash_equals($member['id'], $memberId)) return $member;
    }
    return null;
}

function genesisLocalProfileUid(string $provider, array $profile): string
{
    if ($provider !== 'yandex') throw new DomainException('Only Yandex accounts can be linked.');
    $uid = trim((string)($profile['id'] ?? ''));
    if ($uid === '' || strlen($uid) > 128) throw new InvalidArgumentException('Provider identity is incomplete.');
    return $uid;
}

/** Creates a separate member row so each Yandex calendar keeps its own credentials and tasks. */
function genesisCreateLocalMember(string $provider, array $profile): array
{
    $uid = genesisLocalProfileUid($provider, $profile);
    $id = genesisUuid();
    $now = genesisNow();
    $syntheticEmail = 'linked-' . str_replace('-', '', $id) . '@internal.genesis.invalid';
    $sub = $provider . ':' . hash('sha256', $uid);
    $uidColumn = 'yandex_uid';
    genesisDb()->prepare("INSERT INTO users (id, google_sub, auth_provider, $uidColumn, email,
        display_name, avatar_url, workspace_key_mode, calendar_mode, task_calendar_mode,
        week_start, login_count, last_login_at, last_seen_at, created_at, updated_at)
        VALUES (:id, :sub, :provider, :uid, :email, :name, :avatar, 'account',
        'profane', 'profane', 'monday', 0, :now, :now, :now, :now)")->execute([
            'id' => $id, 'sub' => $sub, 'provider' => $provider, 'uid' => $uid,
            'email' => $syntheticEmail,
            'name' => mb_substr(trim((string)($profile['name'] ?? '')) ?: $provider, 0, 160),
            'avatar' => isset($profile['picture']) ? mb_substr((string)$profile['picture'], 0, 1000) : null,
            'now' => $now,
        ]);
    return genesisFindUser($id) ?? throw new RuntimeException('Linked identity could not be stored.');
}

function genesisAttachLocalMember(string $ownerId, array $member, string $provider, array $profile): void
{
    $uid = genesisLocalProfileUid($provider, $profile);
    if (hash_equals($ownerId, (string)$member['id'])) return;
    $now = genesisNow();
    $position = genesisDb()->prepare('SELECT COALESCE(MAX(position), 0) + 1
        FROM linked_local_accounts WHERE owner_user_id = :owner');
    $position->execute(['owner' => $ownerId]);
    genesisDb()->prepare('INSERT INTO linked_local_accounts
        (member_user_id, owner_user_id, provider, provider_uid, email, display_name,
         avatar_url, position, created_at, updated_at)
        VALUES (:member, :owner, :provider, :uid, :email, :name, :avatar, :position, :now, :now)')->execute([
            'member' => (string)$member['id'], 'owner' => $ownerId, 'provider' => $provider,
            'uid' => $uid, 'email' => mb_strtolower(trim((string)($profile['email'] ?? ''))),
            'name' => mb_substr(trim((string)($profile['name'] ?? '')) ?: $provider, 0, 160),
            'avatar' => isset($profile['picture']) ? mb_substr((string)$profile['picture'], 0, 1000) : null,
            'position' => (int)$position->fetchColumn(), 'now' => $now,
        ]);
}

/** Called only after a fresh OAuth proof, never by matching email addresses. */
function genesisBeginLocalLink(string $ownerId, string $provider, array $profile): string
{
    $owner = genesisFindUser($ownerId);
    if ($owner === null || genesisUserProvider($owner) !== 'yandex') {
        throw new DomainException('Google and Yandex accounts cannot be linked.');
    }
    $uid = genesisLocalProfileUid($provider, $profile);
    $email = mb_strtolower(trim((string)($profile['email'] ?? '')));
    if (!genesisIsValidEmail($email)) throw new InvalidArgumentException('Provider email is invalid.');
    genesisAssertIdentityAllowed($provider . ':' . hash('sha256', $uid), $email);
    $primaryUid = (string)($owner['yandex_uid'] ?? '');
    if ($primaryUid !== '' && hash_equals($primaryUid, $uid)) return 'already';
    $linkedOwner = genesisLinkedLocalOwner($provider, $uid);
    if ($linkedOwner !== null) {
        if (hash_equals((string)$linkedOwner['id'], $ownerId)) return 'already';
        throw new DomainException('Этот аккаунт уже подключён к другому пространству GENESIS.');
    }
    $member = genesisFindUserByYandexUid($uid);
    if ($member === null) {
        $db = genesisDb();
        $ownsTransaction = !$db->inTransaction();
        if ($ownsTransaction) $db->exec('BEGIN IMMEDIATE');
        try {
            $member = genesisCreateLocalMember($provider, $profile);
            genesisAttachLocalMember($ownerId, $member, $provider, $profile);
            if ($ownsTransaction) $db->exec('COMMIT');
        } catch (Throwable $error) {
            if ($ownsTransaction && $db->inTransaction()) $db->exec('ROLLBACK');
            throw $error;
        }
        return 'linked';
    }
    if (genesisUserProvider($member) !== $provider) throw new DomainException('Account provider mismatch.');
    $hasDependents = genesisDb()->prepare('SELECT 1 FROM linked_local_accounts
        WHERE owner_user_id = :member OR member_user_id = :member LIMIT 1');
    $hasDependents->execute(['member' => (string)$member['id']]);
    if ($hasDependents->fetchColumn() !== false) {
        throw new DomainException('Сначала завершите объединение уже связанных аккаунтов.');
    }
    $_SESSION['pending_local_link'] = [
        'owner' => $ownerId, 'member' => (string)$member['id'], 'provider' => $provider,
        'profile' => $profile, 'issuedAt' => time(),
    ];
    return 'pending';
}

function genesisPendingLocalLink(string $ownerId): ?array
{
    $pending = $_SESSION['pending_local_link'] ?? null;
    if (!is_array($pending) || (string)($pending['provider'] ?? '') !== 'yandex'
        || (string)($pending['owner'] ?? '') !== $ownerId
        || (int)($pending['issuedAt'] ?? 0) < time() - 600) {
        unset($_SESSION['pending_local_link']);
        return null;
    }
    $source = genesisFindUser((string)$pending['member']);
    if ($source === null || genesisUserProvider($source) !== (string)$pending['provider']) {
        unset($_SESSION['pending_local_link']);
        return null;
    }
    $workspace = genesisWorkspaceForClient($source);
    if ($workspace['keyMode'] !== 'account') {
        throw new DomainException('Для объединения этого пространства сначала восстановите его ключ на сайте.');
    }
    return [
        'provider' => (string)$pending['provider'], 'memberId' => (string)$source['id'],
        'email' => (string)($pending['profile']['email'] ?? ''),
        'displayName' => (string)($pending['profile']['name'] ?? ''),
        'sourceWorkspace' => $workspace,
    ];
}

function genesisCommitLocalLink(string $ownerId, array $payload): array
{
    $pending = genesisPendingLocalLink($ownerId);
    if ($pending === null) throw new DomainException('Подтверждение аккаунта истекло. Повторите вход.');
    $sourceId = $pending['memberId'];
    $sourceVersion = (int)($pending['sourceWorkspace']['envelope']['version'] ?? 0);
    $expectedSourceVersion = genesisClampInt($payload['sourceVersion'] ?? -1, 0, 9_000_000_000_000_000, -1);
    if ($sourceVersion !== $expectedSourceVersion) throw new GenesisWorkspaceConflictException($sourceVersion);
    $db = genesisDb();
    $ownsTransaction = !$db->inTransaction();
    if ($ownsTransaction) $db->exec('BEGIN IMMEDIATE');
    try {
        $sourceQuery = $db->prepare('SELECT version, minimum_writer_protocol FROM workspace_blobs WHERE user_id = :id');
        $sourceQuery->execute(['id' => $sourceId]);
        $sourceBlob = $sourceQuery->fetch();
        $actualSource = $sourceBlob === false ? false : $sourceBlob['version'];
        if (($actualSource === false ? 0 : (int)$actualSource) !== $sourceVersion) {
            throw new GenesisWorkspaceConflictException($actualSource === false ? 0 : (int)$actualSource);
        }
        if ($sourceVersion > 0) {
            if (!is_array($payload['mergedWorkspace'] ?? null)) {
                throw new InvalidArgumentException('Подтвердите перенос зашифрованного пространства.');
            }
            $mergedPayload = $payload['mergedWorkspace'];
            $mergedPayload['minimumWriterProtocol'] = max((int)($mergedPayload['minimumWriterProtocol'] ?? 1), (int)($sourceBlob['minimum_writer_protocol'] ?? 1));
            genesisSaveWorkspaceEnvelope($ownerId, $mergedPayload);
        }
        $member = genesisFindUser($sourceId) ?? throw new RuntimeException('Source account disappeared.');
        genesisAttachLocalMember($ownerId, $member, $pending['provider'],
            (array)($_SESSION['pending_local_link']['profile'] ?? []));
        if ($ownsTransaction) $db->exec('COMMIT');
    } catch (Throwable $error) {
        if ($ownsTransaction && $db->inTransaction()) $db->exec('ROLLBACK');
        throw $error;
    }
    unset($_SESSION['pending_local_link']);
    return genesisFindUser($ownerId) ?? throw new RuntimeException('Owner account disappeared.');
}

function genesisLocalTasksForClient(array $owner): array
{
    $tasks = [];
    foreach (genesisLocalAccountMembers($owner) as $member) {
        $items = genesisYandexCalendarTasksForClient($member['id']);
        foreach ($items as $item) {
            $id = (string)($item['id'] ?? '');
            if ($id === '') continue;
            if (isset($tasks[$id])) {
                $tasks[$id]['syncAccountIds'][] = $member['id'];
                $tasks[$id]['syncAccountIds'] = array_values(array_unique($tasks[$id]['syncAccountIds']));
                if ((int)($item['updatedAt'] ?? 0) > (int)($tasks[$id]['updatedAt'] ?? 0)) {
                    $item['syncAccountIds'] = $tasks[$id]['syncAccountIds'];
                    $tasks[$id] = $item;
                }
            } else {
                $item['syncAccountIds'] = [$member['id']];
                $tasks[$id] = $item;
            }
        }
    }
    return array_values($tasks);
}

function genesisLocalTaskTargets(array $owner, array $task): array
{
    $members = genesisLocalAccountMembers($owner);
    $byId = [];
    foreach ($members as $member) $byId[$member['id']] = $member;
    $requested = genesisDecodeStringListJson($task['syncAccountIds'] ?? []);
    if ($requested === []) {
        $categoryId = trim((string)($task['categoryId'] ?? ''));
        if (($owner['sync_routing_mode'] ?? '') === 'category' && $categoryId !== '') {
            $categoryMap = genesisCategorySyncMap($owner['category_sync_map'] ?? '{}');
            $requested = $categoryMap[$categoryId] ?? [];
        }
    }
    if ($requested === []) {
        $requested = genesisDecodeStringListJson($owner['sync_target_account_ids'] ?? '[]');
    }
    if ($requested === []) $requested = [(string)$owner['id']];
    $targets = [];
    foreach ($requested as $id) {
        if (isset($byId[$id])) $targets[] = $byId[$id];
    }
    if ($targets === []) throw new DomainException('Не выбран доступный аккаунт для задачи.');
    return $targets;
}

function genesisSyncTaskToLocalGroup(array $owner, string $taskId, array $task): array
{
    $targets = genesisLocalTaskTargets($owner, $task);
    $saved = null;
    foreach ($targets as $member) {
        if ($member['provider'] === 'yandex' && !$member['calendarConnected']) {
            throw new DomainException('Подключите Яндекс.Календарь выбранного аккаунта.');
        }
    }
    foreach ($targets as $member) {
        $saved = genesisSyncTaskToYandex($member['id'], $taskId, $task);
    }
    $targetIds = array_column($targets, 'id');
    foreach (genesisLocalAccountMembers($owner) as $member) {
        if (in_array($member['id'], $targetIds, true)) continue;
        genesisDeleteYandexCalendarTask($member['id'], $taskId);
    }
    $saved['syncAccountIds'] = $targetIds;
    return $saved;
}

function genesisDeleteTaskFromLocalGroup(array $owner, string $taskId): void
{
    foreach (genesisLocalAccountMembers($owner) as $member) {
        genesisDeleteYandexCalendarTask($member['id'], $taskId);
    }
}
