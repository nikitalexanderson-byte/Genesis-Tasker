<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli' || getenv('GENESIS_IMPROVEMENTS_TEST') !== 'isolated' || !defined('GENESIS_LOCAL_TEST_CONFIG')) {
    throw new RuntimeException('Explicit isolated fixture required');
}
foreach (['bootstrap', 'repository', 'google', 'shared-projects'] as $module) require_once __DIR__ . '/../src/' . $module . '.php';
if (genesisConfig()['app_url'] !== 'https://localhost.invalid') throw new RuntimeException('Synthetic HTTP fixture required');
function dxCheck(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
function dxUser(string $plan): array {
    $id = 'data-access-' . genesisUuid(); $now = genesisNow();
    genesisDb()->prepare('INSERT INTO users(id,google_sub,email,display_name,auth_provider,subscription_plan,subscription_valid_until,shared_projects_enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
        ->execute([$id, $id, $id . '@example.invalid', 'Data access fixture', 'google', $plan, $plan === 'premium4life' ? null : '2035-01-01T00:00:00Z', 1, $now, $now]);
    $user = genesisEnsureWorkspaceKey(genesisFindUser($id));
    dxCheck(!genesisIsAdminUser($user) && !genesisSharedTester($user), 'Ordinary fixture acquired elevated privileges');
    return $user;
}
function dxDenied(array $response, string $feature): void {
    dxCheck($response['status'] === 403 && ($response['data']['error'] ?? null) === 'FEATURE_SUBSCRIPTION_REQUIRED'
        && ($response['data']['feature'] ?? null) === $feature, 'Wrong denial for ' . $feature . ': ' . json_encode($response));
}

$db = genesisDb(); $owner = dxUser('business'); $empty = dxUser('business'); $outsider = dxUser('premium');
$space = genesisSharedCreateSpace($owner['id'], ['title' => 'Entitlement source'])['id'];
$users = [];
foreach (['free', 'standart', 'premium', 'business', 'premium4life', 'expired', 'revoked'] as $key) {
    $users[$key] = dxUser($key === 'expired' ? 'business' : ($key === 'revoked' ? 'premium4life' : $key));
    $db->prepare("INSERT INTO shared_space_members(space_id,user_id,role,all_projects,joined_at) VALUES(?,?,'member',1,?)")
        ->execute([$space, $users[$key]['id'], genesisNow()]);
}
$project = genesisSharedCreateProject($owner['id'], $space, ['title' => 'Existing private data'])['id'];
genesisSharedTask($owner['id'], $project, ['title' => 'Preserved task']);
$data = genesisDataEmpty('Paid import');
$data['projects'] = [['key' => 'root', 'title' => 'Imported', 'kind' => 'project', 'layout' => 'list', 'statuses' => [
    ['key' => 'open', 'title' => 'Open', 'isDone' => false], ['key' => 'done', 'title' => 'Done', 'isDone' => true],
]]];
$input = ['format' => 'json', 'content' => genesisDataJson($data), 'spaceId' => $space];
$export = ['scope' => 'tree', 'projectId' => $project, 'format' => 'json'];
$exportPath = 'shared/spaces/' . $space . '/data-export';
$saved = $_SESSION; $files = []; $process = null;
try {
    $credentials = [];
    foreach ([...$users, 'empty' => $empty, 'outsider' => $outsider] as $key => $user) {
        genesisEstablishGoogleSession($user, $user['google_sub']);
        $id = bin2hex(random_bytes(24)); $encoded = '';
        foreach ($_SESSION as $name => $value) $encoded .= $name . '|' . serialize($value);
        $file = genesisConfig()['session_path'] . '/sess_' . $id; $files[] = $file;
        file_put_contents($file, $encoded, LOCK_EX);
        $credentials[$key] = ['cookie' => session_name() . '=' . $id, 'csrf' => $_SESSION['csrf']];
    }
    $_SESSION = $saved;
    $listener = stream_socket_server('tcp://127.0.0.1:0', $errno, $error);
    dxCheck($listener !== false, 'Cannot reserve HTTP fixture port');
    $address = stream_socket_get_name($listener, false); fclose($listener);
    $router = tempnam(sys_get_temp_dir(), 'genesis-data-router-'); $files[] = $router;
    file_put_contents($router, '<?php if(!defined("GENESIS_LOCAL_TEST_CONFIG")) define('
        . var_export('GENESIS_LOCAL_TEST_CONFIG', true) . ', ' . var_export((string)GENESIS_LOCAL_TEST_CONFIG, true) . '); require '
        . var_export(dirname(__DIR__) . '/public/api/index.php', true) . ';');
    $log = tempnam(sys_get_temp_dir(), 'genesis-data-http-'); $files[] = $log;
    $command = [PHP_BINARY]; if (($ini = php_ini_loaded_file()) !== false) array_push($command, '-c', $ini);
    array_push($command, '-S', $address, $router);
    $process = proc_open($command, [0 => ['pipe', 'r'], 1 => ['file', $log, 'a'], 2 => ['file', $log, 'a']], $pipes, dirname(__DIR__, 2));
    dxCheck(is_resource($process), 'Cannot start HTTP fixture'); fclose($pipes[0]);
    $ready = false;
    for ($attempt = 0; $attempt < 50; $attempt++) {
        $socket = @stream_socket_client('tcp://' . $address, $errno, $error, 0.1);
        if ($socket !== false) { fclose($socket); $ready = true; break; }
        usleep(100000);
    }
    dxCheck($ready, 'HTTP fixture did not start');
    $request = static function (string $actor, string $path, string $method = 'GET', ?array $body = null, bool $csrf = true) use ($credentials, $address): array {
        $auth = $credentials[$actor];
        $headers = 'Cookie: ' . $auth['cookie'] . "\r\nContent-Type: application/json\r\n";
        if ($csrf) $headers .= 'X-CSRF-Token: ' . $auth['csrf'] . "\r\n";
        $context = stream_context_create(['http' => ['ignore_errors' => true, 'timeout' => 10, 'method' => $method,
            'header' => $headers, 'content' => $body === null ? '' : genesisDataJson($body)]]);
        $bytes = file_get_contents('http://' . $address . '/?path=' . rawurlencode($path), false, $context);
        preg_match('/^HTTP\/\S+ (\d+)/', ($http_response_header ?? [])[0] ?? '', $status);
        return ['status' => (int)($status[1] ?? 0), 'data' => json_decode($bytes ?: '{}', true)];
    };
    $summary = $request('empty', 'shared/spaces');
    dxCheck($summary['status'] === 200 && $summary['data']['spaces'] === [] && $summary['data']['ownedProjectQuota'] === [
        'count' => 0, 'limit' => 100, 'remaining' => 100, 'ownerId' => $empty['id'],
    ], 'Empty owner quota contract was omitted');
    foreach (['free', 'standart', 'premium', 'business', 'premium4life'] as $plan) {
        $response = $request($plan, $exportPath, 'POST', $export);
        if ($plan === 'free') dxDenied($response, 'data-export');
        else {
            dxCheck($response['status'] === 200 && $response['data']['taskCount'] === 1, $plan . ' lost existing-data export');
            $manifest = json_decode($response['data']['content'], true, 128, JSON_THROW_ON_ERROR);
            dxCheck($manifest['tasks'][0]['title'] === 'Preserved task', $plan . ' exported incorrect data');
        }
        $preview = $request($plan, 'shared/data/preview', 'POST', $input);
        if (in_array($plan, ['free', 'standart', 'premium'], true)) {
            $feature = $plan === 'free' ? 'data-export' : 'shared-projects'; dxDenied($preview, $feature);
            dxDenied($request($plan, 'shared/data/apply', 'POST', [...$input, 'operationId' => genesisUuid(), 'fingerprint' => str_repeat('0', 64)]), $feature);
            dxDenied($request($plan, 'shared/spaces/' . $space . '/import-project', 'POST', []), $feature);
        } else {
            dxCheck($preview['status'] === 200 && $preview['data']['canApply'], $plan . ' lost paid import preview');
            $apply = $request($plan, 'shared/data/apply', 'POST', [...$input, 'operationId' => genesisUuid(), 'fingerprint' => $preview['data']['fingerprint']]);
            dxCheck($apply['status'] === 200 && isset($apply['data']['rootProjectId']), $plan . ' lost paid import apply');
        }
        dxCheck($request($plan, 'shared/projects/' . $project)['status'] === 200, $plan . ' lost retained read');
    }
    foreach (['expired', 'revoked'] as $state) {
        dxCheck($request($state, $exportPath, 'POST', $export)['status'] === 200, 'Initial entitlement missing');
        if ($state === 'expired') $db->prepare("UPDATE users SET subscription_valid_until='2000-01-01T00:00:00Z' WHERE id=?")->execute([$users[$state]['id']]);
        else $db->prepare("UPDATE users SET subscription_plan='free',subscription_valid_until=NULL WHERE id=?")->execute([$users[$state]['id']]);
        dxDenied($request($state, $exportPath, 'POST', $export), 'data-export');
        dxDenied($request($state, 'shared/data/preview', 'POST', $input), 'data-export');
        dxCheck($request($state, 'shared/projects/' . $project)['status'] === 200, $state . ' lost retained reads');
    }
    $csrf = $request('business', $exportPath, 'POST', $export, false);
    dxCheck($csrf['status'] === 403 && ($csrf['data']['error'] ?? '') === 'CSRF token mismatch.', 'Paid export bypassed CSRF');
    $foreign = $request('outsider', $exportPath, 'POST', $export);
    dxCheck($foreign['status'] === 404 && !isset($foreign['data']['content']), 'Paid outsider acquired private export');
    dxCheck($db->query('PRAGMA foreign_key_check')->fetchAll() === [], 'Exchange broke foreign keys');
} finally {
    if (is_resource($process)) { proc_terminate($process); proc_close($process); }
    foreach ($files as $file) if (is_file($file)) unlink($file);
    $_SESSION = $saved;
}
echo "PASS HTTP data exchange: five ordinary plans, paid export/import, Free/expired/revoked denial, retained reads, owner quota, CSRF and paid outsider ACL.\n";
