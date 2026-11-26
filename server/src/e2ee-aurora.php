<?php
declare(strict_types=1);

/** Called inside the authenticated signed-command writer transaction. */
function genesisE2eeAuroraResult(PDO $db,string $actor,array $scope,array $payload): array
{
    genesisE2eeExactFields($payload,['id','methodVersion','objectId','payloadHash']);
    if($scope['kind']!=='personal'||$scope['owner_id']!==$actor||$scope['resource_id']!==$actor||$scope['state']!=='active')
        throw new GenesisResourceLimitException(403,'E2EE_SCOPE_FORBIDDEN');
    genesisRequireFeature($actor,'future-modeling');
    if(!is_string($payload['id'])||preg_match('/\A[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\z/D',$payload['id'])!==1
        ||$payload['methodVersion']!=='aurora-two-circles-v2'||$payload['objectId']!=='aurora-result-live:'.$payload['id'])
        throw new InvalidArgumentException('AURORA_RESULT_INVALID');
    genesisE2eeDecode($payload['payloadHash'],32);
    $object=genesisE2eeRow($db,'SELECT revision,payload_hash FROM e2ee_objects WHERE scope_id=? AND generation=? AND domain=? AND object_id=?',
        [$scope['scope_id'],$scope['generation'],'aurora',$payload['objectId']]);
    if(!$object||(int)$object['revision']!==1||!hash_equals($object['payload_hash'],$payload['payloadHash']))throw new DomainException('E2EE_OBJECT_REFERENCE_MISMATCH');
    $legacy=genesisE2eeRow($db,'SELECT user_id,method_version FROM future_modeling_results WHERE id=?',[$payload['id']]);
    if($legacy&&($legacy['user_id']!==$actor||$legacy['method_version']!==$payload['methodVersion']))throw new GenesisResourceLimitException(409,'MODELING_RESULT_IMMUTABLE');
    $old=genesisE2eeRow($db,'SELECT * FROM e2ee_aurora_results WHERE id=?',[$payload['id']]);
    if($old&&($old['user_id']!==$actor||$old['scope_id']!==$scope['scope_id']||(int)$old['generation']!==(int)$scope['generation']
        ||$old['object_id']!==$payload['objectId']||$old['method_version']!==$payload['methodVersion']||!hash_equals($old['payload_hash'],$payload['payloadHash'])))
        throw new GenesisResourceLimitException(409,'MODELING_RESULT_IMMUTABLE');
    if(!$old)$db->prepare('INSERT INTO e2ee_aurora_results VALUES(?,?,?,?,?,?,?,?)')->execute([
        $payload['id'],$actor,$scope['scope_id'],$scope['generation'],$payload['objectId'],$payload['payloadHash'],$payload['methodVersion'],genesisNow()]);
    return ['id'=>$payload['id'],'ready'=>true];
}
