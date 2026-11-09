<?php
declare(strict_types=1);
require dirname(__DIR__) . '/src/bootstrap.php';
require dirname(__DIR__) . '/src/repository.php';
require dirname(__DIR__) . '/src/google.php';
function incrementalExpect(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
$user = ['id' => 'synthetic', 'granted_scopes' => GENESIS_GOOGLE_TASKS_SCOPE . ' ' . GENESIS_GOOGLE_CALENDAR_SCOPE, 'google_calendar_id' => 'synthetic-calendar'];
$rawTask = static fn(string $id, string $title): array => ['id' => $id, 'title' => $title, 'due' => '2026-10-12T00:00:00Z'];
$previous = array_map(static fn(string $id): array => genesisGoogleNativeTaskForClient($rawTask($id, 'Before'), 'a', 'Before'), ['keep', 'changed', 'deleted', 'undated']);
$previous[] = genesisGoogleNativeTaskForClient($rawTask('removed-list-task', 'Before'), 'removed-list', 'Before');
$calls = [];
$fetchTasks = function (string $method, string $path) use (&$calls, $rawTask): array {
    incrementalExpect($method === 'GET', 'Unexpected write during incremental read.');
    parse_str((string)parse_url($path, PHP_URL_QUERY), $query); $calls[] = [$path, $query];
    if (str_starts_with($path, '/lists/new/')) {
        incrementalExpect(!isset($query['updatedMin']), 'New list was not fully fetched.');
        return ['items' => [$rawTask('new-task', 'New task')]];
    }
    incrementalExpect(($query['updatedMin'] ?? '') === '2026-10-11T12:00:00Z' && $query['showDeleted'] === 'true', 'Missing incremental cursor/deletions.');
    return isset($query['pageToken'])
        ? ['items' => [['id' => 'deleted', 'deleted' => true], ['id' => 'undated', 'title' => 'No date']]]
        : ['items' => [$rawTask('changed', 'After')], 'nextPageToken' => 'next'];
};
$items = genesisListGoogleNativeTasks($user, [['id' => 'a', 'title' => 'Renamed'], ['id' => 'new', 'title' => 'New']], $previous,
    '2026-10-11T12:00:00Z', [['id' => 'a']], $fetchTasks);
$byId = array_column($items, null, 'googleTaskId');
incrementalExpect(count($calls) === 3 && count($items) === 4, 'Pagination or list removal failed.');
incrementalExpect($byId['changed']['title'] === 'After' && $byId['keep']['googleTaskListTitle'] === 'Renamed' && isset($byId['new-task']), 'Incremental merge lost updates or unchanged tasks.');
incrementalExpect(!isset($byId['deleted']) && !isset($byId['removed-list-task']), 'Deleted task or removed list survived incremental sync.');
incrementalExpect(isset($byId['undated']) && $byId['undated']['dueDate'] === '', 'Undated task lost during incremental sync.');
$full = genesisListGoogleNativeTasks($user, [['id' => 'a', 'title' => 'A']], [], null, [], static function (string $method, string $path) use ($rawTask): array {
    parse_str((string)parse_url($path, PHP_URL_QUERY), $query);
    incrementalExpect(!isset($query['updatedMin']) && $query['showDeleted'] === 'false', 'Full read used an incremental cursor.');
    return ['items' => [$rawTask('only', 'Only current task')]];
});
incrementalExpect(count($full) === 1 && $full[0]['googleTaskId'] === 'only', 'Full reconciliation failed.');
$event = static fn(string $id): array => ['id' => $id, 'summary' => $id, 'start' => ['date' => '2026-10-12'], 'end' => ['date' => '2026-10-13']];
$previousEvents = array_map(static fn(string $id): array => genesisGoogleEventForClient($event($id)), ['keep', 'changed', 'deleted']);
$calendarCalls = 0;
$calendar = genesisLoadGoogleCalendarSnapshot($user, ['items' => $previousEvents, 'syncToken' => 'cursor'], false,
    static function (string $method, string $path) use (&$calendarCalls, $event): array {
        $calendarCalls++; parse_str((string)parse_url($path, PHP_URL_QUERY), $query);
        incrementalExpect($query['syncToken'] === 'cursor' && $query['showDeleted'] === 'true', 'Calendar cursor was lost.');
        return isset($query['pageToken']) ? ['items' => [['id' => 'deleted', 'status' => 'cancelled']], 'nextSyncToken' => 'fresh']
            : ['items' => [[...$event('changed'), 'summary' => 'Changed']], 'nextPageToken' => 'next'];
    });
$byEvent = array_column($calendar['items'], null, 'googleEventId');
incrementalExpect($calendarCalls === 2 && count($byEvent) === 2 && $byEvent['changed']['title'] === 'Changed' && isset($byEvent['keep']) && !isset($byEvent['deleted']), 'Calendar pagination/deletion failed.');
$fallbackCalls = 0;
$fallback = genesisLoadGoogleCalendarSnapshot($user, ['items' => $previousEvents, 'syncToken' => 'expired'], false,
    static function (string $method, string $path) use (&$fallbackCalls, $event): array {
        $fallbackCalls++; parse_str((string)parse_url($path, PHP_URL_QUERY), $query);
        if (isset($query['syncToken'])) throw new GenesisGoogleHttpException(410, 'fullSyncRequired', 'Cursor expired');
        return ['items' => [$event('replacement')], 'nextSyncToken' => 'replacement-cursor'];
    });
incrementalExpect($fallbackCalls === 2 && $fallback['fullRead'] && count($fallback['items']) === 1 && $fallback['items'][0]['googleEventId'] === 'replacement', 'Expired calendar cursor did not rebuild once.');
try {
    genesisLoadGoogleCalendarSnapshot($user, [], true, static fn(): array => ['items' => []]);
    throw new LogicException('Incomplete snapshot was accepted.');
} catch (RuntimeException $error) { incrementalExpect($error->getMessage() === 'Incomplete Google Calendar snapshot.', 'Unexpected incomplete snapshot error.'); }
echo "Google incremental pagination, list changes, task deletion, calendar deletion and expired cursor recovery passed.\n";
