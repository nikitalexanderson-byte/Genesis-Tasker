<?php
declare(strict_types=1);
require __DIR__.'/e2ee-legacy-workspace.php';

function legacyTasksFixture(?callable $alter=null,string $mode='account',bool $recovered=true):array
{
    return legacyWorkspaceFixture($mode,false,null,static function(string $id)use($alter,$recovered):void{
        global $db;$now=genesisNow();
        $foreign=$id.'-foreign';
        $db->prepare('INSERT INTO users(id,google_sub,email,created_at,updated_at) VALUES(?,?,?,?,?)')->execute([$foreign,$foreign,$foreign.'@example.invalid',$now,$now]);
        $q=$db->prepare("INSERT INTO tasks(id,user_id,project_id,category_id,sacred_year,month_index,sacred_day,due_date,title,description,time_value,project_label,tags_json,done,completed_at,reminder_minutes,recurrence,recurrence_interval,sync_to_google,google_event_id,created_at,updated_at) VALUES(?,?,?,?,2026,0,1,'2026-03-20',?,?,'09:20','Synthetic project','[\"private tag\"]',1,?,NULL,'weekly',2,1,?,?,?)");
        foreach(['a','b']as $suffix)$q->execute([$id.'-'.$suffix,$id,'project-'.$id,'category-'.$id,'Synthetic task '.$suffix,'Exact private description',$now,'synthetic-google-'.$id.'-'.$suffix,$now,$now]);
        $q->execute([$foreign.'-task',$foreign,null,null,'FOREIGN PRIVATE TASK','FOREIGN PRIVATE DESCRIPTION',$now,null,$now,$now]);
        $db->prepare('INSERT INTO task_links(user_id,task_id,depends_on_task_id,created_at) VALUES(?,?,?,?)')->execute([$id,$id.'-a',$id.'-b',$now]);
        $db->prepare('INSERT INTO task_deletions(user_id,task_id,deleted_at) VALUES(?,?,?)')->execute([$id,$id.'-removed',$now]);
        $state='{ "phase": "prepared", "task": {"title":"Exact unsent task", "externalCopy":true} }';
        $db->prepare('INSERT INTO personal_task_creations(user_id,task_id,state) VALUES(?,?,?)')->execute([$id,$id.'-unsent',$state]);
        $db->prepare('INSERT INTO personal_task_creation_targets(user_id,task_id,target_key,recovery_token,attempted,provider_id,provider_key) VALUES(?,?,?,?,1,?,?)')
            ->execute([$id,$id.'-unsent','google:synthetic-list','synthetic-operation-'.$id,'synthetic-provider-id','synthetic-provider-key-'.$id]);
        if($recovered)$db->prepare('INSERT INTO personal_recovered_tasks(user_id,id,revision,iv,ciphertext,updated_at) VALUES(?,?,7,?,?,?)')
            ->execute([$id,$id.'-recovered',base64_encode(random_bytes(12)),base64_encode('synthetic recovered ciphertext'),$now]);
        $db->prepare('INSERT INTO personal_recovered_task_deletions(user_id,id,revision,updated_at) VALUES(?,?,8,?)')->execute([$id,$id.'-recovered-removed',$now]);
        if($alter)$alter($id);
    });
}
$f=legacyTasksFixture();$p=$f['payload'];$packet=storeCommand('legacy-tasks',$p);
$before=genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId));$changes=$db->query('SELECT total_changes()')->fetchColumn();
$source=genesisE2eeRead($owner,$packet,$session);
storeCheck($source['ownerId']===$owner&&$source['scopeId']===$scopeId&&$source['sourceHash']===$p['sourceHash']);
storeCheck(count($source['tasks'])===2&&$source['tasks'][0]['description']==='Exact private description'&&$source['tasks'][0]['tags_json']==='["private tag"]');
storeCheck($source['tasks'][0]['recurrence']==='weekly'&&$source['tasks'][0]['recurrence_interval']===2&&$source['tasks'][0]['reminder_minutes']===null&&$source['tasks'][0]['done']===1);
storeCheck($source['deletions'][0]['task_id']===$owner.'-removed'&&$source['links'][0]['depends_on_task_id']===$owner.'-b');
storeCheck($source['recovered'][0]['revision']===7&&$source['recovered'][0]['ciphertext']===base64_encode('synthetic recovered ciphertext')&&$source['recoveredDeletions'][0]['revision']===8);
storeCheck($source['creations'][0]['state']==='{ "phase": "prepared", "task": {"title":"Exact unsent task", "externalCopy":true} }');
storeCheck($source['creationTargets'][0]['attempted']===1&&$source['creationTargets'][0]['recovery_token']==='synthetic-operation-'.$owner);
storeCheck($source['legacyKey']===['keyMode'=>'account','key'=>$f['raw']]);
// Verify the actual schema, not another hand-maintained copy of reader columns.
foreach(['tasks'=>'tasks','deletions'=>'task_deletions','links'=>'task_links','recovered'=>'personal_recovered_tasks','recoveredDeletions'=>'personal_recovered_task_deletions','creations'=>'personal_task_creations','creationTargets'=>'personal_task_creation_targets']as $name=>$table){
    $expected=array_values(array_diff(array_column($db->query('PRAGMA table_info('.$table.')')->fetchAll(),'name'),['user_id']));
    $actual=array_keys($source[$name][0]);sort($expected);sort($actual);storeCheck($expected===$actual);
}
storeCheck(!str_contains(genesisE2eeJson($source),'FOREIGN PRIVATE'));
foreach(['sessions','identity','billing','orders','refresh_token','workspace_key_enc']as $field)storeCheck(!array_key_exists($field,$source));
storeCheck($before===genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId)));
storeCheck((int)$db->query('SELECT total_changes()')->fetchColumn()-(int)$changes===1);
storeCheck(genesisE2eeRead($owner,$packet,$session)===$source&&!$db->inTransaction());
storeReject(fn()=>genesisE2eeRead('foreign-owner',$packet,$session),'E2EE_SCOPE_FORBIDDEN');
foreach(['migrationId'=>'other','fence'=>2,'sourceHash'=>storeB64(random_bytes(32))]as $field=>$wrong)
    storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-tasks',array_replace($p,[$field=>$wrong])),$session),'E2EE_MIGRATION_FENCED');
