<?php
declare(strict_types=1);
require_once __DIR__ . '/calendar.php';
require_once __DIR__ . '/advice-age-access.php';

const GENESIS_ADVICE_CATEGORIES = ['aretology', 'hermetica', 'kourotrophy', 'hestiology', 'aphrodisia', 'psychopompia'];
const GENESIS_ADVICE_COLLECTIONS = ['aurora', 'philosophers'];
const GENESIS_ADVICE_LANGUAGES = ['ru', 'en', 'el', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'sr', 'uk', 'zh', 'tr', 'ja'];
const GENESIS_ADVICE_TOPICS = ['nutrition', 'training', 'recovery', 'discipline', 'clothing', 'attributes', 'cleaning', 'home_order', 'parenting', 'sons', 'heritage', 'fatherhood', 'motherhood'];

function genesisAdviceNotificationPreferences(mixed $value): array
{
    $value = is_string($value) ? json_decode($value, true, 16, JSON_THROW_ON_ERROR) : $value;
    if (!is_array($value) || array_diff(array_keys($value), ['enabled','time','timeZone']))
        throw new InvalidArgumentException('INVALID_ADVICE_NOTIFICATIONS');
    $result = array_replace(['enabled'=>false,'time'=>'09:00','timeZone'=>genesisAdviceTimeZone()],$value);
    if (!is_bool($result['enabled']) || !is_string($result['time']) || !preg_match('/\A(?:[01][0-9]|2[0-3]):[0-5][0-9]\z/D',$result['time'])
        || !is_string($result['timeZone']) || !in_array($result['timeZone'],DateTimeZone::listIdentifiers(DateTimeZone::ALL_WITH_BC),true))
        throw new InvalidArgumentException('INVALID_ADVICE_NOTIFICATIONS');
    return $result;
}

function genesisAdvicePreferences(mixed $value): array
{
    $value = is_string($value) ? json_decode($value, true, 16, JSON_THROW_ON_ERROR) : $value;
    if (!is_array($value) || array_diff(array_keys($value), ['enabled', 'smart', 'categories', 'aphrodisiaAdult', 'collections', 'philosophersPerDay', 'notifications', 'psychopompia'])) {
        throw new InvalidArgumentException('INVALID_ADVICE_PREFERENCES');
    }
    if (array_key_exists('notifications',$value)&&!is_array($value['notifications'])) throw new InvalidArgumentException('INVALID_ADVICE_NOTIFICATIONS');
    if (array_key_exists('psychopompia',$value)&&!is_array($value['psychopompia'])) throw new InvalidArgumentException('INVALID_PSYCHOPOMPIA_PREFERENCES');
    $result = ['enabled' => $value['enabled'] ?? true, 'smart' => $value['smart'] ?? true,
        'categories' => $value['categories'] ?? array_values(array_diff(GENESIS_ADVICE_CATEGORIES, ['aphrodisia'])),
        'aphrodisiaAdult' => $value['aphrodisiaAdult'] ?? null, 'collections' => $value['collections'] ?? ['aurora'],
        'philosophersPerDay' => $value['philosophersPerDay'] ?? 1,
        'notifications' => genesisAdviceNotificationPreferences($value['notifications'] ?? []),
        'psychopompia' => genesisPsychopompiaPreferences($value['psychopompia'] ?? [])];
    if (!is_int($result['philosophersPerDay']) || $result['philosophersPerDay'] < 1 || $result['philosophersPerDay'] > 3)
        throw new InvalidArgumentException('INVALID_ADVICE_PREFERENCES');
    if (!is_array($result['collections']) || !array_is_list($result['collections']) || $result['collections'] === []
        || array_filter($result['collections'], static fn($id) => !is_string($id) || !in_array($id, GENESIS_ADVICE_COLLECTIONS, true))) {
        throw new InvalidArgumentException('INVALID_ADVICE_COLLECTIONS');
    }
    $result['collections'] = array_values(array_intersect(GENESIS_ADVICE_COLLECTIONS, $result['collections']));
    if (!is_bool($result['enabled']) || !is_bool($result['smart']) || ($result['aphrodisiaAdult'] !== null && !is_bool($result['aphrodisiaAdult'])) || !is_array($result['categories'])
        || !array_is_list($result['categories']) || array_filter($result['categories'],
            static fn($id) => !is_string($id) || !in_array($id, GENESIS_ADVICE_CATEGORIES, true))) {
        throw new InvalidArgumentException('INVALID_ADVICE_PREFERENCES');
    }
    $result['categories'] = array_values(array_unique($result['categories']));
    if (!$result['smart'] && $result['categories'] === []) throw new InvalidArgumentException('ADVICE_CATEGORY_REQUIRED');
    if ($result['aphrodisiaAdult'] === null) $result['categories'] = array_values(array_diff($result['categories'], ['aphrodisia']));
    if ($result['categories'] === []) $result['categories'] = array_values(array_diff(GENESIS_ADVICE_CATEGORIES, ['aphrodisia']));
    return $result;
}

function genesisUserAdvicePreferences(array $user): array
{
    $preferences = genesisAdvicePreferences($user['advice_preferences_json'] ?? '{}');
    $preferences = genesisAdvicePreferences([...$preferences, 'collections' => json_decode($user['advice_collections_json'] ?? '["aurora"]', true, 16, JSON_THROW_ON_ERROR)]);
    $preferences['notifications'] = genesisAdviceNotificationPreferences($user['advice_notifications_json'] ?? '{}');
    $preferences['psychopompia'] = genesisPsychopompiaPreferences($user['advice_psychopompia_json'] ?? '{}');
    $preferences['philosophersPerDay'] = (int)($user['advice_philosophers_per_day'] ?? 1);
    if (function_exists('genesisFeatureAccessForUser')) {
        $access = genesisFeatureAccessForUser($user);
        if ($access['enforcementEnabled'] && !in_array('advice-settings',$access['allowedFeatures'],true))
            $preferences = [...$preferences,'smart'=>true,'categories'=>array_values(array_diff(GENESIS_ADVICE_CATEGORIES,['aphrodisia','psychopompia'])),'aphrodisiaAdult'=>null];
    }
    return $preferences;
}

