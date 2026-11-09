<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit(1);
$fixture=sys_get_temp_dir().'/genesis-retention-migration-'.bin2hex(random_bytes(8));mkdir($fixture,0700);mkdir($fixture.'/sessions',0700);
$config=['app_url'=>'https://localhost.invalid','db_path'=>$fixture.'/unused.sqlite','session_path'=>$fixture.'/sessions','crypto_key'=>base64_encode(random_bytes(32)),'cookie_secure'=>false,'timezone'=>'UTC','notifications'=>['email'=>['transport'=>'disabled']]];
file_put_contents($fixture.'/config.php','<?php return '.var_export($config,true).';');define('GENESIS_LOCAL_TEST_CONFIG',$fixture.'/config.php');
require_once dirname(__DIR__).'/src/bootstrap.php';
function retentionMigrationExpect(bool $ok,string $reason): void {if(!$ok)throw new RuntimeException($reason);}
$db=new PDO('sqlite::memory:',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
$db->exec('PRAGMA foreign_keys=ON');
foreach(glob(dirname(__DIR__).'/migrations/*.sql')as$file)if(basename($file)<'120_')$db->exec((string)file_get_contents($file));
$insert=$db->prepare('INSERT INTO users(id,google_sub,email,subscription_plan,created_at,updated_at,login_count,last_login_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?)');
$insert->execute(['legacy','retention-migration-legacy','legacy@example.invalid','free','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',1,'2026-01-01T00:00:00Z','2026-06-01T12:34:00Z']);
$insert->execute(['gift','retention-migration-gift','gift@example.invalid','premium4life','2025-01-01T00:00:00Z','2026-06-01T00:00:00Z',2,'2026-06-01T00:00:00Z','2026-06-01T00:00:00Z']);
$insert->execute(['paid','retention-migration-paid','paid@example.invalid','premium4life','2025-01-01T00:00:00Z','2026-06-01T00:00:00Z',2,'2026-06-01T00:00:00Z','2026-06-01T00:00:00Z']);
$insert->execute(['abandoned','retention-migration-abandoned','abandoned@example.invalid','free','2026-04-30T00:00:00Z','2026-04-30T00:00:00Z',1,'2026-04-30T00:00:00Z','2026-04-30T00:00:00Z']);
$db->exec("INSERT INTO subscription_access_state(user_id,materialized_billing) VALUES('paid',1);INSERT INTO user_client_activity(user_id,client_kind,last_seen_at) VALUES('legacy','android_app','2026-07-31T23:59:59Z')");
$before=$db->query('SELECT * FROM users ORDER BY id')->fetchAll();$sql=(string)file_get_contents(dirname(__DIR__).'/migrations/120_account_retention.sql');
$backupPath=tempnam(sys_get_temp_dir(),'genesis-retention-backup-');$copy=null;
try{
    $db->exec('VACUUM INTO '.$db->quote($backupPath));
    $copy=new PDO('sqlite:'.$backupPath,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    retentionMigrationExpect($copy->query('PRAGMA integrity_check')->fetchColumn()==='ok'&&$copy->query('SELECT * FROM users ORDER BY id')->fetchAll()===$before,'Consistent pre-migration backup lost accounts');
    $db->beginTransaction();
    try{$db->exec($sql);$db->exec('SELECT * FROM intentional_missing_retention_table');throw new LogicException('Failure fixture did not fail');}
    catch(PDOException){$db->rollBack();}
    retentionMigrationExpect($db->query("SELECT name FROM sqlite_master WHERE name='account_retention_state'")->fetchColumn()===false,'Failed migration left a partial retention schema');
    retentionMigrationExpect($db->query('SELECT * FROM users ORDER BY id')->fetchAll()===$before,'Failed migration changed users');
    $db->beginTransaction();$db->exec($sql);$db->commit();
    retentionMigrationExpect($db->query('SELECT * FROM users ORDER BY id')->fetchAll()===$before,'Migration modified existing account data');
    retentionMigrationExpect((int)$db->query('SELECT COUNT(*) FROM account_retention_notices')->fetchColumn()===0,'Migration queued retrospective mail or deletion');
    $rows=$db->query('SELECT * FROM account_retention_state ORDER BY user_id')->fetchAll(PDO::FETCH_UNIQUE);
    retentionMigrationExpect($rows['legacy']['last_activity_at']==='2026-07-31T23:59:59Z'&&(int)$rows['legacy']['has_returned']===1,'Legacy foreground/background history was not preserved conservatively');
    retentionMigrationExpect((int)$rows['abandoned']['has_returned']===0,'Registration was misclassified as a return visit');
    retentionMigrationExpect((int)$rows['gift']['complimentary_elite_cohort']===1&&(int)$rows['paid']['complimentary_elite_cohort']===0,'Complimentary cohort included a billing-materialized lifetime account');
    retentionMigrationExpect($copy->query("SELECT name FROM sqlite_master WHERE name='account_retention_state'")->fetchColumn()===false,'Migration changed the pre-migration backup');
    // Older application code still reads and writes the same account schema after a code revert.
    $db->exec("UPDATE users SET display_name='Old app write' WHERE id='legacy'");
    $insert->execute(['future-gift','retention-migration-future-gift','future-gift@example.invalid','premium4life','2027-01-01T00:00:00Z','2027-01-01T00:00:00Z',1,null,null]);
    retentionMigrationExpect($db->query("SELECT display_name FROM users WHERE id='legacy'")->fetchColumn()==='Old app write'
        &&$db->query("SELECT user_id FROM account_retention_state WHERE user_id='future-gift'")->fetchColumn()===false,'Additive schema broke an old writer or expanded the fixed cohort');
    $db->exec("INSERT INTO account_retention_notices(id,user_id,rule,policy_fingerprint,recipient_email,rule_deadline_at,promised_delete_at,available_at,created_at,updated_at) VALUES('notice','abandoned','free-unreturned','synthetic-fingerprint','abandoned@example.invalid','2027-01-01T00:00:00Z','2027-01-01T00:00:00Z','2026-12-01T00:00:00Z','2026-12-01T00:00:00Z','2026-12-01T00:00:00Z')");
    $db->exec("DELETE FROM users WHERE id='abandoned'");
    retentionMigrationExpect($db->query("SELECT user_id FROM account_retention_state WHERE user_id='abandoned'")->fetchColumn()===false
        &&(int)$db->query('SELECT COUNT(*) FROM account_retention_notices')->fetchColumn()===0,'Account cascade retained private retention state or recipient data');
    retentionMigrationExpect(!$db->query('PRAGMA foreign_key_check')->fetch(),'Retention migration broke foreign keys');
    echo "Account retention migration: consistent backup, atomic failure, conservative activity, fixed complimentary cohort, no retrospective mail, old-code writes and cascade passed.\n";
}finally{$copy=null;if(is_file($backupPath))unlink($backupPath);}
