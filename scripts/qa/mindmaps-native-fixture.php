<?php
declare(strict_types=1);

// Native HTTP contracts use one ordinary paid account/session per device in a fresh QA runtime.
// Example: --dir=<fresh-path> --origin=http://127.0.0.1:4341 --run-id=<run-id>
//          --devices=samsung-physical,emulator-5580,emulator-5582
// The session-bearing output files are temporary inputs, never publishable test artifacts.
if (PHP_SAPI !== 'cli') throw new RuntimeException('CLI fixture required');
$nativeOptions = getopt('', ['dir:', 'origin:', 'run-id:', 'devices:']);
if (($nativeOptions['origin'] ?? '') !== 'http://127.0.0.1:4341') throw new RuntimeException('Native mindmaps require loopback port 4341');
$deviceKeys = explode(',', (string)($nativeOptions['devices'] ?? ''));
if (count($deviceKeys) > 12 || count(array_unique($deviceKeys)) !== count($deviceKeys)) throw new RuntimeException('Distinct device labels required');
foreach ($deviceKeys as $deviceKey) {
    if (!preg_match('/\A[a-z0-9][a-z0-9-]{0,39}\z/D', $deviceKey)) throw new RuntimeException('Safe explicit device labels required');
}

ob_start();
try { require __DIR__ . '/backend-fixture.php'; } finally { ob_end_clean(); }
if (genesisConfig()['db_path'] !== $directory . '/genesis.sqlite'
    || genesisConfig()['session_path'] !== $directory . '/sessions'
    || genesisConfig()['app_url'] !== $origin) throw new RuntimeException('Fixture isolation mismatch');

function mindmapsNativeWrite(string $path, array $value): void
{
    $file = fopen($path, 'x');
    if ($file === false) throw new RuntimeException('Refusing existing fixture target');
    try {
        $json = json_encode($value, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
        if (fwrite($file, $json) !== strlen($json)) throw new RuntimeException('Cannot write fixture target');
    } finally { fclose($file); }
    @chmod($path, 0600);
}

$outputDirectory = $directory . '/output';
if (!mkdir($outputDirectory, 0700)) throw new RuntimeException('Cannot create fixture output directory');
$db = genesisDb(); $devices = []; $sessions = []; $workspaceKeys = [];
foreach ($deviceKeys as $deviceKey) {
    $id = genesisUuid();
    $email = 'mindmaps-' . substr(hash('sha256', $runId), 0, 12) . '-' . $deviceKey . '@example.invalid';
    $db->prepare('INSERT INTO users(id,google_sub,email,display_name,auth_provider,subscription_plan,subscription_valid_until,shared_projects_enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
        ->execute([$id, 'synthetic-mindmaps-' . $id, $email, 'Native QA ' . $deviceKey,
            'google', 'premium', '2035-01-01T00:00:00Z', 0, genesisNow(), genesisNow()]);
    $user = genesisEnsureWorkspaceKey(genesisFindUser($id));
    $access = genesisFeatureAccessForUser($user);
    if (genesisIsAdminUser($user) || genesisSharedTester($user)
        || $access['declaredPlan'] !== 'premium' || $access['effectivePlan'] !== 'premium'
        || !$access['enforcementEnabled'] || ($access['limits']['mindmaps'] ?? null) !== 100
        || !in_array('data-export', $access['allowedFeatures'], true)) throw new RuntimeException('Ordinary paid Premium entitlement required');
    $workspaceKey = genesisDecrypt((string)$user['workspace_key_enc']);
    if (strlen((string)base64_decode($workspaceKey, true)) !== 32 || in_array($workspaceKey, $workspaceKeys, true)) throw new RuntimeException('Independent workspace keys required');
    $workspaceKeys[] = $workspaceKey;

    // A fresh PHP session is persisted only in the marked runtime, never in server/var.
    session_id('');
    genesisStartSession();
    $_SESSION = [];
    genesisEstablishGoogleSession($user, $user['google_sub'], ['sub' => $user['google_sub'], 'email' => $email, 'email_verified' => true], 'native');
    $session = session_id();
    if (!preg_match('/\A[A-Za-z0-9,-]{16,128}\z/D', $session) || in_array($session, $sessions, true)
        || genesisCurrentUserId() !== $id) throw new RuntimeException('Independent authenticated sessions required');
    if (!session_write_close() || !is_file($directory . '/sessions/sess_' . $session)) throw new RuntimeException('Cannot persist native session');
    $sessions[] = $session;

    $path = $outputDirectory . '/' . $deviceKey . '.json';
    $fixture = ['schemaVersion' => 1, 'synthetic' => true, 'runId' => $runId, 'deviceKey' => $deviceKey,
        'origin' => $origin, 'userId' => $id, 'email' => $email, 'expectedPlan' => 'premium', 'session' => $session];
    mindmapsNativeWrite($path, $fixture);
    $devices[] = ['deviceKey' => $deviceKey, 'fixturePath' => $path, 'userId' => $id,
        'email' => $email, 'plan' => 'premium', 'role' => 'ordinary-user'];
}
mindmapsNativeWrite($directory . '/mindmaps-native.json', ['synthetic' => true, 'runId' => $runId, 'origin' => $origin, 'devices' => $devices]);
echo json_encode(['status' => 'READY', 'runId' => $runId, 'directory' => $directory,
    'origin' => $origin, 'outputDirectory' => $outputDirectory, 'deviceCount' => count($devices),
    'devices' => $devices, 'externalDelivery' => 'disabled', 'adminUsers' => 0,
    'sessionFilesArePrivateInputs' => true], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
