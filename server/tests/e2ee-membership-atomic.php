<?php
declare(strict_types=1);
require __DIR__.'/e2ee-store.php';
require_once dirname(__DIR__).'/src/shared-projects.php';
require_once dirname(__DIR__).'/src/e2ee-membership-atomic-apply.php';

// Real migrated SQLite, ECDSA verification, guards and transaction writer.
// Opaque random bodies/capsules are server fixtures, not client decryption evidence.
$owner='atomic-owner';$member='atomic-member';$space='atomic-space';$inbox='atomic-inbox';$project='atomic-project';
$authority=storePair();$device=storePair();$memberDevice=storePair();$session=str_repeat('a',32);
foreach([$owner,$member] as $id)$db->prepare("INSERT INTO users(id,google_sub,email,display_name,subscription_plan,subscription_valid_until,shared_projects_enabled,created_at,updated_at) VALUES(?,?,?,?,'business','2035-01-01T00:00:00Z',1,?,?)")
    ->execute([$id,$id,$id.'@example.invalid','Synthetic',$now,$now]);
$db->prepare('INSERT INTO shared_spaces(id,title,created_by,created_at,updated_at) VALUES(?,?,?,?,?)')->execute([$space,'Synthetic',$owner,$now,$now]);
foreach([$inbox,$project] as $id)$db->prepare('INSERT INTO shared_projects(id,space_id,title,created_by,is_inbox,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')->execute([$id,$space,'Synthetic',$owner,(int)($id===$inbox),$now,$now]);
foreach([$owner=>'owner',$member=>'member'] as $id=>$role){
    $db->prepare('INSERT INTO shared_space_members(space_id,user_id,role,joined_at) VALUES(?,?,?,?)')->execute([$space,$id,$role,$now]);
    foreach([$inbox,$project] as $pid)$db->prepare('INSERT INTO shared_project_members(project_id,user_id,role,joined_at) VALUES(?,?,?,?)')->execute([$pid,$id,$role,$now]);
}
$kit=['protocol'=>1,'ownerId'=>$owner,'authority'=>$public($authority),'protectedKeys'=>['protocol'=>1,'ownerId'=>$owner,'purpose'=>'recovery-authority',
    'salt'=>storeB64(random_bytes(32)),'nonce'=>storeB64(random_bytes(12)),'ciphertext'=>storeB64(random_bytes(256))]];
