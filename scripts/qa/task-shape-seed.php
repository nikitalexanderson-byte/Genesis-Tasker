<?php
declare(strict_types=1);

// Seed only a fresh, owned synthetic runtime; never load production configuration.
if (PHP_SAPI !== 'cli') exit(1);
$options = getopt('', ['dir:']);
$directory = str_replace('\\', '/', (string)realpath((string)($options['dir'] ?? '')));
if ($directory === '' || !is_file($directory . '/owner.json')) throw new RuntimeException('Owned fixture required');
$owner = json_decode((string)file_get_contents($directory . '/owner.json'), true, 16, JSON_THROW_ON_ERROR);
if (($owner['synthetic'] ?? false) !== true || ($owner['directory'] ?? '') !== $directory
    || !hash_equals((string)$owner['configSha256'], (string)hash_file('sha256', $directory . '/config.php')))
    throw new RuntimeException('Fixture ownership mismatch');
define('GENESIS_LOCAL_TEST_CONFIG', $directory . '/config.php');
foreach (['bootstrap', 'repository', 'google'] as $module) require_once dirname(__DIR__, 2) . '/server/src/' . $module . '.php';
$users = json_decode((string)file_get_contents($directory . '/users.json'), true, 16, JSON_THROW_ON_ERROR)['users'];
$user = genesisFindUser($users['business']['id']);
if (!$user || !str_ends_with((string)$user['email'], '@example.invalid') || genesisIsAdminUser($user) || genesisSharedTester($user))
    throw new RuntimeException('Ordinary synthetic user required');
if (genesisConfig()['db_path'] !== $directory . '/genesis.sqlite') throw new RuntimeException('Database isolation mismatch');
// This deliberately unusable grant is never sent to Google. Both HTTP and CLI disable curl/mail.
genesisDb()->prepare('UPDATE users SET refresh_token_enc = ?, granted_scopes = ? WHERE id = ?')
    ->execute([genesisEncrypt('synthetic-non-provider-grant'), GENESIS_GOOGLE_CALENDAR_SCOPE . ' ' . GENESIS_GOOGLE_TASKS_SCOPE, $user['id']]);
