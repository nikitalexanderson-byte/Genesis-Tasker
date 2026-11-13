<?php
declare(strict_types=1);

/** Weekly quotas use the configured server zone, never a browser-supplied zone/date. */
function genesisTimelinePeriod(): array
{
    $now = new DateTimeImmutable('now', new DateTimeZone((string)(genesisConfig()['timezone'] ?? 'Europe/Moscow')));
    return [$now->modify('-' . ((int)$now->format('N') - 1) . ' days')->format('Y-m-d'), $now->format('Y-m-d')];
}

function genesisTimelineSession(string $userId): ?array
{
    $q = genesisDb()->prepare('SELECT * FROM stoicheion_timeline_sessions WHERE user_id=? AND period_key=?');
    $q->execute([$userId, genesisTimelinePeriod()[0]]);
    return $q->fetch() ?: null;
}

/** Unsigned JS Math.imul parity without overflowing signed 64-bit PHP integers. */
function genesisTimelineImul(int $a, int $b): int
{
    return (($a & 65535) * ($b & 65535) + ((($a >> 16) * ($b & 65535) + ($a & 65535) * ($b >> 16)) << 16)) & 0xffffffff;
}

function genesisTimelineRandom(int &$value): int
{
    $value = ($value + 0x6d2b79f5) & 0xffffffff;
    $mixed = genesisTimelineImul($value ^ ($value >> 15), $value | 1);
    $mixed ^= ($mixed + genesisTimelineImul($mixed ^ ($mixed >> 7), $mixed | 61)) & 0xffffffff;
    return ($mixed ^ ($mixed >> 14)) & 0xffffffff;
}

/** Exact existing web/native deal, including orientation and unique letters. */
function genesisTimelineCards(int $seed): array
{
    $pool = range(0, 23); $state = $seed ^ 0xa511e9b3;
    for ($i = 23; $i > 0; $i--) {
        $swap = intdiv(genesisTimelineRandom($state) * ($i + 1), 4294967296);
        [$pool[$i], $pool[$swap]] = [$pool[$swap], $pool[$i]];
    }
    $result = [];
    for ($i = 0; $i < 3; $i++) {
        $state = $seed ^ genesisTimelineImul($i + 2, 0x27d4eb2d);
        $result[] = ['letter' => $pool[$i], 'reversed' => genesisTimelineRandom($state) < 2147483648];
    }
    return $result;
}

/** Sample a new server seed conditioned on keeping both other cards identical.
 * Retaining a single compatible seed also keeps existing native readers in sync.
 */
function genesisTimelineRerollSeed(int $seed, int $position): int
{
    $held = genesisTimelineCards($seed);
    for ($attempt = 0; $attempt < 100000; $attempt++) {
        $candidate = random_int(0, 4294967295);
        $cards = genesisTimelineCards($candidate);
        if ($cards[$position]['letter'] === $held[$position]['letter']) continue;
        foreach ([0, 1, 2] as $i) if ($i !== $position && $cards[$i] !== $held[$i]) continue 2;
        return $candidate;
    }
    throw new RuntimeException('TIMELINE_RANDOM_UNAVAILABLE');
}

function genesisTimelineWindows(array $session): array
{
    $q = genesisDb()->prepare('SELECT * FROM stoicheion_timeline_card_windows WHERE user_id=? AND period_key=? ORDER BY position');
    $q->execute([$session['user_id'], $session['period_key']]);
    return $q->fetchAll();
}

function genesisTimelineForClient(?array $session): array
{
    $instant = time();
    if (!$session) return ['timeline' => null, 'serverNow' => gmdate('Y-m-d\TH:i:s\Z', $instant)];
    $cards = [];
    foreach (genesisTimelineWindows($session) as $row) {
        $first = strtotime($row['first_revealed_at']);
        // Invalid historical timestamps fail closed rather than creating a fresh window.
        $deadline = $first === false ? 0 : $first + 180;
        $remaining = $row['rerolled_at'] === null ? max(0, $deadline - $instant) : 0;
        $cards[] = ['position' => (int)$row['position'], 'firstRevealedAt' => $row['first_revealed_at'],
            'rerollDeadline' => gmdate('Y-m-d\TH:i:s\Z', $deadline), 'remainingSeconds' => $remaining,
            'canReroll' => $remaining > 0, 'rerolled' => $row['rerolled_at'] !== null];
    }
    return ['serverNow' => gmdate('Y-m-d\TH:i:s\Z', $instant), 'timeline' => [
        'dayKey' => $session['source_day_key'], 'periodKey' => $session['period_key'],
        'seed' => (int)$session['seed_value'], 'revision' => (int)$session['revision'],
        'firstDrawAt' => $session['created_at'], 'cards' => $cards,
    ]];
}

