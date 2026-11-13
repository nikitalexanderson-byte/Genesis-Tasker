<?php
declare(strict_types=1);
require_once __DIR__ . '/daily-advice.php';
require_once __DIR__.'/account-email.php';
require_once __DIR__.'/habit-reminders.php';
require_once __DIR__.'/advice-notifications.php';
require_once __DIR__.'/feature-access.php';
require_once __DIR__.'/subscription-identity.php';
require_once __DIR__.'/subscription-trials.php';
require_once __DIR__.'/support-notices.php';
require_once __DIR__.'/plan-guidance.php';
require_once __DIR__.'/google-login-security.php';
require_once __DIR__.'/account-retention.php';
require_once __DIR__.'/partners.php';
require_once __DIR__.'/stoicheion-timeline-cards.php';

const GENESIS_ADMIN_EMAIL = 'nikitalexanderson@gmail.com';

final class GenesisWorkspaceConflictException extends DomainException
{
    public function __construct(public readonly int $currentVersion)
    {
        parent::__construct('WORKSPACE_VERSION_CONFLICT');
    }
}

function genesisAdminEmail(): string
{
    return mb_strtolower(trim((string)(genesisConfig()['admin_email'] ?? GENESIS_ADMIN_EMAIL)));
}

function genesisUserProvider(array $user): string
{
    $provider = (string)($user['auth_provider'] ?? 'google');
    return in_array($provider, ['google', 'yandex'], true) ? $provider : 'unsupported';
}

function genesisIsAdminUser(array $user): bool
{
    return genesisUserProvider($user) === 'google'
        && mb_strtolower((string)($user['email'] ?? '')) === genesisAdminEmail();
}

function genesisSharedTester(array $user): bool
{
    if (genesisUserProvider($user) !== 'google') return false;
    if (genesisIsAdminUser($user)) return true;
    $email = mb_strtolower(trim((string)($user['email'] ?? '')));
    return in_array($email, [
        'jurijjlogvinov@gmail.com', 'mechrahod@gmail.com', 'eagbread@gmail.com',
        'margohello@gmail.com', 'nactbka1982@gmail.com', '2308dara@gmail.com',
        'giostouapi@gmail.com', 'maharita777@gmail.com',
    ], true);
}

function genesisIsValidEmail(string $email): bool
{
    $clean = trim($email);
    return mb_strlen($clean) <= 254 && filter_var($clean, FILTER_VALIDATE_EMAIL) !== false;
}

function genesisEnsureWorkspaceKey(array $user): array
{
    if (($user['workspace_key_mode'] ?? 'legacy') === 'client') {
        return $user;
    }
    if (!empty($user['workspace_key_enc'])) {
        return $user;
    }
    $key = base64_encode(random_bytes(32));
    genesisDb()->prepare("UPDATE users SET workspace_key_enc = :key, updated_at = :updated_at WHERE id = :id AND (workspace_key_enc IS NULL OR workspace_key_enc = '') AND workspace_key_mode <> 'client'")->execute([
        'key' => genesisEncrypt($key),
        'updated_at' => genesisNow(),
        'id' => (string)$user['id'],
    ]);
    // A second device may have initialized the same account in the meantime.
    // Both requests must use the one persisted key, never their losing candidate.
    return genesisFindUser((string)$user['id']) ?? $user;
}

function genesisLinkedGoogleAccountAsUser(array $account): array
{
    $account['_linked_account'] = true;
    $account['_owner_user_id'] = (string)$account['owner_user_id'];
    return $account;
}

function genesisLinkedGoogleAccounts(string $ownerUserId): array
{
    $statement = genesisDb()->prepare('SELECT * FROM linked_google_accounts WHERE owner_user_id = :owner_user_id ORDER BY position, created_at');
    $statement->execute(['owner_user_id' => $ownerUserId]);
    return array_map('genesisLinkedGoogleAccountAsUser', $statement->fetchAll());
}

function genesisFindLinkedGoogleAccount(string $accountId): ?array
{
    $statement = genesisDb()->prepare('SELECT * FROM linked_google_accounts WHERE id = :id LIMIT 1');
    $statement->execute(['id' => $accountId]);
    $account = $statement->fetch();
    return is_array($account) ? genesisLinkedGoogleAccountAsUser($account) : null;
}

function genesisFindLinkedGoogleAccountBySub(string $googleSub): ?array
{
    $statement = genesisDb()->prepare('SELECT * FROM linked_google_accounts WHERE google_sub = :google_sub LIMIT 1');
    $statement->execute(['google_sub' => $googleSub]);
    $account = $statement->fetch();
    return is_array($account) ? genesisLinkedGoogleAccountAsUser($account) : null;
}

function genesisGoogleAccountsForUser(array $owner): array
{
    if (genesisUserProvider($owner) !== 'google') return [];
    return array_merge([$owner], genesisLinkedGoogleAccounts((string)$owner['id']));
}

function genesisGoogleAccountForUser(string $ownerUserId, string $accountId): ?array
{
    $owner = genesisFindUser($ownerUserId);
    if ($owner === null || genesisUserProvider($owner) !== 'google') {
        return null;
    }
    if (hash_equals((string)$owner['id'], $accountId)) {
        return $owner;
    }
    $account = genesisFindLinkedGoogleAccount($accountId);
    return $account !== null && hash_equals((string)$account['owner_user_id'], $ownerUserId) ? $account : null;
}

function genesisMultiAccountEnabled(array $owner): bool
{
    if (genesisUserProvider($owner) === 'google') {
        return isset($owner['id']) && trim((string)$owner['id']) !== '';
    }
    return function_exists('genesisLocalAccountMembers')
        && count(genesisLocalAccountMembers($owner)) > 1;
}

function genesisAccountForClient(array $account, bool $primary): array
{
    $grantedScopes = preg_split('/\s+/', trim((string)($account['granted_scopes'] ?? ''))) ?: [];
    $hasRefreshToken = !empty($account['refresh_token_enc']);
    return [
        'id' => (string)$account['id'],
        'email' => (string)$account['email'],
        'displayName' => (string)$account['display_name'],
        'photoURL' => $account['avatar_url'] ?: null,
        'isPrimary' => $primary,
        'calendarConnected' => $hasRefreshToken && !empty($account['google_calendar_id'])
            && in_array(GENESIS_GOOGLE_CALENDAR_SCOPE, $grantedScopes, true),
        'googleTasksImportReady' => $hasRefreshToken
            && in_array(GENESIS_GOOGLE_TASKS_SCOPE, $grantedScopes, true),
    ];
}

function genesisDecodeStringListJson(mixed $value): array
{
    $decoded = is_string($value) ? json_decode($value, true) : $value;
    if (!is_array($decoded)) {
        return [];
    }
    return array_values(array_unique(array_filter(array_map(
        static fn(mixed $item): string => mb_substr(trim((string)$item), 0, 100),
        $decoded,
    ))));
}

function genesisCategorySyncMap(mixed $value): array
{
    $decoded = is_string($value) ? json_decode($value, true) : $value;
    if (!is_array($decoded)) {
        return [];
    }
    $result = [];
    foreach ($decoded as $categoryId => $accountIds) {
        $cleanCategoryId = mb_substr(trim((string)$categoryId), 0, 100);
        if ($cleanCategoryId !== '') {
            $result[$cleanCategoryId] = genesisDecodeStringListJson($accountIds);
        }
    }
    return $result;
}

function genesisSharedEligible(array $user): bool
{
    return in_array(genesisUserProvider($user), ['google', 'yandex'], true);
}

function genesisUiVisibility(mixed $value): array
{
    $decoded = is_string($value) ? json_decode($value, true) : $value;
    if (!is_array($decoded)) $decoded = [];
    $allowed = [
        'hiddenMenuItems' => ['tasks', 'projects', 'calendar', 'habits', 'sacred', 'stoicheion', 'theokyklos', 'diary', 'messages'],
        'hiddenSubmenus' => ['tasks.tasks', 'tasks.lists', 'projects.personal', 'projects.shared',
            'calendar.month', 'calendar.year', 'habits.habits', 'habits.sleep',
            'sacred.stoicheion', 'sacred.theokyklos'],
        'hiddenTodayBlocks' => ['rhythm', 'quickCreate', 'tasks', 'habits', 'details'],
        'enabledCalendars' => ['profane', 'sacred', 'lunar'],
    ];
    $sacred = $decoded['sacredFeaturesEnabled'] ?? true;
    if (!is_bool($sacred)) throw new InvalidArgumentException('INVALID_UI_VISIBILITY');
    $dream=$decoded['dreamJournalEnabled']??true;
    if(!is_bool($dream))throw new InvalidArgumentException('INVALID_UI_VISIBILITY');
    $result = ['sacredFeaturesEnabled' => $sacred,'dreamJournalEnabled'=>$dream];
    foreach ($allowed as $name => $options) {
        $items = $decoded[$name] ?? ($name === 'enabledCalendars' ? $options : []);
        if (!is_array($items) || !array_is_list($items) ||
            array_filter($items, static fn(mixed $item): bool => !is_string($item) || !in_array($item, $options, true))) {
            throw new InvalidArgumentException('INVALID_UI_VISIBILITY');
        }
        $result[$name] = array_values(array_unique($items));
    }
    if ($result['enabledCalendars'] === []) throw new InvalidArgumentException('AT_LEAST_ONE_CALENDAR_REQUIRED');
    foreach ([['tasks.tasks', 'tasks.lists'], ['calendar.month', 'calendar.year'],
        ['projects.personal', 'projects.shared'], ['habits.habits', 'habits.sleep'],
        ['sacred.stoicheion', 'sacred.theokyklos']] as $pair) {
        if (count(array_intersect($pair, $result['hiddenSubmenus'])) === 2) {
            throw new InvalidArgumentException('AT_LEAST_ONE_SUBMENU_REQUIRED');
        }
    }
    $delay = $decoded['sidebarAutoCollapseSeconds'] ?? 0;
    if (!is_int($delay) || !in_array($delay, [0, 15, 30, 60, 120, 300], true)) {
        throw new InvalidArgumentException('INVALID_SIDEBAR_AUTO_COLLAPSE');
    }
    $result['sidebarAutoCollapseSeconds'] = $delay;
    $width = $decoded['sidebarWidth'] ?? 240;
    if (!is_int($width) || $width < 56 || $width > 240) throw new InvalidArgumentException('INVALID_SIDEBAR_WIDTH');
    $result['sidebarWidth'] = $width;
    foreach (['personalInbox', 'sharedInbox'] as $prefix) {
        $position = $decoded[$prefix . 'Position'] ?? 'right';
        $hidden = $decoded[$prefix . 'Hidden'] ?? false;
        $compact = $decoded[$prefix . 'Compact'] ?? false;
        if (!is_string($position) || !in_array($position, ['top', 'right', 'left', 'bottom'], true)
            || !is_bool($hidden) || !is_bool($compact)) throw new InvalidArgumentException('INVALID_INBOX_LAYOUT');
        $result[$prefix . 'Position'] = $position;
        $result[$prefix . 'Hidden'] = $hidden;
        $result[$prefix . 'Compact'] = $compact;
        $inboxWidth = $decoded[$prefix . 'Width'] ?? 300;
        if (!is_int($inboxWidth) || $inboxWidth < 300 || $inboxWidth > 5000) throw new InvalidArgumentException('INVALID_INBOX_WIDTH');
        $result[$prefix . 'Width'] = $inboxWidth;
    }
    $categoriesExpanded = $decoded['sharedCategoriesExpanded'] ?? false;
    if (!is_bool($categoriesExpanded)) throw new InvalidArgumentException('INVALID_CATEGORY_LAYOUT');
    $result['sharedCategoriesExpanded'] = $categoriesExpanded;
    $expanded = $decoded['personalCategoriesExpanded'] ?? false;
    if (!is_bool($expanded)) throw new InvalidArgumentException('INVALID_CATEGORY_LAYOUT');
    $result['personalCategoriesExpanded'] = $expanded;
    foreach (['personalCategoriesView'=>'cards','sharedCategoriesView'=>'list'] as $field=>$default) {
        $view = $decoded[$field] ?? $default;
        if (!in_array($view,['cards','list'],true)) throw new InvalidArgumentException('INVALID_CATEGORY_LAYOUT');
        $result[$field] = $view;
    }
    $tasksCompact = $decoded['sharedTasksCompact'] ?? true;
    if (!is_bool($tasksCompact)) throw new InvalidArgumentException('INVALID_TASK_LAYOUT');
    $result['sharedTasksCompact'] = $tasksCompact;
    $pinned = $decoded['notificationDockPinned'] ?? false;
    if (!is_bool($pinned)) throw new InvalidArgumentException('INVALID_NOTIFICATION_DOCK_LAYOUT');
    $result['notificationDockPinned'] = $pinned;
    foreach (['notificationDockX', 'notificationDockY'] as $field) {
        $coordinate = $decoded[$field] ?? -1;
        if (!is_int($coordinate) || $coordinate < -1 || $coordinate > 10000)
            throw new InvalidArgumentException('INVALID_NOTIFICATION_DOCK_LAYOUT');
        $result[$field] = $coordinate;
    }
    $viewOrder = $decoded['sharedProjectViewOrder'] ?? null;
    if ($viewOrder !== null && (!is_array($viewOrder) || !array_is_list($viewOrder) || count($viewOrder) !== 4
        || count(array_unique($viewOrder, SORT_REGULAR)) !== 4
        || array_filter($viewOrder, static fn(mixed $view): bool => !is_string($view) || !in_array($view, ['list','board','calendar','gantt'], true)))) {
        throw new InvalidArgumentException('INVALID_PROJECT_VIEW_ORDER');
    }
    $result['sharedProjectViewOrder'] = $viewOrder;
    $calendarScale = array_key_exists('sharedCalendarScale', $decoded) ? $decoded['sharedCalendarScale'] : 1;
    if (!in_array($calendarScale, [1, 1.0, 0.5, 0.25], true)) throw new InvalidArgumentException('INVALID_CALENDAR_SCALE');
    $result['sharedCalendarScale'] = $calendarScale;
    $todayBlocks = ['advice','dream','ads','rhythm','tasks','habits','events','details'];
    $todayOrder = $decoded['todayBlockOrder'] ?? null;
    if ($todayOrder !== null) {
        if (!is_array($todayOrder) || !array_is_list($todayOrder) || count($todayOrder)<1 || count($todayOrder)>count($todayBlocks)
            || count(array_unique($todayOrder,SORT_REGULAR))!==count($todayOrder)
            || array_filter($todayOrder,static fn(mixed $block):bool=>!is_string($block)||!in_array($block,$todayBlocks,true))) {
            throw new InvalidArgumentException('INVALID_TODAY_BLOCK_ORDER');
        }
        $todayOrder = [...$todayOrder,...array_values(array_diff($todayBlocks,$todayOrder))];
    }
    $result['todayBlockOrder'] = $todayOrder;
    $halves = $decoded['todayHalfBlocks'] ?? [];
    if (!is_array($halves) || !array_is_list($halves) || count($halves) > count($todayBlocks)
        || count(array_unique($halves, SORT_REGULAR)) !== count($halves)
        || array_filter($halves, static fn(mixed $block): bool => !is_string($block) || !in_array($block, $todayBlocks, true))) {
        throw new InvalidArgumentException('INVALID_TODAY_BLOCK_WIDTH');
    }
    $result['todayHalfBlocks'] = array_values(array_intersect($todayBlocks, $halves));
    $calendarOrder = $decoded['displayCalendarOrder'] ?? ['profane','sacred','lunar'];
    if (!is_array($calendarOrder) || !array_is_list($calendarOrder) || count($calendarOrder) !== 3
        || count(array_unique($calendarOrder, SORT_REGULAR)) !== 3
        || array_filter($calendarOrder, static fn(mixed $mode): bool => !is_string($mode) || !in_array($mode, ['profane','sacred','lunar'], true))) {
        throw new InvalidArgumentException('INVALID_DISPLAY_CALENDAR_ORDER');
    }
    $result['displayCalendarOrder'] = $calendarOrder;
    return $result;
}