/** Artwork is deployed with code and is keyed only by the quote's stable identity. */
function genesisPhilosopherArtwork(): array
{
    static $images;
    if (is_array($images)) return $images;
    $manifest = json_decode((string)file_get_contents(dirname(__DIR__) . '/content/philosopher-aphorisms-artwork.json'), true, 8, JSON_THROW_ON_ERROR);
    if (($manifest['version'] ?? null) !== 1 || !is_array($manifest['images'] ?? null)) throw new RuntimeException('INVALID_PHILOSOPHER_ARTWORK');
    foreach ($manifest['images'] as $id => $path) {
        if (!is_string($id) || preg_match('/\Aadvice-[a-f0-9]{24}\z/D', $id) !== 1
            || $path !== '/advice-art/philosophers/' . $id . '.webp') throw new RuntimeException('INVALID_PHILOSOPHER_ARTWORK');
    }
    return $images = $manifest['images'];
}

/** The corpus is deployed with code; requests can never provide a file path or an advice body. */
function genesisAdviceCatalog(): array
{
    static $items;
    if (is_array($items)) return $items;
    $items = []; $ids = [];
    foreach (['aurora' => 'daily-advice.json', 'philosophers' => 'philosopher-aphorisms.json'] as $collection => $file) {
    $catalog = json_decode(file_get_contents(dirname(__DIR__) . '/content/' . $file), true, 32, JSON_THROW_ON_ERROR);
    if (($catalog['version'] ?? null) !== 1 || !is_array($catalog['items'] ?? null)) throw new RuntimeException('INVALID_ADVICE_CATALOG');
    foreach ($catalog['items'] as $entry) {
        if (!is_array($entry) || !is_string($entry['id'] ?? null) || !preg_match('/^advice-[a-f0-9]{24}$/D', $entry['id'])
            || isset($ids[$entry['id']]) || !is_string($entry['body'] ?? null) || trim($entry['body']) === ''
            || strlen($entry['body']) > 24000 || !is_array($entry['categories'] ?? null) || ($collection === 'aurora' && $entry['categories'] === [])
            || array_diff($entry['categories'], GENESIS_ADVICE_CATEGORIES)
            || !is_string($entry['language'] ?? null) || !is_array($entry['sources'] ?? null)) {
            throw new RuntimeException('INVALID_ADVICE_CATALOG_ENTRY');
        }
        if (isset($entry['contentVersion'])) {
            if (!is_string($entry['contentVersion']) || !preg_match('/^[a-z0-9-]{1,80}$/D', $entry['contentVersion'])
                || !is_string($entry['title'] ?? null) || trim($entry['title']) === '' || strlen($entry['title']) > 2000
                || !is_string($entry['image'] ?? null)
                || !preg_match('~^/advice-art/[a-z0-9-]+/advice-[a-f0-9]{24}\.webp$~D', $entry['image'])
                || !is_array($entry['topics'] ?? null) || array_diff($entry['topics'], GENESIS_ADVICE_TOPICS)
                || !in_array($entry['status'] ?? 'published', ['published', 'draft'], true)) {
                throw new RuntimeException('INVALID_ADVICE_CONTENT');
            }
        }
        if (isset($entry['translationVersion']) && ($collection !== 'philosophers'
            || !is_string($entry['translationVersion']) || preg_match('/\Aphilosophers-[a-z0-9-]{1,70}\z/D',$entry['translationVersion'])!==1
            || !is_string($entry['sourceId']??null))) throw new RuntimeException('INVALID_PHILOSOPHER_CONTENT');
        if (isset($entry['schedule']) && (!is_array($entry['schedule'])
            || !is_array($entry['schedule']['phases'] ?? null) || $entry['schedule']['phases'] === []
            || array_diff($entry['schedule']['phases'], ['new', 'full'])
            || !is_array($entry['schedule']['leadDays'] ?? null) || $entry['schedule']['leadDays'] === []
            || array_filter($entry['schedule']['leadDays'], static fn($day) => !is_int($day) || $day < 1 || $day > 3))) {
            throw new RuntimeException('INVALID_ADVICE_SCHEDULE');
        }
        if (isset($entry['timeOfDay']) && !in_array($entry['timeOfDay'], ['morning', 'evening'], true)) throw new RuntimeException('INVALID_ADVICE_TIME');
        if (isset($entry['priority']) && !is_bool($entry['priority'])) throw new RuntimeException('INVALID_ADVICE_PRIORITY');
        if (in_array('aphrodisia', $entry['categories'], true) && (!is_bool($entry['requiresAdult'] ?? null)
            || !in_array($entry['aphrodisiaTheme'] ?? null, ['love', 'aesthetics', 'consciousness'], true))) {
            throw new RuntimeException('INVALID_APHRODISIA_CONTENT');
        }
        $ids[$entry['id']] = true;
        if ($collection === 'philosophers') {
            // The full corpus is retained, but only completed individual artwork is published.
            if (!isset(genesisPhilosopherArtwork()[$entry['id']])) continue;
            $entry['image'] = genesisPhilosopherArtwork()[$entry['id']];
        }
        if (in_array('psychopompia',$entry['categories'],true)) {
            if (($entry['requiresAdult']??null)!==true||!is_bool($entry['containsAlcohol']??null)
                ||!is_array($entry['subcategories']??null)||!array_is_list($entry['subcategories'])||$entry['subcategories']===[]
                ||array_filter($entry['subcategories'],static fn($id)=>!is_string($id))||array_diff($entry['subcategories'],array_column(genesisAdviceAgePolicy()['subcategories'],'id'))
                ||!in_array($entry['review']['status']??null,['unreviewed','blocked','cleared'],true)) throw new RuntimeException('INVALID_PSYCHOPOMPIA_CONTENT');
            if (!genesisAdviceAgePolicy()['corpusEnabled']||($entry['status']??null)!=='published'||$entry['review']['status']!=='cleared') continue;
        }
        if (($entry['status'] ?? 'published') !== 'draft') $items[] = [...$entry, 'collection' => $collection];
    }
    }
    return $items;
}

function genesisAdviceAvailableCategories(?array $items = null): array
{
    $present = [];
    foreach ($items ?? genesisAdviceCatalog() as $entry) {
        if (($entry['status'] ?? 'published') !== 'draft') $present = [...$present, ...$entry['categories']];
    }
    return array_values(array_intersect(GENESIS_ADVICE_CATEGORIES, $present));
}