foreach(['personal'=>$owner,'space'=>$space,'inbox'=>$inbox,'project'=>$project] as $label=>$resource){
    $kind=$label==='inbox'?'project':$label;$scopeId=$kind.':'.$resource;
    $command=['protocol'=>1,'ownerId'=>$owner,'scopeId'=>$scopeId,'deviceId'=>'device-a','action'=>'bootstrap','expectedRevision'=>0,'checkpointHash'=>'genesis',
        'securityEpoch'=>1,'operationId'=>'atomic-bootstrap-'.$label,'payload'=>['kind'=>$kind,'resourceId'=>$resource,'keyId'=>'atomic-root-'.$label,'generation'=>1,
            'recoveryKit'=>$kit,'recoveryCapsule'=>storeCapsule($authority),'deviceKeys'=>$public($device),'deviceCapsule'=>storeCapsule($device)]];
    $command['payload']['selfProof']=storeSign(genesisE2eeCommandBytes($command),$device['private']);
    genesisE2eeBootstrap($owner,['command'=>$command,'signature'=>storeSign(genesisE2eeCommandBytes($command),$authority['private'])]);
    $source=genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId));$migration='atomic-migration-'.$label;
    $lease=genesisE2eeExecute($owner,storeCommand('migration-start',['migrationId'=>$migration,'sourceHash'=>$source]),$session);
    $operation=null;
    if($kind!=='personal'){
        $object='product-version:'.genesisUuid();$saved=genesisE2eeExecute($owner,storePut($object,0,['migrationId'=>$migration,'fence'=>$lease['fence']],'shared-project'),$session);
        $metadata=$kind==='space'?['protocol'=>1]:['protocol'=>2,'spaceId'=>$space,'parentProjectId'=>null,'projectCategoryId'=>null,'boardStatusId'=>null,'projectType'=>'project','layout'=>'list','isInbox'=>$resource===$inbox,'archived'=>false];
        $operation=['action'=>'create','entityId'=>$scopeId,'kind'=>$kind,'expectedRevision'=>0,'domain'=>'shared-project','objectId'=>$object,'payloadHash'=>$saved['payloadHash'],'parentId'=>null,'metadata'=>$metadata,'proposalId'=>null];
    }
    $manifest=genesisE2eeManifest($db,genesisE2eeScope($owner,$scopeId));$checkpoint=storeB64(random_bytes(32));
    genesisE2eeExecute($owner,storeCommand('migration-verify',['migrationId'=>$migration,'fence'=>$lease['fence']]+$manifest+['verifiedCheckpoint'=>$checkpoint]),$session);
    genesisE2eeExecute($owner,storeCommand('migration-commit',['migrationId'=>$migration,'fence'=>$lease['fence'],'manifestHash'=>$manifest['manifestHash'],'verifiedCheckpoint'=>$checkpoint,'generation'=>1,'objectCount'=>$manifest['objectCount']]),$session);
    if($operation!==null){
        genesisE2eeExecute($owner,storeCommand('product-bootstrap-start',['intentId'=>'atomic-start-'.$label,'bootstrapId'=>'atomic-product-'.$label,'sourceManifestHash'=>$manifest['manifestHash'],'expectedCount'=>1]),$session);
        $part=genesisE2eeExecute($owner,storeCommand('product-bootstrap-stage',['intentId'=>'atomic-part-'.$label,'bootstrapId'=>'atomic-product-'.$label,'partIndex'=>0,'items'=>[['operation'=>$operation,'authorId'=>$owner]]]),$session);
        genesisE2eeExecute($owner,storeCommand('product-bootstrap-complete',['intentId'=>'atomic-complete-'.$label,'bootstrapId'=>'atomic-product-'.$label,'parts'=>[['partIndex'=>0,'proofHash'=>$part['proofHash']]],'expectedCount'=>1]),$session);
        $challenge=genesisE2eeCreateChallenge($member,$scopeId,$session,['deviceId'=>'device-member','keys'=>$public($memberDevice)]);
        $proof=storeSign("GENESIS-E2EE-ENROLLMENT\0v1\0".genesisE2eeCanonical($challenge),$memberDevice['private']);
        genesisE2eeExecute($member,storeCommand('enroll',['challenge'=>$challenge,'capsule'=>storeCapsule($memberDevice),'historyCapsules'=>[],'selfProof'=>$proof]),$session);
    }
}
$personal='personal:'.$owner;$scopeId=$personal;
function atomicAuth(string $action,array $payload):array {global $scopeId,$personal;$scopeId=$personal;return storeCommand($action,$payload);}
function atomicPlan(string $intent):array {
    global $db,$owner,$member,$space;
    $op=['kind'=>'project-grants','spaceId'=>$space,'userId'=>$member,'allProjects'=>false,'grants'=>[]];
    $db->beginTransaction();try{$snapshot=genesisMembershipOperationSnapshot($db,$owner,$space,$op);$effects=genesisMembershipOperationPlan($snapshot,$op);$fingerprint=genesisMembershipOperationFingerprint($snapshot,$op);}finally{$db->rollBack();}
    $anchors=[];foreach($effects['requiredScopes'] as $scope){$root=$scope['root'];$kind=str_starts_with($root['entityId'],'space:')?'space':'project';
        $anchors[]=['scopeId'=>$scope['scopeId'],'ownerId'=>$scope['ownerId'],'kind'=>$kind,'resourceId'=>substr($root['entityId'],strpos($root['entityId'],':')+1),
            'generation'=>$root['generation'],'directoryRevision'=>$root['directoryRevision'],'checkpointHash'=>$root['checkpointHash'],'entityId'=>$root['entityId'],'revision'=>$root['revision'],'payloadHash'=>$root['payloadHash'],'productIndexHash'=>$root['productIndexHash']];}
    $pages=[];foreach(['operation'=>[array_diff_key($op,['grants'=>true])],'acl'=>$effects['changes'],'anchors'=>$anchors,'clear-assignments'=>$effects['clearAssignments'],'revoke-invitations'=>$effects['revokeInvitations'],'role-events'=>$effects['roleEvents']] as $kind=>$items)
        foreach(array_chunk($items,200) as $items)$pages[]=['kind'=>$kind,'items'=>$items];
    $refs=[];foreach($pages as $i=>$page)$refs[]=genesisMembershipAtomicPageRef($i,$page);
    $plan=genesisMembershipAtomicPlan(['format'=>'genesis-membership-atomic-plan-v2','actorId'=>$owner,'intentId'=>$intent,'spaceId'=>$space,'reviewFingerprint'=>$fingerprint,'scopeIds'=>$effects['scopeIds'],'pages'=>$refs]);
    return ['plan'=>$plan,'pages'=>$pages,'planHash'=>genesisMembershipAtomicDigest($plan),'changeHash'=>genesisMembershipAtomicChangeHash($plan)];
}
function atomicBegin(array $value):array {global $owner;$payload=['intentId'=>$value['plan']['intentId'],'planHash'=>$value['planHash']];return ['plan'=>$value['plan'],'authorization'=>atomicAuth('membership-atomic-begin',$payload)];}
function atomicPage(array $value,string $phase,int $index,array $page):array {
    $payload=['intentId'=>$value['plan']['intentId'],'planHash'=>$value['planHash'],'phase'=>$phase,'index'=>$index,'pageHash'=>genesisMembershipAtomicPageRef($index,$page)['pageHash']];
    return array_diff_key($payload,['pageHash'=>true])+['page'=>$page,'authorization'=>atomicAuth('membership-atomic-page',$payload)];
}
function atomicStage(array $value):array {
    global $owner;genesisMembershipAtomicBegin($owner,atomicBegin($value));
    foreach($value['pages'] as $index=>$page)genesisMembershipAtomicStagePage($owner,atomicPage($value,'plan',$index,$page));
    $payload=['intentId'=>$value['plan']['intentId'],'planHash'=>$value['planHash'],'after'=>0];
    return genesisMembershipAtomicPreview($owner,$payload+['authorization'=>atomicAuth('membership-atomic-preview',$payload)]);
}
function atomicSnapshot():array {
    global $db; $result=[];
    foreach(['e2ee_scopes','e2ee_devices','e2ee_retired_manifests','e2ee_events','e2ee_product_entities','shared_space_members','shared_project_members','shared_member_project_grants','e2ee_membership_atomic_receipt_pages'] as $table)
        $result[$table]=$db->query('SELECT * FROM "'.$table.'" ORDER BY 1,2')->fetchAll();
    return $result;
}
function atomicPackets(array $value,array $preview,bool $badLast=false):array {
    global $owner,$scopeId,$device,$authority,$memberDevice;
    $packets=[];foreach($preview['scopePlans'] as $index=>$row){$scopeId=$row['scopeId'];$roles=[];$revoked=[];$capsules=[];
        foreach($row['roles'] as $role){if($role['role']===null)$revoked[]=$role['deviceId'];else{$roles[]=['deviceId'=>$role['deviceId'],'role'=>$role['role']];$capsules[]=['deviceId'=>$role['deviceId'],'capsule'=>storeCapsule($role['deviceId']==='device-a'?$device:$memberDevice)];}}
        $key='atomic-next-'.str_replace(':','-',$scopeId).'-'.$value['plan']['intentId'];
        if($badLast&&$index===count($preview['scopePlans'])-1)$key=genesisE2eeScope($owner,$scopeId)['key_id'];
        $packets[]=storeCommand('rotate-membership',['revokedDeviceIds'=>$revoked,'cryptoEpoch'=>$row['cryptoEpoch']+1,'securityEpoch'=>$row['securityEpoch']+1,'keyId'=>$key,
            'capsules'=>$capsules,'recoveryCapsule'=>storeCapsule($authority),'retiredManifestHash'=>$row['manifest']['manifestHash'],'retiredObjectCount'=>$row['manifest']['objectCount'],
            'membershipHash'=>$value['changeHash'],'roleChanges'=>$roles]);
    }
    return ['kind'=>'rotation-packets','items'=>$packets];
}
function atomicSeal(array $value,array $page):array {
    global $owner;$refs=[genesisMembershipAtomicPageRef(0,$page)];$batch=genesisMembershipAtomicBatchHash($value['plan'],$refs);
    genesisMembershipAtomicStagePage($owner,atomicPage($value,'packets',0,$page));
    $payload=['intentId'=>$value['plan']['intentId'],'planHash'=>$value['planHash'],'batchHash'=>$batch];
    genesisMembershipAtomicSeal($owner,['intentId'=>$payload['intentId'],'planHash'=>$payload['planHash'],'packetPages'=>$refs,'authorization'=>atomicAuth('membership-atomic-seal',$payload)]);
    return $payload+['authorization'=>atomicAuth('membership-atomic-commit',$payload)];
}
$baseChecks=$checks;$baseline=atomicSnapshot();

