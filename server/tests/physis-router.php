<?php
declare(strict_types=1);

// Only the isolated local harness may execute this router. It is not an API route.
if (PHP_SAPI !== 'cli-server' || !in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true)) { http_response_code(404); exit; }
$directory = getenv('GENESIS_PHYSIS_TEST_DIR');
if (!is_string($directory) || !str_starts_with(basename($directory), 'genesis-physis-test-') || !is_file($directory . '/config.php')) { http_response_code(404); exit; }
define('GENESIS_LOCAL_TEST_CONFIG', $directory . '/config.php');
if (!isset($_GET['path'])) {
    $fixturePath = parse_url((string)($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH);
    if (is_string($fixturePath) && str_starts_with($fixturePath, '/api/')) $_GET['path'] = substr($fixturePath, 5);
}
// Explicit opt-in browser fixture login. Never present in the production router.
if (getenv('GENESIS_PHYSIS_BROWSER_FIXTURE') === '1' && ($_GET['path'] ?? '') === 'physis-test/login') {
    require dirname(__DIR__) . '/src/bootstrap.php';
    require dirname(__DIR__) . '/src/repository.php';
    if (genesisConfig()['app_url'] !== 'https://localhost.invalid'
        || genesisConfig()['db_path'] !== $directory . '/genesis.sqlite') { http_response_code(404); exit; }
    $fixtureOwner = in_array($_GET['owner'] ?? '', ['b', 'c'], true) ? $_GET['owner'] : 'a';
    $fixtureUser = genesisFindUserByGoogleSub('synthetic-physis-browser-' . $fixtureOwner);
    if (!$fixtureUser) { http_response_code(404); exit; }
    session_regenerate_id(true);
    genesisEstablishGoogleSession($fixtureUser, $fixtureUser['google_sub'],
        ['sub' => $fixtureUser['google_sub'], 'email' => $fixtureUser['email'], 'email_verified' => true], 'web');
    if (($_GET['session'] ?? '') === 'legacy') {
        unset($_SESSION['auth_identity']['channel'], $_SESSION['auth_identity']['email'], $_SESSION['auth_identity']['email_verified']);
    } elseif (($_GET['session'] ?? '') === 'native') {
        $_SESSION['auth_identity']['channel'] = 'native';
    }
    genesisJson(['ok' => true, 'fixture' => true, 'csrf' => $_SESSION['csrf']]);
}
require dirname(__DIR__) . '/public/api/index.php';