/** Use the server clock and the existing device time-zone header, never a client date. */
function genesisAdviceTimeZone(): string
{
    $zone = $_SERVER['HTTP_X_GENESIS_TIME_ZONE'] ?? 'Europe/Moscow';
    if (!is_string($zone) || !in_array($zone, DateTimeZone::listIdentifiers(DateTimeZone::ALL_WITH_BC), true)) {
        $zone = 'Europe/Moscow';
    }
    return $zone;
}

function genesisAdviceDayKey(): string
{
    return (new DateTimeImmutable('now', new DateTimeZone(genesisAdviceTimeZone())))->format('Y-m-d');
}

function genesisAdviceScores(mixed $value): array
{
    if (!is_array($value) || array_diff(array_keys($value), GENESIS_ADVICE_CATEGORIES)) throw new InvalidArgumentException('INVALID_ADVICE_CONTEXT');
    $scores = [];
    foreach (GENESIS_ADVICE_CATEGORIES as $id) {
        $score = $value[$id] ?? 0;
        if ((!is_int($score) && !is_float($score)) || !is_finite((float)$score) || $score < 0 || $score > 1000) {
            throw new InvalidArgumentException('INVALID_ADVICE_CONTEXT');
        }
        $scores[$id] = (float)$score;
    }
    return $scores;
}

function genesisAdviceTopicScores(mixed $value): array
{
    if (!is_array($value) || array_diff(array_keys($value), GENESIS_ADVICE_TOPICS)) throw new InvalidArgumentException('INVALID_ADVICE_CONTEXT');
    $scores = [];
    foreach (GENESIS_ADVICE_TOPICS as $id) {
        $score = $value[$id] ?? 0;
        if ((!is_int($score) && !is_float($score)) || !is_finite((float)$score) || $score < 0 || $score > 1000) {
            throw new InvalidArgumentException('INVALID_ADVICE_CONTEXT');
        }
        $scores[$id] = (float)$score;
    }
    return $scores;
}

/** Lunar windows use civil dates in the device zone and the server's existing ephemeris. */
function genesisAdvicePhaseLeads(string $day, string $zone): array
{
    $data = genesisCalendarEphemeris(); $leads = [];
    $start = genesisCalendarDate($day)->getTimestamp() * 1000 - 36 * 3600000;
    foreach (['new' => 'newMoons', 'full' => 'fullMoons'] as $phase => $key) {
        $moments = $data[$key]; $low = 0; $high = count($moments);
        while ($low < $high) {
            $mid = intdiv($low + $high, 2);
            if ($moments[$mid] < $start) $low = $mid + 1; else $high = $mid;
        }
        for ($i = $low; isset($moments[$i]) && $moments[$i] <= $start + 6 * 86400000; $i++) {
            $eventDay = genesisCalendarEventDate($moments[$i], ['timeZone' => $zone]);
            $lead = genesisCalendarDayNumber($eventDay) - genesisCalendarDayNumber($day);
            if ($lead >= 1 && $lead <= 3) $leads[$phase] = $lead;
        }
    }
    return $leads;
}

function genesisAdviceScheduledFor(array $entry, array $phaseLeads): bool
{
    if (!isset($entry['schedule'])) return true;
    foreach ($entry['schedule']['phases'] as $phase) {
        if (in_array($phaseLeads[$phase] ?? null, $entry['schedule']['leadDays'], true)) return true;
    }
    return false;
}

/** New/full moon preparations share one daily place across all advice categories. */
function genesisAdviceLunarPreparation(array $entry): bool
{
    return array_intersect($entry['schedule']['phases'] ?? [], ['new', 'full']) !== [];
}

/** Unseen posts lead; then the least recently viewed eligible post starts the next turn. */
function genesisAdviceTimeMatches(array $entry, int $hour): bool
{
    return match ($entry['timeOfDay'] ?? '') {
        'morning' => $hour >= 5 && $hour < 12,
        'evening' => $hour >= 18 || $hour < 5,
        default => true,
    };
}

function genesisAdviceClothing(array $entry): bool
{
    return array_intersect($entry['topics'] ?? [], ['clothing', 'attributes']) !== [];
}

function genesisAdviceDailyLimit(array $preferences, array $items): int
{
    $available = genesisAdviceAvailableCategories(array_values(array_filter($items,
        static fn($entry) => genesisAdviceAgeAllowed($entry, $preferences) && genesisAdviceCollectionAllowed($entry, $preferences))));
    return min(6, max(3, count($preferences['smart'] ? $available : array_intersect($available, $preferences['categories']))));
}

/** The philosopher allowance is additional to the Aurora category allowance. */
function genesisAdviceCollectionLimits(array $preferences, array $items, int $auroraLimit, ?int $packageLimit): array
{
    $present = [];
    foreach ($items as $entry) {
        if (($entry['status'] ?? 'published') !== 'draft' && genesisAdviceAgeAllowed($entry, $preferences))
            $present[$entry['collection'] ?? 'aurora'] = true;
    }
    $aurora = in_array('aurora', $preferences['collections'], true);
    return [
        'aurora' => $aurora && isset($present['aurora']) ? min($auroraLimit, $packageLimit ?? $auroraLimit) : 0,
        'philosophers' => in_array('philosophers', $preferences['collections'], true) && isset($present['philosophers']) ? ($preferences['philosophersPerDay'] ?? 1) : 0,
    ];
}

/** Interest signals only: no gender, names, family profile or task text is sent or stored. */
function genesisAdviceFamilyAffinity(array $topics): float
{
    $parenting = $topics['parenting'] ?? 0;
    $sons = $topics['sons'] ?? 0;
    $fatherhood = $topics['fatherhood'] ?? 0;
    $motherhood = $topics['motherhood'] ?? 0;
    $interest = log(1 + $parenting + $sons + $fatherhood);
    if ($fatherhood > 0) $interest += 1.5;
    if ($sons > 0) $interest += 0.75;
    // Maternal interests keep access to the same collection, at a lower priority.
    if ($motherhood > 0 && $fatherhood <= 0) $interest = $interest * 0.3 - 1;
    return $interest;
}

