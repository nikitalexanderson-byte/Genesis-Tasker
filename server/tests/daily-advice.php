<?php
declare(strict_types=1);
require dirname(__DIR__) . '/src/bootstrap.php';
require dirname(__DIR__) . '/src/repository.php';
require dirname(__DIR__) . '/src/google.php';
require dirname(__DIR__) . '/src/shared-projects.php';

function adviceExpect(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}
function adviceReject(callable $action): void {
    try { $action(); } catch (InvalidArgumentException) { return; }
    throw new RuntimeException('Invalid advice input was accepted');
}
function adviceFixture(string $name, string $category): array {
    return ['id' => 'advice-' . substr(hash('sha256', $name), 0, 24), 'body' => 'Isolated test: ' . $name,
        'language' => 'en', 'categories' => [$category], 'sources' => []] + ($category === 'aphrodisia' ? ['requiresAdult'=>false,'aphrodisiaTheme'=>'aesthetics'] : []);
}
/** Installed Android 123 accepts these exact bounds and original history slots. */
function adviceWireCompatible(array $response): void {
    adviceExpect($response['dailyLimit'] >= 1 && $response['dailyLimit'] <= 6
        && $response['sequence'] >= 0 && $response['sequence'] <= 6
        && (!$response['canNext'] || $response['sequence'] < $response['dailyLimit']), 'Response exceeded the installed six-slot decoder');
    $cards = $response['history']; $previous = 0; $seen = [];
    adviceExpect(count($cards) <= $response['dailyLimit'], 'History exceeded the wire limit');
    foreach ($cards as $card) {
        adviceExpect($card['sequence'] > $previous && $card['sequence'] <= $response['sequence'] && !isset($seen[$card['id']]), 'History renumbered or repeated an immutable slot');
        $previous = $card['sequence']; $seen[$card['id']] = true;
    }
    adviceExpect(count(array_unique(array_column($cards, 'language'))) <= 1, 'History mixed account languages');
    adviceExpect($response['advice'] === null || isset($seen[$response['advice']['id']]), 'Current advice was missing from history');
}
$collectionsDb = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$collectionsDb->exec("CREATE TABLE users(id TEXT PRIMARY KEY, advice_preferences_json TEXT NOT NULL DEFAULT '{}')");
$collectionsDb->exec("INSERT INTO users(id) VALUES ('legacy')");
$collectionsBackupPath = tempnam(sys_get_temp_dir(), 'genesis-advice-91-');
try {
    $collectionsDb->exec('VACUUM INTO ' . $collectionsDb->quote($collectionsBackupPath));
    $collectionsDb->beginTransaction();
    $collectionsDb->exec(file_get_contents(dirname(__DIR__) . '/migrations/091_advice_collections.sql'));
    $collectionsDb->commit();
    adviceExpect($collectionsDb->query("SELECT advice_collections_json FROM users WHERE id='legacy'")->fetchColumn() === '["aurora"]', 'Collection migration changed the legacy default');
    $collectionsDb->exec("UPDATE users SET advice_collections_json='[\"philosophers\"]' WHERE id='legacy'");
    // The previous code's preference writer remains usable after code rollback and leaves the new choice intact.
    $collectionsDb->exec("UPDATE users SET advice_preferences_json='{}' WHERE id='legacy'");
    $collectionsUser = $collectionsDb->query("SELECT * FROM users WHERE id='legacy'")->fetch(PDO::FETCH_ASSOC);
    adviceExpect(genesisUserAdvicePreferences($collectionsUser)['collections'] === ['philosophers'], 'Legacy preference write erased the separate collection choice');
    adviceExpect(json_decode($collectionsUser['advice_preferences_json'], true) === [], 'Legacy JSON gained incompatible keys');
    $collectionsBackup = new PDO('sqlite:' . $collectionsBackupPath);
    adviceExpect($collectionsBackup->query('PRAGMA integrity_check')->fetchColumn() === 'ok', 'Collection backup is inconsistent');
    adviceExpect(!in_array('advice_collections_json', array_column($collectionsBackup->query('PRAGMA table_info(users)')->fetchAll(PDO::FETCH_ASSOC),'name'), true), 'Collection backup contains the new schema');
} finally { $collectionsBackup = null; if (is_file($collectionsBackupPath)) unlink($collectionsBackupPath); }

$migration = dirname(__DIR__) . '/migrations/080_daily_advice.sql';
$legacy = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
foreach (glob(dirname(__DIR__) . '/migrations/*.sql') as $file) {
    if (strcmp(basename($file), basename($migration)) < 0) $legacy->exec(file_get_contents($file));
}
$legacy->exec("INSERT INTO users(id,google_sub,email,created_at,updated_at,calendar_mode) VALUES ('advice-legacy','advice-legacy','legacy@example.invalid','now','now','lunar')");
$backupPath = tempnam(sys_get_temp_dir(), 'genesis-advice-80-');
try {
    $legacy->exec('VACUUM INTO ' . $legacy->quote($backupPath));
    $legacy->beginTransaction(); $legacy->exec(file_get_contents($migration)); $legacy->commit();
    adviceExpect($legacy->query("SELECT calendar_mode FROM users WHERE id='advice-legacy'")->fetchColumn() === 'lunar', 'Migration changed legacy data');
    $legacy->exec("UPDATE users SET calendar_mode='sacred' WHERE id='advice-legacy'");
    adviceExpect($legacy->query("SELECT advice_preferences_json FROM users WHERE id='advice-legacy'")->fetchColumn() === '{}', 'Incompatible migration defaults');
    $backup = new PDO('sqlite:' . $backupPath);
    adviceExpect($backup->query('PRAGMA integrity_check')->fetchColumn() === 'ok', 'Inconsistent migration backup');
    adviceExpect($backup->query("SELECT calendar_mode FROM users WHERE id='advice-legacy'")->fetchColumn() === 'lunar', 'Backup lost original data');
    adviceExpect(!in_array('advice_preferences_json', array_column($backup->query('PRAGMA table_info(users)')->fetchAll(PDO::FETCH_ASSOC), 'name'), true), 'Backup includes post-migration schema');
} finally { $backup = null; if (is_file($backupPath)) unlink($backupPath); }

// Rotation is additive: preserve today's pointer, all seen/dismissed history and account choices.
$legacyEntry = adviceFixture('migration-81-current', 'aretology');
$legacy->prepare('UPDATE users SET advice_preferences_json=? WHERE id=?')->execute([
    json_encode(['enabled' => true, 'smart' => false, 'categories' => ['aretology', 'hestiology']]), 'advice-legacy']);
$legacy->prepare('INSERT INTO daily_advice_days(user_id,day_key,advice_id,entry_json,created_at,viewed_at,dismissed_at) VALUES (?,?,?,?,?,?,?)')
    ->execute(['advice-legacy', '2026-10-23', $legacyEntry['id'], json_encode($legacyEntry), 'created', 'seen', 'hidden']);
$rotationBackupPath = tempnam(sys_get_temp_dir(), 'genesis-advice-81-');
try {
    $legacy->exec('VACUUM INTO ' . $legacy->quote($rotationBackupPath));
    $legacy->beginTransaction();
    $legacy->exec(file_get_contents(dirname(__DIR__) . '/migrations/081_daily_advice_rotation.sql'));
    $legacy->commit();
    $migrated = $legacy->query('SELECT * FROM daily_advice_entries')->fetch(PDO::FETCH_ASSOC);
    adviceExpect($migrated['advice_id'] === $legacyEntry['id'] && (int)$migrated['slot'] === 1
        && $migrated['viewed_at'] === 'seen' && $migrated['dismissed_at'] === 'hidden', 'Rotation migration lost exposure or dismissal');
    $pointer = $legacy->query('SELECT * FROM daily_advice_days')->fetch(PDO::FETCH_ASSOC);
    adviceExpect((int)$pointer['draw_limit'] === 3 && json_decode($pointer['selection_json'], true)['categories'] === ['aretology', 'hestiology'], 'Rotation migration lost the day selection');
    // The previous release's SELECT and UPDATE remain valid without any destructive database rollback.
    $legacy->exec("UPDATE daily_advice_days SET viewed_at='legacy-client' WHERE user_id='advice-legacy'");
    adviceExpect($legacy->query('SELECT advice_id FROM daily_advice_days')->fetchColumn() === $legacyEntry['id'], 'Previous code cannot read its current-day pointer');
    $rotationBackup = new PDO('sqlite:' . $rotationBackupPath);
    adviceExpect($rotationBackup->query('PRAGMA integrity_check')->fetchColumn() === 'ok', 'Rotation backup is inconsistent');
    adviceExpect($rotationBackup->query('SELECT viewed_at FROM daily_advice_days')->fetchColumn() === 'seen', 'Rotation backup did not preserve original history');
    adviceExpect(!in_array('draw_limit', array_column($rotationBackup->query('PRAGMA table_info(daily_advice_days)')->fetchAll(PDO::FETCH_ASSOC), 'name'), true), 'Rotation backup contains the later schema');
} finally { $rotationBackup = null; if (is_file($rotationBackupPath)) unlink($rotationBackupPath); }

