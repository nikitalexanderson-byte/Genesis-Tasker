<?php
declare(strict_types=1);
require dirname(__DIR__).'/src/bootstrap.php';
require dirname(__DIR__).'/src/shared-content-storage.php';
$db=new PDO('sqlite::memory:',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
genesisRegisterSharedContentFunctions($db);$db->exec('PRAGMA foreign_keys=ON');
foreach(glob(dirname(__DIR__).'/migrations/*.sql')as$file)if(basename($file)<'062_')$db->exec(file_get_contents($file));
genesisInitializeSharedContentStorage($db);genesisInitializeSharedTrashReadView($db);genesisInitializeSharedTaskDetails($db);
$db->exec("INSERT INTO users(id,google_sub,email,created_at,updated_at) VALUES('u','u','fixture@example.invalid','now','now');
INSERT INTO shared_spaces(id,title,created_by,created_at,updated_at) VALUES('s','Space','u','now','now');
INSERT INTO shared_projects(id,space_id,title,created_at,updated_at) VALUES('p','s','Project','now','now');
INSERT INTO shared_project_statuses(id,project_id,title,position) VALUES('b','p','Open',0);
INSERT INTO shared_tasks(id,project_id,status_id,title,due_date,created_at,updated_at) VALUES('t','p','b','Old task','2026-10-20','now','now')");
$before=$db->query("SELECT * FROM shared_tasks_read WHERE id='t'")->fetch();$path=tempnam(sys_get_temp_dir(),'genesis-bulk-backup-');
try{
 $db->exec('VACUUM INTO '.$db->quote($path));$db->exec(file_get_contents(dirname(__DIR__).'/migrations/062_shared_bulk.sql'));
 $db->exec(file_get_contents(dirname(__DIR__).'/migrations/063_shared_task_branch_index.sql'));
 if(!$db->query("SELECT 1 FROM sqlite_master WHERE type='index' AND name='shared_tasks_project_parent'")->fetchColumn())throw new RuntimeException('Branch lookup index missing');
 if($before!==$db->query("SELECT * FROM shared_tasks_read WHERE id='t'")->fetch())throw new RuntimeException('Migration changed historical tasks');
 $payload=genesisSharedContentEncrypt('{"action":{"kind":"priority","priority":3},"selection":{"mode":"page"}}');
 $db->prepare("INSERT INTO shared_bulk_operations(id,actor_id,request_id,payload_hash,payload,created_at,updated_at,expires_at) VALUES('op','u','r','hash',?,'now','now','later')")->execute([$payload]);
 $db->exec("INSERT INTO shared_bulk_items(operation_id,task_id,project_id,root_id,expected_revision,selected) VALUES('op','t','p','t',1,1)");
 $db->exec("UPDATE shared_bulk_operations SET state='failed',error_code='BACKGROUND_RETRY' WHERE id='op';UPDATE shared_tasks SET description='Legacy edit' WHERE id='t'");
 if($db->query("SELECT description FROM shared_tasks_read WHERE id='t'")->fetchColumn()!=='Legacy edit')throw new RuntimeException('Legacy client write failed');
 if(str_contains($db->query("SELECT payload FROM shared_bulk_operations WHERE id='op'")->fetchColumn(),'priority'))throw new RuntimeException('Operation payload is plaintext');
 $backup=new PDO('sqlite:'.$path);genesisRegisterSharedContentFunctions($backup);
 if($backup->query('PRAGMA integrity_check')->fetchColumn()!=='ok'||$backup->query("SELECT title FROM shared_tasks_read WHERE id='t'")->fetchColumn()!=='Old task')throw new RuntimeException('Runtime backup is invalid');
 if($backup->query("SELECT name FROM sqlite_master WHERE name='shared_bulk_operations'")->fetchColumn())throw new RuntimeException('Backup schema changed');
 if($db->query('PRAGMA foreign_key_check')->fetch())throw new RuntimeException('Foreign keys broken');
 $db->exec("DELETE FROM users WHERE id='u'");
 if($db->query('SELECT COUNT(*) FROM shared_bulk_operations')->fetchColumn()||$db->query('SELECT COUNT(*) FROM shared_bulk_items')->fetchColumn())throw new RuntimeException('Account cleanup retained bulk snapshots');
 $backup=null;echo "Bulk migration: historical data, consistent backup, encrypted snapshots, legacy writes, additive code rollback and account cleanup passed.\n";
}finally{if(is_file($path))unlink($path);}