function genesisAdviceAgeAllowed(array $entry, array $preferences): bool
{
    if (in_array('psychopompia',$entry['categories'],true)) {
        if (in_array('aphrodisia',$entry['categories'],true)&&(!in_array('aphrodisia',$preferences['categories'],true)||($preferences['aphrodisiaAdult']??null)!==true)) return false;
        return genesisPsychopompiaAllowed($entry,$preferences);
    }
    if (($entry['containsAlcohol']??false)===true) return false; // Missing/mistagged alcohol metadata cannot bypass the new gate.
    if (($entry['requiresAdult']??false)===true&&!in_array('aphrodisia',$entry['categories'],true)) return false;
    // Missing metadata in a historical Aphrodisia snapshot fails closed.
    return !in_array('aphrodisia', $entry['categories'], true)
        || (in_array('aphrodisia', $preferences['categories'], true) && ($preferences['aphrodisiaAdult'] ?? null) !== null
            && (($entry['requiresAdult'] ?? true) === false || $preferences['aphrodisiaAdult'] === true));
}

function genesisAdviceCollectionAllowed(array $entry, array $preferences): bool
{
    $collection = $entry['collection'] ?? 'aurora';
    return in_array($collection, $preferences['collections'] ?? ['aurora'], true)
        && ($collection !== 'philosophers' || isset(genesisPhilosopherArtwork()[$entry['id']]));
}

