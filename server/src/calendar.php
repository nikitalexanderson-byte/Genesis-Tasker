<?php
declare(strict_types=1);

/** Public astronomy only. No configuration, database, or user data is read. */
function genesisCalendarEphemeris(): array
{
    static $data;
    return $data ??= json_decode(file_get_contents(__DIR__ . '/../resources/calendar-ephemeris-v2.json'), true, 512, JSON_THROW_ON_ERROR);
}

function genesisCalendarContext(mixed $value, string $fallbackZone = 'Europe/Moscow', int $fallbackVersion = 1): array
{
    if ($value !== null && !is_array($value)) throw new InvalidArgumentException('INVALID_CALENDAR_CONTEXT');
    $version = $value['version'] ?? $fallbackVersion;
    if (!in_array($version, [1, 2], true)) throw new InvalidArgumentException('UNKNOWN_CALENDAR_VERSION');
    // Google can label a legacy UTC event GMT; explicit new contexts remain IANA-only.
    $zone = $value['timeZone'] ?? ($fallbackZone === 'GMT' ? 'UTC' : $fallbackZone);
    if (!is_string($zone) || ($zone !== 'UTC' && !preg_match('~^[A-Za-z_+\-]+(?:/[A-Za-z0-9_+\-]+)+$~', $zone))) throw new InvalidArgumentException('INVALID_CALENDAR_TIME_ZONE');
    try { new DateTimeZone($zone); } catch (Throwable) { throw new InvalidArgumentException('INVALID_CALENDAR_TIME_ZONE'); }
    $start = $value['gregorianYearStart'] ?? 'january';
    if (!in_array($start, ['january', 'march'], true)) throw new InvalidArgumentException('INVALID_CALENDAR_YEAR_START');
    return ['version' => $version, 'timeZone' => $zone, 'gregorianYearStart' => $start];
}

function genesisCalendarDate(string $value): DateTimeImmutable
{
    $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value, new DateTimeZone('UTC'));
    if (!$date || $date->format('Y-m-d') !== $value) throw new InvalidArgumentException('INVALID_CALENDAR_DATE');
    return $date;
}

function genesisCalendarAddDays(string $value, int $days): string
{
    return genesisCalendarDate($value)->modify(($days >= 0 ? '+' : '') . $days . ' days')->format('Y-m-d');
}

function genesisCalendarDayNumber(string $value): int
{
    return (int)floor(genesisCalendarDate($value)->getTimestamp() / 86400);
}

function genesisCalendarEventDate(int $milliseconds, array $context): string
{
    return (new DateTimeImmutable('@' . (int)floor($milliseconds / 1000)))
        ->setTimezone(new DateTimeZone($context['timeZone']))->format('Y-m-d');
}

function genesisCalendarEquinox(int $year): int
{
    $data = genesisCalendarEphemeris();
    $index = ($year - $data['firstSolarYear']) * 4;
    if (!isset($data['solarMoments'][$index])) throw new RangeException('CALENDAR_OUTSIDE_EPHEMERIS');
    return $data['solarMoments'][$index];
}

function genesisSacredYearStart(int $year, array $context): string
{
    $moment = genesisCalendarEquinox($year);
    return $context['version'] === 1 ? sprintf('%04d-03-20', $year) : genesisCalendarEventDate($moment, $context);
}

function genesisSacredDate(string $date, array $context): array
{
    $year = (int)genesisCalendarDate($date)->format('Y');
    if ($date < genesisSacredYearStart($year, $context)) $year--;
    $start = genesisCalendarDayNumber(genesisSacredYearStart($year, $context));
    $length = genesisCalendarDayNumber(genesisSacredYearStart($year + 1, $context)) - $start;
    $day = genesisCalendarDayNumber($date) - $start;
    return ['sacredYear' => $year, 'monthIndex' => $day < 360 ? intdiv($day, 30) : 12,
        'day' => $day < 360 ? $day % 30 + 1 : $day - 359, 'dayOfYear' => $day, 'daysInYear' => $length, 'apeironDays' => $length - 360];
}

function genesisSacredToCivil(int $year, int $month, int $day, array $context): string
{
    $start = genesisSacredYearStart($year, $context);
    $length = $month === 12 ? genesisCalendarDayNumber(genesisSacredYearStart($year + 1, $context)) - genesisCalendarDayNumber($start) - 360 : 30;
    if ($month < 0 || $month > 12 || $day < 1 || $day > $length) throw new InvalidArgumentException('INVALID_SACRED_DAY');
    return genesisCalendarAddDays($start, $month * 30 + $day - 1);
}

function genesisLunarMonthStart(int $index, array $context): string
{
    $data = genesisCalendarEphemeris();
    $offset = $index - $data['firstMoonIndex'];
    if (!isset($data['newMoons'][$offset])) throw new RangeException('CALENDAR_OUTSIDE_EPHEMERIS');
    return genesisCalendarEventDate($data['newMoons'][$offset], $context);
}

function genesisLunarYear(int $year, array $context): array
{
    $data = genesisCalendarEphemeris();
    $offset = $year - $data['firstLunarYear'];
    if (!isset($data['lunarYearStarts'][$offset], $data['lunarYearStarts'][$offset + 1])) throw new RangeException('CALENDAR_OUTSIDE_EPHEMERIS');
    $start = $data['lunarYearStarts'][$offset]; $end = $data['lunarYearStarts'][$offset + 1];
    return ['sacredYear' => $year, 'startMonthIndex' => $start, 'endMonthIndex' => $end, 'monthCount' => $end - $start,
        'start' => genesisLunarMonthStart($start, $context), 'end' => genesisLunarMonthStart($end, $context)];
}

