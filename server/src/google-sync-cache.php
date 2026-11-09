<?php
declare(strict_types=1);

const GENESIS_GOOGLE_INCREMENTAL_SECONDS = 900;
const GENESIS_GOOGLE_FULL_SYNC_SECONDS = 86400;

function genesisGoogleCacheDirectory(): string
{
    $directory = dirname((string)genesisConfig()['db_path']) . '/google-sync';
    if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
        throw new RuntimeException('Google sync storage is unavailable.');
    }
    return $directory;
}

function genesisGoogleCacheKey(array $user): string
{
    return hash('sha256', (!empty($user['_linked_account']) ? 'linked:' : 'primary:') . (string)$user['id']);
}

function genesisGoogleCacheFingerprint(array $user): string
{
    return hash('sha256', implode("\0", [(string)$user['id'], (string)($user['google_sub'] ?? ''),
        (string)($user['refresh_token_enc'] ?? ''), (string)($user['granted_scopes'] ?? '')]));
}

/** Runtime files contain authenticated ciphertext only, isolated by Google account and grant. */
function genesisGoogleCacheWithLock(array $user, callable $operation, bool $persist = true): mixed
{
    $key = genesisGoogleCacheKey($user);
    if (isset($GLOBALS['GENESIS_GOOGLE_CACHE_LOCKS'][$key])) {
        throw new LogicException('Nested Google snapshot operation.');
    }
    $path = genesisGoogleCacheDirectory() . '/' . $key;
    $lock = fopen($path . '.lock', 'c+');
    if ($lock === false || !flock($lock, LOCK_EX)) throw new RuntimeException('Google sync lock is unavailable.');
    chmod($path . '.lock', 0600);
    $GLOBALS['GENESIS_GOOGLE_CACHE_LOCKS'][$key] = true;
    try {
        $snapshot = [];
        if (is_file($path . '.enc')) {
            try { $plain = genesisDecrypt((string)file_get_contents($path . '.enc')); }
            catch (Throwable) { $plain = null; }
            $decoded = $plain !== null ? json_decode($plain, true) : null;
            if (is_array($decoded) && ($decoded['fingerprint'] ?? '') === genesisGoogleCacheFingerprint($user)) $snapshot = $decoded;
        }
        $snapshot['fingerprint'] = genesisGoogleCacheFingerprint($user);
        $result = $operation($snapshot);
        if (!$persist) return $result;
        $encoded = genesisEncrypt(json_encode($snapshot, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
        $temporary = $path . '.' . bin2hex(random_bytes(8)) . '.tmp';
        try {
            if (file_put_contents($temporary, $encoded) === false) throw new RuntimeException('Google snapshot write failed.');
            chmod($temporary, 0600);
            if (!rename($temporary, $path . '.enc')) throw new RuntimeException('Google snapshot replacement failed.');
        } finally { if (is_file($temporary)) unlink($temporary); }
        return $result;
    } finally {
        unset($GLOBALS['GENESIS_GOOGLE_CACHE_LOCKS'][$key]);
        flock($lock, LOCK_UN); fclose($lock);
    }
}

function genesisGoogleForgetSnapshot(array $user): void
{
    genesisGoogleCacheWithLock($user, static function () use ($user): void {
        $path = genesisGoogleCacheDirectory() . '/' . genesisGoogleCacheKey($user) . '.enc';
        if (is_file($path) && !unlink($path)) throw new RuntimeException('Google snapshot removal failed.');
    }, false);
}

function genesisGoogleDailyQuotaError(Throwable $error): bool
{
    return $error instanceof GenesisGoogleHttpException && in_array($error->status, [403, 429], true)
        && (str_contains($error->googleError, 'DAILY_QUOTA')
            || preg_match('/per day|dailyLimitExceeded|daily quota|суточн/ui', $error->getMessage()) === 1);
}

function genesisGoogleDailyRetryAt(int $now): int
{
    // Google daily API quotas reset at midnight Pacific, including daylight saving time.
    $date = (new DateTimeImmutable('@' . $now))->setTimezone(new DateTimeZone('America/Los_Angeles'));
    return $date->modify('tomorrow')->setTime(0, 5)->getTimestamp();
}

function genesisGoogleQuotaState(string $service): array
{
    $path = genesisGoogleCacheDirectory() . '/quota-' . $service . '.json';
    $state = is_file($path) ? json_decode((string)file_get_contents($path), true) : null;
    return is_array($state) ? $state : [];
}

function genesisGoogleQuotaWarning(string $service): string
{
    return 'Исчерпана суточная квота проекта GENESIS для Google ' . ($service === 'tasks' ? 'Tasks' : 'Calendar')
        . '. Вход в аккаунт работает. Сохранённые данные доступны; синхронизация возобновится после сброса лимита Google.';
}

function genesisGoogleQuotaCheck(string $service, ?int $now = null): void
{
    if ((int)(genesisGoogleQuotaState($service)['retryAt'] ?? 0) > ($now ?? time())) {
        throw new GenesisGoogleHttpException(429, 'GENESIS_GOOGLE_DAILY_QUOTA', genesisGoogleQuotaWarning($service));
    }
}

function genesisGoogleRecordQuotaError(string $service, Throwable $error, ?int $now = null): void
{
    if (!genesisGoogleDailyQuotaError($error)) return;
    $path = genesisGoogleCacheDirectory() . '/quota-' . $service . '.json';
    file_put_contents($path,
        json_encode(['retryAt' => genesisGoogleDailyRetryAt($now ?? time())], JSON_THROW_ON_ERROR), LOCK_EX);
    chmod($path, 0600);
}

function genesisGoogleSyncFailureMessage(Throwable $error, string $service): string
{
    if (genesisGoogleDailyQuotaError($error)) return genesisGoogleQuotaWarning($service);
    if ($error instanceof GenesisGoogleHttpException && in_array($error->status, [403, 429], true)) {
        return 'Google ' . ($service === 'tasks' ? 'Tasks' : 'Calendar') . ' временно ограничил запросы. Данные сохранены; GENESIS повторит синхронизацию позже.';
    }
    return 'Не удалось обновить Google ' . ($service === 'tasks' ? 'Tasks' : 'Calendar')
        . '. Показаны сохранённые данные. Проверьте доступ к сервису в настройках аккаунта.';
}

/** One full pull per day; bounded incremental pulls only while clients request account data. */
function genesisGoogleReadSnapshot(array $user, callable $calendarLoader, callable $tasksLoader, ?int $now = null): array
{
    $now ??= time();
    return genesisGoogleCacheWithLock($user, function (array &$snapshot) use ($user, $calendarLoader, $tasksLoader, $now): array {
        foreach (['calendar' => GENESIS_GOOGLE_CALENDAR_SCOPE, 'tasks' => GENESIS_GOOGLE_TASKS_SCOPE] as $service => $scope) {
            if (!genesisGoogleScopeGranted($user, $scope)) { unset($snapshot[$service]); continue; }
            $state = $snapshot[$service] ?? [];
            if ((int)($state['nextAttempt'] ?? 0) <= $now) {
                try {
                    genesisGoogleQuotaCheck($service, $now);
                    $full = (int)($state['fullAt'] ?? 0) + GENESIS_GOOGLE_FULL_SYNC_SECONDS <= $now;
                    $fresh = ($service === 'calendar' ? $calendarLoader : $tasksLoader)($state, $full);
                    $full = $full || !empty($fresh['fullRead']);
                    unset($fresh['fullRead']);
                    $state = [...$state, ...$fresh, 'checkedAt' => $now,
                        'fullAt' => $full ? $now : ($state['fullAt'] ?? $now),
                        'nextAttempt' => $now + GENESIS_GOOGLE_INCREMENTAL_SECONDS, 'warning' => null];
                } catch (Throwable $error) {
                    genesisGoogleRecordQuotaError($service, $error, $now);
                    $state['warning'] = genesisGoogleSyncFailureMessage($error, $service);
                    $state['nextAttempt'] = genesisGoogleDailyQuotaError($error) ? genesisGoogleDailyRetryAt($now) : $now + GENESIS_GOOGLE_INCREMENTAL_SECONDS;
                    if (!genesisGoogleDailyQuotaError($error)) genesisLogError('[GoogleSync:' . $service . '] refresh failed', $error);
                }
            }
            if ((int)(genesisGoogleQuotaState($service)['retryAt'] ?? 0) > $now) $state['warning'] = genesisGoogleQuotaWarning($service);
            $snapshot[$service] = $state;
        }
        return $snapshot;
    });
}

/** Local writes update the snapshot immediately, without triggering another full Google read. */
function genesisGoogleSnapshotTaskSaved(array $user, array $task): void
{
    genesisGoogleCacheWithLock($user, function (array &$snapshot) use ($task): void {
        $service = !empty($task['googleTaskId']) ? 'tasks' : 'calendar';
        $items = $snapshot[$service]['items'] ?? [];
        $items = array_values(array_filter($items, static fn(array $item): bool =>
            !($service === 'tasks'
                ? ($item['googleTaskId'] ?? null) === ($task['googleTaskId'] ?? null) && ($item['googleTaskListId'] ?? null) === ($task['googleTaskListId'] ?? null)
                : ($item['googleEventId'] ?? null) === ($task['googleEventId'] ?? null))));
        $items[] = $task;
        $snapshot[$service]['items'] = $items;
    });
}

function genesisGoogleSnapshotTaskDeleted(array $user, array $task, string $taskId): void
{
    genesisGoogleCacheWithLock($user, function (array &$snapshot) use ($task, $taskId): void {
        foreach (['calendar', 'tasks'] as $service) {
            $snapshot[$service]['items'] = array_values(array_filter($snapshot[$service]['items'] ?? [], static fn(array $item): bool =>
                ($item['id'] ?? '') !== $taskId && !($service === 'tasks'
                    ? !empty($task['googleTaskId']) && ($item['googleTaskId'] ?? null) === $task['googleTaskId'] && ($item['googleTaskListId'] ?? null) === ($task['googleTaskListId'] ?? null)
                    : !empty($task['googleEventId']) && ($item['googleEventId'] ?? null) === $task['googleEventId'])));
        }
    });
}

function genesisGoogleSnapshotListSaved(array $user, array $list, bool $deleted = false): void
{
    genesisGoogleCacheWithLock($user, function (array &$snapshot) use ($list, $deleted): void {
        $lists = $snapshot['tasks']['lists'] ?? [];
        $old = array_values(array_filter($lists, static fn(array $row): bool => $row['id'] === $list['id']))[0] ?? [];
        $lists = array_values(array_filter($lists, static fn(array $row): bool => $row['id'] !== $list['id']));
        if (!$deleted) $lists[] = [...$old, ...$list];
        $snapshot['tasks']['lists'] = $lists;
        $items = [];
        foreach ($snapshot['tasks']['items'] ?? [] as $task) {
            if (($task['googleTaskListId'] ?? '') === $list['id']) {
                if ($deleted) continue;
                $task['googleTaskListTitle'] = $list['title'];
            }
            $items[] = $task;
        }
        $snapshot['tasks']['items'] = $items;
    });
}
