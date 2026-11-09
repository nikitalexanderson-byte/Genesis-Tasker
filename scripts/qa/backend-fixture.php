<?php
declare(strict_types=1);

// CLI-only synthetic users. Nothing in this harness is loaded by the production API.
if (PHP_SAPI !== 'cli') exit(1);
$options = getopt('', ['dir:', 'origin:', 'run-id:', 'backup']);
$directory = str_replace('\\', '/', (string)($options['dir'] ?? ''));
$origin = (string)($options['origin'] ?? 'http://127.0.0.1:4380');
$runId = (string)($options['run-id'] ?? ('run-' . gmdate('Ymd-His') . '-' . bin2hex(random_bytes(4))));
if ($directory === '' || !preg_match('/\A[a-zA-Z0-9-]{6,80}\z/D', $runId)
    || !preg_match('~\Ahttps?://(?:127\.0\.0\.1|localhost):\d{4,5}\z~D', $origin)) throw new RuntimeException('Explicit local fixture directory and origin required');
if (file_exists($directory)) throw new RuntimeException('Fresh fixture directory required; existing data will not be replaced');
if (!mkdir($directory . '/sessions', 0700, true)) throw new RuntimeException('Cannot create owned runtime');
$directory = str_replace('\\', '/', (string)realpath($directory));
$config = [
    'backup_v1_enabled' => array_key_exists('backup',$options),
    'app_url' => $origin, 'google_only' => true, 'google_client_id' => '', 'google_client_secret' => '',
    'gigachat_enabled' => false, 'gemini_enabled' => false, 'physis_enabled' => true,
    'crypto_key' => base64_encode(random_bytes(32)), 'db_path' => $directory . '/genesis.sqlite',
    'session_path' => $directory . '/sessions', 'cookie_secure' => false, 'timezone' => 'Europe/Moscow',
    'admin_email' => 'no-admin-' . $runId . '@example.invalid',
    'notifications' => ['email' => ['transport' => 'disabled']], 'billing' => ['enabled' => false],
];
file_put_contents($directory . '/config.php', '<?php return ' . var_export($config, true) . ';', LOCK_EX);
file_put_contents($directory . '/owner.json', json_encode(['runId' => $runId, 'directory' => $directory,
    'configSha256' => hash_file('sha256', $directory . '/config.php'), 'origin' => $origin,
    'synthetic' => true], JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR), LOCK_EX);
define('GENESIS_LOCAL_TEST_CONFIG', $directory . '/config.php');
require dirname(__DIR__, 2) . '/server/src/bootstrap.php';
require dirname(__DIR__, 2) . '/server/src/repository.php';
$users = [];
$fixturePlans = array_combine(['free', 'standart', 'premium', 'business', 'premium4life', 'outsider'], ['free', 'standart', 'premium', 'business', 'premium4life', 'free']);
foreach (['trial-standart','trial-premium','trial-business','trial-soon','trial-expired','trial-invalid'] as $fixture) $fixturePlans[$fixture]='free';
$fixturePlans['trial-paid']='standart';
foreach ($fixturePlans as $tier => $plan) {
    $id = 'qa-' . $runId . '-' . $tier;
    $expiry = in_array($plan, ['standart', 'premium', 'business'], true) ? '2035-01-01T00:00:00Z' : null;
    genesisDb()->prepare('INSERT INTO users(id,google_sub,email,display_name,auth_provider,subscription_plan,subscription_valid_until,shared_projects_enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
        ->execute([$id, 'synthetic-' . $id, $id . '@example.invalid', 'QA ' . ucfirst($tier), 'google', $plan, $expiry, 1, genesisNow(), genesisNow()]);
    $user = genesisEnsureWorkspaceKey(genesisFindUser($id));
    if (genesisIsAdminUser($user) || genesisSharedTester($user)) throw new RuntimeException('Ordinary tariff fixture acquired elevated role');
    $users[$tier] = ['id' => $id, 'plan' => $plan, 'role' => 'ordinary-user', 'validUntil' => $expiry,
        'loginPath' => '/api/qa/login?tier=' . $tier];
}
session_write_close();
file_put_contents($directory . '/users.json', json_encode(['runId' => $runId, 'users' => $users], JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR), LOCK_EX);
echo json_encode(['status' => 'READY', 'runId' => $runId, 'directory' => $directory, 'usersPath' => $directory . '/users.json',
    'origin' => $origin, 'externalDelivery' => 'disabled', 'adminUsers' => 0], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