function genesisLunarDate(string $date, array $context): array
{
    $civil = genesisCalendarDate($date);
    // Boundary years complete the first/last selectable (1900..2100) reporting years.
    if ((int)$civil->format('Y') < 1899 || (int)$civil->format('Y') > 2101) throw new RangeException('CALENDAR_OUTSIDE_EPHEMERIS');
    $year = genesisLunarYear((int)$civil->format('Y'), $context);
    if ($date < $year['start']) $year = genesisLunarYear($year['sacredYear'] - 1, $context);
    $data = genesisCalendarEphemeris(); $low = 0; $high = count($data['newMoons']) - 1;
    while ($low < $high) {
        $mid = intdiv($low + $high + 1, 2);
        if (genesisLunarMonthStart($mid + $data['firstMoonIndex'], $context) <= $date) $low = $mid; else $high = $mid - 1;
    }
    $index = $low + $data['firstMoonIndex'];
    $start = genesisCalendarDayNumber(genesisLunarMonthStart($index, $context));
    return ['year' => $year, 'monthIndex' => $index, 'monthOrdinal' => $index - $year['startMonthIndex'] + 1,
        'day' => genesisCalendarDayNumber($date) - $start + 1,
        'monthLength' => genesisCalendarDayNumber(genesisLunarMonthStart($index + 1, $context)) - $start];
}

/** Internal intervals are always half-open; exchange date keys stay Gregorian ISO. */
function genesisCalendarPeriod(string $date, string $mode, string $unit, array $context): array
{
    $civil = genesisCalendarDate($date);
    if (!in_array($unit, ['month', 'quarter', 'year'], true)) throw new InvalidArgumentException('INVALID_CALENDAR_PERIOD');
    if ($mode === 'sacred') {
        $s = genesisSacredDate($date, $context);
        if ($unit === 'year') return ['start' => genesisSacredYearStart($s['sacredYear'], $context), 'end' => genesisSacredYearStart($s['sacredYear'] + 1, $context)];
        $first = $unit === 'quarter' ? intdiv($s['monthIndex'], 3) * 3 : $s['monthIndex'];
        $next = $first + ($unit === 'quarter' ? 3 : 1);
        return ['start' => genesisSacredToCivil($s['sacredYear'], $first, 1, $context), 'end' => $next < 13 ? genesisSacredToCivil($s['sacredYear'], $next, 1, $context) : genesisSacredYearStart($s['sacredYear'] + 1, $context)];
    }
    if ($mode === 'lunar') {
        $l = genesisLunarDate($date, $context);
        if ($unit === 'year') return ['start' => $l['year']['start'], 'end' => $l['year']['end']];
        $first = $unit === 'quarter' ? $l['year']['startMonthIndex'] + intdiv($l['monthOrdinal'] - 1, 3) * 3 : $l['monthIndex'];
        return ['start' => genesisLunarMonthStart($first, $context), 'end' => genesisLunarMonthStart(min($l['year']['endMonthIndex'], $first + ($unit === 'quarter' ? 3 : 1)), $context)];
    }
    if ($mode !== 'profane') throw new InvalidArgumentException('INVALID_CALENDAR_MODE');
    $startMonth = $context['gregorianYearStart'] === 'march' ? 3 : 1;
    $year = (int)$civil->format('Y') - ((int)$civil->format('n') < $startMonth ? 1 : 0);
    $relative = ((int)$civil->format('n') - $startMonth + 12) % 12;
    $offset = $unit === 'year' ? 0 : ($unit === 'quarter' ? intdiv($relative, 3) * 3 : $relative);
    $start = genesisCalendarDate(sprintf('%04d-%02d-01', $year, $startMonth))->modify('+' . $offset . ' months');
    return ['start' => $start->format('Y-m-d'), 'end' => $start->modify('+' . ($unit === 'year' ? 12 : ($unit === 'quarter' ? 3 : 1)) . ' months')->format('Y-m-d')];
}

/** Missing wall times move by the gap; overlaps choose the earlier single instant. */
function genesisCalendarWallTime(string $date, string $time, string $zone): array
{
    genesisCalendarDate($date);
    if (!preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $time)) throw new InvalidArgumentException('INVALID_CALENDAR_DATE_TIME');
    $context = genesisCalendarContext(['version' => 2, 'timeZone' => $zone]);
    $tz = new DateTimeZone($context['timeZone']);
    $target = (new DateTimeImmutable($date . 'T' . $time . ':00Z'))->getTimestamp();
    $offsets = [];
    foreach ([-36, -12, 0, 12, 36] as $hours) $offsets[$tz->getOffset(new DateTimeImmutable('@' . ($target + $hours * 3600)))] = true;
    $expected = $date . 'T' . $time . ':00'; $exact = []; $shifted = [];
    foreach ($offsets as $offset => $_) {
        $instant = $target - $offset;
        $wall = (new DateTimeImmutable('@' . $instant))->setTimezone($tz)->format('Y-m-d\TH:i:s');
        if ($wall === $expected) $exact[] = $instant;
        if ($wall > $expected) $shifted[$wall] = $instant;
    }
    if ($exact) { sort($exact); return ['milliseconds' => $exact[0] * 1000, 'adjustment' => count($exact) > 1 ? 'overlap-earlier' : 'exact']; }
    ksort($shifted);
    if (!$shifted) throw new RangeException('UNRESOLVED_CALENDAR_DATE_TIME');
    return ['milliseconds' => reset($shifted) * 1000, 'adjustment' => 'gap-forward'];
}

function genesisCalendarWallDateTime(string $date, string $time, string $zone): DateTimeImmutable
{
    $resolved = genesisCalendarWallTime($date, $time, $zone);
    return (new DateTimeImmutable('@' . (int)($resolved['milliseconds'] / 1000)))->setTimezone(new DateTimeZone($zone));
}