function genesisChooseAdvice(array $items, array $preferences, array $scores, array $history, string $seed,
    array $topicScores = [], ?array $phaseLeads = null, array $localContext = []): ?array
{
    $available = genesisAdviceAvailableCategories($items);
    $categories = $preferences['smart'] ? $available
        : array_values(array_intersect($available, $preferences['categories']));
    // Match the settings' effective selection when an older account selected only unpublished categories.
    if ($categories === []) $categories = $preferences['smart'] ? $available : array_slice($available, 0, 1);
    if (!in_array('aphrodisia', $preferences['categories'], true) || ($preferences['aphrodisiaAdult'] ?? null) === null) {
        $categories = array_values(array_diff($categories, ['aphrodisia']));
    }
    $phaseLeads ??= genesisAdvicePhaseLeads($localContext['day'] ?? genesisAdviceDayKey(), $localContext['timeZone'] ?? genesisAdviceTimeZone());
    $day = $localContext['day'] ?? genesisAdviceDayKey();
    $hour = $localContext['hour'] ?? (int)(new DateTimeImmutable('now', new DateTimeZone(genesisAdviceTimeZone())))->format('G');
    $excluded = $localContext['excluded'] ?? [];
    $excludedCategories = $localContext['excludedCategories'] ?? [];
    // Count issued snapshots as well as viewed history: dismissal, an unacknowledged
    // card or a switch of collection/language must not reset the shared topic limit.
    $lunarAlreadyDrawn = false;
    foreach ($localContext['issuedToday'] ?? [] as $entry) {
        if (genesisAdviceLunarPreparation($entry)) { $lunarAlreadyDrawn = true; break; }
    }
    foreach ($history as $row) {
        if ($row['day_key'] === $day && genesisAdviceLunarPreparation(json_decode($row['entry_json'], true, 32, JSON_THROW_ON_ERROR))) {
            $lunarAlreadyDrawn = true; break;
        }
    }
    // Also resolve IDs against current metadata for older issued snapshots.
    foreach ($items as $entry) {
        if (in_array($entry['id'], $excluded, true) && genesisAdviceLunarPreparation($entry)) { $lunarAlreadyDrawn = true; break; }
    }
    $eligible = array_values(array_filter($items, static fn($entry) => ($entry['status'] ?? 'published') !== 'draft'
        && genesisAdviceAgeAllowed($entry, $preferences)
        && genesisAdviceCollectionAllowed($entry, $preferences)
        && !in_array($entry['collection'] ?? 'aurora', $localContext['excludedCollections'] ?? [], true)
        && array_intersect($entry['categories'],$excludedCategories)===[]
        && !in_array($entry['id'], $excluded, true) && (($entry['collection'] ?? 'aurora') === 'philosophers' || array_intersect($entry['categories'], $categories) !== [])
        && genesisAdviceScheduledFor($entry, $phaseLeads)
        && (!$lunarAlreadyDrawn || !genesisAdviceLunarPreparation($entry))
        && (!$preferences['smart'] || genesisAdviceTimeMatches($entry, $hour))));
    if ($eligible === []) return null;
    // Reserve the first aphorism without displacing the separate Aurora allowance.
    // The last shared slot prefers an eligible aphorism if none has been drawn today.
    if (($localContext['reservePhilosopher'] ?? false) && count($excluded) >= 5) {
        $aphorisms = array_values(array_filter($eligible, static fn($entry) => ($entry['collection'] ?? 'aurora') === 'philosophers'));
        if ($aphorisms !== []) $eligible = $aphorisms;
    }
    $lastShown = []; $shownCounts = []; $exposures = []; $recentCategories = []; $recentTopics = [];
    foreach ($history as $index => $row) {
        $id = $row['advice_id'];
        $lastShown[$id] ??= $row['day_key'];
        $exposure = $id . ':' . $row['day_key'];
        if (!isset($exposures[$exposure])) { $shownCounts[$id] = ($shownCounts[$id] ?? 0) + 1; $exposures[$exposure] = true; }
        if ($index < 3) {
            $entry = json_decode($row['entry_json'], true, 32, JSON_THROW_ON_ERROR);
            foreach ($entry['categories'] as $category) $recentCategories[$category] = ($recentCategories[$category] ?? 0) + 1;
            foreach ($entry['topics'] ?? [] as $topic) $recentTopics[$topic] = ($recentTopics[$topic] ?? 0) + 1;
        }
    }
    // Clothes and personal attributes are a combined rare pool unless there is an explicit local interest.
    $clothingInterest = ($topicScores['clothing'] ?? 0) + ($topicScores['attributes'] ?? 0) > 0;
    if (!$clothingInterest) {
        $ordinaryUnseen = false;
        foreach ($items as $entry) if (($entry['status'] ?? 'published') !== 'draft'
            && in_array('hestiology', $entry['categories'], true) && !genesisAdviceClothing($entry)
            && !isset($lastShown[$entry['id']])) { $ordinaryUnseen = true; break; }
        $recentClothing = false;
        $cutoff = (new DateTimeImmutable($day))->modify('-30 days')->format('Y-m-d');
        $monthStart = substr($day, 0, 7) . '-01';
        foreach ($history as $row) if (($row['day_key'] > $cutoff || $row['day_key'] >= $monthStart)
            && genesisAdviceClothing(json_decode($row['entry_json'], true, 32, JSON_THROW_ON_ERROR))) { $recentClothing = true; break; }
        $previousClothing = isset($history[0]) && genesisAdviceClothing(json_decode($history[0]['entry_json'], true, 32, JSON_THROW_ON_ERROR));
        // Stable per account/day: refreshing or rotating cannot fish for a different probability.
        $rareDay = hexdec(substr(hash('sha256', ($localContext['user'] ?? $seed) . ':' . $day . ':clothing'), 0, 4)) % 4 === 0;
        if ($ordinaryUnseen || $recentClothing || $previousClothing || !$rareDay) {
            $eligible = array_values(array_filter($eligible, static fn($entry) => !genesisAdviceClothing($entry)));
        }
    }
    // Balance all three Aphrodisia meanings, rather than letting its larger love pool
    // overwhelm aesthetics and consciousness. Other categories retain their ranking.
    $themeCounts = ['love' => 0, 'aesthetics' => 0, 'consciousness' => 0];
    $previousTheme = null;
    foreach ($history as $row) {
        $theme = json_decode($row['entry_json'], true)['aphrodisiaTheme'] ?? null;
        if (isset($themeCounts[$theme ?? ''])) { $themeCounts[$theme]++; $previousTheme ??= $theme; }
    }
    $themes = array_values(array_unique(array_filter(array_column($eligible, 'aphrodisiaTheme'))));
    if ($themes !== []) {
        $minimum = min(array_map(static fn($theme) => $themeCounts[$theme], $themes));
        $eligible = array_values(array_filter($eligible, static fn($entry) => !isset($entry['aphrodisiaTheme'])
            || $themeCounts[$entry['aphrodisiaTheme']] === $minimum));
    }
    // Balance sources before category/interest ranking: aphorisms have no Aurora categories.
    // Work within the least-shown round so balancing never repeats a card ahead of unseen content.
    $collections = array_values(array_unique(array_map(static fn($entry) => $entry['collection'] ?? 'aurora', $eligible)));
    if (count($preferences['collections'] ?? ['aurora']) > 1 && count($collections) > 1) {
        $minimum = min(array_map(static fn($entry) => $shownCounts[$entry['id']] ?? 0, $eligible));
        $round = array_values(array_filter($eligible, static fn($entry) => ($shownCounts[$entry['id']] ?? 0) === $minimum));
        // Preserve the finite lunar preparation window before rotating ordinary sources.
        $scheduled = array_values(array_filter($round, static fn($entry) => isset($entry['schedule'])));
        if ($scheduled !== []) $round = $scheduled;
        $sources = array_values(array_unique(array_map(static fn($entry) => $entry['collection'] ?? 'aurora', $round)));
        $lastCollection = isset($history[0]) ? (json_decode($history[0]['entry_json'], true, 32, JSON_THROW_ON_ERROR)['collection'] ?? 'aurora') : null;
        $different = array_values(array_diff($sources, [$lastCollection]));
        $choices = $different !== [] ? $different : $sources;
        $collection = $choices[hexdec(substr(hash('sha256', $seed . ':collection'), 0, 4)) % count($choices)];
        $eligible = array_values(array_filter($round, static fn($entry) => ($entry['collection'] ?? 'aurora') === $collection));
    }
    // Explicit Next alternates categories within the least-shown round, preserving no-repeat history.
    if ($eligible !== [] && ($localContext['previousCategories'] ?? []) !== []) {
        $minimum = min(array_map(static fn($entry) => $shownCounts[$entry['id']] ?? 0, $eligible));
        $round = array_values(array_filter($eligible, static fn($entry) => ($shownCounts[$entry['id']] ?? 0) === $minimum));
        $different = array_values(array_filter($round, static fn($entry) => array_diff($entry['categories'], $localContext['previousCategories']) !== []));
        $eligible = $different !== [] ? $different : $round;
    }
    // Within Aphrodisia, rotate love, aesthetics and consciousness, while retaining
    // no-repeat rounds. Intimate entries were removed before this balancing step.
    if ($previousTheme !== null && $eligible !== []) {
        $minimum = min(array_map(static fn($entry) => $shownCounts[$entry['id']] ?? 0, $eligible));
        $round = array_values(array_filter($eligible, static fn($entry) => ($shownCounts[$entry['id']] ?? 0) === $minimum));
        $different = array_values(array_filter($round, static fn($entry) => ($entry['aphrodisiaTheme'] ?? null) !== $previousTheme));
        if ($different !== []) $eligible = $different;
    }
    $best = null; $bestRank = null;
    foreach ($eligible as $entry) {
        $affinity = 0.0; $recent = 0;
        foreach (array_intersect($entry['categories'], $categories) as $category) {
            $affinity = max($affinity, $preferences['smart'] ? log(1 + ($scores[$category] ?? 0)) : 1.0);
            $recent = max($recent, $recentCategories[$category] ?? 0);
        }
        $topicAffinity = 0.0;
        foreach ($entry['topics'] ?? [] as $topic) {
            if ($preferences['smart'] || in_array($topic, ['clothing', 'attributes', 'cleaning', 'home_order'], true)) {
                $topicAffinity = max($topicAffinity, log(1 + ($topicScores[$topic] ?? 0)) / (1 + ($recentTopics[$topic] ?? 0)));
            }
        }
        if ($preferences['smart'] && in_array('kourotrophy', $entry['categories'], true)) {
            $affinity += genesisAdviceFamilyAffinity($topicScores);
        }
        // A completed round starts with the longest-unseen entries; context can never bypass history.
        // During a lunar window, eligible unseen preparations lead ordinary unseen posts.
        $rank = [$lastShown[$entry['id']] ?? '', -(int)isset($entry['schedule']), -($affinity / (1 + $recent) + $topicAffinity),
            -(int)($preferences['smart'] && isset($entry['timeOfDay'])), -(int)($entry['priority'] ?? false), hash('sha256', $seed . ':' . $entry['id'])];
        if ($bestRank === null || $rank < $bestRank) { $best = $entry; $bestRank = $rank; }
    }
    return $best;
}