function genesisUserForClient(array $user): array
{
    $multiAccountEnabled = genesisMultiAccountEnabled($user);
    $localAccounts = genesisUserProvider($user) !== 'google'
        && function_exists('genesisLocalAccountMembers') ? genesisLocalAccountMembers($user) : [];
    // Compatibility: this is the historical integration routing anchor, not the selected login identity.
    $accounts = [genesisAccountForClient($user, true)];
    if ($multiAccountEnabled) {
        foreach (genesisLinkedGoogleAccounts((string)$user['id']) as $account) {
            $accounts[] = genesisAccountForClient($account, false);
        }
    }
    $calendarMode = in_array($user['calendar_mode'] ?? '', ['profane', 'sacred', 'lunar'], true)
        ? (string)$user['calendar_mode']
        : 'sacred';
    $taskCalendarMode = in_array($user['task_calendar_mode'] ?? '', ['profane', 'sacred', 'lunar'], true)
        ? (string)$user['task_calendar_mode']
        : 'sacred';
    $timeFormat = in_array($user['time_format'] ?? '', ['24h', '12h'], true)
        ? (string)$user['time_format']
        : '24h';
    $weekStart = in_array($user['week_start'] ?? '', ['sunday', 'monday'], true)
        ? (string)$user['week_start']
        : 'sunday';
    $gregorianYearStart = in_array($user['gregorian_year_start'] ?? '', ['january', 'march'], true)
        ? (string)$user['gregorian_year_start']
        : 'january';
    $theme = in_array($user['theme'] ?? '', ['standart', 'standart-dark', 'experimental', 'experimental-dark'], true)
        ? (string)$user['theme']
        : 'standart';
    $language = in_array($user['language'] ?? '', ['ru', 'en', 'el', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'sr', 'uk', 'zh', 'tr', 'ja'], true)
        ? (string)$user['language']
        : 'ru';
    $syncRoutingMode = in_array($user['sync_routing_mode'] ?? '', ['fixed', 'choose', 'category'], true)
        ? (string)$user['sync_routing_mode']
        : 'fixed';
    $validAccountIds = array_map(static fn(array $account): string => (string)$account['id'],
        $localAccounts !== [] ? $localAccounts : $accounts);
    $defaultAccountIds = array_values(array_filter(
        genesisDecodeStringListJson($user['sync_target_account_ids'] ?? '[]'),
        static fn(string $id): bool => in_array($id, $validAccountIds, true),
    ));
    if ($defaultAccountIds === []) {
        $defaultAccountIds = [(string)$user['id']];
    }
    $categoryAccountIds = genesisCategorySyncMap($user['category_sync_map'] ?? '{}');
    foreach ($categoryAccountIds as $categoryId => $accountIds) {
        $categoryAccountIds[$categoryId] = array_values(array_filter(
            $accountIds,
            static fn(string $id): bool => in_array($id, $validAccountIds, true),
        ));
    }
    $featureAccess=genesisFeatureAccessForUser($user);
    $calendarSyncAllowed=!$featureAccess['enforcementEnabled'] || in_array('calendar-sync',$featureAccess['allowedFeatures'],true);
    $anyCalendarConnected = $calendarSyncAllowed && ($localAccounts !== []
        ? count(array_filter($localAccounts, static fn(array $account): bool => !empty($account['calendarConnected']))) > 0
        : count(array_filter($accounts, static fn(array $account): bool => !empty($account['calendarConnected']))) > 0);
    $anyTasksConnected = $calendarSyncAllowed && count(array_filter($accounts, static fn(array $account): bool => !empty($account['googleTasksImportReady']))) > 0;
    return [
        'uid' => (string)$user['id'],
        'dataGeneration' => (int)($user['data_generation'] ?? 0),
        'forecastElitePlus' => genesisForecastElitePlus($user),
        'subscriptionPlan' => genesisSubscriptionPlanId($user),
        'featureAccess' => $featureAccess,
        'trial' => $featureAccess['trial'],
        'authProvider' => genesisUserProvider($user),
        'displayName' => (string)$user['display_name'],
        'email' => (string)$user['email'],
        'emailVerification' => genesisEmailRegistrationStatus($user),
        'photoURL' => $user['avatar_url'] ?: null,
        'calendarConnected' => $anyCalendarConnected,
        'googleTasksImportReady' => $anyTasksConnected,
        'passwordEnabled' => !empty($user['password_hash']),
        'stoicheionDivinationDisabled' => !empty($user['stoicheion_divination_disabled']),
        'advicePreferences' => genesisUserAdvicePreferences($user),
        'adviceCatalogAvailable' => genesisAdviceCatalog() !== [],
        'adviceCollectionsReady' => array_values(array_unique(array_column(genesisAdviceCatalog(),'collection'))),
        'adviceAvailableCategories' => genesisAdviceAvailableCategories(),
        'isAdmin' => genesisIsAdminUser($user) && genesisSessionOwnsGoogleAccount($user),
        'partnerProgramEnabled' => genesisPartnersEnabled(),
        'partnerAccess' => genesisPartnerAccess((string)$user['id']),
        'sharedProjectsEligible' => genesisSharedEligible($user),
        'sharedProjectsLifetimeAccess' => genesisSharedTester($user),
        'sharedProjectsEnabled' => genesisSharedEligible($user) && !empty($user['shared_projects_enabled']),
        'uiVisibility' => genesisUiVisibility($user['ui_visibility_json'] ?? '{}'),
        'calendarMode' => $calendarMode,
        'calendarExplorationPending' => !empty($user['calendar_exploration_pending']),
        'taskCalendarMode' => $taskCalendarMode,
        'timeFormat' => $timeFormat,
        'weekStart' => $weekStart,
        'gregorianYearStart' => $gregorianYearStart,
        'theme' => $theme,
        'themeRevision' => max(0, (int)($user['theme_revision'] ?? 0)),
        'darkPalette' => in_array($user['dark_palette'] ?? '', ['green','burgundy','blue','violet'], true) ? $user['dark_palette'] : 'green',
        'language' => $language,
        'multiAccountEnabled' => $multiAccountEnabled,
        'googleAccounts' => $accounts,
        'linkedAccounts' => $localAccounts,
        'syncRouting' => [
            'mode' => $syncRoutingMode,
            'defaultAccountIds' => $defaultAccountIds,
            // An empty PHP array is encoded as [] while the native client contract
            // requires a JSON object. Preserve the map shape for accounts that have
            // not configured category routing yet.
            'categoryAccountIds' => (object)$categoryAccountIds,
        ],
    ];
}

function genesisFindUser(string $userId): ?array
{
    $statement = genesisDb()->prepare('SELECT * FROM users WHERE id = :id LIMIT 1');
    $statement->execute(['id' => $userId]);
    $user = $statement->fetch();
    return is_array($user) ? $user : null;
}

function genesisFindUserByEmail(string $email): ?array
{
    $statement = genesisDb()->prepare('SELECT * FROM users WHERE email = :email COLLATE NOCASE LIMIT 1');
    $statement->execute(['email' => trim($email)]);
    $user = $statement->fetch();
    return is_array($user) ? $user : null;
}

/** A reported client category is descriptive metadata, never an authentication signal. */
function genesisRequestClientKind(array $server): ?string
{
    if (preg_match('/\A\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?\z/', (string)($server['HTTP_X_GENESIS_APP_VERSION'] ?? ''))) return 'android_app';
    $agent = (string)($server['HTTP_USER_AGENT'] ?? '');
    if (preg_match('/Android|iPhone|iPad|iPod|Mobile/i', $agent)) return 'mobile_browser';
    if (preg_match('/Windows NT|Macintosh|X11|CrOS/i', $agent)) return 'desktop_browser';
    return null;
}

