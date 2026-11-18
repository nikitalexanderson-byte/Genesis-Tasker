<?php
declare(strict_types=1);
require __DIR__.'/e2ee-shared-store.php';

$owner='synthetic-copy-owner';$kit['ownerId']=$owner;$kit['protectedKeys']['ownerId']=$owner;
$outsider='synthetic-copy-source-only';
foreach([$owner,$outsider] as $id)$db->prepare("INSERT INTO users(id,google_sub,email,shared_projects_enabled,created_at,updated_at) VALUES(?,?,?,1,?,?)")
    ->execute([$id,$id,$id.'@example.invalid',$now,$now]);
foreach(['copy-space-a','copy-space-b'] as $id) {
    $db->prepare('INSERT INTO shared_spaces(id,title,created_by,created_at,updated_at) VALUES(?,?,?,?,?)')->execute([$id,'Synthetic space',$owner,$now,$now]);
    $db->prepare("INSERT INTO shared_space_members(space_id,user_id,role,joined_at) VALUES(?,?,'owner',?)")->execute([$id,$owner,$now]);
}
foreach(['copy-source'=>'copy-space-a','copy-target'=>'copy-space-b'] as $id=>$parent) {
    $db->prepare('INSERT INTO shared_projects(id,space_id,title,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?)')->execute([$id,$parent,'Synthetic project',$owner,$now,$now]);
    $db->prepare("INSERT INTO shared_project_members(project_id,user_id,role,joined_at) VALUES(?,?,'owner',?)")->execute([$id,$owner,$now]);
}
$seal=static fn(array $value):string=>genesisSharedContentEncrypt(json_encode($value,JSON_THROW_ON_ERROR));
$db->prepare('INSERT INTO shared_bulk_operations(id,actor_id,request_id,payload_hash,payload,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    ->execute(['copy-bulk',$owner,'copy-request','hash',$seal(['action'=>['kind'=>'move','projectId'=>'copy-target'],'selection'=>['mode'=>'page','items'=>[['id'=>'task','projectId'=>'copy-source','revision'=>1]]]]),$now,$now,$now]);
$db->prepare('INSERT INTO shared_automation_operations VALUES(?,?,?,?,?)')->execute([$owner,'copy-automation','hash',$seal(['projectId'=>'copy-source','title'=>'Private copied rule']),$now]);
$db->prepare('INSERT INTO shared_template_operations VALUES(?,?,?,?,?,?)')->execute([$owner,'copy-template','template.apply','hash',$seal(['projectIds'=>['a'=>'copy-source','b'=>'copy-target'],'notices'=>['private copy']]),$now]);
$db->prepare('INSERT INTO shared_custom_field_receipts VALUES(?,?,?,?,?)')->execute([$owner,'copy-field','copy-space-b','hash',$seal(['field'=>['title'=>'Private copied field']])]);
$db->prepare('INSERT INTO shared_planning_receipts VALUES(?,?,?,?,?,?,?)')->execute([$owner,'copy-planning','copy-target','synthetic','hash',$seal(['estimate'=>42]),$now]);
$db->prepare('INSERT INTO shared_mutation_receipts(user_id,request_id,action,resource_id,response_json,created_at,payload_hash) VALUES(?,?,?,?,?,?,?)')
    ->execute([$owner,'copy-mutation','task.move','historical-task',json_encode(['projectId'=>'copy-target','title'=>'Private copied task']),$now,hash('sha256','synthetic')]);

$scopeId='project:copy-target';
$command=['protocol'=>1,'ownerId'=>$owner,'scopeId'=>$scopeId,'deviceId'=>'device-a','action'=>'bootstrap','expectedRevision'=>0,'checkpointHash'=>'genesis','securityEpoch'=>1,
    'operationId'=>'copy-bootstrap','payload'=>['kind'=>'project','resourceId'=>'copy-target','keyId'=>'copy-root','generation'=>1,'recoveryKit'=>$kit,
    'recoveryCapsule'=>storeCapsule($authority),'deviceKeys'=>$public($device),'deviceCapsule'=>storeCapsule($device)]];
$command['payload']['selfProof']=storeSign(genesisE2eeCommandBytes($command),$device['private']);
genesisE2eeBootstrap($owner,['command'=>$command,'signature'=>storeSign(genesisE2eeCommandBytes($command),$authority['private'])]);
$scope=genesisE2eeScope($owner,$scopeId);
$copies=['shared_bulk_operations'=>['payload_hash','actor_id'],'shared_automation_operations'=>['request_hash','actor_id'],
    'shared_template_operations'=>['request_hash','actor_id'],'shared_custom_field_receipts'=>['payload_hash','actor_id'],
    'shared_planning_receipts'=>['payload_hash','actor_id'],'shared_mutation_receipts'=>['payload_hash','user_id']];
// Every private copy participates in the actual source token, including multi-
// project rows whose first project is in a different space from this scope.
foreach($copies as $table=>[$hashColumn,$actorColumn]) {
    $before=genesisE2eeSourceHash($db,$scope);
    $db->prepare('UPDATE '.$table.' SET '.$hashColumn.'=? WHERE '.$actorColumn.'=?')->execute([hash('sha256','changed-'.$table),$owner]);
    storeCheck(genesisE2eeSourceHash($db,$scope)!==$before);
}
foreach(['shared_bulk_operations','shared_automation_operations','shared_template_operations'] as $table) {
    $predicates=array_filter(genesisE2eeLegacyInventory($db)[$table],static fn(array $p):bool=>$p[0]==='space');
    $where=implode(' OR ',array_map(static fn(array $p):string=>genesisE2eeLegacyResourceMatch($p,'row',"'copy-space-b'"),$predicates));
    storeCheck((int)$db->query('SELECT COUNT(*) FROM '.$table.' row WHERE '.$where)->fetchColumn()===1);
}
$source=genesisE2eeSourceHash($db,$scope);
$lease=genesisE2eeExecute($owner,storeCommand('migration-start',['migrationId'=>'copy-migration','sourceHash'=>$source]),$session);
foreach($copies as $table=>[$hashColumn,$actorColumn]) {
    $q=$db->prepare('SELECT * FROM '.$table.' WHERE '.$actorColumn.'=?');$q->execute([$owner]);$original=$q->fetch();$q->closeCursor();
    storeReject(fn()=>$db->prepare('UPDATE '.$table.' SET '.$hashColumn.'=? WHERE '.$actorColumn.'=?')->execute([hash('sha256','bypass'),$owner]),'E2EE_LEGACY_WRITE_FORBIDDEN');
    storeReject(fn()=>$db->prepare('DELETE FROM '.$table.' WHERE '.$actorColumn.'=?')->execute([$owner]),'E2EE_LEGACY_WRITE_FORBIDDEN');
    $clone=$original;foreach(['id','request_id','operation_id'] as $key)if(isset($clone[$key]))$clone[$key].='-new';
    $sql='INSERT INTO '.$table.'('.implode(',',array_keys($clone)).') VALUES('.implode(',',array_fill(0,count($clone),'?')).')';
    storeReject(fn()=>$db->prepare($sql)->execute(array_values($clone)),'E2EE_LEGACY_WRITE_FORBIDDEN');
    $q=$db->prepare('SELECT * FROM '.$table.' WHERE '.$actorColumn.'=?');$q->execute([$owner]);storeCheck($q->fetch()===$original);$q->closeCursor();
}
// Explicit destination references cannot be hidden by absence of membership.
$payload=$seal(['action'=>['kind'=>'move','projectId'=>'copy-target'],'selection'=>['mode'=>'page','items'=>[['projectId'=>'copy-source']]]]);
storeReject(fn()=>$db->prepare('INSERT INTO shared_bulk_operations(id,actor_id,request_id,payload_hash,payload,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    ->execute(['outsider-bulk',$outsider,'outsider-request','hash',$payload,$now,$now,$now]),'E2EE_LEGACY_WRITE_FORBIDDEN');
storeReject(fn()=>$db->prepare('INSERT INTO shared_template_operations VALUES(?,?,?,?,?,?)')
    ->execute([$outsider,'outsider-template','template.apply','hash',$seal(['projectIds'=>['first'=>'copy-source','second'=>'copy-target']]),$now]),'E2EE_LEGACY_WRITE_FORBIDDEN');

// Lease expiry/cancellation preserve a safe path back to unchanged legacy work.
$db->prepare('UPDATE e2ee_migrations SET lease_until=0 WHERE scope_id=?')->execute([$scopeId]);
$db->prepare('UPDATE shared_bulk_operations SET payload_hash=? WHERE id=?')->execute(['after-expiry','copy-bulk']);
genesisE2eeExecute($owner,storeCommand('migration-cancel',['migrationId'=>'copy-migration','fence'=>1]),$session);
storeCheck(genesisE2eeSourceHash($db,$scope)!==$source);
// A former member's historical shared-view copy still belongs to the explicit
// space after membership disappears; absence of current grants is not no data.
$response=json_encode(['spaceId'=>'copy-space-b','visibility'=>'shared','definition'=>['title'=>'Private historical view']],JSON_THROW_ON_ERROR);
$db->prepare('INSERT INTO shared_mutation_receipts(user_id,request_id,action,resource_id,response_json,created_at,payload_hash) VALUES(?,?,?,?,?,?,?)')
    ->execute([$outsider,'former-view','view.update','historical-view',$response,$now,hash('sha256','view')]);
$scopeId='space:copy-space-b';$command['scopeId']=$scopeId;$command['operationId']='copy-space-bootstrap';
$command['payload']['kind']='space';$command['payload']['resourceId']='copy-space-b';unset($command['payload']['selfProof']);
$command['payload']['selfProof']=storeSign(genesisE2eeCommandBytes($command),$device['private']);
genesisE2eeBootstrap($owner,['command'=>$command,'signature'=>storeSign(genesisE2eeCommandBytes($command),$authority['private'])]);
$scope=genesisE2eeScope($owner,$scopeId);$before=genesisE2eeSourceHash($db,$scope);
$db->prepare("UPDATE shared_mutation_receipts SET payload_hash=? WHERE request_id='former-view'")->execute([hash('sha256','changed view')]);
storeCheck(genesisE2eeSourceHash($db,$scope)!==$before);$source=genesisE2eeSourceHash($db,$scope);
genesisE2eeExecute($owner,storeCommand('migration-start',['migrationId'=>'former-view','sourceHash'=>$source]),$session);
storeReject(fn()=>$db->prepare("UPDATE shared_mutation_receipts SET response_json='{}' WHERE request_id='former-view'")->execute(),'E2EE_LEGACY_WRITE_FORBIDDEN');
storeReject(fn()=>$db->prepare("DELETE FROM shared_mutation_receipts WHERE request_id='former-view'")->execute(),'E2EE_LEGACY_WRITE_FORBIDDEN');
storeReject(fn()=>$db->prepare('INSERT INTO shared_mutation_receipts(user_id,request_id,action,resource_id,response_json,created_at,payload_hash) VALUES(?,?,?,?,?,?,?)')
    ->execute([$outsider,'former-view-new','view.update','historical-view',$response,$now,hash('sha256','view')]),'E2EE_LEGACY_WRITE_FORBIDDEN');
genesisE2eeExecute($owner,storeCommand('migration-cancel',['migrationId'=>'former-view','fence'=>1]),$session);
echo 'PASS e2ee-private-copies '.$checks.' cumulative assertions; all6 copy families, cross-space references, source revisions, INSERT/UPDATE/DELETE fences, preserved bytes and expiry verified.'.PHP_EOL;