function genesisAdviceForClient(array $row, string $language = 'ru'): array
{
    $entry = json_decode($row['entry_json'], true, 32, JSON_THROW_ON_ERROR);
    if (isset($entry['translationVersion'])) {
        $version=$entry['translationVersion'];
        if (($entry['collection']??'')!=='philosophers' || !is_string($version) || preg_match('/\Aphilosophers-[a-z0-9-]{1,70}\z/D',$version)!==1)
            throw new RuntimeException('INVALID_PHILOSOPHER_CONTENT');
        if (!in_array($language,GENESIS_ADVICE_LANGUAGES,true)) $language='ru';
        static $philosopherLocales=[];$key=$version.':'.$language;
        $philosopherLocales[$key]??=json_decode((string)file_get_contents(dirname(__DIR__).'/content/philosopher-aphorisms-locales/'.$version.'/'.$language.'.json'),true,32,JSON_THROW_ON_ERROR);
        $text=$philosopherLocales[$key][$entry['id']]??null;
        if (!is_array($text) || !is_string($text['body']??null) || trim($text['body'])==='' || strlen($text['body'])>24000
            || !is_string($text['title']??null) || !is_array($text['sources']??null)) throw new RuntimeException('ADVICE_TRANSLATION_MISSING');
        $entry=[...$entry,...$text,'language'=>$language];
    }
    if (isset($entry['contentVersion'])) {
        $version = $entry['contentVersion'];
        if (!is_string($version) || !preg_match('/^[a-z0-9-]{1,80}$/D', $version)) throw new RuntimeException('INVALID_ADVICE_CONTENT');
        if (!in_array($language, GENESIS_ADVICE_LANGUAGES, true)) $language = 'ru';
        static $locales = [];
        $key = $version . ':' . $language;
        $locales[$key] ??= json_decode(file_get_contents(dirname(__DIR__) . '/content/daily-advice/' . $version . '/' . $language . '.json'), true, 32, JSON_THROW_ON_ERROR);
        $text = $locales[$key][$entry['id']] ?? null;
        if (!is_array($text) || !is_string($text['title'] ?? null) || !is_string($text['body'] ?? null)
            || trim($text['title']) === '' || trim($text['body']) === '') throw new RuntimeException('ADVICE_TRANSLATION_MISSING');
        $entry = [...$entry, ...$text, 'language' => $language];
    }
    // Stable lookup also upgrades previously stored daily and notification snapshots.
    if (($entry['collection'] ?? 'aurora') === 'philosophers' && isset(genesisPhilosopherArtwork()[$entry['id']]))
        $entry['image'] = genesisPhilosopherArtwork()[$entry['id']];
    if (in_array('psychopompia',$entry['categories'],true)) $entry['psychopompiaPublished']=($entry['status']??null)==='published';
    unset($entry['contentVersion'], $entry['translationVersion'], $entry['sourceId'], $entry['topics'], $entry['schedule'], $entry['status'], $entry['timeOfDay'], $entry['priority']);
    return [...$entry,
        'collection' => $entry['collection'] ?? 'aurora',
        'dayKey' => $row['day_key'], 'dismissed' => $row['dismissed_at'] !== null];
}

function genesisAdviceClientCapacity(mixed $value = null): int
{
    if ($value === null) return 6;
    if (!in_array($value, [6, 9, '6', '9'], true)) throw new InvalidArgumentException('INVALID_ADVICE_CONTEXT');
    return (int)$value;
}

/** Installed clients keep immutable original slots within their six-card decoder. */
function genesisAdviceBoundResponse(array $result, int $capacity): array
{
    if (($result['sequence'] ?? 0) <= $capacity && ($result['dailyLimit'] ?? 1) <= $capacity) return $result;
    $result['history'] = array_values(array_filter($result['history'], static fn($card) => ($card['sequence'] ?? 1) <= $capacity));
    $result['sequence'] = min($capacity, $result['sequence']);
    $result['dailyLimit'] = min($capacity, $result['dailyLimit']);
    $result['remaining'] = max(0, $result['dailyLimit'] - $result['sequence']);
    $result['canNext'] = $result['canNext'] && $result['remaining'] > 0;
    if ($result['advice'] !== null && !in_array($result['advice']['id'], array_column($result['history'], 'id'), true)) {
        $result['advice'] = $result['history'] === [] ? null : $result['history'][array_key_last($result['history'])];
        $result['state'] = $result['advice'] === null ? 'no-match' : 'ready';
    }
    return $result;
}