function genesisRecordClientActivity(string $userId, bool $login = false): void
{
    $kind = genesisRequestClientKind($_SERVER);
    if ($kind === null) return; // Cron and old unidentifiable requests do not become desktop activity.
    $now = genesisNow();
    $statement = genesisDb()->prepare('INSERT INTO user_client_activity(user_id, client_kind, last_seen_at, last_login_at)
        VALUES(:user, :kind, :now, :login) ON CONFLICT(user_id, client_kind) DO UPDATE SET
        last_seen_at = excluded.last_seen_at, last_login_at = COALESCE(excluded.last_login_at, user_client_activity.last_login_at)');
    $statement->execute(['user' => $userId, 'kind' => $kind, 'now' => $now, 'login' => $login ? $now : null]);
}

function genesisObserveClientActivity(string $userId, bool $login = false): void
{
    try { genesisRetentionObserveActivity($userId, $login); }
    catch (Throwable $error) { genesisLogError('Account activity observation failed.', $error); }
    $kind = genesisRequestClientKind($_SERVER);
    if ($kind === null) return;
    $key = $userId . ':' . $kind;
    $android = $kind === 'android_app' ? genesisAndroidClientHeader() : null;
    if ($android !== null) $key .= ':' . implode(':', $android);
    if (!$login && time() - (int)($_SESSION['client_activity_observed'][$key] ?? 0) < 60) return;
    try {
        genesisRecordClientActivity($userId, $login);
        if ($android !== null) genesisReportAndroidClient($userId);
        $_SESSION['client_activity_observed'][$key] = time();
    } catch (Throwable $error) {
        genesisLogError('Client activity observation failed.', $error);
    }
}

function genesisTouchUser(string $userId, bool $login = false): void
{
    $now = genesisNow();
    if ($login) {
        genesisDb()->prepare('UPDATE users SET login_count = login_count + 1, last_login_at = :now, last_seen_at = :now, updated_at = :now WHERE id = :id')->execute([
            'now' => $now,
            'id' => $userId,
        ]);
        return;
    }
    genesisDb()->prepare('UPDATE users SET last_seen_at = :now WHERE id = :id')->execute([
        'now' => $now,
        'id' => $userId,
    ]);
}

function genesisUpsertGoogleUser(array $profile, array $tokens, bool $persistGoogleTokens = true, bool $websiteRegistrationEmail = false, ?string $partnerInvitation = null): array
{
    $email = mb_strtolower(trim((string)($profile['email'] ?? '')));
    $googleSub = trim((string)($profile['sub'] ?? ''));
    $emailVerified = filter_var($profile['email_verified'] ?? false, FILTER_VALIDATE_BOOLEAN);
    if (!genesisIsValidEmail($email) || $emailVerified !== true || $googleSub === '') {
        throw new InvalidArgumentException('Google не подтвердил адрес электронной почты этого аккаунта.');
    }
    genesisAssertIdentityAllowed($googleSub, $email);

    $loginOwner=genesisFindUserByGoogleSub($googleSub);
    $loginLink=genesisFindLinkedGoogleAccountBySub($googleSub);
    if (($loginOwner && !(bool)$loginOwner['google_login_active']) || ($loginLink && !(bool)$loginLink['login_active']))
        throw new DomainException('GOOGLE_LOGIN_REVOKED');

    $db = genesisDb();
    $linkedAccount = genesisFindLinkedGoogleAccountBySub($googleSub);
    if ($linkedAccount !== null && !$persistGoogleTokens) {
        $db->prepare('UPDATE linked_google_accounts SET email = :email, display_name = :display_name, avatar_url = :avatar_url, updated_at = :updated_at WHERE id = :id')->execute([
            'email' => $email,
            'display_name' => mb_substr((string)($profile['name'] ?? $email), 0, 160),
            'avatar_url' => isset($profile['picture']) ? mb_substr((string)$profile['picture'], 0, 1000) : null,
            'updated_at' => genesisNow(),
            'id' => (string)$linkedAccount['id'],
        ]);
        $owner = genesisFindUser((string)$linkedAccount['owner_user_id']);
        if ($owner === null) {
            throw new RuntimeException('Связанное пространство GENESIS не найдено.');
        }
        genesisTouchUser((string)$owner['id'], true);
        return genesisEnsureWorkspaceKey($owner);
    }
    $statement = $db->prepare('SELECT * FROM users WHERE google_sub = :sub LIMIT 1');
    $statement->execute(['sub' => $googleSub]);
    $existing = $statement->fetch();
    if (is_array($existing) && !$persistGoogleTokens) {
        // Identity-only login must never write a stale copy of OAuth credentials
        // or the workspace key while another device is refreshing them.
        $db->prepare('UPDATE users SET email = :email, display_name = :display_name, avatar_url = :avatar_url, login_count = login_count + 1, last_login_at = :now, last_seen_at = :now, updated_at = :now WHERE id = :id')->execute([
            'email' => $email,
            'display_name' => mb_substr((string)($profile['name'] ?? $email), 0, 160),
            'avatar_url' => isset($profile['picture']) ? mb_substr((string)$profile['picture'], 0, 1000) : null,
            'now' => genesisNow(), 'id' => (string)$existing['id'],
        ]);
        return genesisEnsureWorkspaceKey(genesisFindUser((string)$existing['id']) ?? $existing);
    }
    if (!is_array($existing)) {
        $emailOwner = genesisFindUserByEmail($email);
        if ($emailOwner !== null) {
            throw new DomainException('Этот адрес уже связан с другой учётной записью Google. Обратитесь в поддержку GENESIS.');
        }
    }
    $now = genesisNow();
    $id = is_array($existing) ? (string)$existing['id'] : genesisUuid();
    $refresh = $persistGoogleTokens && isset($tokens['refresh_token']) && is_string($tokens['refresh_token'])
        ? genesisEncrypt($tokens['refresh_token'])
        : ($existing['refresh_token_enc'] ?? null);
    $access = $persistGoogleTokens && isset($tokens['access_token']) && is_string($tokens['access_token'])
        ? genesisEncrypt($tokens['access_token'])
        : ($existing['access_token_enc'] ?? null);
    $workspaceKey = is_array($existing) ? ($existing['workspace_key_enc'] ?? null) : null;
    $workspaceKeyMode = is_array($existing) ? (string)($existing['workspace_key_mode'] ?? 'legacy') : 'account';
    $expiresAt = $persistGoogleTokens && isset($tokens['access_token'])
        ? time() + genesisClampInt($tokens['expires_in'] ?? 3600, 60, 86400, 3600) - 60
        : ($existing['token_expires_at'] ?? null);
    $grantedScopes = $persistGoogleTokens
        ? (string)($tokens['scope'] ?? ($existing['granted_scopes'] ?? ''))
        : (string)($existing['granted_scopes'] ?? '');

    $values = [
        'id' => $id,
        'sub' => $googleSub,
        'email' => $email,
        'display_name' => mb_substr((string)($profile['name'] ?? $email), 0, 160),
        'avatar_url' => isset($profile['picture']) ? mb_substr((string)$profile['picture'], 0, 1000) : null,
        'access_token_enc' => $access,
        'refresh_token_enc' => $refresh,
        'token_expires_at' => $expiresAt,
        'granted_scopes' => $grantedScopes,
        'workspace_key_enc' => $workspaceKey,
        'workspace_key_mode' => $workspaceKeyMode,
        'last_login_at' => $now,
        'last_seen_at' => $now,
        'created_at' => is_array($existing) ? (string)$existing['created_at'] : $now,
        'updated_at' => $now,
    ];
    if (is_array($existing)) {
        $db->prepare('UPDATE users SET google_sub = :sub, email = :email, display_name = :display_name, avatar_url = :avatar_url, access_token_enc = :access_token_enc, refresh_token_enc = :refresh_token_enc, token_expires_at = :token_expires_at, granted_scopes = :granted_scopes, workspace_key_enc = :workspace_key_enc, workspace_key_mode = :workspace_key_mode, login_count = login_count + 1, last_login_at = :last_login_at, last_seen_at = :last_seen_at, updated_at = :updated_at WHERE id = :id')->execute([
            'id' => $values['id'],
            'sub' => $values['sub'],
            'email' => $values['email'],
            'display_name' => $values['display_name'],
            'avatar_url' => $values['avatar_url'],
            'access_token_enc' => $values['access_token_enc'],
            'refresh_token_enc' => $values['refresh_token_enc'],
            'token_expires_at' => $values['token_expires_at'],
            'granted_scopes' => $values['granted_scopes'],
            'workspace_key_enc' => $values['workspace_key_enc'],
            'workspace_key_mode' => $values['workspace_key_mode'],
            'last_login_at' => $values['last_login_at'],
            'last_seen_at' => $values['last_seen_at'],
            'updated_at' => $values['updated_at'],
        ]);
    } else {
        $owns=!$db->inTransaction();if($owns)$db->beginTransaction();
        try{
            $db->prepare("INSERT INTO users (id, google_sub, email, display_name, avatar_url, access_token_enc, refresh_token_enc, token_expires_at, granted_scopes, workspace_key_enc, workspace_key_mode, calendar_mode, task_calendar_mode, week_start, login_count, last_login_at, last_seen_at, created_at, updated_at) VALUES (:id, :sub, :email, :display_name, :avatar_url, :access_token_enc, :refresh_token_enc, :token_expires_at, :granted_scopes, :workspace_key_enc, :workspace_key_mode, 'profane', 'profane', 'monday', 1, :last_login_at, :last_seen_at, :created_at, :updated_at)")->execute($values);
            genesisEmailQueueRegistration($id,true);
            $db->prepare('UPDATE users SET calendar_exploration_pending = 1 WHERE id = ?')->execute([$id]);
            genesisPartnerBindRegistration($db, $id, $partnerInvitation);
            if($owns)$db->commit();
        }catch(Throwable $error){if($owns&&$db->inTransaction())$db->rollBack();throw $error;}
    }

    $user = genesisFindUser($id);
    if ($user === null) {
        throw new RuntimeException('User profile could not be saved.');
    }
    return genesisEnsureWorkspaceKey($user);
}

function genesisFindUserByGoogleSub(string $googleSub): ?array
{
    $statement = genesisDb()->prepare('SELECT * FROM users WHERE google_sub = :google_sub LIMIT 1');
    $statement->execute(['google_sub' => $googleSub]);
    $user = $statement->fetch();
    return is_array($user) ? $user : null;
}

/** Yandex identities are never matched or merged by email with Google accounts. */
function genesisFindUserByYandexUid(string $uid): ?array
{
    $statement = genesisDb()->prepare('SELECT * FROM users WHERE yandex_uid = :uid LIMIT 1');
    $statement->execute(['uid' => $uid]);
    $user = $statement->fetch();
    return is_array($user) ? $user : null;
}

/** Yandex identities are never matched or merged by email with Google accounts. */
function genesisUpsertYandexUser(array $profile): array
{
    $uid = trim((string)($profile['id'] ?? ''));
    $email = mb_strtolower(trim((string)($profile['email'] ?? '')));
    if ($uid === '' || strlen($uid) > 128 || !genesisIsValidEmail($email)) {
        throw new InvalidArgumentException('Яндекс не подтвердил данные аккаунта.');
    }
    $internalSub = 'yandex:' . hash('sha256', $uid);
    genesisAssertIdentityAllowed($internalSub, $email);
    if (function_exists('genesisLinkedLocalOwner')) {
        $linkedOwner = genesisLinkedLocalOwner('yandex', $uid);
        if ($linkedOwner !== null) {
            genesisTouchUser((string)$linkedOwner['id'], true);
            return genesisEnsureWorkspaceKey($linkedOwner);
        }
    }
    $db = genesisDb();
    $existing = genesisFindUserByYandexUid($uid);
    if (is_array($existing) && genesisUserProvider($existing) !== 'yandex') {
        throw new DomainException('Аккаунт Яндекса связан с другим способом входа.');
    }
    $emailOwner = genesisFindUserByEmail($email);
    if ($emailOwner !== null && (!is_array($existing) || $emailOwner['id'] !== $existing['id'])) {
        throw new DomainException('Этот адрес уже используется другим аккаунтом GENESIS. Войдите прежним способом или обратитесь в поддержку.');
    }
    $now = genesisNow();
    $name = mb_substr(trim((string)($profile['name'] ?? '')) ?: $email, 0, 160);
    $avatar = isset($profile['picture']) && is_string($profile['picture'])
        ? mb_substr($profile['picture'], 0, 1000) : null;
    if (is_array($existing)) {
        $db->prepare('UPDATE users SET email = :email, display_name = :name, avatar_url = :avatar,
            login_count = login_count + 1, last_login_at = :now, last_seen_at = :now, updated_at = :now
            WHERE id = :id')->execute([
                'email' => $email, 'name' => $name, 'avatar' => $avatar,
                'now' => $now, 'id' => (string)$existing['id'],
            ]);
        return genesisEnsureWorkspaceKey(genesisFindUser((string)$existing['id']) ?? $existing);
    }
    $id = genesisUuid();
    $db->prepare("INSERT INTO users (id, google_sub, auth_provider, yandex_uid, email,
        display_name, avatar_url, workspace_key_mode, calendar_mode, task_calendar_mode,
        week_start, login_count, last_login_at, last_seen_at, created_at, updated_at)
        VALUES (:id, :sub, 'yandex', :uid, :email, :name, :avatar, 'account',
        'profane', 'profane', 'monday', 1, :now, :now, :now, :now)")->execute([
            'id' => $id, 'sub' => $internalSub, 'uid' => $uid, 'email' => $email,
            'name' => $name, 'avatar' => $avatar, 'now' => $now,
        ]);
    $user = genesisFindUser($id);
    if ($user === null) throw new RuntimeException('Yandex profile could not be saved.');
    return genesisEnsureWorkspaceKey($user);
}

/**
 * Persist Android service authorization only for the already authenticated primary sub.
 * Email is profile data, never the account-linking key.
 */
function genesisPersistPrimaryGoogleAuthorization(string $userId, array $profile, array $tokens): array
{
    $user = genesisFindUser($userId);
    if ($user === null) {
        throw new RuntimeException('Пользователь не найден.');
    }
    $sub = trim((string)($profile['sub'] ?? ''));
    $email = mb_strtolower(trim((string)($profile['email'] ?? '')));
    $emailVerified = filter_var($profile['email_verified'] ?? false, FILTER_VALIDATE_BOOLEAN);
    if ($sub === '' || !genesisIsValidEmail($email) || $emailVerified !== true) {
        throw new InvalidArgumentException('Google не подтвердил профиль выбранного аккаунта.');
    }
    genesisAssertIdentityAllowed($sub, $email);
    if (!hash_equals((string)$user['google_sub'], $sub)) {
        throw new DomainException('Выбран другой Google-аккаунт. Войдите в него отдельно через выход из GENESIS.');
    }
    if (empty($tokens['access_token']) || !is_string($tokens['access_token'])) {
        throw new RuntimeException('Google не вернул токен доступа.');
    }
    $grantedScopes = preg_split('/\s+/', trim((string)($tokens['scope'] ?? ''))) ?: [];
    if (array_intersect(GENESIS_GOOGLE_SERVICE_SCOPES, $grantedScopes) === []) {
        throw new DomainException('Google не предоставил доступ ни к Calendar, ни к Tasks.');
    }
    $refresh = !empty($tokens['refresh_token']) && is_string($tokens['refresh_token'])
        ? genesisEncrypt($tokens['refresh_token'])
        : ($user['refresh_token_enc'] ?? null);
    if (empty($refresh)) {
        throw new RuntimeException('Google не вернул токен для фоновой синхронизации. Повторите подключение и подтвердите доступ.');
    }
    $now = genesisNow();
    genesisDb()->prepare('UPDATE users SET email = :email, display_name = :display_name, avatar_url = :avatar_url, access_token_enc = :access_token_enc, refresh_token_enc = :refresh_token_enc, token_expires_at = :token_expires_at, granted_scopes = :granted_scopes, last_seen_at = :last_seen_at, updated_at = :updated_at WHERE id = :id')->execute([
        'id' => $userId,
        'email' => $email,
        'display_name' => mb_substr((string)($profile['name'] ?? $email), 0, 160),
        'avatar_url' => isset($profile['picture']) ? mb_substr((string)$profile['picture'], 0, 1000) : null,
        'access_token_enc' => genesisEncrypt((string)$tokens['access_token']),
        'refresh_token_enc' => $refresh,
        'token_expires_at' => time() + genesisClampInt($tokens['expires_in'] ?? 3600, 60, 86400, 3600) - 60,
        'granted_scopes' => implode(' ', array_values(array_unique($grantedScopes))),
        'last_seen_at' => $now,
        'updated_at' => $now,
    ]);
    $saved = genesisFindUser($userId);
    if ($saved === null) throw new RuntimeException('Google-разрешения не удалось сохранить.');
    return $saved;
}

