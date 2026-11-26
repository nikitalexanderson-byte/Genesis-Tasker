<?php
declare(strict_types=1);
// Reuse the real signed scope/lease fixture helpers and run their regression too.
require __DIR__.'/e2ee-store.php';
require_once dirname(__DIR__).'/src/shared-projects.php';

function legacyWorkspaceFixture(string $mode='account',bool $blob=true,?string $storedKey=null,?callable $seed=null,?callable $afterBootstrap=null):array
{
    global $db,$owner,$scopeId,$device,$authority,$session;
    $owner='legacy-'.bin2hex(random_bytes(8));$scopeId='personal:'.$owner;$now=genesisNow();
    $raw=base64_encode(random_bytes(32));$key=$storedKey??($mode==='account'?genesisEncrypt($raw):null);
    $db->prepare('INSERT INTO users(id,google_sub,email,display_name,created_at,updated_at,workspace_key_mode,workspace_key_enc) VALUES(?,?,?,?,?,?,?,?)')
        ->execute([$owner,$owner,$owner.'@example.invalid','Synthetic',$now,$now,$mode,$key]);
    $db->prepare('INSERT INTO categories(id,user_id,name,created_at,updated_at) VALUES(?,?,?,?,?)')->execute(['category-'.$owner,$owner,'Private category',$now,$now]);
    $db->prepare('INSERT INTO projects(id,user_id,title,description,created_at,updated_at) VALUES(?,?,?,?,?,?)')
        ->execute(['project-'.$owner,$owner,'Private project','Private description',$now,$now]);
    if($blob)$db->prepare('INSERT INTO workspace_blobs(user_id,ciphertext,iv,version,updated_at) VALUES(?,?,?,?,?)')
        ->execute([$owner,base64_encode('synthetic legacy opaque bytes'),base64_encode(random_bytes(12)),7,$now]);
    if($seed)$seed($owner);
    $kit=['protocol'=>1,'ownerId'=>$owner,'authority'=>['signingKey'=>$authority['signingKey'],'receivingKey'=>$authority['receivingKey']],
        'protectedKeys'=>['protocol'=>1,'ownerId'=>$owner,'purpose'=>'recovery-authority','salt'=>storeB64(random_bytes(32)),
            'nonce'=>storeB64(random_bytes(12)),'ciphertext'=>storeB64(random_bytes(128))]];
    $c=['protocol'=>1,'ownerId'=>$owner,'scopeId'=>$scopeId,'deviceId'=>'device-a','action'=>'bootstrap','expectedRevision'=>0,
        'checkpointHash'=>'genesis','securityEpoch'=>1,'operationId'=>'bootstrap','payload'=>['kind'=>'personal','resourceId'=>$owner,
        'keyId'=>'fresh-root','generation'=>1,'recoveryKit'=>$kit,'recoveryCapsule'=>storeCapsule($authority),
        'deviceKeys'=>['signingKey'=>$device['signingKey'],'receivingKey'=>$device['receivingKey']],'deviceCapsule'=>storeCapsule($device)]];
    $c['payload']['selfProof']=storeSign(genesisE2eeCommandBytes($c),$device['private']);
    genesisE2eeBootstrap($owner,['command'=>$c,'signature'=>storeSign(genesisE2eeCommandBytes($c),$authority['private'])]);
    if($afterBootstrap)$afterBootstrap($owner);
    $source=genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId));
    $payload=['migrationId'=>'migration-'.$owner,'fence'=>1,'sourceHash'=>$source];
    storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-workspace',$payload),$session),'E2EE_MIGRATION_FENCED');
    $lease=genesisE2eeExecute($owner,storeCommand('migration-start',['migrationId'=>$payload['migrationId'],'sourceHash'=>$source]),$session);
    return ['payload'=>$payload,'raw'=>$raw,'lease'=>$lease];
}

storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-workspace',['migrationId'=>'migration-one','fence'=>1,'sourceHash'=>storeB64(random_bytes(32))]),$session),'E2EE_MIGRATION_FENCED');
$f=legacyWorkspaceFixture();$p=$f['payload'];$packet=storeCommand('legacy-workspace',$p);
$before=genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId));$changes=$db->query('SELECT total_changes()')->fetchColumn();
$result=genesisE2eeRead($owner,$packet,$session);
storeCheck($result['workspace']['key']===$f['raw']&&$result['workspace']['keyMode']==='account'&&$result['workspace']['envelope']['version']===7);
storeCheck($result['ownerId']===$owner&&$result['scopeId']===$scopeId&&$result['sourceHash']===$p['sourceHash']&&$result['fence']===1);
storeCheck(count($result['projects'])===1&&$result['projects'][0]['id']==='project-'.$owner&&count($result['categories'])===1);
storeCheck(!isset($result['projects'][0]['user_id'])&&!str_contains(genesisE2eeJson($result),'refresh_token'));
storeCheck($before===genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId)));
// The SQLite writer acquisition may touch the technical quota no-op row only.
storeCheck((int)$db->query('SELECT total_changes()')->fetchColumn()-(int)$changes===1);
storeCheck(genesisE2eeRead($owner,$packet,$session)===$result&&!$db->inTransaction());
storeReject(fn()=>genesisE2eeRead('foreign-owner',$packet,$session),'E2EE_SCOPE_FORBIDDEN');
foreach(['migrationId'=>'other','fence'=>2,'sourceHash'=>storeB64(random_bytes(32))] as $field=>$wrong)
    storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-workspace',array_replace($p,[$field=>$wrong])),$session),'E2EE_MIGRATION_FENCED');
storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-workspace',$p,replace:['expectedRevision'=>0]),$session),'E2EE_STALE_EPOCH');
$tampered=$packet;$tampered['signature']=storeB64(random_bytes(64));
storeReject(fn()=>genesisE2eeRead($owner,$tampered,$session),'E2EE_UNTRUSTED_COMMAND');
$db->prepare('UPDATE e2ee_devices SET revoked=1 WHERE scope_id=?')->execute([$scopeId]);
storeReject(fn()=>genesisE2eeRead($owner,$packet,$session),'E2EE_REVOKED_DEVICE');
$db->prepare('UPDATE e2ee_devices SET revoked=0 WHERE scope_id=?')->execute([$scopeId]);
$db->prepare('UPDATE e2ee_migrations SET lease_until=0 WHERE scope_id=?')->execute([$scopeId]);
storeReject(fn()=>genesisE2eeRead($owner,$packet,$session),'E2EE_MIGRATION_FENCED');
$resume=genesisE2eeExecute($owner,storeCommand('migration-resume',$p+['pendingOperationId'=>null,'pendingHash'=>null]),$session);
storeCheck($resume['fence']===2);
storeReject(fn()=>genesisE2eeRead($owner,$packet,$session),'E2EE_MIGRATION_FENCED');
$p['fence']=2;storeCheck(genesisE2eeRead($owner,storeCommand('legacy-workspace',$p),$session)['fence']===2);
genesisE2eeExecute($owner,storeCommand('migration-cancel',['migrationId'=>$p['migrationId'],'fence'=>2]),$session);
storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-workspace',$p),$session),'E2EE_MIGRATION_FENCED');

// Empty legacy account must not manufacture a key or alter the source token.
$f=legacyWorkspaceFixture('legacy',false);$empty=genesisE2eeRead($owner,storeCommand('legacy-workspace',$f['payload']),$session);
storeCheck($empty['workspace']===['keyMode'=>'empty','key'=>null,'envelope'=>null]);
storeCheck(genesisFindUser($owner)['workspace_key_enc']===null);
$f=legacyWorkspaceFixture('client');$client=genesisE2eeRead($owner,storeCommand('legacy-workspace',$f['payload']),$session);
storeCheck($client['workspace']['keyMode']==='client'&&$client['workspace']['key']===null);
$f=legacyWorkspaceFixture('legacy');storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-workspace',$f['payload']),$session),'E2EE_LEGACY_KEY_UNAVAILABLE');
$f=legacyWorkspaceFixture('account',true,genesisEncrypt(base64_encode('short')));
storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-workspace',$f['payload']),$session),'E2EE_LEGACY_KEY_UNAVAILABLE');
$f=legacyWorkspaceFixture('account',true,base64_encode('damaged ciphertext'));
storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-workspace',$f['payload']),$session),'E2EE_LEGACY_KEY_UNAVAILABLE');

