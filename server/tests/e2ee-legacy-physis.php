<?php
declare(strict_types=1);
require __DIR__.'/e2ee-legacy-workspace.php';

function legacyPhysisFixture(int $version=2,?callable $mutate=null,string $mode='account'):array
{
    global $db;
    return legacyWorkspaceFixture($mode,false,null,static function(string $id)use($db,$version,$mutate):void{
        $vault=$version===2?['version'=>2,'keyVersion'=>3,'account'=>['iv'=>base64_encode(random_bytes(12)),'ciphertext'=>base64_encode(random_bytes(62))]]
            :['version'=>1,'keyVersion'=>3,'password'=>['salt'=>base64_encode(random_bytes(16)),'iterations'=>600000,'iv'=>base64_encode(random_bytes(12)),'ciphertext'=>base64_encode(random_bytes(48))],
                'recovery'=>['iv'=>base64_encode(random_bytes(12)),'ciphertext'=>base64_encode(random_bytes(48))]];
        $db->prepare('INSERT INTO physis_owners VALUES(?,?,?,?,?,?)')->execute([$id,9,2,genesisE2eeJson($vault),4,3]);
        foreach(['retained','removed','expired-id']as $record)$db->prepare('INSERT INTO physis_used_ids VALUES(?,?)')->execute([$id,$record]);
        $db->prepare('INSERT INTO physis_records VALUES(?,?,?,?,?,?,?)')->execute([$id,'retained',3,8,'{ "opaque":"exact raw envelope", "futureOptional":true }','2026-01-02T00:00:00Z',null]);
        // Both the tombstone and old receipt predate ordinary 90-day retention.
        $db->prepare('INSERT INTO physis_records VALUES(?,?,?,?,?,?,?)')->execute([$id,'removed',4,9,null,'2026-01-02T00:00:00Z','2026-01-02T00:00:00Z']);
        $db->prepare('INSERT INTO physis_receipts VALUES(?,?,?,?,?)')->execute([$id,'uncertain-old-save',hash('sha256','synthetic physis request'),'{ "cursor":9, "unknownOptional":"retain" }','2026-01-02T00:00:00Z']);
        if($mutate)$mutate($id);
    });
}
function physisPage(array $fixture,string $table,int $offset=0):array
{
    global $owner,$session;
    return genesisE2eeRead($owner,storeCommand('legacy-physis',$fixture['payload']+['table'=>$table,'offset'=>$offset]),$session);
}
$foreign=legacyPhysisFixture();$foreignOwner=$owner;
$fixture=legacyPhysisFixture();$initial=genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId));
$changes=(int)$db->query('SELECT total_changes()')->fetchColumn();$pages=[];
foreach(['owners'=>'physis_owners','records'=>'physis_records','usedIds'=>'physis_used_ids','receipts'=>'physis_receipts']as $name=>$table){
    $page=physisPage($fixture,$name);$pages[$name]=$page;
    storeCheck($page['ownerId']===$owner&&$page['sourceHash']===$initial&&$page['table']===$name&&$page['offset']===0&&$page['nextOffset']===null);
    storeCheck($page['totals']===['owners'=>1,'records'=>2,'usedIds'=>3,'receipts'=>1]);
    $expected=array_values(array_diff(array_column($db->query('PRAGMA table_info('.$table.')')->fetchAll(),'name'),['owner_id']));$actual=array_keys($page['rows'][0]);sort($expected);sort($actual);storeCheck($actual===$expected);
    storeCheck(count($page['rows'])===$page['totals'][$name]&&!str_contains(genesisE2eeJson($page),$foreignOwner));
    foreach(['identity','billing','orders','sessions','refresh_token_enc','workspace_key_enc']as $field)storeCheck(!array_key_exists($field,$page));
}
storeCheck($pages['owners']['legacyKey']===['keyMode'=>'account','key'=>$fixture['raw']]);
foreach(['records','usedIds','receipts']as $name)storeCheck($pages[$name]['legacyKey']===['keyMode'=>'empty','key'=>null]);
storeCheck($pages['records']['rows'][1]['envelope_json']==='{ "opaque":"exact raw envelope", "futureOptional":true }');
storeCheck($pages['records']['rows'][0]['deleted_at']==='2026-01-02T00:00:00Z'&&$pages['records']['rows'][0]['envelope_json']===null);
storeCheck($pages['receipts']['rows'][0]['response_json']==='{ "cursor":9, "unknownOptional":"retain" }');
storeCheck($initial===genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId))&&(int)$db->query('SELECT total_changes()')->fetchColumn()-$changes===4);
storeCheck(physisPage($fixture,'records')===$pages['records']&&!$db->inTransaction());
storeCheck(physisPage($fixture,'records',2)['rows']===[]&&physisPage($fixture,'records',2)['nextOffset']===null);
$packet=storeCommand('legacy-physis',$fixture['payload']+['table'=>'records','offset'=>0]);
storeReject(fn()=>genesisE2eeRead($foreignOwner,$packet,$session),'E2EE_SCOPE_FORBIDDEN');
$tampered=$packet;$tampered['command']['payload']['offset']=1;storeReject(fn()=>genesisE2eeRead($owner,$tampered,$session),'E2EE_UNTRUSTED_COMMAND');
foreach(['migrationId'=>'foreign','fence'=>2,'sourceHash'=>storeB64(random_bytes(32))]as $field=>$wrong)
    storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-physis',array_replace($fixture['payload'],[$field=>$wrong])+['table'=>'records','offset'=>0]),$session),'E2EE_MIGRATION_FENCED');
