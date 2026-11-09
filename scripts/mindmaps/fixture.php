<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli' || getenv('GENESIS_MINDMAPS_TEST') !== 'isolated') {
    if (PHP_SAPI === 'cli') fwrite(STDERR, "Explicit isolated CLI environment required.\n");
    exit(1);
}
$root = dirname(__DIR__, 2);
$out = $root . '/output';
if (!is_dir($out)) mkdir($out, 0700, true);
$dbPath = $out . '/mindmaps-test.sqlite';
if (!is_file($root . '/server/config.php')) {
    $config = ['app_url'=>'http://127.0.0.1:4319','google_only'=>true,'crypto_key'=>base64_encode(random_bytes(32)),
        'db_path'=>$dbPath,'session_path'=>$out.'/sessions','cookie_secure'=>false,'timezone'=>'Europe/Moscow','admin_email'=>'nobody@example.invalid'];
    file_put_contents($root.'/server/config.php', '<?php return '.var_export($config,true).';');
}
require $root.'/server/src/bootstrap.php';
// Refuse an existing configuration for any database outside this exact fixture.
if (str_replace('\\','/',(string)genesisConfig()['db_path']) !== str_replace('\\','/',$dbPath)
    || genesisConfig()['app_url'] !== 'http://127.0.0.1:4319') throw new RuntimeException('Refusing non-fixture configuration.');
foreach (['repository','google','local-accounts','yandex','yandex-calendar','shared-projects'] as $module) require $root.'/server/src/'.$module.'.php';
$suffix = ($argv[1] ?? 'a') === 'b' ? 'b' : 'a';
$user = genesisUpsertGoogleUser(['email_verified'=>true,'sub'=>'mindmaps-test-'.$suffix,
    'email'=>'mindmaps-'.$suffix.'@example.invalid','name'=>'Личный пилот'],[],false);
genesisEstablishGoogleSession($user, $user['google_sub']);
file_put_contents($out.'/browser-session'.($suffix==='b'?'-b':'').'.json',json_encode(['userId'=>$user['id'],'session'=>session_id()]));
echo "Isolated fixture session prepared. No Google tokens or OAuth call.\n";
