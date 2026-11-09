<?php
declare(strict_types=1);
require dirname(__DIR__).'/src/bootstrap.php';
require dirname(__DIR__).'/src/repository.php';
require dirname(__DIR__).'/src/google.php';
require dirname(__DIR__).'/src/shared-projects.php';
function calendarIntroExpect(bool $value, string $reason): void { if (!$value) throw new RuntimeException($reason); }
if (!in_array(parse_url(genesisConfig()['app_url'], PHP_URL_HOST), ['127.0.0.1', 'localhost.invalid'], true)) throw new RuntimeException('Isolated fixture required');

$memory = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
$memory->exec('PRAGMA foreign_keys=ON');
foreach (glob(dirname(__DIR__).'/migrations/*.sql') as $file) if (basename($file) < '079_') $memory->exec(file_get_contents($file));
$memory->exec("INSERT INTO users(id,google_sub,email,calendar_mode,created_at,updated_at) VALUES('legacy-calendar','legacy-calendar','legacy@example.invalid','lunar','now','now')");
$backupPath = tempnam(sys_get_temp_dir(), 'genesis-calendar-backup-');
try {
    $memory->exec('VACUUM INTO '.$memory->quote($backupPath));
    $memory->exec(file_get_contents(dirname(__DIR__).'/migrations/079_calendar_exploration.sql'));
    $legacy = $memory->query("SELECT calendar_mode,calendar_exploration_pending FROM users WHERE id='legacy-calendar'")->fetch();
    calendarIntroExpect($legacy['calendar_mode']==='lunar' && (int)$legacy['calendar_exploration_pending']===0, 'Migration changed a legacy account');
    $backup = new PDO('sqlite:'.$backupPath);
    calendarIntroExpect($backup->query("SELECT calendar_mode FROM users WHERE id='legacy-calendar'")->fetchColumn()==='lunar', 'Consistent backup lost legacy settings');
    $backup = null;
    $memory->exec("UPDATE users SET calendar_mode='sacred' WHERE id='legacy-calendar'");
    calendarIntroExpect($memory->query("SELECT calendar_mode FROM users WHERE id='legacy-calendar'")->fetchColumn()==='sacred', 'Old-client writes failed with additive schema');
} finally { if (is_file($backupPath)) unlink($backupPath); }

$suffix = bin2hex(random_bytes(6));
$profile = ['email_verified'=>true, 'sub'=>'calendar-intro-'.$suffix, 'email'=>'calendar-intro-'.$suffix.'@example.invalid', 'name'=>'Calendar fixture'];
$user = genesisUpsertGoogleUser($profile, [], false, false);
$id = (string)$user['id'];
try {
    $client = genesisUserForClient($user);
    calendarIntroExpect($client['calendarMode']==='profane' && $client['taskCalendarMode']==='profane', 'New accounts must start Gregorian');
    calendarIntroExpect($client['calendarExplorationPending']===true, 'A new account needs one calendar introduction');
    genesisUpdateAccountPreferences($id, ['calendarExplorationPending'=>false]);
    genesisUpdateAccountPreferences($id, ['calendarMode'=>'lunar']);
    $again = genesisUpsertGoogleUser($profile, [], false, false);
    $client = genesisUserForClient($again);
    calendarIntroExpect($client['calendarMode']==='lunar' && $client['calendarExplorationPending']===false, 'Sign-in replay reset preferences or repeated the introduction');
    try { genesisUpdateAccountPreferences($id, ['calendarExplorationPending'=>true]); throw new RuntimeException('A consumed introduction was rearmed'); }
    catch (InvalidArgumentException $expected) { calendarIntroExpect($expected->getMessage()==='INVALID_CALENDAR_EXPLORATION', 'Wrong validation failure'); }
    genesisUpdateAccountPreferences($id, ['weekStart'=>'sunday']);
    calendarIntroExpect(genesisUserForClient(genesisFindUser($id))['calendarExplorationPending']===false, 'An old preference patch rearmed the introduction');
    echo "Calendar introduction: backup, legacy choice, additive rollback compatibility, Gregorian defaults, one-time acknowledgement and login replay passed.\n";
} finally { genesisDb()->prepare('DELETE FROM users WHERE id=?')->execute([$id]); }
