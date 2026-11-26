<?php

declare(strict_types=1);
require_once __DIR__.'/shared-projects.php';
require_once __DIR__.'/shared-ui.php';

/** These responses are explicit recipient routing consent. They confer no
 * membership, directory authority, capsule, billing entitlement or content key. */
function genesisE2eeInvitationRecipientScope(string $actor,array $scope):void
{
    if($scope['kind']!=='personal'||$scope['owner_id']!==$actor||$scope['resource_id']!==$actor||$scope['state']!=='active')throw new GenesisResourceLimitException(403,'E2EE_OWNER_REQUIRED');
    genesisSharedRequireEligible($actor);
}
function genesisE2eeInvitationForRecipient(PDO $db,string $actor,string $id):array
{
    genesisE2eeIdentifier($id);$user=genesisFindUser($actor);if(!$user)throw new GenesisResourceLimitException(401,'AUTH_REQUIRED');
    $space=genesisE2eeRow($db,'SELECT i.*,i.space_id AS target_space_id FROM shared_space_invitations i WHERE i.id=?',[$id]);
    $project=genesisE2eeRow($db,'SELECT i.*,p.space_id AS target_space_id,p.archived_at AS project_archived_at FROM shared_invitations i JOIN shared_projects p ON p.id=i.project_id WHERE i.id=?',[$id]);
    if((bool)$space===(bool)$project)throw new GenesisResourceLimitException(404,'INVITATION_UNAVAILABLE');$row=$space?:$project;
    if(!hash_equals(mb_strtolower($row['email']),mb_strtolower($user['email']))&&!genesisE2eeRow($db,'SELECT 1 FROM e2ee_invitation_responses WHERE invitation_id=? AND user_id=?',[$id,$actor]))throw new GenesisResourceLimitException(404,'INVITATION_UNAVAILABLE');
    $kind=$space?'space':'project';$resource=$space?$row['space_id']:$row['project_id'];$target=genesisE2eeRow($db,'SELECT * FROM e2ee_scopes WHERE kind=? AND resource_id=?',[$kind,$resource]);
    if(!$target||$target['state']!=='active')throw new DomainException('E2EE_SHARED_TRANSITION_REQUIRED');
    return['row'=>$row,'scope'=>$target,'table'=>$space?'shared_space_invitations':'shared_invitations','kind'=>$kind,'resourceId'=>$resource];
}
function genesisE2eeInvitationResponseValue(PDO $db,string $actor,string $id):array
{
    $found=genesisE2eeInvitationForRecipient($db,$actor,$id);$row=$found['row'];$response=genesisE2eeRow($db,'SELECT * FROM e2ee_invitation_responses WHERE invitation_id=? AND user_id=?',[$id,$actor]);
    if($response&&$response['scope_id']!==$found['scope']['scope_id'])throw new DomainException('E2EE_SCOPE_BINDING_MISMATCH');
    $state=$response['state']??'unanswered';if(!in_array($state,['admitted','declined'],true)&&($row['revoked_at']!==null||$row['consumed_at']!==null||$row['expires_at']<=genesisNow()||$found['kind']==='project'&&$row['project_archived_at']!==null))$state=$row['expires_at']<=genesisNow()?'expired':'unavailable';
    return['id'=>$id,'scopeId'=>$found['scope']['scope_id'],'kind'=>$found['kind'],'resourceId'=>$found['resourceId'],'spaceId'=>$row['target_space_id'],'state'=>$state,'acceptedAt'=>$response['accepted_at']??null,'deviceApprovalRequired'=>true];
}
function genesisE2eeInvitationRespond(PDO $db,string $actor,array $scope,array $command):array
{
    if(!$db->inTransaction())throw new LogicException('E2EE_TRANSACTION_CONTEXT_INVALID');genesisE2eeInvitationRecipientScope($actor,$scope);$p=genesisE2eeExactFields($command['payload'],['intentId','id','accept']);$intent=genesisE2eeIdentifier($p['intentId']);$id=genesisE2eeIdentifier($p['id']);if(!is_bool($p['accept']))throw new InvalidArgumentException('E2EE_INVITATION_RESPONSE_INVALID');
    $hash=rtrim(strtr(base64_encode(hash('sha256',genesisE2eeCanonical($p),true)),'+/','-_'),'=');$old=genesisE2eeRow($db,"SELECT payload_hash,result_json FROM e2ee_service_intents WHERE scope_id=? AND actor_id=? AND action='shared-invitation-respond' AND intent_id=?",[$scope['scope_id'],$actor,$intent]);if($old){if(!hash_equals($old['payload_hash'],$hash))throw new DomainException('E2EE_IDEMPOTENCY_CONFLICT');return json_decode($old['result_json'],true,512,JSON_THROW_ON_ERROR);}
    $found=genesisE2eeInvitationForRecipient($db,$actor,$id);$row=$found['row'];$response=genesisE2eeRow($db,'SELECT * FROM e2ee_invitation_responses WHERE invitation_id=?',[$id]);
    if($response&&($response['user_id']!==$actor||$response['scope_id']!==$found['scope']['scope_id']))throw new DomainException('E2EE_SCOPE_BINDING_MISMATCH');
    if(($response['state']??null)==='admitted'||$row['consumed_at']!==null)throw new DomainException('E2EE_MEMBERSHIP_ROTATION_REQUIRED');
    if($row['revoked_at']!==null||$row['expires_at']<=genesisNow()||$found['kind']==='project'&&$row['project_archived_at']!==null)throw new GenesisResourceLimitException(409,'INVITATION_UNAVAILABLE');
    // Verify the inviter's current ordinary grant before recording acceptance.
    if($p['accept']){
        if($found['kind']==='project')genesisSharedRequireInvitationGrant($row['created_by'],$row['project_id'],$row['role']);
        else{$inviter=genesisSharedSpaceAccess($row['space_id'],$row['created_by']);$role=$row['assigned_role']?:$row['role'];$own=genesisSharedPermissions($inviter['member_role'],$inviter['permissions_json'],(int)$inviter['can_organize_tasks']===1);$granted=genesisSharedPermissions($role,$row['permissions_json']);
            if(!$own['inviteMembers']||$role==='admin'&&$inviter['member_role']!=='owner'||array_filter($granted,static fn($value,$key)=>$value&&!$own[$key],ARRAY_FILTER_USE_BOTH))throw new GenesisResourceLimitException(409,'INVITATION_UNAVAILABLE');}
    }
    $now=genesisNow();$state=$p['accept']?'pending':'declined';$accepted=$response['accepted_at']??$now;
    $db->prepare('INSERT INTO e2ee_invitation_responses(invitation_id,scope_id,user_id,state,accepted_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(invitation_id) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at')->execute([$id,$found['scope']['scope_id'],$actor,$state,$accepted,$now]);
    if(!$p['accept'])$db->prepare('UPDATE '.$found['table'].' SET revoked_at=COALESCE(revoked_at,?) WHERE id=?')->execute([$now,$id]);
    $value=genesisE2eeInvitationResponseValue($db,$actor,$id);$result=['intentId'=>$intent,'response'=>$value,'pendingApproval'=>$p['accept']];$db->prepare('INSERT INTO e2ee_service_intents VALUES(?,?,?,?,?,?)')->execute([$scope['scope_id'],$actor,'shared-invitation-respond',$intent,$hash,genesisE2eeJson($result)]);return$result;
}
function genesisE2eeInvitationResponseRead(PDO $db,string $actor,array $scope,array $payload):array
{
    genesisE2eeInvitationRecipientScope($actor,$scope);genesisE2eeExactFields($payload,['id']);return['response'=>genesisE2eeInvitationResponseValue($db,$actor,genesisE2eeIdentifier($payload['id'])),'checkpointHash'=>$scope['checkpoint_hash'],'directoryRevision'=>(int)$scope['directory_revision']];
}

