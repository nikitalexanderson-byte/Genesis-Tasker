<?php
declare(strict_types=1);
require_once __DIR__ . '/../src/calendar.php';
require_once __DIR__ . '/../src/google.php';
function calendarExpect(bool $ok, string $case): void { if (!$ok) throw new RuntimeException($case); }
$vectors = json_decode(file_get_contents(__DIR__ . '/../resources/calendar-vectors-v2.json'), true, 512, JSON_THROW_ON_ERROR);
foreach ($vectors as $v) {
    $context = genesisCalendarContext(['version' => 2, 'timeZone' => $v[0]]);
    $s = genesisSacredDate($v[1], $context); $l = genesisLunarDate($v[1], $context);
    $actual = [$s['sacredYear'], $s['monthIndex'], $s['day'], $s['apeironDays'], $l['year']['sacredYear'], $l['monthIndex'], $l['monthOrdinal'], $l['day'], $l['monthLength']];
    calendarExpect($actual === array_map('intval', array_slice($v, 2, 9)), 'web/PHP vector ' . $v[0] . ' ' . $v[1]);
    calendarExpect(genesisSacredToCivil($s['sacredYear'], $s['monthIndex'], $s['day'], $context) === $v[1], 'inverse');
}
$utc = genesisCalendarContext(['version' => 2, 'timeZone' => 'UTC']);
$march = array_merge($utc, ['gregorianYearStart' => 'march']);
calendarExpect(genesisCalendarPeriod('2024-02-29', 'profane', 'year', $march) === ['start' => '2023-03-01', 'end' => '2024-03-01'], 'March leap year');
calendarExpect(genesisCalendarPeriod('2024-01-01', 'profane', 'quarter', $march) === ['start' => '2023-12-01', 'end' => '2024-03-01'], 'March quarter');
$long = genesisLunarYear(2025, $utc);
calendarExpect($long['monthCount'] === 13 && genesisCalendarDayNumber($long['end']) - genesisCalendarDayNumber($long['start']) > 370, 'long lunar year');
calendarExpect(genesisLunarDate(genesisCalendarAddDays($long['end'], -1), $utc)['year']['sacredYear'] === 2025, 'last lunar day');
calendarExpect(genesisLunarYear(2015, $utc)['start'] === '2015-04-18', 'new moon before equinox on same day is excluded');
calendarExpect(genesisSacredYearStart(1900, $utc) === '1900-03-21', 'actual equinox');
calendarExpect(genesisSacredYearStart(1900, array_merge($utc, ['version' => 1])) === '1900-03-20', 'legacy rule');
foreach ([['2026-03-08','02:30','America/New_York','2026-03-08T07:30:00+00:00','gap-forward'],
    ['2026-11-01','01:30','America/New_York','2026-11-01T05:30:00+00:00','overlap-earlier'],
    ['2026-10-04','02:15','Australia/Lord_Howe','2026-10-03T15:45:00+00:00','gap-forward']] as $case) {
    $resolved = genesisCalendarWallTime($case[0], $case[1], $case[2]);
    calendarExpect(gmdate('c', (int)($resolved['milliseconds'] / 1000)) === $case[3] && $resolved['adjustment'] === $case[4], 'DST contract');
}
foreach ([fn() => genesisCalendarDate('2023-02-29'), fn() => genesisCalendarContext(['version'=>3]), fn() => genesisCalendarContext(['timeZone'=>'MSK'])] as $invalid) {
    $failed = false;
    try { $invalid(); } catch (InvalidArgumentException) { $failed = true; }
    calendarExpect($failed, 'invalid date/context rejected');
}
$task = ['recurrenceMode' => 'classic', 'recurrenceDates' => ['2026-03-07', '2026-03-08'],
    'recurrenceContext' => genesisCalendarContext(['version'=>2, 'timeZone'=>'America/New_York'])];
calendarExpect(genesisGoogleRecurrenceLines($task, '2026-03-07', '02:30', 'UTC') === ['RDATE:20260308T073000Z'], 'Google DST gap preserves one shifted instant in the rule zone');
calendarExpect(genesisGoogleRecurrenceLines($task, '2026-03-07', '', 'UTC') === ['RDATE;VALUE=DATE:20260308'], 'Google date-only does not shift by zone');
unset($task['recurrenceContext']);
calendarExpect(genesisGoogleRecurrenceLines($task, '2026-03-07', '02:30', 'America/New_York') === ['RDATE;TZID=America/New_York:20260308T023000'], 'Google legacy schedule unchanged');
echo 'Calendar PHP: ' . count($vectors) . " web vectors, inverses, four year contexts, long lunar year, legacy and DST passed.\n";
