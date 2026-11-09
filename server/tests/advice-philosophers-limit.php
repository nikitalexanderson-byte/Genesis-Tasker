<?php
declare(strict_types=1);
require dirname(__DIR__) . '/src/bootstrap.php';
require dirname(__DIR__) . '/src/repository.php';
require dirname(__DIR__) . '/src/google.php';
require dirname(__DIR__) . '/src/shared-projects.php';

function philosopherLimitExpect(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}

// Verify the production migration against populated legacy rows and a consistent backup.
$legacy = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$legacy->exec('PRAGMA foreign_keys=ON');
$migration = dirname(__DIR__) . '/migrations/109_advice_philosophers_daily_limit.sql';
foreach (glob(dirname(__DIR__) . '/migrations/*.sql') as $file) {
    if (strcmp(basename($file), basename($migration)) < 0) $legacy->exec(file_get_contents($file));
}
$legacy->exec("INSERT INTO users(id,google_sub,email,created_at,updated_at) VALUES ('legacy','legacy','legacy@example.invalid','now','now')");
$insert = $legacy->prepare('INSERT INTO daily_advice_entries(user_id,day_key,slot,advice_id,entry_json,created_at,viewed_at,dismissed_at) VALUES (?,?,?,?,?,?,?,?)');
for ($slot = 1; $slot <= 6; $slot++) $insert->execute(['legacy','2026-11-04',$slot,'advice-'.$slot,'{"collection":"aurora"}','created','viewed',$slot === 2 ? 'dismissed' : null]);
$before = $legacy->query('SELECT * FROM daily_advice_entries ORDER BY slot')->fetchAll(PDO::FETCH_ASSOC);
$backupPath = tempnam(sys_get_temp_dir(), 'genesis-advice-109-');
try {
    $legacy->exec('VACUUM INTO ' . $legacy->quote($backupPath));
    $legacy->beginTransaction(); $legacy->exec(file_get_contents($migration)); $legacy->commit();
    philosopherLimitExpect($before === $legacy->query('SELECT * FROM daily_advice_entries ORDER BY slot')->fetchAll(PDO::FETCH_ASSOC), 'Migration changed immutable snapshots or view/dismissal receipts');
    philosopherLimitExpect((int)$legacy->query("SELECT advice_philosophers_per_day FROM users WHERE id='legacy'")->fetchColumn() === 1, 'Legacy account did not default to one aphorism');
    for ($slot = 7; $slot <= 9; $slot++) $legacy->prepare('INSERT INTO daily_advice_extra_entries(user_id,day_key,slot,advice_id,entry_json,created_at) VALUES (?,?,?,?,?,?)')->execute(['legacy','2026-11-04',$slot,'advice-'.$slot,'{}','now']);
    $rejected = false;
    try { $legacy->exec("INSERT INTO daily_advice_extra_entries VALUES ('legacy','2026-11-04',10,'overflow','{}','now',NULL,NULL)"); }
    catch (PDOException) { $rejected = true; }
    philosopherLimitExpect($rejected, 'Migration allowed a tenth daily slot');
    philosopherLimitExpect($before === $legacy->query('SELECT * FROM daily_advice_entries ORDER BY slot')->fetchAll(PDO::FETCH_ASSOC)
        && (int)$legacy->query('SELECT COUNT(*) FROM daily_advice_all_entries')->fetchColumn() === 9, 'New slots changed the table read by previous code');
    philosopherLimitExpect($legacy->query('PRAGMA integrity_check')->fetchColumn() === 'ok' && $legacy->query('PRAGMA foreign_key_check')->fetchAll() === [], 'Migrated database failed integrity checks');
    $backup = new PDO('sqlite:' . $backupPath);
    philosopherLimitExpect($backup->query('PRAGMA integrity_check')->fetchColumn() === 'ok' && (int)$backup->query('SELECT COUNT(*) FROM daily_advice_entries')->fetchColumn() === 6, 'Backup did not retain the complete legacy history');
    philosopherLimitExpect(!in_array('advice_philosophers_per_day', array_column($backup->query('PRAGMA table_info(users)')->fetchAll(PDO::FETCH_ASSOC),'name'), true), 'Backup contains post-migration schema');
} finally { $backup = null; if (is_file($backupPath)) unlink($backupPath); }

