<?php
declare(strict_types=1);

// This integration test may only run against the explicitly isolated local fixture.
if (getenv('GENESIS_IMPROVEMENTS_TEST') !== 'isolated') {
    throw new RuntimeException('Isolated fixture required.');
}
require dirname(__DIR__) . '/src/bootstrap.php';
require dirname(__DIR__) . '/src/repository.php';
$config = genesisConfig();
if (($config['app_url'] ?? '') !== 'http://127.0.0.1:4338'
    || basename((string)($config['db_path'] ?? '')) !== 'improvements-test.sqlite') {
    throw new RuntimeException('Isolated fixture required.');
}
$db = genesisDb();

if (($argv[1] ?? '') === '--worker') {
    $userId = $argv[2] ?? '';
    if (!preg_match('/^test-layout-race-[a-f0-9]{16}$/D', $userId)) throw new RuntimeException('Invalid test user.');
    $patch = json_decode($argv[3] ?? '', true, 8, JSON_THROW_ON_ERROR);
    echo "ready\n"; flush();
    if (trim((string)fgets(STDIN)) !== 'go') throw new RuntimeException('Missing barrier.');
    echo "attempt\n"; flush();
    genesisUpdateAccountPreferences($userId, ['uiLayout' => $patch]);
    echo "saved\n";
    exit;
}

$userId = 'test-layout-race-' . bin2hex(random_bytes(8));
$workers = [];
try {
    $now = genesisNow();
    $db->prepare('INSERT INTO users (id, google_sub, email, display_name, workspace_key_enc, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        ->execute([$userId, $userId, $userId . '@example.invalid', 'Isolated layout race', genesisEncrypt(base64_encode(random_bytes(32))), $now, $now]);
    foreach ([['sharedProjectViewOrder' => ['board', 'gantt', 'list', 'calendar']], ['personalInboxWidth' => 512], ['sharedCalendarScale' => 0.25]] as $patch) {
        $pipes = [];
        $process = proc_open([PHP_BINARY, __FILE__, '--worker', $userId, json_encode($patch, JSON_THROW_ON_ERROR)],
            [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        if (!is_resource($process)) throw new RuntimeException('Worker startup failed.');
        foreach ([$pipes[1], $pipes[2]] as $pipe) stream_set_timeout($pipe, 10);
        $workers[] = ['process' => $process, 'pipes' => $pipes];
        if (trim((string)fgets($pipes[1])) !== 'ready') throw new RuntimeException('Worker did not reach barrier.');
    }
    genesisBeginWriteTransaction($db);
    foreach ($workers as $worker) { fwrite($worker['pipes'][0], "go\n"); fflush($worker['pipes'][0]); }
    foreach ($workers as $worker) {
        if (trim((string)fgets($worker['pipes'][1])) !== 'attempt') throw new RuntimeException('Worker did not attempt update.');
    }
    usleep(200000); // Both writers must wait before reading and merging account preferences.
    $db->commit();
    foreach ($workers as &$worker) {
        fclose($worker['pipes'][0]);
        $result = trim(stream_get_contents($worker['pipes'][1]));
        $error = trim(stream_get_contents($worker['pipes'][2]));
        fclose($worker['pipes'][1]); fclose($worker['pipes'][2]);
        $exit = proc_close($worker['process']); $worker['process'] = null; $worker['pipes'] = [];
        if ($exit !== 0 || $result !== 'saved' || $error !== '') throw new RuntimeException('Concurrent layout worker failed.');
    }
    unset($worker);
    $saved = genesisUiVisibility(genesisFindUser($userId)['ui_visibility_json']);
    if ($saved['sharedProjectViewOrder'] !== ['board', 'gantt', 'list', 'calendar'] || $saved['personalInboxWidth'] !== 512 || $saved['sharedCalendarScale'] !== 0.25) {
        throw new RuntimeException('Independent concurrent layout patches lost data.');
    }
    echo "Concurrent account layout patches preserved all three values.\n";
} finally {
    if ($db->inTransaction()) $db->rollBack();
    foreach ($workers as $worker) {
        if (is_resource($worker['process'])) proc_terminate($worker['process']);
        foreach ($worker['pipes'] as $pipe) if (is_resource($pipe)) fclose($pipe);
        if (is_resource($worker['process'])) proc_close($worker['process']);
    }
    $db->prepare('DELETE FROM users WHERE id = ?')->execute([$userId]);
}