/** Bounded recipient listing. Protected titles are never projected from legacy
 * rows; paging retains every invitation without a large unbounded response. */
function genesisE2eeInvitationPage(PDO $db,string $actor,array $scope,array $payload,string $deviceId):array
{
    genesisE2eeInvitationRecipientScope($actor,$scope);genesisE2eeIdentifier($deviceId);genesisE2eeExactFields($payload,['after','limit']);$after=$payload['after'];if($after!=='')genesisE2eeIdentifier($after);$limit=genesisE2eeInteger($payload['limit'],1);if($limit>50)throw new InvalidArgumentException('E2EE_INVALID_LIMIT');$user=genesisFindUser($actor);$all=[];
    foreach(['space','project'] as $kind){
        $space=$kind==='space';$table=$space?'shared_space_invitations':'shared_invitations';
        $join=$space?'JOIN shared_spaces s ON s.id=i.space_id':'JOIN shared_projects p ON p.id=i.project_id JOIN shared_spaces s ON s.id=p.space_id';$resource=$space?'i.space_id':'i.project_id';
        $member=$space?'EXISTS(SELECT 1 FROM shared_space_members m WHERE m.space_id=i.space_id AND m.user_id=:actor)':'EXISTS(SELECT 1 FROM shared_project_members m WHERE m.project_id=i.project_id AND m.user_id=:actor)';
        $pendingDevice="r.state='admitted' AND i.consumed_at IS NOT NULL AND ".$member.' AND NOT EXISTS(SELECT 1 FROM e2ee_devices d WHERE d.scope_id=es.scope_id AND d.user_id=:actor AND d.device_id=:device AND d.revoked=0)';
        $query=$db->prepare("SELECT i.id,i.role,i.created_by,i.expires_at,s.title AS space_title,".($space?"''":"p.title")." AS project_title,es.scope_id,ss.scope_id AS space_scope_id,".($space?'i.assigned_role':"''")." AS assigned_role,r.state AS response_state,COALESCE(NULLIF(u.display_name,''),'GENESIS') AS inviter_name FROM ".$table." i ".$join." LEFT JOIN e2ee_scopes es ON es.kind=:kind AND es.resource_id=".$resource." LEFT JOIN e2ee_scopes ss ON ss.kind='space' AND ss.resource_id=s.id LEFT JOIN users u ON u.id=i.created_by LEFT JOIN e2ee_invitation_responses r ON r.invitation_id=i.id AND r.user_id=:actor WHERE (i.email=:email COLLATE NOCASE OR r.user_id=:actor) AND i.id>:after AND ((i.consumed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>:now) OR (".$pendingDevice.")) ".($space?'':'AND p.archived_at IS NULL ').'ORDER BY i.id LIMIT :maximum');
        foreach(['kind'=>$kind,'actor'=>$actor,'device'=>$deviceId,'email'=>$user['email'],'after'=>$after,'now'=>genesisNow()]as $name=>$value)$query->bindValue(':'.$name,$value);$query->bindValue(':maximum',$limit+1,PDO::PARAM_INT);$query->execute();
        try{while($row=$query->fetch())$all[]=['id'=>$row['id'],'role'=>$row['assigned_role']?:$row['role'],'expiresAt'=>$row['expires_at'],'scope'=>$kind,'spaceTitle'=>$row['space_scope_id']===null?$row['space_title']:'GENESIS','projectTitle'=>$row['scope_id']===null?$row['project_title']:'','inviterName'=>$row['inviter_name'],'encrypted'=>$row['scope_id']!==null,'pendingApproval'=>$row['response_state']==='pending','admitted'=>$row['response_state']==='admitted','deviceApprovalRequired'=>$row['scope_id']!==null];}finally{$query->closeCursor();}
    }
    usort($all,static fn($a,$b)=>strcmp($a['id'],$b['id']));$seen=[];foreach($all as $item){if(isset($seen[$item['id']]))throw new DomainException('E2EE_INVITATION_RESPONSE_INVALID');$seen[$item['id']]=true;}$more=count($all)>$limit;$items=array_slice($all,0,$limit);
    return['invitations'=>$items,'nextAfter'=>$more?$items[count($items)-1]['id']:null,'checkpointHash'=>$scope['checkpoint_hash'],'directoryRevision'=>(int)$scope['directory_revision']];
}
function genesisE2eeInvitationPendingPage(PDO $db,string $actor,array $scope,array $payload):array
{
    if(!in_array($scope['kind'],['space','project'],true)||$scope['owner_id']!==$actor||$scope['state']!=='active')throw new GenesisResourceLimitException(403,'E2EE_OWNER_REQUIRED');genesisE2eeExactFields($payload,['after','limit']);$after=$payload['after'];if($after!=='')genesisE2eeIdentifier($after);$limit=genesisE2eeInteger($payload['limit'],1);if($limit>50)throw new InvalidArgumentException('E2EE_INVALID_LIMIT');
    $space=$scope['kind']==='space';$table=$space?'shared_space_invitations':'shared_invitations';$column=$space?'space_id':'project_id';$query=$db->prepare("SELECT i.*,r.user_id,r.accepted_at FROM e2ee_invitation_responses r JOIN ".$table." i ON i.id=r.invitation_id WHERE r.scope_id=? AND r.state='pending' AND i.".$column."=? AND i.id>? AND i.consumed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>? ORDER BY i.id LIMIT ?");
    $query->bindValue(1,$scope['scope_id']);$query->bindValue(2,$scope['resource_id']);$query->bindValue(3,$after);$query->bindValue(4,genesisNow());$query->bindValue(5,$limit+1,PDO::PARAM_INT);$query->execute();$rows=[];try{while($row=$query->fetch()){$found=genesisE2eeInvitationForRecipient($db,$row['user_id'],$row['id']);$rows[]=genesisE2eeInvitationAdmissionValue($db,$found,$row['id'],['user_id'=>$row['user_id'],'accepted_at'=>$row['accepted_at']]);}}finally{$query->closeCursor();}
    $more=count($rows)>$limit;$items=array_slice($rows,0,$limit);return['responses'=>$items,'nextAfter'=>$more?$items[count($items)-1]['id']:null,'checkpointHash'=>$scope['checkpoint_hash'],'directoryRevision'=>(int)$scope['directory_revision']];
}

