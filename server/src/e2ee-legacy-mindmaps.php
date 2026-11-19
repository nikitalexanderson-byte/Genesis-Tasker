<?php
declare(strict_types=1);
require_once __DIR__.'/e2ee-legacy-personal.php';

/** Read-only complete personal map history for the signed owner/lease. Unlike
 * the ordinary UI history reader this has no twenty-version truncation and no
 * create-task/provider, receipt acknowledgement or cleanup side effects. */
function genesisE2eeLegacyMindmaps(PDO $db,string $actor,array $scope,array $c):array
{
    $context=genesisE2eeLegacyPersonalContext($db,$actor,$scope,$c);
    $result=genesisE2eeLegacyPersonalHeader($actor,$scope,$context)+[
        'maps'=>[],'versions'=>[],'receipts'=>[],'deletions'=>[]];
    $queries=[
        'maps'=>['personal_mindmaps','id,schema_version,revision,ciphertext,iv,updated_at',['schema_version','revision'],'id'],
        'versions'=>['personal_mindmap_versions','map_id,revision,schema_version,ciphertext,iv,updated_at',['schema_version','revision'],'map_id,revision'],
        'receipts'=>['personal_mindmap_receipts','map_id,operation_id,payload_hash,revision',['revision'],'map_id,operation_id'],
        'deletions'=>['personal_mindmap_deletions','map_id,deleted_at',[],'map_id'],
    ];
    $bytes=strlen(genesisE2eeJson($result));$count=0;
    foreach($queries as $name=>[$table,$columns,$integers,$order]){
        $q=$db->prepare('SELECT '.$columns.' FROM '.$table.' WHERE user_id=? ORDER BY '.$order);$q->execute([$actor]);
        try{while($row=$q->fetch()){
            if(++$count>10000)throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
            foreach($integers as $field)if($row[$field]!==null)$row[$field]=(int)$row[$field];
            $bytes+=strlen(genesisE2eeJson($row))+1;
            if($bytes>16*1024*1024)throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
            $result[$name][]=$row;
        }}finally{$q->closeCursor();}
    }
    $result['legacyKey']=$result['maps']||$result['versions']?genesisE2eeLegacyAccountKey($context['user'],true):['keyMode'=>'empty','key'=>null];
    if(strlen(genesisE2eeJson($result))>16*1024*1024)throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
    return $result;
}
