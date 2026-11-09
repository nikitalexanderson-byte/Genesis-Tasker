<?php
declare(strict_types=1);
require dirname(__DIR__).'/src/bootstrap.php';require dirname(__DIR__).'/src/shared-content-storage.php';
$db=new PDO('sqlite::memory:',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);genesisRegisterSharedContentFunctions($db);$db->exec('PRAGMA foreign_keys=ON');
foreach(glob(dirname(__DIR__).'/migrations/*.sql') as $file)if(basename($file)<'068_')$db->exec(file_get_contents($file));
$db->exec("INSERT INTO users(id,google_sub,email,created_at,updated_at) VALUES('u','u','fixture@example.invalid','now','now')");
$db->prepare('INSERT INTO workspace_blobs(user_id,ciphertext,iv,version,updated_at,minimum_writer_protocol,writer_protocol_version) VALUES(?,?,?,?,?,?,?)')->execute(['u','opaque','iv',7,'now',5,7]);
$before=$db->query('SELECT * FROM workspace_blobs')->fetch();$path=tempnam(sys_get_temp_dir(),'genesis-habit-reminder-backup-');
try{
 $db->exec('VACUUM INTO '.$db->quote($path));$db->beginTransaction();$db->exec(file_get_contents(dirname(__DIR__).'/migrations/068_habit_reminders.sql'));$db->commit();
 if($before!==$db->query('SELECT * FROM workspace_blobs')->fetch())throw new RuntimeException('Personal envelope changed');
 foreach(['habit_reminder_profiles','habit_reminder_devices','habit_reminder_deliveries'] as $table)if($db->query('SELECT COUNT(*) FROM '.$table)->fetchColumn())throw new RuntimeException('Migration enabled a subscription or replayed history');
 $db->exec("UPDATE workspace_blobs SET ciphertext='legacy update',version=8,writer_protocol_version=8 WHERE user_id='u'");
 if($db->query('SELECT minimum_writer_protocol FROM workspace_blobs')->fetchColumn()!=5)throw new RuntimeException('Rollback lost existing writer protection');
 $db->exec("INSERT INTO habit_reminder_profiles(user_id,updated_at) VALUES('u','now');INSERT INTO habit_reminder_devices(id,user_id,device_key,request_id,request_hash,time_zone,created_at,updated_at) VALUES('d','u','opaque-key','request','hash','UTC','now','now')");
 $db->prepare('INSERT INTO habit_reminder_deliveries(id,user_id,device_id,profile_revision,event_key,encrypted_target,scheduled_at,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')->execute(['n','u','d',1,'hash',genesisSharedContentEncrypt('{"habitId":"opaque"}'),'now','later','now','now']);
 if(str_contains($db->query('SELECT encrypted_target FROM habit_reminder_deliveries')->fetchColumn(),'habitId'))throw new RuntimeException('Target is plaintext');
 $db->exec("DELETE FROM users WHERE id='u'");foreach(['habit_reminder_profiles','habit_reminder_devices','habit_reminder_deliveries'] as $table)if($db->query('SELECT COUNT(*) FROM '.$table)->fetchColumn())throw new RuntimeException('Account deletion left reminder data');
 if($db->query('PRAGMA foreign_key_check')->fetch())throw new RuntimeException('Broken references');
 $backup=new PDO('sqlite:'.$path);if($backup->query('PRAGMA integrity_check')->fetchColumn()!=='ok'||$backup->query('SELECT version FROM workspace_blobs')->fetchColumn()!=7)throw new RuntimeException('Backup integrity failed');
 if($backup->query("SELECT name FROM sqlite_master WHERE name='habit_reminder_devices'")->fetchColumn())throw new RuntimeException('Backup schema changed');$backup=null;
 echo "Habit reminder migration: consistent SQLite backup, preserved envelope/protocol/history, no auto-subscriptions, encrypted metadata, legacy writes and account cleanup passed. Code rollback leaves only inert additive tables; no database restore is performed.\n";
}finally{if(is_file($path))unlink($path);}
