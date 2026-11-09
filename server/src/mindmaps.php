<?php
declare(strict_types=1);
require_once __DIR__ . '/personal-task-creation.php';

/** The server validates envelopes only. Titles, graphs and references stay opaque. */
function genesisMindmapId(string $id): void
{
    if (!preg_match('/^[a-zA-Z0-9_-]{1,100}$/D', $id)) throw new InvalidArgumentException('Invalid map identifier.');
}

function genesisMindmapEnvelope(array $row): array
{
    return ['id' => $row['id'] ?? $row['map_id'], 'schemaVersion' => (int)$row['schema_version'],
        'revision' => (int)$row['revision'], 'ciphertext' => $row['ciphertext'], 'iv' => $row['iv'], 'updatedAt' => $row['updated_at']];
}

function genesisMindmaps(string $userId): array
{
    $q = genesisDb()->prepare('SELECT * FROM personal_mindmaps WHERE user_id=? ORDER BY updated_at DESC');
    $q->execute([$userId]);
    return array_map('genesisMindmapEnvelope', $q->fetchAll());
}

/** Google Calendar supports client-supplied IDs. Retry the same ID, never overwrite
 * an existing task. Native Tasks uses a durable attempt receipt and recovery scan.
 * No SQLite transaction is held across an external network call.
 */
function genesisCreatePersonalTaskOnce(array $user, string $id, array $task): array
{
    genesisMindmapId($id);
    $userId = (string)$user['id'];
    $lockPath = dirname((string)genesisConfig()['db_path']) . '/map-create-' . hash('sha256', $userId . ':' . $id) . '.lock';
    $lock = fopen($lockPath, 'c');
    if (!$lock || !flock($lock, LOCK_EX)) throw new RuntimeException('Task operation is busy.');
    try {
        if (genesisTaskWasDeleted($userId, $id, $task)) throw new DomainException('TASK_DELETED');
        if (genesisUserProvider($user) !== 'google') throw new InvalidArgumentException('Personal map creation requires Google sign-in.');
        $native = !empty($task['googleTaskListId']);
        $targets = genesisResolveTaskTargetAccounts($user, $task);
        if (!$targets) throw new InvalidArgumentException('Подключите Google Calendar перед созданием задачи.');
        // Validate before recording the attempt. Only metadata is retained here.
        $payload = $native ? genesisGoogleNativeTaskPayload($id, $task) : genesisTaskPayloadForGoogle($id, $task);
        if ($native && count($targets) !== 1) throw new InvalidArgumentException('Выберите один Google-аккаунт для списка задач.');
        $targetIds = array_column($targets, 'id'); sort($targetIds);
        $fingerprint = hash('sha256', implode(':', $targetIds) . ($native ? ':tasks:' . $task['googleTaskListId'] : ''));
        $q = genesisDb()->prepare('SELECT state FROM personal_task_creations WHERE user_id=? AND task_id=?');
        $q->execute([$userId, $id]);
        $state = $q->fetchColumn();
        if ($state !== false && !hash_equals($state, $fingerprint)) throw new GenesisResourceLimitException(409, 'Сначала восстановите создание с исходным выбором Google-аккаунтов.');
        if ($state === false) genesisDb()->prepare('INSERT INTO personal_task_creations VALUES (?,?,?)')->execute([$userId, $id, $fingerprint]);
        $savedTask = null; $links = [];
        foreach ($targets as $account) {
            if ($native) {
                $savedTask = genesisCreatePersonalNativeTaskOnce($account, $userId, $id, $task);
                $links[(string)$account['id']] = ['eventId'=>null,'taskId'=>$savedTask['googleTaskId'],
                    'taskListId'=>$savedTask['googleTaskListId'],'taskListTitle'=>$savedTask['googleTaskListTitle']];
                continue;
            }
            $account = genesisEnsureGoogleCalendar($account);
            $eventId = 'genesis' . hash('sha256', $userId . ':' . $id);
            $path = '/calendars/' . rawurlencode((string)$account['google_calendar_id']) . '/events';
            try { $event = genesisGoogleApi('GET', $path . '/' . $eventId, $account); }
            catch (GenesisGoogleHttpException $error) {
                if ($error->status !== 404) throw $error;
                try { $event = genesisGoogleApi('POST', $path, $account, [...$payload, 'id' => $eventId]); }
                catch (GenesisGoogleHttpException $createError) {
                    if ($createError->status !== 409) throw $createError;
                    $event = genesisGoogleApi('GET', $path . '/' . $eventId, $account);
                }
            }
            $saved = genesisGoogleEventForClient($event);
            if (!$saved || $saved['id'] !== $id) throw new GenesisResourceLimitException(409, 'TASK_CREATION_UNCONFIRMED');
            genesisGoogleSnapshotTaskSaved($account, $saved);
            $accountId = (string)$account['id'];
            $links[$accountId] = ['eventId' => $saved['googleEventId'], 'taskId' => null, 'taskListId' => null, 'taskListTitle' => ''];
            if (!$savedTask || $saved['updatedAt'] > $savedTask['updatedAt']) $savedTask = $saved;
        }
        if (genesisTaskWasDeleted($userId, $id, $task)) {
            // Honor an explicit concurrent task deletion, using the ordinary domain cleanup.
            // Failed conversion alone never compensates by deleting a user's task.
            genesisDeleteGoogleTaskEvent($userId, $id, [...$savedTask, 'googleLinks' => $links]);
            throw new DomainException('TASK_DELETED');
        }
        genesisTouchUser($userId);
        return [...$savedTask, 'googleLinks' => $links, 'syncAccountIds' => array_keys($links),
            'googleAccountId' => count($targets) === 1 ? (string)$targets[0]['id'] : null,
            'googleAccountEmail' => count($targets) === 1 ? (string)$targets[0]['email'] : ''];
    } finally { flock($lock, LOCK_UN); fclose($lock); }
}

