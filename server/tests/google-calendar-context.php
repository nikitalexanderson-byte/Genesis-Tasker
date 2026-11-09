<?php
declare(strict_types=1);
require __DIR__ . '/../src/bootstrap.php';
require __DIR__ . '/../src/repository.php';
require __DIR__ . '/../src/google.php';
function contextExpect(bool $ok, string $name): void { if (!$ok) throw new RuntimeException($name); }
// No network, user data, or database writes. Payload/client round trips use synthetic events.
foreach ([['2026-03-08', '02:30'], ['2026-11-01', '01:30'], ['2026-10-14', '23:30']] as [$date, $time]) {
    $task = ['title'=>'Synthetic DST series', 'dueDate'=>$date, 'endDate'=>$date, 'time'=>$time,
        'recurrenceMode'=>'classic', 'recurrencePattern'=>'daily', 'recurrenceDates'=>[$date],
        'recurrenceContext'=>['version'=>2, 'timeZone'=>'America/New_York', 'gregorianYearStart'=>'january']];
    $payload = genesisTaskPayloadForGoogle('synthetic-dst', $task);
    $payload['id'] = 'synthetic-google-event';
    $roundTrip = genesisGoogleEventForClient($payload);
    contextExpect($roundTrip['dueDate'] === $date && $roundTrip['time'] === $time, 'Canonical local date/time survives Google and DST');
    contextExpect($roundTrip['recurrenceContext'] === $task['recurrenceContext'], 'Own zone survives a differently zoned client');
    $payload['start']['dateTime'] = (new DateTimeImmutable($payload['start']['dateTime']))->modify('+2 hours')->format(DATE_RFC3339);
    $externalEdit = genesisGoogleEventForClient($payload);
    contextExpect($externalEdit['time'] !== $time, 'An actual external Google time edit is respected');
    $task['time'] = '';
    $allDay = genesisTaskPayloadForGoogle('synthetic-day', $task);
    $allDay['id'] = 'synthetic-google-day';
    contextExpect(genesisGoogleEventForClient($allDay)['dueDate'] === $date, 'Date-only round trip stays civil');
}
$legacy = genesisGoogleEventForClient(['id'=>'synthetic-legacy', 'start'=>['date'=>'2026-10-14', 'timeZone'=>'GMT']]);
contextExpect($legacy['recurrenceContext']['version'] === 1 && $legacy['recurrenceContext']['timeZone'] === 'UTC', 'Google legacy GMT is valid UTC');
echo "Google calendar context: canonical dates, DST round trips, external edits and legacy metadata passed.\n";
