<?php
declare(strict_types=1);

// Synthetic CLI fixture only. No application configuration or production data is read.
if (PHP_SAPI !== 'cli') exit(1);
function timelineCheck(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}
function timelineReject(callable $operation, string $exception, string $message): void
{
    try { $operation(); } catch (Throwable $error) {
        timelineCheck($error instanceof $exception, $message . ': wrong exception ' . get_class($error));
        return;
    }
    throw new RuntimeException($message . ': accepted');
}

$fixture = sys_get_temp_dir() . '/genesis-timeline-' . bin2hex(random_bytes(8));
mkdir($fixture, 0700); mkdir($fixture . '/sessions', 0700);
$options = [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC];
$legacy = new PDO('sqlite::memory:', null, null, $options);
$legacy->exec('PRAGMA foreign_keys = ON');
$legacy->exec((string)file_get_contents(__DIR__ . '/../migrations/001_init.sql'));
$legacy->exec((string)file_get_contents(__DIR__ . '/../migrations/004_stoicheion_draws.sql'));
$legacy->exec("INSERT INTO users(id, google_sub, email, created_at, updated_at) VALUES('legacy', 'legacy', 'legacy@example.invalid', 'fixture', 'fixture')");
$legacy->exec("INSERT INTO stoicheion_draws VALUES('legacy', '2026-10-30', 'daily', 42, 1, 'fixture', 'fixture'), ('legacy', '2026-10-30', 'spread', 2147483648, 2, 'fixture', 'fixture')");
$oldRows = $legacy->query('SELECT * FROM stoicheion_draws ORDER BY draw_kind')->fetchAll();
$migration = (string)file_get_contents(__DIR__ . '/../migrations/089_stoicheion_timeline.sql');
$legacyBackupPath = $fixture . '/before.sqlite';
$legacy->exec('VACUUM INTO ' . $legacy->quote($legacyBackupPath));

// A failed migration rolls back as a unit. Repeating a successful one preserves old data.
$legacy->beginTransaction();
$legacy->exec($migration);
$legacy->rollBack();
timelineCheck($legacy->query("SELECT 1 FROM sqlite_master WHERE name='stoicheion_timeline_draws'")->fetchColumn() === false, 'Failed migration left a partial table');
$legacy->exec($migration); $legacy->exec($migration);
timelineCheck($legacy->query('SELECT * FROM stoicheion_draws ORDER BY draw_kind')->fetchAll() === $oldRows, 'Migration changed existing daily/nine-card data');
$legacy->exec("INSERT INTO stoicheion_timeline_draws VALUES('legacy', '2026-10-30', 'timeline', 4294967295, 1, 'fixture', 'fixture')");
$legacy->exec("UPDATE stoicheion_draws SET seed_value=43 WHERE user_id='legacy' AND draw_kind='daily'");
timelineCheck((int)$legacy->query('SELECT seed_value FROM stoicheion_timeline_draws')->fetchColumn() === 4294967295, 'An old writer erased the new draw');
timelineReject(fn() => $legacy->exec("INSERT INTO stoicheion_timeline_draws VALUES('legacy', '2026-10-31', 'daily', 1, 1, 'fixture', 'fixture')"), PDOException::class, 'Timeline kind constraint');
timelineReject(fn() => $legacy->exec("INSERT INTO stoicheion_timeline_draws VALUES('legacy', '2026-10-31', 'timeline', 1, 3, 'fixture', 'fixture')"), PDOException::class, 'Attempt constraint');
timelineReject(fn() => $legacy->exec("INSERT INTO stoicheion_timeline_draws VALUES('missing', '2026-10-31', 'timeline', 1, 1, 'fixture', 'fixture')"), PDOException::class, 'Owner foreign key');
$legacyBackup = new PDO('sqlite:' . $legacyBackupPath, null, null, $options);
timelineCheck($legacyBackup->query('SELECT * FROM stoicheion_draws ORDER BY draw_kind')->fetchAll() === $oldRows, 'Pre-migration backup changed');
timelineCheck($legacyBackup->query("SELECT 1 FROM sqlite_master WHERE name='stoicheion_timeline_draws'")->fetchColumn() === false, 'Pre-migration backup contains the new table');

