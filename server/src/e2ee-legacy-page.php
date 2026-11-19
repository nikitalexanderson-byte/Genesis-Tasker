<?php
declare(strict_types=1);
require_once __DIR__.'/e2ee-legacy-personal.php';

/** Internal table specifications only; no caller-controlled SQL identifiers.
 * Pages are always read under the signed lease/source/file/SQLite fences. */
function genesisE2eeLegacyPersonalPage(PDO $db,string $actor,array $scope,array $c,array $queries,string $ownerColumn):array
{
    $p=genesisE2eeExactFields($c['payload'],['migrationId','fence','sourceHash','table','offset']);
    if(!is_string($p['table'])||!isset($queries[$p['table']]))genesisE2eeInvalid();
    $offset=genesisE2eeInteger($p['offset']);
    $base=$c;$base['payload']=array_intersect_key($p,array_flip(['migrationId','fence','sourceHash']));
    $context=genesisE2eeLegacyPersonalContext($db,$actor,$scope,$base);
    $totals=[];
    foreach($queries as $name=>[$table]){
        $q=$db->prepare('SELECT COUNT(*) FROM '.$table.' WHERE '.$ownerColumn.'=?');$q->execute([$actor]);
        try{$totals[$name]=(int)$q->fetchColumn();}finally{$q->closeCursor();}
    }
    if($offset>$totals[$p['table']])genesisE2eeInvalid();
    $result=genesisE2eeLegacyPersonalHeader($actor,$scope,$context)+[
        'table'=>$p['table'],'offset'=>$offset,'totals'=>$totals,'rows'=>[],'nextOffset'=>null,
        'legacyKey'=>['keyMode'=>'empty','key'=>null]];
    [$table,$columns,$integers,$order]=$queries[$p['table']];
    $q=$db->prepare('SELECT '.$columns.' FROM '.$table.' WHERE '.$ownerColumn.'=? ORDER BY '.$order.' LIMIT 128 OFFSET ?');
    $q->bindValue(1,$actor);$q->bindValue(2,$offset,PDO::PARAM_INT);$q->execute();$bytes=strlen(genesisE2eeJson($result));
    try{while($row=$q->fetch()){
        foreach($integers as $field)if($row[$field]!==null)$row[$field]=(int)$row[$field];
        $size=strlen(genesisE2eeJson($row))+1;
        if($bytes+$size>8*1024*1024){
            if(!$result['rows'])throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
            break;
        }
        $bytes+=$size;$result['rows'][]=$row;
    }}finally{$q->closeCursor();}
    $next=$offset+count($result['rows']);
    if($next<$totals[$p['table']]){
        if($next===$offset)throw new DomainException('E2EE_SOURCE_UNAVAILABLE');
        $result['nextOffset']=$next;
    }
    return[$result,$context];
}