function genesisMindmapHistory(string $userId, string $id): array
{
    genesisMindmapId($id);
    $q = genesisDb()->prepare('SELECT * FROM personal_mindmap_versions WHERE user_id=? AND map_id=? ORDER BY revision DESC LIMIT 20');
    $q->execute([$userId, $id]);
    return array_map('genesisMindmapEnvelope', $q->fetchAll());
}

function genesisSaveMindmap(string $userId, string $id, array $input): array
{
    genesisMindmapId($id);
    $operation = $input['operationId'] ?? '';
    if (!is_string($operation)) throw new InvalidArgumentException('Invalid operation identifier.');
    genesisMindmapId($operation);
    if (!in_array($input['schemaVersion'] ?? null, [1, 2], true) || !is_int($input['expectedRevision'] ?? null)
        || $input['expectedRevision'] < 0) throw new InvalidArgumentException('Unsupported map envelope version.');
    $ciphertext = $input['ciphertext'] ?? null;
    $iv = $input['iv'] ?? null;
    if (!is_string($ciphertext) || strlen($ciphertext) > 2_800_000 || strlen($ciphertext) < 24
        || base64_decode($ciphertext, true) === false || !is_string($iv) || strlen($iv) !== 16
        || strlen((string)base64_decode($iv, true)) !== 12) throw new InvalidArgumentException('Invalid encrypted map envelope.');
    $envelopeVersion = $input['schemaVersion'];
    $hash = hash('sha256', ($envelopeVersion === 2 ? 'v2:' : '') . $input['expectedRevision'] . ':' . $iv . ':' . $ciphertext);
    $db = genesisDb();
    $owns = !$db->inTransaction(); if ($owns) genesisBeginWriteTransaction($db);
    try {
        $q = $db->prepare('SELECT 1 FROM personal_mindmap_deletions WHERE user_id=? AND map_id=?');
        $q->execute([$userId, $id]);
        if ($q->fetchColumn()) throw new GenesisResourceLimitException(409, 'MAP_REVISION_CONFLICT');
        $q = $db->prepare('SELECT * FROM personal_mindmap_receipts WHERE user_id=? AND map_id=? AND operation_id=?');
        $q->execute([$userId, $id, $operation]);
        $receipt = $q->fetch();
        if ($receipt) {
            if (!hash_equals($receipt['payload_hash'], $hash)) throw new GenesisResourceLimitException(409, 'MAP_OPERATION_REUSED');
            if ($owns) $db->commit();
            return ['revision' => (int)$receipt['revision']];
        }
        $q = $db->prepare('SELECT revision, schema_version FROM personal_mindmaps WHERE user_id=? AND id=?');
        $q->execute([$userId, $id]);
        $current = $q->fetch();
        if (($current && (int)$current['schema_version'] > (int)($input['schemaVersion'] ?? 1))
            || (int)($current['revision'] ?? 0) !== $input['expectedRevision']) {
            throw new GenesisResourceLimitException(409, 'MAP_REVISION_CONFLICT');
        }
        $q = $db->prepare('SELECT COUNT(*) FROM personal_mindmaps WHERE user_id=?');
        $q->execute([$userId]);
        $count = (int)$q->fetchColumn();
        if (!$current) {
            genesisRequireFeatureQuota($userId,'mindmaps',$count);
            if ($count >= 200) throw new GenesisResourceLimitException(413, 'MAP_LIMIT_200');
        }
        $revision = $input['expectedRevision'] + 1;
        // The incoming version replaces snapshots outside the retention window.
        // Count the resulting history, otherwise a full account cannot rotate it.
        $q = $db->prepare('SELECT COALESCE(SUM(length(ciphertext)),0) FROM personal_mindmap_versions WHERE user_id=? AND NOT (map_id=? AND revision <= ?)');
        $q->execute([$userId, $id, $revision - 20]);
        if ((int)$q->fetchColumn() + strlen($ciphertext) > 40_000_000) throw new GenesisResourceLimitException(413, 'MAP_STORAGE_LIMIT');
        $now = genesisNow();
        $db->prepare('INSERT INTO personal_mindmaps VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET schema_version=excluded.schema_version,revision=excluded.revision,ciphertext=excluded.ciphertext,iv=excluded.iv,updated_at=excluded.updated_at')
            ->execute([$userId, $id, $envelopeVersion, $revision, $ciphertext, $iv, $now]);
        $db->prepare('INSERT INTO personal_mindmap_versions VALUES (?,?,?,?,?,?,?)')->execute([$userId, $id, $revision, $envelopeVersion, $ciphertext, $iv, $now]);
        $db->prepare('INSERT INTO personal_mindmap_receipts VALUES (?,?,?,?,?)')->execute([$userId, $id, $operation, $hash, $revision]);
        $db->prepare('DELETE FROM personal_mindmap_versions WHERE user_id=? AND map_id=? AND revision <= ?')->execute([$userId, $id, $revision - 20]);
        if ($owns) $db->commit();
        return ['revision' => $revision, 'updatedAt' => $now];
    } catch (Throwable $error) {
        if ($owns && $db->inTransaction()) $db->rollBack();
        throw $error;
    }
}