$config = ['app_url' => 'https://localhost.invalid', 'db_path' => $fixture . '/app.sqlite',
    'session_path' => $fixture . '/sessions', 'crypto_key' => base64_encode(random_bytes(32)),
    'cookie_secure' => false, 'timezone' => 'UTC'];
file_put_contents($fixture . '/config.php', '<?php return ' . var_export($config, true) . ';');
define('GENESIS_LOCAL_TEST_CONFIG', $fixture . '/config.php');
require __DIR__ . '/../src/bootstrap.php';
require __DIR__ . '/../src/repository.php';
$db = genesisDb(); $now = genesisNow(); $day = genesisClientDayKey();
foreach (['alice', 'bob', 'expired', 'disabled'] as $id) {
    $db->prepare('INSERT INTO users(id, google_sub, email, display_name, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?)')
        ->execute([$id, $id, $id . '@example.invalid', 'Synthetic', $now, $now]);
}
timelineCheck((int)$db->query("SELECT COUNT(*) FROM schema_migrations WHERE name='089_stoicheion_timeline.sql'")->fetchColumn() === 1, 'Startup did not apply migration exactly once');
timelineCheck(genesisStoicheionDraws('alice')['draws'] === [], 'New account has another owner\'s draws');
foreach (['daily' => 0, 'spread' => 2147483648, 'timeline' => 4294967295] as $kind => $seed) {
    $draw = genesisSaveStoicheionDraw('alice', $kind, $seed);
    timelineCheck($draw['kind'] === $kind && $draw['seed'] === $seed && $draw['attempts'] === 1 && $draw['canReroll'], 'First draw or uint32 seed changed');
}
$first = genesisStoicheionDraws('alice')['draws'];
timelineCheck(count($first) === 3, 'Draw listing omitted a kind');
timelineCheck(genesisStoicheionDraws('bob')['draws'] === [], 'Owner isolation failed');
$second = genesisSaveStoicheionDraw('alice', 'timeline', 123456789);
timelineCheck($second['attempts'] === 2 && !$second['canReroll'], 'Second draw did not use the single reroll');
timelineCheck($second['firstDrawAt'] === $first['timeline']['firstDrawAt'] && $second['rerollDeadline'] === $first['timeline']['rerollDeadline'], 'Reroll extended the three-minute window');
timelineReject(fn() => genesisSaveStoicheionDraw('alice', 'timeline', 99), DomainException::class, 'Third draw');
$after = genesisStoicheionDraws('alice')['draws'];
timelineCheck($after['daily'] === $first['daily'] && $after['spread'] === $first['spread'], 'Timeline reroll consumed or changed an old draw');
genesisSaveStoicheionDraw('bob', 'timeline', 123);
timelineCheck(genesisStoicheionDraws('alice')['draws']['timeline']['seed'] === 123456789, 'Another owner overwrote a draw');

genesisSaveStoicheionDraw('expired', 'timeline', 7);
$db->prepare('UPDATE stoicheion_timeline_draws SET first_draw_at=? WHERE user_id=?')->execute([gmdate('Y-m-d\TH:i:s\Z', time() - 181), 'expired']);
timelineReject(fn() => genesisSaveStoicheionDraw('expired', 'timeline', 8), DomainException::class, 'Expired reroll window');
timelineCheck(genesisStoicheionDraws('expired')['draws']['timeline']['seed'] === 7, 'Expired write changed the draw');
$db->prepare('UPDATE users SET stoicheion_divination_disabled=1 WHERE id=?')->execute(['disabled']);
foreach (['daily', 'spread', 'timeline'] as $kind) timelineReject(fn() => genesisSaveStoicheionDraw('disabled', $kind, 1), DomainException::class, 'Disabled divination');
foreach ([-1, 4294967296] as $seed) timelineReject(fn() => genesisSaveStoicheionDraw('bob', 'timeline', $seed), InvalidArgumentException::class, 'Invalid seed');
timelineReject(fn() => genesisSaveStoicheionDraw('bob', 'unknown', 1), InvalidArgumentException::class, 'Unknown kind');
timelineReject(fn() => genesisSaveStoicheionDraw('missing', 'timeline', 1), DomainException::class, 'Missing owner');
$db->prepare('INSERT INTO stoicheion_timeline_draws VALUES(?, ?, ?, ?, ?, ?, ?)')->execute(['alice', '2000-01-01', 'timeline', 777, 1, $now, $now]);
timelineCheck(count(genesisStoicheionDraws('alice')['draws']) === 3, 'Past-day draw leaked into today');

