<?php
declare(strict_types=1);

/** A legacy source revision is a conservative write fence, never a read grant.
 * Shared originals require the live resource owner and its signed lease under
 * the same SQLite writer used by the outer authenticated read transaction. */
function genesisE2eeLegacySharedContext(PDO $db,string $actor,array $scope,array $c):array
{
    if(!$db->inTransaction())throw new LogicException('E2EE_TRANSACTION_REQUIRED');
    if(!in_array($scope['kind'],['project','space'],true)||$scope['owner_id']!==$actor)
        throw new GenesisResourceLimitException(403,'E2EE_SCOPE_FORBIDDEN');
    genesisE2eeAccess($actor,$scope['kind'],$scope['resource_id'],'manage');
    if(!in_array($scope['state'],['uploading','verified'],true))throw new DomainException('E2EE_MIGRATION_FENCED');
    $p=genesisE2eeExactFields($c['payload'],['migrationId','fence','sourceHash']);
    genesisE2eeIdentifier($p['migrationId']);genesisE2eeInteger($p['fence'],1);genesisE2eeDecode($p['sourceHash'],32);
    $lease=genesisE2eeRequireLease($db,$scope,$c['deviceId']);
    if($p['migrationId']!==$lease['migration_id']||$p['fence']!==(int)$lease['fence']
        ||!hash_equals($lease['source_hash'],$p['sourceHash']))throw new DomainException('E2EE_MIGRATION_FENCED');
    if(!hash_equals($lease['source_hash'],genesisE2eeSourceHash($db,$scope)))throw new DomainException('E2EE_SOURCE_CHANGED');
    $space=$scope['kind']==='space'?$scope['resource_id']:
        genesisE2eeRow($db,'SELECT space_id FROM shared_projects WHERE id=?',[$scope['resource_id']])['space_id'];
    return ['lease'=>$lease,'spaceId'=>$space];
}

/** Metadata only, before opening any corresponding content. Null is an explicit
 * space owner, not a missing project lineage. Old ambiguous receipts/tombstones
 * must be reviewed instead of being omitted from an apparently complete source. */
function genesisE2eeLegacySharedMapLineage(PDO $db,string $space):void
{
    $invalid=[
        'SELECT 1 FROM shared_mindmaps r WHERE r.space_id=? AND r.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM shared_projects p WHERE p.id=r.project_id AND p.space_id=r.space_id) LIMIT 1',
        'SELECT 1 FROM shared_mindmap_versions r WHERE r.space_id=? AND r.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM shared_projects p WHERE p.id=r.project_id AND p.space_id=r.space_id) LIMIT 1',
        'SELECT 1 FROM shared_mindmap_deletions r WHERE r.space_id=? AND NOT EXISTS(SELECT 1 FROM shared_mindmap_deletion_scopes s WHERE s.space_id=r.space_id AND s.map_id=r.map_id) LIMIT 1',
        'SELECT 1 FROM shared_mindmap_deletion_scopes r WHERE r.space_id=? AND (NOT EXISTS(SELECT 1 FROM shared_mindmap_deletions d WHERE d.space_id=r.space_id AND d.map_id=r.map_id) OR (r.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM shared_projects p WHERE p.id=r.project_id AND p.space_id=r.space_id))) LIMIT 1',
        'SELECT 1 FROM shared_mindmap_deletions r WHERE r.space_id=? AND EXISTS(SELECT 1 FROM shared_mindmaps m WHERE m.space_id=r.space_id AND m.id=r.map_id) LIMIT 1',
        'SELECT 1 FROM shared_mindmap_receipts r WHERE r.space_id=? AND NOT EXISTS(SELECT 1 FROM shared_mindmap_versions v WHERE v.space_id=r.space_id AND v.map_id=r.map_id AND v.revision=r.revision) AND NOT EXISTS(SELECT 1 FROM shared_mindmaps m WHERE m.space_id=r.space_id AND m.id=r.map_id AND m.revision=r.revision) LIMIT 1',
        'SELECT 1 FROM shared_mindmap_receipts r JOIN shared_mindmaps m ON m.space_id=r.space_id AND m.id=r.map_id AND m.revision=r.revision JOIN shared_mindmap_versions v ON v.space_id=r.space_id AND v.map_id=r.map_id AND v.revision=r.revision WHERE r.space_id=? AND m.project_id IS NOT v.project_id LIMIT 1',
        'SELECT 1 FROM shared_mindmap_conversions r WHERE r.space_id=? AND NOT EXISTS(SELECT 1 FROM shared_projects p WHERE p.id=r.project_id AND p.space_id=r.space_id) LIMIT 1',
        'SELECT 1 FROM shared_mindmap_conversions r WHERE r.space_id=? AND NOT EXISTS(SELECT 1 FROM shared_mindmaps m WHERE m.space_id=r.space_id AND m.id=r.map_id) AND NOT EXISTS(SELECT 1 FROM shared_mindmap_deletion_scopes s WHERE s.space_id=r.space_id AND s.map_id=r.map_id) LIMIT 1',
        // A conversion stores its destination project but no source revision.
        // Retained evidence of multiple source owners cannot be reduced to the
        // map's newest owner or used to reveal another scope's history.
        'SELECT 1 FROM shared_mindmap_conversions r JOIN shared_mindmaps m ON m.space_id=r.space_id AND m.id=r.map_id JOIN shared_mindmap_versions v ON v.space_id=r.space_id AND v.map_id=r.map_id WHERE r.space_id=? AND m.project_id IS NOT v.project_id LIMIT 1',
        'SELECT 1 FROM shared_mindmap_conversions r JOIN shared_mindmap_deletion_scopes s ON s.space_id=r.space_id AND s.map_id=r.map_id JOIN shared_mindmap_versions v ON v.space_id=r.space_id AND v.map_id=r.map_id WHERE r.space_id=? AND s.project_id IS NOT v.project_id LIMIT 1',
    ];
    foreach($invalid as $sql)if(genesisE2eeRow($db,$sql,[$space]))throw new DomainException('E2EE_SHARED_SOURCE_LINEAGE_REVIEW_REQUIRED');
}