function genesisLinkGoogleAccount(string $ownerUserId, array $profile, array $tokens): array
{
    $owner=genesisFindUser($ownerUserId);
    if($owner===null) throw new RuntimeException('Пользователь не найден.');
    $sub=trim((string)($profile['sub']??''));$email=mb_strtolower(trim((string)($profile['email']??'')));
    if($sub==='' || !genesisIsValidEmail($email)) throw new InvalidArgumentException('Google-профиль дополнительного аккаунта неполон.');
    genesisAssertIdentityAllowed($sub,$email);
    $identityOnly=genesisGoogleIdentityManagementEnabled();
    if(!$identityOnly && !genesisGoogleTokenHasScopes($tokens,GENESIS_GOOGLE_SERVICE_SCOPES))
        throw new DomainException('Google не предоставил доступ к Calendar и Tasks.');
    $db=genesisDb();$owns=!$db->inTransaction();if($owns)genesisBeginWriteTransaction($db);
    try {
        // Link and durable trial identity claims share one short SQLite writer transaction.
        $owner=genesisFindUser($ownerUserId);
        if($owner===null) throw new RuntimeException('Пользователь не найден.');
        $access=genesisFeatureAccessForUser($owner);
        if(!in_array($access['effectivePlan'],['standard','standart','premium','business','premium4life'],true)||!in_array('data-export',$access['allowedFeatures'],true))throw new GenesisResourceLimitException(403,'FEATURE_SUBSCRIPTION_REQUIRED');
        $securityActor=$identityOnly?genesisGoogleRequireFresh($ownerUserId):null;
        $limit=genesisFeatureLimit($ownerUserId,'google-identities');
        if($limit!==null&&count(array_filter(genesisGoogleLoginIdentities($ownerUserId),static fn(array $row):bool=>$row['active']))>=$limit)throw new GenesisResourceLimitException(403,'GOOGLE_IDENTITY_LIMIT');
        if(hash_equals((string)$owner['google_sub'],$sub)) throw new DomainException('Этот Google-аккаунт уже является основным.');
        $existing=genesisFindLinkedGoogleAccountBySub($sub);
        if($existing!==null && !hash_equals((string)$existing['owner_user_id'],$ownerUserId))
            throw new DomainException('Этот Google-аккаунт уже связан с другим пространством GENESIS.');
        if($identityOnly&&$existing!==null&&(bool)$existing['login_active'])throw new DomainException('GOOGLE_IDENTITY_ALREADY_LINKED');
        $standalone=$db->prepare('SELECT id FROM users WHERE google_sub=? AND id<>? LIMIT 1');$standalone->execute([$sub,$ownerUserId]);
        if($standalone->fetchColumn()!==false)
            throw new DomainException('У этого Google-аккаунта уже есть отдельное пространство GENESIS. Объединение существующих пространств требует отдельного переноса данных.');
        $refresh=!empty($tokens['refresh_token'])?genesisEncrypt((string)$tokens['refresh_token']):($existing['refresh_token_enc']??null);
        if(empty($refresh)&&!$identityOnly) throw new RuntimeException('Google не вернул токен для фоновой синхронизации. Повторите подключение и подтвердите доступ.');
        $id=$existing['id']??genesisUuid();$now=genesisNow();
        $position=$db->prepare('SELECT COALESCE(MAX(position),0)+1 FROM linked_google_accounts WHERE owner_user_id=?');$position->execute([$ownerUserId]);
        $nextPosition=(int)$position->fetchColumn();
        genesisTrialPreserveIdentityClaims($db,$owner,['id'=>$id,'google_sub'=>$sub,'email'=>$email]);
        $db->prepare('INSERT INTO linked_google_accounts (id,owner_user_id,google_sub,email,display_name,avatar_url,access_token_enc,refresh_token_enc,token_expires_at,granted_scopes,google_calendar_id,position,created_at,updated_at) VALUES (:id,:owner_user_id,:google_sub,:email,:display_name,:avatar_url,:access_token_enc,:refresh_token_enc,:token_expires_at,:granted_scopes,:google_calendar_id,:position,:created_at,:updated_at) ON CONFLICT(id) DO UPDATE SET email=excluded.email,display_name=excluded.display_name,avatar_url=excluded.avatar_url,access_token_enc=excluded.access_token_enc,refresh_token_enc=excluded.refresh_token_enc,token_expires_at=excluded.token_expires_at,granted_scopes=excluded.granted_scopes,updated_at=excluded.updated_at')->execute([
            'id'=>(string)$id,'owner_user_id'=>$ownerUserId,'google_sub'=>$sub,'email'=>$email,
            'display_name'=>mb_substr((string)($profile['name']??$email),0,160),
            'avatar_url'=>isset($profile['picture'])?mb_substr((string)$profile['picture'],0,1000):null,
            'access_token_enc'=>$identityOnly?($existing['access_token_enc']??null):genesisEncrypt((string)$tokens['access_token']),'refresh_token_enc'=>$refresh,
            'token_expires_at'=>$identityOnly?($existing['token_expires_at']??null):time()+genesisClampInt($tokens['expires_in']??3600,60,86400,3600)-60,
            'granted_scopes'=>$identityOnly?(string)($existing['granted_scopes']??''):(string)($tokens['scope']??''),'google_calendar_id'=>$existing['google_calendar_id']??null,
            'position'=>$existing['position']??$nextPosition,'created_at'=>$existing['created_at']??$now,'updated_at'=>$now,
        ]);
        $account=genesisFindLinkedGoogleAccount((string)$id);
        if($account===null) throw new RuntimeException('Дополнительный аккаунт не удалось сохранить.');
        if($identityOnly){
            $db->prepare('UPDATE linked_google_accounts SET login_active=1 WHERE id=?')->execute([(string)$id]);
            $db->prepare('UPDATE users SET security_epoch=security_epoch+1 WHERE id=?')->execute([$ownerUserId]);
            genesisGoogleInvalidatePendingRecovery($ownerUserId);genesisGoogleSecurityEvent($ownerUserId,'login-linked',$securityActor['id'],(string)$id);
        }
        if($owns)$db->commit();
    } catch(Throwable $error) {if($owns&&$db->inTransaction())$db->rollBack();throw $error;}
    // Provider I/O remains outside the transaction owned by this function.
    return $identityOnly?$account:genesisEnsureGoogleCalendar($account);
}

function genesisSetPassword(string $userId, string $password, ?string $currentPassword = null): void
{
    $user = genesisFindUser($userId);
    if ($user === null) {
        throw new RuntimeException('Пользователь не найден.');
    }
    if (!genesisIsValidEmail((string)$user['email']) || empty($user['refresh_token_enc'])) {
        throw new RuntimeException('Сначала подключите Google Calendar через Gmail.');
    }
    if (mb_strlen($password) < 10 || mb_strlen($password) > 200) {
        throw new InvalidArgumentException('Пароль должен содержать от 10 до 200 символов.');
    }
    if (!empty($user['password_hash']) && (!is_string($currentPassword) || !password_verify($currentPassword, (string)$user['password_hash']))) {
        throw new InvalidArgumentException('Текущий пароль указан неверно.');
    }
    genesisDb()->prepare('UPDATE users SET password_hash = :hash, password_set_at = :set_at, updated_at = :updated_at WHERE id = :id')->execute([
        'hash' => password_hash($password, PASSWORD_DEFAULT),
        'set_at' => genesisNow(),
        'updated_at' => genesisNow(),
        'id' => $userId,
    ]);
}

function genesisVerifyPasswordLogin(string $email, string $password): ?array
{
    if (!genesisIsValidEmail($email)) {
        return null;
    }
    $user = genesisFindUserByEmail($email);
    if ($user === null || empty($user['password_hash']) || !password_verify($password, (string)$user['password_hash'])) {
        password_verify($password, '$2y$10$K1yDr0vymZ4G9LdK4ZqvR.Qp4BUl8gmDjuO8XkXkjHHwB86b1ZZwG');
        return null;
    }
    genesisTouchUser((string)$user['id'], true);
    return genesisFindUser((string)$user['id']);
}

function genesisWorkspaceForClient(array $user): array
{
    $clientManaged = ($user['workspace_key_mode'] ?? 'legacy') === 'client' && empty($user['workspace_key_enc']);
    $key = null;
    if (!$clientManaged) {
        $user = genesisEnsureWorkspaceKey($user);
        $key = genesisDecrypt($user['workspace_key_enc'] ?? null);
        if (!is_string($key) || $key === '') {
            throw new RuntimeException('Workspace encryption key is unavailable.');
        }
    }
    $statement = genesisDb()->prepare('SELECT ciphertext, iv, version, updated_at, minimum_writer_protocol FROM workspace_blobs WHERE user_id = :user_id LIMIT 1');
    $statement->execute(['user_id' => (string)$user['id']]);
    $blob = $statement->fetch();
    return [
        'key' => $key,
        'keyMode' => $clientManaged ? (empty($user['workspace_key_wrapped']) ? 'new' : 'client') : 'account',
        'wrappedKey' => $clientManaged ? ($user['workspace_key_wrapped'] ?: null) : null,
        'wrappedKeyIv' => $clientManaged ? ($user['workspace_key_iv'] ?: null) : null,
        'supportedWriterProtocol' => 9,
        'envelope' => is_array($blob) ? [
            'ciphertext' => (string)$blob['ciphertext'],
            'iv' => (string)$blob['iv'],
            'version' => (int)$blob['version'],
            'updatedAt' => (string)$blob['updated_at'],
            'minimumWriterProtocol' => (int)$blob['minimum_writer_protocol'],
        ] : null,
    ];
}

function genesisSaveClientWorkspaceKey(string $userId, array $payload): array
{
    $key = trim((string)($payload['key'] ?? ''));
    $wrappedKey = trim((string)($payload['wrappedKey'] ?? ''));
    $iv = trim((string)($payload['iv'] ?? ''));
    $decodedPlainKey = base64_decode($key, true);
    $decodedKey = base64_decode($wrappedKey, true);
    $decodedIv = base64_decode($iv, true);
    if (!is_string($decodedPlainKey) || strlen($decodedPlainKey) !== 32) {
        throw new InvalidArgumentException('Workspace key is invalid.');
    }
    if (!is_string($decodedKey) || strlen($decodedKey) < 48 || strlen($decodedKey) > 96) {
        throw new InvalidArgumentException('Wrapped workspace key is invalid.');
    }
    if (!is_string($decodedIv) || strlen($decodedIv) !== 12) {
        throw new InvalidArgumentException('Wrapped workspace key IV is invalid.');
    }
    genesisDb()->prepare('UPDATE users SET workspace_key_mode = :mode, workspace_key_wrapped = :wrapped_key, workspace_key_iv = :iv, workspace_key_enc = :workspace_key, updated_at = :updated_at WHERE id = :id')->execute([
        'mode' => 'account',
        'wrapped_key' => $wrappedKey,
        'iv' => $iv,
        'workspace_key' => genesisEncrypt($key),
        'updated_at' => genesisNow(),
        'id' => $userId,
    ]);
    return ['keyMode' => 'account'];
}

