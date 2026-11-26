<?php
declare(strict_types=1);
require_once __DIR__.'/e2ee-legacy-personal.php';
require_once __DIR__.'/shared-content-storage.php';

/** Historical source only, behind the signed personal migration lease. Payment
 * orders, entitlement, identities and provider credentials are never selected.
 * Old server-readable result wrappers are opened here; new vault data is absent.
 */
function genesisE2eeLegacyAurora(PDO $db,string $actor,array $scope,array $c): array
{
    $context=genesisE2eeLegacyPersonalContext($db,$actor,$scope,$c);
    $workspace=genesisE2eeRow($db,'SELECT revision,iv,ciphertext,updated_at FROM aurora_workspaces WHERE user_id=?',[$actor]);
    $workspace=$workspace?['revision'=>(int)$workspace['revision'],'iv'=>$workspace['iv'],'ciphertext'=>$workspace['ciphertext'],'updatedAt'=>$workspace['updated_at']]:null;
    $result=genesisE2eeLegacyPersonalHeader($actor,$scope,$context)+['workspace'=>$workspace,'results'=>[]];
    $size=strlen(genesisE2eeJson($result));$count=0;$needsKey=$workspace!==null;
    $q=$db->prepare('SELECT id,method_version,encrypted_result,result_hash,created_at FROM future_modeling_results WHERE user_id=? ORDER BY id');$q->execute([$actor]);
    try {
        while($row=$q->fetch()) {
            if(++$count>10000||strlen($row['encrypted_result'])>1024*1024)throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
            try {
                $json=genesisSharedContentDecrypt($row['encrypted_result']);
                $solution=json_decode($json,true,64,JSON_THROW_ON_ERROR);
            } catch(Throwable) {throw new DomainException('E2EE_LEGACY_AURORA_CORRUPT');}
            if(!is_array($solution)||array_is_list($solution)||!hash_equals($row['result_hash'],hash('sha256',$row['method_version'].':'.$json)))
                throw new DomainException('E2EE_LEGACY_AURORA_CORRUPT');
            $needsKey=$needsKey||($solution['kind']??null)==='aurora-encrypted-solution-v1';
            $copy=['id'=>$row['id'],'methodVersion'=>$row['method_version'],'solutionJson'=>$json,'resultHash'=>$row['result_hash'],'createdAt'=>$row['created_at']];
            $size+=strlen(genesisE2eeJson($copy))+1;if($size>16*1024*1024)throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
            $result['results'][]=$copy;
        }
    } finally {$q->closeCursor();}
    $result['legacyKey']=genesisE2eeLegacyAccountKey($context['user'],$needsKey);
    if(strlen(genesisE2eeJson($result))>16*1024*1024)throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
    return $result;
}
