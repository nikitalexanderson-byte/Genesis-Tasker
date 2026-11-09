<?php
declare(strict_types=1);
// In-memory SQL plus one owned temporary backup; never opens application configuration.
if(PHP_SAPI!=='cli')exit(1);
function rqmCheck(bool $ok,string $message):void {if(!$ok)throw new RuntimeException($message);}
function rqmReject(callable $action):void {
    try{$action();}catch(PDOException $error){rqmCheck(str_contains($error->getMessage(),'GENESIS_QUOTA_EXCEEDED'),'Unexpected SQL rejection');return;}
    throw new RuntimeException('Root storage guard was bypassed');
}
$options=[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC];
$db=new PDO('sqlite::memory:',null,null,$options);$db->exec('PRAGMA foreign_keys=ON');
$files=glob(__DIR__.'/../migrations/*.sql');sort($files,SORT_STRING);
foreach($files as $file){if(strcmp(basename($file),'103_shared_root_project_capacity.sql')>=0)break;$db->exec((string)file_get_contents($file));}
$db->exec("INSERT INTO users(id,google_sub,email,created_at,updated_at) VALUES('u','u','quota@example.invalid','now','now');
INSERT INTO shared_spaces(id,title,created_by,created_at,updated_at) VALUES('s','Legacy','u','now','now'),('other','Other','u','now','now');
INSERT INTO shared_space_members(space_id,user_id,role,joined_at) VALUES('s','u','owner','now'),('other','u','owner','now');
INSERT INTO shared_projects(id,space_id,title,created_at,updated_at) VALUES('root','s','Preserved root','now','now');
INSERT INTO shared_projects(id,space_id,parent_id,title,created_at,updated_at) VALUES('child','s','root','Preserved child','now','now');");
$rows=$db->query('SELECT * FROM shared_projects ORDER BY id')->fetchAll();
$triggers=$db->query("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name")->fetchAll();
$migration=(string)file_get_contents(__DIR__.'/../migrations/103_shared_root_project_capacity.sql');
$backupPath=tempnam(sys_get_temp_dir(),'genesis-root-quota-backup-');
try{
    $db->exec('VACUUM INTO '.$db->quote($backupPath));
    $db->beginTransaction();$db->exec($migration);$db->rollBack();
    rqmCheck($db->query("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name")->fetchAll()===$triggers,'Failed migration changed triggers');
    rqmCheck((int)$db->query("SELECT COUNT(*) FROM sqlite_master WHERE name='shared_projects_owner_roots'")->fetchColumn()===0,'Failed migration retained index');
    $db->beginTransaction();$db->exec($migration);$db->commit();
    rqmCheck($db->query('SELECT * FROM shared_projects ORDER BY id')->fetchAll()===$rows,'Migration rewrote existing projects');
    $db->exec("UPDATE resource_quota_limits SET amount=2 WHERE name IN('projects_per_space','projects_per_user')");
    $insert=$db->prepare("INSERT INTO shared_projects(id,space_id,parent_id,title,created_at,updated_at) VALUES(?,'s','root','Nested','now','now')");
    $db->beginTransaction();for($i=0;$i<2100;$i++)$insert->execute(['nested-'.$i]);$db->commit();
    rqmCheck((int)$db->query('SELECT COUNT(*) FROM shared_projects')->fetchColumn()===2102,'Nested nodes were capped by former 500/2000 ceiling');
    $db->exec("INSERT INTO shared_projects(id,space_id,title,created_at,updated_at) VALUES('root-2','other','Second root','now','now')");
    rqmReject(fn()=>$db->exec("INSERT INTO shared_projects(id,space_id,title,created_at,updated_at) VALUES('root-3','s','Rejected','now','now')"));
    rqmReject(fn()=>$db->exec("UPDATE shared_projects SET parent_id=NULL WHERE id='child'"));
    $db->exec("UPDATE shared_projects SET title='Old client write' WHERE id='root'; UPDATE shared_projects SET space_id='s',parent_id='root' WHERE id='root-2'; UPDATE shared_projects SET parent_id=NULL WHERE id='child'");
    rqmCheck((int)$db->query("SELECT COUNT(*) FROM shared_projects WHERE parent_id IS NULL AND is_inbox=0 AND kind='project'")->fetchColumn()===2,'Root demotion/promotion changed capacity incorrectly');
    rqmCheck($db->query('PRAGMA foreign_key_check')->fetchAll()===[],'Migration broke foreign keys');
    $backup=new PDO('sqlite:'.$backupPath,null,null,$options);
    rqmCheck($backup->query('SELECT * FROM shared_projects ORDER BY id')->fetchAll()===$rows,'Consistent backup lost pre-migration state');
    rqmCheck($backup->query("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name")->fetchAll()===$triggers,'Backup contains new trigger definitions');
    $backup=null;
    // Both storage guards still reject an explicit promotion. FK orphaning is a deletion side effect.
    $db->exec("UPDATE resource_quota_limits SET amount=2000 WHERE name='projects_per_user'");
    rqmReject(fn()=>$db->exec("UPDATE shared_projects SET parent_id=NULL WHERE id='nested-0'"));
    $db->exec("UPDATE resource_quota_limits SET amount=500 WHERE name='projects_per_space'; UPDATE resource_quota_limits SET amount=2 WHERE name='projects_per_user'");
    rqmReject(fn()=>$db->exec("UPDATE shared_projects SET parent_id=NULL WHERE id='nested-0'"));
    $db->exec("DELETE FROM shared_spaces WHERE id='s'");
    rqmCheck((int)$db->query('SELECT COUNT(*) FROM shared_projects')->fetchColumn()===0,'Cascade deletion retained/promoted descendants');
    rqmCheck($db->query('PRAGMA foreign_key_check')->fetchAll()===[],'Cascade deletion broke foreign keys');
    echo "PASS migration103: preserved rows, transactional rollback, consistent backup, old-code writes, 2100 nested nodes, independent root storage guards, explicit promotion and FK cascade deletion.\n";
}finally{if(is_file($backupPath))unlink($backupPath);}
