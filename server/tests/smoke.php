<?php
declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';
require dirname(__DIR__) . '/src/repository.php';
require dirname(__DIR__) . '/src/ads.php';
require dirname(__DIR__) . '/src/google.php';
require dirname(__DIR__) . '/src/yandex.php';
require dirname(__DIR__) . '/src/yandex-calendar.php';
require dirname(__DIR__) . '/src/local-accounts.php';
require dirname(__DIR__) . '/src/gemini.php';

function expect(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$db = genesisDb();
$db->beginTransaction();
try {
    $userId = 'test-private-workspace';
    $now = genesisNow();
    $db->prepare('INSERT OR REPLACE INTO users (id, google_sub, email, display_name, workspace_key_enc, created_at, updated_at) VALUES (:id, :sub, :email, :name, :workspace_key, :created_at, :updated_at)')->execute([
        'id' => $userId,
        'sub' => 'test-private-workspace-sub',
        'email' => 'genesis.smoke.test@gmail.com',
        'name' => 'Smoke Test',
        'workspace_key' => genesisEncrypt(base64_encode(random_bytes(32))),
        'created_at' => $now,
        'updated_at' => $now,
    ]);

    // Full service-connection/legacy-writer coverage models an existing lifetime member.
    // New Free profiles and their resource limits are exercised independently in access-314.
    $db->prepare("UPDATE users SET subscription_plan='premium4life' WHERE id=?")->execute([$userId]);
    $user = genesisFindUser($userId);
    expect(is_array($user), 'Test user was not created.');
    $yandexProfile = [
        'id' => 'genesis-yandex-smoke',
        'email' => 'yandex.smoke@example.org',
        'name' => 'Yandex Smoke',
        'picture' => null,
    ];
    $yandexUser = genesisUpsertYandexUser($yandexProfile);
    expect(genesisFindUserByYandexUid($yandexProfile['id'])['id'] === $yandexUser['id'], 'Yandex identity lookup failed.');
    expect(genesisUserProvider($yandexUser) === 'yandex', 'Yandex identity was not isolated.');
    expect((genesisUserForClient($yandexUser)['authProvider'] ?? '') === 'yandex', 'Yandex provider was not exposed.');
    expect(genesisGoogleAccountsForUser($yandexUser) === [], 'Yandex identity was offered Google accounts.');
    expect(!genesisIsAdminUser($yandexUser), 'Yandex identity received Google administrator privileges.');
    expect(genesisUpsertYandexUser($yandexProfile)['id'] === $yandexUser['id'], 'Yandex repeat login duplicated the account.');
    try {
        genesisUpsertYandexUser(['id' => 'another-yandex-identity', 'email' => 'genesis.smoke.test@gmail.com']);
        throw new RuntimeException('Yandex account was merged with a Google account by email.');
    } catch (DomainException $expected) {
        expect(str_contains($expected->getMessage(), 'другим аккаунтом'), 'Provider conflict had an unexpected result.');
    }
    $db->prepare('DELETE FROM users WHERE id = :id')->execute(['id' => (string)$yandexUser['id']]);
    $linkOwner = genesisUpsertYandexUser([
        'id' => 'genesis-link-yandex-smoke', 'email' => 'link-yandex.smoke@example.org',
        'name' => 'Link Owner', 'picture' => null,
    ]);
    $linkOwnerId = (string)$linkOwner['id'];
    $newYandexProfile = [
        'id' => 'genesis-link-new-yandex-smoke', 'email' => 'link-new-yandex.smoke@example.org',
        'name' => 'New Yandex Identity', 'picture' => null,
    ];
    expect(genesisBeginLocalLink($linkOwnerId, 'yandex', $newYandexProfile) === 'linked',
        'Fresh Yandex identity was not linked after verified sign-in.');
    expect(genesisUpsertYandexUser($newYandexProfile)['id'] === $linkOwnerId,
        'Linked Yandex sign-in did not open the Yandex workspace.');
    expect(count(genesisLocalAccountMembers($linkOwner)) === 2, 'Linked local account was not exposed.');
    try {
        genesisBeginLocalLink($userId, 'yandex', $newYandexProfile);
        throw new RuntimeException('Google account was linked to Yandex.');
    } catch (DomainException $expected) {
        expect(str_contains($expected->getMessage(), 'cannot be linked'), 'Google isolation error was unexpected.');
    }
    $existingYandexProfile = [
        'id' => 'genesis-link-second-yandex-smoke', 'email' => 'second-yandex.smoke@example.org',
        'name' => 'Second Yandex', 'picture' => null,
    ];
    $separate = genesisUpsertYandexUser($existingYandexProfile);
    expect(genesisBeginLocalLink($linkOwnerId, 'yandex', $existingYandexProfile) === 'pending',
        'Existing workspace did not require an explicit merge decision.');
    expect(genesisPendingLocalLink($linkOwnerId)['memberId'] === $separate['id'],
        'Pending merge selected the wrong account.');
    genesisCommitLocalLink($linkOwnerId, ['sourceVersion' => 0]);
    expect(genesisUpsertYandexUser($existingYandexProfile)['id'] === $linkOwnerId,
        'Merged Yandex sign-in did not open the shared workspace.');
    expect(count(genesisLocalAccountMembers($linkOwner)) === 3, 'Three linked identities were not exposed.');
    genesisDeleteAccount($linkOwnerId);
    expect(genesisFindUser((string)$separate['id']) === null,
        'Deleting the local account group left a merged member behind.');
    $user = genesisUpdateAccountPreferences($userId, ['calendarMode' => 'sacred', 'taskCalendarMode' => 'lunar', 'timeFormat' => '12h', 'weekStart' => 'monday', 'gregorianYearStart' => 'march', 'language' => 'en']);
    expect(($user['calendar_mode'] ?? '') === 'sacred', 'Calendar preference was not stored.');
    expect((genesisUserForClient($user)['calendarMode'] ?? '') === 'sacred', 'Calendar preference was not exposed to the client.');
    expect(($user['task_calendar_mode'] ?? '') === 'lunar', 'Task calendar preference was not stored.');
    expect((genesisUserForClient($user)['taskCalendarMode'] ?? '') === 'lunar', 'Task calendar preference was not exposed to the client.');
    expect(($user['time_format'] ?? '') === '12h', 'Time format preference was not stored.');
    expect(($user['week_start'] ?? '') === 'monday', 'Week start preference was not stored.');
    expect((genesisUserForClient($user)['weekStart'] ?? '') === 'monday', 'Week start preference was not exposed to the client.');
    expect(($user['gregorian_year_start'] ?? '') === 'march', 'Gregorian year start preference was not stored.');
    expect((genesisUserForClient($user)['gregorianYearStart'] ?? '') === 'march', 'Gregorian year start preference was not exposed to the client.');
    expect((genesisUserForClient($user)['timeFormat'] ?? '') === '12h', 'Time format preference was not exposed to the client.');
    expect(($user['language'] ?? '') === 'en', 'Language preference was not stored.');
    expect((genesisUserForClient($user)['language'] ?? '') === 'en', 'Language preference was not exposed to the client.');
    $defaults = genesisUserForClient($user)['uiVisibility'];
    expect($defaults['sacredFeaturesEnabled'] === true, 'Sacred features must remain enabled by default.');
    expect($defaults['personalInboxWidth'] === 300 && $defaults['sharedInboxWidth'] === 300,
        'Inbox widths must default to 300.');
    expect($defaults['sharedCategoriesExpanded'] === false, 'Shared categories must default to collapsed.');
    expect($defaults['sharedTasksCompact'] === true, 'Shared project tasks must keep their existing compact default.');
    expect(array_key_exists('todayBlockOrder', $defaults) && $defaults['todayBlockOrder'] === null,
        'Today blocks must keep their default order until an explicit customization.');
    $visibility = [
        'sacredFeaturesEnabled' => false,
        'dreamJournalEnabled' => false,
        'hiddenMenuItems' => ['tasks', 'stoicheion'], 'hiddenSubmenus' => ['calendar.year'],
        'hiddenTodayBlocks' => ['rhythm', 'tasks'], 'enabledCalendars' => ['profane'],
        'sidebarAutoCollapseSeconds' => 30,
        'sidebarWidth' => 156, 'personalInboxPosition' => 'left', 'personalInboxHidden' => true, 'personalInboxCompact' => true,
        'personalInboxWidth' => 480,
        'sharedInboxPosition' => 'bottom', 'sharedInboxHidden' => false, 'sharedInboxCompact' => false,
        'sharedInboxWidth' => 420, 'sharedCategoriesExpanded' => true,
        'personalCategoriesExpanded' => true, 'personalCategoriesView' => 'list', 'sharedCategoriesView' => 'cards',
        'sharedTasksCompact' => false,
        'notificationDockPinned' => true, 'notificationDockX' => 1250, 'notificationDockY' => 2500,
        'sharedProjectViewOrder' => ['board','calendar','list','gantt'],
        'sharedCalendarScale' => 0.25,
        'todayBlockOrder' => ['details','events','habits','tasks','rhythm','ads','dream','advice'],
        'todayHalfBlocks' => ['dream','tasks'],
        'webHiddenTodayBlocks' => ['dream','events'],
        'displayCalendarOrder' => ['lunar','sacred','profane'],
    ];
    $user = genesisUpdateAccountPreferences($userId, ['uiVisibility' => $visibility]);
    expect(genesisUserForClient($user)['uiVisibility'] === $visibility, 'Navigation visibility did not round-trip.');
    $legacyVisibility = $visibility;
    foreach (['sacredFeaturesEnabled', 'dreamJournalEnabled', 'sidebarAutoCollapseSeconds', 'sidebarWidth', 'personalInboxPosition', 'personalInboxHidden',
        'personalInboxCompact', 'sharedInboxPosition', 'sharedInboxHidden', 'sharedInboxCompact',
        'personalInboxWidth', 'sharedInboxWidth', 'sharedCategoriesExpanded', 'personalCategoriesExpanded', 'personalCategoriesView', 'sharedCategoriesView', 'sharedTasksCompact',
        'notificationDockPinned', 'notificationDockX', 'notificationDockY', 'sharedProjectViewOrder', 'sharedCalendarScale', 'todayBlockOrder', 'todayHalfBlocks', 'webHiddenTodayBlocks', 'displayCalendarOrder'] as $field) unset($legacyVisibility[$field]);
    $user = genesisUpdateAccountPreferences($userId, ['uiVisibility' => $legacyVisibility]);
    expect(genesisUserForClient($user)['uiVisibility']['sidebarAutoCollapseSeconds'] === 30,
        'An older client reset the sidebar delay.');
    expect(genesisUserForClient($user)['uiVisibility'] === $visibility, 'An older client reset the saved layout.');
    $user = genesisUpdateAccountPreferences($userId, ['uiLayout' => ['sidebarWidth' => 56]]);
    expect(genesisUserForClient($user)['uiVisibility'] === [...$visibility, 'sidebarWidth' => 56], 'Layout patch overwrote unrelated preferences.');
    $user = genesisUpdateAccountPreferences($userId, ['uiLayout' => ['sharedInboxHidden' => true]]);
    expect(genesisUserForClient($user)['uiVisibility']['sidebarWidth'] === 56, 'Independent patches lost the saved width.');
    $user = genesisUpdateAccountPreferences($userId, ['uiLayout' => ['personalInboxWidth' => 512, 'sharedCategoriesExpanded' => false]]);
    $savedLayout = genesisUserForClient($user)['uiVisibility'];
    expect($savedLayout['personalInboxWidth'] === 512 && $savedLayout['sharedInboxWidth'] === 420
        && $savedLayout['sharedCategoriesExpanded'] === false, 'Inbox and category patches were not independent.');
    expect($user['calendar_mode'] === 'profane' && $user['task_calendar_mode'] === 'profane',
        'Disabled calendars remained selected.');
    foreach ([['enabledCalendars' => []], ['hiddenSubmenus' => ['calendar.month', 'calendar.year']],
        ['hiddenSubmenus' => ['sacred.stoicheion', 'sacred.theokyklos']],
        ['sidebarAutoCollapseSeconds' => -1], ['sidebarAutoCollapseSeconds' => '30'],
        ['sidebarWidth' => 55], ['sidebarWidth' => 241], ['sidebarWidth' => '56'],
        ['personalInboxWidth' => 299], ['sharedInboxWidth' => 5001], ['personalInboxWidth' => '400'],
        ['sharedCategoriesExpanded' => 1],
        ['personalCategoriesExpanded'=>1], ['sharedCategoriesView'=>'table'], ['personalCategoriesView'=>true],
        ['sharedTasksCompact'=>1],
        ['notificationDockPinned'=>1], ['notificationDockX'=>10001], ['notificationDockY'=>'0'],
        ['sharedProjectViewOrder'=>['board','board','calendar','gantt']], ['sharedProjectViewOrder'=>['board','list']],
        ['sharedProjectViewOrder'=>'board,list,calendar,gantt'], ['sharedProjectViewOrder'=>['board','list','calendar',false]],
        ['sharedCalendarScale'=>null], ['sharedCalendarScale'=>'0.5'], ['sharedCalendarScale'=>0], ['sharedCalendarScale'=>0.75], ['sharedCalendarScale'=>true],
        ['sharedInboxHidden' => 1], ['personalInboxPosition' => 'floating'], ['sharedInboxCompact' => 'true']] as $invalid) {
        try {
            genesisUpdateAccountPreferences($userId, ['uiVisibility' => [...$visibility, ...$invalid]]);
            throw new RuntimeException('Invalid navigation visibility was accepted.');
        } catch (InvalidArgumentException $expected) { /* Rejected before write. */ }
    }
    $user = genesisUpdateAccountPreferences($userId, ['uiLayout' => ['sharedProjectViewOrder' => ['gantt','board','list','calendar']]]);
    expect(genesisUserForClient($user)['uiVisibility']['sharedProjectViewOrder'] === ['gantt','board','list','calendar'], 'View order patch did not round-trip.');
    expect(genesisUserForClient($user)['uiVisibility']['personalInboxWidth'] === 512, 'View order patch reset unrelated layout.');
    foreach ([1, 0.5, 0.25] as $scale) {
        $user = genesisUpdateAccountPreferences($userId, ['uiLayout' => ['sharedCalendarScale' => $scale]]);
        expect(genesisUserForClient($user)['uiVisibility']['sharedCalendarScale'] === $scale, 'Calendar scale did not round-trip.');
        expect(genesisUserForClient($user)['uiVisibility']['personalInboxWidth'] === 512, 'Calendar scale reset unrelated layout.');
    }
    $user = genesisUpdateAccountPreferences($userId, ['uiVisibility' => genesisUiVisibility([]),
        'calendarMode' => 'sacred', 'taskCalendarMode' => 'lunar']);
    expect((genesisUserForClient($user)['theme'] ?? '') === 'standart', 'Theme must default safely to Standart.');
    $user = genesisUpdateAccountPreferences($userId, ['theme' => 'experimental', 'expectedThemeRevision' => 0]);
    expect(($user['theme'] ?? '') === 'experimental', 'Theme preference was not stored.');
    expect((int)($user['theme_revision'] ?? -1) === 1, 'Theme revision was not incremented.');
    expect((genesisUserForClient($user)['theme'] ?? '') === 'experimental', 'Theme preference was not exposed to the client.');
    $user = genesisUpdateAccountPreferences($userId, ['theme' => 'experimental-dark', 'expectedThemeRevision' => 1]);
    expect((genesisUserForClient($user)['theme'] ?? '') === 'experimental-dark', 'Dark theme was not exposed to the client.');
    $user = genesisUpdateAccountPreferences($userId, ['theme' => 'standart-dark', 'expectedThemeRevision' => 2]);
    expect((genesisUserForClient($user)['theme'] ?? '') === 'standart-dark', 'Standart dark theme was not exposed to the client.');
    expect((int)$user['theme_revision'] === 3, 'Standart dark theme revision was not incremented.');
    foreach (['el', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'sr', 'uk', 'zh', 'tr', 'ja'] as $locale) {
        $user = genesisUpdateAccountPreferences($userId, ['language' => $locale]);
        expect((genesisUserForClient($user)['language'] ?? '') === $locale, "Language $locale was not saved.");
    }

    // Native identity and service authorization are deliberately separate. The
    // stable Google sub binds every grant to the already authenticated user.
    $googleProfile = [
        'sub' => 'test-private-workspace-sub',
        'email' => 'genesis.smoke.test@gmail.com',
        'email_verified' => true,
        'name' => 'Smoke Test',
        'picture' => null,
    ];
    $db->prepare('UPDATE users SET google_calendar_id = :calendar_id WHERE id = :id')->execute([
        'calendar_id' => 'existing-calendar-id', 'id' => $userId,
    ]);
    $calendarAuthorized = genesisPersistPrimaryGoogleAuthorization($userId, $googleProfile, [
        'access_token' => 'synthetic-calendar-access',
        'refresh_token' => 'synthetic-calendar-refresh',
        'expires_in' => 3600,
        'scope' => implode(' ', array_merge(GENESIS_GOOGLE_IDENTITY_SCOPES, [GENESIS_GOOGLE_CALENDAR_SCOPE])),
    ]);
    $calendarClient = genesisUserForClient($calendarAuthorized);
    expect($calendarClient['calendarConnected'] === true, 'Calendar-only authorization was not exposed.');
    expect($calendarClient['googleTasksImportReady'] === false, 'Calendar-only authorization falsely enabled Tasks.');

    $tasksAuthorized = genesisPersistPrimaryGoogleAuthorization($userId, $googleProfile, [
        'access_token' => 'synthetic-tasks-access',
        'refresh_token' => 'synthetic-tasks-refresh',
        'expires_in' => 3600,
        'scope' => implode(' ', array_merge(GENESIS_GOOGLE_IDENTITY_SCOPES, [GENESIS_GOOGLE_TASKS_SCOPE])),
    ]);
    $tasksClient = genesisUserForClient($tasksAuthorized);
    expect($tasksClient['calendarConnected'] === false, 'Tasks-only authorization falsely enabled Calendar.');
    expect($tasksClient['googleTasksImportReady'] === true, 'Tasks-only authorization was not exposed.');

    genesisClearGoogleAuthorization($tasksAuthorized);
    $revoked = genesisFindUser($userId);
    expect(is_array($revoked) && empty($revoked['refresh_token_enc']) && ($revoked['granted_scopes'] ?? '') === '',
        'Revoked Google authorization was not cleared.');
    expect(($revoked['google_calendar_id'] ?? '') === 'existing-calendar-id',
        'Revocation must preserve the existing GENESIS calendar for reconnect.');

    $bothAuthorized = genesisPersistPrimaryGoogleAuthorization($userId, $googleProfile, [
        'access_token' => 'synthetic-both-access',
        'refresh_token' => 'synthetic-both-refresh',
        'expires_in' => 3600,
        'scope' => implode(' ', GENESIS_GOOGLE_SCOPES),
    ]);
    $existingLogin = genesisUpsertGoogleUser($googleProfile, [], false);
    expect(($existingLogin['id'] ?? '') === $userId, 'Existing backend user was not resolved by Google sub.');
    expect(!empty($existingLogin['refresh_token_enc']), 'Native identity login erased an existing refresh token.');
    // A delayed failure from device A cannot revoke the newer grant from device B.
    genesisClearGoogleAuthorization($tasksAuthorized);
    genesisRemoveGoogleScope($tasksAuthorized, GENESIS_GOOGLE_TASKS_SCOPE);
    $afterStaleFailure = genesisFindUser($userId);
    expect(($afterStaleFailure['refresh_token_enc'] ?? null) === $bothAuthorized['refresh_token_enc'],
        'A stale request revoked the other device\'s refreshed authorization.');
    expect(genesisGoogleAccessToken($tasksAuthorized) === 'synthetic-both-access',
        'A request reused an old access token after another device refreshed it.');
    try {
        genesisHandleGoogleAuthorizationFailure($bothAuthorized, GENESIS_GOOGLE_TASKS_SCOPE,
            new GenesisGoogleHttpException(401, 'authError', 'Synthetic expired access token'));
        throw new LogicException('Rejected Google request unexpectedly succeeded.');
    } catch (RuntimeException $expected) {
        expect(str_contains($expected->getMessage(), 'retry'), 'Access-token rejection should remain retryable.');
    }
    expect((genesisFindUser($userId)['refresh_token_enc'] ?? null) === $bothAuthorized['refresh_token_enc'],
        'An access-token rejection must not destroy the refresh grant.');
    $staleKeySnapshot = $existingLogin;
    $staleKeySnapshot['workspace_key_enc'] = null;
    $sameKey = genesisEnsureWorkspaceKey($staleKeySnapshot);
    expect(($sameKey['workspace_key_enc'] ?? null) === $existingLogin['workspace_key_enc'],
        'Concurrent first-use initialization replaced the account encryption key.');
    $bothClient = genesisUserForClient($bothAuthorized);
    expect($bothClient['calendarConnected'] === true && $bothClient['googleTasksImportReady'] === true,
        'Reauthorization did not restore both Google services.');

    $newGoogleUser = genesisUpsertGoogleUser([
        'sub' => 'test-brand-new-native-sub',
        'email' => 'genesis.brand.new@example.com',
        'email_verified' => true,
        'name' => 'Brand New Native User',
    ], [], false);
    $newClient = genesisUserForClient($newGoogleUser);
    expect($newClient['calendarMode'] === 'profane' && $newClient['taskCalendarMode'] === 'profane'
        && $newClient['weekStart'] === 'monday',
        'A new Google account did not receive the Gregorian and Monday defaults.');
    expect($newClient['calendarConnected'] === false && $newClient['googleTasksImportReady'] === false,
        'A new identity was falsely marked as Google-service connected.');
    $ad = genesisSaveAd([
        'title' => 'Test announcement', 'description' => 'A targeted test announcement.',
        'imageUrl' => 'https://example.com/image.png', 'linkUrl' => 'https://example.com/',
        'languages' => ['ru'], 'countries' => ['RU'], 'platforms' => ['android'],
        'repeatHours' => 24, 'enabled' => false,
    ]);
    expect(genesisTodayAds('ru', 'RU', 'android') === [], 'Draft advertisement became public.');
    $future = (new DateTimeImmutable('+1 day', new DateTimeZone('UTC')))->format('Y-m-d\\TH:i:s\\Z');
    genesisSaveAd([
        'title' => 'Test announcement', 'description' => 'A targeted test announcement.',
        'imageUrl' => 'https://example.com/image.png', 'linkUrl' => 'https://example.com/',
        'languages' => ['ru'], 'countries' => ['RU'], 'platforms' => ['android'],
        'startsAt' => $future, 'repeatHours' => 24, 'enabled' => true,
    ], $ad['id']);
    expect(genesisTodayAds('ru', 'RU', 'android') === [], 'Future advertisement became public early.');
    $ad = genesisSaveAd([
        'title' => 'Test announcement', 'description' => 'A targeted test announcement.',
        'imageUrl' => 'https://example.com/image.png', 'linkUrl' => 'https://example.com/',
        'languages' => ['ru'], 'countries' => ['RU'], 'platforms' => ['android'],
        'repeatHours' => 24, 'enabled' => true,
    ], $ad['id']);
    expect(count(genesisTodayAds('ru', 'RU', 'android')) === 1, 'Eligible advertisement was not shown.');
    expect(genesisTodayAds('en', 'RU', 'android') === [] && genesisTodayAds('ru', 'US', 'android') === []
        && genesisTodayAds('ru', 'RU', 'web') === [], 'Advertisement audience filter failed.');
    genesisDeleteAd($ad['id']);
    expect(genesisTodayAds('ru', 'RU', 'android') === [], 'Deleted advertisement remained visible.');
    try {
        genesisUpdateAccountPreferences($userId, ['theme' => 'standart', 'expectedThemeRevision' => 0]);
        throw new RuntimeException('Stale theme revision was accepted.');
    } catch (DomainException $error) {
        expect(str_contains($error->getMessage(), 'другом устройстве'), 'Theme conflict did not return the expected message.');
    }
    expect(genesisMultiAccountEnabled($user), 'Multi-account must be available to every authenticated user.');
    expect((genesisUserForClient($user)['multiAccountEnabled'] ?? false) === true, 'Multi-account availability was not exposed to a regular user.');
    $user = genesisUpdateAccountPreferences($userId, [
        'syncRouting' => [
            'mode' => 'choose',
            'defaultAccountIds' => [$userId],
            'categoryAccountIds' => [],
        ],
    ]);
    expect(($user['sync_routing_mode'] ?? '') === 'choose', 'A regular user could not save multi-account routing.');
    $emptyRouting = genesisUserForClient($user)['syncRouting']['categoryAccountIds'] ?? null;
    expect($emptyRouting instanceof stdClass, 'Empty category routing must be encoded as a JSON object for native clients.');
    expect(json_encode($emptyRouting, JSON_THROW_ON_ERROR) === '{}', 'Empty category routing changed its wire shape.');
    // Five-account routing is exercised without Google sign-in or network writes.
    $db->prepare('UPDATE users SET refresh_token_enc = :token WHERE id = :id')->execute([
        'token' => genesisEncrypt('synthetic-primary-token'), 'id' => $userId,
    ]);
    $routeIds = [$userId];
    foreach (range(1, 4) as $index) {
        $accountId = 'test-route-account-' . $index;
        $routeIds[] = $accountId;
        $db->prepare('INSERT INTO linked_google_accounts (id, owner_user_id, google_sub, email, display_name, refresh_token_enc, position, created_at, updated_at) VALUES (:id, :owner, :sub, :email, :name, :token, :position, :created_at, :updated_at)')->execute([
            'id' => $accountId,
            'owner' => $userId,
            'sub' => 'test-route-sub-' . $index,
            'email' => 'genesis.route.' . $index . '@example.com',
            'name' => 'Synthetic Route ' . $index,
            'token' => genesisEncrypt('synthetic-route-token-' . $index),
            'position' => $index,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }
    $user = genesisUpdateAccountPreferences($userId, ['syncRouting' => [
        'mode' => 'category',
        'defaultAccountIds' => [$userId],
        'categoryAccountIds' => ['test-route-category' => $routeIds],
    ]]);
    expect(count(genesisUserForClient($user)['googleAccounts']) === 5, 'Five Google account slots were not exposed.');
    $targets = genesisResolveTaskTargetAccounts($user, ['categoryId' => 'test-route-category']);
    expect(array_map(static fn(array $account): string => (string)$account['id'], $targets) === $routeIds,
        'Category routing did not select all five linked accounts.');
    $fallback = genesisResolveTaskTargetAccounts($user, ['categoryId' => 'another-category']);
    expect(count($fallback) === 1 && ($fallback[0]['id'] ?? '') === $userId,
        'Unmapped categories must fall back to the primary account.');
    $explicit = genesisResolveTaskTargetAccounts($user, ['syncAccountIds' => [$routeIds[2], $routeIds[4]]]);
    expect(array_map(static fn(array $account): string => (string)$account['id'], $explicit) === [$routeIds[2], $routeIds[4]],
        'Explicit task routing must override category defaults.');
    $deletedCopies = [];
    $captureDelete = static function(array $account, string $ownerId, string $id, array $task) use (&$deletedCopies): void {
        $deletedCopies[(string)$account['id']] = $task;
    };
    genesisDeleteGoogleTaskCopies(genesisGoogleAccountsForUser($user), $userId, 'delete-test',
        ['googleEventId' => 'primary-event'], $captureDelete);
    expect(count($deletedCopies) === 5, 'Legacy deletion without links missed additional Google accounts.');
    expect(($deletedCopies[$userId]['googleEventId'] ?? '') === 'primary-event', 'Primary compatibility event was lost.');
    expect($deletedCopies[$routeIds[1]] === [], 'Primary event ID leaked into another account.');
    $deletedCopies = [];
    genesisDeleteGoogleTaskCopies(genesisGoogleAccountsForUser($user), $userId, 'delete-test',
        ['googleLinks' => [$routeIds[1] => ['eventId' => 'linked-event']]], $captureDelete);
    expect(count($deletedCopies) === 5 && ($deletedCopies[$routeIds[1]]['googleEventId'] ?? '') === 'linked-event',
        'Partial deletion links prevented discovery in other accounts.');
    $attempted = [];
    try {
        genesisDeleteGoogleTaskCopies(genesisGoogleAccountsForUser($user), $userId, 'delete-test', [],
            static function(array $account) use (&$attempted, $userId): void {
                $attempted[] = $account['id'];
                if ($account['id'] === $userId) throw new RuntimeException('synthetic network failure');
            });
        throw new RuntimeException('Failed deletion was acknowledged.');
    } catch (RuntimeException $error) {
        expect($error->getMessage() === 'synthetic network failure' && count($attempted) === 5,
            'An unavailable first account prevented deletion in the remaining accounts.');
    }
    genesisRecordTaskDeletion($userId, 'deleted-cache-task', []);
    genesisRecordTaskDeletion($userId, 'deleted-cache-task', []);
    expect(count(array_filter(genesisDeletedTaskIds($userId), static fn(string $id): bool => $id === 'deleted-cache-task')) === 1,
        'Repeated deletion created duplicate tombstones.');
    expect(!genesisTaskWasDeleted('another-user', 'deleted-cache-task', []), 'Deletion crossed account scopes.');
    try {
        genesisSyncTaskToGoogle($userId, 'deleted-cache-task', ['title' => 'Stale cached task']);
        throw new RuntimeException('A stale client recreated a deleted task.');
    } catch (DomainException $error) {
        expect($error->getMessage() === 'TASK_DELETED', 'Deleted-task rejection changed.');
    }
    $externalTask = ['createdIn' => 'google-calendar', 'googleAccountId' => $routeIds[1]];
    genesisRecordTaskDeletion($userId, 'google-event-synthetic', $externalTask);
    expect(genesisTaskWasDeleted($userId, genesisTaskDeletionId('google-event-synthetic', $externalTask), $externalTask),
        'Website and Android deletion identities differ.');
    expect(!genesisTaskWasDeleted($userId, 'google-event-synthetic', array_merge($externalTask, ['googleAccountId' => $routeIds[2]])),
        'External deletion affected another Google account.');
    $user = genesisUpdateAccountPreferences($userId, ['syncRouting' => [
        'mode' => 'choose', 'defaultAccountIds' => [$userId], 'categoryAccountIds' => [],
    ]]);
    $workspace = genesisWorkspaceForClient($user);
    expect(is_string($workspace['key']) && strlen(base64_decode($workspace['key'], true)) === 32, 'Workspace key is invalid.');
    expect(($workspace['keyMode'] ?? '') === 'account', 'Authenticated account key mode was not exposed.');

    // Exercise compatibility of an existing member's legacy envelope; new Free writers are covered by access-314.
    $db->prepare("UPDATE users SET subscription_plan='premium4life' WHERE id=?")->execute([$userId]);
    $saved = genesisSaveWorkspaceEnvelope($userId, [
        'ciphertext' => base64_encode(random_bytes(64)),
        'iv' => base64_encode(random_bytes(12)),
        'version' => 1,
        'expectedVersion' => 0,
    ]);
    expect($saved['version'] === 1, 'Encrypted envelope was not stored with a server-assigned version.');
    try {
        genesisSaveWorkspaceEnvelope($userId, [
            'ciphertext' => base64_encode(random_bytes(64)),
            'iv' => base64_encode(random_bytes(12)),
            'version' => 1,
            'expectedVersion' => 0,
        ]);
        throw new RuntimeException('A stale encrypted workspace unexpectedly overwrote the current envelope.');
    } catch (GenesisWorkspaceConflictException $conflict) {
        expect($conflict->currentVersion === 1, 'Workspace conflict did not expose the current server version.');
    }
    $saved = genesisSaveWorkspaceEnvelope($userId, [
        'ciphertext' => base64_encode(random_bytes(64)),
        'iv' => base64_encode(random_bytes(12)),
        'version' => 2,
        'expectedVersion' => 1,
    ]);
    expect($saved['version'] === 2, 'A current encrypted workspace revision could not be saved.');

    $wrappedKey = base64_encode(random_bytes(48));
    $wrappedIv = base64_encode(random_bytes(12));
    $accountKey = base64_encode(random_bytes(32));
    genesisSaveClientWorkspaceKey($userId, ['key' => $accountKey, 'wrappedKey' => $wrappedKey, 'iv' => $wrappedIv]);
    $clientWorkspace = genesisWorkspaceForClient(genesisFindUser($userId) ?: []);
    expect(($clientWorkspace['keyMode'] ?? '') === 'account', 'Authenticated account key mode was not stored.');
    expect(($clientWorkspace['key'] ?? null) === $accountKey, 'The authenticated session did not receive its workspace key.');
    $clientKeyRow = $db->prepare('SELECT workspace_key_enc FROM users WHERE id = :id');
    $clientKeyRow->execute(['id' => $userId]);
    expect(is_string($clientKeyRow->fetchColumn()), 'The workspace key was not encrypted for account-based recovery.');

    genesisSaveMetrics($userId, [
        'projectCount' => 4,
        'taskCount' => 9,
        'openTaskCount' => 5,
        'completedTaskCount' => 4,
        'googleSyncedCount' => 9,
        'habitCount' => 7,
    ]);
    $metrics = $db->prepare('SELECT * FROM user_metrics WHERE user_id = :user_id');
    $metrics->execute(['user_id' => $userId]);
    $row = $metrics->fetch();
    expect(is_array($row) && (int)$row['task_count'] === 9 && (int)$row['project_count'] === 4 && (int)$row['habit_count'] === 7, 'Aggregate metrics were not stored.');
    expect((int)$db->query('SELECT COUNT(*) FROM tasks')->fetchColumn() === 0, 'Task content must not be stored in SQLite.');

    $assistantPlan = genesisNormalizeGeminiPlan([
        'request' => 'Create a launch project and one task.',
        'summary' => 'Draft ready.',
        'projects' => [[
            'title' => 'Launch',
            'description' => 'Prepare the release.',
            'parentProject' => '',
            'category' => 'Work',
            'tags' => ['release', 'release'],
        ]],
        'taskLists' => [],
        'tasks' => [[
            'title' => 'please create a task Prepare brief',
            'description' => '',
            'startDate' => '2026-09-11',
            'dueDate' => '2026-09-12',
            'time' => '09:30',
            'project' => 'Launch',
            'taskList' => '',
            'tags' => ['brief'],
            'priority' => 99,
            'reminderMinutes' => -10,
        ]],
    ]);
    expect(count($assistantPlan['projects']) === 1 && count($assistantPlan['tasks']) === 1, 'Gemini plan normalization lost valid actions.');
    expect($assistantPlan['tasks'][0]['title'] === 'Prepare brief', 'Assistant command words leaked into the task title.');
    expect(genesisAssistantTaskTitle('создай задачу под названием Задача номер 1') === 'Задача номер 1',
        'Russian naming instruction leaked into the task title.');
    expect(genesisAssistantTaskTitle('create a task named Task number 1') === 'Task number 1',
        'English naming instruction leaked into the task title.');
    expect($assistantPlan['tasks'][0]['priority'] === 10, 'Gemini task priority was not clamped.');
    expect($assistantPlan['tasks'][0]['reminderMinutes'] === 0, 'Gemini reminder was not clamped.');
    expect($assistantPlan['projects'][0]['tags'] === ['release'], 'Gemini plan tags were not normalized.');
    $gigaChatAudio = genesisGigaChatAudioFile([
        'mimeType' => 'audio/webm;codecs=opus',
        'data' => base64_encode('test-audio'),
    ]);
    expect($gigaChatAudio['mimeType'] === 'audio/webm' && $gigaChatAudio['extension'] === 'weba', 'GigaChat audio format was not normalized.');
    expect(strlen($gigaChatAudio['bytes']) === 10, 'GigaChat audio payload was not decoded.');
    expect(preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/', genesisGigaChatUuid()) === 1, 'GigaChat request UUID is invalid.');
    expect((genesisGeminiPlanSchema()['additionalProperties'] ?? true) === false, 'Assistant JSON schema must reject unexpected properties.');

    $reminders = genesisNormalizeTaskReminders([
        ['kind' => 'relative', 'minutes' => 30],
        ['kind' => 'relative', 'minutes' => 30],
        ['kind' => 'absolute', 'at' => '2026-10-28T06:00:00+00:00'],
    ]);
    expect(count($reminders) === 2, 'Duplicate reminders were not removed.');
    $overrides = genesisTaskReminderOverrides(
        $reminders,
        new DateTimeImmutable('2026-10-28 10:00:00', new DateTimeZone('Europe/Moscow')),
    );
    expect($overrides === [
        ['method' => 'popup', 'minutes' => 30],
        ['method' => 'popup', 'minutes' => 60],
    ], 'Relative and absolute reminders were not converted for Google Calendar.');
    expect(genesisNormalizeTaskReminders([], 10) === [['kind' => 'relative', 'minutes' => 10]], 'Legacy reminders were not migrated.');

    $legacyDescription = "Пользовательский текст\r\n\r\n— GENESIS —\r\nПриоритет: 10\r\nGENESIS-DATA:eyJ0YXNrSWQiOiIxIn0";
    expect(genesisHasLegacyTaskDescriptionMetadata($legacyDescription), 'Legacy GENESIS metadata was not detected for migration.');
    expect(genesisCleanTaskDescription($legacyDescription) === 'Пользовательский текст', 'Legacy GENESIS metadata leaked into a visible description.');
    $partialLegacyDescription = "Пользовательский текст\nСоздано в GENESIS\nПриоритет: 10\nGENESIS-DATA:eyJ0YXNrSWQiOiIxIn0";
    expect(genesisCleanTaskDescription($partialLegacyDescription) === 'Пользовательский текст', 'Partial legacy GENESIS metadata leaked into a visible description.');
    $decodedLegacyNotes = genesisDecodeTaskNotes($partialLegacyDescription);
    expect(($decodedLegacyNotes['metadata']['taskId'] ?? null) === '1', 'Partial legacy task metadata was not recovered before cleanup.');
    expect(!genesisHasLegacyTaskDescriptionMetadata("Пользователь написал\n— GENESIS —\nобычную заметку"), 'Ordinary user text was mistaken for legacy metadata.');
    expect(genesisTaskNotesForGoogle('task-clean-notes', ['description' => $legacyDescription]) === 'Пользовательский текст', 'Google Tasks notes must contain user text only.');
    $cleanEvent = genesisTaskPayloadForGoogle('task-clean-event', [
        'title' => 'Чистое описание',
        'description' => $legacyDescription,
        'dueDate' => '2026-10-01',
        'endDate' => '2026-10-01',
        'priority' => 10,
        'reminders' => [],
    ]);
    expect(($cleanEvent['description'] ?? null) === 'Пользовательский текст', 'Google Calendar description must contain user text only.');
    expect(($cleanEvent['extendedProperties']['private']['genesisPriority'] ?? null) === '10', 'Hidden Calendar metadata was not preserved.');

    $calendarRecurrence = genesisGoogleRecurrenceLines([
        'recurrenceMode' => 'genesis',
        'recurrenceSeriesId' => null,
        'recurrenceDates' => ['2026-10-01', '2026-10-06', '2026-10-11'],
    ], '2026-10-01', '09:00', 'Europe/Moscow');
    expect($calendarRecurrence === [
        'RDATE;TZID=Europe/Moscow:20261006T090000,20261011T090000',
    ], 'A Calendar recurrence must be represented by one native RDATE series.');
    expect(genesisGoogleRecurrenceLines([
        'recurrenceMode' => 'genesis',
        'recurrenceSeriesId' => 'expanded-for-google-tasks',
        'recurrenceDates' => ['2026-10-01', '2026-10-06'],
    ], '2026-10-01', '', 'Europe/Moscow') === [], 'Expanded task series must not become nested Calendar recurrences.');

    $survivorId = 'test-account-deletion-survivor';
    $db->prepare('INSERT OR REPLACE INTO users (id, google_sub, email, display_name, created_at, updated_at) VALUES (:id, :sub, :email, :name, :created_at, :updated_at)')->execute([
        'id' => $survivorId,
        'sub' => 'test-account-deletion-survivor-sub',
        'email' => 'genesis.deletion.survivor@gmail.com',
        'name' => 'Deletion Survivor',
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    $db->prepare('INSERT OR REPLACE INTO workspace_blobs (user_id, ciphertext, iv, version, updated_at) VALUES (:user_id, :ciphertext, :iv, 1, :updated_at)')->execute([
        'user_id' => $survivorId,
        'ciphertext' => base64_encode(random_bytes(32)),
        'iv' => base64_encode(random_bytes(12)),
        'updated_at' => $now,
    ]);
    $db->prepare('INSERT OR REPLACE INTO linked_google_accounts (id, owner_user_id, google_sub, email, display_name, created_at, updated_at) VALUES (:id, :owner_user_id, :google_sub, :email, :display_name, :created_at, :updated_at)')->execute([
        'id' => 'test-linked-account',
        'owner_user_id' => $userId,
        'google_sub' => 'test-linked-account-sub',
        'email' => 'genesis.linked.test@gmail.com',
        'display_name' => 'Linked Test',
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    $db->prepare('INSERT OR REPLACE INTO stoicheion_draws (user_id, day_key, draw_kind, seed_value, attempt_count, first_draw_at, updated_at) VALUES (:user_id, :day_key, :draw_kind, 42, 1, :first_draw_at, :updated_at)')->execute([
        'user_id' => $userId,
        'day_key' => '2026-09-18',
        'draw_kind' => 'daily',
        'first_draw_at' => $now,
        'updated_at' => $now,
    ]);
    $db->prepare('INSERT OR REPLACE INTO stoicheion_timeline_draws (user_id, day_key, draw_kind, seed_value, attempt_count, first_draw_at, updated_at) VALUES (:user_id, :day_key, :draw_kind, 42, 1, :first_draw_at, :updated_at)')->execute([
        'user_id' => $userId,
        'day_key' => '2026-09-18',
        'draw_kind' => 'timeline',
        'first_draw_at' => $now,
        'updated_at' => $now,
    ]);
    $db->prepare('INSERT OR REPLACE INTO categories (id, user_id, name, color, created_at, updated_at) VALUES (:id, :user_id, :name, :color, :created_at, :updated_at)')->execute([
        'id' => 'test-deletion-category',
        'user_id' => $userId,
        'name' => 'Deletion Category',
        'color' => '#2d6c68',
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    $db->prepare("INSERT OR REPLACE INTO projects (id, user_id, category_id, title, status, created_at, updated_at) VALUES (:id, :user_id, :category_id, :title, 'active', :created_at, :updated_at)")->execute([
        'id' => 'test-deletion-project',
        'user_id' => $userId,
        'category_id' => 'test-deletion-category',
        'title' => 'Deletion Project',
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    foreach (['test-deletion-task', 'test-deletion-dependency'] as $taskId) {
        $db->prepare("INSERT OR REPLACE INTO tasks (id, user_id, project_id, category_id, sacred_year, month_index, sacred_day, due_date, title, recurrence, sync_to_google, created_at, updated_at) VALUES (:id, :user_id, :project_id, :category_id, 2026, 1, 1, '2026-09-18', :title, 'none', 0, :created_at, :updated_at)")->execute([
            'id' => $taskId,
            'user_id' => $userId,
            'project_id' => 'test-deletion-project',
            'category_id' => 'test-deletion-category',
            'title' => $taskId,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }
    $db->prepare('INSERT OR REPLACE INTO task_links (user_id, task_id, depends_on_task_id, created_at) VALUES (:user_id, :task_id, :depends_on_task_id, :created_at)')->execute([
        'user_id' => $userId,
        'task_id' => 'test-deletion-task',
        'depends_on_task_id' => 'test-deletion-dependency',
        'created_at' => $now,
    ]);
    $db->prepare('INSERT INTO yandex_calendar_connections
        (user_id, login_enc, app_password_enc, calendar_path_enc, last_checked_at, connected_at, updated_at)
        VALUES (:id, :login, :password, :path, :now, :now, :now)')->execute([
        'id' => $userId, 'login' => genesisEncrypt('smoke@yandex.ru'),
        'password' => genesisEncrypt('smoke-password'),
        'path' => genesisEncrypt('/calendars/smoke@yandex.ru/events-default/'), 'now' => $now,
    ]);
    $legacyCalendar = genesisYandexCalendarConnection($userId);
    expect($legacyCalendar !== null && genesisYandexCalendarCredential($legacyCalendar)
        === ['credential' => 'smoke-password', 'oauth' => false],
        'Existing Yandex Calendar app-password connections remain usable');
    $db->prepare('UPDATE yandex_calendar_connections SET app_password_enc = :empty,
        access_token_enc = :token WHERE user_id = :id')->execute([
        'empty' => '', 'token' => genesisEncrypt('smoke-oauth-token'), 'id' => $userId,
    ]);
    $oauthCalendar = genesisYandexCalendarConnection($userId);
    expect($oauthCalendar !== null && genesisYandexCalendarCredential($oauthCalendar)
        === ['credential' => 'smoke-oauth-token', 'oauth' => true],
        'Yandex Calendar OAuth connections use the encrypted access token');
    $db->prepare('INSERT INTO yandex_calendar_tasks
        (user_id, task_id, payload_enc, event_path_enc, updated_at)
        VALUES (:id, :task_id, :payload, :path, :now)')->execute([
        'id' => $userId, 'task_id' => 'smoke-yandex-task',
        'payload' => genesisEncrypt('{"title":"Smoke"}'),
        'path' => genesisEncrypt('/calendars/smoke@yandex.ru/events-default/genesis-'
            . str_repeat('a', 40) . '.ics'),
        'now' => $now,
    ]);
    $_SERVER['HTTP_X_GENESIS_TIME_ZONE'] = 'Europe/Moscow';
    $calendarIcs = genesisYandexIcsDocument('smoke-yandex-task', [
        'title' => 'Встреча, GENESIS', 'description' => "Строка\nописания",
        'dueDate' => '2026-10-02', 'endDate' => '2026-10-02', 'time' => '09:30',
        'yandexEntryType' => 'meeting', 'yandexEndTime' => '10:00',
        'yandexAttendees' => ['guest@example.com'], 'yandexReminders' => [0, 60],
    ], 'smoke@yandex.ru');
    expect(str_contains($calendarIcs, 'DTSTART:20261002T063000Z')
        && str_contains($calendarIcs, 'DTEND:20261002T070000Z'),
        'Yandex meeting did not use the device time zone.');
    expect(substr_count($calendarIcs, 'BEGIN:VALARM') === 2
        && str_contains($calendarIcs, 'ATTENDEE;ROLE=REQ-PARTICIPANT'),
        'Yandex meeting lost its attendees or reminders.');
    expect(genesisYandexIcsValue($calendarIcs, 'SUMMARY') === 'Встреча, GENESIS',
        'Yandex event text did not survive iCalendar escaping.');
    expect(genesisYandexIcsDateTime("DTSTART;TZID=Europe/Moscow:20261002T093000\r\n", 'DTSTART')
        === ['date' => '2026-10-02', 'time' => '09:30'],
        'Yandex local-time calendar events were not decoded.');
    unset($_SERVER['HTTP_X_GENESIS_TIME_ZONE']);

    genesisRecordAndroidDownload($userId, '2.3.11');
    genesisRecordAndroidDownload($userId, '2.3.11');
    $_SERVER['HTTP_X_GENESIS_APP_VERSION'] = '2.3.11';
    $_SERVER['HTTP_X_GENESIS_INSTALLATION_ID'] = '123e4567-e89b-42d3-a456-426614174000';
    genesisReportAndroidClient($userId, 'ok', 'warning');
    unset($_SERVER['HTTP_X_GENESIS_APP_VERSION'], $_SERVER['HTTP_X_GENESIS_INSTALLATION_ID']);
    genesisRecordFeatureUsage($userId, ['platform' => 'web',
        'features' => ['menu.tasks', 'submenu.tasks.lists']]);
    genesisRecordFeatureUsage($userId, ['platform' => 'android',
        'features' => ['menu.tasks', 'submenu.tasks.lists']]);
    try {
        genesisRecordFeatureUsage($userId, ['platform' => 'web', 'features' => ['task.title.secret']]);
        throw new RuntimeException('Arbitrary feature content was accepted.');
    } catch (InvalidArgumentException $expected) { /* Only fixed identifiers are accepted. */ }
    $adminStats = genesisAdminStats();
    foreach ($adminStats['users'] as $adminStatUser) {
        expect(in_array($adminStatUser['subscriptionPlan'] ?? null, ['free', 'standart', 'premium', 'business', 'premium4life'], true), 'Administrator subscription status is missing or invalid.');
    }
    $taskUsage = array_values(array_filter($adminStats['featureUsage']['features'],
        static fn (array $row): bool => $row['id'] === 'menu.tasks'))[0] ?? null;
    expect($taskUsage !== null && $taskUsage['opens'] === 2 && $taskUsage['usedUsers'] === 1
        && $taskUsage['webOpens'] === 1 && $taskUsage['androidOpens'] === 1,
        'Feature usage did not aggregate by account and platform.');
    $androidRow = array_values(array_filter($adminStats['users'], static fn (array $row): bool => $row['id'] === $userId))[0] ?? null;
    expect($androidRow !== null && $androidRow['androidDownloadCount'] === 2, 'Android download requests were not counted per user.');
    expect($androidRow['androidReportedVersion'] === '2.3.11' && $androidRow['androidDeviceCount'] === 1, 'Android installation version was not reported.');
    expect($androidRow['androidServerSyncStatus'] === 'ok' && $androidRow['androidGoogleSyncStatus'] === 'warning', 'Android sync status was not recorded.');
    expect(count($androidRow['androidVersions']) === 1 && $androidRow['androidVersions'][0]['version'] === '2.3.11', 'Reported app versions are missing.');
    foreach (['3.9.0' => '123e4567-e89b-42d3-a456-426614174001', '3.10.0' => '123e4567-e89b-42d3-a456-426614174002'] as $version => $installation) {
        $_SERVER['HTTP_X_GENESIS_APP_VERSION'] = $version;
        $_SERVER['HTTP_X_GENESIS_INSTALLATION_ID'] = $installation;
        genesisReportAndroidClient($userId, 'ok', 'ok');
    }
    $db->prepare('UPDATE android_client_reports SET last_seen_at=:seen WHERE user_id=:user')->execute(['seen' => $now, 'user' => $userId]);
    $tied = genesisAdminAndroidReports()[$userId];
    expect($tied['latest']['version'] === '3.10.0' && array_column($tied['versions'], 'version') === ['3.10.0', '3.9.0', '2.3.11'], 'Same-second reports must use deterministic semantic version order.');
    $db->prepare("UPDATE android_client_reports SET last_seen_at=:seen, last_server_sync_at=NULL, server_sync_status='unknown', google_sync_status='unknown' WHERE user_id=:user AND app_version='2.3.11'")
        ->execute(['seen' => date(DATE_ATOM, strtotime($now) + 10), 'user' => $userId]);
    $mixed = genesisAdminAndroidReports()[$userId];
    expect($mixed['installationCount'] === 3 && $mixed['latest']['version'] === '2.3.11'
        && $mixed['latest']['lastServerSyncAt'] === null && $mixed['latest']['serverSyncStatus'] === 'unknown', 'Latest contact must not borrow successful sync from another installation.');
    expect($mixed['versions'][0]['lastServerSyncAt'] !== null, 'Per-version sync context was lost.');
    $_SERVER['HTTP_X_GENESIS_APP_VERSION'] = '3.11.0';
    $_SERVER['HTTP_X_GENESIS_INSTALLATION_ID'] = '123e4567-e89b-42d3-a456-426614174002';
    $_SESSION['client_activity_observed'][$userId . ':android_app'] = time();
    genesisObserveClientActivity($userId);
    expect(genesisAdminAndroidReports()[$userId]['versions'][0]['version'] === '3.11.0', 'Authenticated activity did not refresh an upgraded app inside the activity throttle window.');
    unset($_SERVER['HTTP_X_GENESIS_APP_VERSION'], $_SERVER['HTTP_X_GENESIS_INSTALLATION_ID']);
    expect($androidRow['yandexCalendarConnected'] === true && $androidRow['yandexSyncedCount'] === 1
        && $androidRow['lastYandexCalendarCheckAt'] === $now,
        'Yandex Calendar aggregate status was not exposed to the administrator.');

    // Exercise the new owner-scoped namespaces for both the deleted account and
    // an unrelated survivor; do not weaken the full-table deletion guard.
    foreach ([$userId, $survivorId] as $noticeOwner) {
        $db->prepare('INSERT INTO stoicheion_timeline_sessions (user_id,period_key,source_day_key,seed_value,revision,created_at,updated_at) VALUES (?,?,?,?,1,?,?)')
            ->execute([$noticeOwner,'2026-09-14','2026-09-18',42,$now,$now]);
        foreach ([0,1,2] as $position) {
            $db->prepare('INSERT INTO stoicheion_timeline_card_windows (user_id,period_key,position,first_revealed_at,rerolled_at) VALUES (?,?,?,?,?)')
                ->execute([$noticeOwner,'2026-09-14',$position,$now,$position===1?$now:null]);
        }
        $db->prepare('INSERT INTO aurora_workspaces (user_id,revision,iv,ciphertext,payload_hash,updated_at) VALUES (?,1,?,?,?,?)')
            ->execute([$noticeOwner,base64_encode(random_bytes(12)),base64_encode(random_bytes(32)),hash('sha256','synthetic-deletion-'.$noticeOwner),$now]);
        $db->prepare('INSERT INTO email_registration_lifecycle (user_id,email,enrolled_at,deadline_at) VALUES (?,?,?,?)')
            ->execute([$noticeOwner,$noticeOwner.'@example.invalid',$now,date(DATE_ATOM,strtotime($now)+5*86400)]);
        $db->prepare('INSERT INTO email_verification_dismissals (user_id,dismissed_until) VALUES (?,?)')
            ->execute([$noticeOwner,date(DATE_ATOM,strtotime($now)+86400)]);
        $db->prepare("INSERT INTO support_notices (user_id,surface,shown_at,next_at) VALUES (?,'web',?,?)")
            ->execute([$noticeOwner,$now,date(DATE_ATOM,strtotime($now)+86400)]);
        $db->prepare("INSERT INTO dream_journal_preferences (user_id,today_mode,revision,updated_at) VALUES (?,'morning',1,?)")
            ->execute([$noticeOwner,$now]);
    }
    $survivorBeforeDeletion = genesisAccountDataCounts($survivorId);
    $beforeDeletion = genesisAccountDataCounts($userId);
    $uncoveredTables = array_keys(array_filter($beforeDeletion, static fn (int $count): bool => $count === 0));
    expect($uncoveredTables === [], 'Deletion fixture did not cover user-owned tables: '.implode(', ',$uncoveredTables));
    $admin = genesisFindUserByEmail(genesisAdminEmail());
    if ($admin === null) {
        $adminId = 'test-admin-moderation';
        $db->prepare('INSERT INTO users (id, google_sub, email, display_name, created_at, updated_at) VALUES (:id, :sub, :email, :name, :created_at, :updated_at)')->execute([
            'id' => $adminId,
            'sub' => 'test-admin-moderation-sub',
            'email' => genesisAdminEmail(),
            'name' => 'Moderation Admin',
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $admin = genesisFindUser($adminId);
    }
    expect(is_array($admin), 'Admin moderation fixture was not created.');
    // Administrative revocation requires the primary Google session, not the prior linked-user session.
    $_SESSION['user_id'] = (string)$admin['id'];
    $_SESSION['auth_identity'] = ['kind'=>'primary','sub'=>(string)$admin['google_sub']];
    $moderation = genesisAdminDeleteUser((string)$admin['id'], $userId, true);
    expect(($moderation['purged'] ?? null) === $beforeDeletion, 'Admin deletion receipt did not match the deleted records.');
    expect(($moderation['blacklisted'] ?? false) === true, 'Admin deletion did not confirm blacklist selection.');
    expect(array_sum(genesisAccountDataCounts($userId)) === 0, 'Account deletion left user-owned rows on the server.');
    expect(genesisAccountDataCounts($survivorId) === $survivorBeforeDeletion, 'Account deletion changed another owner\'s rows.');
    $blocked = $db->prepare('SELECT COUNT(*) FROM blocked_identities WHERE google_sub_hash = :google_sub_hash AND email_hash = :email_hash');
    $blocked->execute([
        'google_sub_hash' => genesisIdentifierHash('google-sub', 'test-private-workspace-sub'),
        'email_hash' => genesisIdentifierHash('email', 'genesis.smoke.test@gmail.com'),
    ]);
    expect((int)$blocked->fetchColumn() === 1, 'Deleted spam account identifiers were not blacklisted.');
    try {
        genesisAssertIdentityAllowed('test-private-workspace-sub', 'genesis.smoke.test@gmail.com');
        throw new RuntimeException('A blacklisted identity was unexpectedly allowed to sign in.');
    } catch (DomainException $blockedIdentity) {
        expect(str_contains($blockedIdentity->getMessage(), 'заблокирован'), 'Blacklisted sign-in returned an unexpected error.');
    }
    expect(genesisFindUser($survivorId) !== null, 'Account deletion removed another user.');
    $survivorWorkspace = $db->prepare('SELECT COUNT(*) FROM workspace_blobs WHERE user_id = :user_id');
    $survivorWorkspace->execute(['user_id' => $survivorId]);
    expect((int)$survivorWorkspace->fetchColumn() === 1, 'Account deletion removed another user\'s encrypted workspace.');

    $db->rollBack();
    echo json_encode(['ok' => true, 'privacyModel' => 2, 'workspaceEncrypted' => true, 'taskRows' => 0], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL;
} catch (Throwable $error) {
    if ($db->inTransaction()) {
        $db->rollBack();
    }
    throw $error;
}