function genesisDailyAdvice(string $userId, array $payload, ?array $catalogFixture = null, bool $advance = false, ?DateTimeImmutable $at = null): array
{
    if (array_diff(array_keys($payload), ['scores', 'topics', 'fromId', 'dayKey', 'maxDailyCards'])) throw new InvalidArgumentException('INVALID_ADVICE_CONTEXT');
    $capacity = genesisAdviceClientCapacity($payload['maxDailyCards'] ?? null);
    if ($advance && (!is_string($payload['fromId'] ?? null) || !preg_match('/^advice-[a-f0-9]{24}$/D', $payload['fromId'])
        || !is_string($payload['dayKey'] ?? null) || !preg_match('/^\d{4}-\d{2}-\d{2}$/D', $payload['dayKey']))) throw new InvalidArgumentException('INVALID_ADVICE_VIEW');
    $scores = genesisAdviceScores($payload['scores'] ?? []);
    $topics = genesisAdviceTopicScores($payload['topics'] ?? []);
    $at ??= new DateTimeImmutable('now', new DateTimeZone(genesisAdviceTimeZone()));
    $day = $at->format('Y-m-d'); $db = genesisDb();
    genesisBeginWriteTransaction($db);
    try {
        $user = genesisFindUser($userId);
        if ($user === null) throw new DomainException('AUTH_REQUIRED');
        $preferences = genesisUserAdvicePreferences($user);
        $result = ['dayKey' => $day, 'advice' => null, 'history' => [], 'state' => 'disabled', 'sequence' => 0, 'dailyLimit' => 3, 'remaining' => 0, 'canNext' => false];
        if ($preferences['enabled']) {
            $items = $catalogFixture ?? genesisAdviceCatalog();
            $query = $db->prepare('SELECT * FROM daily_advice_days WHERE user_id = ? AND day_key = ?');
            $query->execute([$userId, $day]); $row = $query->fetch();
            if (is_array($row)) {
                $extra = $db->prepare('SELECT * FROM daily_advice_extra_entries WHERE user_id=? AND day_key=? ORDER BY slot DESC LIMIT 1');
                $extra->execute([$userId, $day]); $latest = $extra->fetch(); $extra->closeCursor();
                if (is_array($latest)) $row = [...$row, ...$latest];
            }
            $drawPreferences = is_array($row) ? genesisAdvicePreferences($row['selection_json']) : $preferences;
            // Safety choice is current, even when today's selection preferences are frozen.
            $drawPreferences['aphrodisiaAdult'] = $preferences['aphrodisiaAdult'];
            $drawPreferences['psychopompia'] = $preferences['psychopompia'];
            $drawPreferences['collections'] = $preferences['collections'];
            $drawPreferences['philosophersPerDay'] = $preferences['philosophersPerDay'];
            $access = genesisFeatureAccessForUser($user);
            $packageLimit = $access['enforcementEnabled'] ? $access['adviceDailyLimit'] : null;
            if ($packageLimit !== null) $drawPreferences = $preferences;
            $slots = $db->prepare('SELECT advice_id,entry_json FROM daily_advice_all_entries WHERE user_id=? AND day_key=? ORDER BY slot');
            $slots->execute([$userId, $day]); $todayRows = $slots->fetchAll(); $todayIds = array_column($todayRows, 'advice_id');
            $drawLimit = is_array($row) ? (int)$row['draw_limit'] : genesisAdviceDailyLimit($drawPreferences, $items);
            if ($packageLimit !== null) $drawLimit = min($drawLimit, $packageLimit);
            $collectionLimits = genesisAdviceCollectionLimits($drawPreferences, $items, $drawLimit, $packageLimit);
            $collectionCounts = array_fill_keys(GENESIS_ADVICE_COLLECTIONS, 0);
            foreach ($todayRows as $todayRow) {
                $source = json_decode($todayRow['entry_json'], true, 32, JSON_THROW_ON_ERROR)['collection'] ?? 'aurora';
                if (isset($collectionCounts[$source])) $collectionCounts[$source]++;
            }
            $remaining = 0; $exhaustedCollections = [];
            foreach ($collectionLimits as $source => $sourceLimit) {
                $remaining += max(0, $sourceLimit - $collectionCounts[$source]);
                if ($collectionCounts[$source] >= $sourceLimit) $exhaustedCollections[] = $source;
            }
            // Hidden cards still spend slots; changing collections never resets either counter.
            $limit = max(1, min($capacity, count($todayIds) + $remaining));
            $history = $db->prepare('SELECT advice_id,day_key,entry_json FROM daily_advice_all_entries WHERE user_id=? AND viewed_at IS NOT NULL ORDER BY day_key DESC,slot DESC');
            $history->execute([$userId]); $viewed = $history->fetchAll();
            $local = ['day' => $day, 'hour' => (int)$at->format('G'), 'timeZone'=>$at->getTimezone()->getName(), 'excluded' => $todayIds, 'user' => $userId,
                'issuedToday' => array_map(static fn($issued) => json_decode($issued['entry_json'], true, 32, JSON_THROW_ON_ERROR), $todayRows),
                'excludedCollections' => $exhaustedCollections, 'reservePhilosopher' => $collectionLimits['philosophers'] > 0 && $collectionCounts['philosophers'] === 0];
            if ($packageLimit!==null) $local['excludedCategories']=['aphrodisia','psychopompia'];
            $oldEntry = is_array($row) ? json_decode($row['entry_json'], true, 32, JSON_THROW_ON_ERROR) : null;
            $ageBlocked = is_array($oldEntry) && (!genesisAdviceAgeAllowed($oldEntry, $preferences) || !genesisAdviceCollectionAllowed($oldEntry, $preferences));
            $timeChanged = is_array($oldEntry) && $drawPreferences['smart'] && !genesisAdviceTimeMatches($oldEntry, $local['hour']);
            $requestedNext = $advance && is_array($row) && !$ageBlocked && $payload['fromId'] === $row['advice_id'] && $payload['dayKey'] === $day;
            if ($requestedNext) $local['previousCategories'] = $oldEntry['categories'];
            if (!is_array($row) || (($requestedNext || $timeChanged || $ageBlocked) && ($row['dismissed_at'] === null || $ageBlocked) && count($todayIds) < $limit)) {
                // The optional fixture is used only by isolated backend tests, never by HTTP input.
                if ($requestedNext) {
                    foreach (['daily_advice_days', 'daily_advice_entries', 'daily_advice_extra_entries'] as $table) {
                        $db->prepare("UPDATE $table SET viewed_at=COALESCE(viewed_at,?) WHERE user_id=? AND day_key=? AND advice_id=?")
                            ->execute([genesisNow(), $userId, $day, $row['advice_id']]);
                    }
                    array_unshift($viewed, ['advice_id' => $row['advice_id'], 'day_key' => $day, 'entry_json' => $row['entry_json']]);
                }
                $entry = genesisChooseAdvice($items, $drawPreferences, $scores, $viewed, $userId . ':' . $day . ':' . count($todayIds), $topics, null, $local);
                if ($entry !== null) {
                    $row = ['day_key' => $day, 'advice_id' => $entry['id'], 'entry_json' => json_encode($entry, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), 'dismissed_at' => null, 'draw_limit' => $drawLimit];
                    $table = count($todayIds) < 6 ? 'daily_advice_entries' : 'daily_advice_extra_entries';
                    $db->prepare("INSERT INTO $table(user_id,day_key,slot,advice_id,entry_json,created_at) VALUES (?,?,?,?,?,?)")
                        ->execute([$userId, $day, count($todayIds) + 1, $entry['id'], $row['entry_json'], genesisNow()]);
                    if (count($todayIds) < 6) {
                        $selection = $drawPreferences; unset($selection['collections'], $selection['notifications'], $selection['psychopompia'], $selection['philosophersPerDay']);
                        $db->prepare('INSERT INTO daily_advice_days(user_id,day_key,advice_id,entry_json,created_at,draw_limit,selection_json) VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id,day_key) DO UPDATE SET advice_id=excluded.advice_id,entry_json=excluded.entry_json,created_at=excluded.created_at,viewed_at=NULL,dismissed_at=NULL')
                            ->execute([$userId, $day, $entry['id'], $row['entry_json'], genesisNow(), $drawLimit, json_encode($selection, JSON_THROW_ON_ERROR)]);
                    }
                    $todayIds[] = $entry['id']; $local['excluded'] = $todayIds; $timeChanged = false; $ageBlocked = false;
                    $local['issuedToday'][] = $entry;
                    $source = $entry['collection'] ?? 'aurora'; $collectionCounts[$source]++;
                    if ($collectionCounts[$source] >= $collectionLimits[$source]) $local['excludedCollections'][] = $source;
                    if ($source === 'philosophers') $local['reservePhilosopher'] = false;
                }
            }
            $result['state'] = $items === [] ? 'empty' : 'no-match';
            $result['sequence'] = count($todayIds); $result['dailyLimit'] = $limit;
            $result['remaining'] = max(0, $limit - count($todayIds));
            if (is_array($row) && !$timeChanged && !$ageBlocked) {
                $result['advice'] = genesisAdviceForClient($row, $user['language'] ?? 'ru'); $result['state'] = 'ready';
                $result['canNext'] = $row['dismissed_at'] === null && $result['remaining'] > 0
                    && genesisChooseAdvice($items, $drawPreferences, $scores, $viewed, $userId . ':' . $day, $topics, null, $local) !== null;
            }
            // Browsing already drawn cards never advances the account's current-day pointer or allowance.
            $todayHistory = $db->prepare('SELECT * FROM daily_advice_all_entries WHERE user_id=? AND day_key=? ORDER BY slot');
            $todayHistory->execute([$userId, $day]);
            foreach ($todayHistory->fetchAll() as $pastRow) {
                $pastEntry = json_decode($pastRow['entry_json'], true, 32, JSON_THROW_ON_ERROR);
                if (!genesisAdviceAgeAllowed($pastEntry, $preferences) || !genesisAdviceCollectionAllowed($pastEntry, $preferences)) continue;
                $result['history'][] = [...genesisAdviceForClient($pastRow, $user['language'] ?? 'ru'), 'sequence' => (int)$pastRow['slot']];
            }
        }
        $db->commit(); return genesisAdviceBoundResponse($result, $capacity);
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        throw $error;
    }
}

