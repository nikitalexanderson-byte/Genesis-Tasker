<?php
declare(strict_types=1);

// Creates synthetic local browser state only; existing server/config.php is never read.
if (PHP_SAPI !== 'cli') exit(1);
$directory = str_replace('\\', '/', dirname(__DIR__, 2)) . '/output/physis-browser/genesis-physis-test-browser';
if (!is_dir($directory) && !mkdir($directory, 0700, true)) throw new RuntimeException('Cannot create local fixture.');
$marker = $directory . '/synthetic-fixture.txt';
if (is_file($directory . '/config.php') && !is_file($marker)) throw new RuntimeException('Refusing to overwrite an unmarked existing configuration.');
if (!is_file($directory . '/config.php')) {
    $config = ['app_url' => 'https://localhost.invalid', 'google_only' => true, 'physis_enabled' => true,
        'db_path' => $directory . '/genesis.sqlite', 'session_path' => $directory . '/sessions',
        'crypto_key' => base64_encode(random_bytes(32)), 'cookie_secure' => false, 'timezone' => 'Europe/Moscow'];
    file_put_contents($directory . '/config.php', '<?php return ' . var_export($config, true) . ';');
    file_put_contents($marker, "Only synthetic Physis browser fixture data. No production credentials or user data.\n");
}
define('GENESIS_LOCAL_TEST_CONFIG', $directory . '/config.php');
require dirname(__DIR__) . '/src/bootstrap.php';
require dirname(__DIR__) . '/src/repository.php';
foreach (['a' => 'nikitalexanderson@gmail.com', 'b' => 'jurijjlogvinov@gmail.com', 'c' => 'picishina@gmail.com'] as $suffix => $email) {
    genesisDb()->prepare('INSERT OR IGNORE INTO users(id,google_sub,email,display_name,created_at,updated_at) VALUES(:id,:sub,:email,:name,:now,:now)')
        ->execute(['id' => genesisUuid(), 'sub' => 'synthetic-physis-browser-' . $suffix,
            'email' => $email, 'name' => 'Synthetic Physis browser ' . strtoupper($suffix), 'now' => genesisNow()]);
    genesisDb()->prepare("UPDATE users SET subscription_plan='premium4life' WHERE google_sub=:sub")
        ->execute(['sub' => 'synthetic-physis-browser-' . $suffix]);
}
echo "Synthetic fixture ready: " . $directory . "\n";
echo "CLI-server environment: GENESIS_PHYSIS_TEST_DIR=<above path>, GENESIS_PHYSIS_BROWSER_FIXTURE=1\n";
echo "Login via the web dev proxy: /api/physis-test/login (other owners: ?owner=b or ?owner=c); then use the real /api/session and /api/physis/v1 endpoints.\n";
