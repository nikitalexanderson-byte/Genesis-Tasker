<?php
declare(strict_types=1);
require dirname(__DIR__).'/src/bootstrap.php';
require_once dirname(__DIR__).'/src/shared-content-storage.php';
function seriesMigrationExpect(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);}
$db=new PDO('sqlite::memory:',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
$db->exec('PRAGMA foreign_keys=ON');
foreach(glob(dirname(__DIR__).'/migrations/*.sql') as $file)if(basename($file)<'059_')$db->exec(file_get_contents($file));
genesisRegisterSharedContentFunctions($db);genesisInitializeSharedContentStorage($db);genesisInitializeSharedTrashReadView($db);genesisInitializeSharedTaskDetails($db);
$db->exec("INSERT INTO users(id,google_sub,email,created_at,updated_at) VALUES('u','u','fixture@example.test','now','now');
 INSERT INTO shared_spaces(id,title,created_by,created_at,updated_at) VALUES('s','Space','u','now','now');
 INSERT INTO shared_projects(id,space_id,title,created_at,updated_at) VALUES('p','s','Project','now','now');
 INSERT INTO shared_project_statuses(id,project_id,title,position) VALUES('b','p','Open',0);
 INSERT INTO shared_tasks(id,project_id,status_id,title,due_date,created_at,updated_at) VALUES('t','p','b','Legacy task','2026-10-20','now','now')");
$before=$db->query("SELECT * FROM shared_tasks_read WHERE id='t'")->fetch();
$backupPath=tempnam(sys_get_temp_dir(),'genesis-series-backup-');
try{
    $db->exec('VACUUM INTO '.$db->quote($backupPath));
    $db->exec(file_get_contents(dirname(__DIR__).'/migrations/059_shared_series_jobs.sql'));
    seriesMigrationExpect($db->query("SELECT * FROM shared_tasks_read WHERE id='t'")->fetch()===$before,'Migration changed old task');
    $db->exec("INSERT INTO shared_task_series(id,project_id,source_task_id,owner_id,rule_json,template_json,cursor_date,created_at,updated_at) VALUES('series','p','t','u','{}','[]','2026-10-20','now','now');
     INSERT INTO shared_series_instances VALUES('series','date:2026-10-20','t','2026-10-20',1,'created','now');
     UPDATE shared_tasks SET description='Old Android edit' WHERE id='t'");
    seriesMigrationExpect($db->query("SELECT description FROM shared_tasks_read WHERE id='t'")->fetchColumn()==='Old Android edit','Legacy task write failed');
    seriesMigrationExpect((int)$db->query('SELECT COUNT(*) FROM shared_series_instances')->fetchColumn()===1,'Old client lost series membership');
    $backup=new PDO('sqlite:'.$backupPath);genesisRegisterSharedContentFunctions($backup);
    seriesMigrationExpect($backup->query("SELECT title FROM shared_tasks_read WHERE id='t'")->fetchColumn()==='Legacy task','Backup is not readable');
    seriesMigrationExpect(!$backup->query("SELECT name FROM sqlite_master WHERE name='shared_task_series'")->fetchColumn(),'Backup schema was modified');
    $backup=null;
    // Code rollback uses the previous task projection and leaves additive series state intact.
    seriesMigrationExpect($db->query("SELECT title,description,due_date,revision FROM shared_tasks_read WHERE id='t'")->fetch()['due_date']==='2026-10-20','Code rollback projection failed');
    seriesMigrationExpect(!$db->query('PRAGMA foreign_key_check')->fetch(),'Migration broke foreign keys');
    echo "Series migration: old task preservation, consistent runtime backup, legacy Android writes and code rollback passed.\n";
}finally{if(is_file($backupPath))unlink($backupPath);}
