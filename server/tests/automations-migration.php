<?php
declare(strict_types=1);
// Pure synthetic SQLite. Does not read application configuration or runtime data.
function amCheck(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);}
function amMigrate(PDO $db,string $through):void{
    $db->exec('CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL)');$files=glob(__DIR__.'/../migrations/*.sql');sort($files,SORT_STRING);
    foreach($files as $file){$name=basename($file);if(strcmp($name,$through)>0)continue;$q=$db->prepare('SELECT 1 FROM schema_migrations WHERE name=?');$q->execute([$name]);if($q->fetchColumn())continue;
        $db->beginTransaction();try{$db->exec((string)file_get_contents($file));$db->prepare('INSERT INTO schema_migrations VALUES(?,?)')->execute([$name,'fixture']);$db->commit();}catch(Throwable $error){$db->rollBack();throw $error;}
    }
}
$options=[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC];$db=new PDO('sqlite::memory:',null,null,$options);$db->exec('PRAGMA foreign_keys=ON');amMigrate($db,'074_shared_task_query_cascade.sql');
$db->exec("INSERT INTO users(id,google_sub,email,created_at,updated_at) VALUES('u','u','fixture@example.invalid','now','now');
 INSERT INTO shared_spaces(id,title,created_by,created_at,updated_at) VALUES('s','Legacy space','u','now','now');
 INSERT INTO shared_space_members(space_id,user_id,role,joined_at) VALUES('s','u','owner','now');
 INSERT INTO shared_projects(id,space_id,title,created_at,updated_at) VALUES('p','s','Legacy project','now','now');
 INSERT INTO shared_project_statuses(id,project_id,title,position) VALUES('st','p','Open',0);
 INSERT INTO shared_tasks(id,project_id,status_id,title,created_at,updated_at) VALUES('t','p','st','Opaque ciphertext','now','now');
 INSERT INTO background_jobs(id,kind,unique_key,payload,available_at,created_at,updated_at) VALUES('j','shared-series','old-key','opaque payload','now','now','now');");
$before=[];foreach(['users','shared_spaces','shared_projects','shared_tasks','shared_space_members','background_jobs'] as $table)$before[$table]=$db->query('SELECT * FROM '.$table)->fetchAll();
$path=tempnam(sys_get_temp_dir(),'genesis-pre-automations-');
try{
    $db->exec('VACUUM INTO '.$db->quote($path));$db->beginTransaction();$db->exec((string)file_get_contents(__DIR__.'/../migrations/075_shared_automations.sql'));
    try{$db->exec('SELECT * FROM deliberately_missing_c2_table');}catch(PDOException){$db->rollBack();}
    amCheck((int)$db->query("SELECT COUNT(*) FROM sqlite_master WHERE name='shared_automation_rules'")->fetchColumn()===0,'Partial migration was not rolled back');
    amMigrate($db,'075_shared_automations.sql');amMigrate($db,'075_shared_automations.sql');
    foreach($before as $table=>$rows)amCheck($db->query('SELECT * FROM '.$table)->fetchAll()===$rows,'Migration rewrote legacy '.$table);
    $db->exec("INSERT INTO shared_automation_rules(id,project_id,owner_id,title,definition_json,checked_at,created_at,updated_at) VALUES('rule','p','u','opaque title','opaque definition','now','now','now');
      INSERT INTO shared_automation_runs(id,rule_id,rule_revision,trigger_key,task_id,chain_id,payload_json,state,created_at) VALUES('run','rule',1,'event:original','t','chain','opaque payload','pending','now');");
    $duplicate=false;try{$db->exec("INSERT INTO shared_automation_runs(id,rule_id,rule_revision,trigger_key,chain_id,payload_json,state,created_at) VALUES('again','rule',1,'event:original','chain','opaque','pending','now')");}catch(PDOException){$duplicate=true;}amCheck($duplicate,'Trigger replay was not unique');
    $db->exec("UPDATE shared_tasks SET title='Legacy client edit' WHERE id='t'");amCheck($db->query("SELECT enabled FROM shared_automation_rules WHERE id='rule'")->fetchColumn()===0,'Existing data enabled a new rule');
    $db->exec("DELETE FROM users WHERE id='u'");amCheck($db->query("SELECT owner_id FROM shared_automation_rules WHERE id='rule'")->fetchColumn()===null,'Deleted owner retained execution identity');
    $db->exec("DELETE FROM shared_projects WHERE id='p'");amCheck((int)$db->query('SELECT COUNT(*) FROM shared_automation_runs')->fetchColumn()===0,'Project deletion left executable runs');amCheck($db->query('PRAGMA foreign_key_check')->fetchAll()===[],'Foreign keys broken');
    $backup=new PDO('sqlite:'.$path,null,null,$options);amCheck($backup->query('SELECT * FROM shared_tasks')->fetchAll()===$before['shared_tasks'],'Consistent pre-migration backup changed');amCheck((int)$backup->query("SELECT COUNT(*) FROM sqlite_master WHERE name='shared_automation_rules'")->fetchColumn()===0,'Backup unexpectedly contains new schema');$backup=null;
    echo "Automation migration075: additive upgrade from074, rollback of partial failure, repeated startup, consistent backup, old-code writes, opt-in defaults, replay uniqueness and owner/project removal passed.\n";
}finally{if(is_file($path))unlink($path);}