function genesisSaveWorkspaceEnvelope(string $userId, array $payload): array
{
    $ciphertext = trim((string)($payload['ciphertext'] ?? ''));
    $iv = trim((string)($payload['iv'] ?? ''));
    if ($ciphertext === '' || strlen($ciphertext) > 10_000_000 || !preg_match('/^[A-Za-z0-9+\/=]+$/', $ciphertext)) {
        throw new InvalidArgumentException('Encrypted workspace is invalid.');
    }
    if ($iv === '' || strlen($iv) > 128 || !preg_match('/^[A-Za-z0-9+\/=]+$/', $iv)) {
        throw new InvalidArgumentException('Workspace IV is invalid.');
    }
    $hasExpectedVersion = array_key_exists('expectedVersion', $payload);
    $expectedVersion = genesisClampInt($payload['expectedVersion'] ?? 0, 0, 9_000_000_000_000_000, 0);
    $writerProtocol = genesisClampInt($payload['writerProtocol'] ?? 1, 1, 9, 1);
    $requiredProtocol = genesisClampInt($payload['minimumWriterProtocol'] ?? 1, 1, 9, 1);
    if ($writerProtocol < $requiredProtocol) throw new DomainException('WORKSPACE_UPGRADE_REQUIRED');
    $db = genesisDb();
    $ownsTransaction = !$db->inTransaction();
    if ($ownsTransaction) {
        $db->exec('BEGIN IMMEDIATE');
    }
    try {
        $statement = $db->prepare('SELECT version, minimum_writer_protocol FROM workspace_blobs WHERE user_id = :user_id LIMIT 1');
        $statement->execute(['user_id' => $userId]);
        $stored = $statement->fetch();
        $currentVersion = $stored === false ? 0 : (int)$stored['version'];
        $requiredProtocol = max($requiredProtocol, $stored === false ? 1 : (int)$stored['minimum_writer_protocol']);
        if ($writerProtocol < $requiredProtocol) throw new DomainException('WORKSPACE_UPGRADE_REQUIRED');
        if ($hasExpectedVersion && $expectedVersion !== $currentVersion) {
            throw new GenesisWorkspaceConflictException($currentVersion);
        }
        $version = $currentVersion + 1;
        genesisWorkspaceResourceCensus($userId,$payload,$version,$stored!==false);
        $now = genesisNow();
        $db->prepare('INSERT INTO workspace_blobs (user_id, ciphertext, iv, version, updated_at, minimum_writer_protocol, writer_protocol_version) VALUES (:user_id, :ciphertext, :iv, :version, :updated_at, :minimum_writer_protocol, :writer_protocol_version) ON CONFLICT(user_id) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, version = excluded.version, updated_at = excluded.updated_at, minimum_writer_protocol = excluded.minimum_writer_protocol, writer_protocol_version = excluded.writer_protocol_version')->execute([
            'user_id' => $userId,
            'ciphertext' => $ciphertext,
            'iv' => $iv,
            'version' => $version,
            'updated_at' => $now,
            'minimum_writer_protocol' => $requiredProtocol,
            'writer_protocol_version' => $version,
        ]);
        genesisHabitReminderWorkspaceSaved($userId,$version,$payload);
        if ($ownsTransaction) {
            $db->exec('COMMIT');
        }
        return ['version' => $version, 'updatedAt' => $now];
    } catch (Throwable $error) {
        if ($ownsTransaction) {
            $db->exec('ROLLBACK');
        }
        throw $error;
    }
}

function genesisSaveMetrics(string $userId, array $payload): void
{
    $metrics = is_array($payload['metrics'] ?? null) ? $payload['metrics'] : $payload;
    $values = [
        'project_count' => genesisClampInt($metrics['projectCount'] ?? 0, 0, 1_000_000, 0),
        'task_count' => genesisClampInt($metrics['taskCount'] ?? 0, 0, 10_000_000, 0),
        'open_task_count' => genesisClampInt($metrics['openTaskCount'] ?? 0, 0, 10_000_000, 0),
        'completed_task_count' => genesisClampInt($metrics['completedTaskCount'] ?? 0, 0, 10_000_000, 0),
        'google_synced_count' => genesisClampInt($metrics['googleSyncedCount'] ?? 0, 0, 10_000_000, 0),
        'habit_count' => genesisClampInt($metrics['habitCount'] ?? 0, 0, 100_000, 0),
    ];
    $values['user_id'] = $userId;
    $values['updated_at'] = genesisNow();
    genesisDb()->prepare('INSERT INTO user_metrics (user_id, project_count, task_count, open_task_count, completed_task_count, google_synced_count, habit_count, updated_at) VALUES (:user_id, :project_count, :task_count, :open_task_count, :completed_task_count, :google_synced_count, :habit_count, :updated_at) ON CONFLICT(user_id) DO UPDATE SET project_count = excluded.project_count, task_count = excluded.task_count, open_task_count = excluded.open_task_count, completed_task_count = excluded.completed_task_count, google_synced_count = excluded.google_synced_count, habit_count = excluded.habit_count, updated_at = excluded.updated_at')->execute($values);
    genesisTouchUser($userId);
}

function genesisRequireAdmin(array $user): void
{
    if (!genesisIsAdminUser($user) || !genesisSessionOwnsGoogleAccount($user)) {
        genesisJson(['error' => 'FORBIDDEN'], 403);
    }
}

function genesisRecordAndroidDownload(string $userId, string $version): void
{
    $now = genesisNow();
    genesisDb()->prepare('INSERT INTO android_download_activity (user_id, request_count, first_requested_at, last_requested_at, last_requested_version) VALUES (:user_id, 1, :first_requested_at, :last_requested_at, :last_requested_version) ON CONFLICT(user_id) DO UPDATE SET request_count = android_download_activity.request_count + 1, last_requested_at = excluded.last_requested_at, last_requested_version = excluded.last_requested_version')->execute([
        'user_id' => $userId,
        'first_requested_at' => $now,
        'last_requested_at' => $now,
        'last_requested_version' => $version,
    ]);
}

function genesisAndroidClientHeader(): ?array
{
    $version = trim((string)($_SERVER['HTTP_X_GENESIS_APP_VERSION'] ?? ''));
    $installationId = trim((string)($_SERVER['HTTP_X_GENESIS_INSTALLATION_ID'] ?? ''));
    if (!preg_match('/^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/D', $version)
        || !preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iD', $installationId)) {
        return null;
    }
    return [$version, strtolower($installationId)];
}

function genesisReportAndroidClient(string $userId, ?string $serverSyncStatus = null,
    ?string $googleSyncStatus = null): void
{
    $header = genesisAndroidClientHeader();
    if ($header === null) return;
    $now = genesisNow();
    $hasSync = $serverSyncStatus !== null;
    $serverSyncStatus = in_array($serverSyncStatus, ['ok', 'warning'], true) ? $serverSyncStatus : 'unknown';
    $googleSyncStatus = in_array($googleSyncStatus, ['ok', 'warning', 'disconnected'], true)
        ? $googleSyncStatus : 'unknown';
    genesisDb()->prepare('INSERT INTO android_client_reports (user_id, installation_id, app_version, first_seen_at, last_seen_at, last_server_sync_at, server_sync_status, google_sync_status) VALUES (:user_id, :installation_id, :app_version, :first_seen_at, :last_seen_at, :last_server_sync_at, :server_sync_status, :google_sync_status) ON CONFLICT(user_id, installation_id) DO UPDATE SET app_version = excluded.app_version, last_seen_at = excluded.last_seen_at, last_server_sync_at = COALESCE(excluded.last_server_sync_at, android_client_reports.last_server_sync_at), server_sync_status = CASE WHEN excluded.last_server_sync_at IS NULL THEN android_client_reports.server_sync_status ELSE excluded.server_sync_status END, google_sync_status = CASE WHEN excluded.last_server_sync_at IS NULL THEN android_client_reports.google_sync_status ELSE excluded.google_sync_status END')->execute([
        'user_id' => $userId,
        'installation_id' => $header[1],
        'app_version' => $header[0],
        'first_seen_at' => $now,
        'last_seen_at' => $now,
        'last_server_sync_at' => $hasSync ? $now : null,
        'server_sync_status' => $serverSyncStatus,
        'google_sync_status' => $googleSyncStatus,
    ]);
}

function genesisFeatureCatalog(): array
{
    return [
        'menu.today', 'menu.tasks', 'menu.projects', 'menu.calendar', 'menu.habits',
        'menu.sacred', 'menu.settings',
        'submenu.tasks.tasks', 'submenu.tasks.lists',
        'submenu.projects.personal', 'submenu.projects.shared',
        'submenu.calendar.month', 'submenu.calendar.year',
        'submenu.habits.habits', 'submenu.habits.sleep',
        'submenu.sacred.stoicheion', 'submenu.sacred.theokyklos',
        'submenu.settings.appearance', 'submenu.settings.habits',
        'submenu.settings.reminders', 'submenu.settings.shared',
        'submenu.settings.region', 'submenu.settings.account', 'submenu.settings.links',
        'calendar.profane', 'calendar.sacred', 'calendar.lunar',
    ];
}

