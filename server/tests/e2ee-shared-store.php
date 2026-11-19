<?php
declare(strict_types=1);
require __DIR__.'/e2ee-store.php';
require_once dirname(__DIR__).'/src/shared-projects.php';

// Reuse only synthetic signing helpers; all content/ACL rows are isolated by backend-run.
$owner='synthetic-group-owner';$scopeId='project:synthetic-group';$project='synthetic-group';$space='synthetic-space';
foreach([$owner,'synthetic-reader','synthetic-commenter','synthetic-writer'] as $id)
    $db->prepare("INSERT INTO users(id,google_sub,email,display_name,subscription_plan,subscription_valid_until,shared_projects_enabled,created_at,updated_at) VALUES(?,?,?,?,'business','2035-01-01T00:00:00Z',1,?,?)")
        ->execute([$id,$id,$id.'@example.invalid','Synthetic',$now,$now]);
$db->prepare('INSERT INTO shared_spaces(id,title,created_by,created_at,updated_at) VALUES(?,?,?,?,?)')->execute([$space,'Synthetic group',$owner,$now,$now]);
$db->prepare('INSERT INTO shared_projects(id,space_id,title,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?)')->execute([$project,$space,'Synthetic project',$owner,$now,$now]);
foreach([$owner=>'owner','synthetic-reader'=>'viewer','synthetic-commenter'=>'commenter','synthetic-writer'=>'member'] as $id=>$role) {
    $db->prepare('INSERT INTO shared_space_members(space_id,user_id,role,joined_at) VALUES(?,?,?,?)')->execute([$space,$id,$id===$owner?'owner':'member',$now]);
    $db->prepare('INSERT INTO shared_project_members(project_id,user_id,role,joined_at) VALUES(?,?,?,?)')->execute([$project,$id,$role,$now]);
}
$db->prepare('INSERT INTO shared_task_series(id,project_id,owner_id,rule_json,template_json,cursor_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    ->execute(['series-e2ee',$project,$owner,'{"limit":10}','{}','2026-11-18',$now,$now]);
$db->prepare('INSERT INTO shared_automation_rules(id,project_id,owner_id,title,definition_json,checked_at,created_at,updated_at,enabled) VALUES(?,?,?,?,?,?,?,?,1)')
    ->execute(['rule-e2ee',$project,$owner,'Synthetic rule','{}',$now,$now,$now]);
$kit['ownerId']=$owner;$kit['protectedKeys']['ownerId']=$owner;
$c=['protocol'=>1,'ownerId'=>$owner,'scopeId'=>$scopeId,'deviceId'=>'device-a','action'=>'bootstrap','expectedRevision'=>0,'checkpointHash'=>'genesis','securityEpoch'=>1,
    'operationId'=>'group-bootstrap','payload'=>['kind'=>'project','resourceId'=>$project,'keyId'=>'fresh-group-root','generation'=>1,'recoveryKit'=>$kit,
    'recoveryCapsule'=>storeCapsule($authority),'deviceKeys'=>$public($device),'deviceCapsule'=>storeCapsule($device)]];
$c['payload']['selfProof']=storeSign(genesisE2eeCommandBytes($c),$device['private']);
genesisE2eeBootstrap($owner,['command'=>$c,'signature'=>storeSign(genesisE2eeCommandBytes($c),$authority['private'])]);
// Even an authorized shared owner cannot export a personal legacy workspace
// through group ACLs or conservative multi-project deny predicates.
storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-workspace',['migrationId'=>'group-read','fence'=>1,'sourceHash'=>storeB64(random_bytes(32))]),$session),'E2EE_SCOPE_FORBIDDEN');
storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-aurora',['migrationId'=>'group-read','fence'=>1,'sourceHash'=>storeB64(random_bytes(32))]),$session),'E2EE_SCOPE_FORBIDDEN');
storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-stoicheion',['migrationId'=>'group-read','fence'=>1,'sourceHash'=>storeB64(random_bytes(32))]),$session),'E2EE_SCOPE_FORBIDDEN');
storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-advice',['migrationId'=>'group-read','fence'=>1,'sourceHash'=>storeB64(random_bytes(32))]),$session),'E2EE_SCOPE_FORBIDDEN');
storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-tasks',['migrationId'=>'group-read','fence'=>1,'sourceHash'=>storeB64(random_bytes(32))]),$session),'E2EE_SCOPE_FORBIDDEN');
$scope=genesisE2eeScope($owner,$scopeId);$source=genesisE2eeSourceHash($db,$scope);
$db->prepare('UPDATE shared_task_series SET checked_at=? WHERE id=?')->execute(['before-lease','series-e2ee']);
storeCheck(genesisE2eeSourceHash($db,$scope)!==$source);$source=genesisE2eeSourceHash($db,$scope);
$start=storeCommand('migration-start',['migrationId'=>'group-attempt-one','sourceHash'=>$source]);$lease=genesisE2eeExecute($owner,$start,$session);
foreach(['UPDATE shared_task_series SET checked_at=\'bypass\' WHERE id=\'series-e2ee\'',
    'UPDATE shared_automation_rules SET checked_at=\'bypass\' WHERE id=\'rule-e2ee\''] as $sql)
    storeReject(fn()=>$db->exec($sql),'E2EE_LEGACY_WRITE_FORBIDDEN');
storeReject(fn()=>$db->prepare("UPDATE shared_project_members SET role='member' WHERE project_id=? AND user_id=?")->execute([$project,'synthetic-reader']),'E2EE_ACL_ROTATION_REQUIRED');
// Real expiry permits legacy changes, but resuming cannot silently accept the new source.
$db->prepare('UPDATE e2ee_migrations SET lease_until=0 WHERE scope_id=?')->execute([$scopeId]);
$db->prepare('UPDATE shared_automation_rules SET checked_at=? WHERE id=?')->execute(['after-expiry','rule-e2ee']);
storeReject(fn()=>genesisE2eeExecute($owner,storeCommand('migration-resume',['migrationId'=>'group-attempt-one','fence'=>1,'sourceHash'=>$source,'pendingOperationId'=>null,'pendingHash'=>null]),$session),'E2EE_SOURCE_CHANGED');
genesisE2eeExecute($owner,storeCommand('migration-cancel',['migrationId'=>'group-attempt-one','fence'=>1]),$session);
$source=genesisE2eeSourceHash($db,$scope);
$lease=genesisE2eeExecute($owner,storeCommand('migration-start',['migrationId'=>'group-attempt-two','sourceHash'=>$source]),$session);
storeCheck($lease['fence']===2 && $lease['generation']===2);
$pending=storePut('group-document',0,$lease,'shared-project');
$db->prepare('UPDATE e2ee_migrations SET lease_until=0 WHERE scope_id=?')->execute([$scopeId]);
$resume=storeCommand('migration-resume',['migrationId'=>'group-attempt-two','fence'=>2,'sourceHash'=>$source,
    'pendingOperationId'=>$pending['command']['operationId'],'pendingHash'=>genesisE2eeCommandHash($pending['command'])]);
$renewed=genesisE2eeExecute($owner,$resume,$session);storeCheck($renewed['fence']===3 && $renewed['pendingReceipt']===null);
storeCheck(genesisE2eeExecute($owner,$resume,$session)===$renewed);
storeReject(fn()=>genesisE2eeExecute($owner,$pending,$session),'E2EE_MIGRATION_FENCED');
$lease['fence']=3;$pending=storePut('group-document',0,$lease,'shared-project');$saved=genesisE2eeExecute($owner,$pending,$session);
$receipt=genesisE2eeRead($owner,storeCommand('receipt',['operationId'=>$pending['command']['operationId'],'payloadHash'=>genesisE2eeCommandHash($pending['command'])]),$session);
storeCheck($receipt['receipt']['result']===$saved);
$manifest=genesisE2eeManifest($db,genesisE2eeScope($owner,$scopeId));$checkpoint=storeB64(random_bytes(32));
genesisE2eeExecute($owner,storeCommand('migration-verify',['migrationId'=>'group-attempt-two','fence'=>3]+$manifest+['verifiedCheckpoint'=>$checkpoint]),$session);
genesisE2eeExecute($owner,storeCommand('migration-commit',['migrationId'=>'group-attempt-two','fence'=>3,'manifestHash'=>$manifest['manifestHash'],'verifiedCheckpoint'=>$checkpoint,'generation'=>2,'objectCount'=>$manifest['objectCount']]),$session);
foreach(['UPDATE shared_task_series SET cursor_date=\'2027-01-01\' WHERE id=\'series-e2ee\'',
    'UPDATE shared_automation_rules SET enabled=1 WHERE id=\'rule-e2ee\''] as $sql)
    storeReject(fn()=>$db->exec($sql),'E2EE_LEGACY_WRITE_FORBIDDEN');
storeReject(fn()=>$db->prepare('DELETE FROM shared_project_members WHERE project_id=? AND user_id=?')->execute([$project,'synthetic-reader']),'E2EE_ACL_ROTATION_REQUIRED');
storeReject(fn()=>$db->prepare("UPDATE shared_space_members SET role='guest' WHERE space_id=? AND user_id=?")->execute([$space,'synthetic-writer']),'E2EE_ACL_ROTATION_REQUIRED');
// Each role is server-derived, independently approved by the pinned owner and signed by the candidate.
$members=[];
foreach(['reader','commenter','writer'] as $role) {
    $id='synthetic-'.$role;$pair=storePair();$deviceId='device-'.$role;$binding=str_repeat(substr($role,0,1),32);
    $challenge=genesisE2eeCreateChallenge($id,$scopeId,$binding,['deviceId'=>$deviceId,'keys'=>$public($pair)]);storeCheck($challenge['role']===$role);
    $proof=storeSign("GENESIS-E2EE-ENROLLMENT\0v1\0".genesisE2eeCanonical($challenge),$pair['private']);
    $approval=storeCommand('enroll',['challenge'=>$challenge,'capsule'=>storeCapsule($pair),'historyCapsules'=>[],'selfProof'=>$proof]);
    genesisE2eeExecute($id,$approval,$binding);$members[$role]=['id'=>$id,'deviceId'=>$deviceId,'pair'=>$pair,'binding'=>$binding];
}
function groupPut(array $member,string $domain,string $objectId,int $expected=0):array {
    $packet=storePut($objectId,$expected,[],$domain);$c=&$packet['command'];$e=&$c['payload']['envelope'];
    $c['deviceId']=$member['deviceId'];$e['context']['deviceId']=$member['deviceId'];$e['signature']=storeSign(genesisE2eeSignatureData($e),$member['pair']['private']);
    $packet['signature']=storeSign(genesisE2eeCommandBytes($c),$member['pair']['private']);return $packet;
}
$reader=$members['reader'];$commenter=$members['commenter'];$writer=$members['writer'];
storeReject(fn()=>genesisE2eeExecute($reader['id'],groupPut($reader,'shared-project','forbidden'),$reader['binding']),'SHARED_PROJECT_FORBIDDEN');
storeReject(fn()=>genesisE2eeExecute($commenter['id'],groupPut($commenter,'shared-project','forbidden'),$commenter['binding']),'SHARED_PROJECT_FORBIDDEN');
storeCheck(genesisE2eeExecute($writer['id'],groupPut($writer,'shared-project','writer-document'),$writer['binding'])['revision']===1);
storeCheck(genesisE2eeExecute($commenter['id'],groupPut($commenter,'shared-comment','comment'),$commenter['binding'])['revision']===1);
storeReject(fn()=>genesisE2eeExecute($commenter['id'],groupPut($commenter,'shared-comment','comment',1),$commenter['binding']),'E2EE_COMMENT_IMMUTABLE');
$bad=storeCommand('enroll',$approval['command']['payload']);$bad['command']['deviceId']=$reader['deviceId'];
$bad['signature']=storeSign(genesisE2eeCommandBytes($bad['command']),$reader['pair']['private']);
storeReject(fn()=>genesisE2eeExecute($reader['id'],$bad,$reader['binding']),'E2EE_DIRECTORY_FORBIDDEN');
echo 'PASS e2ee-shared-store '.$checks.' cumulative assertions (actual SQLite legacy jobs/lease/restart/ACL/signed roles/receipts)'.PHP_EOL;