foreach([['table'=>'users','offset'=>0],['table'=>'records','offset'=>3]]as $wrong)storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-physis',$fixture['payload']+$wrong),$session),'E2EE_INVALID_ENVELOPE');
storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-physis',$fixture['payload']+['table'=>'records','offset'=>0,'limit'=>999]),$session),'E2EE_INVALID');
$db->prepare('UPDATE e2ee_devices SET revoked=1 WHERE scope_id=?')->execute([$scopeId]);storeReject(fn()=>physisPage($fixture,'records'),'E2EE_REVOKED_DEVICE');$db->prepare('UPDATE e2ee_devices SET revoked=0 WHERE scope_id=?')->execute([$scopeId]);
foreach(['physis_owners'=>'vault_json','physis_records'=>'envelope_json','physis_receipts'=>'response_json']as $table=>$field)
    storeReject(fn()=>$db->prepare('UPDATE '.$table.' SET '.$field.'=? WHERE owner_id=?')->execute(['changed',$owner]),'E2EE_LEGACY_WRITE_FORBIDDEN');
storeReject(fn()=>$db->prepare('DELETE FROM physis_used_ids WHERE owner_id=?')->execute([$owner]),'E2EE_LEGACY_WRITE_FORBIDDEN');
genesisE2eeExecute($owner,storeCommand('migration-cancel',['migrationId'=>$fixture['payload']['migrationId'],'fence'=>1]),$session);storeReject(fn()=>physisPage($fixture,'records'),'E2EE_MIGRATION_FENCED');
$empty=legacyWorkspaceFixture('legacy',false);foreach(['owners','records','usedIds','receipts']as $table){$page=physisPage($empty,$table);storeCheck($page['rows']===[]&&$page['nextOffset']===null&&$page['legacyKey']===['keyMode'=>'empty','key'=>null]);}
$v1=legacyPhysisFixture(1,null,'legacy');storeCheck(physisPage($v1,'owners')['legacyKey']===['keyMode'=>'empty','key'=>null]&&genesisFindUser($owner)['workspace_key_enc']===null);
$v2=legacyPhysisFixture(2,null,'client');storeCheck(physisPage($v2,'owners')['legacyKey']===['keyMode'=>'client','key'=>null]);
$lost=legacyPhysisFixture(2,null,'legacy');storeReject(fn()=>physisPage($lost,'owners'),'E2EE_LEGACY_KEY_UNAVAILABLE');
$invalid=legacyPhysisFixture(2,static fn(string $id)=>$db->prepare('UPDATE physis_owners SET vault_json=? WHERE owner_id=?')->execute(['{broken',$id]));storeReject(fn()=>physisPage($invalid,'owners'),'E2EE_PHYSIS_SOURCE_INVALID');
$future=legacyPhysisFixture(2,static fn(string $id)=>$db->prepare('UPDATE physis_owners SET vault_json=? WHERE owner_id=?')->execute(['{"version":3}',$id]));storeReject(fn()=>physisPage($future,'owners'),'E2EE_PHYSIS_FORMAT_UNSUPPORTED');
$fixture=legacyPhysisFixture();$old=$fixture['payload']['sourceHash'];$db->prepare('UPDATE e2ee_migrations SET lease_until=0 WHERE scope_id=?')->execute([$scopeId]);$db->prepare('UPDATE physis_receipts SET response_json=? WHERE owner_id=?')->execute(['{"changed":true}',$owner]);storeCheck($old!==genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId)));storeReject(fn()=>physisPage($fixture,'receipts'),'E2EE_MIGRATION_FENCED');
$large=legacyPhysisFixture(1,static function(string $id)use($db):void{
    genesisBeginWriteTransaction($db);try{
        $used=$db->prepare('INSERT INTO physis_used_ids VALUES(?,?)');$record=$db->prepare('INSERT INTO physis_records VALUES(?,?,?,?,?,?,?)');
        // More than a 16 MiB bridge message, within the real 32 MiB service cap.
        $json='{"ciphertext":"'.str_repeat('A',320000).'"}';
        for($i=0;$i<100;$i++){$name='large-'.str_pad((string)$i,3,'0',STR_PAD_LEFT);$used->execute([$id,$name]);$record->execute([$id,$name,1,10+$i,$json,'2026-11-19T00:00:00Z',null]);}
        for($i=0;$i<150;$i++)$used->execute([$id,'expired-'.str_pad((string)$i,3,'0',STR_PAD_LEFT)]);
        $db->commit();
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw$error;}
});
$seen=[];$offset=0;$count=0;$totalBytes=0;$original=genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId));
do{
    $page=physisPage($large,'records',$offset);$count++;storeCheck(strlen(genesisE2eeJson($page))<16*1024*1024&&$page['sourceHash']===$original&&$page['totals']['records']===102);
    foreach($page['rows']as $row){storeCheck(!isset($seen[$row['id']]));$seen[$row['id']]=true;$totalBytes+=strlen($row['envelope_json']??'');}
    storeCheck($page['nextOffset']===null||$page['nextOffset']===$offset+count($page['rows']));$offset=$page['nextOffset'];
}while($offset!==null);
storeCheck(count($seen)===102&&$count>1&&$totalBytes>16*1024*1024&&$original===genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId))&&!$db->inTransaction());
$used=[];$offset=0;$count=0;
do{
    $page=physisPage($large,'usedIds',$offset);$count++;storeCheck(count($page['rows'])<=128&&$page['totals']['usedIds']===253);
    foreach($page['rows']as $row){storeCheck(!isset($used[$row['id']]));$used[$row['id']]=true;}$offset=$page['nextOffset'];
}while($offset!==null);
storeCheck(count($used)===253&&$count===2&&isset($used['expired-id']));
$oversized=legacyPhysisFixture(1,static fn(string $id)=>$db->prepare('UPDATE physis_records SET envelope_json=? WHERE owner_id=? AND id=?')->execute([str_repeat('я',5*1024*1024),$id,'retained']));
$original=genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId));$partial=physisPage($oversized,'records');
storeCheck(count($partial['rows'])===1&&$partial['rows'][0]['id']==='removed'&&$partial['nextOffset']===1);
storeReject(fn()=>physisPage($oversized,'records',1),'E2EE_SOURCE_TOO_LARGE');
storeCheck($original===genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId))&&!$db->inTransaction());
echo 'PASS e2ee-legacy-physis '.$checks.' cumulative assertions; all raw owner tables, old tombstones/receipts, independently fenced bounded pages above 16MiB, no prune/bootstrap/key generation'.PHP_EOL;
