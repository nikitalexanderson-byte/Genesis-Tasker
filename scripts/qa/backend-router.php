<?php
declare(strict_types=1);

// This router is outside server/public and is usable only by an explicitly opted-in loopback CLI server.
if (PHP_SAPI !== 'cli-server' || getenv('GENESIS_FULL_QA') !== 'isolated'
    || !in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true)) { http_response_code(404); exit; }
$directory = str_replace('\\', '/', (string)getenv('GENESIS_FULL_QA_DIR'));
if ($directory === '' || !is_file($directory . '/owner.json')) { http_response_code(404); exit; }
$owner = json_decode((string)file_get_contents($directory . '/owner.json'), true, 16, JSON_THROW_ON_ERROR);
if (($owner['synthetic'] ?? false) !== true || ($owner['directory'] ?? '') !== $directory
    || !hash_equals((string)$owner['configSha256'], (string)hash_file('sha256', $directory . '/config.php'))) throw new RuntimeException('Owned configuration mismatch');
define('GENESIS_LOCAL_TEST_CONFIG', $directory . '/config.php');
$config = require GENESIS_LOCAL_TEST_CONFIG;
if ($config['db_path'] !== $directory . '/genesis.sqlite' || $config['session_path'] !== $directory . '/sessions'
    || $config['app_url'] !== $owner['origin']) throw new RuntimeException('Fixture isolation mismatch');
$path = parse_url((string)($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH);
if ($path === '/api/qa/identity') {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode(['synthetic' => true, 'runId' => $owner['runId']], JSON_THROW_ON_ERROR);
    exit;
}
// Compatibility adapter for the repository's opt-in JVM/native HTTP tests.
// It is reachable only inside the same owned, credential-free QA runtime.
if (is_string($path) && str_starts_with($path, '/__fixture/') && is_file($directory . '/legacy-http.json')) {
    $legacy = json_decode((string)file_get_contents($directory . '/legacy-http.json'), true, 16, JSON_THROW_ON_ERROR);
    if (($legacy['synthetic'] ?? false) !== true) throw new RuntimeException('Legacy fixture marker required');
    foreach (['bootstrap','repository','google','shared-projects'] as $module) require_once dirname(__DIR__, 2) . '/server/src/' . $module . '.php';
    if ($path === '/__fixture/sign-in') {
        $actor = (string)($_GET['actor'] ?? '');
        if (!in_array($actor, ['editor','viewer'], true)) { http_response_code(400); exit; }
        $user = genesisFindUser($legacy['actors'][$actor] ?? '');
        if (!$user || $user['email'] !== 'improvements-' . $actor . '@example.invalid' || genesisIsAdminUser($user) || genesisSharedTester($user)) throw new RuntimeException('Invalid legacy fixture actor');
        genesisEstablishGoogleSession($user, $user['google_sub']);
        header('Location: /'); exit;
    }
    http_response_code(404); exit;
}
if (!is_string($path) || !str_starts_with($path, '/api/')) { http_response_code(404); exit; }
$_GET['path'] = substr($path, 5);
if ($_GET['path'] === 'qa/login') {
    require dirname(__DIR__, 2) . '/server/src/bootstrap.php';
    require dirname(__DIR__, 2) . '/server/src/repository.php';
    $users = json_decode((string)file_get_contents($directory . '/users.json'), true, 16, JSON_THROW_ON_ERROR)['users'];
    $tier = (string)($_GET['tier'] ?? '');
    if (!isset($users[$tier])) genesisJson(['error' => 'UNKNOWN_SYNTHETIC_USER'], 400);
    $user = genesisFindUser($users[$tier]['id']);
    if (!$user || genesisIsAdminUser($user) || genesisSharedTester($user)) throw new RuntimeException('Invalid ordinary fixture user');
    if (!session_regenerate_id(true)) throw new RuntimeException('Cannot rotate synthetic session');
    genesisEstablishGoogleSession($user, $user['google_sub'], ['sub' => $user['google_sub'], 'email' => $user['email'], 'email_verified' => true], 'web');
    genesisJson(['ok' => true, 'synthetic' => true, 'userId' => $user['id']]);
}
require dirname(__DIR__, 2) . '/server/public/api/index.php';
