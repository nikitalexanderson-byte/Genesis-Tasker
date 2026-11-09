<?php
declare(strict_types=1);
require dirname(__DIR__).'/src/bootstrap.php';
require dirname(__DIR__).'/src/shared-content-storage.php';
$db=new PDO('sqlite::memory:',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);genesisRegisterSharedContentFunctions($db);$db->exec('PRAGMA foreign_keys=ON');
foreach(glob(dirname(__DIR__).'/migrations/*.sql')as$file)if(basename($file)<'060_')$db->exec(file_get_contents($file));
genesisInitializeSharedContentStorage($db);genesisInitializeSharedTrashReadView($db);genesisInitializeSharedTaskDetails($db);
$db->exec("INSERT INTO users(id,google_sub,email,created_at,updated_at) VALUES('u','u','fixture@example.invalid','now','now');
INSERT INTO shared_spaces(id,title,created_by,created_at,updated_at) VALUES('s','Space','u','now','now');
INSERT INTO shared_projects(id,space_id,title,created_at,updated_at) VALUES('p','s','Project','now','now');
INSERT INTO shared_project_statuses(id,project_id,title,position) VALUES('b','p','Open',0);
INSERT INTO shared_tasks(id,project_id,status_id,title,due_date,created_at,updated_at) VALUES('t','p','b','Old task','2026-10-20','now','now')");
$before=$db->query("SELECT * FROM shared_tasks_read WHERE id='t'")->fetch();$path=tempnam(sys_get_temp_dir(),'genesis-views-backup-');
try{
 $db->exec('VACUUM INTO '.$db->quote($path));$db->exec(file_get_contents(dirname(__DIR__).'/migrations/060_shared_saved_views.sql'));
 if($before!==$db->query("SELECT * FROM shared_tasks_read WHERE id='t'")->fetch())throw new RuntimeException('Migration changed historical tasks');
 $db->exec("INSERT INTO shared_saved_views(id,owner_id,visibility,payload,created_at,updated_at) VALUES('v','u','personal','encrypted','now','now');UPDATE shared_tasks SET description='Legacy edit' WHERE id='t'");
 if($db->query("SELECT description FROM shared_tasks_read WHERE id='t'")->fetchColumn()!=='Legacy edit')throw new RuntimeException('Legacy client write failed');
 $backup=new PDO('sqlite:'.$path);genesisRegisterSharedContentFunctions($backup);
 if($backup->query('PRAGMA integrity_check')->fetchColumn()!=='ok'||$backup->query("SELECT title FROM shared_tasks_read WHERE id='t'")->fetchColumn()!=='Old task')throw new RuntimeException('Runtime backup is invalid');
 if($backup->query("SELECT name FROM sqlite_master WHERE name='shared_saved_views'")->fetchColumn())throw new RuntimeException('Backup schema changed');
 if($db->query('PRAGMA foreign_key_check')->fetch())throw new RuntimeException('Foreign keys broken');
 $backup=null;echo "Saved views migration: historical data, consistent backup, old-client writes and additive code rollback passed.\n";
}finally{if(is_file($path))unlink($path);}