// Cancellation before begin also fences a delayed request signed before cancel.
$early=atomicPlan('atomic-cancel-before-begin');$lateBegin=atomicBegin($early);$cancel=['intentId'=>$early['plan']['intentId'],'planHash'=>$early['planHash']];
storeCheck(genesisMembershipAtomicCancel($owner,$cancel+['authorization'=>atomicAuth('membership-atomic-cancel',$cancel)])['state']==='cancelled');
storeReject(fn()=>genesisMembershipAtomicBegin($owner,$lateBegin),'E2EE_MEMBERSHIP_CANCELLED');
storeCheck(atomicSnapshot()===$baseline);

$cancelled=atomicPlan('atomic-cancel-staged');$begin=atomicBegin($cancelled);
storeCheck(genesisMembershipAtomicBegin($owner,$begin)===genesisMembershipAtomicBegin($owner,$begin));
$page=atomicPage($cancelled,'plan',0,$cancelled['pages'][0]);
storeCheck(genesisMembershipAtomicStagePage($owner,$page)===genesisMembershipAtomicStagePage($owner,$page));
$incomplete=['intentId'=>$cancelled['plan']['intentId'],'planHash'=>$cancelled['planHash'],'after'=>0];
storeReject(fn()=>genesisMembershipAtomicPreview($owner,$incomplete+['authorization'=>atomicAuth('membership-atomic-preview',$incomplete)]),'E2EE_MEMBERSHIP_PAGE_INCOMPLETE');
$cancel=['intentId'=>$cancelled['plan']['intentId'],'planHash'=>$cancelled['planHash']];$cancel['authorization']=atomicAuth('membership-atomic-cancel',$cancel);
storeCheck(genesisMembershipAtomicCancel($owner,$cancel)===genesisMembershipAtomicCancel($owner,$cancel));
storeReject(fn()=>genesisMembershipAtomicStagePage($owner,$page),'E2EE_MEMBERSHIP_CANCELLED');
storeCheck(atomicSnapshot()===$baseline);