philosopherLimitExpect(genesisAdvicePreferences([])['philosophersPerDay'] === 1, 'Wrong default count');
foreach ([0,4,-1,1.5,true,'2'] as $invalid) {
    $rejected = false;
    try { genesisAdvicePreferences(['philosophersPerDay' => $invalid]); } catch (InvalidArgumentException) { $rejected = true; }
    philosopherLimitExpect($rejected, 'Invalid aphorism count accepted');
}
foreach ([0,7,10,'9.5',true] as $invalid) {
    $rejected = false;
    try { genesisAdviceClientCapacity($invalid); } catch (InvalidArgumentException) { $rejected = true; }
    philosopherLimitExpect($rejected, 'Invalid client capacity accepted');
}
$db = genesisDb(); $users = [];
$artworkIds = array_keys(genesisPhilosopherArtwork());
philosopherLimitExpect(count($artworkIds) >= 8, 'Illustrated aphorism fixture unavailable');
$pool = [];
for ($index = 0; $index < 8; $index++) {
    $base = ['body'=>'Synthetic daily quota fixture '.$index,'language'=>'en','sources'=>[]];
    $pool[] = $base + ['id'=>'advice-'.substr(hash('sha256','aurora-320-'.$index),0,24),'categories'=>['aretology'],'collection'=>'aurora'];
    $pool[] = $base + ['id'=>$artworkIds[$index],'categories'=>[],'collection'=>'philosophers'];
}
try {
    foreach ([1,2,3] as $count) {
        $id = 'advice-320-'.bin2hex(random_bytes(8)); $users[] = $id;
        $db->prepare("INSERT INTO users(id,google_sub,email,created_at,updated_at,subscription_plan) VALUES (?,?,?,?,?,'premium4life')")->execute([$id,$id,$id.'@example.invalid',genesisNow(),genesisNow()]);
        genesisUpdateAccountPreferences($id, ['language'=>'en','advicePreferences'=>['smart'=>false,'categories'=>['aretology'],'collections'=>['aurora','philosophers'],'philosophersPerDay'=>$count]]);
        philosopherLimitExpect(genesisUserAdvicePreferences(genesisFindUser($id))['philosophersPerDay'] === $count, 'Count did not survive account preferences');
        philosopherLimitExpect(!array_key_exists('philosophersPerDay', json_decode(genesisFindUser($id)['advice_preferences_json'],true)), 'New count leaked into strict legacy JSON');
        $response = genesisDailyAdvice($id, ['maxDailyCards'=>9], $pool);
        // A saved six-category Aurora day retains its frozen six-advice allowance.
        $db->prepare('UPDATE daily_advice_days SET draw_limit=6 WHERE user_id=?')->execute([$id]);
        $response = genesisDailyAdvice($id, ['maxDailyCards'=>9], $pool);
        while ($response['canNext']) $response = genesisDailyAdvice($id, ['maxDailyCards'=>9,'fromId'=>$response['advice']['id'],'dayKey'=>$response['dayKey']],$pool,true);
        $sources = array_count_values(array_column($response['history'],'collection'));
        philosopherLimitExpect(($sources['aurora']??0) === 6 && ($sources['philosophers']??0) === $count && $response['sequence'] === 6+$count && $response['dailyLimit'] === 6+$count && $response['remaining'] === 0, 'Aphorisms displaced Aurora advice or exceeded their own quota');
        $ids = array_column($response['history'],'id');
        $legacyPointer = $db->query('SELECT advice_id FROM daily_advice_days WHERE user_id='.$db->quote($id))->fetchColumn();
        $legacyIds = $db->query('SELECT advice_id FROM daily_advice_entries WHERE user_id='.$db->quote($id).' ORDER BY slot')->fetchAll(PDO::FETCH_COLUMN);
        philosopherLimitExpect(count($legacyIds) === 6 && $legacyPointer === $legacyIds[5], 'Code rollback would expose an extra slot through the legacy pointer');
        philosopherLimitExpect(count(array_unique($ids)) === 6+$count, 'The same aphorism was drawn twice');
        $replay = genesisDailyAdvice($id,['maxDailyCards'=>9,'fromId'=>$response['advice']['id'],'dayKey'=>$response['dayKey']],$pool,true);
        philosopherLimitExpect(array_column($replay['history'],'id') === $ids && !$replay['canNext'], 'Retry reset the spent allowance');
        $legacyResponse = genesisDailyAdvice($id, [], $pool);
        philosopherLimitExpect($legacyResponse['sequence'] === 6 && $legacyResponse['dailyLimit'] === 6 && !$legacyResponse['canNext'] && count($legacyResponse['history']) === 6 && in_array($legacyResponse['advice']['id'],array_column($legacyResponse['history'],'id'),true), 'Legacy client received an undecodable ninth slot');
        foreach ($legacyResponse['history'] as $card) philosopherLimitExpect($card['sequence'] <= 6, 'Legacy response renumbered slots');
        $last = $response['history'][array_key_last($response['history'])];
        $target = ['id'=>$last['id'],'dayKey'=>$response['dayKey'],'collection'=>$last['collection']];
        philosopherLimitExpect(genesisSavedAdvice($id,$target,9)['advice']['id'] === $last['id'] && genesisSavedAdvice($id,$target,6)['advice'] === null, 'Saved-card compatibility changed the stored slot');
        genesisUpdateAccountPreferences($id,['advicePreferences'=>['collections'=>['philosophers']]]);
        genesisUpdateAccountPreferences($id,['advicePreferences'=>['collections'=>['aurora','philosophers']]]);
        $restored = genesisDailyAdvice($id,['maxDailyCards'=>9],$pool);
        philosopherLimitExpect(array_column($restored['history'],'id') === $ids && !$restored['canNext'], 'Switching collections refunded consumed slots');
    }
    echo "Aphorism allowance: default 1, configurable 1–3, six Aurora advice plus additional aphorisms, replay/no-reset/account counters, old-client projection, saved targets and migration backup/integrity passed.\n";
} finally { foreach ($users as $id) $db->prepare('DELETE FROM users WHERE id=?')->execute([$id]); }
