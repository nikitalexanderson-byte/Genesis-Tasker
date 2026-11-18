<?php
declare(strict_types=1);

/** Explicit owner-only LEGACY source for migration, never a general export rule.
 * Called after signed-device authorization under the SQLite writer lock. Does
 * not bootstrap Google, ensure keys, normalize rows, acknowledge queues or write.
 * New E2EE roots/private keys are never accepted or returned by this path.
 */
function genesisE2eeLegacyWorkspace(PDO $db,string $actor,array $scope,array $c): array
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
    $blob=genesisE2eeRow($db,'SELECT ciphertext,iv,version,updated_at,minimum_writer_protocol FROM workspace_blobs WHERE user_id=?',[$actor]);
    $key=null;$mode='empty';
    if(!empty($user['workspace_key_enc'])) {
        // This is only a pre-existing server-known legacy key. Never manufacture
        // a replacement if it is corrupt or missing; preserve the original source.
        $configKey=base64_decode((string)genesisConfig()['crypto_key'],true);
        if(!is_string($configKey)||strlen($configKey)!==SODIUM_CRYPTO_SECRETBOX_KEYBYTES)throw new RuntimeException('Invalid encryption key.');
        $old=base64_decode($user['workspace_key_enc'],true);
        if(!is_string($old)||strlen($old)!==84)throw new DomainException('E2EE_LEGACY_KEY_UNAVAILABLE');
        $key=genesisDecrypt($user['workspace_key_enc']);$raw=is_string($key)?base64_decode($key,true):false;
        if(!is_string($raw)||strlen($raw)!==32||base64_encode($raw)!==$key)throw new DomainException('E2EE_LEGACY_KEY_UNAVAILABLE');
        $mode='account';
    } elseif(($user['workspace_key_mode']??'legacy')==='client')$mode='client';
    elseif($blob)throw new DomainException('E2EE_LEGACY_KEY_UNAVAILABLE');
    $result=['protocol'=>1,'ownerId'=>$actor,'scopeId'=>$scope['scope_id'],'migrationId'=>$lease['migration_id'],
        'fence'=>(int)$lease['fence'],'sourceHash'=>$lease['source_hash'],'legacyGeneration'=>(int)$user['data_generation'],
        'checkpointHash'=>$scope['checkpoint_hash'],'directoryRevision'=>(int)$scope['directory_revision'],
        'workspace'=>['keyMode'=>$mode,'key'=>$key,'envelope'=>$blob?[
            'ciphertext'=>$blob['ciphertext'],'iv'=>$blob['iv'],'version'=>(int)$blob['version'],
            'updatedAt'=>$blob['updated_at'],'minimumWriterProtocol'=>(int)$blob['minimum_writer_protocol']]:null],
        'projects'=>[],'categories'=>[]];
    $bytes=strlen(genesisE2eeJson($result));$rows=0;
    // Explicit historical row fields. Identity, billing, tokens and ACL are not
    // content. Conservative multi-project fence predicates are NOT read grants.
    foreach(['projects'=>'id,parent_id,category_id,title,description,tags_json,status,position,created_at,updated_at',
        'categories'=>'id,name,color,position,created_at,updated_at'] as $table=>$columns) {
        $q=$db->prepare('SELECT '.$columns.' FROM '.$table.' WHERE user_id=? ORDER BY id');$q->execute([$actor]);
        try {
            while($row=$q->fetch()) {
                $bytes+=strlen(genesisE2eeJson($row))+1;$rows++;
                if($rows>10000||$bytes>16*1024*1024)throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
                $result[$table][]=$row;
            }
        } finally {$q->closeCursor();}
    }
    if(strlen(genesisE2eeJson($result))>16*1024*1024)throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
    return$result;
}