function genesisRecordFeatureUsage(string $userId, array $payload): void
{
    $platform = $payload['platform'] ?? null;
    $features = $payload['features'] ?? null;
    if (!in_array($platform, ['web', 'android'], true) || !is_array($features) ||
        !array_is_list($features) || count($features) < 1 || count($features) > 4 ||
        array_filter($features, static fn(mixed $feature): bool => !is_string($feature) ||
            !in_array($feature, genesisFeatureCatalog(), true)) ||
        count(array_unique($features)) !== count($features)) {
        throw new InvalidArgumentException('INVALID_FEATURE_USAGE');
    }
    $now = genesisNow();
    $statement = genesisDb()->prepare('INSERT INTO feature_usage
        (user_id, feature_id, platform, open_count, first_seen_at, last_seen_at)
        VALUES (:user_id, :feature_id, :platform, 1, :first_seen_at, :last_seen_at)
        ON CONFLICT(user_id, feature_id, platform) DO UPDATE SET
            open_count = feature_usage.open_count + 1, last_seen_at = excluded.last_seen_at');
    foreach ($features as $feature) {
        $statement->execute(['user_id' => $userId, 'feature_id' => $feature,
            'platform' => $platform, 'first_seen_at' => $now, 'last_seen_at' => $now]);
    }
}

function genesisAdminFeatureUsage(int $userCount): array
{
    $recorded = [];
    $firstSeen = null;
    foreach (genesisDb()->query('SELECT feature_id, SUM(open_count) AS opens,
        COUNT(DISTINCT user_id) AS used_users,
        SUM(CASE WHEN platform = \'web\' THEN open_count ELSE 0 END) AS web_opens,
        SUM(CASE WHEN platform = \'android\' THEN open_count ELSE 0 END) AS android_opens,
        MIN(first_seen_at) AS first_seen_at
        FROM feature_usage GROUP BY feature_id') as $row) {
        $recorded[(string)$row['feature_id']] = $row;
        if ($firstSeen === null || (string)$row['first_seen_at'] < $firstSeen)
            $firstSeen = (string)$row['first_seen_at'];
    }
    $disabled = array_fill_keys(genesisFeatureCatalog(), 0);
    foreach (genesisDb()->query('SELECT ui_visibility_json, shared_projects_enabled FROM users') as $user) {
        $visibility = genesisUiVisibility($user['ui_visibility_json'] ?? '{}');
        foreach (genesisFeatureCatalog() as $feature) {
            $id = str_starts_with($feature, 'menu.') ? substr($feature, 5) :
                (str_starts_with($feature, 'submenu.') ? substr($feature, 8) : $feature);
            $hidden = str_starts_with($feature, 'menu.') && in_array($id, $visibility['hiddenMenuItems'], true);
            if ($feature === 'menu.sacred' && in_array('stoicheion', $visibility['hiddenMenuItems'], true) &&
                in_array('theokyklos', $visibility['hiddenMenuItems'], true)) $hidden = true;
            if (str_starts_with($feature, 'submenu.')) {
                $hidden = in_array($id, $visibility['hiddenSubmenus'], true) ||
                    (str_starts_with($id, 'sacred.') &&
                        in_array(substr($id, 7), $visibility['hiddenMenuItems'], true));
            }
            if ($feature === 'submenu.projects.shared' && !(bool)$user['shared_projects_enabled']) $hidden = true;
            if (str_starts_with($feature, 'calendar.'))
                $hidden = !in_array(substr($feature, 9), $visibility['enabledCalendars'], true);
            if ($hidden) $disabled[$feature]++;
        }
    }
    $features = [];
    foreach (genesisFeatureCatalog() as $feature) {
        $row = $recorded[$feature] ?? null;
        $features[] = ['id' => $feature, 'opens' => (int)($row['opens'] ?? 0),
            'usedUsers' => (int)($row['used_users'] ?? 0), 'disabledUsers' => $disabled[$feature],
            'webOpens' => (int)($row['web_opens'] ?? 0),
            'androidOpens' => (int)($row['android_opens'] ?? 0)];
    }
    usort($features, static fn(array $a, array $b): int => $b['opens'] <=> $a['opens']);
    return ['startedAt' => $firstSeen, 'accountCount' => $userCount, 'features' => $features];
}

/** Contact, version and sync state must describe the same installation. */
function genesisAdminAndroidReports(): array
{
    $byUser = [];
    $rows = genesisDb()->query('SELECT user_id, installation_id, app_version, last_seen_at, last_server_sync_at, server_sync_status, google_sync_status FROM android_client_reports')->fetchAll();
    usort($rows, static fn(array $a, array $b): int => strcmp($b['last_seen_at'], $a['last_seen_at'])
        ?: version_compare($b['app_version'], $a['app_version']) ?: strcmp($a['installation_id'], $b['installation_id']));
    foreach ($rows as $row) {
        $user = (string)$row['user_id']; $version = (string)$row['app_version'];
        $report = ['version' => $version, 'lastSeenAt' => $row['last_seen_at'],
            'lastServerSyncAt' => $row['last_server_sync_at'] ?: null,
            'serverSyncStatus' => $row['server_sync_status'] ?: null,
            'googleSyncStatus' => $row['google_sync_status'] ?: null];
        $byUser[$user] ??= ['latest' => $report, 'installationCount' => 0, 'versions' => []];
        $byUser[$user]['installationCount']++;
        $byUser[$user]['versions'][$version] ??= $report + ['installationCount' => 0];
        $byUser[$user]['versions'][$version]['installationCount']++;
    }
    foreach ($byUser as &$user) {
        $user['versions'] = array_values($user['versions']);
        usort($user['versions'], static fn(array $a, array $b): int => version_compare($b['version'], $a['version']));
    }
    unset($user);
    return $byUser;
}

function genesisAdminStats(): array
{
    $androidReports = genesisAdminAndroidReports();
    $clientActivity = [];
    foreach (genesisDb()->query('SELECT user_id, client_kind, last_seen_at, last_login_at FROM user_client_activity ORDER BY client_kind') as $client) {
        $clientActivity[$client['user_id']][] = ['kind' => $client['client_kind'], 'lastSeenAt' => $client['last_seen_at'], 'lastLoginAt' => $client['last_login_at'] ?: null];
    }
    $rows = genesisDb()->query('SELECT u.id, u.auth_provider, u.email, u.display_name, u.subscription_plan, u.forecast_elite_plus, u.forecast_privilege_revision, u.created_at, u.last_login_at, u.last_seen_at, u.login_count, u.password_hash IS NOT NULL AS password_enabled, u.refresh_token_enc IS NOT NULL AS google_auth_connected, u.refresh_token_enc IS NOT NULL AND u.google_calendar_id IS NOT NULL AS calendar_connected, u.last_calendar_sync_at, COALESCE(m.project_count, 0) AS project_count, COALESCE(m.task_count, 0) AS task_count, COALESCE(m.open_task_count, 0) AS open_task_count, COALESCE(m.completed_task_count, 0) AS completed_task_count, COALESCE(m.google_synced_count, 0) AS google_synced_count, COALESCE(m.habit_count, 0) AS habit_count, m.updated_at AS metrics_updated_at, COALESCE(d.request_count, 0) AS android_download_count, d.first_requested_at AS android_first_download_at, d.last_requested_at AS android_last_download_at, d.last_requested_version AS android_last_download_version FROM users u LEFT JOIN user_metrics m ON m.user_id = u.id LEFT JOIN android_download_activity d ON d.user_id = u.id ORDER BY COALESCE(u.last_seen_at, u.created_at) DESC')->fetchAll();
    $linkedAuthIds = array_fill_keys(genesisDb()->query('SELECT DISTINCT owner_user_id FROM linked_google_accounts WHERE refresh_token_enc IS NOT NULL')->fetchAll(PDO::FETCH_COLUMN), true);
    $linkedCalendarIds = array_fill_keys(genesisDb()->query('SELECT DISTINCT owner_user_id FROM linked_google_accounts WHERE refresh_token_enc IS NOT NULL AND google_calendar_id IS NOT NULL')->fetchAll(PDO::FETCH_COLUMN), true);
    $yandexConnections = [];
    foreach (genesisDb()->query('SELECT user_id, last_checked_at FROM yandex_calendar_connections') as $connection) {
        $yandexConnections[(string)$connection['user_id']] = $connection['last_checked_at'] ?: null;
    }
    $yandexEventCounts = [];
    foreach (genesisDb()->query('SELECT user_id, COUNT(*) AS event_count FROM yandex_calendar_tasks GROUP BY user_id') as $count) {
        $yandexEventCounts[(string)$count['user_id']] = (int)$count['event_count'];
    }
    return [
        'users' => array_map(static fn(array $row): array => [
            'id' => (string)$row['id'],
            'email' => (string)$row['email'],
            'displayName' => (string)$row['display_name'],
            'subscriptionPlan' => genesisSubscriptionPlanId($row),
            'subscriptionRevision' => (int)genesisSubscriptionState(genesisDb(),$row)['revision'],
            'forecastElitePlus' => genesisForecastElitePlus($row),
            'forecastPrivilegeRevision' => (int)$row['forecast_privilege_revision'],
            'createdAt' => (string)$row['created_at'],
            'lastLoginAt' => $row['last_login_at'] ?: null,
            'lastSeenAt' => $row['last_seen_at'] ?: null,
            'clientActivity' => $clientActivity[$row['id']] ?? [],
            'loginCount' => (int)$row['login_count'],
            'passwordEnabled' => (bool)$row['password_enabled'],
            'calendarConnected' => (bool)$row['calendar_connected'] || isset($linkedCalendarIds[$row['id']]),
            'googleAuthConnected' => (bool)$row['google_auth_connected'] || isset($linkedAuthIds[$row['id']]),
            'lastGoogleCalendarSyncAt' => $row['last_calendar_sync_at'] ?: null,
            'yandexCalendarConnected' => array_key_exists($row['id'], $yandexConnections),
            'yandexSyncedCount' => $yandexEventCounts[$row['id']] ?? 0,
            'lastYandexCalendarCheckAt' => $yandexConnections[$row['id']] ?? null,
            'projectCount' => (int)$row['project_count'],
            'taskCount' => (int)$row['task_count'],
            'openTaskCount' => (int)$row['open_task_count'],
            'completedTaskCount' => (int)$row['completed_task_count'],
            'googleSyncedCount' => (int)$row['google_synced_count'],
            'habitCount' => (int)$row['habit_count'],
            'isAdmin' => genesisIsAdminUser($row),
            'metricsUpdatedAt' => $row['metrics_updated_at'] ?: null,
            'androidDownloadCount' => (int)$row['android_download_count'],
            'androidFirstDownloadAt' => $row['android_first_download_at'] ?: null,
            'androidLastDownloadAt' => $row['android_last_download_at'] ?: null,
            'androidLastDownloadVersion' => $row['android_last_download_version'] ?: null,
            'androidDeviceCount' => $androidReports[$row['id']]['installationCount'] ?? 0,
            'androidReportedVersion' => $androidReports[$row['id']]['latest']['version'] ?? null,
            'androidLastSeenAt' => $androidReports[$row['id']]['latest']['lastSeenAt'] ?? null,
            'androidLastServerSyncAt' => $androidReports[$row['id']]['latest']['lastServerSyncAt'] ?? null,
            'androidServerSyncStatus' => $androidReports[$row['id']]['latest']['serverSyncStatus'] ?? null,
            'androidGoogleSyncStatus' => $androidReports[$row['id']]['latest']['googleSyncStatus'] ?? null,
            'androidVersions' => $androidReports[$row['id']]['versions'] ?? [],
        ], $rows),
        'totals' => [
            'users' => count($rows),
            'projects' => array_sum(array_map(static fn(array $row): int => (int)$row['project_count'], $rows)),
            'tasks' => array_sum(array_map(static fn(array $row): int => (int)$row['task_count'], $rows)),
            'completedTasks' => array_sum(array_map(static fn(array $row): int => (int)$row['completed_task_count'], $rows)),
            'habits' => array_sum(array_map(static fn(array $row): int => (int)$row['habit_count'], $rows)),
            'blockedIdentities' => (int)genesisDb()->query('SELECT COUNT(*) FROM blocked_identities')->fetchColumn(),
            'androidDownloadRequests' => array_sum(array_map(static fn(array $row): int => (int)$row['android_download_count'], $rows)),
            'androidReportingUsers' => count($androidReports),
        ],
        'featureUsage' => genesisAdminFeatureUsage(count($rows)),
    ];
}

function genesisAssertIdentityAllowed(string $googleSub, string $email): void
{
    $statement = genesisDb()->prepare('SELECT 1 FROM blocked_identities WHERE google_sub_hash = :google_sub_hash OR email_hash = :email_hash LIMIT 1');
    $statement->execute([
        'google_sub_hash' => genesisIdentifierHash('google-sub', $googleSub),
        'email_hash' => genesisIdentifierHash('email', $email),
    ]);
    if ($statement->fetchColumn() !== false) {
        throw new DomainException('Этот аккаунт заблокирован администратором GENESIS.');
    }
}

function genesisBlockUserIdentity(array $user): void
{
    $googleSub = trim((string)($user['google_sub'] ?? ''));
    $email = trim((string)($user['email'] ?? ''));
    $statement = genesisDb()->prepare('INSERT OR IGNORE INTO blocked_identities (id, google_sub_hash, email_hash, created_at) VALUES (:id, :google_sub_hash, :email_hash, :created_at)');
    $statement->execute([
        'id' => genesisUuid(),
        'google_sub_hash' => $googleSub !== '' ? genesisIdentifierHash('google-sub', $googleSub) : null,
        'email_hash' => $email !== '' ? genesisIdentifierHash('email', $email) : null,
        'created_at' => genesisNow(),
    ]);
}

function genesisStoicheionDrawForClient(array $row, bool $unlimited=false): array
{
    $firstAt = strtotime((string)$row['first_draw_at']);
    $deadline = ($firstAt !== false ? $firstAt : time()) + 180;
    $attempts = (int)$row['attempt_count'];
    $remaining = max(0, $deadline - time());
    return [
        'kind' => (string)$row['draw_kind'],
        'dayKey' => (string)$row['day_key'],
        'seed' => (int)$row['seed_value'],
        'attempts' => $attempts,
        'firstDrawAt' => (string)$row['first_draw_at'],
        'rerollDeadline' => gmdate('Y-m-d\TH:i:s\Z', $deadline),
        'remainingSeconds' => $remaining,
        'canReroll' => $unlimited || ($attempts === 1 && $remaining > 0),
        'unlimited' => $unlimited,
    ];
}

/** Calendar-week windows keep the original draw date and historical rows. */
function genesisStoicheionPeriodStart(string $dayKey, string $kind, bool $unlimited=false): string
{
    if($kind==='daily'||$unlimited)return $dayKey;
    $day=new DateTimeImmutable($dayKey.'T12:00:00',genesisClientTimeZone());
    return $day->modify('-'.((int)$day->format('N')-1).' days')->format('Y-m-d');
}

function genesisStoicheionDraws(string $userId): array
{
    $dayKey=genesisClientDayKey();$unlimited=genesisForecastTestingOwner(genesisFindUser($userId)??[]);$draws=[];
    foreach(['daily','spread','timeline'] as $kind){
        $table=$kind==='timeline'?'stoicheion_timeline_draws':'stoicheion_draws';
        $q=genesisDb()->prepare("SELECT * FROM $table WHERE user_id=? AND draw_kind=? AND day_key>=? AND day_key<=? ORDER BY day_key DESC,first_draw_at DESC LIMIT 1");
        $q->execute([$userId,$kind,genesisStoicheionPeriodStart($dayKey,$kind,$unlimited),$dayKey]);
        if($row=$q->fetch())$draws[$kind]=genesisStoicheionDrawForClient($row,$unlimited);
        if($kind==='timeline'&&isset($draws[$kind])&&genesisTimelineSession($userId)) {
            $draws[$kind]['canReroll']=false;$draws[$kind]['unlimited']=false;
        }
    }
    return ['dayKey'=>$dayKey,'draws'=>$draws,'testingAccess'=>$unlimited,'weeklyStart'=>genesisStoicheionPeriodStart($dayKey,'spread')];
}

function genesisSaveStoicheionDraw(string $userId, string $kind, int $seed): array
{
    $user = genesisFindUser($userId);
    if ($user === null) {
        throw new DomainException('Пользователь не найден.');
    }
    if (!empty($user['stoicheion_divination_disabled'])) {
        throw new DomainException('Гадания по картам отключены в личном кабинете.');
    }
    if (!in_array($kind, ['daily', 'spread', 'timeline'], true)) {
        throw new InvalidArgumentException('Неизвестный вид расклада.');
    }
    if ($seed < 0 || $seed > 4294967295) {
        throw new InvalidArgumentException('Зерно расклада указано неверно.');
    }
    $db = genesisDb();
    $dayKey = genesisClientDayKey();
    $now = genesisNow();
    $drawTable = $kind === 'timeline' ? 'stoicheion_timeline_draws' : 'stoicheion_draws';
    $unlimited=genesisForecastTestingOwner($user);
    $periodStart=genesisStoicheionPeriodStart($dayKey,$kind,$unlimited);
    $db->exec('BEGIN IMMEDIATE');
    try {
        if ($kind === 'timeline' && genesisTimelineSession($userId)) throw new DomainException('TIMELINE_CARD_PROTOCOL_REQUIRED');
        $statement = $db->prepare("SELECT * FROM $drawTable WHERE user_id = :user_id AND day_key >= :period_start AND day_key <= :day_key AND draw_kind = :draw_kind ORDER BY day_key DESC,first_draw_at DESC LIMIT 1");
        $statement->execute(['user_id' => $userId, 'period_start' => $periodStart, 'day_key' => $dayKey, 'draw_kind' => $kind]);
        $existing = $statement->fetch();
        if (!is_array($existing)) {
            $db->prepare("INSERT INTO $drawTable (user_id, day_key, draw_kind, seed_value, attempt_count, first_draw_at, updated_at) VALUES (:user_id, :day_key, :draw_kind, :seed_value, 1, :first_draw_at, :updated_at)")->execute([
                'user_id' => $userId,
                'day_key' => $dayKey,
                'draw_kind' => $kind,
                'seed_value' => $seed,
                'first_draw_at' => $now,
                'updated_at' => $now,
            ]);
        } elseif($unlimited) {
            $db->prepare("UPDATE $drawTable SET seed_value=?,attempt_count=1,first_draw_at=?,updated_at=? WHERE user_id=? AND day_key=? AND draw_kind=?")->execute([$seed,$now,$now,$userId,$existing['day_key'],$kind]);
        } else {
            $dayKey=(string)$existing['day_key'];
            $firstAt = strtotime((string)$existing['first_draw_at']);
            $withinWindow = $firstAt !== false && time() < $firstAt + 180;
            if ((int)$existing['attempt_count'] !== 1 || !$withinWindow) {
                throw new DomainException((int)$existing['attempt_count'] >= 2
                    ? 'Переброс на сегодня уже использован.'
                    : 'Трёхминутное окно для переброса завершилось.');
            }
            $db->prepare("UPDATE $drawTable SET seed_value = :seed_value, attempt_count = 2, updated_at = :updated_at WHERE user_id = :user_id AND day_key = :day_key AND draw_kind = :draw_kind")->execute([
                'seed_value' => $seed,
                'updated_at' => $now,
                'user_id' => $userId,
                'day_key' => $dayKey,
                'draw_kind' => $kind,
            ]);
        }
        $statement->execute(['user_id' => $userId, 'period_start' => $periodStart, 'day_key' => $dayKey, 'draw_kind' => $kind]);
        $saved = $statement->fetch();
        if (!is_array($saved)) {
            throw new RuntimeException('Расклад не удалось сохранить.');
        }
        $db->exec('COMMIT');
        genesisTouchUser($userId);
        return genesisStoicheionDrawForClient($saved,$unlimited);
    } catch (Throwable $error) {
        $db->exec('ROLLBACK');
        throw $error;
    }
}

function genesisUpdateAccountPreferences(string $userId, array $payload): array
{
    $db = genesisDb(); $owns = !$db->inTransaction();
    if ($owns) genesisBeginWriteTransaction($db);
    try {
        $result = genesisUpdateAccountPreferencesInTransaction($userId, $payload);
        if ($owns) $db->commit();
        return $result;
    } catch (Throwable $error) {
        if ($owns && $db->inTransaction()) $db->rollBack();
        throw $error;
    }
}

/** Read and merge layout patches under the same write lock across devices. */
function genesisUpdateAccountPreferencesInTransaction(string $userId, array $payload): array
{
    $user = genesisFindUser($userId);
    if ($user === null) {
        throw new RuntimeException('Пользователь не найден.');
    }
    $updates = [];
    $values = ['updated_at' => genesisNow(), 'id' => $userId];
    $hasThemePreference = array_key_exists('theme', $payload);
    if (array_key_exists('advicePreferences', $payload)) {
        if (!is_array($payload['advicePreferences'])) throw new InvalidArgumentException('INVALID_ADVICE_PREFERENCES');
        $saved = genesisUserAdvicePreferences($user);
        $advicePatch=$payload['advicePreferences'];
        if(array_key_exists('psychopompia',$advicePatch)){
            if(!is_array($advicePatch['psychopompia']))throw new InvalidArgumentException('INVALID_PSYCHOPOMPIA_PREFERENCES');
            $psychPatch=$advicePatch['psychopompia'];
            if(array_key_exists('alcohol',$psychPatch)){
                if(!is_array($psychPatch['alcohol']))throw new InvalidArgumentException('INVALID_ADVICE_ALCOHOL_DECLARATION');
                $psychPatch['alcohol']=[...$saved['psychopompia']['alcohol'],...$psychPatch['alcohol']];
            }
            $advicePatch['psychopompia']=[...$saved['psychopompia'],...$psychPatch];
        }
        if(array_key_exists('notifications',$advicePatch)){
            if(!is_array($advicePatch['notifications']))throw new InvalidArgumentException('INVALID_ADVICE_NOTIFICATIONS');
            $advicePatch['notifications']=[...$saved['notifications'],...$advicePatch['notifications']];
        }
        $preferences = genesisAdvicePreferences([...$saved, ...$advicePatch]);
        $access = genesisFeatureAccessForUser($user);
        if ($access['enforcementEnabled'] && !in_array('advice-settings',$access['allowedFeatures'],true)) {
            foreach (['smart','categories','aphrodisiaAdult'] as $field)
                if ($preferences[$field] !== $saved[$field]) throw new GenesisResourceLimitException(403,'FEATURE_SUBSCRIPTION_REQUIRED');
        }
        $updates[] = 'advice_preferences_json = :advice_preferences_json';
        $values['advice_collections_json'] = json_encode($preferences['collections'], JSON_THROW_ON_ERROR);
        $updates[] = 'advice_collections_json = :advice_collections_json';
        $values['advice_notifications_json'] = json_encode($preferences['notifications'], JSON_THROW_ON_ERROR);
        $updates[] = 'advice_notifications_json = :advice_notifications_json';
        $values['advice_psychopompia_json'] = json_encode($preferences['psychopompia'], JSON_THROW_ON_ERROR);
        $updates[] = 'advice_psychopompia_json = :advice_psychopompia_json';
        $values['advice_philosophers_per_day'] = $preferences['philosophersPerDay'];
        $updates[] = 'advice_philosophers_per_day = :advice_philosophers_per_day';
        unset($preferences['collections'], $preferences['notifications'], $preferences['psychopompia'], $preferences['philosophersPerDay']);
        $values['advice_preferences_json'] = json_encode($preferences, JSON_THROW_ON_ERROR);
    }
    if (array_key_exists('sharedProjectsEnabled', $payload)) {
        if (($payload['sharedProjectsEnabled'] ?? false) === true) genesisRequireFeature($userId,'shared-projects');
        if (!is_bool($payload['sharedProjectsEnabled'])) {
            throw new InvalidArgumentException('INVALID_SHARED_PROJECT_PREFERENCE');
        }
        if ($payload['sharedProjectsEnabled'] && !genesisSharedEligible($user)) {
            throw new DomainException('SHARED_PROJECTS_UNAVAILABLE');
        }
        $updates[] = 'shared_projects_enabled = :shared_projects_enabled';
        $values['shared_projects_enabled'] = $payload['sharedProjectsEnabled'] ? 1 : 0;
    }
    $visibilityInput = $payload['uiVisibility'] ?? ($user['ui_visibility_json'] ?? '{}');
    $savedVisibility = genesisUiVisibility($user['ui_visibility_json'] ?? '{}');
    $layoutFields = ['sidebarWidth', 'personalInboxPosition', 'personalInboxHidden', 'personalInboxCompact', 'sharedInboxPosition', 'sharedInboxHidden', 'sharedInboxCompact', 'sharedCategoriesExpanded', 'personalCategoriesExpanded', 'personalCategoriesView', 'sharedCategoriesView', 'sharedTasksCompact', 'personalInboxWidth', 'sharedInboxWidth', 'notificationDockPinned', 'notificationDockX', 'notificationDockY', 'sharedProjectViewOrder', 'sharedCalendarScale', 'todayBlockOrder', 'todayHalfBlocks', 'displayCalendarOrder'];
    // Older web/native clients must not reset account layout preferences.
    if (is_array($visibilityInput)) {
        foreach (['sacredFeaturesEnabled', 'dreamJournalEnabled', 'sidebarAutoCollapseSeconds', ...$layoutFields] as $field) {
            if (!array_key_exists($field, $visibilityInput)) $visibilityInput[$field] = $savedVisibility[$field];
        }
    }
    if (array_key_exists('uiLayout', $payload)) {
        if (!is_array($payload['uiLayout']) || array_diff(array_keys($payload['uiLayout']), $layoutFields)) {
            throw new InvalidArgumentException('INVALID_ACCOUNT_LAYOUT');
        }
        $visibilityInput = [...genesisUiVisibility($visibilityInput), ...$payload['uiLayout']];
    }
    $visibility = genesisUiVisibility($visibilityInput);
    if (array_key_exists('uiVisibility', $payload) || array_key_exists('uiLayout', $payload)) {
        if (in_array('projects.personal', $visibility['hiddenSubmenus'], true)
            && !(genesisSharedEligible($user) && !empty($user['shared_projects_enabled']))) {
            throw new InvalidArgumentException('PERSONAL_PROJECTS_REQUIRED');
        }
        $updates[] = 'ui_visibility_json = :ui_visibility_json';
        $values['ui_visibility_json'] = json_encode($visibility, JSON_THROW_ON_ERROR);
        $enabled = $visibility['enabledCalendars'];
        foreach (['calendar_mode' => 'calendarMode', 'task_calendar_mode' => 'taskCalendarMode'] as $column => $field) {
            $selected = (string)($payload[$field] ?? $user[$column] ?? 'profane');
            if (!in_array($selected, $enabled, true)) {
                $updates[] = "$column = :$column";
                $values[$column] = $enabled[0];
            }
        }
    }
    if (array_key_exists('stoicheionDivinationDisabled', $payload)) {
        if (!is_bool($payload['stoicheionDivinationDisabled'])) {
            throw new InvalidArgumentException('Настройка гаданий указана неверно.');
        }
        $updates[] = 'stoicheion_divination_disabled = :divination_disabled';
        $values['divination_disabled'] = $payload['stoicheionDivinationDisabled'] ? 1 : 0;
    }
    if (array_key_exists('calendarMode', $payload)) {
        $calendarMode = trim((string)$payload['calendarMode']);
        if (!in_array($calendarMode, $visibility['enabledCalendars'], true)) {
            throw new InvalidArgumentException('Неизвестный режим календаря.');
        }
        $updates[] = 'calendar_mode = :calendar_mode';
        $values['calendar_mode'] = $calendarMode;
    }
    if (array_key_exists('calendarExplorationPending', $payload)) {
        if ($payload['calendarExplorationPending'] !== false) {
            throw new InvalidArgumentException('INVALID_CALENDAR_EXPLORATION');
        }
        $updates[] = 'calendar_exploration_pending = 0';
    }
    if (array_key_exists('taskCalendarMode', $payload)) {
        $taskCalendarMode = trim((string)$payload['taskCalendarMode']);
        if (!in_array($taskCalendarMode, $visibility['enabledCalendars'], true)) {
            throw new InvalidArgumentException('Неизвестный календарь постановки задач.');
        }
        $updates[] = 'task_calendar_mode = :task_calendar_mode';
        $values['task_calendar_mode'] = $taskCalendarMode;
    }
    if (array_key_exists('timeFormat', $payload)) {
        $timeFormat = trim((string)$payload['timeFormat']);
        if (!in_array($timeFormat, ['24h', '12h'], true)) {
            throw new InvalidArgumentException('Неизвестный формат времени.');
        }
        $updates[] = 'time_format = :time_format';
        $values['time_format'] = $timeFormat;
    }
    if (array_key_exists('weekStart', $payload)) {
        $weekStart = trim((string)$payload['weekStart']);
        if (!in_array($weekStart, ['sunday', 'monday'], true)) {
            throw new InvalidArgumentException('Неизвестное начало недели.');
        }
        $updates[] = 'week_start = :week_start';
        $values['week_start'] = $weekStart;
    }
    if (array_key_exists('gregorianYearStart', $payload)) {
        $yearStart = trim((string)$payload['gregorianYearStart']);
        if (!in_array($yearStart, ['january', 'march'], true)) {
            throw new InvalidArgumentException('Неизвестное начало григорианского года.');
        }
        $updates[] = 'gregorian_year_start = :gregorian_year_start';
        $values['gregorian_year_start'] = $yearStart;
    }
    if (array_key_exists('darkPalette', $payload)) {
        $palette = $payload['darkPalette'];
        if (!is_string($palette) || !in_array($palette, ['green','burgundy','blue','violet'], true))
            throw new InvalidArgumentException('INVALID_DARK_PALETTE');
        if ($palette !== 'green') genesisRequireFeature($userId, 'dark-palettes');
        $updates[] = 'dark_palette = :dark_palette';
        $values['dark_palette'] = $palette;
    }
    if ($hasThemePreference) {
        $theme = trim((string)$payload['theme']);
        if (!in_array($theme, ['standart', 'standart-dark', 'experimental', 'experimental-dark'], true)) {
            throw new InvalidArgumentException('Неизвестная тема интерфейса.');
        }
        $expectedThemeRevision = filter_var($payload['expectedThemeRevision'] ?? null, FILTER_VALIDATE_INT);
        if ($expectedThemeRevision === false || (int)$expectedThemeRevision < 0) {
            throw new InvalidArgumentException('Не указана версия настройки темы.');
        }
        $currentThemeRevision = max(0, (int)($user['theme_revision'] ?? 0));
        if ((int)$expectedThemeRevision !== $currentThemeRevision) {
            throw new DomainException('Настройка темы уже изменилась на другом устройстве. Обновите данные и повторите попытку.');
        }
        $updates[] = 'theme = :theme';
        $updates[] = 'theme_revision = :theme_revision';
        $values['theme'] = $theme;
        $values['theme_revision'] = $currentThemeRevision + 1;
        $values['expected_theme_revision'] = $currentThemeRevision;
    }
    if (array_key_exists('language', $payload)) {
        $language = trim((string)$payload['language']);
        if (!in_array($language, ['ru', 'en', 'el', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'sr', 'uk', 'zh', 'tr', 'ja'], true)) {
            throw new InvalidArgumentException('Неизвестный язык интерфейса.');
        }
        $updates[] = 'language = :language';
        $values['language'] = $language;
    }
    $hasSyncPreference = array_key_exists('syncRouting', $payload);
    if ($hasSyncPreference) {
        if (!genesisMultiAccountEnabled($user) || !is_array($payload['syncRouting'])) {
            throw new DomainException('Маршрутизация по аккаунтам недоступна.');
        }
        $routing = $payload['syncRouting'];
        $mode = trim((string)($routing['mode'] ?? ''));
        if (!in_array($mode, ['fixed', 'choose', 'category'], true)) {
            throw new InvalidArgumentException('Неизвестный режим синхронизации.');
        }
        $availableAccounts = genesisUserProvider($user) === 'google'
            ? genesisGoogleAccountsForUser($user) : genesisLocalAccountMembers($user);
        $validAccountIds = array_map(static fn(array $account): string => (string)$account['id'], $availableAccounts);
        $targets = array_values(array_filter(
            genesisDecodeStringListJson($routing['defaultAccountIds'] ?? []),
            static fn(string $id): bool => in_array($id, $validAccountIds, true),
        ));
        if ($targets === []) {
            $targets = [(string)$user['id']];
        }
        $categoryMap = genesisCategorySyncMap($routing['categoryAccountIds'] ?? []);
        foreach ($categoryMap as $categoryId => $accountIds) {
            $categoryMap[$categoryId] = array_values(array_filter(
                $accountIds,
                static fn(string $id): bool => in_array($id, $validAccountIds, true),
            ));
        }
        $updates[] = 'sync_routing_mode = :sync_routing_mode';
        $updates[] = 'sync_target_account_ids = :sync_target_account_ids';
        $updates[] = 'category_sync_map = :category_sync_map';
        $values['sync_routing_mode'] = $mode;
        $values['sync_target_account_ids'] = json_encode($targets, JSON_THROW_ON_ERROR);
        $values['category_sync_map'] = json_encode($categoryMap, JSON_THROW_ON_ERROR);
    }
    if ($updates === []) {
        throw new InvalidArgumentException('Нет настроек для сохранения.');
    }
    $updates[] = 'updated_at = :updated_at';
    $where = 'id = :id';
    if ($hasThemePreference) {
        $where .= ' AND theme_revision = :expected_theme_revision';
    }
    $statement = genesisDb()->prepare('UPDATE users SET ' . implode(', ', $updates) . ' WHERE ' . $where);
    $statement->execute($values);
    if ($hasThemePreference && $statement->rowCount() !== 1) {
        throw new DomainException('Настройка темы уже изменилась на другом устройстве. Обновите данные и повторите попытку.');
    }
    $updated = genesisFindUser($userId);
    if ($updated === null) throw new RuntimeException('Настройки аккаунта не удалось сохранить.');
    return $updated;
}

function genesisAccountDataLocations(): array
{
    return [
        'categories' => 'user_id',
        'projects' => 'user_id',
        'tasks' => 'user_id',
        'task_links' => 'user_id',
        'workspace_blobs' => 'user_id',
        'user_metrics' => 'user_id',
        'feature_usage' => 'user_id',
        'android_download_activity' => 'user_id',
        'android_client_reports' => 'user_id',
        'stoicheion_draws' => 'user_id',
        'stoicheion_timeline_draws' => 'user_id',
        'stoicheion_timeline_card_windows' => 'user_id',
        'stoicheion_timeline_sessions' => 'user_id',
        'aurora_workspaces' => 'user_id',
        'email_registration_lifecycle' => 'user_id',
        'email_verification_dismissals' => 'user_id',
        'support_notices' => 'user_id',
        'dream_journal_preferences' => 'user_id',
        'linked_google_accounts' => 'owner_user_id',
        'yandex_calendar_connections' => 'user_id',
        'yandex_calendar_tasks' => 'user_id',
        'users' => 'id',
    ];
}

function genesisAccountDataCounts(string $userId): array
{
    $counts = [];
    foreach (genesisAccountDataLocations() as $table => $column) {
        $statement = genesisDb()->prepare("SELECT COUNT(*) FROM {$table} WHERE {$column} = :user_id");
        $statement->execute(['user_id' => $userId]);
        $counts[$table] = (int)$statement->fetchColumn();
    }
    return $counts;
}

function genesisRevokeAccountTokens(array $user): void
{
    foreach (genesisLinkedGoogleAccounts((string)$user['id']) as $account) {
        try {
            genesisRevokeGoogleToken($account);
        } catch (Throwable $error) {
            genesisLogError('Linked Google token revocation failed during account deletion.', $error);
        }
    }
    try {
        genesisRevokeGoogleToken($user);
    } catch (Throwable $error) {
        genesisLogError('Google token revocation failed during account deletion.', $error);
    }
}

function genesisDeleteAccountRows(string $userId): array
{
    $db=genesisDb();$owns=!$db->inTransaction();
    if($owns)genesisBeginWriteTransaction($db);
    try {
        genesisBillingAssertAccountDeletable(genesisDb(),$userId);
        $purged = genesisAccountDataCounts($userId);
        if (function_exists('genesisGoogleForgetSnapshot')) {
            foreach (genesisLinkedGoogleAccounts($userId) as $account) genesisGoogleForgetSnapshot([...$account, '_linked_account' => true]);
            genesisGoogleForgetSnapshot(['id' => $userId]);
        }
        $trialOwner=genesisFindUser($userId);
        if($trialOwner!==null)genesisTrialPreserveIdentityClaims(genesisDb(),$trialOwner);
        if (function_exists('genesisSharedPrepareAccountDeletion')) genesisSharedPrepareAccountDeletion($userId);
        $statement = genesisDb()->prepare('DELETE FROM users WHERE id = :id');
        $statement->execute(['id' => $userId]);
        if ($statement->rowCount() !== 1) {
            throw new RuntimeException('Аккаунт не удалось удалить.');
        }
        $remaining = genesisAccountDataCounts($userId);
        if (array_sum($remaining) !== 0) {
            throw new RuntimeException('Не все данные аккаунта были удалены. Операция отменена.');
        }
        if($owns)$db->commit();
        return $purged;
    } catch(Throwable $error) {if($owns&&$db->inTransaction())$db->rollBack();throw $error;}
}

function genesisDeleteAccount(string $userId): array
{
    $user = genesisFindUser($userId);
    if ($user === null) {
        throw new DomainException('Аккаунт не найден или уже удалён.');
    }
    $db = genesisDb();
    genesisBillingAssertAccountDeletable($db,$userId);
    $linkedLocalMembers=genesisUserProvider($user)!=='google'&&function_exists('genesisLocalAccountMembers')?genesisLocalAccountMembers($user):[];
    foreach($linkedLocalMembers as$member)if(!$member['isPrimary'])genesisBillingAssertAccountDeletable($db,$member['id']);
    genesisRevokeAccountTokens($user);
    $ownsTransaction = !$db->inTransaction();
    if ($ownsTransaction) {
        $db->beginTransaction();
    }
    try {
        if (genesisUserProvider($user) !== 'google' && function_exists('genesisLocalAccountMembers')) {
            foreach (genesisLocalAccountMembers($user) as $member) {
                if (!$member['isPrimary']) genesisDeleteAccountRows($member['id']);
            }
        }
        $purged = genesisDeleteAccountRows($userId);
        if ($ownsTransaction) {
            $db->commit();
        }
        return $purged;
    } catch (Throwable $error) {
        if ($ownsTransaction && $db->inTransaction()) {
            $db->rollBack();
        }
        throw $error;
    }
}

function genesisAdminDeleteUser(string $adminUserId, string $targetUserId, bool $blacklist): array
{
    $admin = genesisFindUser($adminUserId);
    $target = genesisFindUser($targetUserId);
    if ($admin === null || !genesisIsAdminUser($admin)) {
        throw new DomainException('Недостаточно прав для удаления пользователя.');
    }
    if (!genesisSessionIsPrimaryGoogleUser($admin)) throw new GenesisResourceLimitException(403,'FORBIDDEN');
    if ($target === null) {
        throw new DomainException('Пользователь не найден или уже удалён.');
    }
    if ($adminUserId === $targetUserId || genesisIsAdminUser($target)) {
        throw new DomainException('Администратор не может удалить собственный аккаунт через панель модерации.');
    }

    $linkedIdentities = genesisLinkedGoogleAccounts($targetUserId);
    $linkedLocalMembers = genesisUserProvider($target) !== 'google'
        && function_exists('genesisLocalAccountMembers') ? genesisLocalAccountMembers($target) : [];
    $db = genesisDb();
    genesisBillingAssertAccountDeletable($db,$targetUserId);
    foreach($linkedLocalMembers as$member)if(!$member['isPrimary'])genesisBillingAssertAccountDeletable($db,$member['id']);
    genesisRevokeAccountTokens($target);
    $ownsTransaction = !$db->inTransaction();
    if ($ownsTransaction) {
        $db->beginTransaction();
    }
    try {
        if ($blacklist) {
            genesisBlockUserIdentity($target);
            foreach ($linkedIdentities as $linkedIdentity) {
                genesisBlockUserIdentity($linkedIdentity);
            }
            foreach ($linkedLocalMembers as $member) {
                if ($member['isPrimary']) continue;
                $linkedUser = genesisFindUser($member['id']);
                if ($linkedUser !== null) genesisBlockUserIdentity($linkedUser);
            }
        }
        genesisSubscriptionRevoke($db, $target, genesisNow());
        if (genesisUserProvider($target) !== 'google' && function_exists('genesisLocalAccountMembers')) {
            foreach (genesisLocalAccountMembers($target) as $member) {
                if (!$member['isPrimary']) genesisDeleteAccountRows($member['id']);
            }
        }
        $purged = genesisDeleteAccountRows($targetUserId);
        if ($ownsTransaction) {
            $db->commit();
        }
        return ['deleted' => true, 'blacklisted' => $blacklist, 'purged' => $purged];
    } catch (Throwable $error) {
        if ($ownsTransaction && $db->inTransaction()) {
            $db->rollBack();
        }
        throw $error;
    }
}

function genesisRemoveLinkedGoogleAccount(string $ownerUserId, string $accountId): void
{
    if(genesisGoogleIdentityManagementEnabled()){
        $actor=genesisGoogleRequireFresh($ownerUserId,$accountId);
        genesisGoogleDisableLogin($ownerUserId,$accountId,$actor['id']);return;
    }
    $owner=genesisFindUser($ownerUserId);
    if($owner===null || !genesisMultiAccountEnabled($owner)) throw new DomainException('Дополнительные аккаунты недоступны.');
    $account=genesisGoogleAccountForUser($ownerUserId,$accountId);
    if($account===null || empty($account['_linked_account'])) throw new InvalidArgumentException('Дополнительный аккаунт не найден.');
    try {genesisRevokeGoogleToken($account);} catch(Throwable $error) {genesisLogError('Linked Google token revocation failed.',$error);}
    $db=genesisDb();$owns=!$db->inTransaction();if($owns)genesisBeginWriteTransaction($db);
    try {
        $owner=genesisFindUser($ownerUserId);$account=genesisGoogleAccountForUser($ownerUserId,$accountId);
        if($owner===null || $account===null || empty($account['_linked_account']))
            throw new InvalidArgumentException('Дополнительный аккаунт не найден.');
        genesisTrialPreserveIdentityClaims($db,$owner,$account);
        $db->prepare('DELETE FROM linked_google_accounts WHERE id=? AND owner_user_id=?')->execute([$accountId,$ownerUserId]);
        if($owns)$db->commit();
    } catch(Throwable $error) {if($owns&&$db->inTransaction())$db->rollBack();throw $error;}
    if(function_exists('genesisGoogleForgetSnapshot'))genesisGoogleForgetSnapshot($account);
}

function genesisDisconnectGoogleServices(string $userId): array
{
    $user = genesisFindUser($userId);
    if ($user === null) {
        throw new RuntimeException('Пользователь не найден.');
    }
    genesisRevokeGoogleToken($user);
    if (function_exists('genesisGoogleForgetSnapshot')) genesisGoogleForgetSnapshot($user);
    genesisDb()->prepare("UPDATE users SET access_token_enc = NULL, refresh_token_enc = NULL, token_expires_at = NULL, granted_scopes = '', updated_at = :updated_at WHERE id = :id")->execute([
        'updated_at' => genesisNow(),
        'id' => $userId,
    ]);
    $updated = genesisFindUser($userId);
    if ($updated === null) {
        throw new RuntimeException('Не удалось отключить Google Calendar и Tasks.');
    }
    return $updated;
}

function genesisSacredFromDate(string $date): array
{
    $value = new DateTimeImmutable($date . ' 12:00:00');
    $year = (int)$value->format('Y');
    $start = new DateTimeImmutable($year . '-03-20 12:00:00');
    if ($value < $start) {
        $year--;
        $start = new DateTimeImmutable($year . '-03-20 12:00:00');
    }
    $dayOfYear = (int)$start->diff($value)->format('%a');
    return $dayOfYear < 360
        ? ['sacredYear' => $year, 'monthIndex' => intdiv($dayOfYear, 30), 'day' => ($dayOfYear % 30) + 1]
        : ['sacredYear' => $year, 'monthIndex' => 12, 'day' => $dayOfYear - 359];
}
