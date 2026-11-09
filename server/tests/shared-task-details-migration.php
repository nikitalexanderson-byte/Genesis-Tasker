<?php
declare(strict_types=1);
require dirname(__DIR__).'/src/bootstrap.php';
require_once dirname(__DIR__).'/src/shared-content-storage.php';
function migrationExpect(bool $value,string $message):void { if(!$value)throw new RuntimeException($message); }
$db=new PDO('sqlite::memory:',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
$db->exec('PRAGMA foreign_keys=ON');
foreach(glob(dirname(__DIR__).'/migrations/*.sql') as $file)if(basename($file)<'058_')$db->exec(file_get_contents($file));
genesisRegisterSharedContentFunctions($db);
genesisInitializeSharedContentStorage($db);genesisInitializeSharedTrashReadView($db);genesisInitializeSharedMapProjectIndex($db);
$db->exec("INSERT INTO users(id,google_sub,email,created_at,updated_at) VALUES('u','u','fixture@example.test','now','now');
 INSERT INTO shared_spaces(id,title,created_by,created_at,updated_at) VALUES('s','Space','u','now','now');
 INSERT INTO shared_projects(id,space_id,title,created_at,updated_at) VALUES('p','s','Project','now','now');
 INSERT INTO shared_project_statuses(id,project_id,title,position) VALUES('b','p','Open',0);
 INSERT INTO shared_tasks(id,project_id,status_id,title,due_date,created_at,updated_at) VALUES('t','p','b','Legacy task','2026-10-20','now','now')");
$backupPath=tempnam(sys_get_temp_dir(),'genesis-details-backup-');
try {
 $db->exec('VACUUM INTO '.$db->quote($backupPath));
 $db->exec(file_get_contents(dirname(__DIR__).'/migrations/058_shared_task_details.sql'));
 genesisInitializeSharedTaskDetails($db);genesisInitializeSharedTaskDetails($db);
 $task=$db->query("SELECT * FROM shared_tasks_read WHERE id='t'")->fetch();
 migrationExpect($task['title']==='Legacy task' && $task['due_date']==='2026-10-20' && (int)$task['priority']===0 && $task['checklists_json']==='[]','Legacy data or defaults changed');
 $db->exec("UPDATE shared_tasks SET title='Old client edit' WHERE id='t'");
 migrationExpect($db->query("SELECT title FROM shared_tasks_read WHERE id='t'")->fetchColumn()==='Old client edit','Legacy update failed');
 $lists=json_encode([['id'=>'l','title'=>'Private checklist','items'=>[]]],JSON_THROW_ON_ERROR);
 $db->prepare("UPDATE shared_tasks SET checklists_json=?, priority=3 WHERE id='t'")->execute([$lists]);
 migrationExpect(!str_contains($db->query("SELECT checklists_json FROM shared_tasks WHERE id='t'")->fetchColumn(),'Private checklist'),'Checklist not encrypted');
 $db->exec("UPDATE shared_tasks SET description='Legacy description' WHERE id='t'");
 migrationExpect($db->query("SELECT checklists_json FROM shared_tasks_read WHERE id='t'")->fetchColumn()===$lists,'Omitted new data lost');
 $backup=new PDO('sqlite:'.$backupPath);genesisRegisterSharedContentFunctions($backup);
 migrationExpect($backup->query("SELECT title FROM shared_tasks_read WHERE id='t'")->fetchColumn()==='Legacy task','Runtime backup changed');
 migrationExpect(!in_array('priority',array_column($backup->query('PRAGMA table_info(shared_tasks)')->fetchAll(PDO::FETCH_ASSOC),'name'),true),'Backup schema was changed');
 $backup=null;
 // A code revert can use the old read projection and writes without removing additive columns.
 migrationExpect($db->query("SELECT title,description,due_date,revision FROM shared_tasks_read WHERE id='t'")->fetch()['title']==='Old client edit','Code rollback projection failed');
 migrationExpect(!$db->query('PRAGMA foreign_key_check')->fetch(),'Migration broke foreign keys');
 echo "Task-details migration: production-compatible schema, consistent backup, repeat initializer, encryption and legacy/code-rollback compatibility passed.\n";
} finally { if(is_file($backupPath))unlink($backupPath); }