$preferences = genesisAdvicePreferences([]);
adviceExpect($preferences['collections'] === ['aurora'], 'Legacy accounts must keep Aurora advice');
foreach ([[], ['unknown'], 'philosophers', [true]] as $collections) adviceReject(fn() => genesisAdvicePreferences(['collections' => $collections]));
$philosophers = genesisAdvicePreferences(['collections' => ['philosophers']]);
adviceExpect(genesisChooseAdvice([adviceFixture('order only', 'aretology')], $philosophers, genesisAdviceScores([]), [], 'no-substitution') === null, 'Empty philosopher collection substituted Aurora');
$readyAphorismIds = array_keys(genesisPhilosopherArtwork());
$aphorism = [...adviceFixture('synthetic aphorism fixture', 'aretology'), 'id' => $readyAphorismIds[0], 'collection' => 'philosophers', 'categories' => []];
adviceExpect(genesisChooseAdvice([$aphorism], $philosophers, genesisAdviceScores([]), [], 'philosopher')['id'] === $aphorism['id'], 'Philosopher collection cannot be connected');
adviceExpect(genesisChooseAdvice([$aphorism], $preferences, genesisAdviceScores([]), [], 'aurora') === null, 'Unselected philosopher collection leaked');
foreach ([true, false] as $smart) {
    $both = genesisAdvicePreferences(['collections' => ['aurora', 'philosophers'], 'smart' => $smart, 'categories' => ['aretology']]);
    $mixed = []; $mixedHistory = [];
    foreach (range(1, 3) as $number) {
        $mixed[] = [...adviceFixture('mixed aurora ' . $number, 'aretology'), 'collection' => 'aurora'];
        $mixed[] = [...adviceFixture('mixed philosopher ' . $number, 'aretology'), 'id' => $readyAphorismIds[$number], 'collection' => 'philosophers', 'categories' => []];
    }
    foreach (range(1, 6) as $slot) {
        $previous = $mixedHistory[0] ?? null;
        $chosen = genesisChooseAdvice($mixed, $both, genesisAdviceScores(['aretology' => 1000]), $mixedHistory,
            'mixed:' . $slot, [], [], ['previousCategories' => $previous ? json_decode($previous['entry_json'], true)['categories'] : []]);
        adviceExpect($chosen !== null, 'Mixed collection stopped drawing');
        if ($previous) adviceExpect($chosen['collection'] !== json_decode($previous['entry_json'], true)['collection'], 'Aurora affinity or category rotation starved aphorisms');
        array_unshift($mixedHistory, ['advice_id' => $chosen['id'], 'day_key' => '2026-11-01', 'entry_json' => json_encode($chosen)]);
    }
    adviceExpect(count(array_unique(array_column($mixedHistory, 'advice_id'))) === 6, 'Mixed collection repeated before exhausting unseen cards');
}
adviceExpect($preferences['enabled'] && $preferences['smart'] && count($preferences['categories']) === 5, 'Wrong defaults');
foreach ([['enabled' => 'false'], ['smart' => false, 'categories' => []], ['categories' => ['unknown']], ['unknown' => true]] as $input) adviceReject(fn() => genesisAdvicePreferences($input));
foreach ([['hermetica' => -1], ['hermetica' => '1'], ['hermetica' => 1001], ['habitTitles' => []]] as $input) adviceReject(fn() => genesisAdviceScores($input));

$items = [adviceFixture('A', 'hermetica'), adviceFixture('B', 'hermetica'), adviceFixture('C', 'aretology')];
$scores = genesisAdviceScores(['hermetica' => 10, 'aretology' => 1]);
$history = [];
for ($day = 1; $day <= 9; $day++) {
    $chosen = genesisChooseAdvice($items, $preferences, $scores, $history, 'user:' . $day);
    array_unshift($history, ['advice_id' => $chosen['id'], 'day_key' => sprintf('2026-10-%02d', $day), 'entry_json' => json_encode($chosen)]);
    if ($day % 3 === 0) adviceExpect(count(array_unique(array_column(array_slice($history, 0, 3), 'advice_id'))) === 3, 'Repeated before the selected pool was exhausted');
}
$newItem = adviceFixture('newly added', 'hermetica');
adviceExpect(genesisChooseAdvice([...$items, $newItem], $preferences, $scores, $history, 'new')['id'] === $newItem['id'], 'New content did not take priority over repeats');
array_unshift($history, ['advice_id' => $newItem['id'], 'day_key' => '2026-10-10', 'entry_json' => json_encode($newItem)]);
adviceExpect(genesisChooseAdvice([...$items, $newItem], $preferences, $scores, $history, 'after-new')['id'] !== $newItem['id'],
    'A newly read post repeated while catching up with older exposure counts');
$manual = ['enabled' => true, 'smart' => false, 'categories' => ['aretology']];
adviceExpect(genesisChooseAdvice($items, $manual, $scores, [], 'manual')['id'] === $items[2]['id'], 'Manual categories ignored');
adviceExpect(genesisChooseAdvice($items, $preferences, genesisAdviceScores(['aretology' => 1]), [], 'smart')['id'] === $items[2]['id'], 'Smart categories ignored');
adviceExpect(genesisChooseAdvice([], $manual, $scores, [], 'empty') === null, 'Empty corpus produced a fallback');
adviceExpect(genesisChooseAdvice($items, ['enabled' => true, 'smart' => false, 'categories' => ['kourotrophy']], $scores, [], 'legacy-manual')['id'] === $items[2]['id'], 'Unavailable manual selection disagreed with the settings fallback');
adviceExpect(in_array(genesisChooseAdvice($items, ['enabled' => true, 'smart' => false, 'categories' => ['hermetica', 'kourotrophy']], $scores, [], 'mixed-manual')['id'], [$items[0]['id'], $items[1]['id']], true), 'Available manual choices were replaced by fallback content');
adviceExpect(genesisChooseAdvice($items, $preferences, genesisAdviceScores([]), [], 'fallback') !== null, 'No-habit fallback failed');

// A habit in an unpublished category falls back to available content.
adviceExpect(genesisChooseAdvice([$items[2]], $preferences, genesisAdviceScores(['hermetica' => 100]), [], 'available')['id'] === $items[2]['id'], 'Unavailable smart category suppressed available advice');
$food = [...adviceFixture('food', 'aretology'), 'topics' => ['nutrition']];
$workout = [...adviceFixture('workout', 'aretology'), 'topics' => ['training']];
$topicScores = genesisAdviceTopicScores(['nutrition' => 100]);
adviceExpect(genesisChooseAdvice([$food, $workout], $preferences, $scores, [], 'food', $topicScores, [])['id'] === $food['id'], 'Food habits did not favour food content');
$foodHistory = [['advice_id' => $food['id'], 'day_key' => '2026-10-01', 'entry_json' => json_encode($food)]];
adviceExpect(genesisChooseAdvice([$food, $workout], $preferences, $scores, $foodHistory, 'food-repeat', $topicScores, [])['id'] === $workout['id'], 'Food affinity bypassed unseen history');
adviceReject(fn() => genesisAdviceTopicScores(['nutrition' => 'high']));
adviceReject(fn() => genesisAdviceTopicScores(['habitNames' => ['Private text']]));
$lunar = [...adviceFixture('lunar preparation', 'aretology'), 'schedule' => ['phases' => ['new', 'full'], 'leadDays' => [1, 2, 3]]];
adviceExpect(genesisChooseAdvice([$food, $lunar], $manual, $scores, [], 'not-lunar', [], [])['id'] === $food['id'], 'Lunar preparation leaked outside its window');
foreach (['new', 'full'] as $phase) foreach ([1, 2, 3] as $lead) {
    adviceExpect(genesisChooseAdvice([$food, $lunar], $manual, $scores, [], 'lunar', [], [$phase => $lead])['id'] === $lunar['id'], 'Lunar preparation did not lead during its window');
}
foreach ([0, 4] as $lead) adviceExpect(!genesisAdviceScheduledFor($lunar, ['new' => $lead]), 'Wrong lunar boundary');

// One lunar preparation per civil day, across categories and the entire 7-card set.
// Nutrition in general remains available; only the shared new/full moon topic is capped.
$lunarDay = '2026-11-06';
$lunarAlternatives = array_map(static fn($index) => [...adviceFixture('lunar variant ' . $index, $index % 2 ? 'aretology' : 'hestiology'),
    'schedule' => ['phases' => ['new', 'full'], 'leadDays' => [1, 2, 3]]], range(1, 13));