$tampered=$packet;$tampered['signature']=storeB64(random_bytes(64));storeReject(fn()=>genesisE2eeRead($owner,$tampered,$session),'E2EE_UNTRUSTED_COMMAND');
$db->prepare('UPDATE e2ee_devices SET revoked=1 WHERE scope_id=?')->execute([$scopeId]);storeReject(fn()=>genesisE2eeRead($owner,$packet,$session),'E2EE_REVOKED_DEVICE');
$db->prepare('UPDATE e2ee_devices SET revoked=0 WHERE scope_id=?')->execute([$scopeId]);
foreach(['tasks'=>'description','task_links'=>'created_at','task_deletions'=>'deleted_at','personal_recovered_tasks'=>'ciphertext','personal_recovered_task_deletions'=>'updated_at','personal_task_creations'=>'state','personal_task_creation_targets'=>'target_key']as $table=>$field)
    storeReject(fn()=>$db->prepare('UPDATE '.$table.' SET '.$field.'=? WHERE user_id=?')->execute(['changed',$owner]),'E2EE_LEGACY_WRITE_FORBIDDEN');
genesisE2eeExecute($owner,storeCommand('migration-cancel',['migrationId'=>$p['migrationId'],'fence'=>1]),$session);storeReject(fn()=>genesisE2eeRead($owner,$packet,$session),'E2EE_MIGRATION_FENCED');
$f=legacyWorkspaceFixture('legacy',false);$empty=genesisE2eeRead($owner,storeCommand('legacy-tasks',$f['payload']),$session);
foreach(['tasks','deletions','links','recovered','recoveredDeletions','creations','creationTargets']as $field)storeCheck($empty[$field]===[]);
storeCheck($empty['legacyKey']===['keyMode'=>'empty','key'=>null]&&genesisFindUser($owner)['workspace_key_enc']===null);
$f=legacyTasksFixture(null,'account',false);$noCipher=genesisE2eeRead($owner,storeCommand('legacy-tasks',$f['payload']),$session);
storeCheck($noCipher['legacyKey']===['keyMode'=>'empty','key'=>null]&&genesisFindUser($owner)['workspace_key_enc']!==null);
$f=legacyTasksFixture(null,'client');$client=genesisE2eeRead($owner,storeCommand('legacy-tasks',$f['payload']),$session);storeCheck($client['legacyKey']===['keyMode'=>'client','key'=>null]);
$f=legacyTasksFixture(null,'legacy');storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-tasks',$f['payload']),$session),'E2EE_LEGACY_KEY_UNAVAILABLE');
$f=legacyTasksFixture(static function(string $id)use($db):void{$db->prepare('UPDATE users SET workspace_key_enc=? WHERE id=?')->execute([base64_encode('damaged old key'),$id]);});
storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-tasks',$f['payload']),$session),'E2EE_LEGACY_KEY_UNAVAILABLE');
$f=legacyTasksFixture();$oldHash=$f['payload']['sourceHash'];
$db->prepare('UPDATE e2ee_migrations SET lease_until=0 WHERE scope_id=?')->execute([$scopeId]);
storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-tasks',$f['payload']),$session),'E2EE_MIGRATION_FENCED');
$db->prepare('UPDATE tasks SET description=? WHERE user_id=?')->execute(['Late source change after expired lease',$owner]);
storeCheck($oldHash!==genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId)));
$f=legacyTasksFixture(static function(string $id)use($db):void{
    genesisBeginWriteTransaction($db);
    try{$q=$db->prepare('INSERT INTO personal_task_creations(user_id,task_id,state) VALUES(?,?,?)');
        for($i=0;$i<10000;$i++)$q->execute([$id,$id.'-history-'.$i,'{}']);$db->commit();}
    catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw$error;}
});
$many=genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId));
storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-tasks',$f['payload']),$session),'E2EE_SOURCE_TOO_LARGE');
storeCheck($many===genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId))&&!$db->inTransaction());
$f=legacyTasksFixture(static function(string $id)use($db):void{$db->prepare('UPDATE tasks SET description=? WHERE user_id=?')->execute([str_repeat('а',3*1024*1024),$id]);});
$oversized=genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId));storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-tasks',$f['payload']),$session),'E2EE_SOURCE_TOO_LARGE');
storeCheck($oversized===genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId))&&!$db->inTransaction());
echo 'PASS e2ee-legacy-tasks '.$checks.' cumulative assertions; exact owner-only tasks, deletions, links, recovered and creation history; no external IO or execution grants'.PHP_EOL;
