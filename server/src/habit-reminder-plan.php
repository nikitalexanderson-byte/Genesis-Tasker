<?php
declare(strict_types=1);

/** Strict projection contract: names, bodies, notes, values and encrypted workspace data are forbidden. */
function genesisHabitReminderKeys(array $value, array $allowed): void
{
    if (array_diff(array_keys($value), $allowed)) throw new InvalidArgumentException('INVALID_HABIT_REMINDER_PLAN');
}

function genesisHabitReminderText(mixed $value, int $maximum = 256): string
{
    if (!is_string($value) || $value === '' || strlen($value) > $maximum || preg_match('/[\x00-\x1f]/', $value))
        throw new InvalidArgumentException('INVALID_HABIT_REMINDER_PLAN');
    return $value;
}

function genesisHabitReminderZone(mixed $value): string
{
    if (!is_string($value) || !in_array($value, timezone_identifiers_list(DateTimeZone::ALL_WITH_BC), true))
        throw new InvalidArgumentException('INVALID_HABIT_REMINDER_TIME_ZONE');
    return $value;
}

function genesisHabitReminderInstant(mixed $value): DateTimeImmutable
{
    if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/D', $value))
        throw new InvalidArgumentException('INVALID_HABIT_REMINDER_TIME');
    try { $instant = new DateTimeImmutable($value, new DateTimeZone('UTC')); }
    catch (Throwable) { throw new InvalidArgumentException('INVALID_HABIT_REMINDER_TIME'); }
    if ($instant->format('Y-m-d') !== substr($value, 0, 10) || $instant->format('H:i:s') !== substr($value, 11, 8))
        throw new InvalidArgumentException('INVALID_HABIT_REMINDER_TIME');
    return $instant;
}

function genesisHabitReminderDate(mixed $value): string
{
    if (!is_string($value) || !preg_match('/^(\d{4})-(\d{2})-(\d{2})$/D', $value, $parts)
        || !checkdate((int)$parts[2], (int)$parts[3], (int)$parts[1])) throw new InvalidArgumentException('INVALID_HABIT_REMINDER_DATE');
    return $value;
}

function genesisHabitReminderTime(mixed $value): string
{
    if (!is_string($value) || !preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/D', $value))
        throw new InvalidArgumentException('INVALID_HABIT_REMINDER_TIME');
    return $value;
}

function genesisHabitReminderPlan(mixed $input, ?string $now = null): array
{
    if (!is_array($input) || array_is_list($input)) throw new InvalidArgumentException('INVALID_HABIT_REMINDER_PLAN');
    genesisHabitReminderKeys($input, ['version','generatedAt','expiresAt','timeZone','tone','quietHoursStart','quietHoursEnd','rows']);
    if (($input['version'] ?? null) !== 1 || !is_array($input['rows'] ?? null) || !array_is_list($input['rows']) || count($input['rows']) > 2048)
        throw new InvalidArgumentException('INVALID_HABIT_REMINDER_PLAN');
    $generated = genesisHabitReminderInstant($input['generatedAt'] ?? null);
    $expires = genesisHabitReminderInstant($input['expiresAt'] ?? null);
    $current = genesisHabitReminderInstant($now ?? genesisNow());
    if ($generated > $current->modify('+5 minutes') || $generated < $current->modify('-46 days')
        || $expires <= $generated || $expires > $generated->modify('+45 days +1 minute'))
        throw new InvalidArgumentException('INVALID_HABIT_REMINDER_HORIZON');
    $zone = genesisHabitReminderZone($input['timeZone'] ?? null);
    $tone = $input['tone'] ?? null;
    if (!in_array($tone, ['calm','heroic','ironic'], true)) throw new InvalidArgumentException('INVALID_HABIT_REMINDER_TONE');
    $rows = []; $ids = [];
    foreach ($input['rows'] as $row) {
        if (!is_array($row) || array_is_list($row)) throw new InvalidArgumentException('INVALID_HABIT_REMINDER_PLAN');
        genesisHabitReminderKeys($row, ['id','kind','date','at','timeZone','allowDuringQuietHours','habitId','ruleId','intervalTime','localTime','action']);
        $id = genesisHabitReminderText($row['id'] ?? null, 700);
        if (isset($ids[$id])) throw new InvalidArgumentException('HABIT_REMINDER_ID_CONFLICT');
        $ids[$id] = true;
        $date = genesisHabitReminderDate($row['date'] ?? null);
        $at = genesisHabitReminderInstant($row['at'] ?? null);
        if ($at < $generated->modify('-2 hours') || $at >= $generated->modify('+45 days +1 minute')
            || !is_bool($row['allowDuringQuietHours'] ?? null)) throw new InvalidArgumentException('INVALID_HABIT_REMINDER_PLAN');
        $value = ['id'=>$id,'kind'=>$row['kind'] ?? null,'date'=>$date,'at'=>$at->format('Y-m-d\TH:i:s.v\Z'),
            'timeZone'=>genesisHabitReminderZone($row['timeZone'] ?? null),'allowDuringQuietHours'=>$row['allowDuringQuietHours']];
        if ($value['kind'] === 'habit') {
            $value['habitId'] = genesisHabitReminderText($row['habitId'] ?? null);
            $value['ruleId'] = genesisHabitReminderText($row['ruleId'] ?? null);
            if (!in_array($row['action'] ?? null, ['complete','input','interval'], true)) throw new InvalidArgumentException('INVALID_HABIT_REMINDER_PLAN');
            $value['action'] = $row['action'];
            if (isset($row['intervalTime'])) $value['intervalTime'] = genesisHabitReminderTime($row['intervalTime']);
            if (isset($row['localTime'])) throw new InvalidArgumentException('INVALID_HABIT_REMINDER_PLAN');
        } elseif ($value['kind'] === 'goal') {
            if (isset($row['habitId']) || isset($row['ruleId']) || isset($row['intervalTime']) || isset($row['action']) || $value['allowDuringQuietHours'])
                throw new InvalidArgumentException('INVALID_HABIT_REMINDER_PLAN');
            $value['localTime'] = genesisHabitReminderTime($row['localTime'] ?? null);
        } else throw new InvalidArgumentException('INVALID_HABIT_REMINDER_PLAN');
        $rows[] = $value;
    }
    usort($rows, static fn($a,$b) => strcmp($a['at'],$b['at']) ?: strcmp($a['id'],$b['id']));
    return ['version'=>1,'generatedAt'=>$generated->format('Y-m-d\TH:i:s.v\Z'),'expiresAt'=>$expires->format('Y-m-d\TH:i:s.v\Z'),
        'timeZone'=>$zone,'tone'=>$tone,'quietHoursStart'=>genesisHabitReminderTime($input['quietHoursStart'] ?? null),
        'quietHoursEnd'=>genesisHabitReminderTime($input['quietHoursEnd'] ?? null),'rows'=>$rows];
}

function genesisHabitReminderQuiet(DateTimeImmutable $at, string $zone, string $start, string $end): bool
{
    if ($start === $end) return false;
    $time = $at->setTimezone(new DateTimeZone($zone))->format('H:i');
    return $start < $end ? $time >= $start && $time < $end : $time >= $start || $time < $end;
}
