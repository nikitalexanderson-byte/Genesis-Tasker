<?php
declare(strict_types=1);
// Pure synthetic SQLite. Loading the function declarations never opens application configuration.
require __DIR__.'/../src/bootstrap.php';
require __DIR__.'/../src/shared-projects.php';
function mrCheck(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);}
function mrReject(callable $action):void{
    try{$action();}catch(GenesisSharedAccessException $error){mrCheck($error->status===409&&$error->getMessage()==='SHARED_REQUEST_ID_CONFLICT','Unexpected receipt conflict');return;}
    throw new RuntimeException('Changed receipt payload was accepted');
}
function mrMigrate(PDO $db,string $through):void{
    $db->exec('CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL)');
    $files=glob(__DIR__.'/../migrations/*.sql');sort($files,SORT_STRING);
    foreach($files as $file){$name=basename($file);if(strcmp($name,$through)>0)continue;
        $q=$db->prepare('SELECT 1 FROM schema_migrations WHERE name=?');$q->execute([$name]);$exists=$q->fetchColumn();$q->closeCursor();if($exists)continue;
        $db->beginTransaction();try{$db->exec((string)file_get_contents($file));$db->prepare('INSERT INTO schema_migrations VALUES(?,?)')->execute([$name,'fixture']);$db->commit();}
        catch(Throwable $error){$db->rollBack();throw $error;}
    }
}
$db=new PDO('sqlite::memory:',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
$db->exec('PRAGMA foreign_keys=ON');mrMigrate($db,'081_daily_advice_rotation.sql');
$db->exec("INSERT INTO users(id,google_sub,email,created_at,updated_at) VALUES('u','u','fixture@example.invalid','now','now')");
$legacy=['id'=>'legacy-task','title'=>'Original'];
$insert=$db->prepare('INSERT INTO shared_mutation_receipts(user_id,request_id,action,resource_id,response_json,created_at) VALUES(?,?,?,?,?,?)');
$insert->execute(['u','legacy','task.create','p',json_encode($legacy,JSON_THROW_ON_ERROR),'fixture']);
$before=$db->query('SELECT * FROM shared_mutation_receipts')->fetchAll();$backup=tempnam(sys_get_temp_dir(),'genesis-pre-receipt-');
try{
    $db->exec('VACUUM INTO '.$db->quote($backup));
    $db->beginTransaction();$db->exec((string)file_get_contents(__DIR__.'/../migrations/082_shared_mutation_payload_hash.sql'));$db->rollBack();
    mrCheck(!in_array('payload_hash',array_column($db->query('PRAGMA table_info(shared_mutation_receipts)')->fetchAll(),'name'),true),'Partial migration was not rolled back');
    mrMigrate($db,'082_shared_mutation_payload_hash.sql');mrMigrate($db,'082_shared_mutation_payload_hash.sql');
    $after=$db->query('SELECT user_id,request_id,action,resource_id,response_json,created_at FROM shared_mutation_receipts')->fetchAll();
    mrCheck($after===$before,'Additive migration changed legacy records');
    // Released code uses named columns and can still write a legacy receipt after the migration.
    $insert->execute(['u','old-writer','task.create','p',json_encode($legacy,JSON_THROW_ON_ERROR),'fixture']);
    $input=['requestId'=>'first','title'=>'New task','priority'=>0,'customFields'=>['b'=>false,'a'=>['value'=>3,'label'=>'Custom']]];
    $scope=['projectId'=>'p'];$hash=genesisSharedMutationPayloadHash('task.create',$input,$scope);
    $reordered=['customFields'=>['a'=>['label'=>'Custom','value'=>3],'b'=>false],'priority'=>0,'title'=>'New task','requestId'=>'different','csrf'=>'excluded authentication metadata','ignored'=>true];
    mrCheck($hash===genesisSharedMutationPayloadHash('task.create',$reordered,$scope),'Object order, transport ID or ignored metadata changed the digest');
    mrCheck($hash!==genesisSharedMutationPayloadHash('task.create',$input,['projectId'=>'other']),'Route scope was omitted');
    $variants=[];foreach([[],['priority'=>null],['priority'=>false],['priority'=>0]] as $value)$variants[]=genesisSharedMutationPayloadHash('task.update',$value,$scope);
    mrCheck(count(array_unique($variants))===4,'Omitted, null, false and zero collapsed');
    mrCheck(genesisSharedMutationPayloadHash('task.update',['checklists'=>[['id'=>'a'],['id'=>'b']]],$scope)!==genesisSharedMutationPayloadHash('task.update',['checklists'=>[['id'=>'b'],['id'=>'a']]],$scope),'Meaningful list order was discarded');
    $response=['id'=>'new-task','revision'=>1,'customFields'=>['b'=>false,'a'=>0]];
    genesisSharedSaveMutationReceipt($db,'u','new','task.create','p',$response,$hash);
    $read=genesisSharedMutationReceipt($db,'u','new','task.create','p',$hash);
    mrCheck($read['id']==='new-task'&&$read['revision']===1&&(array)$read['customFields']===$response['customFields'],'Same operation replay lost the original result');
    mrReject(fn()=>genesisSharedMutationReceipt($db,'u','new','task.create','p',genesisSharedMutationPayloadHash('task.create',[...$input,'title'=>'Changed'],$scope)));
    mrReject(fn()=>genesisSharedMutationReceipt($db,'u','new','task.create','p'));
    mrReject(fn()=>genesisSharedMutationReceipt($db,'u','new','task.update','p',$hash));
    mrReject(fn()=>genesisSharedMutationReceipt($db,'u','new','task.create','other',$hash));
    mrCheck(genesisSharedMutationReceipt($db,'u','legacy','task.create','p',$hash)===$legacy&&genesisSharedMutationReceipt($db,'u','old-writer','task.create','p',$hash)===$legacy,'Legacy replay compatibility was lost');
    $actions=[
        'status.create'=>['title'=>'Status'],'task.create'=>['title'=>'Task'],'task.update'=>['priority'=>2],'task.move'=>['position'=>3],
        'checklist.convert'=>['itemId'=>'item'],'series.create'=>['settings'=>['limit'=>3]],'series.update'=>['paused'=>true],'series.skip'=>['seriesId'=>'series'],
        'task.archive'=>['archived'=>true],'task.unarchive'=>['expectedRevision'=>2],'task.trash'=>['retentionDays'=>7],'task.purge'=>['expectedExpiresAt'=>'date'],
        'trash.restore'=>['expectedExpiresAt'=>'date'],'trash.retention'=>['retentionDays'=>3],'view.create'=>['definition'=>['title'=>'View']],'view.update'=>['definition'=>['title'=>'View']],'view.delete'=>['expectedRevision'=>1],
    ];
    foreach($actions as $action=>$data){$empty=genesisSharedMutationPayloadHash($action,[]);mrCheck($empty!==genesisSharedMutationPayloadHash($action,$data),'Meaningful field missing from '.$action);}
    mrCheck($db->query('PRAGMA foreign_key_check')->fetchAll()===[],'Foreign keys broken');
    $restored=new PDO('sqlite:'.$backup,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    mrCheck($restored->query('SELECT * FROM shared_mutation_receipts')->fetchAll()===$before,'Runtime backup cannot restore the pre-migration records');$restored=null;
    echo "Shared receipt082: additive migration, partial rollback, repeated startup, consistent backup, old writer/replay, canonical scope/payload, null/false/zero/list distinctions, all17 actions and409 reuse rejection passed.\n";
}finally{if($db->inTransaction())$db->rollBack();if(is_file($backup))unlink($backup);}