$ordinaryAlternatives = array_map(static fn($index) => [...adviceFixture('ordinary variant ' . $index, $index % 2 ? 'aretology' : 'hestiology'),
    'topics' => [$index % 2 ? 'nutrition' : 'home_order']], range(1, 10));
foreach (['new', 'full'] as $phase) foreach ([1, 2, 3] as $lead) foreach ([true, false] as $smart) {
    $context = ['day' => $lunarDay, 'excluded' => [], 'issuedToday' => []];
    $choice = [...$preferences, 'smart' => $smart, 'categories' => ['aretology', 'hestiology']];
    $pool = [...$lunarAlternatives, ...$ordinaryAlternatives];
    for ($slot = 0; $slot < 7; $slot++) {
        $next = genesisChooseAdvice($pool, $choice, $scores, [], "lunar-set:$phase:$lead:$slot", $topicScores, [$phase => $lead], $context);
        adviceExpect($next !== null, 'The lunar cap starved unrelated daily advice');
        adviceExpect(genesisAdviceLunarPreparation($next) === ($slot === 0), 'More than one lunar preparation entered a seven-card set');
        $context['excluded'][] = $next['id']; $context['issuedToday'][] = $next;
    }
}
$lunarSnapshot = [...$lunarAlternatives[0], 'dismissed_at' => '2026-11-06T01:00:00Z'];
$issuedContext = ['day' => $lunarDay, 'issuedToday' => [$lunarSnapshot]];
adviceExpect(genesisChooseAdvice([$lunarAlternatives[1]], $preferences, $scores, [], 'unviewed-lunar', [], ['new' => 1], $issuedContext) === null, 'An unviewed/dismissed lunar snapshot reset the topic cap');
$lunarHistory = [['advice_id' => $lunarSnapshot['id'], 'day_key' => $lunarDay, 'entry_json' => json_encode($lunarSnapshot)]];
adviceExpect(genesisChooseAdvice([$lunarAlternatives[1], $food], $preferences, $scores, $lunarHistory, 'viewed-lunar', $topicScores, ['full' => 2], ['day' => $lunarDay])['id'] === $food['id'], 'The cap failed on viewed history or blocked ordinary nutrition');
adviceExpect(genesisChooseAdvice([$lunarAlternatives[1]], $preferences, $scores, $lunarHistory, 'new-day-lunar', [], ['full' => 1], ['day' => '2026-11-07']) !== null, 'Yesterday\'s lunar card consumed today\'s topic place');
adviceExpect(genesisChooseAdvice($lunarAlternatives, $preferences, $scores, [], 'legacy-lunar', [], ['new' => 1], ['day' => $lunarDay, 'excluded' => [$lunarSnapshot['id']]]) === null, 'Older snapshots bypassed current lunar metadata');
adviceExpect(genesisChooseAdvice([[...$food, 'status' => 'draft']], $manual, $scores, [], 'draft') === null, 'Private draft entered the selection pool');
$ephemeris = genesisCalendarEphemeris();
foreach (['Europe/Moscow', 'Pacific/Kiritimati', 'America/Los_Angeles', 'Europe/Berlin'] as $zone) {
    foreach (['new' => 'newMoons', 'full' => 'fullMoons'] as $phase => $key) {
        $moment = array_values(array_filter($ephemeris[$key], static fn($moment) => $moment >= 1767225600000 && $moment < 1798761600000))[0];
        $eventDay = genesisCalendarEventDate($moment, ['timeZone' => $zone]);
        foreach ([1, 2, 3] as $lead) {
            $before = genesisCalendarAddDays($eventDay, -$lead);
            adviceExpect((genesisAdvicePhaseLeads($before, $zone)[$phase] ?? null) === $lead, 'Lunar window ignored local civil date');
        }
        foreach ([0, 1, -4] as $offset) adviceExpect(!isset(genesisAdvicePhaseLeads(genesisCalendarAddDays($eventDay, $offset), $zone)[$phase]), 'Lunar advice appeared on or after the phase or too early');
    }
}
adviceExpect(genesisAdviceAvailableCategories() === ['aretology', 'hermetica', 'kourotrophy', 'hestiology', 'aphrodisia', 'psychopompia'], 'Available settings categories do not match the six published categories');
adviceExpect(genesisAdviceDailyLimit($preferences, genesisAdviceCatalog()) === 4, 'Smart selection did not include the fourth published collection');
$hermeticaPosts = array_values(array_filter(genesisAdviceCatalog(), static fn($entry) => in_array('hermetica', $entry['categories'], true)));
adviceExpect(count($hermeticaPosts) === 151 && $hermeticaPosts[13]['timeOfDay'] === 'morning', 'Hermetica source count or morning practice is wrong');
adviceExpect(genesisChooseAdvice($hermeticaPosts, ['enabled' => true, 'smart' => false, 'categories' => ['hermetica']], genesisAdviceScores([]), [], 'hermetica-manual') !== null, 'Manual Hermetica selection returned no content');

// Family interests adjust rank without changing category access, history or manual selection.
$family = [...adviceFixture('family advice', 'kourotrophy'), 'topics' => ['parenting']];
$familyPool = [$workout, $family];
$neutralScores = genesisAdviceScores([]);
$fatherTopics = genesisAdviceTopicScores(['parenting' => 8, 'sons' => 8, 'fatherhood' => 4]);
$motherTopics = genesisAdviceTopicScores(['parenting' => 8, 'motherhood' => 4]);
adviceExpect(genesisAdviceFamilyAffinity($fatherTopics) > genesisAdviceFamilyAffinity($motherTopics), 'Paternal and sons interests did not receive higher priority');
adviceExpect(genesisAdviceFamilyAffinity(genesisAdviceTopicScores(['motherhood' => 8])) < genesisAdviceFamilyAffinity([]), 'Maternal-only interest did not receive a lower priority');
adviceExpect(genesisChooseAdvice($familyPool, $preferences, $neutralScores, [], 'family-smart', $fatherTopics, [])['id'] === $family['id'], 'Parent/sons context did not favour Kourotrophy');
$familyHistory = [['advice_id' => $family['id'], 'day_key' => '2026-10-01', 'entry_json' => json_encode($family)]];
adviceExpect(genesisChooseAdvice($familyPool, $preferences, $neutralScores, $familyHistory, 'family-round', $fatherTopics, [])['id'] === $workout['id'], 'Family interest bypassed unseen advice');
$manualFamily = ['enabled' => true, 'smart' => false, 'categories' => ['kourotrophy']];
adviceExpect(genesisChooseAdvice($familyPool, $manualFamily, $neutralScores, [], 'family-manual', $motherTopics, [])['id'] === $family['id'], 'Maternal interests overrode an explicit Kourotrophy selection');
adviceExpect(genesisAdviceDailyLimit($manualFamily, $familyPool) === 3, 'Kourotrophy changed the one-category daily limit');

