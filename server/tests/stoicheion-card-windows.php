<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') exit(1);
function cardCheck(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
function cardReject(callable $run, string $code): void {
    try { $run(); } catch (DomainException | InvalidArgumentException $e) { cardCheck($e->getMessage() === $code, $e->getMessage() . ' != ' . $code); return; }
    throw new RuntimeException('Accepted: ' . $code);
}
$worker = ($argv[1] ?? '') === '--worker';
if ($worker) $configPath = $argv[2];
else {
    $fixture = sys_get_temp_dir() . '/genesis-card-windows-' . bin2hex(random_bytes(8));
    mkdir($fixture, 0700); mkdir($fixture . '/sessions', 0700);
    $configPath = $fixture . '/config.php';
    file_put_contents($configPath, '<?php return ' . var_export(['app_url'=>'https://localhost.invalid','db_path'=>$fixture.'/app.sqlite',
        'session_path'=>$fixture.'/sessions','crypto_key'=>base64_encode(random_bytes(32)),'cookie_secure'=>false,'timezone'=>'Europe/Moscow'], true) . ';');
}
define('GENESIS_LOCAL_TEST_CONFIG', $configPath);
require __DIR__ . '/../src/bootstrap.php'; require __DIR__ . '/../src/repository.php';
if ($worker) {
    try { genesisChangeTimelineCard('race', ['position'=>0,'action'=>'reroll','revision'=>1]); echo 'accepted'; }
    catch (DomainException $e) { echo $e->getMessage(); }
    exit;
}
$db = genesisDb(); $now = genesisNow();
foreach (['alice','bob','legacy','used','expired','disabled','race'] as $id) $db->prepare('INSERT INTO users(id,google_sub,email,created_at,updated_at) VALUES(?,?,?,?,?)')->execute([$id,$id,$id.'@example.invalid',$now,$now]);
cardCheck(genesisTimelineCards(0x12345678) === [['letter'=>11,'reversed'=>false],['letter'=>9,'reversed'=>true],['letter'=>2,'reversed'=>false]], 'JS uint32 parity');
cardCheck(array_column(genesisTimelineCards(0xffffffff),'letter') === [20,5,1], 'Unsigned maximum parity');
cardCheck(genesisLoadTimelineCards('alice')['timeline'] === null, 'Reading consumed a weekly deal');
$action = fn($user,$position,$action,$revision) => genesisChangeTimelineCard($user, compact('position','action','revision'))['timeline'];
cardReject(fn()=>$action('alice',1,'reveal',0),'TIMELINE_ORDER');
cardReject(fn()=>genesisChangeTimelineCard('alice',['position'=>0,'action'=>'reveal','revision'=>0,'seed'=>1]),'TIMELINE_REQUEST_INVALID');
cardReject(fn()=>genesisChangeTimelineCard('alice',['position'=>'0','action'=>'reveal','revision'=>0]),'TIMELINE_REQUEST_INVALID');
$first = $action('alice',0,'reveal',0);
cardCheck(count($first['cards'])===1 && $first['cards'][0]['remainingSeconds']===180,'First independent window');
cardCheck($action('alice',0,'reveal',0)===$first,'First reveal replay extended/reset the timer');
$second = $action('alice',1,'reveal',1);
cardCheck(count($second['cards'])===2 && $second['cards'][0]===$first['cards'][0], 'Next reveal waited for reroll or changed an earlier timer');
$third = $action('alice',2,'reveal',2);
$original = genesisTimelineCards($third['seed']);
$redrawn = $action('alice',0,'reroll',3); $cards = genesisTimelineCards($redrawn['seed']);
cardCheck($cards[0]['letter']!==$original[0]['letter'] && $cards[1]===$original[1] && $cards[2]===$original[2],'Reroll changed another card or repeated the letter');
cardCheck($redrawn['cards'][0]['rerolled'] && $redrawn['cards'][1]['canReroll'] && $redrawn['cards'][2]['canReroll'],'Independent attempts');
cardCheck($redrawn['cards'][0]['rerollDeadline']===$first['cards'][0]['rerollDeadline'],'Reroll extended its deadline');
cardReject(fn()=>$action('alice',0,'reroll',4),'TIMELINE_REROLL_USED');
cardReject(fn()=>$action('alice',1,'reroll',3),'TIMELINE_STALE');
$action('alice',1,'reroll',4); $final=$action('alice',2,'reroll',5);
cardCheck(array_column($final['cards'],'rerolled')===[true,true,true],'Three separate rerolls');
cardReject(fn()=>genesisSaveStoicheionDraw('alice','timeline',42),'TIMELINE_CARD_PROTOCOL_REQUIRED');
cardCheck(genesisLoadTimelineCards('bob')['timeline']===null,'Owner isolation');
cardCheck(genesisStoicheionDraws('alice')['draws']['timeline']['seed']===$final['seed'],'Existing native reader lost seed compatibility');
$period = genesisTimelinePeriod(); $_SERVER['HTTP_X_GENESIS_TIME_ZONE']='Pacific/Kiritimati';
cardCheck(genesisTimelinePeriod()===$period,'Client zone changed the authoritative week'); unset($_SERVER['HTTP_X_GENESIS_TIME_ZONE']);
$exp=$action('expired',0,'reveal',0);
$db->prepare('UPDATE stoicheion_timeline_card_windows SET first_revealed_at=? WHERE user_id=?')->execute([gmdate('Y-m-d\TH:i:s\Z',time()-180),'expired']);
cardReject(fn()=>$action('expired',0,'reroll',1),'TIMELINE_REROLL_EXPIRED');
$late=$action('expired',1,'reveal',1);
cardCheck(!$late['cards'][0]['canReroll'] && $late['cards'][1]['remainingSeconds']===180,'Earlier expiration blocked the next independent opening');
$old=gmdate('Y-m-d\TH:i:s\Z',time()-86400);
$db->prepare("INSERT INTO stoicheion_timeline_draws VALUES(?,?,'timeline',?,1,?,?)")->execute(['legacy',$period[1],42,$old,$old]);
$import=genesisLoadTimelineCards('legacy')['timeline'];
cardCheck($import['seed']===42 && count($import['cards'])===3 && !array_filter($import['cards'],fn($c)=>$c['canReroll']),'Existing deal was reset or granted fresh windows');
genesisSaveStoicheionDraw('used','timeline',1); genesisSaveStoicheionDraw('used','timeline',2);
cardCheck(array_column(genesisLoadTimelineCards('used')['timeline']['cards'],'rerolled')===[true,true,true],'Legacy used reroll was reset');
$db->exec("UPDATE users SET stoicheion_divination_disabled=1 WHERE id='disabled'");
cardReject(fn()=>$action('disabled',0,'reveal',0),'TIMELINE_DISABLED');
$action('race',0,'reveal',0);
$processes=[];
for($i=0;$i<2;$i++) { $pipes=[]; $process=proc_open([PHP_BINARY,__FILE__,'--worker',$configPath],[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes); cardCheck(is_resource($process),'Race worker startup'); fclose($pipes[0]); $processes[]=[$process,$pipes]; }
$results=[];
foreach($processes as [$process,$pipes]) { $results[]=stream_get_contents($pipes[1]); $stderr=stream_get_contents($pipes[2]); fclose($pipes[1]);fclose($pipes[2]);cardCheck(proc_close($process)===0,$stderr); }
sort($results); cardCheck($results===['TIMELINE_STALE','accepted'],'Concurrent requests spent more than one attempt: '.json_encode($results));
$bob = $action('bob',0,'reveal',0);
$previousWeek = gmdate('Y-m-d', strtotime($bob['periodKey'].' -7 days'));
// Move only this synthetic fixture into the previous week, retaining its window.
$db->prepare('INSERT INTO stoicheion_timeline_sessions SELECT user_id,?,?,seed_value,revision,created_at,updated_at FROM stoicheion_timeline_sessions WHERE user_id=?')->execute([$previousWeek,$previousWeek,'bob']);
$db->prepare('INSERT INTO stoicheion_timeline_card_windows SELECT user_id,?,position,first_revealed_at,rerolled_at FROM stoicheion_timeline_card_windows WHERE user_id=?')->execute([$previousWeek,'bob']);
$db->prepare('DELETE FROM stoicheion_timeline_sessions WHERE user_id=? AND period_key=?')->execute(['bob',$bob['periodKey']]);
$db->prepare('UPDATE stoicheion_timeline_draws SET day_key=? WHERE user_id=?')->execute([$previousWeek,'bob']);
cardCheck(genesisLoadTimelineCards('bob')['timeline'] === null, 'Prior week consumed the new weekly deal');
$freshWeek = $action('bob',0,'reveal',0);
cardCheck($freshWeek['revision']===1 && count($freshWeek['cards'])===1 && $freshWeek['cards'][0]['remainingSeconds']===180, 'New week did not get an isolated deal/window');
cardCheck((int)$db->query("SELECT COUNT(*) FROM stoicheion_timeline_sessions WHERE user_id='bob'")->fetchColumn()===2,'Weekly rollover discarded historical data');
$purged=genesisDeleteAccountRows('alice');
cardCheck($purged['stoicheion_timeline_card_windows']===3 && $purged['stoicheion_timeline_sessions']===1,'Account deletion omitted private windows');
cardCheck($db->query('PRAGMA foreign_key_check')->fetchAll()===[],'Broken foreign keys');
echo "Per-card windows PASS: sequence, isolated clocks/attempts, exact expiry, server randomness, unchanged other cards, legacy preservation/native parity, tamper/old endpoint rejection, concurrent writes, owner isolation and deletion.\n";
