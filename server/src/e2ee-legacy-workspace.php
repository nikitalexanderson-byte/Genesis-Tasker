<?php
declare(strict_types=1);
require_once __DIR__.'/e2ee-legacy-personal.php';

/** Explicit owner-only LEGACY source for migration, never a general export rule.
 * Called after signed-device authorization under the SQLite writer lock. Does
 * not bootstrap Google, ensure keys, normalize rows, acknowledge queues or write.
 * New E2EE roots/private keys are never accepted or returned by this path.
 */
function genesisE2eeLegacyWorkspace(PDO $db,string $actor,array $scope,array $c): array
{
    $context=genesisE2eeLegacyPersonalContext($db,$actor,$scope,$c);
    $blob=genesisE2eeRow($db,'SELECT ciphertext,iv,version,updated_at,minimum_writer_protocol FROM workspace_blobs WHERE user_id=?',[$actor]);
    $key=genesisE2eeLegacyAccountKey($context['user'],(bool)$blob);
    $preferences=genesisE2eeRow($db,'SELECT category_sync_map,ui_visibility_json,sync_routing_mode,sync_target_account_ids FROM users WHERE id=?',[$actor]);
    if(!$preferences)throw new DomainException('E2EE_SOURCE_UNAVAILABLE');
    $result=genesisE2eeLegacyPersonalHeader($actor,$scope,$context)+[
        'workspace'=>$key+['envelope'=>$blob?[
            'ciphertext'=>$blob['ciphertext'],'iv'=>$blob['iv'],'version'=>(int)$blob['version'],
            'updatedAt'=>$blob['updated_at'],'minimumWriterProtocol'=>(int)$blob['minimum_writer_protocol']]:null],
        'privatePreferences'=>['categoryMapJson'=>$preferences['category_sync_map'],'visibilityJson'=>$preferences['ui_visibility_json'],
            'routingMode'=>$preferences['sync_routing_mode'],'routingTargetsJson'=>$preferences['sync_target_account_ids']],
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
