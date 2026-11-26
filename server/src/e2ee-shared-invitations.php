<?php

declare(strict_types=1);

/** Routing metadata only: none of these operations installs membership, approves
 * a device or sends a root. Only independently approved enrollment grants keys. */
function genesisE2eeSharedInvitationAccess(string $actor,array $scope):array
{
    require_once __DIR__.'/shared-projects.php';require_once __DIR__.'/shared-ui.php';
    if(!in_array($scope['kind'],['space','project'],true)||$scope['state']!=='active')throw new GenesisResourceLimitException(403,'E2EE_NOT_ACTIVE');
    genesisSharedRequireEnabled($actor);
    if($scope['kind']==='project'){genesisSharedProjectAccess($scope['resource_id'],$actor,'invite');return['shared_invitations','project_id'];}
    $space=genesisSharedSpaceAccess($scope['resource_id'],$actor);if(!genesisSharedSpacePermission($space,'inviteMembers'))throw new GenesisResourceLimitException(403,'SHARED_SPACE_FORBIDDEN');return['shared_space_invitations','space_id'];
}
function genesisE2eeSharedInvitationsService(PDO $db,string $actor,array $scope,array $command):array
{
    if(!$db->inTransaction())throw new LogicException('E2EE_TRANSACTION_CONTEXT_INVALID');
    [$table,$column]=genesisE2eeSharedInvitationAccess($actor,$scope);$space=$scope['kind']==='space';
    $action=$command['action'];$payload=genesisE2eeExactFields($command['payload'],$action==='shared-invitations-issue'?['intentId','invitations']:['intentId','id']);
    $intent=genesisE2eeIdentifier($payload['intentId']);$hash=rtrim(strtr(base64_encode(hash('sha256',genesisE2eeCanonical($payload),true)),'+/','-_'),'=');
    $previous=genesisE2eeRow($db,'SELECT payload_hash,result_json FROM e2ee_service_intents WHERE scope_id=? AND actor_id=? AND action=? AND intent_id=?',[$scope['scope_id'],$actor,$action,$intent]);
    if($previous){if(!hash_equals($previous['payload_hash'],$hash))throw new DomainException('E2EE_IDEMPOTENCY_CONFLICT');return json_decode($previous['result_json'],true,512,JSON_THROW_ON_ERROR);}
    if($action==='shared-invitations-issue'){
        $invitations=$payload['invitations'];if(!is_array($invitations)||!array_is_list($invitations)||count($invitations)<1||count($invitations)>20)throw new InvalidArgumentException('INVALID_SPACE_INVITATIONS');$ids=[];$emails=[];
        foreach($invitations as $invite){genesisE2eeExactFields($invite,['id','email','role',...($space?['permissions']:[])]);$id=genesisE2eeIdentifier($invite['id']);
            if(!preg_match('/\A[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\z/D',$id)||isset($ids[$id])||!is_string($invite['email'])||strlen($invite['email'])>320)throw new InvalidArgumentException('INVALID_SPACE_INVITATIONS');
            $email=mb_strtolower(trim($invite['email']));if(isset($emails[$email]))throw new InvalidArgumentException('DUPLICATE_SPACE_INVITATION');$ids[$id]=true;$emails[$email]=true;
            if(genesisE2eeRow($db,'SELECT 1 FROM shared_space_invitations WHERE id=?',[$id])||genesisE2eeRow($db,'SELECT 1 FROM shared_invitations WHERE id=?',[$id]))throw new DomainException('E2EE_IDEMPOTENCY_CONFLICT');
            if($space&&$invite['permissions']!==null){genesisE2eeExactFields($invite['permissions'],['createProjects','editTasks','organizeTasks','comment','manageProjects','inviteMembers']);foreach($invite['permissions'] as $allowed)if(!is_bool($allowed))throw new InvalidArgumentException('INVALID_PERMISSIONS');}
        }
        $result=['intentId'=>$intent,'invitations'=>[],'deviceApprovalRequired'=>true];
        foreach($invitations as $invite){$issued=$space?genesisSharedSpaceInvite($actor,$scope['resource_id'],['email'=>$invite['email'],'role'=>$invite['role'],'permissions'=>$invite['permissions']],$invite['id']):genesisSharedInvite($actor,$scope['resource_id'],['email'=>$invite['email'],'role'=>$invite['role']],$invite['id']);
            $result['invitations'][]=['id'=>$issued['id'],'expiresAt'=>$issued['expiresAt']];}
    }elseif($action==='shared-invitation-revoke'){
        $id=genesisE2eeIdentifier($payload['id']);$row=genesisE2eeRow($db,'SELECT * FROM '.$table.' WHERE id=? AND '.$column.'=?',[$id,$scope['resource_id']]);if(!$row)throw new GenesisResourceLimitException(404,'INVITATION_UNAVAILABLE');
        if($row['consumed_at']!==null)throw new DomainException('E2EE_MEMBERSHIP_ROTATION_REQUIRED');$db->prepare('UPDATE '.$table.' SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND '.$column.'=?')->execute([genesisNow(),$id,$scope['resource_id']]);$result=['intentId'=>$intent,'id'=>$id,'revoked'=>true];
    }else throw new InvalidArgumentException('E2EE_UNKNOWN_ACTION');
    $db->prepare('INSERT INTO e2ee_service_intents VALUES(?,?,?,?,?,?)')->execute([$scope['scope_id'],$actor,$action,$intent,$hash,genesisE2eeJson($result)]);return$result;
}
function genesisE2eeSharedInvitationsRead(PDO $db,string $actor,array $scope,array $payload):array
{
    genesisE2eeExactFields($payload,['ids']);[$table,$column]=genesisE2eeSharedInvitationAccess($actor,$scope);$space=$scope['kind']==='space';
    $ids=$payload['ids'];if(!is_array($ids)||!array_is_list($ids)||count($ids)>20||count(array_unique($ids,SORT_REGULAR))!==count($ids))throw new InvalidArgumentException('INVALID_SPACE_INVITATIONS');
    $rows=[];foreach($ids as $id){genesisE2eeIdentifier($id);$row=genesisE2eeRow($db,'SELECT * FROM '.$table.' WHERE id=? AND '.$column.'=?',[$id,$scope['resource_id']]);if(!$row)throw new GenesisResourceLimitException(404,'INVITATION_UNAVAILABLE');
        $rows[]=['id'=>$id,'email'=>$row['email'],'role'=>$space?($row['assigned_role']?:$row['role']):$row['role'],'permissions'=>!$space||$row['permissions_json']===null?null:json_decode($row['permissions_json'],true,16,JSON_THROW_ON_ERROR),
            'createdBy'=>$row['created_by'],'state'=>$row['revoked_at']!==null?'revoked':($row['consumed_at']!==null?'consumed':($row['expires_at']<=genesisNow()?'expired':'pending'))];
    }return['invitations'=>$rows,'checkpointHash'=>$scope['checkpoint_hash'],'directoryRevision'=>(int)$scope['directory_revision']];
}
