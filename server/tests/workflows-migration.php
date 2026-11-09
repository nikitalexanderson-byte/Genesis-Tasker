<?php
declare(strict_types=1);
function wmCheck(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);}
function wmMigrate(PDO $db,string $through):void{
    $db->exec('CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL)');$files=glob(__DIR__.'/../migrations/*.sql');sort($files,SORT_STRING);
    foreach($files as $file){$name=basename($file);if(strcmp($name,$through)>0)continue;$q=$db->prepare('SELECT 1 FROM schema_migrations WHERE name=?');$q->execute([$name]);$exists=$q->fetchColumn();$q->closeCursor();if($exists)continue;
        $db->beginTransaction();try{$db->exec((string)file_get_contents($file));$db->prepare('INSERT INTO schema_migrations VALUES(?,?)')->execute([$name,'fixture']);$db->commit();}catch(Throwable $error){$db->rollBack();throw $error;}
    }
}
$settings=[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC];$db=new PDO('sqlite::memory:',null,null,$settings);$db->exec('PRAGMA foreign_keys=ON');wmMigrate($db,'077_shared_planning.sql');
$db->exec("INSERT INTO users(id,google_sub,email,created_at,updated_at) VALUES('u','u','fixture@example.invalid','now','now');
    INSERT INTO shared_spaces(id,title,created_by,created_at,updated_at) VALUES('s','Legacy','u','now','now');
    INSERT INTO shared_projects(id,space_id,title,created_at,updated_at) VALUES('p','s','A','now','now');
    INSERT INTO shared_project_statuses(id,project_id,title,position) VALUES('open','p','Open',0);
    INSERT INTO shared_tasks(id,project_id,status_id,title,created_at,updated_at) VALUES('task','p','open','opaque legacy ciphertext','now','now');");
$before=$db->query('SELECT * FROM shared_tasks')->fetchAll();$backup=tempnam(sys_get_temp_dir(),'genesis-pre-workflow-');
try{
    $db->exec('VACUUM INTO '.$db->quote($backup));$db->beginTransaction();$db->exec((string)file_get_contents(__DIR__.'/../migrations/078_shared_workflows.sql'));
    try{$db->exec('SELECT * FROM deliberately_missing_workflow_table');}catch(PDOException){$db->rollBack();}
    wmCheck(!$db->query("SELECT 1 FROM sqlite_master WHERE name='shared_project_workflows'")->fetchColumn(),'Partial migration survived rollback');
    wmMigrate($db,'078_shared_workflows.sql');wmMigrate($db,'078_shared_workflows.sql');wmCheck($before===$db->query('SELECT * FROM shared_tasks')->fetchAll(),'Migration changed task data');
    wmCheck((int)$db->query("SELECT COUNT(*) FROM schema_migrations WHERE name='078_shared_workflows.sql'")->fetchColumn()===1,'Startup reapplied migration');
    wmCheck((int)$db->query('SELECT COUNT(*) FROM shared_project_workflows')->fetchColumn()===0,'Migration enabled workflows for legacy projects');
    $db->exec("INSERT INTO shared_project_workflows VALUES('p',1,'opaque workflow ciphertext',1,'now','u'); INSERT INTO shared_project_workflow_versions VALUES('p',1,1,'opaque version ciphertext','now','u'); UPDATE shared_tasks SET title='Legacy code edit',revision=revision+1 WHERE id='task';");
    wmCheck($db->query("SELECT definition_json FROM shared_project_workflows WHERE project_id='p'")->fetchColumn()==='opaque workflow ciphertext','Old code edit erased workflow');
    $db->exec("UPDATE shared_project_workflows SET enabled=0 WHERE project_id='p'");wmCheck((int)$db->query('SELECT COUNT(*) FROM shared_project_workflow_versions')->fetchColumn()===1,'Disabling erased history');
    wmCheck($db->query('PRAGMA foreign_key_check')->fetchAll()===[],'Foreign keys broken');$db->exec("DELETE FROM shared_projects WHERE id='p'");
    wmCheck((int)$db->query('SELECT COUNT(*) FROM shared_project_workflows')->fetchColumn()===0&&(int)$db->query('SELECT COUNT(*) FROM shared_project_workflow_versions')->fetchColumn()===0,'Cascade left orphan workflow');
    $copy=new PDO('sqlite:'.$backup,null,null,$settings);wmCheck($copy->query('SELECT * FROM shared_tasks')->fetchAll()===$before,'Consistent backup changed');wmCheck(!$copy->query("SELECT 1 FROM sqlite_master WHERE name='shared_project_workflows'")->fetchColumn(),'Backup contains new schema');$copy=null;
    echo "Workflow migration: backup, atomic rollback, repeated startup, opt-in, old-code preservation, FK/cascade passed. Old servers retain pre-workflow semantics; disable rules before reverting past078.\n";
}finally{if($db->inTransaction())$db->rollBack();if(is_file($backup))unlink($backup);}
