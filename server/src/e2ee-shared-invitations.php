<?php

declare(strict_types=1);

/** Issuing/revoking an invitation changes routing metadata only. It never
 * changes membership, approves a device, wraps a root or grants content access.
 * The later membership/device approval still requires its signed full plan. */
function genesisE2eeSharedInvitationsService(PDO $db,string $actor,array $scope,array $command):array
{
    if(!$db->inTransaction())throw new LogicException('E2EE_TRANSACTION_CONTEXT_INVALID');
    if($scope['kind']!=='space'||$scope['owner_id']!==$actor||$scope['state']!=='active')throw new GenesisResourceLimitException(403,'E2EE_OWNER_REQUIRED');
    $action=$command['action'];$payload=genesisE2eeExactFields($command['payload'],$action==='shared-invitations-issue'?['intentId','invitations']:['intentId','id']);
    $intent=genesisE2eeIdentifier($payload['intentId']);$hash=rtrim(strtr(base64_encode(hash('sha256',genesisE2eeCanonical($payload),true)),'+/','-_'),'=');
    $previous=genesisE2eeRow($db,'SELECT payload_hash,result_json FROM e2ee_service_intents WHERE scope_id=? AND actor_id=? AND action=? AND intent_id=?',[$scope['scope_id'],$actor,$action,$intent]);
    if($previous){if(!hash_equals($previous['payload_hash'],$hash))throw new DomainException('E2EE_IDEMPOTENCY_CONFLICT');return json_decode($previous['result_json'],true,512,JSON_THROW_ON_ERROR);}
    require_once __DIR__.'/shared-projects.php';require_once __DIR__.'/shared-ui.php';
    if($action==='shared-invitations-issue'){
        $invitations=$payload['invitations'];if(!is_array($invitations)||!array_is_list($invitations)||count($invitations)<1||count($invitations)>20)throw new InvalidArgumentException('INVALID_SPACE_INVITATIONS');
        $ids=[];$emails=[];
        foreach($invitations as $invite){genesisE2eeExactFields($invite,['id','email','role','permissions']);$id=genesisE2eeIdentifier($invite['id']);
            if(!preg_match('/\A[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\z/D',$id)||isset($ids[$id])||!is_string($invite['email']))throw new InvalidArgumentException('INVALID_SPACE_INVITATIONS');
            $email=mb_strtolower(trim($invite['email']));if(isset($emails[$email]))throw new InvalidArgumentException('DUPLICATE_SPACE_INVITATION');$ids[$id]=true;$emails[$email]=true;
            if(genesisE2eeRow($db,'SELECT 1 FROM shared_space_invitations WHERE id=?',[$id]))throw new DomainException('E2EE_IDEMPOTENCY_CONFLICT');
            genesisE2eeExactFields($invite['permissions'],['createProjects','editTasks','organizeTasks','comment','manageProjects','inviteMembers']);foreach($invite['permissions'] as $allowed)if(!is_bool($allowed))throw new InvalidArgumentException('INVALID_PERMISSIONS');
        }
        $result=['intentId'=>$intent,'invitations'=>[],'deviceApprovalRequired'=>true];
        foreach($invitations as $invite){$issued=genesisSharedSpaceInvite($actor,$scope['resource_id'],['email'=>$invite['email'],'role'=>$invite['role'],'permissions'=>$invite['permissions']],$invite['id']);
            $result['invitations'][]=['id'=>$issued['id'],'expiresAt'=>$issued['expiresAt']];}
    }else{
        $id=genesisE2eeIdentifier($payload['id']);$row=genesisE2eeRow($db,'SELECT * FROM shared_space_invitations WHERE id=? AND space_id=?',[$id,$scope['resource_id']]);
        if(!$row)throw new GenesisResourceLimitException(404,'INVITATION_UNAVAILABLE');
        if($row['consumed_at']!==null)throw new DomainException('E2EE_MEMBERSHIP_ROTATION_REQUIRED');
        $db->prepare('UPDATE shared_space_invitations SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND space_id=?')->execute([genesisNow(),$id,$scope['resource_id']]);
        $result=['intentId'=>$intent,'id'=>$id,'revoked'=>true];
    }
    $db->prepare('INSERT INTO e2ee_service_intents VALUES(?,?,?,?,?,?)')->execute([$scope['scope_id'],$actor,$action,$intent,$hash,genesisE2eeJson($result)]);return$result;
}

function genesisE2eeSharedInvitationsRead(PDO $db,string $actor,array $scope,array $payload):array
{
    genesisE2eeExactFields($payload,['ids']);if($scope['kind']!=='space'||$scope['owner_id']!==$actor||$scope['state']!=='active')throw new GenesisResourceLimitException(403,'E2EE_OWNER_REQUIRED');
    $ids=$payload['ids'];if(!is_array($ids)||!array_is_list($ids)||count($ids)>20||count(array_unique($ids,SORT_REGULAR))!==count($ids))throw new InvalidArgumentException('INVALID_SPACE_INVITATIONS');
    $rows=[];foreach($ids as $id){genesisE2eeIdentifier($id);$row=genesisE2eeRow($db,'SELECT * FROM shared_space_invitations WHERE id=? AND space_id=?',[$id,$scope['resource_id']]);
        if(!$row)throw new GenesisResourceLimitException(404,'INVITATION_UNAVAILABLE');
        $rows[]=['id'=>$id,'email'=>$row['email'],'role'=>$row['assigned_role']?:$row['role'],'permissions'=>$row['permissions_json']===null?null:json_decode($row['permissions_json'],true,16,JSON_THROW_ON_ERROR),
            'createdBy'=>$row['created_by'],'state'=>$row['revoked_at']!==null?'revoked':($row['consumed_at']!==null?'consumed':($row['expires_at']<=genesisNow()?'expired':'pending'))];
    }
    return['invitations'=>$rows,'checkpointHash'=>$scope['checkpoint_hash'],'directoryRevision'=>(int)$scope['directory_revision']];
}
