<?php
declare(strict_types=1);
// Isolated in-memory database and a disposable encryption key; never load server/config.php.
$testRoot=sys_get_temp_dir().'/genesis-inbox-test-'.bin2hex(random_bytes(6));mkdir($testRoot,0700);
$configPath=$testRoot.'/config.php';
file_put_contents($configPath,'<?php return '.var_export(['crypto_key'=>base64_encode(random_bytes(32)),'timezone'=>'UTC',
    'session_path'=>$testRoot,'cookie_secure'=>false],true).';');
define('GENESIS_LOCAL_TEST_CONFIG',$configPath);
require dirname(__DIR__).'/src/bootstrap.php';
require dirname(__DIR__).'/src/shared-content-storage.php';
function inboxExpect(bool $condition,string $message):void { if(!$condition)throw new RuntimeException($message); }
$db=new PDO('sqlite::memory:',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
$db->exec('PRAGMA foreign_keys=ON');
genesisRegisterSharedContentFunctions($db);
$backupPath=tempnam(sys_get_temp_dir(),'genesis-inbox-backup-');
try {
    foreach(glob(dirname(__DIR__).'/migrations/*.sql') as $file)if(basename($file)<'086_')$db->exec(file_get_contents($file));
    $db->exec("INSERT INTO users(id,google_sub,email,created_at,updated_at) VALUES('u','u','fixture@example.test','2026-01-01','2026-01-01');
      INSERT INTO shared_spaces(id,title,created_by,created_at,updated_at) VALUES('s','Space','u','2026-01-01','2026-01-01'),('empty','No project','u','2026-01-01','2026-01-01');
      INSERT INTO shared_space_members(space_id,user_id,role,joined_at) VALUES('s','u','owner','2026-01-01'),('empty','u','owner','2026-01-01');
      INSERT INTO shared_projects(id,space_id,title,is_inbox,created_by,created_at,updated_at) VALUES
        ('i','s','Legacy inbox',1,'u','2026-01-01','2026-01-01'),('p','s','First project',0,'u','2026-01-02','2026-01-02'),
        ('later','s','Later project',0,'u','2026-01-03','2026-01-03'),('ei','empty','Inbox',1,'u','2026-01-01','2026-01-01');
      INSERT INTO shared_project_members(project_id,user_id,role,joined_at) SELECT id,'u','owner','2026-01-01' FROM shared_projects;
      INSERT INTO shared_project_statuses(id,project_id,title,position,is_done) VALUES('io','i','Open',0,0),('id','i','Done',1,1),('po','p','Board',0,0),('eo','ei','Open',0,0);
      INSERT INTO shared_tasks(id,project_id,status_id,title,description,due_date,completed_at,created_by,updated_by,revision,created_at,updated_at)
      VALUES('t','i','io','Private task','Original details','2026-10-30',NULL,'u','u',4,'2026-01-01','2026-10-01'),
        ('child','i','io','Child','Keep relation',NULL,NULL,'u','u',2,'2026-01-01','2026-10-01'),
        ('done','i','id','Done task','Keep completion',NULL,'2026-10-01','u','u',3,'2026-01-01','2026-10-01'),
        ('et','ei','eo','Recover me','Keep me',NULL,NULL,'u','u',1,'2026-01-01','2026-10-01'),
        ('existing','p','po','Existing project task','No changes',NULL,NULL,'u','u',2,'2026-01-01','2026-10-01');
      UPDATE shared_tasks SET parent_task_id='t',checklists_json='[{\"id\":\"list\",\"title\":\"Checklist\",\"items\":[]}]' WHERE id='child';
      INSERT INTO shared_comments(id,task_id,author_id,body,created_at) VALUES('comment','t','u','Keep comment','2026-01-01');
      INSERT INTO shared_task_dependencies(task_id,predecessor_id) VALUES('child','t');
      INSERT INTO shared_projects(id,space_id,title,kind,parent_id,created_by,created_at,updated_at) VALUES('list','s','Task list','task-list','i','u','2026-01-01','2026-01-01');
      INSERT INTO shared_project_categories(id,project_id,title,color,position) VALUES('category','i','Preserved category','#123456',0);
      UPDATE shared_tasks SET category_id='category' WHERE id='t';
      INSERT INTO shared_custom_fields(id,space_id,project_id,type,definition_json,required,created_at,updated_at)
        VALUES('field','s','i','text','{\"title\":\"Historical field\"}',1,'2026-01-01','2026-01-01');
      INSERT INTO shared_custom_field_values(task_id,field_id,value_json) VALUES('t','field','\"Preserved value\"');
      INSERT INTO shared_task_series(id,project_id,source_task_id,owner_id,rule_json,template_json,cursor_date,created_at,updated_at)
        VALUES('series','i','t','u','{}','[]','2026-10-28','2026-01-01','2026-01-01')");
    genesisInitializeSharedContentStorage($db);genesisInitializeSharedTrashReadView($db);
    genesisInitializeSharedMapProjectIndex($db);genesisInitializeSharedTaskDetails($db);
    $before=$db->query('SELECT * FROM shared_tasks_read ORDER BY id')->fetchAll();
    $encrypted=$db->query("SELECT title,description FROM shared_tasks WHERE id='t'")->fetch();
    inboxExpect(str_starts_with($encrypted['title'],GENESIS_SHARED_CONTENT_PREFIX),'Fixture content must be encrypted');
    $db->exec('VACUUM INTO '.$db->quote($backupPath));
    $db->beginTransaction();$db->exec(file_get_contents(dirname(__DIR__).'/migrations/086_shared_project_inboxes.sql'));$db->commit();
    $after=$db->query('SELECT * FROM shared_tasks_read ORDER BY id')->fetchAll();
    foreach($after as $index=>$row)foreach($row as $key=>$value)if(!in_array($key,['project_id','status_id','revision','updated_at'],true))
        inboxExpect($value===$before[$index][$key],'Changed task field: '.$row['id'].'/'.$key);
    inboxExpect($db->query("SELECT project_id FROM shared_tasks WHERE id='t'")->fetchColumn()==='p','Move to first real project');
    inboxExpect($db->query("SELECT status_id FROM shared_tasks WHERE id='done'")->fetchColumn()==='chaos-done:p','Completed state stays completed in inbox');
    inboxExpect($db->query("SELECT project_id FROM shared_tasks WHERE id='et'")->fetchColumn()==='recovered-project:empty','Create project when none exists');
    inboxExpect($db->query("SELECT parent_id FROM shared_projects WHERE id='list'")->fetchColumn()==='p','Task list moves inside project');
    inboxExpect($db->query("SELECT body FROM shared_comments_read WHERE id='comment'")->fetchColumn()==='Keep comment','Comment survives');
    inboxExpect((int)$db->query('SELECT COUNT(*) FROM shared_task_dependencies')->fetchColumn()===1,'Dependencies survive');
    inboxExpect($db->query("SELECT project_id FROM shared_project_categories WHERE id='category'")->fetchColumn()==='p','Category scope follows task');
    inboxExpect($db->query("SELECT project_id FROM shared_custom_fields WHERE id='field'")->fetchColumn()==='p','Field scope follows task');
    inboxExpect((int)$db->query("SELECT required FROM shared_custom_fields WHERE id='field'")->fetchColumn()===0,'Moved field does not constrain existing destination tasks');
    inboxExpect((int)$db->query("SELECT original_required FROM shared_workspace_scope_relocations WHERE kind='field' AND object_id='field'")->fetchColumn()===1,'Field requirement is journalled');
    inboxExpect($db->query("SELECT value_json FROM shared_custom_field_values WHERE task_id='t' AND field_id='field'")->fetchColumn()==='"Preserved value"','Custom value survives');
    inboxExpect($db->query("SELECT project_id FROM shared_task_series WHERE id='series'")->fetchColumn()==='p','Series moves with source');
    inboxExpect($db->query("SELECT template_json FROM shared_task_series WHERE id='series'")->fetchColumn()==='[]','Saved series template stays unchanged');
    inboxExpect($db->query("SELECT user_id,role,joined_at FROM shared_project_members WHERE project_id='recovered-project:empty'")->fetch()===
        $db->query("SELECT user_id,role,joined_at FROM shared_project_members WHERE project_id='ei'")->fetch(),'Recovery project retains audience and roles');
    inboxExpect($db->query("SELECT title,description FROM shared_tasks WHERE id='t'")->fetch()===$encrypted,'Encrypted bytes are unchanged');
    inboxExpect((int)$db->query('SELECT COUNT(*) FROM shared_workspace_task_relocations')->fetchColumn()===4,'Every original placement is journalled');
    $unchanged=array_values(array_filter($after,static fn($row)=>$row['id']==='existing'))[0];
    inboxExpect((int)$unchanged['revision']===2 && $unchanged['status_id']==='po','Existing project tasks are untouched');
    foreach(["UPDATE shared_tasks SET project_id='i' WHERE id='t'", "INSERT INTO shared_tasks(id,project_id,status_id,title,created_at,updated_at) VALUES('blocked','i','io','Blocked','now','now')"] as $sql){
        try{$db->exec($sql);throw new RuntimeException('Root write accepted');}catch(PDOException $error){inboxExpect(str_contains($error->getMessage(),'SHARED_PROJECT_REQUIRED'),'Unexpected root write error');}
    }
    inboxExpect(!$db->query('PRAGMA foreign_key_check')->fetch(),'Foreign keys remain valid');
    $backup=new PDO('sqlite:'.$backupPath);inboxExpect($backup->query("SELECT project_id FROM shared_tasks WHERE id='t'")->fetchColumn()==='i','Backup remains before migration');$backup=null;
    echo "Project inbox migration: encrypted content, comments, relations, first-project placement, fallback project, completion, journal, backup and root-write guards passed.\n";
} finally { $db=null; if(is_file($backupPath))unlink($backupPath);session_destroy();session_write_close();foreach(glob($testRoot.'/*') as $file)if(is_file($file))unlink($file);rmdir($testRoot); }
