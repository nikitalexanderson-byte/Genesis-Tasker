<?php
declare(strict_types=1);
require_once __DIR__.'/e2ee-product.php';

function genesisE2eeProductBootstrapOwner(string $actor,array $scope): void
{
    if(!in_array($scope['kind'],['project','space'],true)||$scope['owner_id']!==$actor||$scope['state']!=='active')throw new GenesisResourceLimitException(403,'E2EE_OWNER_REQUIRED');
    genesisE2eeAccess($actor,$scope['kind'],$scope['resource_id'],'manage');
}
function genesisE2eeProductBootstrapState(PDO $db,array $scope): array|false
{
    return genesisE2eeRow($db,'SELECT * FROM e2ee_product_bootstraps WHERE scope_id=? AND generation=?',[$scope['scope_id'],$scope['generation']]);
}
function genesisE2eeProductBootstrapReady(PDO $db,array $scope): array
{
    $row=genesisE2eeProductBootstrapState($db,$scope);if(!$row||$row['state']!=='active')throw new DomainException('E2EE_PRODUCT_BOOTSTRAP_REQUIRED');return$row;
}
/** Recovery discovery carries public indices and the owner's original signed
 * part, never plaintext or a server-promoted approval. Clients compare it with
 * the authenticated migration source before retaining or resuming anything. */
function genesisE2eeProductBootstrapRead(PDO $db,string $actor,array $scope,array $payload): array
{
    genesisE2eeProductBootstrapOwner($actor,$scope);genesisE2eeExactFields($payload,['afterPart']);
    $after=$payload['afterPart'];if(!is_int($after)||$after < -1||$after>255)genesisE2eeInvalid();
    $state=genesisE2eeProductBootstrapState($db,$scope);
    if(!$state)return ['bootstrap'=>null,'part'=>null];
    $count=genesisE2eeRow($db,'SELECT COUNT(*) AS n FROM e2ee_product_bootstrap_parts WHERE scope_id=? AND generation=?',[$scope['scope_id'],$scope['generation']]);
    $part=genesisE2eeRow($db,'SELECT part_index,proof_hash,signed_command FROM e2ee_product_bootstrap_parts WHERE scope_id=? AND generation=? AND part_index>? ORDER BY part_index LIMIT 1',[$scope['scope_id'],$scope['generation'],$after]);
    return ['bootstrap'=>['bootstrapId'=>$state['bootstrap_id'],'sourceManifestHash'=>$state['source_manifest_hash'],'expectedCount'=>(int)$state['expected_count'],'state'=>$state['state'],'partCount'=>(int)$count['n']],
        'part'=>$part?['partIndex'=>(int)$part['part_index'],'proofHash'=>$part['proof_hash'],'packet'=>$part['signed_command']]:null];
}
/** All inputs are technical indices and ciphertext references. Original content
 * remains in the authenticated migrated table/file objects, not in SQL here. */