$user = genesisFindUser($user['id']);
$encode = static fn(array $value): string => rtrim(strtr(base64_encode(json_encode($value, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)), '+/', '-_'), '=');
$native = [];
for ($index = 0; $index < 27; $index++) {
    $dated = $index % 5 !== 0;
    $mode = ['classic', 'genesis', 'lunar'][$index % 3];
    $metadata = [
        'taskId' => 'shape-native-' . $index, 'createdIn' => 'genesis',
        'entryType' => $index % 2 ? 'event' : 'task', 'time' => $dated ? '09:45' : '',
        'startDate' => $dated && $index % 7 === 1 ? '2026-11-01' : '',
        'project' => 'Искусственный проект 🌱', 'projectId' => 'shape-project', 'categoryId' => $index % 2 ? 'shape-category' : null,
        'priority' => $index % 2 ? 1 : 10, 'tags' => ['тест', 'Unicode 日本語'], 'dependsOnIds' => $index ? ['shape-native-0'] : [],
        'calendarMode' => ['profane', 'sacred', 'lunar'][$index % 3], 'calendarNote' => "Строка 1\nСтрока 2 🌙",
        'recurrenceMode' => $index % 4 ? $mode : 'none',
        'recurrencePattern' => $index % 4 ? ['daily', 'pyata-days', 'lunar-days'][$index % 3] : 'none',
        'recurrenceInterval' => $index % 3 + 1, 'recurrenceDays' => [1, 7, 20],
        'recurrenceMonths' => [1, 12], 'recurrencePyatas' => [1, 6],
        'recurrenceStartDate' => '2026-11-01', 'recurrenceEndDate' => '2027-11-01',
        'recurrenceSeriesId' => $index % 4 ? 'shape-series-' . $index : null,
    ];
    $raw = ['id' => 'synthetic-google-task-' . $index, 'title' => $index === 26 ? '' : "Синтетическая задача $index — 日本語 📅",
        'notes' => "Искусственные данные; не данные пользователя.\nВторая строка.\nGENESIS-DATA:" . $encode($metadata),
        'due' => $dated ? '2026-11-03T00:00:00.000Z' : '', 'updated' => '2026-11-03T12:00:00Z',
        'status' => $index < 7 ? 'needsAction' : 'completed'];
    if ($index >= 7) $raw['completed'] = '2026-11-03T12:00:00Z';
    $task = genesisGoogleNativeTaskForClient($raw, 'shape-list', 'Синтетический список');
    if ($task === null) throw new RuntimeException('Valid synthetic task was rejected');
    $native[] = $task;
}
$calendar = [];
for ($index = 0; $index < 12; $index++) {
    $private = ['genesisTaskId' => $index < 3 ? str_repeat('x', 98) . sprintf('%02d', $index) : 'shape-calendar-' . $index,
        'genesisSource' => $index < 3 ? 'google-calendar' : 'genesis', 'genesisDone' => '1',
        'genesisCompletedAt' => '2026-11-03T12:00:00Z', 'genesisProjectId' => 'shape-project',
        'genesisTags' => $encode(['календарь', '🌓']), 'genesisDependsOn' => $encode(['shape-native-0']),
        'genesisPriority' => '8', 'genesisCalendarMode' => ['profane', 'sacred', 'lunar'][$index % 3],
        'genesisCalendarNote' => base64_encode('Искусственная заметка 🌙'), 'genesisCycleMode' => 'classic', 'genesisCyclePattern' => 'weekdays',
        'genesisCycleDays' => $encode([1, 3, 5]), 'genesisCycleStart' => '2026-11-01', 'genesisCycleEnd' => '2027-11-01',
        'genesisExcludedDates' => $encode(['2026-11-09']), 'genesisSeriesId' => 'shape-calendar-series-' . $index];
    $event = ['id' => 'synthetic-google-event-' . $index, 'summary' => '✓ Синтетическое событие ' . $index,
        'description' => "Проверка текущего формата API.\nИскусственный текст 🪷", 'status' => 'confirmed',
        'updated' => '2026-11-03T12:00:00Z', 'extendedProperties' => ['private' => $private],
        'reminders' => ['useDefault' => false, 'overrides' => [['method' => 'popup', 'minutes' => 10], ['method' => 'popup', 'minutes' => 60]]]];
    if ($index % 2) {
        $event['start'] = ['dateTime' => '2026-11-03T23:45:00+03:00', 'timeZone' => 'Europe/Moscow'];
        $event['end'] = ['dateTime' => '2026-11-04T01:15:00+03:00', 'timeZone' => 'Europe/Moscow'];
        $event['extendedProperties']['private']['genesisEndTime'] = '01:15';
    } else {
        $event['start'] = ['date' => '2026-11-03']; $event['end'] = ['date' => '2026-11-06'];
    }
    $task = genesisGoogleEventForClient($event);
    if ($task === null) throw new RuntimeException('Valid synthetic calendar event was rejected');
    $calendar[] = $task;
}
if (genesisGoogleNativeTaskForClient(['id' => 'deleted-sentinel', 'deleted' => true], 'shape-list', 'Synthetic') !== null
    || genesisGoogleEventForClient(['id' => 'cancelled-sentinel', 'status' => 'cancelled']) !== null)
    throw new RuntimeException('Deleted/cancelled sentinel leaked through production normalization');
genesisGoogleReadSnapshot($user,
    static fn(): array => ['items' => $calendar, 'syncToken' => 'synthetic-only'],
    static fn(): array => ['items' => $native, 'lists' => [['id' => 'shape-list', 'title' => 'Синтетический список', 'isDefault' => true]]]);
session_write_close();
echo json_encode(['synthetic' => true, 'expectedRows' => 39, 'nativeRows' => 27, 'calendarRows' => 12,
    'openRows' => 7, 'longIdRows' => 3, 'normalization' => 'production Google Tasks/Calendar normalizers and encrypted snapshot cache'], JSON_THROW_ON_ERROR) . "\n";