// Preview changes ACL only within a writer which always rolls back.
$invalid=atomicPlan('atomic-late-rotation-invalid');$preview=atomicStage($invalid);
storeCheck(count($preview['scopePlans'])===3&&$preview['next']===null);storeCheck(atomicSnapshot()===$baseline);
$invalidCommit=atomicSeal($invalid,atomicPackets($invalid,$preview,true));
storeReject(fn()=>genesisMembershipAtomicCommit($owner,$invalidCommit,$session),'E2EE_INVALID_ENVELOPE');
storeCheck(atomicSnapshot()===$baseline);

// A sealed, well-formed batch missing one owner signature cannot partly apply.
$missing=atomicPlan('atomic-missing-owner');$preview=atomicStage($missing);$packets=atomicPackets($missing,$preview);array_pop($packets['items']);
$missingCommit=atomicSeal($missing,$packets);
storeReject(fn()=>genesisMembershipAtomicCommit($owner,$missingCommit,$session),'E2EE_MEMBERSHIP_ROTATION_INCOMPLETE');storeCheck(atomicSnapshot()===$baseline);

$valid=atomicPlan('atomic-valid');$preview=atomicStage($valid);$packets=atomicPackets($valid,$preview);
$forgedValue=atomicPlan('atomic-forged-owner');$forgedPreview=atomicStage($forgedValue);
$forged=atomicPackets($forgedValue,$forgedPreview);$forged['items'][0]['signature']=storeB64(random_bytes(64));$forgedCommit=atomicSeal($forgedValue,$forged);
storeReject(fn()=>genesisMembershipAtomicCommit($owner,$forgedCommit,$session),'E2EE_UNTRUSTED_COMMAND');storeCheck(atomicSnapshot()===$baseline);