$f=legacyWorkspaceFixture('legacy',false,null,static function(string $id)use($db,$now):void {
    genesisBeginWriteTransaction($db);$q=$db->prepare('INSERT INTO categories(id,user_id,name,created_at,updated_at) VALUES(?,?,?,?,?)');
    // Model a historical oversized account under an earlier/higher technical
    // quota. Restore that synthetic quota before exposing the read fixture.
    $quota=$db->query("SELECT amount FROM resource_quota_limits WHERE name='categories_per_user'")->fetchColumn();
    try{$db->exec("UPDATE resource_quota_limits SET amount=12000 WHERE name='categories_per_user'");
        for($i=0;$i<10000;$i++)$q->execute([$id.'-limit-'.$i,$id,'Synthetic',$now,$now]);
        $db->prepare("UPDATE resource_quota_limits SET amount=? WHERE name='categories_per_user'")->execute([$quota]);$db->commit();}
    catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw$error;}
});
$limitSource=genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId));
storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-workspace',$f['payload']),$session),'E2EE_SOURCE_TOO_LARGE');
storeCheck($limitSource===genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId)));
$f=legacyWorkspaceFixture('legacy',false,null,static function(string $id)use($db):void {
    // Unicode JSON escaping exceeds the response budget while the real source
    // itself stays modest. No private bytes are printed even on a failure.
    $db->prepare('UPDATE categories SET name=? WHERE user_id=?')->execute([str_repeat('а',3*1024*1024),$id]);
});
storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-workspace',$f['payload']),$session),'E2EE_SOURCE_TOO_LARGE');
storeCheck(!$db->inTransaction());

$f=legacyWorkspaceFixture('account',true,null,null,static function(string $id)use($db):void {
    $db->prepare('UPDATE users SET data_generation=7 WHERE id=?')->execute([$id]);
});
storeCheck($f['lease']['generation']===8);
storeCheck(genesisE2eeRead($owner,storeCommand('legacy-workspace',$f['payload']),$session)['legacyGeneration']===7);
// Represent a pre-fix development lease whose shadow generation was below a
// restore which preceded that lease. Reads/puts must fail closed as well.
$db->prepare('UPDATE e2ee_scopes SET generation=7 WHERE scope_id=?')->execute([$scopeId]);
$db->prepare('UPDATE e2ee_migrations SET target_generation=7 WHERE scope_id=?')->execute([$scopeId]);
storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-workspace',$f['payload']),$session),'E2EE_STALE_GENERATION');
storeReject(fn()=>genesisE2eeExecute($owner,storePut('stale-shadow',0,$f['lease']),$session),'E2EE_STALE_GENERATION');
$db->prepare('UPDATE e2ee_scopes SET generation=8 WHERE scope_id=?')->execute([$scopeId]);
$db->prepare('UPDATE e2ee_migrations SET target_generation=8 WHERE scope_id=?')->execute([$scopeId]);
// A later reset requires a new attempt; preserve the abandoned shadow generation.
genesisE2eeExecute($owner,storePut('old-shadow',0,$f['lease']),$session);
$db->prepare('UPDATE e2ee_migrations SET lease_until=0 WHERE scope_id=?')->execute([$scopeId]);
$db->prepare('UPDATE users SET data_generation=10 WHERE id=?')->execute([$owner]);
$newSource=genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId));
storeReject(fn()=>genesisE2eeExecute($owner,storeCommand('migration-start',['migrationId'=>$f['payload']['migrationId'],'sourceHash'=>$newSource]),$session),'E2EE_SOURCE_CHANGED');
genesisE2eeExecute($owner,storeCommand('migration-cancel',['migrationId'=>$f['payload']['migrationId'],'fence'=>$f['lease']['fence']]),$session);
$new=genesisE2eeExecute($owner,storeCommand('migration-start',['migrationId'=>'fresh-after-reset','sourceHash'=>$newSource]),$session);
storeCheck($new['generation']===11);
storeCheck((int)genesisE2eeRow($db,"SELECT COUNT(*) AS amount FROM e2ee_objects WHERE scope_id=? AND generation=8",[$scopeId])['amount']===1);
storeReject(fn()=>legacyWorkspaceFixture('account',true,null,null,static function(string $id)use($db):void {
    $db->prepare('UPDATE users SET data_generation=9007199254740991 WHERE id=?')->execute([$id]);
}),'E2EE_ROTATION_REQUIRED');
storeCheck(!$db->inTransaction());

// Simulate a formerly unfenced legacy source changing, without bypassing a live
// fence: expire, change, then restore expiry. Source binding still detects it.
$f=legacyWorkspaceFixture();$db->prepare('UPDATE e2ee_migrations SET lease_until=0 WHERE scope_id=?')->execute([$scopeId]);
$db->prepare("UPDATE projects SET title='changed' WHERE user_id=?")->execute([$owner]);
$db->prepare('UPDATE e2ee_migrations SET lease_until=? WHERE scope_id=?')->execute([time()+900,$scopeId]);
storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-workspace',$f['payload']),$session),'E2EE_SOURCE_CHANGED');
storeCheck(!$db->inTransaction());

echo 'PASS e2ee-legacy-workspace '.$checks.' cumulative assertions; signed owner/lease/source binding, no source mutation'.PHP_EOL;
