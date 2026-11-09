<?php
declare(strict_types=1);

// Developer-only synthetic runtime. Never replaces an existing configuration.
if (PHP_SAPI !== 'cli' || getenv('GENESIS_IMPROVEMENTS_TEST') !== 'isolated') throw new RuntimeException('Explicit isolated CLI required');
$root = dirname(__DIR__, 2);
$suite = getenv('GENESIS_ACCEPTANCE_SUITE') ?: 'c-suite';
if (!in_array($suite, ['c-suite', 'efg-suite', 'kul-suite', 'audit-suite', 'audit-ui-suite'], true)) throw new RuntimeException('Unknown isolated suite');
$runtime = $root . '/output/' . $suite . '/https';
$path = $root . '/server/config.php';
if (($argv[1] ?? '') === 'cleanup') {
    $expected = is_file($runtime . '/config-sha256.txt') ? trim(file_get_contents($runtime . '/config-sha256.txt')) : '';
    if (!is_file($path) || $expected === '' || !hash_equals($expected, hash_file('sha256', $path))) throw new RuntimeException('Owned fixture configuration not confirmed');
    $config = require $path;
    $expectedDatabase = realpath($runtime . '/fixture.sqlite');
    if ($expectedDatabase === false || realpath($config['db_path'] ?? '') !== $expectedDatabase || ($config['app_url'] ?? '') !== 'http://127.0.0.1:4338') throw new RuntimeException('Wrong runtime');
    if (!unlink($path)) throw new RuntimeException('Could not remove fixture configuration');
    echo "Owned synthetic configuration removed.\n";
    exit;
}
if (is_file($path) || is_file($runtime . '/fixture.sqlite')) throw new RuntimeException('Existing runtime must not be replaced');
if (!is_dir($runtime) && !mkdir($runtime, 0700, true)) throw new RuntimeException('Cannot create fixture directory');
$config = ['app_url' => 'http://127.0.0.1:4338', 'google_only' => true, 'google_client_id' => '', 'google_client_secret' => '',
    'gigachat_enabled' => false, 'gemini_enabled' => false, 'crypto_key' => base64_encode(random_bytes(32)),
    'db_path' => $runtime . '/fixture.sqlite', 'session_path' => $runtime . '/sessions', 'cookie_secure' => false,
    'timezone' => 'Europe/Moscow', 'admin_email' => 'improvements-editor@example.invalid'];
$file = fopen($path, 'x');
if ($file === false) throw new RuntimeException('Existing configuration must not be replaced');
try { if (fwrite($file, '<?php return ' . var_export($config, true) . ';') === false) throw new RuntimeException('Cannot initialize runtime'); }
finally { fclose($file); }
chmod($path, 0600);
file_put_contents($runtime . '/config-sha256.txt', hash_file('sha256', $path), LOCK_EX);
foreach (['bootstrap', 'repository', 'google', 'shared-projects'] as $module) require_once $root . '/server/src/' . $module . '.php';
foreach (['editor', 'viewer'] as $actor) {
    $user = genesisUpsertGoogleUser(['email_verified' => true, 'sub' => 'c-suite-' . $actor,
        'email' => 'improvements-' . $actor . '@example.invalid', 'name' => 'Synthetic ' . $actor], [], false);
    genesisUpdateAccountPreferences($user['id'], ['sharedProjectsEnabled' => true]);
}
echo "Isolated C-suite runtime initialized. External credentials and delivery are disabled.\n";