/** Exact indexed read grants, deliberately independent of the OR-based fence
 * inventory. Versions keep their ORIGINAL project even after a map is moved;
 * a space source contains space-owned maps, never all child-project bodies. */
function genesisE2eeLegacySharedMapQueries(array $scope,string $space):array
{
    $owner=$scope['kind']==='project'?'=?':' IS NULL';
    $values=$scope['kind']==='project'?[$space,$scope['resource_id']]:[$space];
    $receiptOwner='CASE WHEN EXISTS(SELECT 1 FROM shared_mindmap_versions v WHERE v.space_id=r.space_id AND v.map_id=r.map_id AND v.revision=r.revision) THEN '
        .'(SELECT v.project_id FROM shared_mindmap_versions v WHERE v.space_id=r.space_id AND v.map_id=r.map_id AND v.revision=r.revision) ELSE '
        .'(SELECT m.project_id FROM shared_mindmaps m WHERE m.space_id=r.space_id AND m.id=r.map_id AND m.revision=r.revision) END';
    $conversionOwner='CASE WHEN EXISTS(SELECT 1 FROM shared_mindmaps m WHERE m.space_id=r.space_id AND m.id=r.map_id) THEN '
        .'(SELECT m.project_id FROM shared_mindmaps m WHERE m.space_id=r.space_id AND m.id=r.map_id) ELSE '
        .'(SELECT s.project_id FROM shared_mindmap_deletion_scopes s WHERE s.space_id=r.space_id AND s.map_id=r.map_id) END';
    return [
        'maps'=>['shared_mindmaps','r.space_id,r.id,r.revision,r.content,r.updated_at,r.project_id','r.space_id=? AND r.project_id'.$owner,$values,'r.id',['revision']],
        'versions'=>['shared_mindmap_versions','r.space_id,r.map_id,r.revision,r.content,r.updated_at,r.project_id','r.space_id=? AND r.project_id'.$owner,$values,'r.map_id,r.revision',['revision']],
        'receipts'=>['shared_mindmap_receipts','r.space_id,r.map_id,r.operation_id,r.payload_hash,r.revision','r.space_id=? AND ('.$receiptOwner.')'.$owner,$values,'r.map_id,r.operation_id',['revision']],
        'deletions'=>['shared_mindmap_deletions','r.space_id,r.map_id','r.space_id=? AND (SELECT s.project_id FROM shared_mindmap_deletion_scopes s WHERE s.space_id=r.space_id AND s.map_id=r.map_id)'.$owner,$values,'r.map_id',[]],
        'deletionScopes'=>['shared_mindmap_deletion_scopes','r.space_id,r.map_id,r.project_id','r.space_id=? AND r.project_id'.$owner,$values,'r.map_id',[]],
        // The destination is an inert reference, never the source-map grant or
        // permission to read the destination task/project body.
        'conversions'=>['shared_mindmap_conversions','r.space_id,r.map_id,r.node_id,r.project_id,r.task_id','r.space_id=? AND ('.$conversionOwner.')'.$owner,$values,'r.map_id,r.node_id',[]],
    ];
}