/** An opaque notification target can only read this account's existing, currently visible snapshot. */
function genesisSavedAdvice(string $userId, array $target, int $capacity = 9): array
{
    if (array_diff(array_keys($target),['id','dayKey','collection'])
        || !is_string($target['id']??null) || !preg_match('/^advice-[a-f0-9]{24}$/D',$target['id'])
        || !is_string($target['dayKey']??null) || !preg_match('/^\d{4}-\d{2}-\d{2}$/D',$target['dayKey'])
        || !in_array($target['collection']??null,GENESIS_ADVICE_COLLECTIONS,true))
        throw new InvalidArgumentException('INVALID_ADVICE_TARGET');
    $date = DateTimeImmutable::createFromFormat('!Y-m-d',$target['dayKey']);
    if (!$date || $date->format('Y-m-d')!==$target['dayKey']) throw new InvalidArgumentException('INVALID_ADVICE_TARGET');
    $user = genesisFindUser($userId);
    if (!$user) throw new DomainException('AUTH_REQUIRED');
    $preferences = genesisUserAdvicePreferences($user);
    $result = ['dayKey'=>$target['dayKey'],'advice'=>null,'history'=>[],'state'=>$preferences['enabled']?'no-match':'disabled','canNext'=>false,'remaining'=>0];
    if (!$preferences['enabled']) return $result;
    $q = genesisDb()->prepare('SELECT * FROM daily_advice_all_entries WHERE user_id=? AND day_key=? AND advice_id=?');
    $q->execute([$userId,$target['dayKey'],$target['id']]); $row = $q->fetch(); $q->closeCursor();
    if (!$row || $row['dismissed_at']!==null || (int)$row['slot'] > $capacity) return $result;
    $entry = json_decode($row['entry_json'],true,32,JSON_THROW_ON_ERROR);
    if (($entry['collection']??'aurora')!==$target['collection'] || !genesisAdviceAgeAllowed($entry,$preferences) || !genesisAdviceCollectionAllowed($entry,$preferences)) return $result;
    $advice = [...genesisAdviceForClient($row,$user['language']??'ru'),'sequence'=>(int)$row['slot']];
    return [...$result,'advice'=>$advice,'history'=>[$advice],'state'=>'ready','sequence'=>(int)$row['slot']];
}

/** A view is acknowledged only when the card enters the visible viewport. Both operations are idempotent. */
function genesisRecordAdvice(string $userId, array $payload, bool $dismiss): array
{
    $day = $payload['dayKey'] ?? null; $id = $payload['id'] ?? null;
    if (!is_string($day) || !preg_match('/^\d{4}-\d{2}-\d{2}$/D', $day) || !is_string($id)) throw new InvalidArgumentException('INVALID_ADVICE_VIEW');
    if (!$dismiss) {
        $q=genesisDb()->prepare('SELECT entry_json FROM daily_advice_all_entries WHERE user_id=? AND day_key=? AND advice_id=?');
        $q->execute([$userId,$day,$id]);$raw=$q->fetchColumn();$q->closeCursor();
        $user=genesisFindUser($userId);
        if ($raw!==false&&$user!==null) {
            $preferences=genesisUserAdvicePreferences($user);$entry=json_decode($raw,true,32,JSON_THROW_ON_ERROR);
            if (!$preferences['enabled']||!genesisAdviceAgeAllowed($entry,$preferences)||!genesisAdviceCollectionAllowed($entry,$preferences)) return ['ok'=>true];
        }
    }
    $sql = $dismiss ? 'viewed_at = COALESCE(viewed_at, :now), dismissed_at = COALESCE(dismissed_at, :now)' : 'viewed_at = COALESCE(viewed_at, :now)';
    foreach (['daily_advice_days', 'daily_advice_entries', 'daily_advice_extra_entries'] as $table) {
        $query = genesisDb()->prepare("UPDATE $table SET $sql WHERE user_id = :user AND day_key = :day AND advice_id = :id");
        $query->execute(['now' => genesisNow(), 'user' => $userId, 'day' => $day, 'id' => $id]);
    }
    return ['ok' => true];
}
