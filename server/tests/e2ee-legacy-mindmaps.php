<?php
declare(strict_types=1);
require __DIR__.'/e2ee-legacy-workspace.php';

function legacyMindmapsFixture(?callable $mutate=null,string $mode='account',bool $maps=true):array
{
    global $db;
    return legacyWorkspaceFixture($mode,false,null,static function(string $id)use($db,$mutate,$maps):void{
        $now=genesisNow();
        if($maps){
            $db->prepare('INSERT INTO personal_mindmaps VALUES(?,?,?,?,?,?,?)')->execute([$id,'private-map',2,42,base64_encode(random_bytes(150)),base64_encode(random_bytes(12)),$now]);
            // Keep more than the ordinary UI reader's twenty history entries.
            $q=$db->prepare('INSERT INTO personal_mindmap_versions VALUES(?,?,?,?,?,?,?)');
            for($i=1;$i<=25;$i++)$q->execute([$id,'private-map',$i,$i===1?1:2,base64_encode(random_bytes(140)),base64_encode(random_bytes(12)),$now]);
            $db->prepare('INSERT INTO personal_mindmap_receipts VALUES(?,?,?,?,?)')->execute([$id,'private-map','uncertain-old-save',hash('sha256','synthetic old write'),26]);
        }
        $db->prepare('INSERT INTO personal_mindmap_deletions VALUES(?,?,?)')->execute([$id,'deleted-map',$now]);
        if($mutate)$mutate($id);
    });
}
$foreign=legacyMindmapsFixture();$foreignOwner=$owner;
$fixture=legacyMindmapsFixture();$packet=storeCommand('legacy-mindmaps',$fixture['payload']);$hash=$fixture['payload']['sourceHash'];
$before=$db->query('SELECT total_changes()')->fetchColumn();$result=genesisE2eeRead($owner,$packet,$session);
storeCheck($result['ownerId']===$owner&&$result['legacyKey']===['keyMode'=>'account','key'=>$fixture['raw']]);
storeCheck(count($result['maps'])===1&&count($result['versions'])===25&&count($result['receipts'])===1&&count($result['deletions'])===1);
storeCheck($result['versions'][0]['revision']===1&&$result['versions'][0]['schema_version']===1&&$result['versions'][24]['revision']===25);
storeCheck($result['receipts'][0]['operation_id']==='uncertain-old-save'&&$result['receipts'][0]['payload_hash']===hash('sha256','synthetic old write'));
$q=$db->prepare('SELECT ciphertext FROM personal_mindmaps WHERE user_id=?');$q->execute([$owner]);$own=$q->fetchColumn();$q->closeCursor();$q->execute([$foreignOwner]);$other=$q->fetchColumn();$q->closeCursor();
storeCheck($own!==$other&&$result['maps'][0]['ciphertext']===$own&&!str_contains(genesisE2eeJson($result),$other));
foreach(['maps'=>'personal_mindmaps','versions'=>'personal_mindmap_versions','receipts'=>'personal_mindmap_receipts','deletions'=>'personal_mindmap_deletions']as $name=>$table){
    $expected=array_values(array_diff(array_column($db->query('PRAGMA table_info('.$table.')')->fetchAll(),'name'),['user_id']));$actual=array_keys($result[$name][0]);sort($expected);sort($actual);storeCheck($expected===$actual);
}
foreach(['identity','billing','orders','refresh_token_enc','workspace_key_enc','sessions']as $field)storeCheck(!array_key_exists($field,$result));
storeCheck($hash===genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId))&&(int)$db->query('SELECT total_changes()')->fetchColumn()-(int)$before===1);
storeCheck(genesisE2eeRead($owner,$packet,$session)===$result&&!$db->inTransaction());
storeReject(fn()=>genesisE2eeRead($foreignOwner,$packet,$session),'E2EE_SCOPE_FORBIDDEN');
foreach(['migrationId'=>'foreign','fence'=>2,'sourceHash'=>storeB64(random_bytes(32))]as $field=>$wrong)storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-mindmaps',array_replace($fixture['payload'],[$field=>$wrong])),$session),'E2EE_MIGRATION_FENCED');
$tampered=$packet;$tampered['signature']=storeB64(random_bytes(64));storeReject(fn()=>genesisE2eeRead($owner,$tampered,$session),'E2EE_UNTRUSTED_COMMAND');
$db->prepare('UPDATE e2ee_devices SET revoked=1 WHERE scope_id=?')->execute([$scopeId]);storeReject(fn()=>genesisE2eeRead($owner,$packet,$session),'E2EE_REVOKED_DEVICE');$db->prepare('UPDATE e2ee_devices SET revoked=0 WHERE scope_id=?')->execute([$scopeId]);
foreach(['personal_mindmaps'=>'updated_at','personal_mindmap_versions'=>'updated_at','personal_mindmap_receipts'=>'payload_hash','personal_mindmap_deletions'=>'deleted_at']as $table=>$field)
    storeReject(fn()=>$db->prepare('UPDATE '.$table.' SET '.$field.'=? WHERE user_id=?')->execute(['changed',$owner]),'E2EE_LEGACY_WRITE_FORBIDDEN');
