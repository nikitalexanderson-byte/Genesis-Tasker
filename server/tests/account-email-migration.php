<?php
declare(strict_types=1);
require dirname(__DIR__).'/src/bootstrap.php';
function emailMigrationExpect(bool $value,string $reason):void {if(!$value)throw new RuntimeException($reason);}
$db=new PDO('sqlite::memory:',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
$db->exec('PRAGMA foreign_keys=ON');
foreach(glob(dirname(__DIR__).'/migrations/*.sql')as$file)if(basename($file)<'067_')$db->exec(file_get_contents($file));
$db->exec("INSERT INTO users(id,google_sub,email,created_at,updated_at) VALUES('legacy','legacy','fixture@example.invalid','now','now')");
$backupPath=tempnam(sys_get_temp_dir(),'genesis-email-backup-');
try{
    $db->exec('VACUUM INTO '.$db->quote($backupPath));
    $db->exec(file_get_contents(dirname(__DIR__).'/migrations/067_account_email.sql'));
    emailMigrationExpect($db->query("SELECT email FROM users WHERE id='legacy'")->fetchColumn()==='fixture@example.invalid','Existing account changed');
    emailMigrationExpect((int)$db->query('SELECT COUNT(*) FROM email_registrations')->fetchColumn()===0,'Migration created retrospective registrations');
    emailMigrationExpect((int)$db->query('SELECT COUNT(*) FROM account_email_outbox')->fetchColumn()===0,'Migration sent retrospective mail');
    $backup=new PDO('sqlite:'.$backupPath);
    emailMigrationExpect($backup->query("SELECT email FROM users WHERE id='legacy'")->fetchColumn()==='fixture@example.invalid','Consistent backup lost existing user');
    emailMigrationExpect(!$backup->query("SELECT name FROM sqlite_master WHERE name='email_registrations'")->fetch(),'Backup schema changed');
    $backup=null;
    // A reverted application can continue its old account reads/writes with the additive tables present.
    $db->exec("UPDATE users SET display_name='Old client' WHERE id='legacy'");
    emailMigrationExpect($db->query("SELECT display_name FROM users WHERE id='legacy'")->fetchColumn()==='Old client','Old client update failed');
    $db->exec("INSERT INTO email_registrations(user_id,email,token_hash,expires_at,created_at) VALUES('legacy','fixture@example.invalid','hash','later','now');
        INSERT INTO account_email_outbox(id,user_id,kind,unique_key,payload,available_at,created_at,updated_at) VALUES('mail','legacy','registration','key','encrypted','now','now','now');
        DELETE FROM users WHERE id='legacy'");
    emailMigrationExpect((int)$db->query('SELECT COUNT(*) FROM account_email_outbox')->fetchColumn()===0&&(int)$db->query('SELECT COUNT(*) FROM email_registrations')->fetchColumn()===0,'Account deletion retained email data');
    emailMigrationExpect(!$db->query('PRAGMA foreign_key_check')->fetch(),'Foreign keys broken');
    echo "Email migration: schema 066, consistent backup, no retroactive email, legacy writes/code revert and account deletion passed.\n";
}finally{if(is_file($backupPath))unlink($backupPath);}
