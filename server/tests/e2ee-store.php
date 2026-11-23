<?php
declare(strict_types=1);
if (getenv('GENESIS_IMPROVEMENTS_TEST') !== 'isolated') throw new RuntimeException('Isolated synthetic environment required.');
require dirname(__DIR__) . '/src/bootstrap.php';
require dirname(__DIR__) . '/src/repository.php';
require dirname(__DIR__) . '/src/e2ee-store.php';
require_once dirname(__DIR__) . '/src/e2ee-policy.php';
require_once dirname(__DIR__) . '/src/e2ee-legacy-private-path.php';
$db=genesisDb();$checks=0;
function storeCheck(bool $ok):void {global $checks;if(!$ok)throw new RuntimeException('E2EE store assertion failed at '.($checks+1));++$checks;}
function storeReject(callable $call,string $code):void {
    try{$call();}catch(Throwable $e){storeCheck($e->getMessage()===$code || str_contains($e->getMessage(),$code));return;}
    throw new RuntimeException('E2EE accepted forbidden operation: '.$code);
}
function storeB64(string $bytes):string{return rtrim(strtr(base64_encode($bytes),'+/','-_'),'=');}
// Compile every ownership expression against the actual migrated schema, including
// multi-owner shared tables which a personal-only fixture would otherwise miss.
foreach(genesisE2eeLegacyInventory($db) as $table=>$predicates)foreach($predicates as [$kind,$expression]) {
    $q=$db->prepare('SELECT '.str_replace('{row}','row',$expression).' FROM "'.$table.'" row LIMIT 0');$q->execute();$q->closeCursor();
}
$paths=json_decode((string)file_get_contents(dirname(__DIR__,2).'/contracts/e2ee/private-paths-v1.json'),true,64,JSON_THROW_ON_ERROR);
foreach($paths['remoteDomains'] as $kind=>$domains) {
    $allowed=genesisE2eeAllowedContentDomains($kind);sort($allowed);sort($domains);storeCheck($allowed===$domains);
}
foreach($paths['paths'] as $path)storeCheck(count(array_diff($path['domains'],genesisE2eeAllowedContentDomains($path['scope'])))===0);
$declared=[];foreach($paths['paths'] as $path)foreach($path['server'] as $table)$declared[$path['scope']][$table]=true;
foreach(genesisE2eeLegacyInventory($db) as $table=>$predicates)foreach($predicates as [$kind]) {
    // A space-wide deny/hash fence also observes each user's UI row. This
    // is deliberately NOT a space-owner read grant for personal preferences.
    $personalUiFence=$table==='shared_space_ui'&&$kind==='space'&&isset($declared['personal'][$table]);
    if(!isset($declared[$kind][$table])&&!$personalUiFence)throw new RuntimeException('E2EE_PATH_INVENTORY_MISSING: '.$kind.'/'.$table);
    storeCheck(true);
}
try { genesisE2eePrivatePathWhere('space','shared_space_ui'); throw new RuntimeException('E2EE_UI_READ_GRANT_WIDENED'); }
catch (DomainException $error) { storeCheck($error->getMessage()==='E2EE_SOURCE_PATH_FORBIDDEN'); }
storeCheck(str_contains(genesisE2eePrivatePathWhere('personal','shared_space_ui'),'user_id=:actor'));
function storePair():array {
    $private=openssl_pkey_new(['private_key_type'=>OPENSSL_KEYTYPE_EC,'curve_name'=>'prime256v1']);$details=openssl_pkey_get_details($private);
    $der=base64_decode(preg_replace('~-----[^-]+-----|\s~','',$details['key']));
    return ['private'=>$private,'signingKey'=>storeB64($der),'receivingKey'=>storeB64("\4".str_pad($details['ec']['x'],32,"\0",STR_PAD_LEFT).str_pad($details['ec']['y'],32,"\0",STR_PAD_LEFT))];
}
function storeSign(string $data,OpenSSLAsymmetricKey $key):string {
    openssl_sign($data,$der,$key,OPENSSL_ALGO_SHA256);$offset=2;$parts=[];
    for($i=0;$i<2;$i++){if(ord($der[$offset++])!==2)throw new RuntimeException('Bad test DER');$length=ord($der[$offset++]);$part=substr($der,$offset,$length);$offset+=$length;$parts[]=str_pad(ltrim($part,"\0"),32,"\0",STR_PAD_LEFT);}
    return storeB64(implode('',$parts));
}
function storeCapsule(array $keys):array{return ['suite'=>'DHKEM-P256-HKDFSHA256-A256GCM','enc'=>$keys['receivingKey'],'ciphertext'=>storeB64(random_bytes(48))];}
function storeCommand(string $action,array $payload,string $deviceId='device-a',?array $replace=null):array {
    global $owner,$scopeId,$device,$authority;
    $scope=genesisE2eeScope($owner,$scopeId);
    $c=['protocol'=>1,'ownerId'=>$owner,'scopeId'=>$scopeId,'deviceId'=>$deviceId,'action'=>$action,
        'expectedRevision'=>(int)$scope['directory_revision'],'checkpointHash'=>$scope['checkpoint_hash'],
        'securityEpoch'=>(int)$scope['security_epoch'],'operationId'=>'op-'.bin2hex(random_bytes(10)),'payload'=>$payload];
    if($replace)$c=array_replace($c,$replace);
    return ['command'=>$c,'signature'=>storeSign(genesisE2eeCommandBytes($c),$deviceId==='recovery'?$authority['private']:$device['private'])];
}
function storePut(string $objectId,int $expected,array $lease,string $domain='workspace'):array {
    global $owner,$scopeId,$device;
    $scope=genesisE2eeScope($owner,$scopeId);
    $operationId='op-'.bin2hex(random_bytes(10));
    $ctx=['cryptoProtocol'=>1,'suite'=>GENESIS_E2EE_SUITE,'ownerId'=>$owner,'scopeId'=>$scopeId,'domain'=>$domain,'objectId'=>$objectId,
        'schemaVersion'=>1,'dataGeneration'=>(int)$scope['generation'],'writerProtocol'=>9,'cryptoEpoch'=>(int)$scope['crypto_epoch'],
        'securityEpoch'=>(int)$scope['security_epoch'],'revision'=>$expected+1,'keyId'=>$scope['key_id'],'deviceId'=>'device-a','operationId'=>$operationId];
    $e=['context'=>$ctx,'wrappedKey'=>storeB64(random_bytes(40)),'nonce'=>storeB64(random_bytes(12)),'ciphertext'=>storeB64(random_bytes(80))];
    $e['signature']=storeSign(genesisE2eeSignatureData($e),$device['private']);
    return storeCommand('put',['envelope'=>$e,'expectedObjectRevision'=>$expected,'migrationId'=>$lease['migrationId']??null,'fence'=>$lease['fence']??0],replace:['operationId'=>$operationId]);
}
// Upgrade an early development database with the old marker and stale trigger.
$db->exec('DROP TRIGGER e2ee_fence_task_links_update');
$db->exec("CREATE TRIGGER e2ee_fence_task_links_update BEFORE UPDATE ON task_links WHEN 0 BEGIN SELECT RAISE(ABORT,'STALE_GUARD'); END");
$db->prepare('INSERT OR IGNORE INTO schema_migrations VALUES(?,?)')->execute(['e2ee-fence-v1',genesisNow()]);
$db->prepare('INSERT OR IGNORE INTO schema_migrations VALUES(?,?)')->execute(['e2ee-fence-v3',genesisNow()]);
$db->exec("DELETE FROM schema_migrations WHERE name='e2ee-fence-v8'");genesisE2eeInitializeGuards($db);
storeCheck($db->query("SELECT 1 FROM schema_migrations WHERE name='e2ee-fence-v8'")->fetchColumn()!==false);
$runtime=json_decode((string)file_get_contents(dirname(__DIR__,2).'/tests/fixtures/e2ee/v1-runtime.json'),true,64,JSON_THROW_ON_ERROR);
storeCheck(storeB64(genesisE2eeCommandBytes($runtime['signedCommand']['command']))===$runtime['commandBytes']);
storeCheck(genesisE2eeCommandHash($runtime['signedCommand']['command'])===$runtime['commandHash']);
storeCheck(genesisE2eeVerifyCommand($runtime['signedCommand'],$runtime['device']['signingKey'])['action']==='read');
$owner='synthetic-e2ee-owner';$scopeId='personal:synthetic-e2ee-owner';$session=str_repeat('s',32);$authority=storePair();$device=storePair();$newDevice=storePair();
$now=genesisNow();$db->prepare('INSERT INTO users(id,google_sub,email,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)')->execute([$owner,$owner,'opaque@example.invalid','Synthetic',$now,$now]);
$db->prepare("INSERT INTO habit_reminder_profiles(user_id,encrypted_plan,expires_at,needs_refresh,updated_at) VALUES(?,?,'2000-01-01T00:00:00Z',0,?)")
    ->execute([$owner,genesisSharedContentEncrypt('{}'),$now]);
