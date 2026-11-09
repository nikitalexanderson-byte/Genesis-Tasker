<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli-server' || getenv('GENESIS_IMPROVEMENTS_TEST') !== 'isolated' ||
    !in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true)) { http_response_code(403); exit; }
$suite = getenv('GENESIS_ACCEPTANCE_SUITE') ?: 'c-suite';
if (!in_array($suite, ['c-suite', 'efg-suite', 'kul-suite', 'audit-suite', 'audit-ui-suite'], true)) throw new RuntimeException('Unknown isolated suite');
$root = dirname(__DIR__, 2); $runtime = $root . '/output/' . $suite . '/https';
// Check every request, including ordinary API reads, before any database access.
$configurationPath = $root . '/server/config.php';
$configurationHash = is_file($runtime . '/config-sha256.txt') ? trim(file_get_contents($runtime . '/config-sha256.txt')) : '';
if (!is_file($configurationPath) || $configurationHash === '' || !hash_equals($configurationHash, hash_file('sha256', $configurationPath))) {
    throw new RuntimeException('Owned C-suite configuration not confirmed');
}
$configuration = require $configurationPath;
$expectedDatabase = realpath($runtime . '/fixture.sqlite');
if ($expectedDatabase === false || realpath($configuration['db_path']) !== $expectedDatabase || $configuration['app_url'] !== 'http://127.0.0.1:4338') {
    throw new RuntimeException('Only the synthetic C-suite database is permitted');
}
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($uri === '/__fixture/sign-in') {
    foreach (['bootstrap', 'repository', 'google'] as $module) require_once $root . '/server/src/' . $module . '.php';
    $actor = $_GET['actor'] ?? '';
    if (!in_array($actor, ['editor', 'viewer'], true)) { http_response_code(400); exit; }
    $user = genesisFindUserByEmail('improvements-' . $actor . '@example.invalid');
    genesisEstablishGoogleSession($user, $user['google_sub']);
    header('Location: /'); exit;
}
if (in_array($uri, ['/__fixture/add-member', '/__fixture/worker'], true)) {
    foreach (['bootstrap', 'repository', 'google', 'shared-projects'] as $module) require_once $root . '/server/src/' . $module . '.php';
    $editor = genesisFindUserByEmail('improvements-editor@example.invalid');
    genesisStartSession();
    if ($_SERVER['REQUEST_METHOD'] !== 'POST' || genesisCurrentUserId() !== $editor['id']) { http_response_code(403); exit; }
    $input = json_decode(file_get_contents('php://input'), true, 8, JSON_THROW_ON_ERROR);
    $space = genesisSharedSpaceAccess($input['spaceId'] ?? '', $editor['id']);
    if ($space['created_by'] !== $editor['id'] || !str_starts_with($space['title'], 'C1 Android HTTPS ')) { http_response_code(403); exit; }
    header('Content-Type: application/json');
    if ($uri === '/__fixture/worker') { echo json_encode(genesisBackgroundRun(50)); exit; }
    $viewer = genesisFindUserByEmail('improvements-viewer@example.invalid'); $db = genesisDb();
    $db->prepare('INSERT INTO shared_space_members(space_id,user_id,role,joined_at) VALUES(?,?,?,?)')->execute([$space['id'], $viewer['id'], 'member', genesisNow()]);
    $db->prepare('INSERT INTO shared_project_members(project_id,user_id,role,joined_at) SELECT id,?,?,? FROM shared_projects WHERE space_id=?')->execute([$viewer['id'], 'member', genesisNow(), $space['id']]);
    echo json_encode(['userId' => $viewer['id']]); exit;
}
if ($uri === '/__fixture/state' && is_file($runtime . '/web-state.json')) {
    header('Content-Type: application/json'); readfile($runtime . '/web-state.json'); exit;
}
if (str_starts_with($uri, '/api/')) {
    $_GET['path'] = substr($uri, 5);
    require $root . '/server/public/api/index.php'; return;
}
http_response_code(404);