// Time-specific practices use the local hour; manual browsing can still read the chosen category.
$home = [...adviceFixture('home ordinary', 'hestiology'), 'topics' => ['home_order']];
$morning = [...adviceFixture('home morning', 'hestiology'), 'timeOfDay' => 'morning'];
$evening = [...adviceFixture('home evening', 'hestiology'), 'timeOfDay' => 'evening'];
$smartHome = genesisAdviceScores(['hestiology' => 10]);
foreach ([5, 8, 11] as $hour) adviceExpect(genesisChooseAdvice([$home, $morning, $evening], $preferences, $smartHome, [], 'time', [], [], ['hour' => $hour])['id'] === $morning['id'], 'Morning advice missed its local window');
foreach ([18, 23, 0, 4] as $hour) adviceExpect(genesisChooseAdvice([$home, $morning, $evening], $preferences, $smartHome, [], 'time', [], [], ['hour' => $hour])['id'] === $evening['id'], 'Evening advice missed its local window');
foreach ([12, 17] as $hour) adviceExpect(genesisChooseAdvice([$home, $morning, $evening], $preferences, $smartHome, [], 'time', [], [], ['hour' => $hour])['id'] === $home['id'], 'A timed practice leaked into the wrong period');
$allCategories = array_map(static fn($category) => adviceFixture('limit ' . $category, $category), GENESIS_ADVICE_CATEGORIES);
// An unreviewed/unpublished Psychopompia placeholder does not increase the usable daily allowance.
foreach ([1 => 3, 2 => 3, 3 => 3, 4 => 4, 5 => 5, 6 => 5] as $selected => $expectedLimit) adviceExpect(genesisAdviceDailyLimit(['smart' => false, 'categories' => array_slice(GENESIS_ADVICE_CATEGORIES, 0, $selected), 'aphrodisiaAdult' => true], $allCategories) === $expectedLimit, 'Wrong selected-category daily limit');
$clothing = [...adviceFixture('home clothing', 'hestiology'), 'topics' => ['clothing']];
$attributes = [...adviceFixture('home attributes', 'hestiology'), 'topics' => ['attributes']];
$homeManual = ['enabled' => true, 'smart' => false, 'categories' => ['hestiology']];
$homeHistory = [['advice_id' => $home['id'], 'day_key' => '2026-10-01', 'entry_json' => json_encode($home)]];
$rareUser = '';
for ($i = 0; $i < 100; $i++) if (hexdec(substr(hash('sha256', 'rare-' . $i . ':2026-10-23:clothing'), 0, 4)) % 4 === 0) { $rareUser = 'rare-' . $i; break; }
$rareContext = ['day' => '2026-10-23', 'user' => $rareUser];
adviceExpect(genesisChooseAdvice([$home, $clothing], $homeManual, $smartHome, [], 'rare', [], [], $rareContext)['id'] === $home['id'], 'Clothing appeared before ordinary Hestiology was exhausted');
adviceExpect(genesisChooseAdvice([$home, $clothing], $homeManual, $smartHome, $homeHistory, 'rare', [], [], $rareContext)['id'] === $clothing['id'], 'Rare clothing never becomes eligible after exhaustion');
$clothingHistory = [...$homeHistory, ['advice_id' => $clothing['id'], 'day_key' => '2026-10-02', 'entry_json' => json_encode($clothing)]];
adviceExpect(genesisChooseAdvice([$home, $clothing, $attributes], $homeManual, $smartHome, $clothingHistory, 'rare', [], [], $rareContext)['id'] === $home['id'], 'Clothing and attributes did not share the 30-day cooldown');
$monthHistory = [...$homeHistory, ['advice_id' => $clothing['id'], 'day_key' => '2026-10-01', 'entry_json' => json_encode($clothing)]];
adviceExpect(genesisChooseAdvice([$home, $clothing, $attributes], $homeManual, $smartHome, $monthHistory, 'month', [], [], ['day' => '2026-10-31', 'user' => $rareUser])['id'] === $home['id'], 'Two clothing posts appeared in the same calendar month');
adviceExpect(genesisChooseAdvice([$home, $clothing], $preferences, $smartHome, [], 'interest', ['clothing' => 10], [], $rareContext)['id'] === $clothing['id'], 'An explicit clothing intention did not raise relevant advice');
adviceExpect(genesisChooseAdvice([$morning, $clothing], $preferences, $smartHome, [], 'shopping-now', ['clothing' => 10], [], ['hour' => 8])['id'] === $clothing['id'], 'Generic morning priority suppressed an explicit shopping intention');
$cleaning = [...adviceFixture('active cleaning', 'hestiology'), 'topics' => ['cleaning']];
adviceExpect(genesisChooseAdvice([$evening, $cleaning], $preferences, $smartHome, [], 'cleaning-now', ['cleaning' => 10], [], ['hour' => 19])['id'] === $cleaning['id'], 'Generic evening priority suppressed an explicit cleaning intention');

// Next alternates available categories without bypassing unread rounds, time or rarity gates.
$afterHome = ['previousCategories' => ['hestiology'], 'hour' => 15];
adviceExpect(genesisChooseAdvice([$home, $food], $preferences, $smartHome, [], 'alternate', [], [], $afterHome)['id'] === $food['id'], 'Next did not choose a different eligible category');
adviceExpect(genesisChooseAdvice([$home, $food], $homeManual, $smartHome, [], 'one-category', [], [], $afterHome)['id'] === $home['id'], 'A single-category selection could not rotate');
$readFood = [['advice_id' => $food['id'], 'day_key' => '2026-10-01', 'entry_json' => json_encode($food)]];
adviceExpect(genesisChooseAdvice([$home, $food], $preferences, $smartHome, $readFood, 'unread-round', [], [], $afterHome)['id'] === $home['id'], 'Category alternation repeated a read post before the unread pool was exhausted');
$readBoth = [...$homeHistory, ...$readFood];
adviceExpect(genesisChooseAdvice([$home, $food], $preferences, $smartHome, $readBoth, 'repeat-round', [], [], $afterHome)['id'] === $food['id'], 'Category alternation stopped after the first complete round');
$twiceReadFood = [...$readBoth, ['advice_id' => $food['id'], 'day_key' => '2026-10-02', 'entry_json' => json_encode($food)]];
adviceExpect(genesisChooseAdvice([$home, $food], $preferences, $smartHome, $twiceReadFood, 'finish-round', [], [], $afterHome)['id'] === $home['id'], 'Category alternation bypassed a less-viewed repeat round');
$afterAretology = ['previousCategories' => ['aretology'], 'hour' => 15];
adviceExpect(genesisChooseAdvice([$morning, $food], $preferences, $smartHome, [], 'timed-alternation', [], [], $afterAretology)['id'] === $food['id'], 'Category alternation ignored the local practice window');
// Rarity is stable per account/day. Do not let the wall-clock day decide which branch this regression tests.
$blockedRareUser = '';
for ($i = 0; $i < 100; $i++) if (hexdec(substr(hash('sha256', 'rare-' . $i . ':2026-10-23:clothing'), 0, 4)) % 4 !== 0) { $blockedRareUser = 'rare-' . $i; break; }
adviceExpect($rareUser !== '' && $blockedRareUser !== '', 'Could not construct both deterministic rarity contexts');
$blockedAlternation = [...$afterAretology, 'day' => '2026-10-23', 'user' => $blockedRareUser];
$allowedAlternation = [...$afterAretology, ...$rareContext];
adviceExpect(genesisChooseAdvice([$clothing, $food], $preferences, $smartHome, [], 'rare-alternation', [], [], $blockedAlternation)['id'] === $food['id'], 'Category alternation bypassed the rare clothing gate');
adviceExpect(genesisChooseAdvice([$clothing, $food], $preferences, $smartHome, [], 'rare-alternation', [], [], $allowedAlternation)['id'] === $clothing['id'], 'Category alternation suppressed clothing on an eligible rare day');

// Explicit opt-in and authoritative per-entry age filtering.
$aphroAdult = [...adviceFixture('ADULT', 'aphrodisia'), 'requiresAdult' => true, 'aphrodisiaTheme' => 'love'];
$aphroArt = [...adviceFixture('ART', 'aphrodisia'), 'requiresAdult' => false, 'aphrodisiaTheme' => 'aesthetics'];
$aphroMind = [...adviceFixture('MIND', 'aphrodisia'), 'requiresAdult' => false, 'aphrodisiaTheme' => 'consciousness'];
$minor = genesisAdvicePreferences(['smart' => false, 'categories' => ['aphrodisia'], 'aphrodisiaAdult' => false]);
$adult = genesisAdvicePreferences([...$minor, 'aphrodisiaAdult' => true]);
adviceExpect(!in_array('aphrodisia', genesisAdvicePreferences([])['categories'], true), 'Aphrodisia was enabled by default');
adviceExpect(genesisChooseAdvice([$aphroAdult, $aphroArt], genesisAdvicePreferences([]), $scores, [], 'off', [], []) === null, 'Smart mode silently opted into Aphrodisia');
for ($i=0;$i<20;$i++) {
    adviceExpect(genesisChooseAdvice([$aphroAdult,$aphroArt],$minor,$scores,[],'minor'.$i,[],[])['id']===$aphroArt['id'],'Adult advice leaked to a minor');
}
adviceExpect(genesisChooseAdvice([$aphroAdult],$adult,$scores,[],'adult',[],[])['id']===$aphroAdult['id'],'Confirmed adult cannot read adult advice');
adviceExpect(!genesisAdviceAgeAllowed($aphroAdult,$minor), 'A previously selected adult entry remained readable');
adviceExpect(!genesisAdviceAgeAllowed([...$aphroAdult,'requiresAdult'=>null],$minor), 'Missing age metadata failed open');
$themeHistory=[['advice_id'=>$aphroArt['id'],'day_key'=>'2026-10-29','entry_json'=>json_encode($aphroArt)]];
adviceExpect(genesisChooseAdvice([$aphroArt,$aphroMind],$minor,$scores,$themeHistory,'themes',[],[])['aphrodisiaTheme']==='consciousness','Aphrodisia themes did not alternate');