function genesisE2eeProductBootstrap(PDO $db,string $actor,array $scope,array $command,array $packet): array
{
    genesisE2eeProductBootstrapOwner($actor,$scope);$payload=$command['payload'];$id=genesisE2eeIdentifier($payload['intentId']??null);$bootstrap=genesisE2eeIdentifier($payload['bootstrapId']??null);
    $hash=rtrim(strtr(base64_encode(hash('sha256',genesisE2eeCanonical($payload),true)),'+/','-_'),'=');$action=$command['action'];
    $receipt=genesisE2eeRow($db,'SELECT payload_hash,result_json FROM e2ee_service_intents WHERE scope_id=? AND actor_id=? AND action=? AND intent_id=?',[$scope['scope_id'],$actor,$action,$id]);
    if($receipt){if($receipt['payload_hash']!==$hash)throw new DomainException('E2EE_IDEMPOTENCY_CONFLICT');return json_decode($receipt['result_json'],true,512,JSON_THROW_ON_ERROR);}
    $state=genesisE2eeProductBootstrapState($db,$scope);
    if($action==='product-bootstrap-start'){
        genesisE2eeExactFields($payload,['intentId','bootstrapId','sourceManifestHash','expectedCount']);genesisE2eeDecode($payload['sourceManifestHash'],32);$count=genesisE2eeInteger($payload['expectedCount'],1);if($count>10000)genesisE2eeInvalid();
        $source=genesisE2eeRow($db,'SELECT manifest_hash FROM e2ee_retired_manifests WHERE scope_id=? AND crypto_epoch=0 AND generation=?',[$scope['scope_id'],$scope['generation']]);
        if(!$source||$source['manifest_hash']!==$payload['sourceManifestHash'])throw new DomainException('E2EE_MANIFEST_MISMATCH');
        if($state&&($state['bootstrap_id']!==$bootstrap||$state['source_manifest_hash']!==$payload['sourceManifestHash']||(int)$state['expected_count']!==$count))throw new DomainException('E2EE_PRODUCT_BOOTSTRAP_CONFLICT');
        if(!$state){if(genesisE2eeRow($db,'SELECT 1 FROM e2ee_product_entities WHERE scope_id=? AND generation=? LIMIT 1',[$scope['scope_id'],$scope['generation']]))throw new DomainException('E2EE_PRODUCT_BOOTSTRAP_CONFLICT');
            $db->prepare("INSERT INTO e2ee_product_bootstraps VALUES(?,?,?,?,?,'staging',NULL)")->execute([$scope['scope_id'],$scope['generation'],$bootstrap,$payload['sourceManifestHash'],$count]);}
        $result=['bootstrapId'=>$bootstrap,'state'=>$state['state']??'staging'];
    }elseif($action==='product-bootstrap-stage'){
        genesisE2eeExactFields($payload,['intentId','bootstrapId','partIndex','items']);$index=genesisE2eeInteger($payload['partIndex']);if($index>255||!is_array($payload['items'])||!array_is_list($payload['items'])||count($payload['items'])<1||count($payload['items'])>100)genesisE2eeInvalid();
        if(!$state||$state['bootstrap_id']!==$bootstrap||$state['state']!=='staging')throw new DomainException('E2EE_PRODUCT_BOOTSTRAP_CONFLICT');
        $previous=genesisE2eeRow($db,'SELECT * FROM e2ee_product_bootstrap_parts WHERE scope_id=? AND generation=? AND part_index=?',[$scope['scope_id'],$scope['generation'],$index]);
        if($previous)throw new DomainException('E2EE_PRODUCT_BOOTSTRAP_CONFLICT');$seen=[];
        foreach($payload['items'] as $item){genesisE2eeExactFields($item,['operation','authorId']);genesisE2eeIdentifier($item['authorId']);$operation=$item['operation'];
            genesisE2eeExactFields($operation,['action','entityId','kind','expectedRevision','domain','objectId','payloadHash','parentId','metadata','proposalId']);$entity=genesisE2eeIdentifier($operation['entityId']);
            if(isset($seen[$entity])||!in_array($operation['action'],['create','delete'],true)||$operation['expectedRevision']!==0||$operation['proposalId']!==null||!in_array($operation['kind'],GENESIS_E2EE_PRODUCT_KINDS,true)
                ||$scope['kind']==='space'&&in_array($operation['kind'],['task','status','workflow','review-policy','planning','sprint','series','automation','custom-field-value'],true)||$scope['kind']==='project'&&$operation['kind']==='space')throw new DomainException('E2EE_PRODUCT_BATCH_INVALID');
            if($operation['parentId']!==null)genesisE2eeIdentifier($operation['parentId']);$seen[$entity]=true;genesisE2eeProductMetadata($operation['kind'],$operation['metadata']);genesisE2eeProductReference($db,$scope,$operation);
        }
        $raw=genesisE2eeJson($packet);if(strlen($raw)>2*1024*1024)throw new GenesisResourceLimitException(413,'E2EE_PRODUCT_BOOTSTRAP_PART_TOO_LARGE');
        $proofHash=genesisE2eeCommandHash($command);$db->prepare('INSERT INTO e2ee_product_bootstrap_parts VALUES(?,?,?,?,?,?)')->execute([$scope['scope_id'],$scope['generation'],$bootstrap,$index,$proofHash,$raw]);
        $result=['bootstrapId'=>$bootstrap,'partIndex'=>$index,'proofHash'=>$proofHash,'proofPacket'=>$raw];
    }elseif($action==='product-bootstrap-complete'){
        genesisE2eeExactFields($payload,['intentId','bootstrapId','parts','expectedCount']);if(!$state||$state['bootstrap_id']!==$bootstrap||$state['state']!=='staging'||$payload['expectedCount']!==(int)$state['expected_count'])throw new DomainException('E2EE_PRODUCT_BOOTSTRAP_CONFLICT');
        if(!is_array($payload['parts'])||!array_is_list($payload['parts'])||count($payload['parts'])<1||count($payload['parts'])>256)genesisE2eeInvalid();
        $q=$db->prepare('SELECT * FROM e2ee_product_bootstrap_parts WHERE scope_id=? AND generation=? ORDER BY part_index');$q->execute([$scope['scope_id'],$scope['generation']]);$parts=$q->fetchAll();$q->closeCursor();
        if(count($parts)!==count($payload['parts']))throw new DomainException('E2EE_PRODUCT_BOOTSTRAP_INCOMPLETE');$items=[];$seen=[];$edges=[];
        foreach($parts as $index=>$part){$claimed=genesisE2eeExactFields($payload['parts'][$index],['partIndex','proofHash']);if($claimed['partIndex']!==$index||(int)$part['part_index']!==$index||$claimed['proofHash']!==$part['proof_hash'])throw new DomainException('E2EE_PRODUCT_BOOTSTRAP_INCOMPLETE');
            $signed=json_decode($part['signed_command'],true,512,JSON_THROW_ON_ERROR);foreach($signed['command']['payload']['items'] as $item){$operation=$item['operation'];$entity=$operation['entityId'];if(isset($seen[$entity]))throw new DomainException('E2EE_PRODUCT_BOOTSTRAP_CONFLICT');$seen[$entity]=$operation;
                genesisE2eeProductReference($db,$scope,$operation);$edges[$entity]=array_merge($operation['parentId']===null?[]:[$operation['parentId']],$operation['metadata']['dependsOnIds']??[]);$items[]=['operation'=>$operation,'authorId'=>$item['authorId'],'packet'=>$signed];}}
        if(count($items)!==(int)$state['expected_count']||!isset($seen[$scope['kind'].':'.$scope['resource_id']]))throw new DomainException('E2EE_PRODUCT_BOOTSTRAP_INCOMPLETE');
        $degrees=[];$reverse=[];$ready=[];foreach($edges as $entity=>$links){$links=array_values(array_unique($links));$degrees[$entity]=count($links);if(!$links)$ready[]=$entity;foreach($links as $link){if(!isset($edges[$link]))throw new DomainException('E2EE_PRODUCT_DEPENDENCY_INVALID');$reverse[$link][]=$entity;}}
        $visited=0;for($index=0;$index<count($ready);$index++){$visited++;foreach($reverse[$ready[$index]]??[] as $entity)if(--$degrees[$entity]===0)$ready[]=$entity;}if($visited!==count($edges))throw new DomainException('E2EE_PRODUCT_DEPENDENCY_CYCLE');
        // Existing completion/review history is a baseline, not a new completion
        // request. Future mutations use normal live rules and fresh approvals.
        foreach($items as $item)genesisE2eeProductSave($db,$scope,$item['operation'],$item['authorId'],$actor,$item['packet']);
        $db->prepare("UPDATE e2ee_product_bootstraps SET state='active',commit_packet=? WHERE scope_id=? AND generation=?")->execute([genesisE2eeJson($packet),$scope['scope_id'],$scope['generation']]);
        $result=['bootstrapId'=>$bootstrap,'state'=>'active','count'=>count($items)];
    }else throw new InvalidArgumentException('E2EE_UNKNOWN_ACTION');
    $db->prepare('INSERT INTO e2ee_service_intents VALUES(?,?,?,?,?,?)')->execute([$scope['scope_id'],$actor,$action,$id,$hash,genesisE2eeJson($result)]);return$result;
}
