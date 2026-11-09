<?php
declare(strict_types=1);
require dirname(__DIR__).'/src/bootstrap.php';require dirname(__DIR__).'/src/shared-content-storage.php';
$db=new PDO('sqlite::memory:',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);genesisRegisterSharedContentFunctions($db);$db->exec('PRAGMA foreign_keys=ON');
foreach(glob(dirname(__DIR__).'/migrations/*.sql')as$file)if(basename($file)<'064_')$db->exec(file_get_contents($file));
genesisInitializeSharedContentStorage($db);genesisInitializeSharedTrashReadView($db);genesisInitializeSharedTaskDetails($db);
$db->exec("INSERT INTO users(id,google_sub,email,created_at,updated_at) VALUES('u','u','fixture@example.invalid','now','now');
INSERT INTO shared_spaces(id,title,created_by,created_at,updated_at) VALUES('s','Space','u','now','now');
INSERT INTO shared_projects(id,space_id,title,created_at,updated_at) VALUES('p','s','Project','now','now');
INSERT INTO shared_project_statuses(id,project_id,title,position) VALUES('b','p','Open',0);
INSERT INTO shared_tasks(id,project_id,status_id,title,due_date,created_at,updated_at) VALUES('t','p','b','Historical task','2026-10-20','now','now');
INSERT INTO shared_tasks(id,project_id,status_id,title,due_date,created_at,updated_at) VALUES('old-import','p','b','Historical imported task','2026-10-20','now','now');
INSERT INTO shared_audit_events(id,project_id,actor_id,action,object_id,created_at,task_id,details_json) VALUES('e','p','u','task.created','t','now','t','{}');
INSERT INTO shared_audit_events(id,project_id,actor_id,action,object_id,created_at,details_json) VALUES('import','p','u','project.imported','p','now','{}')");
$before=$db->query("SELECT * FROM shared_tasks_read WHERE id='t'")->fetch();$path=tempnam(sys_get_temp_dir(),'genesis-notification-backup-');
try{
 $db->exec('VACUUM INTO '.$db->quote($path));$db->exec(file_get_contents(dirname(__DIR__).'/migrations/064_shared_notifications.sql'));
 if($before!==$db->query("SELECT * FROM shared_tasks_read WHERE id='t'")->fetch())throw new RuntimeException('Notification migration changed historical tasks');
 if((int)$db->query("SELECT imported FROM shared_notification_task_state WHERE task_id='old-import'")->fetchColumn()!==1||$db->query("SELECT 1 FROM shared_notification_task_state WHERE task_id='t'")->fetchColumn())throw new RuntimeException('Historical import suppression affected a normal task or enabled an import');
 foreach(['shared_task_watchers','shared_notification_events','shared_notification_recipients','shared_notification_outbox','shared_push_subscriptions']as$table)if($db->query('SELECT COUNT(*) FROM '.$table)->fetchColumn())throw new RuntimeException('Migration replayed history or enabled a subscription');
 $db->exec("INSERT INTO shared_task_watchers(task_id,user_id,created_at,watching) VALUES('t','u','now',0);INSERT INTO shared_notification_recipients(event_id,user_id,kind,task_id) VALUES('e','u','created','t')");
 $payload=genesisSharedContentEncrypt('{"endpoint":"https://fcm.googleapis.com/synthetic"}');$db->prepare("INSERT INTO shared_push_subscriptions(id,user_id,endpoint_hash,payload,created_at,updated_at) VALUES('sub','u','hash',?,'now','now')")->execute([$payload]);
 if(str_contains($db->query('SELECT payload FROM shared_push_subscriptions')->fetchColumn(),'fcm.googleapis.com'))throw new RuntimeException('Subscription payload is plaintext');
 // Existing clients continue to edit the task after an additive code rollback.
 $db->exec("UPDATE shared_tasks SET description='Legacy client edit' WHERE id='t'");if($db->query("SELECT description FROM shared_tasks_read WHERE id='t'")->fetchColumn()!=='Legacy client edit')throw new RuntimeException('Legacy write incompatible');
 $backup=new PDO('sqlite:'.$path);genesisRegisterSharedContentFunctions($backup);if($backup->query('PRAGMA integrity_check')->fetchColumn()!=='ok'||$backup->query("SELECT title FROM shared_tasks_read WHERE id='t'")->fetchColumn()!=='Historical task')throw new RuntimeException('Runtime backup is invalid');
 if($backup->query("SELECT name FROM sqlite_master WHERE name='shared_notification_outbox'")->fetchColumn())throw new RuntimeException('Backup schema changed');
 $db->exec("DELETE FROM users WHERE id='u'");foreach(['shared_task_watchers','shared_notification_recipients','shared_push_subscriptions']as$table)if($db->query('SELECT COUNT(*) FROM '.$table)->fetchColumn())throw new RuntimeException('Account cleanup retained notification records');
 if($db->query('PRAGMA foreign_key_check')->fetch())throw new RuntimeException('Foreign keys broken');$backup=null;
 echo "Notification migration: consistent SQLite backup, historical data, no replay/subscription/outbox, encrypted endpoint, legacy writes and account cleanup passed.\n";
}finally{if(is_file($path))unlink($path);}