$db = genesisDb(); $ids = [];
for ($index = 0; $index < 3; $index++) {
    $id = 'advice-test-' . bin2hex(random_bytes(8)); $ids[] = $id;
    $db->prepare('INSERT INTO users(id,google_sub,email,created_at,updated_at) VALUES (?,?,?,?,?)')->execute([$id, $id, $id . '@example.invalid', genesisNow(), genesisNow()]);
    $db->prepare("UPDATE users SET subscription_plan='premium4life' WHERE id=?")->execute([$id]);
}
try {
    [$alice, $bob, $charlie] = $ids;
    $legacyCatalog=array_values(array_filter(genesisAdviceCatalog(),static fn($entry)=>!in_array('psychopompia',$entry['categories'],true)));
    adviceExpect(!in_array('psychopompia', genesisAdviceAvailableCategories($legacyCatalog), true), 'Legacy fallback fixture must use an unpublished category');
    genesisUpdateAccountPreferences($bob, ['advicePreferences' => ['smart' => false, 'categories' => ['psychopompia']]]);
    $legacyFallback = genesisDailyAdvice($bob, [], $legacyCatalog);
    adviceExpect($legacyFallback['state'] === 'ready' && $legacyFallback['advice']['categories'] === ['aretology'], 'Saved unavailable manual category suppressed the displayed Aretology selection');
    adviceExpect(genesisAdvicePreferences(genesisFindUser($bob)['advice_preferences_json'])['categories'] === ['psychopompia'], 'Reading advice unexpectedly rewrote legacy preferences');
    genesisUpdateAccountPreferences($alice, ['advicePreferences' => ['smart' => false, 'categories' => ['hermetica']]]);
    genesisUpdateAccountPreferences($alice, ['stoicheionDivinationDisabled' => true, 'uiVisibility' => ['sacredFeaturesEnabled' => false]]);
    $saved = genesisAdvicePreferences(genesisFindUser($alice)['advice_preferences_json']);
    adviceExpect($saved['enabled'] && !$saved['smart'] && $saved['categories'] === ['hermetica'], 'Sacred or legacy settings reset advice');
    $empty = genesisDailyAdvice($alice, [], []);
    adviceExpect($empty['state'] === 'empty' && $empty['advice'] === null, 'Empty corpus produced a card');
    $result = genesisDailyAdvice($alice, ['scores' => $scores], $items);
    $card = $result['advice'];
    adviceExpect($card !== null && !$card['dismissed'], 'Daily reservation failed');
    for ($i = 0; $i < 4; $i++) adviceExpect(genesisDailyAdvice($alice, ['scores' => ['aretology' => 100]], [$items[2]])['advice']['id'] === $card['id'], 'Parallel replay changed the daily advice');
    adviceExpect((int)$db->query("SELECT COUNT(*) FROM daily_advice_days WHERE user_id=" . $db->quote($alice))->fetchColumn() === 1, 'Daily reservation was duplicated');
    $seen = $db->prepare('SELECT viewed_at,dismissed_at FROM daily_advice_days WHERE user_id=?'); $seen->execute([$alice]);
    adviceExpect($seen->fetch()['viewed_at'] === null, 'Fetching consumed an unseen advice');
    genesisRecordAdvice($bob, $card, true);
    adviceExpect(!genesisDailyAdvice($alice, [], $items)['advice']['dismissed'], 'Another account dismissed a card');
    genesisRecordAdvice($alice, $card, false); genesisRecordAdvice($alice, $card, false);
    genesisRecordAdvice($alice, $card, true); genesisRecordAdvice($alice, $card, true);
    adviceExpect(genesisDailyAdvice($alice, [], $items)['advice']['dismissed'], 'Dismissal did not persist');
    $seen->execute([$alice]); $row = $seen->fetch();
    adviceExpect($row['viewed_at'] !== null && $row['dismissed_at'] !== null, 'Visible/dismissed history was not stored');
    genesisUpdateAccountPreferences($alice, ['advicePreferences' => ['enabled' => false]]);
    adviceExpect(genesisDailyAdvice($alice, [], $items)['advice'] === null, 'Disabled advice still returned content');
    genesisUpdateAccountPreferences($alice, ['advicePreferences' => ['enabled' => true]]);
    adviceExpect(genesisDailyAdvice($alice, [], $items)['advice']['id'] === $card['id'], 'Re-enabling rerolled the day');
    foreach (genesisAdviceCatalog() as $versioned) {
        if(!isset($versioned['contentVersion'])) continue; // Philosopher locales have their own complete corpus suite.
        $localizedRow = ['day_key' => $card['dayKey'], 'entry_json' => json_encode($versioned, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), 'dismissed_at' => genesisNow()];
        foreach (GENESIS_ADVICE_LANGUAGES as $language) {
            $localized = genesisAdviceForClient($localizedRow, $language);
            $expected = json_decode(file_get_contents(__DIR__ . '/../content/daily-advice/' . $versioned['contentVersion'] . '/' . $language . '.json'), true, 32, JSON_THROW_ON_ERROR)[$versioned['id']];
            adviceExpect($localized['id'] === $versioned['id'] && $localized['dismissed'] && $localized['dayKey'] === $card['dayKey'], 'Changing language changed identity or dismissal');
            adviceExpect($localized['language'] === $language && $localized['title'] === $expected['title'] && $localized['body'] === $expected['body'], 'Incomplete or wrong daily advice translation');
            adviceExpect(array_intersect(['contentVersion', 'topics', 'schedule', 'status'], array_keys($localized)) === [], 'Internal publishing metadata leaked');
        }
    }
    // Existing daily snapshots must resolve the corrected title by ID, even when their stored title is old.
    $fastingPost = array_values(array_filter(genesisAdviceCatalog(), static fn($entry) => $entry['id'] === 'advice-fe0f86e475bc9350744f1095'))[0];
    $oldFastingSnapshot = [...$fastingPost, 'title' => 'Практика "Очага Гестии"'];
    $oldFastingRow = ['day_key' => $card['dayKey'], 'entry_json' => json_encode($oldFastingSnapshot, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), 'dismissed_at' => null];
    foreach (GENESIS_ADVICE_LANGUAGES as $language) {
        $resolved = genesisAdviceForClient($oldFastingRow, $language);
        $translation = json_decode(file_get_contents(__DIR__ . '/../content/daily-advice/' . $fastingPost['contentVersion'] . '/' . $language . '.json'), true, 32, JSON_THROW_ON_ERROR)[$fastingPost['id']];
        adviceExpect($resolved['title'] === $translation['title'] && $resolved['body'] === $translation['body'], 'Historical daily advice retained an obsolete title or mismatched body');
        adviceExpect($resolved['id'] === $fastingPost['id'] && $resolved['image'] === $fastingPost['image'] && $resolved['categories'] === ['aretology'], 'Correcting a historical title changed its identity or illustration');
    }
    // Keep this replay fixture in an unrestricted collection; Aphrodisia now requires explicit consent.
    $versioned = array_values(array_filter(genesisAdviceCatalog(), static fn($entry) => $entry['categories'] === ['hermetica']))[0];
    $localizedRow['entry_json'] = json_encode($versioned, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    $db->prepare('UPDATE daily_advice_days SET advice_id=?,entry_json=? WHERE user_id=?')->execute([$versioned['id'], $localizedRow['entry_json'], $alice]);
    foreach (GENESIS_ADVICE_LANGUAGES as $language) {
        genesisUpdateAccountPreferences($alice, ['language' => $language]);
        $translatedDay = genesisDailyAdvice($alice, [], $items)['advice'];
        adviceExpect($translatedDay['id'] === $versioned['id'] && $translatedDay['language'] === $language && $translatedDay['dismissed'], 'Daily replay ignored account language or rerolled the post');
    }
    // The database owns one global limit, and stale/retried next requests cannot spend another slot.
    $db->prepare('DELETE FROM daily_advice_entries WHERE user_id=?')->execute([$bob]);
    $db->prepare('DELETE FROM daily_advice_days WHERE user_id=?')->execute([$bob]);
    genesisUpdateAccountPreferences($bob, ['advicePreferences' => ['enabled' => true, 'smart' => false, 'categories' => ['aretology']]]);
    $rotationPool = array_map(static fn($n) => adviceFixture('rotation ' . $n, 'aretology'), range(1, 6));
    $first = genesisDailyAdvice($bob, [], $rotationPool);
    adviceExpect($first['sequence'] === 1 && $first['dailyLimit'] === 3 && $first['canNext'], 'Rotation did not start at 1 of 3');
    $nextPayload = ['fromId' => $first['advice']['id'], 'dayKey' => $first['dayKey']];
    $second = genesisDailyAdvice($bob, $nextPayload, $rotationPool, true);
    adviceExpect($second['sequence'] === 2 && $second['advice']['id'] !== $first['advice']['id'], 'Next did not advance once');
    adviceExpect(genesisDailyAdvice($bob, $nextPayload, $rotationPool, true)['sequence'] === 2, 'A retried next spent another slot');
    adviceExpect(genesisDailyAdvice($bob, [], $rotationPool)['advice']['id'] === $second['advice']['id'], 'A reload rerolled the current advice');
    genesisUpdateAccountPreferences($bob, ['advicePreferences' => ['categories' => GENESIS_ADVICE_CATEGORIES]]);
    $third = genesisDailyAdvice($bob, ['fromId' => $second['advice']['id'], 'dayKey' => $second['dayKey']], $rotationPool, true);
    adviceExpect($third['sequence'] === 3 && !$third['canNext'] && $third['remaining'] === 0, 'The last daily slot remained clickable');
    $limited = genesisDailyAdvice($bob, ['fromId' => $third['advice']['id'], 'dayKey' => $third['dayKey']], $rotationPool, true);
    adviceExpect($limited['sequence'] === 3 && $limited['advice']['id'] === $third['advice']['id'], 'Category toggles or a fourth request bypassed the daily limit');
    adviceExpect((int)$db->query('SELECT COUNT(*) FROM daily_advice_entries WHERE user_id=' . $db->quote($bob))->fetchColumn() === 3, 'Wrong account/day slot count');
    $threeIds = [$first['advice']['id'], $second['advice']['id'], $third['advice']['id']];
    adviceExpect(array_column($limited['history'], 'id') === $threeIds
        && array_column($limited['history'], 'sequence') === [1, 2, 3], 'Today history lost drawn cards or their original order');
    genesisRecordAdvice($bob, ['id' => $threeIds[0], 'dayKey' => $first['dayKey']], false);
    $reopened = genesisDailyAdvice($bob, [], $rotationPool);
    adviceExpect(array_column($reopened['history'], 'id') === $threeIds && $reopened['sequence'] === 3
        && $reopened['advice']['id'] === $threeIds[2] && !$reopened['canNext'], 'Reopening a previous card spent a slot or changed the account pointer');
    adviceExpect(count(array_filter($reopened['history'], static fn($card) => $card['dayKey'] !== $reopened['dayKey'])) === 0,
        'Today carousel exposed another day');
    // The new collection participates in the persisted four-category budget and alternation.
    $db->prepare('DELETE FROM daily_advice_entries WHERE user_id=?')->execute([$bob]);
    $db->prepare('DELETE FROM daily_advice_days WHERE user_id=?')->execute([$bob]);
    $fourCategories = ['aretology', 'hermetica', 'kourotrophy', 'hestiology'];
    $fourPool = array_map(static fn($category) => adviceFixture('four-category ' . $category, $category), $fourCategories);
    genesisUpdateAccountPreferences($bob, ['advicePreferences' => ['enabled' => true, 'smart' => false, 'categories' => $fourCategories]]);
    $fourDraw = genesisDailyAdvice($bob, [], $fourPool); $drawnCategories = [];
    for ($slot = 1; $slot <= 4; $slot++) {
        adviceExpect($fourDraw['dailyLimit'] === 4 && $fourDraw['sequence'] === $slot, 'Four-category selection lost its persisted daily limit');
        $drawnCategories[] = $fourDraw['advice']['categories'][0];
        if ($slot < 4) $fourDraw = genesisDailyAdvice($bob, ['fromId' => $fourDraw['advice']['id'], 'dayKey' => $fourDraw['dayKey']], $fourPool, true);
    }
    adviceExpect(count(array_unique($drawnCategories)) === 4 && !$fourDraw['canNext'], 'Four-category rotation repeated a category or exceeded the daily budget');
    $fifthDraw = genesisDailyAdvice($bob, ['fromId' => $fourDraw['advice']['id'], 'dayKey' => $fourDraw['dayKey']], $fourPool, true);
    adviceExpect($fifthDraw['sequence'] === 4 && $fifthDraw['advice']['id'] === $fourDraw['advice']['id'], 'A fifth draw bypassed the four-category daily budget');
    // Five-card history survives a fresh account read; current age choices still protect earlier cards.
    $db->prepare('DELETE FROM daily_advice_entries WHERE user_id=?')->execute([$bob]);
    $db->prepare('DELETE FROM daily_advice_days WHERE user_id=?')->execute([$bob]);
    $fiveCategories = [...$fourCategories, 'aphrodisia'];
    $fivePool = array_map(static fn($category) => adviceFixture('five-category ' . $category, $category), $fiveCategories);
    $fivePool[4]['requiresAdult'] = true;
    genesisUpdateAccountPreferences($bob, ['advicePreferences' => ['enabled' => true, 'smart' => false,
        'categories' => $fiveCategories, 'aphrodisiaAdult' => true]]);
    $five = genesisDailyAdvice($bob, [], $fivePool); $fiveIds = [];
    for ($slot = 1; $slot <= 5; $slot++) {
        $fiveIds[] = $five['advice']['id'];
        adviceExpect($five['dailyLimit'] === 5 && $five['sequence'] === $slot
            && array_column($five['history'], 'id') === $fiveIds, 'Five-card history did not grow in account order');
        if ($slot < 5) $five = genesisDailyAdvice($bob, ['fromId' => $five['advice']['id'], 'dayKey' => $five['dayKey']], $fivePool, true);
    }
    $fiveReloaded = genesisDailyAdvice($bob, [], $fivePool);
    adviceExpect(array_column($fiveReloaded['history'], 'id') === $fiveIds && $fiveReloaded['sequence'] === 5
        && !$fiveReloaded['canNext'], 'Fresh reads lost the exhausted five-card history');
    genesisUpdateAccountPreferences($bob, ['advicePreferences' => ['aphrodisiaAdult' => false]]);
    $ageSafe = genesisDailyAdvice($bob, [], $fivePool);
    adviceExpect(count($ageSafe['history']) === 4 && $ageSafe['sequence'] === 5
        && count(array_filter($ageSafe['history'], static fn($card) => $card['requiresAdult'] ?? false)) === 0,
        'History bypassed the current age choice or reset the allowance');
    genesisUpdateAccountPreferences($bob, ['advicePreferences' => ['enabled' => false]]);
    adviceExpect(genesisDailyAdvice($bob, [], $fivePool)['history'] === [], 'Disabled advice exposed carousel history');
    genesisUpdateAccountPreferences($bob, ['advicePreferences' => ['enabled' => true]]);
    genesisUpdateAccountPreferences($charlie, ['advicePreferences' => ['smart' => false, 'categories' => ['aretology', 'hestiology']]]);
    $alternatingPool = [adviceFixture('alternate A1', 'aretology'), adviceFixture('alternate H1', 'hestiology'),
        adviceFixture('alternate A2', 'aretology'), adviceFixture('alternate H2', 'hestiology')];
    $alternatingFirst = genesisDailyAdvice($charlie, [], $alternatingPool);
    $alternatingSecond = genesisDailyAdvice($charlie, ['fromId' => $alternatingFirst['advice']['id'], 'dayKey' => $alternatingFirst['dayKey']], $alternatingPool, true);
    $alternatingThird = genesisDailyAdvice($charlie, ['fromId' => $alternatingSecond['advice']['id'], 'dayKey' => $alternatingSecond['dayKey']], $alternatingPool, true);
    adviceExpect(array_intersect($alternatingFirst['advice']['categories'], $alternatingSecond['advice']['categories']) === []
        && array_intersect($alternatingSecond['advice']['categories'], $alternatingThird['advice']['categories']) === [], 'Persisted Next did not alternate categories');
    adviceExpect($alternatingThird['sequence'] === 3 && !$alternatingThird['canNext'] && count(array_unique([
        $alternatingFirst['advice']['id'], $alternatingSecond['advice']['id'], $alternatingThird['advice']['id']])) === 3, 'Category alternation changed the day budget or repeated a post');
    // A saved timed card is replaced when its local period ends, within the same persisted budget.
    $db->prepare('DELETE FROM daily_advice_entries WHERE user_id=?')->execute([$bob]);
    $db->prepare('DELETE FROM daily_advice_days WHERE user_id=?')->execute([$bob]);
    genesisUpdateAccountPreferences($bob, ['advicePreferences' => ['smart' => true]]);
    $hour = (int)(new DateTimeImmutable('now', new DateTimeZone(genesisAdviceTimeZone())))->format('G');
    $expired = [...adviceFixture('expired period', 'hestiology'), 'timeOfDay' => $hour >= 5 && $hour < 12 ? 'evening' : 'morning'];
    $current = adviceFixture('current period', 'hestiology'); $dayKey = genesisAdviceDayKey();
    $selection = json_encode(['enabled' => true, 'smart' => true, 'categories' => ['hestiology']]);
    $db->prepare('INSERT INTO daily_advice_days(user_id,day_key,advice_id,entry_json,created_at,draw_limit,selection_json) VALUES (?,?,?,?,?,3,?)')
        ->execute([$bob, $dayKey, $expired['id'], json_encode($expired), genesisNow(), $selection]);
    $db->prepare('INSERT INTO daily_advice_entries(user_id,day_key,slot,advice_id,entry_json,created_at) VALUES (?,?,1,?,?,?)')
        ->execute([$bob, $dayKey, $expired['id'], json_encode($expired), genesisNow()]);
    $periodResponse = genesisDailyAdvice($bob, [], [$expired, $current]);
    adviceExpect($periodResponse['sequence'] === 2 && $periodResponse['advice']['id'] === $current['id'], 'A timed card remained visible after its local period');
    adviceExpect(genesisDailyAdvice($bob, [], [$expired, $current])['sequence'] === 2, 'Period refresh repeatedly consumed slots');
    $db->prepare('UPDATE daily_advice_days SET advice_id=?,entry_json=?,draw_limit=2 WHERE user_id=?')
        ->execute([$expired['id'], json_encode($expired), $bob]);
    $exhaustedPeriod = genesisDailyAdvice($bob, [], [$expired, $current]);
    adviceExpect($exhaustedPeriod['advice'] === null && $exhaustedPeriod['sequence'] === 2 && !$exhaustedPeriod['canNext'], 'An expired timed card bypassed the exhausted budget');
    $priorHistory = genesisDailyAdvice($charlie, [], $alternatingPool);
    genesisUpdateAccountPreferences($charlie, ['advicePreferences' => ['collections' => ['philosophers']]]);
    adviceExpect(genesisUserForClient(genesisFindUser($charlie))['advicePreferences']['collections'] === ['philosophers'], 'Account did not retain philosopher selection');
    $noAphorisms = genesisDailyAdvice($charlie, [], $alternatingPool);
    adviceExpect($noAphorisms['advice'] === null && $noAphorisms['history'] === [] && $noAphorisms['sequence'] === 3, 'Collection change erased history, changed allowance or substituted texts');
    genesisUpdateAccountPreferences($charlie, ['advicePreferences' => ['collections' => ['aurora', 'philosophers']]]);
    $backToBoth = genesisDailyAdvice($charlie, [], $alternatingPool);
    adviceExpect(array_column($backToBoth['history'],'id') === array_column($priorHistory['history'],'id'), 'Reselecting Aurora lost already drawn cards');
    // Collection budgets count immutable stored snapshots, including hidden cards after switches.
    foreach (['daily_advice_entries', 'daily_advice_days'] as $table) $db->prepare("DELETE FROM $table WHERE user_id=?")->execute([$alice]);
    $mixedPool = [];
    for ($n = 0; $n < 8; $n++) {
        $mixedPool[] = adviceFixture('separate Aurora allowance ' . $n, 'aretology');
        $mixedPool[] = [...adviceFixture('separate aphorism allowance ' . $n, 'aretology'), 'id' => $readyAphorismIds[$n], 'categories' => [], 'collection' => 'philosophers'];
    }
    genesisUpdateAccountPreferences($alice, ['language' => 'en', 'advicePreferences' => ['enabled' => true, 'smart' => false,
        'categories' => ['aretology'], 'collections' => ['aurora', 'philosophers']]]);
    $mixedDay = genesisDailyAdvice($alice, [], $mixedPool);
    for ($slot = 1; $slot <= 4; $slot++) {
        adviceWireCompatible($mixedDay);
        adviceExpect($mixedDay['sequence'] === $slot && $mixedDay['dailyLimit'] === 4, 'Mixed mode lost its three Aurora slots plus one aphorism');
        if ($slot < 4) $mixedDay = genesisDailyAdvice($alice, ['fromId' => $mixedDay['advice']['id'], 'dayKey' => $mixedDay['dayKey']], $mixedPool, true);
    }
    $sources = array_count_values(array_column($mixedDay['history'], 'collection'));
    adviceExpect(($sources['aurora'] ?? 0) === 3 && ($sources['philosophers'] ?? 0) === 1 && !$mixedDay['canNext'] && $mixedDay['remaining'] === 0,
        'Mixed mode exceeded or replaced a collection allowance');
    adviceExpect((int)$db->query('SELECT draw_limit FROM daily_advice_days WHERE user_id=' . $db->quote($alice))->fetchColumn() === 3,
        'Combined allowance overwrote the frozen Aurora budget');
    $replayedMixed = genesisDailyAdvice($alice, ['fromId' => $mixedDay['advice']['id'], 'dayKey' => $mixedDay['dayKey']], $mixedPool, true);
    adviceExpect($replayedMixed['sequence'] === 4 && $replayedMixed['advice']['id'] === $mixedDay['advice']['id'], 'Retry bypassed collection budgets');
    genesisUpdateAccountPreferences($alice, ['advicePreferences' => ['collections' => ['philosophers'], 'philosophersPerDay' => 3]]);
    $onlyQuotes = genesisDailyAdvice($alice, [], $mixedPool); adviceWireCompatible($onlyQuotes);
    for ($attempt = 0; $attempt < 6 && $onlyQuotes['canNext']; $attempt++) {
        $onlyQuotes = genesisDailyAdvice($alice, ['fromId' => $onlyQuotes['advice']['id'], 'dayKey' => $onlyQuotes['dayKey']], $mixedPool, true);
        adviceWireCompatible($onlyQuotes);
    }
    adviceExpect(count($onlyQuotes['history']) === 3 && $onlyQuotes['sequence'] === 6
        && count(array_unique(array_column($onlyQuotes['history'], 'id'))) === 3, 'Disabling Aurora reset usage instead of allowing only two remaining aphorisms');
    foreach ([['aurora', 'philosophers'], ['aurora'], ['philosophers']] as $selection) {
        genesisUpdateAccountPreferences($alice, ['advicePreferences' => ['collections' => $selection]]);
        $switched = genesisDailyAdvice($alice, [], $mixedPool); adviceWireCompatible($switched);
        adviceExpect(!$switched['canNext'] && $switched['sequence'] === 6, 'Source toggles reset spent account/day slots');
    }
    // A frozen historical Aurora budget of six must still leave an aphorism opportunity.
    foreach (['daily_advice_entries', 'daily_advice_days'] as $table) $db->prepare("DELETE FROM $table WHERE user_id=?")->execute([$bob]);
    genesisUpdateAccountPreferences($bob, ['language' => 'en', 'advicePreferences' => ['enabled' => true, 'smart' => false,
        'categories' => ['aretology'], 'collections' => ['aurora']]]);
    $six = genesisDailyAdvice($bob, [], $mixedPool);
    $db->prepare('UPDATE daily_advice_days SET draw_limit=6 WHERE user_id=?')->execute([$bob]);
    for ($slot = 2; $slot <= 5; $slot++) {
        $six = genesisDailyAdvice($bob, ['fromId' => $six['advice']['id'], 'dayKey' => $six['dayKey']], $mixedPool, true);
        adviceWireCompatible($six); adviceExpect($six['sequence'] === $slot, 'Frozen six-card Aurora budget stopped advancing');
    }
    $fiveAuroraIds = array_column($six['history'], 'id');
    genesisUpdateAccountPreferences($bob, ['advicePreferences' => ['collections' => ['aurora', 'philosophers']]]);
    $six = genesisDailyAdvice($bob, ['fromId' => $six['advice']['id'], 'dayKey' => $six['dayKey']], $mixedPool, true);
    adviceWireCompatible($six);
    adviceExpect($six['sequence'] === 6 && $six['dailyLimit'] === 6 && !$six['canNext']
        && $six['advice']['collection'] === 'philosophers' && array_slice(array_column($six['history'], 'id'), 0, 5) === $fiveAuroraIds,
        'The final shared slot failed to preserve history and provide the first aphorism');
    adviceExpect((int)$db->query('SELECT draw_limit FROM daily_advice_days WHERE user_id=' . $db->quote($bob))->fetchColumn() === 6,
        'Shared cap rewrote the original six-card Aurora budget');
    // Reservation outranks an otherwise leading lunar preparation only in the final slot.
    $lastAurora = [...adviceFixture('reserved scheduled Aurora', 'aretology'), 'schedule' => ['phases' => ['new'], 'leadDays' => [1]]];
    $aphorism = [...adviceFixture('reserved final aphorism', 'aretology'), 'id' => $readyAphorismIds[0], 'categories' => [], 'collection' => 'philosophers'];
    $both = genesisAdvicePreferences(['smart' => false, 'categories' => ['aretology'], 'collections' => ['aurora', 'philosophers']]);
    adviceExpect(genesisChooseAdvice([$lastAurora, $aphorism], $both, [], [], 'final-slot', [], ['new' => 1],
        ['excluded' => $fiveAuroraIds, 'reservePhilosopher' => true])['id'] === $aphorism['id'], 'Scheduled Aurora starved the reserved aphorism slot');
    adviceExpect(genesisChooseAdvice([$lastAurora], $both, [], [], 'final-slot', [], ['new' => 1],
        ['excluded' => $fiveAuroraIds, 'reservePhilosopher' => true])['id'] === $lastAurora['id'], 'Missing eligible aphorism stranded a usable Aurora slot');
    // Six already consumed Aurora cards cannot be bypassed by enabling philosophers afterward.
    foreach (['daily_advice_entries', 'daily_advice_days'] as $table) $db->prepare("DELETE FROM $table WHERE user_id=?")->execute([$bob]);
    genesisUpdateAccountPreferences($bob, ['advicePreferences' => ['collections' => ['aurora']]]);
    $sixAurora = genesisDailyAdvice($bob, [], $mixedPool);
    $db->prepare('UPDATE daily_advice_days SET draw_limit=6 WHERE user_id=?')->execute([$bob]);
    for ($slot = 2; $slot <= 6; $slot++) {
        $sixAurora = genesisDailyAdvice($bob, ['fromId' => $sixAurora['advice']['id'], 'dayKey' => $sixAurora['dayKey']], $mixedPool, true);
        adviceWireCompatible($sixAurora); adviceExpect($sixAurora['sequence'] === $slot, 'Aurora-only mode lost its original six-card budget');
    }
    $spentIds = array_column($sixAurora['history'], 'id');
    genesisUpdateAccountPreferences($bob, ['advicePreferences' => ['collections' => ['aurora', 'philosophers']]]);
    $spent = genesisDailyAdvice($bob, ['fromId' => $sixAurora['advice']['id'], 'dayKey' => $sixAurora['dayKey']], $mixedPool, true);
    adviceWireCompatible($spent);
    adviceExpect(!$spent['canNext'] && $spent['sequence'] === 6 && array_column($spent['history'], 'id') === $spentIds,
        'Collection change created a seventh slot or changed an existing snapshot');
    genesisUpdateAccountPreferences($bob, ['advicePreferences' => ['collections' => ['philosophers'], 'philosophersPerDay' => 3]]);
    $spent = genesisDailyAdvice($bob, [], $mixedPool); adviceWireCompatible($spent);
    adviceExpect($spent['advice'] === null && $spent['history'] === [] && $spent['sequence'] === 6 && !$spent['canNext'],
        'Hidden Aurora cards stopped counting toward the shared cap');
    $tomorrow = (new DateTimeImmutable('now', new DateTimeZone(genesisAdviceTimeZone())))->modify('+1 day');
    $quoteDay = genesisDailyAdvice($bob, [], $mixedPool, false, $tomorrow);
    for ($slot = 1; $slot <= 3; $slot++) {
        adviceWireCompatible($quoteDay);
        adviceExpect($quoteDay['dailyLimit'] === 3 && $quoteDay['sequence'] === $slot
            && $quoteDay['advice']['collection'] === 'philosophers', 'New local day did not provide three distinct aphorisms');
        if ($slot < 3) $quoteDay = genesisDailyAdvice($bob, ['fromId' => $quoteDay['advice']['id'], 'dayKey' => $quoteDay['dayKey']], $mixedPool, true, $tomorrow);
    }
    adviceExpect(!$quoteDay['canNext'] && $quoteDay['remaining'] === 0 && count($quoteDay['history']) === 3, 'A fourth daily aphorism remained available');
    // Old snapshots gain their stable artwork only in responses, including read-only saved targets.
    foreach (['daily_advice_entries', 'daily_advice_days'] as $table) $db->prepare("DELETE FROM $table WHERE user_id=?")->execute([$bob]);
    $illustratedQuote = array_values(array_filter(genesisAdviceCatalog(), static fn($entry) => $entry['collection'] === 'philosophers' && isset($entry['image'])))[0];
    genesisUpdateAccountPreferences($bob, ['language' => 'ru']);
    $illustratedDay = genesisDailyAdvice($bob, [], [$illustratedQuote]);
    $legacyQuote = $illustratedQuote; unset($legacyQuote['image']); $legacySnapshot = json_encode($legacyQuote, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    foreach (['daily_advice_entries', 'daily_advice_days'] as $table) $db->prepare("UPDATE $table SET entry_json=? WHERE user_id=?")->execute([$legacySnapshot, $bob]);
    $target = ['id' => $illustratedQuote['id'], 'dayKey' => $illustratedDay['dayKey'], 'collection' => 'philosophers'];
    for ($attempt = 0; $attempt < 2; $attempt++) {
        $savedQuote = genesisSavedAdvice($bob, $target);
        adviceExpect($savedQuote['advice']['image'] === $illustratedQuote['image'] && $savedQuote['sequence'] === 1
            && $savedQuote['advice']['body'] === $illustratedDay['advice']['body'] && !$savedQuote['canNext'], 'Saved historical quote lost artwork, text or slot identity');
    }
    $illustratedReplay = genesisDailyAdvice($bob, [], [$illustratedQuote]); adviceWireCompatible($illustratedReplay);
    adviceExpect($illustratedReplay['advice']['image'] === $illustratedQuote['image'] && $illustratedReplay['sequence'] === 1,
        'Historical daily replay failed to resolve stable artwork');
    adviceExpect($db->query('SELECT entry_json FROM daily_advice_entries WHERE user_id=' . $db->quote($bob))->fetchColumn() === $legacySnapshot
        && (int)$db->query('SELECT COUNT(*) FROM daily_advice_entries WHERE user_id=' . $db->quote($bob))->fetchColumn() === 1,
        'Artwork projection rewrote a stored snapshot or spent another slot');
    // Pausing unfinished artwork hides old snapshots without deleting them or refunding slots.
    $unfinishedQuote = [...$illustratedQuote, 'id' => 'advice-' . substr(hash('sha256', 'unfinished-historical-artwork-fixture'), 0, 24)];
    unset($unfinishedQuote['image']);
    adviceExpect(!isset(genesisPhilosopherArtwork()[$unfinishedQuote['id']]), 'Unfinished fixture unexpectedly has artwork');
    $unfinishedSnapshot = json_encode($unfinishedQuote, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    foreach (['daily_advice_entries', 'daily_advice_days'] as $table) $db->prepare("UPDATE $table SET advice_id=?,entry_json=? WHERE user_id=?")->execute([$unfinishedQuote['id'], $unfinishedSnapshot, $bob]);
    $unfinishedTarget = ['id' => $unfinishedQuote['id'], 'dayKey' => $illustratedDay['dayKey'], 'collection' => 'philosophers'];
    adviceExpect(genesisSavedAdvice($bob, $unfinishedTarget)['advice'] === null, 'Saved target exposed unfinished artwork');
    $unfinishedReplay = genesisDailyAdvice($bob, [], [$unfinishedQuote]);
    adviceExpect($unfinishedReplay['advice'] === null && $unfinishedReplay['history'] === [] && $unfinishedReplay['sequence'] === 1
        && !$unfinishedReplay['canNext'], 'Unfinished snapshot replayed or refunded its spent slot');
    adviceExpect($db->query('SELECT entry_json FROM daily_advice_entries WHERE user_id=' . $db->quote($bob))->fetchColumn() === $unfinishedSnapshot
        && $db->query('SELECT entry_json FROM daily_advice_days WHERE user_id=' . $db->quote($bob))->fetchColumn() === $unfinishedSnapshot,
        'Hiding unfinished artwork changed persisted snapshots');
    $readyReplacement = genesisDailyAdvice($bob, [], [$illustratedQuote]);
    adviceExpect($readyReplacement['sequence'] === 2 && array_column($readyReplacement['history'], 'id') === [$illustratedQuote['id']]
        && (int)$db->query('SELECT COUNT(*) FROM daily_advice_entries WHERE user_id=' . $db->quote($bob))->fetchColumn() === 2,
        'Ready replacement erased an unfinished snapshot or its spent slot');
    $db->prepare('DELETE FROM users WHERE id=?')->execute([$alice]);
    adviceExpect((int)$db->query("SELECT COUNT(*) FROM daily_advice_days WHERE user_id=" . $db->quote($alice))->fetchColumn() === 0, 'Account removal retained advice history');
    $_SERVER['HTTP_X_GENESIS_TIME_ZONE'] = 'Pacific/Kiritimati';
    adviceExpect(genesisAdviceDayKey() === (new DateTimeImmutable('now', new DateTimeZone('Pacific/Kiritimati')))->format('Y-m-d'), 'Server ignored the device day');
    $_SERVER['HTTP_X_GENESIS_TIME_ZONE'] = 'invalid';
    adviceExpect(genesisAdviceDayKey() === (new DateTimeImmutable('now', new DateTimeZone('Europe/Moscow')))->format('Y-m-d'), 'Invalid time zone had no safe fallback');
    echo "Daily advice: backup, additive rollback, preferences, empty corpus, ranking cycles, category alternation, new content, manual/smart selection, daily replay, view acknowledgement, account isolation, dismissal, separate collection allowances, six-slot reservation/wire compatibility, no-reset switches, historical artwork projection and cascade passed.\n";
} finally {
    foreach ($ids as $id) $db->prepare('DELETE FROM users WHERE id=?')->execute([$id]);
}