$commit=atomicSeal($valid,$packets);$result=genesisMembershipAtomicCommit($owner,$commit,$session);
storeCheck($result['format']==='genesis-membership-atomic-receipt-v2'&&$result['signInRequired']);
storeCheck(genesisMembershipAtomicCommit($owner,$commit,$session)===$result);$afterCommit=atomicSnapshot();
storeCheck(!$db->query("SELECT 1 FROM shared_project_members WHERE user_id='atomic-member'")->fetchColumn());
storeCheck((int)$db->query("SELECT COUNT(*) FROM e2ee_scopes WHERE resource_id IN ('atomic-space','atomic-inbox','atomic-project') AND crypto_epoch=2 AND security_epoch=2")->fetchColumn()===3);
storeCheck((int)$db->query("SELECT COUNT(*) FROM e2ee_devices WHERE device_id='device-member' AND revoked=1")->fetchColumn()===2);
$different=$commit;$different['authorization']=atomicAuth('membership-atomic-commit',array_diff_key($commit,['authorization'=>true]));
storeReject(fn()=>genesisMembershipAtomicCommit($owner,$different,$session),'E2EE_IDEMPOTENCY_CONFLICT');storeCheck(atomicSnapshot()===$afterCommit);
$receiptPayload=array_diff_key($commit,['authorization'=>true]);
storeCheck(genesisMembershipAtomicReceipt($owner,$receiptPayload+['authorization'=>atomicAuth('membership-atomic-receipt',$receiptPayload)])===$result);
foreach($result['pages'] as $ref){$payload=$receiptPayload+['index'=>$ref['index']];$page=genesisMembershipAtomicReceipt($owner,$payload+['authorization'=>atomicAuth('membership-atomic-receipt-page',$payload)],true);
    storeCheck(genesisMembershipAtomicDigest($page['page'])===$ref['pageHash']);}
