<?php
declare(strict_types=1);

/** Private resource preparation contains only public crypto/technical IDs.
 * User titles, descriptions, covers and invitation content stay in the client's
 * protected intent until normal private repository operations can accept them.
 * This does not activate a scope or bypass migration/recovery/recipient review. */
function genesisE2eePrivateResourceRequest(PDO $db,string $actor,array $scope,array $command,mixed $source): array
{
    if(!$db->inTransaction())throw new LogicException('E2EE_TRANSACTION_CONTEXT_INVALID');
    if($scope['kind']!=='personal'||$scope['owner_id']!==$actor||$scope['resource_id']!==$actor||$scope['state']!=='active')
        throw new GenesisResourceLimitException(403,'E2EE_OWNER_REQUIRED');
    if(!is_array($source))throw new InvalidArgumentException('E2EE_RESOURCE_TOPOLOGY_REQUIRED');
    $payload=genesisE2eeExactFields($source,array_key_exists('topology',$source)?['intentId','bootstrap','topology']:['intentId','bootstrap']);$intent=genesisE2eeIdentifier($payload['intentId']);
    $packet=genesisE2eeExactFields($payload['bootstrap'],['command','signature']);$bootstrap=genesisE2eeCommand($packet['command']);
    $fields=genesisE2eeExactFields($bootstrap['payload'],['kind','resourceId','keyId','generation','recoveryKit','recoveryCapsule','deviceKeys','deviceCapsule','selfProof']);
    if(!in_array($fields['kind'],['space','project'],true)||($fields['kind']==='project')!==array_key_exists('topology',$payload))
        throw new InvalidArgumentException('E2EE_RESOURCE_TOPOLOGY_REQUIRED');
    if($fields['kind']==='project'){require_once __DIR__.'/e2ee-project-create.php';genesisE2eePrivateProjectTopologyShape($payload['topology'],$actor);}
    $resource=genesisE2eeIdentifier($fields['resourceId']);
    if(!preg_match('/\A[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\z/D',$resource)
        ||$bootstrap['action']!=='bootstrap'||$bootstrap['ownerId']!==$actor||$bootstrap['deviceId']!==$command['deviceId']
        ||$bootstrap['expectedRevision']!==0||$bootstrap['checkpointHash']!=='genesis'||$bootstrap['securityEpoch']!==1||$fields['generation']!==1)
        throw new DomainException('E2EE_SCOPE_BINDING_MISMATCH');
    $kit=genesisE2eeRecoveryKit($fields['recoveryKit'],$actor);$keys=genesisE2eePublicKeys($fields['deviceKeys']);
    $device=genesisE2eeRow($db,'SELECT * FROM e2ee_devices WHERE scope_id=? AND device_id=?',[$scope['scope_id'],$command['deviceId']]);
    if(!$device||$device['revoked']||$device['user_id']!==$actor||$device['role']!=='owner'
        ||$device['signing_key']!==$keys['signingKey']||$device['receiving_key']!==$keys['receivingKey']
        ||$kit['authority']['signingKey']!==$scope['recovery_signing_key']||$kit['authority']['receivingKey']!==$scope['recovery_receiving_key'])
        throw new DomainException('E2EE_AUTHORITY_CHANGED');
    genesisE2eeVerifyCommand($packet,$scope['recovery_signing_key']);
    $semanticHash=rtrim(strtr(base64_encode(hash('sha256',genesisE2eeCanonical($payload),true)),'+/','-_'),'=');
    return compact('payload','intent','packet','bootstrap','fields','resource','semanticHash');
}
function genesisE2eePreparePrivateResource(PDO $db,string $actor,array $scope,array $command): array
{
    $request=genesisE2eePrivateResourceRequest($db,$actor,$scope,$command,$command['payload']);
    ['payload'=>$payload,'intent'=>$intent,'packet'=>$packet,'bootstrap'=>$bootstrap,'fields'=>$fields,'resource'=>$resource,'semanticHash'=>$semanticHash]=$request;
    $previous=genesisE2eeRow($db,'SELECT payload_hash,result_json FROM e2ee_service_intents WHERE scope_id=? AND actor_id=? AND action=? AND intent_id=?',
        [$scope['scope_id'],$actor,'resource-create-prepare',$intent]);
    if($previous){
        if(!hash_equals($previous['payload_hash'],$semanticHash))throw new DomainException('E2EE_IDEMPOTENCY_CONFLICT');
        return json_decode($previous['result_json'],true,512,JSON_THROW_ON_ERROR);
    }
    if(genesisE2eeRow($db,'SELECT 1 FROM shared_spaces WHERE id=?',[$resource])
        ||genesisE2eeRow($db,'SELECT 1 FROM shared_projects WHERE id=?',[$resource])
        ||genesisE2eeRow($db,'SELECT 1 FROM e2ee_scopes WHERE scope_id=? OR resource_id=?',[$bootstrap['scopeId'],$resource]))
        throw new DomainException('E2EE_SCOPE_ALREADY_INITIALIZED');
    require_once __DIR__.'/shared-projects.php';
    if($fields['kind']==='project'){
        require_once __DIR__.'/e2ee-project-create.php';
        $factory=GenesisE2eeProjectCreation::verify($db,$actor,$resource,$payload['topology']);$topology=$factory->topology;
        $created=genesisSharedCreateProject($actor,$topology['spaceId'],['title'=>'[encrypted:'.$resource.']','description'=>'','tags'=>[],'labelIds'=>[],
            'parentId'=>$topology['parentId'],'categoryId'=>$topology['categoryId'],'boardStatusId'=>$topology['boardStatusId'],'kind'=>$topology['kind'],'layout'=>$topology['layout']],$factory);
        $receipt=genesisE2eeBootstrap($actor,$packet);
        if($receipt['state']!=='preparing'||$receipt['directoryRevision']!==1||$receipt['checkpointHash']!==genesisE2eeCommandHash($bootstrap))
            throw new DomainException('E2EE_SCOPE_SETUP_UNVERIFIED');
        $q=$db->prepare('SELECT id,is_done AS isDone,is_chaos AS isChaos,position FROM shared_project_statuses WHERE project_id=? ORDER BY position,id');$q->execute([$resource]);
        try{$statuses=array_map(static fn(array $row):array=>['id'=>$row['id'],'isDone'=>(int)$row['isDone'],'isChaos'=>(int)$row['isChaos']],$q->fetchAll());}finally{$q->closeCursor();}
        $result=['intentId'=>$intent,'kind'=>'project','resourceId'=>$resource,'scopeId'=>$bootstrap['scopeId'],'spaceId'=>$topology['spaceId'],'parentId'=>$topology['parentId'],
            'categoryId'=>$topology['categoryId'],'boardStatusId'=>$topology['boardStatusId'],'projectType'=>$topology['kind'],'layout'=>$topology['layout'],'statuses'=>$statuses,
            'reviewedMembers'=>$topology['reviewedMembers'],'topologyHash'=>rtrim(strtr(base64_encode(hash('sha256',genesisE2eeCanonical($topology),true)),'+/','-_'),'='),
            'state'=>'preparing','bootstrapHash'=>genesisE2eeCommandHash($bootstrap),'directoryRevision'=>1,'checkpointHash'=>$receipt['checkpointHash'],'createdAt'=>$created['updatedAt']];
        $db->prepare('INSERT INTO e2ee_service_intents VALUES(?,?,?,?,?,?)')->execute([$scope['scope_id'],$actor,'resource-create-prepare',$intent,$semanticHash,genesisE2eeJson($result)]);
        return $result;
    }
    // Existing ACL, feature/quota, inbox and initial status invariants stay in
    // the existing factory. Its only supplied label is a technical placeholder.
    $created=genesisSharedCreateSpace($actor,['title'=>'[encrypted:'.$resource.']','description'=>'','invitations'=>[]],$resource);
    $receipt=genesisE2eeBootstrap($actor,$packet);
    if($receipt['state']!=='preparing'||$receipt['directoryRevision']!==1||$receipt['checkpointHash']!==genesisE2eeCommandHash($bootstrap))
        throw new DomainException('E2EE_SCOPE_SETUP_UNVERIFIED');
    $inbox=genesisE2eeRow($db,'SELECT id FROM shared_projects WHERE space_id=? AND is_inbox=1',[$resource]);
    if(!$inbox)throw new LogicException('E2EE_RESOURCE_INBOX_REQUIRED');
    $q=$db->prepare('SELECT id,is_done AS isDone FROM shared_project_statuses WHERE project_id=? ORDER BY position,id');$q->execute([$inbox['id']]);
    try{$statuses=array_map(static fn(array $row):array=>['id'=>$row['id'],'isDone'=>(int)$row['isDone']],$q->fetchAll());}finally{$q->closeCursor();}
    $result=['intentId'=>$intent,'kind'=>'space','resourceId'=>$resource,'scopeId'=>$bootstrap['scopeId'],'spaceId'=>$resource,'inboxId'=>$inbox['id'],
        'statuses'=>$statuses,'state'=>'preparing','bootstrapHash'=>genesisE2eeCommandHash($bootstrap),'directoryRevision'=>1,'checkpointHash'=>$receipt['checkpointHash'],
        'createdAt'=>$created['updatedAt']];
    $db->prepare('INSERT INTO e2ee_service_intents VALUES(?,?,?,?,?,?)')->execute([$scope['scope_id'],$actor,'resource-create-prepare',$intent,$semanticHash,genesisE2eeJson($result)]);
    return $result;
}