/** Admission is an explicit owner-reviewed membership operation, never a
 * recipient routing boolean. The full atomic planner/owner rotations remain
 * mandatory; this helper only binds the exact outstanding consent/routing. */
function genesisE2eeInvitationAdmissionValue(PDO $db,array $found,string $id,array $response):array
{
    $row=$found['row'];$space=$found['kind']==='space';
    return ['kind'=>'invitation-admit','spaceId'=>$row['target_space_id'],'resourceId'=>$found['resourceId'],'invitationId'=>$id,'invitationKind'=>$found['kind'],'userId'=>$response['user_id'],
        'role'=>$space?($row['assigned_role']?:$row['role']):$row['role'],'permissions'=>!$space||$row['permissions_json']===null?null:json_decode($row['permissions_json'],true,16,JSON_THROW_ON_ERROR),'createdBy'=>$row['created_by'],'acceptedAt'=>$response['accepted_at']];
}
function genesisE2eeInvitationAdmission(PDO $db,string $actor,array $operation):array
{
    if(!$db->inTransaction())throw new LogicException('E2EE_TRANSACTION_CONTEXT_INVALID');
    $id=$operation['invitationId'];$found=genesisE2eeInvitationForRecipient($db,$operation['userId'],$id);$scope=$found['scope'];$row=$found['row'];
    if($scope['owner_id']!==$actor||genesisSharedSpaceAccess($row['target_space_id'],$actor)['member_role']!=='owner')throw new GenesisResourceLimitException(403,'E2EE_OWNER_REQUIRED');
    genesisSharedRequireEligible($operation['userId']);$response=genesisE2eeRow($db,"SELECT * FROM e2ee_invitation_responses WHERE invitation_id=? AND state='pending'",[$id]);
    if(!$response||$response['user_id']!==$operation['userId']||$response['scope_id']!==$scope['scope_id']||$row['consumed_at']!==null||$row['revoked_at']!==null||$row['expires_at']<=genesisNow()||$found['kind']==='project'&&$row['project_archived_at']!==null)throw new DomainException('E2EE_MEMBERSHIP_STALE');
    if(!hash_equals(genesisE2eeCanonical(genesisE2eeInvitationAdmissionValue($db,$found,$id,$response)),genesisE2eeCanonical($operation)))throw new DomainException('E2EE_MEMBERSHIP_STALE');
    // Re-evaluate the inviter at final preflight, not only when consent arrived.
    if($found['kind']==='project')genesisSharedRequireInvitationGrant($row['created_by'],$row['project_id'],$row['role']);
    else{$inviter=genesisSharedSpaceAccess($row['space_id'],$row['created_by']);$role=$row['assigned_role']?:$row['role'];$own=genesisSharedPermissions($inviter['member_role'],$inviter['permissions_json'],(int)$inviter['can_organize_tasks']===1);$granted=genesisSharedPermissions($role,$row['permissions_json']);
        if(!$own['inviteMembers']||$role==='admin'&&$inviter['member_role']!=='owner'||array_filter($granted,static fn($value,$key)=>$value&&!$own[$key],ARRAY_FILTER_USE_BOTH))throw new DomainException('E2EE_MEMBERSHIP_STALE');}
    return $found;
}
function genesisE2eeInvitationAdmissionCommit(PDO $db,array $operation):void
{
    if(!$db->inTransaction())throw new LogicException('E2EE_TRANSACTION_CONTEXT_INVALID');$id=$operation['invitationId'];$now=genesisNow();$table=$operation['invitationKind']==='space'?'shared_space_invitations':'shared_invitations';
    $consume=$db->prepare('UPDATE '.$table.' SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>?');$consume->execute([$now,$id,$now]);if($consume->rowCount()!==1)throw new DomainException('E2EE_MEMBERSHIP_STALE');
    $change=$db->prepare("UPDATE e2ee_invitation_responses SET state='admitted',updated_at=? WHERE invitation_id=? AND user_id=? AND state='pending' AND accepted_at=?");$change->execute([$now,$id,$operation['userId'],$operation['acceptedAt']]);if($change->rowCount()!==1)throw new DomainException('E2EE_MEMBERSHIP_STALE');
    $db->prepare('UPDATE users SET shared_projects_enabled=1,updated_at=? WHERE id=?')->execute([$now,$operation['userId']]);
}