$fresh = new PDO('sqlite:' . $config['db_path'], null, null, $options);
timelineCheck((int)$fresh->query("SELECT seed_value FROM stoicheion_timeline_draws WHERE user_id='alice' AND day_key=" . $fresh->quote($day))->fetchColumn() === 123456789, 'Fresh connection lost the draw');
$backupPath = $fixture . '/after.sqlite';
$db->exec('VACUUM INTO ' . $db->quote($backupPath));
$backup = new PDO('sqlite:' . $backupPath, null, null, $options);
timelineCheck((int)$backup->query('SELECT COUNT(*) FROM stoicheion_timeline_draws')->fetchColumn() === 4, 'Consistent backup omitted new draws');
timelineCheck($db->query('PRAGMA foreign_key_check')->fetchAll() === [], 'Migration left invalid foreign keys');
$purged = genesisDeleteAccountRows('alice');
timelineCheck($purged['stoicheion_timeline_draws'] === 2 && genesisStoicheionDraws('alice')['draws'] === [], 'Account deletion did not cascade and count timeline data');
timelineCheck(genesisStoicheionDraws('bob')['draws']['timeline']['seed'] === 123, 'Account deletion affected another owner');

// Calendar-week boundaries and owner-only testing are independent of a device clock.
timelineCheck(genesisStoicheionPeriodStart('2026-11-08','spread')==='2026-11-02','Sunday weekly anchor');
timelineCheck(genesisStoicheionPeriodStart('2026-11-09','timeline')==='2026-11-09','Monday weekly boundary');
timelineCheck(genesisStoicheionPeriodStart('2026-11-08','daily')==='2026-11-08','Daily card became weekly');
foreach(['weekly','owner-test']as$id)$db->prepare('INSERT INTO users(id,google_sub,email,display_name,created_at,updated_at)VALUES(?,?,?,?,?,?)')->execute([$id,$id,$id==='owner-test'?'nikitalexanderson@gmail.com':$id.'@example.invalid','Synthetic',$now,$now]);
$weekStart=genesisStoicheionPeriodStart($day,'spread');$old=gmdate('Y-m-d\TH:i:s\Z',time()-86400);
foreach(['spread','timeline']as$kind){
 $table=$kind==='spread'?'stoicheion_draws':'stoicheion_timeline_draws';
 $db->prepare("INSERT INTO $table VALUES(?,?,?,?,?,?,?)")->execute(['weekly',$weekStart,$kind,123,1,$old,$old]);
 timelineCheck(genesisStoicheionDraws('weekly')['draws'][$kind]['dayKey']===$weekStart,'Weekly draw lost its actual source date');
 timelineReject(fn()=>genesisSaveStoicheionDraw('weekly',$kind,456),DomainException::class,'Weekly redraw after its initial window');
}
timelineCheck(genesisSaveStoicheionDraw('weekly','daily',12)['kind']==='daily','Weekly draw consumed the independent daily card');
$owner=genesisFindUser('owner-test');
timelineCheck(!genesisForecastTestingOwner($owner),'Email alone received testing access');
genesisEstablishGoogleSession($owner,$owner['google_sub']);
timelineCheck(genesisForecastTestingOwner($owner),'Verified primary owner did not receive testing access');
foreach(['daily','spread','timeline']as$kind)for($attempt=0;$attempt<4;$attempt++){
 $draw=genesisSaveStoicheionDraw('owner-test',$kind,$attempt);
 timelineCheck($draw['unlimited']&&$draw['canReroll'],'Owner testing draw was limited');
}
$_SESSION['auth_identity']['sub']='another-sub';timelineCheck(!genesisForecastTestingOwner($owner),'Mismatched subject inherited the owner exception');

echo "Stoicheion timeline: additive migration/atomic rollback, old-writer compatibility, uint32 seeds, independent reroll limits/window, owner/day isolation, disabled gate, fresh connection, consistent backups and account cascade passed.\n";