$db->prepare('INSERT INTO habit_reminder_devices(id,user_id,device_key,request_id,request_hash,time_zone,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    ->execute(['e2ee-habit-device',$owner,'synthetic','synthetic','synthetic','UTC',$now,$now]);
$db->prepare("INSERT INTO habit_reminder_deliveries(id,user_id,device_id,profile_revision,event_key,encrypted_target,scheduled_at,expires_at,created_at,updated_at) VALUES(?,?,?,0,?,?,?,'2000-01-01T00:00:00Z',?,?)")
    ->execute(['e2ee-habit-delivery',$owner,'e2ee-habit-device','synthetic',genesisSharedContentEncrypt('{}'),$now,$now,$now]);
$db->prepare('INSERT INTO advice_notification_devices VALUES(?,?,?,?,?,?)')->execute(['e2ee-advice-device',$owner,'synthetic-hash',genesisSharedContentEncrypt('{}'),$now,$now]);
$db->prepare('INSERT INTO advice_notification_deliveries(id,user_id,device_id,day_key,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    ->execute(['e2ee-advice-delivery',$owner,'e2ee-advice-device','2026-11-18',$now,$now]);
$db->prepare('UPDATE users SET advice_notifications_json=? WHERE id=?')->execute(['{"enabled":true}',$owner]);
$db->prepare('INSERT INTO backup_safety_snapshots VALUES(?,?,?,?,?)')->execute(['preserved-backup',$owner,genesisSharedContentEncrypt('{"synthetic":"historical safety copy"}'),$now,time()+3600]);
foreach(['link-a','link-b'] as $id)$db->prepare('INSERT INTO tasks(id,user_id,sacred_year,month_index,sacred_day,due_date,title,created_at,updated_at) VALUES(?,?,2026,0,1,?,?,?,?)')
    ->execute([$id,$owner,'2026-11-18','Synthetic task',$now,$now]);
$db->prepare('INSERT INTO task_links(user_id,task_id,depends_on_task_id,created_at) VALUES(?,?,?,?)')->execute([$owner,'link-a','link-b',$now]);
// Data present before migration remains preserved and readable in the legacy generation.
$db->prepare('INSERT INTO workspace_blobs(user_id,ciphertext,iv,updated_at) VALUES(?,?,?,?)')->execute([$owner,base64_encode('legacy-preserved'),base64_encode(random_bytes(12)),$now]);
$public=static fn(array $keys):array=>['signingKey'=>$keys['signingKey'],'receivingKey'=>$keys['receivingKey']];
$kit=['protocol'=>1,'ownerId'=>$owner,'authority'=>$public($authority),'protectedKeys'=>['protocol'=>1,'ownerId'=>$owner,'purpose'=>'recovery-authority',
    'salt'=>storeB64(random_bytes(32)),'nonce'=>storeB64(random_bytes(12)),'ciphertext'=>storeB64(random_bytes(256))]];
$c=['protocol'=>1,'ownerId'=>$owner,'scopeId'=>$scopeId,'deviceId'=>'device-a','action'=>'bootstrap','expectedRevision'=>0,'checkpointHash'=>'genesis',
    'securityEpoch'=>1,'operationId'=>'bootstrap-one','payload'=>['kind'=>'personal','resourceId'=>$owner,'keyId'=>'fresh-root-one','generation'=>1,
        'recoveryKit'=>$kit,'recoveryCapsule'=>storeCapsule($authority),'deviceKeys'=>$public($device),'deviceCapsule'=>storeCapsule($device)]];
$c['payload']['selfProof']=storeSign(genesisE2eeCommandBytes($c),$device['private']);
$bootstrap=['command'=>$c,'signature'=>storeSign(genesisE2eeCommandBytes($c),$authority['private'])];
$bad=$bootstrap;$bad['command']['payload']['rawKey']='must-reject';
storeReject(fn()=>genesisE2eeBootstrap($owner,$bad),'E2EE_INVALID_ENVELOPE');
storeCheck(genesisE2eeBootstrap($owner,$bootstrap)['state']==='preparing');
storeCheck(genesisE2eeBootstrap($owner,$bootstrap)['state']==='preparing');
$different=$bootstrap;$different['command']['operationId']='different-bootstrap';$self=$different['command'];unset($self['payload']['selfProof']);
$different['command']['payload']['selfProof']=storeSign(genesisE2eeCommandBytes($self),$device['private']);
$different['signature']=storeSign(genesisE2eeCommandBytes($different['command']),$authority['private']);
storeReject(fn()=>genesisE2eeBootstrap($owner,$different),'E2EE_SCOPE_ALREADY_INITIALIZED');
storeCheck(!str_contains(genesisE2eeJson(genesisE2eeDirectory($owner,$scopeId)),'legacy-preserved'));
storeReject(fn()=>genesisE2eeDirectory('foreign-owner',$scopeId),'E2EE_SCOPE_FORBIDDEN');
$scope=genesisE2eeScope($owner,$scopeId);$source=genesisE2eeSourceHash($db,$scope);
$start=storeCommand('migration-start',['migrationId'=>'migration-one','sourceHash'=>$source]);
$lease=genesisE2eeExecute($owner,$start,$session);storeCheck($lease['fence']===1);
storeCheck(genesisE2eeExecute($owner,$start,$session)===$lease);
$changed=$start;$changed['command']['payload']['migrationId']='changed';$changed['signature']=storeSign(genesisE2eeCommandBytes($changed['command']),$device['private']);
storeReject(fn()=>genesisE2eeExecute($owner,$changed,$session),'E2EE_IDEMPOTENCY_CONFLICT');
storeReject(fn()=>$db->prepare('UPDATE workspace_blobs SET ciphertext=? WHERE user_id=?')->execute(['overwrite',$owner]),'E2EE_LEGACY_WRITE_FORBIDDEN');
storeReject(fn()=>$db->prepare("UPDATE task_links SET created_at='bypass' WHERE user_id=?")->execute([$owner]),'E2EE_LEGACY_WRITE_FORBIDDEN');
storeReject(fn()=>$db->prepare("UPDATE users SET workspace_key_mode='account',workspace_key_enc='lease-bypass' WHERE id=?")->execute([$owner]),'E2EE_LEGACY_WRITE_FORBIDDEN');
storeReject(fn()=>$db->prepare('UPDATE users SET data_generation=99 WHERE id=?')->execute([$owner]),'E2EE_LEGACY_WRITE_FORBIDDEN');
storeReject(fn()=>$db->prepare("UPDATE backup_safety_snapshots SET snapshot_enc='bypass' WHERE user_id=?")->execute([$owner]),'E2EE_LEGACY_WRITE_FORBIDDEN');
storeReject(fn()=>$db->prepare("UPDATE users SET advice_preferences_json='{\"enabled\":false}' WHERE id=?")->execute([$owner]),'E2EE_LEGACY_WRITE_FORBIDDEN');
$put=storePut('workspace-main',0,$lease);
$bad=$put;$bad['command']['payload']['envelope']['context']['ownerId']='foreign';$bad['signature']=storeSign(genesisE2eeCommandBytes($bad['command']),$device['private']);
storeReject(fn()=>genesisE2eeExecute($owner,$bad,$session),'E2EE_CONTEXT_MISMATCH');
$saved=genesisE2eeExecute($owner,$put,$session);storeCheck($saved['revision']===1);
storeCheck(genesisE2eeExecute($owner,$put,$session)===$saved);
storeReject(fn()=>genesisE2eeExecute($owner,storePut('workspace-main',0,$lease),$session),'E2EE_OBJECT_CONFLICT');
$bad=storePut('workspace-second',0,$lease);$bad['command']['payload']['fence']=2;$bad['signature']=storeSign(genesisE2eeCommandBytes($bad['command']),$device['private']);
storeReject(fn()=>genesisE2eeExecute($owner,$bad,$session),'E2EE_MIGRATION_FENCED');
$read=storeCommand('read',['domain'=>'workspace','after'=>'','limit'=>10]);
storeCheck(count(genesisE2eeRead($owner,$read,$session)['envelopes'])===1);
storeReject(fn()=>genesisE2eeExecute($owner,storeCommand('migration-commit',['migrationId'=>'migration-one','fence'=>1,'manifestHash'=>$source,'verifiedCheckpoint'=>$source,'generation'=>1,'objectCount'=>1]),$session),'E2EE_MIGRATION_UNVERIFIED');
$manifest=genesisE2eeManifest($db,genesisE2eeScope($owner,$scopeId));$verifiedCheckpoint=storeB64(random_bytes(32));
$verify=storeCommand('migration-verify',['migrationId'=>'migration-one','fence'=>1]+$manifest+['verifiedCheckpoint'=>$verifiedCheckpoint]);
storeCheck(genesisE2eeExecute($owner,$verify,$session)['state']==='verified');
storeReject(fn()=>genesisE2eeExecute($owner,storePut('late-write',0,$lease),$session),'E2EE_MIGRATION_SEALED');
$commit=storeCommand('migration-commit',['migrationId'=>'migration-one','fence'=>1,'manifestHash'=>$manifest['manifestHash'],'verifiedCheckpoint'=>$verifiedCheckpoint,'generation'=>1,'objectCount'=>$manifest['objectCount']]);
storeCheck(genesisE2eeExecute($owner,$commit,$session)['state']==='active');
storeCheck(genesisE2eeExecute($owner,$commit,$session)['state']==='active');
storeCheck(base64_decode(genesisE2eeRow($db,'SELECT ciphertext FROM workspace_blobs WHERE user_id=?',[$owner])['ciphertext'])==='legacy-preserved');
$user=genesisFindUser($owner);$exposed=genesisWorkspaceForClient($user);storeCheck($exposed['key']===null && $exposed['keyMode']==='e2ee');
storeReject(fn()=>genesisSaveClientWorkspaceKey($owner,['key'=>base64_encode(random_bytes(32))]),'E2EE_UPGRADE_REQUIRED');
storeReject(fn()=>genesisSaveWorkspaceEnvelope($owner,[]),'E2EE_UPGRADE_REQUIRED');
foreach(['workspace','workspace/key','bootstrap','diary/note','mindmaps/map','physis/v1/vault','backup/v1/commit','aurora-workspace','stoicheion-workspace','recovered-tasks/x'] as $route)
    storeReject(fn()=>genesisE2eeEnforceLegacyRoute('POST',$route,$owner),'E2EE_UPGRADE_REQUIRED');
foreach(['auth/logout','billing/orders','e2ee/v1/read'] as $route)genesisE2eeEnforceLegacyRoute('POST',$route,$owner);
foreach(['shared/messenger/devices','shared/messenger/conversations/test/messages','shared/messaging/key','shared/private-conversations/test/read','shared/spaces/test/private-conversations'] as $route)
    genesisE2eeEnforceLegacyRoute('POST',$route,$owner);
storeReject(fn()=>$db->prepare("UPDATE users SET workspace_key_mode='account',workspace_key_enc='new-server-key' WHERE id=?")->execute([$owner]),'E2EE_LEGACY_WRITE_FORBIDDEN');
storeReject(fn()=>$db->prepare('UPDATE users SET data_generation=99 WHERE id=?')->execute([$owner]),'E2EE_LEGACY_WRITE_FORBIDDEN');
storeReject(fn()=>$db->prepare("DELETE FROM backup_safety_snapshots WHERE user_id=?")->execute([$owner]),'E2EE_LEGACY_WRITE_FORBIDDEN');
storeReject(fn()=>$db->prepare("UPDATE users SET advice_notifications_json='{}' WHERE id=?")->execute([$owner]),'E2EE_LEGACY_WRITE_FORBIDDEN');
// Independent authoritative metadata stays writable; archive content cannot set it.
$db->prepare("UPDATE users SET language='en',subscription_plan='free' WHERE id=?")->execute([$owner]);
storeCheck(genesisFindUser($owner)['language']==='en');
storeReject(fn()=>$db->prepare("UPDATE e2ee_scopes SET state='preparing' WHERE scope_id=?")->execute([$scopeId]),'E2EE_DOWNGRADE_FORBIDDEN');
storeReject(fn()=>$db->prepare('DELETE FROM e2ee_scopes WHERE scope_id=?')->execute([$scopeId]),'E2EE_DOWNGRADE_FORBIDDEN');
$challenge=genesisE2eeCreateChallenge($owner,$scopeId,$session,['deviceId'=>'device-b','keys'=>$public($newDevice)]);
$selfProof=storeSign("GENESIS-E2EE-ENROLLMENT\0v1\0".genesisE2eeCanonical($challenge),$newDevice['private']);
$enroll=storeCommand('enroll',['challenge'=>$challenge,'capsule'=>storeCapsule($newDevice),'historyCapsules'=>[],'selfProof'=>$selfProof]);
storeReject(fn()=>genesisE2eeExecute($owner,$enroll,str_repeat('z',32)),'E2EE_CHALLENGE_INVALID');
storeCheck(genesisE2eeExecute($owner,$enroll,$session)['directoryRevision']===3);
$replay=storeCommand('enroll',['challenge'=>$challenge,'capsule'=>storeCapsule($newDevice),'historyCapsules'=>[],'selfProof'=>$selfProof]);
storeReject(fn()=>genesisE2eeExecute($owner,$replay,$session),'E2EE_CHALLENGE_INVALID');
// Revoke an enrolled device: every survivor and recovery get fresh capsules, epochs move together.
$rotate=storeCommand('rotate',['revokedDeviceIds'=>['device-b'],'cryptoEpoch'=>2,'securityEpoch'=>2,'keyId'=>'fresh-root-two',
    'capsules'=>[['deviceId'=>'device-a','capsule'=>storeCapsule($device)]],'recoveryCapsule'=>storeCapsule($authority),
    'retiredManifestHash'=>$manifest['manifestHash'],'retiredObjectCount'=>$manifest['objectCount']]);
$rotation=genesisE2eeExecute($owner,$rotate,$session);storeCheck($rotation['securityEpoch']===2 && $rotation['signInRequired']);
$reuse=storeCommand('rotate',['revokedDeviceIds'=>[],'cryptoEpoch'=>3,'securityEpoch'=>3,'keyId'=>'fresh-root-one',
    'capsules'=>[['deviceId'=>'device-a','capsule'=>storeCapsule($device)]],'recoveryCapsule'=>storeCapsule($authority),
    'retiredManifestHash'=>$manifest['manifestHash'],'retiredObjectCount'=>$manifest['objectCount']]);
storeReject(fn()=>genesisE2eeExecute($owner,$reuse,$session),'E2EE_INVALID_ENVELOPE');
$revoked=storeCommand('read',['domain'=>'workspace','after'=>'','limit'=>10],replace:['deviceId'=>'device-b']);
$revoked['signature']=storeSign(genesisE2eeCommandBytes($revoked['command']),$newDevice['private']);
storeReject(fn()=>genesisE2eeRead($owner,$revoked,$session),'E2EE_REVOKED_DEVICE');
storeReject(fn()=>genesisE2eeExecute($owner,storeCommand('migration-cancel',['migrationId'=>'migration-one','fence'=>1]),$session),'E2EE_ALREADY_ACTIVE');
$accepted=storePut('workspace-main',1,[]);$acceptedResult=genesisE2eeExecute($owner,$accepted,$session);storeCheck($acceptedResult['revision']===2);
$cancelAccepted=storeCommand('cancel-put',['original'=>$accepted]);
storeCheck(genesisE2eeExecute($owner,$cancelAccepted,$session)['operationReceipt']['result']===$acceptedResult);
$late=storePut('must-not-arrive',0,[]);$cancelLate=storeCommand('cancel-put',['original'=>$late]);
$wrongScope=$late;$wrongScope['command']['scopeId']='personal:foreign';$wrongScope['signature']=storeSign(genesisE2eeCommandBytes($wrongScope['command']),$device['private']);
storeReject(fn()=>genesisE2eeExecute($owner,storeCommand('cancel-put',['original'=>$wrongScope]),$session),'E2EE_CONTEXT_MISMATCH');
$wrongSigner=$late;$wrongSigner['command']['deviceId']='device-b';$wrongSigner['signature']=storeSign(genesisE2eeCommandBytes($wrongSigner['command']),$newDevice['private']);
storeReject(fn()=>genesisE2eeExecute($owner,storeCommand('cancel-put',['original'=>$wrongSigner]),$session),'E2EE_CONTEXT_MISMATCH');
storeCheck(genesisE2eeExecute($owner,$cancelLate,$session)['operationReceipt']['result']===['cancelled'=>true]);
storeCheck(genesisE2eeExecute($owner,$late,$session)===['cancelled'=>true]);
storeCheck(!genesisE2eeRow($db,"SELECT 1 FROM e2ee_objects WHERE scope_id=? AND object_id='must-not-arrive'",[$scopeId]));
$heads=genesisE2eeRead($owner,storeCommand('sealed-heads',['cryptoEpoch'=>0]),$session);storeCheck(count($heads['objects'])===1);
$heads=genesisE2eeRead($owner,storeCommand('sealed-heads',['cryptoEpoch'=>1]),$session);storeCheck(count($heads['objects'])===1);
// No client archive can replace authoritative identity/billing/ACL tables: command fields are exact.
storeReject(fn()=>genesisE2eeExecute($owner,storeCommand('restore',['subscriptionPlan'=>'elite_plus']),$session),'E2EE_UNKNOWN_ACTION');
echo 'PASS e2ee-store '.$checks.' assertions (synthetic opaque store/crypto/CAS/fence/lease/enrollment/revoke)'.PHP_EOL;
