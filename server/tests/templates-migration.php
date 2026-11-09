<?php
declare(strict_types=1);
// Pure SQLite schema fixtures. No application configuration, tokens or production data.
function c1mCheck(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);}
function c1mMigrate(PDO $db,string $through):void
{
    $db->exec('CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL)');
    $files=glob(__DIR__.'/../migrations/*.sql');sort($files,SORT_STRING);
    foreach($files as $file){$name=basename($file);if(strcmp($name,$through)>0)continue;
        $q=$db->prepare('SELECT 1 FROM schema_migrations WHERE name=?');$q->execute([$name]);$exists=$q->fetchColumn();$q->closeCursor();if($exists)continue;
        $db->beginTransaction();try{$db->exec((string)file_get_contents($file));$db->prepare('INSERT INTO schema_migrations VALUES(?,?)')->execute([$name,'fixture']);$db->commit();}
        catch(Throwable $error){$db->rollBack();throw $error;}
    }
}
$settings=[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC];$db=new PDO('sqlite::memory:',null,null,$settings);$db->exec('PRAGMA foreign_keys=ON');
c1mMigrate($db,'072_shared_custom_fields.sql');
$db->exec("INSERT INTO users(id,google_sub,email,created_at,updated_at) VALUES('u','u','fixture@example.invalid','now','now');
 INSERT INTO shared_spaces(id,title,created_by,created_at,updated_at) VALUES('s','Legacy space','u','now','now');
 INSERT INTO shared_space_members(space_id,user_id,role,joined_at) VALUES('s','u','owner','now');
 INSERT INTO shared_projects(id,space_id,title,created_at,updated_at) VALUES('p','s','Legacy project','now','now');
 INSERT INTO shared_project_statuses(id,project_id,title,position) VALUES('st','p','Open',0);
 INSERT INTO shared_tasks(id,project_id,status_id,title,created_at,updated_at) VALUES('parent','p','st','Opaque legacy parent','now','now'),('child','p','st','Opaque legacy child','now','now');
 UPDATE shared_tasks SET parent_task_id='parent',priority=2 WHERE id='child';
 INSERT INTO shared_custom_fields(id,space_id,project_id,type,definition_json,created_at,updated_at) VALUES('f','s','p','checkbox','opaque field ciphertext','now','now');
 INSERT INTO shared_custom_field_values VALUES('parent','f','false');
 INSERT INTO shared_member_project_grants(space_id,user_id,project_id,role,include_descendants) VALUES('s','u','p','member',1);");
$before=[];foreach(['users','shared_spaces','shared_space_members','shared_projects','shared_tasks','shared_custom_fields','shared_custom_field_values','shared_member_project_grants'] as $table)$before[$table]=$db->query('SELECT * FROM '.$table)->fetchAll();
$path=tempnam(sys_get_temp_dir(),'genesis-pre-templates-');
try{
    $db->exec('VACUUM INTO '.$db->quote($path));
    $db->beginTransaction();$db->exec((string)file_get_contents(__DIR__.'/../migrations/073_shared_templates.sql'));
    try{$db->exec('SELECT * FROM deliberately_missing_c1_table');}catch(PDOException){$db->rollBack();}
    c1mCheck((int)$db->query("SELECT COUNT(*) FROM sqlite_master WHERE name='shared_templates'")->fetchColumn()===0,'Partial template migration was not atomic');
    c1mMigrate($db,'074_shared_task_query_cascade.sql');c1mMigrate($db,'074_shared_task_query_cascade.sql');
    foreach($before as $table=>$rows)c1mCheck($db->query('SELECT * FROM '.$table)->fetchAll()===$rows,'Upgrade changed '.$table);
    c1mCheck((int)$db->query("SELECT COUNT(*) FROM schema_migrations WHERE name='073_shared_templates.sql'")->fetchColumn()===1,'Repeated startup re-applied template schema');
    $db->exec("INSERT INTO shared_templates(id,space_id,project_id,owner_id,title,kind,manifest_json,source_notices_json,project_count,task_count,created_at,updated_at) VALUES('t','s','p','u','opaque title','project','opaque manifest','opaque notices',1,2,'now','now');
        INSERT INTO shared_template_sources VALUES('t','p');INSERT INTO shared_template_operations VALUES('u','operation','template.apply','hash','opaque receipt','now');
        UPDATE shared_tasks SET title='Legacy client edit' WHERE id='parent';");
    c1mCheck($db->query("SELECT value_json FROM shared_custom_field_values WHERE task_id='parent'")->fetchColumn()==='false','Old-client update erased typed field data');
    c1mCheck($db->query("SELECT parent_task_id FROM shared_tasks WHERE id='child'")->fetchColumn()==='parent','Code rollback lost child relation');
    $db->exec("DELETE FROM shared_projects WHERE id='p'");
    c1mCheck((int)$db->query('SELECT COUNT(*) FROM shared_tasks')->fetchColumn()===0,'Project cascade left children');
    c1mCheck((int)$db->query('SELECT COUNT(*) FROM shared_task_query_versions')->fetchColumn()===0,'Cascade recreated paging metadata for a missing project');
    c1mCheck((int)$db->query('SELECT COUNT(*) FROM shared_template_sources')->fetchColumn()===1,'Source deletion erased ACL evidence');
    $db->exec("DELETE FROM shared_spaces WHERE id='s';DELETE FROM users WHERE id='u'");
    c1mCheck((int)$db->query('SELECT COUNT(*) FROM shared_templates')->fetchColumn()===0&&(int)$db->query('SELECT COUNT(*) FROM shared_template_operations')->fetchColumn()===0,'Template content or receipts survived owner/space deletion');
    c1mCheck(!$db->query('PRAGMA foreign_key_check')->fetch(),'Upgrade broke foreign keys');
    $backup=new PDO('sqlite:'.$path,null,null,$settings);c1mCheck($backup->query('PRAGMA integrity_check')->fetchColumn()==='ok','Backup integrity failure');
    foreach($before as $table=>$rows)c1mCheck($backup->query('SELECT * FROM '.$table)->fetchAll()===$rows,'Runtime backup changed '.$table);
    c1mCheck((int)$backup->query("SELECT COUNT(*) FROM sqlite_master WHERE name='shared_templates'")->fetchColumn()===0,'Pre-migration backup was modified');$backup=null;
    $fresh=new PDO('sqlite::memory:',null,null,$settings);$fresh->exec('PRAGMA foreign_keys=ON');c1mMigrate($fresh,'074_shared_task_query_cascade.sql');
    c1mCheck($fresh->query('PRAGMA integrity_check')->fetchColumn()==='ok'&&!$fresh->query('PRAGMA foreign_key_check')->fetch(),'Fresh schema failed');
    echo "Template migrations073/074: additive pre-072 upgrade, partial-failure rollback, repeated startup, consistent backup, legacy/code rollback, nested deletion and ACL evidence passed.\n";
}finally{if($db->inTransaction())$db->rollBack();if(is_file($path))unlink($path);}