/** Bounded read-only originals, not a source adapter or an import/replay port.
 * Both original stored text and exact opened OLD content are retained so the
 * protected HTTP capture can keep provenance without a global server key. */
function genesisE2eeLegacySharedMindmaps(PDO $db,string $actor,array $scope,array $c):array
{
    $p=genesisE2eeExactFields($c['payload'],['migrationId','fence','sourceHash','table','offset']);
    if(!is_string($p['table'])||!in_array($p['table'],['maps','versions','receipts','deletions','deletionScopes','conversions'],true))genesisE2eeInvalid();
    $offset=genesisE2eeInteger($p['offset']);
    $base=$c;$base['payload']=array_intersect_key($p,array_flip(['migrationId','fence','sourceHash']));
    $context=genesisE2eeLegacySharedContext($db,$actor,$scope,$base);$space=$context['spaceId'];$lease=$context['lease'];
    genesisE2eeLegacySharedMapLineage($db,$space);
    $queries=genesisE2eeLegacySharedMapQueries($scope,$space);$totals=[];$count=0;
    foreach($queries as $name=>[$table,,$where,$values]){
        $q=$db->prepare('SELECT COUNT(*) FROM '.$table.' r WHERE '.$where);$q->execute($values);
        try{$totals[$name]=(int)$q->fetchColumn();$count+=$totals[$name];}finally{$q->closeCursor();}
    }
    if($count>10000)throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
    if($offset>$totals[$p['table']])genesisE2eeInvalid();
    $result=['protocol'=>1,'ownerId'=>$actor,'scopeId'=>$scope['scope_id'],'kind'=>$scope['kind'],'resourceId'=>$scope['resource_id'],'spaceId'=>$space,
        'migrationId'=>$lease['migration_id'],'fence'=>(int)$lease['fence'],'sourceHash'=>$lease['source_hash'],
        'checkpointHash'=>$scope['checkpoint_hash'],'directoryRevision'=>(int)$scope['directory_revision'],
        'table'=>$p['table'],'offset'=>$offset,'totals'=>$totals,'rows'=>[],'nextOffset'=>null];
    [$table,$columns,$where,$values,$order,$integers]=$queries[$p['table']];
    $q=$db->prepare('SELECT '.$columns.' FROM '.$table.' r WHERE '.$where.' ORDER BY '.$order.' LIMIT 128 OFFSET ?');
    foreach([...$values,$offset]as$index=>$value)$q->bindValue($index+1,$value,is_int($value)?PDO::PARAM_INT:PDO::PARAM_STR);
    $q->execute();$bytes=strlen(genesisE2eeJson($result));
    try{while($row=$q->fetch()){
        foreach($integers as$field)$row[$field]=(int)$row[$field];
        if(array_key_exists('content',$row)){
            if(!is_string($row['content'])||strlen($row['content'])>4*1024*1024)throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
            try{$original=genesisSharedContentDecrypt($row['content']);}catch(Throwable){throw new DomainException('E2EE_SHARED_SOURCE_CONTENT_UNAVAILABLE');}
            if(!is_string($original))throw new DomainException('E2EE_SHARED_SOURCE_CONTENT_UNAVAILABLE');
            if(strlen($original)>2_000_000)throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
            $row['originalJson']=$original;
        }
        $size=strlen(genesisE2eeJson($row))+1;
        if($bytes+$size>8*1024*1024){if(!$result['rows'])throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');break;}
        $bytes+=$size;$result['rows'][]=$row;
    }}finally{$q->closeCursor();}
    $next=$offset+count($result['rows']);
    if($next<$totals[$p['table']]){
        if($next===$offset)throw new DomainException('E2EE_SOURCE_UNAVAILABLE');
        $result['nextOffset']=$next;
    }
    if(strlen(genesisE2eeJson($result))>8*1024*1024)throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
    return$result;
}
