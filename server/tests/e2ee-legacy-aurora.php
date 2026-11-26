<?php
declare(strict_types=1);
require __DIR__.'/e2ee-legacy-workspace.php';
require_once dirname(__DIR__).'/src/shared-content-storage.php';

function legacyAuroraFixture(string $mode='account',?callable $alter=null):array
{
    return legacyWorkspaceFixture($mode,false,null,static function(string $id)use($alter):void {
        global $db;
        $iv=base64_encode(random_bytes(12));$cipher=base64_encode(random_bytes(48));$now=genesisNow();
        $db->prepare('INSERT INTO aurora_workspaces(user_id,revision,iv,ciphertext,payload_hash,updated_at) VALUES(?,?,?,?,?,?)')
            ->execute([$id,4,$iv,$cipher,hash('sha256','synthetic'),$now]);
        $json=json_encode(['kind'=>'aurora-encrypted-solution-v1','forecastHashes'=>[str_repeat('1',64)],'contextHash'=>str_repeat('2',64),
            'iv'=>$iv,'ciphertext'=>$cipher],JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);
        $db->prepare('INSERT INTO future_modeling_results VALUES(?,?,?,?,?,?)')->execute(['result-'.$id,$id,'aurora-two-circles-v2',
            genesisSharedContentEncrypt($json),hash('sha256','aurora-two-circles-v2:'.$json),$now]);
        if($alter)$alter($id);
    });
}
$f=legacyAuroraFixture();$p=$f['payload'];$packet=storeCommand('legacy-aurora',$p);
$before=genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId));$changes=$db->query('SELECT total_changes()')->fetchColumn();
$source=genesisE2eeRead($owner,$packet,$session);
storeCheck($source['workspace']['revision']===4&&$source['legacyKey']===['keyMode'=>'account','key'=>$f['raw']]);
storeCheck($source['ownerId']===$owner&&$source['scopeId']===$scopeId&&$source['sourceHash']===$p['sourceHash']);
storeCheck(count($source['results'])===1&&$source['results'][0]['id']==='result-'.$owner);
storeCheck(array_keys($source['results'][0])===['id','methodVersion','solutionJson','resultHash','createdAt']);
storeCheck(!str_contains(genesisE2eeJson($source),'workspace_key_enc')&&!str_contains(genesisE2eeJson($source),'refresh_token')&&!array_key_exists('orders',$source));
storeCheck($before===genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId)));
storeCheck((int)$db->query('SELECT total_changes()')->fetchColumn()-(int)$changes===1);
storeCheck(genesisE2eeRead($owner,$packet,$session)===$source&&!$db->inTransaction());
storeReject(fn()=>genesisE2eeRead('foreign-owner',$packet,$session),'E2EE_SCOPE_FORBIDDEN');
foreach(['migrationId'=>'other','fence'=>2,'sourceHash'=>storeB64(random_bytes(32))] as $field=>$wrong)
    storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-aurora',array_replace($p,[$field=>$wrong])),$session),'E2EE_MIGRATION_FENCED');
storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-aurora',$p,replace:['expectedRevision'=>0]),$session),'E2EE_STALE_EPOCH');
$tampered=$packet;$tampered['signature']=storeB64(random_bytes(64));storeReject(fn()=>genesisE2eeRead($owner,$tampered,$session),'E2EE_UNTRUSTED_COMMAND');
$db->prepare('UPDATE e2ee_devices SET revoked=1 WHERE scope_id=?')->execute([$scopeId]);
storeReject(fn()=>genesisE2eeRead($owner,$packet,$session),'E2EE_REVOKED_DEVICE');
$db->prepare('UPDATE e2ee_devices SET revoked=0 WHERE scope_id=?')->execute([$scopeId]);
genesisE2eeExecute($owner,storeCommand('migration-cancel',['migrationId'=>$p['migrationId'],'fence'=>1]),$session);
storeReject(fn()=>genesisE2eeRead($owner,$packet,$session),'E2EE_MIGRATION_FENCED');
$f=legacyAuroraFixture('client');$client=genesisE2eeRead($owner,storeCommand('legacy-aurora',$f['payload']),$session);
storeCheck($client['legacyKey']===['keyMode'=>'client','key'=>null]&&count($client['results'])===1);
$f=legacyWorkspaceFixture('legacy',false);$empty=genesisE2eeRead($owner,storeCommand('legacy-aurora',$f['payload']),$session);
storeCheck($empty['legacyKey']===['keyMode'=>'empty','key'=>null]&&$empty['workspace']===null&&$empty['results']===[]);
storeCheck(genesisFindUser($owner)['workspace_key_enc']===null);
$f=legacyAuroraFixture('legacy');storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-aurora',$f['payload']),$session),'E2EE_LEGACY_KEY_UNAVAILABLE');
foreach(['hash','json'] as $corruption) {
    $f=legacyAuroraFixture('account',static function(string $id)use($corruption):void {
        global $db;
        if($corruption==='hash')$db->prepare('UPDATE future_modeling_results SET result_hash=? WHERE user_id=?')->execute([str_repeat('0',64),$id]);
        else $db->prepare('UPDATE future_modeling_results SET encrypted_result=? WHERE user_id=?')->execute(['{damaged',$id]);
    });
    storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-aurora',$f['payload']),$session),'E2EE_LEGACY_AURORA_CORRUPT');
}
echo 'PASS e2ee-legacy-aurora '.$checks.' cumulative assertions; signed owner/source lease and exact historical content, no payment authority'.PHP_EOL;