/** Called under the write lock: keep every existing weekly deal and its original deadline. */
function genesisTimelineImportLegacy(string $userId): ?array
{
    if ($session = genesisTimelineSession($userId)) return $session;
    [$week, $day] = genesisTimelinePeriod();
    $db = genesisDb();
    $q = $db->prepare("SELECT * FROM stoicheion_timeline_draws WHERE user_id=? AND day_key>=? AND day_key<=? ORDER BY day_key DESC LIMIT 1");
    $q->execute([$userId, $week, $day]);
    if (!$legacy = $q->fetch()) return null;
    $db->prepare('INSERT INTO stoicheion_timeline_sessions VALUES(?,?,?,?,1,?,?)')->execute([
        $userId, $week, $legacy['day_key'], $legacy['seed_value'], $legacy['first_draw_at'], $legacy['updated_at']]);
    $insert = $db->prepare('INSERT INTO stoicheion_timeline_card_windows VALUES(?,?,?,?,?)');
    foreach ([0, 1, 2] as $i) $insert->execute([$userId, $week, $i, $legacy['first_draw_at'],
        (int)$legacy['attempt_count'] >= 2 ? $legacy['updated_at'] : null]);
    return genesisTimelineSession($userId);
}

function genesisLoadTimelineCards(string $userId): array
{
    $db = genesisDb(); $db->exec('BEGIN IMMEDIATE');
    try {
        $result = genesisTimelineForClient(genesisTimelineImportLegacy($userId));
        $db->exec('COMMIT'); return $result;
    } catch (Throwable $error) { $db->exec('ROLLBACK'); throw $error; }
}

function genesisChangeTimelineCard(string $userId, array $payload): array
{
    if (array_diff(array_keys($payload), ['position', 'action', 'revision'])
        || !is_int($payload['position'] ?? null) || $payload['position'] < 0 || $payload['position'] > 2
        || !in_array($payload['action'] ?? null, ['reveal', 'reroll'], true)
        || !is_int($payload['revision'] ?? null) || $payload['revision'] < 0) throw new InvalidArgumentException('TIMELINE_REQUEST_INVALID');
    $db = genesisDb(); $db->exec('BEGIN IMMEDIATE');
    try {
        $user = genesisFindUser($userId);
        if (!$user || !empty($user['stoicheion_divination_disabled'])) throw new DomainException('TIMELINE_DISABLED');
        $position = $payload['position']; $action = $payload['action'];
        $session = genesisTimelineImportLegacy($userId);
        $windows = $session ? genesisTimelineWindows($session) : [];
        // A repeated first-reveal request is idempotent and never extends its timer.
        if ($action === 'reveal' && isset($windows[$position])) {
            $result = genesisTimelineForClient($session); $db->exec('COMMIT'); return $result;
        }
        if ($payload['revision'] !== (int)($session['revision'] ?? 0)) throw new DomainException('TIMELINE_STALE');
        if ($action === 'reveal' && $position !== count($windows)) throw new DomainException('TIMELINE_ORDER');
        $now = genesisNow(); [$week, $day] = genesisTimelinePeriod();
        if (!$session) {
            if ($action !== 'reveal' || $position !== 0) throw new DomainException('TIMELINE_ORDER');
            $seed = random_int(0, 4294967295);
            $db->prepare('INSERT INTO stoicheion_timeline_sessions VALUES(?,?,?,?,0,?,?)')->execute([$userId, $week, $day, $seed, $now, $now]);
            $db->prepare("INSERT INTO stoicheion_timeline_draws VALUES(?,?,'timeline',?,1,?,?)")->execute([$userId, $day, $seed, $now, $now]);
            $session = genesisTimelineSession($userId);
        }
        if ($action === 'reveal') {
            $db->prepare('INSERT INTO stoicheion_timeline_card_windows VALUES(?,?,?,?,NULL)')->execute([$userId, $week, $position, $now]);
        } else {
            $window = $windows[$position] ?? null;
            $first = $window ? strtotime($window['first_revealed_at']) : false;
            if (!$window) throw new DomainException('TIMELINE_ORDER');
            if ($window['rerolled_at'] !== null) throw new DomainException('TIMELINE_REROLL_USED');
            if ($first === false || time() >= $first + 180) throw new DomainException('TIMELINE_REROLL_EXPIRED');
            $seed = genesisTimelineRerollSeed((int)$session['seed_value'], $position);
            $db->prepare('UPDATE stoicheion_timeline_sessions SET seed_value=? WHERE user_id=? AND period_key=?')->execute([$seed, $userId, $week]);
            $db->prepare('UPDATE stoicheion_timeline_card_windows SET rerolled_at=? WHERE user_id=? AND period_key=? AND position=?')->execute([$now, $userId, $week, $position]);
            $db->prepare("UPDATE stoicheion_timeline_draws SET seed_value=?,attempt_count=2,updated_at=? WHERE user_id=? AND day_key=? AND draw_kind='timeline'")
                ->execute([$seed, $now, $userId, $session['source_day_key']]);
        }
        $db->prepare('UPDATE stoicheion_timeline_sessions SET revision=revision+1,updated_at=? WHERE user_id=? AND period_key=?')->execute([$now, $userId, $week]);
        genesisTouchUser($userId);
        $result = genesisTimelineForClient(genesisTimelineSession($userId));
        $db->exec('COMMIT'); return $result;
    } catch (Throwable $error) { $db->exec('ROLLBACK'); throw $error; }
}