$cancel=array_diff_key($receiptPayload,['batchHash'=>true]);$cancel['authorization']=atomicAuth('membership-atomic-cancel',$cancel);
storeCheck(genesisMembershipAtomicCancel($owner,$cancel)['result']===$result);
foreach([$inbox,$project] as $id){$scopeId='project:'.$id;$read=storeCommand('read',['domain'=>'shared-project','after'=>'','limit'=>10],replace:['deviceId'=>'device-member']);$read['signature']=storeSign(genesisE2eeCommandBytes($read['command']),$memberDevice['private']);
    storeReject(fn()=>genesisE2eeRead($member,$read,$session),'SHARED_PROJECT_NOT_FOUND');
    storeCheck(count(genesisE2eeRead($owner,storeCommand('read',['domain'=>'shared-project','after'=>'','limit'=>10]),$session)['envelopes'])===1);
}
// Membership rotations must retain the epoch-to-key history just like revocation.
// Otherwise historical reads cannot name epoch 2 and a later rotation can reuse it.
foreach($packets['items'] as $packet){$command=$packet['command'];
    if((genesisE2eeEpochKeys($db,$command['scopeId'])[2]??null)!==$command['payload']['keyId'])throw new RuntimeException('E2EE_MEMBERSHIP_EPOCH_HISTORY_MISSING');
    storeCheck(true);
}
// Neither a current membership key nor a retired one may be reused later.
$scopeId='project:'.$project;$scope=genesisE2eeScope($owner,$scopeId);$membershipKey=$scope['key_id'];$manifest=genesisE2eeManifest($db,$scope);
$rotation=['revokedDeviceIds'=>[],'cryptoEpoch'=>3,'securityEpoch'=>3,'keyId'=>$membershipKey,
    'capsules'=>[['deviceId'=>'device-a','capsule'=>storeCapsule($device)]],'recoveryCapsule'=>storeCapsule($authority),
    'retiredManifestHash'=>$manifest['manifestHash'],'retiredObjectCount'=>$manifest['objectCount']];
storeReject(fn()=>genesisE2eeExecute($owner,storeCommand('rotate',$rotation),$session),'E2EE_INVALID_ENVELOPE');
$rotation['keyId']='atomic-fresh-epoch-three';genesisE2eeExecute($owner,storeCommand('rotate',$rotation),$session);
$rotation['cryptoEpoch']=4;$rotation['securityEpoch']=4;$rotation['keyId']=$membershipKey;
storeReject(fn()=>genesisE2eeExecute($owner,storeCommand('rotate',$rotation),$session),'E2EE_INVALID_ENVELOPE');

// A clean trusted device must receive every historic epoch, including those
// introduced by membership changes. This checks server grants, not decryption.
$candidate=storePair();$challenge=genesisE2eeCreateChallenge($owner,$scopeId,$session,['deviceId'=>'device-history','keys'=>$public($candidate)]);
$proof=storeSign("GENESIS-E2EE-ENROLLMENT\0v1\0".genesisE2eeCanonical($challenge),$candidate['private']);
$history=[];foreach(genesisE2eeEpochKeys($db,$scopeId) as $epoch=>$key)if($epoch<3)$history[]=['cryptoEpoch'=>$epoch,'keyId'=>$key,'capsule'=>storeCapsule($candidate)];
storeCheck(array_column($history,'cryptoEpoch')===[1,2]&&$history[1]['keyId']===$membershipKey);
$payload=['challenge'=>$challenge,'capsule'=>storeCapsule($candidate),'historyCapsules'=>[$history[0]],'selfProof'=>$proof];
storeReject(fn()=>genesisE2eeExecute($owner,storeCommand('enroll',$payload),$session),'E2EE_HISTORY_INCOMPLETE');
$payload['historyCapsules']=$history;$beforeEnrollment=(int)genesisE2eeScope($owner,$scopeId)['directory_revision'];
$accepted=genesisE2eeExecute($owner,storeCommand('enroll',$payload),$session);
storeCheck($accepted['directoryRevision']===$beforeEnrollment+1);
echo 'PASS e2ee-membership-atomic '.($checks-$baseChecks).' assertions (signed staging/cancel/replay, complete owner closure, late-rotation rollback, ACL+epochs, immutable receipt, removed-member refusal)'.PHP_EOL;
