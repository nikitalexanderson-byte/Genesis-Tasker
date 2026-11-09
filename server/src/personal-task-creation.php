<?php
declare(strict_types=1);

/** A recovery token grants no access. Only the already-authorized Google list is read. */
function genesisPersonalNativeIdentity(array $account, string $listId, array $raw): ?string
{
    $providerId = (string)($raw['id'] ?? '');
    if ($providerId === '') return null;
    $target = hash('sha256', (string)$account['id'] . ':' . $listId);
    $key = hash('sha256', $target . ':' . $providerId);
    $q = genesisDb()->prepare('SELECT task_id FROM personal_task_creation_targets WHERE provider_key=?');
    $q->execute([$key]);
    $known = $q->fetchColumn();
    if ($known !== false) return (string)$known;
    if (!preg_match('/^GENESIS-CREATE:([a-f0-9]{64})$/m', str_replace("\r", '', (string)($raw['notes'] ?? '')), $match)) return null;
    $q = genesisDb()->prepare('SELECT * FROM personal_task_creation_targets WHERE recovery_token=? AND target_key=? AND attempted=1');
    $q->execute([$match[1], $target]);
    $row = $q->fetch();
    if (!$row || ($row['provider_id'] !== null && $row['provider_id'] !== $providerId)) return null;
    genesisDb()->prepare('UPDATE personal_task_creation_targets SET provider_id=?,provider_key=? WHERE user_id=? AND task_id=? AND (provider_id IS NULL OR provider_id=?)')
        ->execute([$providerId, $key, $row['user_id'], $row['task_id'], $providerId]);
    // A concurrent scan may bind a copied marker first. Only the winning
    // provider ID is this task; never return the alias after a lost CAS.
    $q = genesisDb()->prepare('SELECT provider_key FROM personal_task_creation_targets WHERE user_id=? AND task_id=?');
    $q->execute([$row['user_id'], $row['task_id']]);
    return $q->fetchColumn() === $key ? (string)$row['task_id'] : null;
}

/** Google Tasks has no client-supplied ID. Never repeat an uncertain POST. */
function genesisCreatePersonalNativeTaskOnce(array $account, string $ownerId, string $id, array $task, ?callable $fetch = null): array
{
    if (!genesisGoogleScopeGranted($account, GENESIS_GOOGLE_TASKS_SCOPE)) throw new RuntimeException('Обновите доступ Google Tasks.');
    $fetch ??= 'genesisGoogleTasksApi';
    $listId = (string)$task['googleTaskListId'];
    $payload = genesisGoogleNativeTaskPayload($id, $task);
    $target = hash('sha256', (string)$account['id'] . ':' . $listId);
    $db = genesisDb();
    $db->prepare('INSERT OR IGNORE INTO personal_task_creation_targets(user_id,task_id,target_key,recovery_token) VALUES(?,?,?,?)')
        ->execute([$ownerId, $id, $target, bin2hex(random_bytes(32))]);
    $q = $db->prepare('SELECT * FROM personal_task_creation_targets WHERE user_id=? AND task_id=?');
    $q->execute([$ownerId, $id]);
    $receipt = $q->fetch();
    if (!hash_equals($receipt['target_key'], $target)) throw new GenesisResourceLimitException(409, 'TASK_CREATION_TARGET_CHANGED');
    $path = '/lists/' . rawurlencode($listId) . '/tasks';
    $raw = null;
    if ($receipt['provider_id'] !== null) {
        // A deleted source is never silently recreated by a conversion retry.
        $raw = $fetch('GET', $path . '/' . rawurlencode($receipt['provider_id']), $account);
    } elseif ((int)$receipt['attempted'] === 1) {
        $page = null; $seenPages = [];
        do {
            $query = ['maxResults'=>100, 'showCompleted'=>'true', 'showHidden'=>'true'];
            if ($page !== null) $query['pageToken'] = $page;
            $result = $fetch('GET', $path . '?' . http_build_query($query), $account);
            foreach ($result['items'] ?? [] as $candidate) {
                if (is_array($candidate) && genesisPersonalNativeIdentity($account, $listId, $candidate) === $id) {
                    if ($raw !== null && $raw['id'] !== $candidate['id']) throw new GenesisResourceLimitException(409, 'TASK_CREATION_UNCONFIRMED');
                    $raw = $candidate;
                }
            }
            $page = $result['nextPageToken'] ?? null;
            if ($page !== null && (isset($seenPages[$page]) || count($seenPages) >= 100)) throw new GenesisResourceLimitException(409, 'TASK_CREATION_UNCONFIRMED');
            if ($page !== null) $seenPages[$page] = true;
        } while ($page !== null && $page !== '');
        if ($raw === null) throw new GenesisResourceLimitException(409, 'TASK_CREATION_UNCONFIRMED');
    } else {
        $db->prepare('UPDATE personal_task_creation_targets SET attempted=1 WHERE user_id=? AND task_id=?')->execute([$ownerId, $id]);
        // The marker is hidden in GENESIS; ordinary explicit editing removes it.
        // The durable provider-ID receipt remains after that edit.
        $raw = $fetch('POST', $path, $account, [...$payload,
            'notes'=>rtrim($payload['notes']) . "\n\nGENESIS-CREATE:" . $receipt['recovery_token']]);
    }
    if (genesisPersonalNativeIdentity($account, $listId, $raw) !== $id) throw new GenesisResourceLimitException(409, 'TASK_CREATION_UNCONFIRMED');
    $saved = genesisGoogleNativeTaskForClient($raw, $listId, (string)($task['googleTaskListTitle'] ?? 'Google Tasks'));
    if ($saved === null) throw new GenesisResourceLimitException(409, 'TASK_CREATION_UNCONFIRMED');
    $saved['id'] = $id; $saved['createdIn'] = 'genesis';
    return genesisGoogleCacheWithLock($account, static function (array &$snapshot) use ($saved, $task, $id): array {
        $metadata = $task; $remaining = [];
        foreach ($snapshot['tasks']['items'] ?? [] as $existing) {
            if (($existing['googleTaskId'] ?? null) === $saved['googleTaskId'] && ($existing['googleTaskListId'] ?? null) === $saved['googleTaskListId']) {
                // An ordinary GENESIS edit after creation supersedes the old
                // conversion draft, including project, priority and range start.
                if (($existing['id'] ?? null) === $id) $metadata = $existing;
            } else $remaining[] = $existing;
        }
        $result = genesisPersonalNativeMetadata($saved, $metadata);
        $snapshot['tasks']['items'] = [...$remaining, $result];
        return $result;
    });
}