genesisE2eeExecute($owner,storeCommand('migration-cancel',['migrationId'=>$fixture['payload']['migrationId'],'fence'=>1]),$session);storeReject(fn()=>genesisE2eeRead($owner,$packet,$session),'E2EE_MIGRATION_FENCED');
$fixture=legacyWorkspaceFixture('legacy',false);$empty=genesisE2eeRead($owner,storeCommand('legacy-mindmaps',$fixture['payload']),$session);foreach(['maps','versions','receipts','deletions']as $field)storeCheck($empty[$field]===[]);storeCheck($empty['legacyKey']===['keyMode'=>'empty','key'=>null]&&genesisFindUser($owner)['workspace_key_enc']===null);
$fixture=legacyMindmapsFixture(null,'account',false);storeCheck(genesisE2eeRead($owner,storeCommand('legacy-mindmaps',$fixture['payload']),$session)['legacyKey']===['keyMode'=>'empty','key'=>null]);
$fixture=legacyMindmapsFixture(null,'client');storeCheck(genesisE2eeRead($owner,storeCommand('legacy-mindmaps',$fixture['payload']),$session)['legacyKey']===['keyMode'=>'client','key'=>null]);
$fixture=legacyMindmapsFixture(null,'legacy');storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-mindmaps',$fixture['payload']),$session),'E2EE_LEGACY_KEY_UNAVAILABLE');
$fixture=legacyMindmapsFixture(static function(string $id)use($db):void{$db->prepare('UPDATE users SET workspace_key_enc=? WHERE id=?')->execute([base64_encode('corrupt key'),$id]);});storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-mindmaps',$fixture['payload']),$session),'E2EE_LEGACY_KEY_UNAVAILABLE');
$fixture=legacyMindmapsFixture();$old=$fixture['payload']['sourceHash'];$db->prepare('UPDATE e2ee_migrations SET lease_until=0 WHERE scope_id=?')->execute([$scopeId]);$db->prepare('UPDATE personal_mindmap_receipts SET payload_hash=? WHERE user_id=?')->execute([hash('sha256','changed source'),$owner]);storeCheck($old!==genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId)));storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-mindmaps',$fixture['payload']),$session),'E2EE_MIGRATION_FENCED');
$fixture=legacyMindmapsFixture(static function(string $id)use($db):void{
    genesisBeginWriteTransaction($db);try{$q=$db->prepare('INSERT INTO personal_mindmap_deletions VALUES(?,?,?)');for($i=0;$i<10000;$i++)$q->execute([$id,'removed-'.$i,genesisNow()]);$db->commit();}catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw$error;}
});$old=genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId));storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-mindmaps',$fixture['payload']),$session),'E2EE_SOURCE_TOO_LARGE');storeCheck($old===genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId))&&!$db->inTransaction());
$fixture=legacyMindmapsFixture(static function(string $id)use($db):void{
    $db->prepare('UPDATE personal_mindmaps SET updated_at=? WHERE user_id=?')->execute([str_repeat('а',3*1024*1024),$id]);
});$old=genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId));
storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-mindmaps',$fixture['payload']),$session),'E2EE_SOURCE_TOO_LARGE');
storeCheck($old===genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId))&&!$db->inTransaction());
echo 'PASS e2ee-legacy-mindmaps '.$checks.' cumulative assertions; complete signed owner-only maps/history/receipts/deletions, no twenty-version truncation or provider writes'.PHP_EOL;