/** One writer lock decides whether the original semantic request committed.
 * An absent request gets a permanent receipt, before any replacement can exist.
 * A late renewed command with that ID/payload returns the same cancellation.
 * Existing projects, scopes, migration originals and quotas are never deleted. */
function genesisE2eeResolvePrivateProjectCreation(PDO $db,string $actor,array $scope,array $command): array
{
    $payload=genesisE2eeExactFields($command['payload'],['intentId','original']);$resolver=genesisE2eeIdentifier($payload['intentId']);
    $request=genesisE2eePrivateResourceRequest($db,$actor,$scope,$command,$payload['original']);
    ['intent'=>$intent,'bootstrap'=>$bootstrap,'fields'=>$fields,'resource'=>$resource,'semanticHash'=>$requestHash]=$request;
    if($fields['kind']!=='project'||$resolver!=='resource-create-resolve:'.$intent)throw new DomainException('E2EE_SCOPE_BINDING_MISMATCH');
    $topologyHash=rtrim(strtr(base64_encode(hash('sha256',genesisE2eeCanonical($request['payload']['topology']),true)),'+/','-_'),'=');
    $semanticHash=rtrim(strtr(base64_encode(hash('sha256',genesisE2eeCanonical($payload),true)),'+/','-_'),'=');
    $prior=genesisE2eeRow($db,'SELECT payload_hash,result_json FROM e2ee_service_intents WHERE scope_id=? AND actor_id=? AND action=? AND intent_id=?',
        [$scope['scope_id'],$actor,'resource-create-resolve',$resolver]);
    if($prior){if(!hash_equals($prior['payload_hash'],$semanticHash))throw new DomainException('E2EE_IDEMPOTENCY_CONFLICT');return json_decode($prior['result_json'],true,512,JSON_THROW_ON_ERROR);}
    $old=genesisE2eeRow($db,'SELECT payload_hash,result_json FROM e2ee_service_intents WHERE scope_id=? AND actor_id=? AND action=? AND intent_id=?',
        [$scope['scope_id'],$actor,'resource-create-prepare',$intent]);
    $preparation=null;
    if($old){
        if(!hash_equals($old['payload_hash'],$requestHash))throw new DomainException('E2EE_IDEMPOTENCY_CONFLICT');
        $saved=json_decode($old['result_json'],true,512,JSON_THROW_ON_ERROR);
        if(($saved['cancelled']??false)!==true)$preparation=$saved;
    }else{
        if(genesisE2eeRow($db,'SELECT 1 FROM shared_spaces WHERE id=?',[$resource])||genesisE2eeRow($db,'SELECT 1 FROM shared_projects WHERE id=?',[$resource])
            ||genesisE2eeRow($db,'SELECT 1 FROM e2ee_scopes WHERE scope_id=? OR resource_id=?',[$bootstrap['scopeId'],$resource]))throw new DomainException('E2EE_SCOPE_ALREADY_INITIALIZED');
        $tombstone=['intentId'=>$intent,'kind'=>'project','scopeId'=>$bootstrap['scopeId'],'resourceId'=>$resource,'cancelled'=>true,
            'bootstrapHash'=>genesisE2eeCommandHash($bootstrap),'topologyHash'=>$topologyHash];
        $db->prepare('INSERT INTO e2ee_service_intents VALUES(?,?,?,?,?,?)')->execute([$scope['scope_id'],$actor,'resource-create-prepare',$intent,$requestHash,genesisE2eeJson($tombstone)]);
    }
    $result=['intentId'=>$resolver,'creationIntentId'=>$intent,'kind'=>'project','scopeId'=>$bootstrap['scopeId'],'resourceId'=>$resource,
        'requestHash'=>$requestHash,'bootstrapHash'=>genesisE2eeCommandHash($bootstrap),'topologyHash'=>$topologyHash,'status'=>$preparation===null?'cancelled':'prepared','preparation'=>$preparation];
    $db->prepare('INSERT INTO e2ee_service_intents VALUES(?,?,?,?,?,?)')->execute([$scope['scope_id'],$actor,'resource-create-resolve',$resolver,$semanticHash,genesisE2eeJson($result)]);
    return $result;
}
