<?php
declare(strict_types=1);

/** Only the already-authorized signed migration read calls this helper. Source
 * tokens/leases are checked under the same SQLite writer as the actual reads.
 * Conservative fence ownership predicates never grant source-read permission. */
function genesisE2eeLegacyPersonalContext(PDO $db,string $actor,array $scope,array $c): array
{
    if(!$db->inTransaction())throw new LogicException('E2EE_TRANSACTION_REQUIRED');
    if($scope['kind']!=='personal'||$scope['owner_id']!==$actor||$scope['resource_id']!==$actor)
        throw new GenesisResourceLimitException(403,'E2EE_SCOPE_FORBIDDEN');
    if(!in_array($scope['state'],['uploading','verified'],true))throw new DomainException('E2EE_MIGRATION_FENCED');
    $p=genesisE2eeExactFields($c['payload'],['migrationId','fence','sourceHash']);
    genesisE2eeIdentifier($p['migrationId']);genesisE2eeInteger($p['fence'],1);genesisE2eeDecode($p['sourceHash'],32);
    $lease=genesisE2eeRequireLease($db,$scope,$c['deviceId']);
    if($p['migrationId']!==$lease['migration_id']||$p['fence']!==(int)$lease['fence']
        ||!hash_equals($lease['source_hash'],$p['sourceHash']))throw new DomainException('E2EE_MIGRATION_FENCED');
    if(!hash_equals($lease['source_hash'],genesisE2eeSourceHash($db,$scope)))throw new DomainException('E2EE_SOURCE_CHANGED');
    $user=genesisE2eeRow($db,'SELECT data_generation,workspace_key_mode,workspace_key_enc FROM users WHERE id=?',[$actor]);
    if(!$user)throw new DomainException('E2EE_SOURCE_UNAVAILABLE');
    return ['lease'=>$lease,'user'=>$user];
}

/** Pre-existing OLD server-known key only. Missing/corrupt keys never generate
 * replacements. No new E2EE root/private key is accepted or returned here. */
function genesisE2eeLegacyAccountKey(array $user,bool $hasCiphertext): array
{
    $key=null;$mode='empty';
    if(!empty($user['workspace_key_enc'])) {
        $configKey=base64_decode((string)genesisConfig()['crypto_key'],true);
        if(!is_string($configKey)||strlen($configKey)!==SODIUM_CRYPTO_SECRETBOX_KEYBYTES)throw new RuntimeException('Invalid encryption key.');
        $old=base64_decode($user['workspace_key_enc'],true);
        if(!is_string($old)||strlen($old)!==84)throw new DomainException('E2EE_LEGACY_KEY_UNAVAILABLE');
        $key=genesisDecrypt($user['workspace_key_enc']);$raw=is_string($key)?base64_decode($key,true):false;
        if(!is_string($raw)||strlen($raw)!==32||base64_encode($raw)!==$key)throw new DomainException('E2EE_LEGACY_KEY_UNAVAILABLE');
        $mode='account';
    } elseif(($user['workspace_key_mode']??'legacy')==='client')$mode='client';
    elseif($hasCiphertext)throw new DomainException('E2EE_LEGACY_KEY_UNAVAILABLE');
    return ['keyMode'=>$mode,'key'=>$key];
}

function genesisE2eeLegacyPersonalHeader(string $actor,array $scope,array $context): array
{
    $lease=$context['lease'];
    return ['protocol'=>1,'ownerId'=>$actor,'scopeId'=>$scope['scope_id'],'migrationId'=>$lease['migration_id'],
        'fence'=>(int)$lease['fence'],'sourceHash'=>$lease['source_hash'],'legacyGeneration'=>(int)$context['user']['data_generation'],
        'checkpointHash'=>$scope['checkpoint_hash'],'directoryRevision'=>(int)$scope['directory_revision']];
}
