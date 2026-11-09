<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__) . '/src/bootstrap.php';
require dirname(__DIR__) . '/src/repository.php';
require dirname(__DIR__) . '/src/google.php';

$user = genesisFindUserByEmail(genesisAdminEmail());
if ($user === null) {
    fwrite(STDOUT, json_encode(['ok' => false, 'reason' => 'ADMIN_USER_NOT_FOUND'], JSON_UNESCAPED_UNICODE) . PHP_EOL);
    exit(1);
}

$report = [
    'ok' => true,
    'calendarConnected' => !empty($user['google_calendar_id']) && !empty($user['refresh_token_enc']),
    'tasksScopeGranted' => genesisGoogleScopeGranted($user, GENESIS_GOOGLE_TASKS_SCOPE),
    'calendarItems' => 0,
    'warning' => null,
];

try {
    $items = genesisListGoogleTasks($user);
    $report['calendarItems'] = count($items);
    $report['warning'] = genesisGoogleTasksSyncWarning();
    if ($report['warning'] !== null) {
        $report['ok'] = false;
    }
} catch (Throwable $error) {
    $report['ok'] = false;
    $report['warning'] = $error->getMessage();
}

fwrite(STDOUT, json_encode($report, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL);
exit($report['ok'] ? 0 : 2);
