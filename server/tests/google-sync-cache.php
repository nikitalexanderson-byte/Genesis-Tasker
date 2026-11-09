<?php
declare(strict_types=1);
require dirname(__DIR__) . '/src/bootstrap.php';
require dirname(__DIR__) . '/src/repository.php';
require dirname(__DIR__) . '/src/google.php';
function cacheExpect(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
$user = ['id' => 'cache-test-a', 'google_sub' => 'synthetic-sub', 'refresh_token_enc' => 'synthetic-grant',
    'granted_scopes' => GENESIS_GOOGLE_TASKS_SCOPE . ' ' . GENESIS_GOOGLE_CALENDAR_SCOPE];
$now = time(); $calls = 0; $fullCalls = 0;
$calendar = static fn() => ['items' => [['id' => 'event-a', 'title' => 'Private event', 'googleEventId' => 'event-a']], 'syncToken' => 'synthetic-cursor'];
$tasks = function (array $state, bool $full) use (&$calls, &$fullCalls): array {
    $calls++; if ($full) $fullCalls++;
    return ['items' => [['id' => 'task-a', 'googleTaskId' => 'task-a', 'googleTaskListId' => 'list-a', 'title' => 'Private task']],
        'lists' => [['id' => 'list-a', 'title' => 'Private list', 'isDefault' => true]]];
};
$directory = genesisGoogleCacheDirectory(); $quotaPath = $directory . '/quota-tasks.json';
try {
    if (is_file($quotaPath)) unlink($quotaPath);
    genesisGoogleReadSnapshot($user, $calendar, $tasks, $now);
    for ($i = 1; $i <= 20; $i++) genesisGoogleReadSnapshot($user, $calendar, $tasks, $now + $i);
    cacheExpect($calls === 1, 'Client polls repeated Google requests.');
    $cipher = file_get_contents($directory . '/' . genesisGoogleCacheKey($user) . '.enc');
    cacheExpect(!str_contains($cipher, 'Private') && !str_contains($cipher, 'synthetic-grant'), 'Plaintext private snapshot.');
    cacheExpect(is_array(json_decode((string)genesisDecrypt($cipher), true)), 'Snapshot cannot be decrypted.');
    foreach ([['id' => 'cache-test-b'], ['_linked_account' => true]] as $different) {
        $other = genesisGoogleReadSnapshot([...$user, ...$different], static fn() => ['items' => []], static fn() => ['items' => [], 'lists' => []], $now);
        cacheExpect($other['tasks']['items'] === [], 'Snapshot leaked between accounts.');
    }
    genesisGoogleReadSnapshot($user, $calendar, $tasks, $now + 901);
    cacheExpect($calls === 2 && $fullCalls === 1, 'Incremental pull performed a full read.');
    $created = ['id' => 'created-a', 'googleTaskId' => 'created-a', 'googleTaskListId' => 'list-a', 'title' => 'Created immediately'];
    genesisGoogleSnapshotTaskSaved($user, $created);
    $written = genesisGoogleReadSnapshot($user, $calendar, $tasks, $now + 902);
    cacheExpect(count($written['tasks']['items']) === 2 && $calls === 2, 'Write caused a new Google read.');
    genesisGoogleSnapshotListSaved($user, ['id' => 'list-a', 'title' => 'Renamed']);
    $renamed = genesisGoogleReadSnapshot($user, $calendar, $tasks, $now + 903);
    cacheExpect($renamed['tasks']['items'][0]['googleTaskListTitle'] === 'Renamed', 'List rename left stale task titles.');
    genesisGoogleSnapshotTaskDeleted($user, $created, 'created-a');
    $deleted = genesisGoogleReadSnapshot($user, $calendar, $tasks, $now + 904);
    cacheExpect(count($deleted['tasks']['items']) === 1, 'Deleted task remained visible.');
    $quotaCalls = 0;
    $quotaLoader = function () use (&$quotaCalls): array { $quotaCalls++; throw new GenesisGoogleHttpException(429, 'RESOURCE_EXHAUSTED', 'Queries per day exceeded'); };
    $failed = genesisGoogleReadSnapshot($user, $calendar, $quotaLoader, $now + 1802);
    cacheExpect(count($failed['tasks']['items']) === 1 && str_contains($failed['tasks']['warning'], 'суточная квота'), 'Quota erased cached data.');
    for ($i = 0; $i < 20; $i++) genesisGoogleReadSnapshot($user, $calendar, $quotaLoader, $now + 1803 + $i);
    genesisGoogleReadSnapshot([...$user, 'id' => 'cache-test-c'], $calendar, $quotaLoader, $now + 1825);
    cacheExpect($quotaCalls === 1, 'Quota caused a retry storm across accounts.');
    // Literal UTC expectations cover Pacific midnight through both DST transitions,
    // including the two distinct occurrences of 01:30 on the 25-hour autumn day.
    foreach ([
        ['2026-01-15T18:30:00Z', '2026-01-16T08:05:00Z'],
        ['2026-03-08T08:00:00Z', '2026-03-09T07:05:00Z'],
        ['2026-03-08T09:59:59Z', '2026-03-09T07:05:00Z'],
        ['2026-03-08T10:00:00Z', '2026-03-09T07:05:00Z'],
        ['2026-11-01T07:00:00Z', '2026-11-02T08:05:00Z'],
        ['2026-11-01T08:30:00Z', '2026-11-02T08:05:00Z'],
        ['2026-11-01T09:30:00Z', '2026-11-02T08:05:00Z'],
    ] as [$at, $expectedReset]) {
        cacheExpect(genesisGoogleDailyRetryAt(strtotime($at)) === strtotime($expectedReset), 'Incorrect Pacific reset for ' . $at);
    }
    // A future reset can be 25 hours and five minutes away when clocks move back.
    cacheExpect(genesisGoogleDailyRetryAt($now) > $now && genesisGoogleDailyRetryAt($now) - $now <= 90300, 'Invalid reset time.');
    unlink($quotaPath);
    $revoked = genesisGoogleReadSnapshot([...$user, 'granted_scopes' => GENESIS_GOOGLE_CALENDAR_SCOPE], $calendar, $tasks, $now + 1826);
    cacheExpect(!isset($revoked['tasks']), 'Revoked scope served cached tasks.');
    $newGrant = [...$user, 'refresh_token_enc' => 'different-synthetic-grant'];
    genesisGoogleReadSnapshot($newGrant, $calendar, $tasks, $now + 1827);
    genesisGoogleReadSnapshot($newGrant, $calendar, $tasks, $now + 1827 + 86401);
    cacheExpect($fullCalls === 3, 'Daily reconciliation or grant isolation failed.');
    genesisGoogleSnapshotListSaved($newGrant, ['id' => 'list-a'], true);
    $removed = genesisGoogleCacheWithLock($newGrant, static fn(array &$state): array => $state);
    cacheExpect($removed['tasks']['items'] === [], 'Deleted list retained tasks.');
    echo "Google encrypted cache, isolation, immediate writes and quota backoff passed.\n";
} finally {
    if (is_file($quotaPath)) unlink($quotaPath);
    foreach ([$user, [...$user, 'id' => 'cache-test-b'], [...$user, 'id' => 'cache-test-c'], [...$user, '_linked_account' => true]] as $account) {
        foreach (['.enc', '.lock'] as $suffix) {
            $path = $directory . '/' . genesisGoogleCacheKey($account) . $suffix;
            if (is_file($path)) unlink($path);
        }
    }
}