function genesisDeleteMindmap(string $userId, string $id, array $input): array
{
    genesisMindmapId($id);
    if (!is_int($input['expectedRevision'] ?? null) || $input['expectedRevision'] < 0) {
        throw new InvalidArgumentException('Invalid map revision.');
    }
    $db = genesisDb();
    genesisBeginWriteTransaction($db);
    try {
        $q = $db->prepare('SELECT 1 FROM personal_mindmap_deletions WHERE user_id=? AND map_id=?');
        $q->execute([$userId, $id]);
        if ($q->fetchColumn()) { $db->commit(); return ['deleted' => true]; }
        $q = $db->prepare('SELECT revision, schema_version FROM personal_mindmaps WHERE user_id=? AND id=?');
        $q->execute([$userId, $id]);
        $current = $q->fetch();
        if (($current && (int)$current['schema_version'] > (int)($input['schemaVersion'] ?? 1))
            || (int)($current['revision'] ?? 0) !== $input['expectedRevision']) {
            throw new GenesisResourceLimitException(409, 'MAP_REVISION_CONFLICT');
        }
        $db->prepare('INSERT INTO personal_mindmap_deletions(user_id,map_id,deleted_at) VALUES(?,?,?)')
            ->execute([$userId, $id, genesisNow()]);
        // Foreign-key cascades remove map history and save receipts. Source tasks
        // and their creation receipts are independent and remain intact.
        $db->prepare('DELETE FROM personal_mindmaps WHERE user_id=? AND id=?')->execute([$userId, $id]);
        $db->commit();
        return ['deleted' => true];
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        throw $error;
    }
}
