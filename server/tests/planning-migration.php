<?php
declare(strict_types=1);
// Only synthetic in-memory SQLite and its consistent runtime backup are used.
function pmCheck(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);}
function pmMigrate(PDO $db,string $through):void {
    $db->exec('CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL)');
    $files=glob(__DIR__.'/../migrations/*.sql');sort($files,SORT_STRING);
    foreach($files as $file){$name=basename($file);if(strcmp($name,$through)>0)continue;
        $q=$db->prepare('SELECT 1 FROM schema_migrations WHERE name=?');$q->execute([$name]);$exists=$q->fetchColumn();$q->closeCursor();if($exists)continue;
        $db->beginTransaction();try{$db->exec((string)file_get_contents($file));$db->prepare('INSERT INTO schema_migrations VALUES(?,?)')->execute([$name,'fixture']);$db->commit();}
        catch(Throwable $error){$db->rollBack();throw $error;}
    }
}
$settings=[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC];$db=new PDO('sqlite::memory:',null,null,$settings);$db->exec('PRAGMA foreign_keys=ON');pmMigrate($db,'076_shared_data_exchange.sql');
$db->exec("INSERT INTO users(id,google_sub,email,created_at,updated_at) VALUES('u','u','fixture@example.invalid','now','now');
    INSERT INTO shared_spaces(id,title,created_by,created_at,updated_at) VALUES('s','Legacy','u','now','now');
    INSERT INTO shared_projects(id,space_id,title,created_at,updated_at) VALUES('p','s','A','now','now'),('q','s','B','now','now');
    INSERT INTO shared_project_statuses(id,project_id,title,position) VALUES('open','p','Open',0),('other','q','Open',0);
    INSERT INTO shared_tasks(id,project_id,status_id,title,created_at,updated_at) VALUES('task','p','open','Opaque task ciphertext','now','now');");
$before=[];foreach(['users','shared_spaces','shared_projects','shared_project_statuses','shared_tasks'] as $table)$before[$table]=$db->query('SELECT * FROM '.$table)->fetchAll();
$backupPath=tempnam(sys_get_temp_dir(),'genesis-pre-planning-');
try {
    $db->exec('VACUUM INTO '.$db->quote($backupPath));
    $db->beginTransaction();$db->exec((string)file_get_contents(__DIR__.'/../migrations/077_shared_planning.sql'));
    try{$db->exec('SELECT * FROM deliberately_missing_planning_table');}catch(PDOException){$db->rollBack();}
    pmCheck(!$db->query("SELECT 1 FROM sqlite_master WHERE name='shared_sprints'")->fetchColumn(),'Partial migration survived rollback');
    pmMigrate($db,'077_shared_planning.sql');pmMigrate($db,'077_shared_planning.sql');
    foreach($before as $table=>$rows)pmCheck($db->query('SELECT * FROM '.$table)->fetchAll()===$rows,'Upgrade changed legacy '.$table);
    pmCheck((int)$db->query("SELECT COUNT(*) FROM schema_migrations WHERE name='077_shared_planning.sql'")->fetchColumn()===1,'Repeated startup reapplied schema');
    $db->exec("INSERT INTO shared_project_planning(project_id,enabled,updated_at) VALUES('p',1,'now');
        INSERT INTO shared_sprints(id,project_id,start_date,end_date,content_json,created_at,updated_at) VALUES('a','p','2026-10-01','2026-10-14','opaque sprint ciphertext','now','now'),('b','p','2026-10-15','2026-10-28','opaque sprint ciphertext','now','now');
        INSERT INTO shared_task_planning VALUES('task','a','opaque estimates ciphertext');
        UPDATE shared_tasks SET title='Legacy code edit',revision=revision+1 WHERE id='task';");
    pmCheck($db->query("SELECT estimates_json FROM shared_task_planning WHERE task_id='task'")->fetchColumn()==='opaque estimates ciphertext','Old code erased estimates');
    $db->exec("UPDATE shared_sprints SET state='active' WHERE id='a'");
    try{$db->exec("UPDATE shared_sprints SET state='active' WHERE id='b'");throw new RuntimeException('Two active sprints accepted');}catch(PDOException){}
    $db->exec("UPDATE shared_tasks SET project_id='q',status_id='other' WHERE id='task'");
    pmCheck($db->query("SELECT sprint_id FROM shared_task_planning WHERE task_id='task'")->fetchColumn()===null,'Old move retained foreign sprint membership');
    pmCheck($db->query("SELECT estimates_json FROM shared_task_planning WHERE task_id='task'")->fetchColumn()==='opaque estimates ciphertext','Move destroyed estimates');
    $db->exec("DELETE FROM shared_spaces WHERE id='s'");
    foreach(['shared_project_planning','shared_sprints','shared_task_planning'] as $table)pmCheck((int)$db->query('SELECT COUNT(*) FROM '.$table)->fetchColumn()===0,'Orphan '.$table);
    pmCheck(!$db->query('PRAGMA foreign_key_check')->fetch(),'Foreign key failure');
    $backup=new PDO('sqlite:'.$backupPath,null,null,$settings);pmCheck($backup->query('PRAGMA integrity_check')->fetchColumn()==='ok','Backup integrity failure');
    foreach($before as $table=>$rows)pmCheck($backup->query('SELECT * FROM '.$table)->fetchAll()===$rows,'Backup changed legacy '.$table);
    pmCheck(!$backup->query("SELECT 1 FROM sqlite_master WHERE name='shared_sprints'")->fetchColumn(),'Backup contains post-upgrade schema');$backup=null;
    $fresh=new PDO('sqlite::memory:',null,null,$settings);$fresh->exec('PRAGMA foreign_keys=ON');pmMigrate($fresh,'077_shared_planning.sql');
    pmCheck($fresh->query('PRAGMA integrity_check')->fetchColumn()==='ok'&&!$fresh->query('PRAGMA foreign_key_check')->fetch(),'Fresh schema failed');
    echo "Planning077: additive legacy upgrade, rollback after partial failure, repeat startup, consistent backup, old-code edits/moves, one-active uniqueness and cascades passed.\n";
}finally{if($db->inTransaction())$db->rollBack();if(is_file($backupPath))unlink($backupPath);}
