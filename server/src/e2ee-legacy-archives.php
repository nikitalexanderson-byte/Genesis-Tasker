<?php
declare(strict_types=1);
require_once __DIR__.'/e2ee-legacy-page.php';

const GENESIS_E2EE_ARCHIVE_TABLES=[
    'stages'=>['backup_stages','id,payload_hash,generation,revision_hash,payload_enc,created_at,expires_at',['generation','expires_at'],'id'],
    'safety'=>['backup_safety_snapshots','id,snapshot_enc,created_at,expires_at',['expires_at'],'id'],
    'receipts'=>['backup_receipts','operation_id,payload_hash,generation,created_at',['generation'],'operation_id'],
];
function genesisE2eeLegacyArchiveRow(string $table,array $row):array
{
    $fields=['stages'=>['payload_enc','payload_json'],'safety'=>['snapshot_enc','snapshot_json']];
    if(isset($fields[$table])){
        [$stored,$plain]=$fields[$table];
        try{$row[$plain]=genesisDecrypt($row[$stored]);}
        catch(Throwable){throw new DomainException('E2EE_ARCHIVE_SOURCE_CORRUPT');}
        if(!is_string($row[$plain]))throw new DomainException('E2EE_ARCHIVE_SOURCE_CORRUPT');
    }
    return$row;
}

/** Retained personal backup content only. Expired stages, safety copies and
 * uncertain restore receipts stay readable under the exact signed owner lease.
 * Do not call preview/apply/authorize/prune helpers or restore any authority.
 * OLD server-at-rest wrappers are opened here; raw nested JSON/ciphertext remain
 * intact for client reconciliation. No new E2EE root/private key is accepted. */
function genesisE2eeLegacyArchives(PDO $db,string $actor,array $scope,array $c):array
{
    if(array_key_exists('byteOffset',$c['payload']))return genesisE2eeLegacyArchiveFragment($db,$actor,$scope,$c);
    [$result,$context]=genesisE2eeLegacyPersonalPage($db,$actor,$scope,$c,GENESIS_E2EE_ARCHIVE_TABLES,'user_id','genesisE2eeLegacyArchiveRow');
    // Nested old client envelopes may still need the old account key. This is
    // the same pre-existing server-known key, never the target E2EE root.
    if($result['rows']&&in_array($result['table'],['stages','safety'],true))
        $result['legacyKey']=genesisE2eeLegacyAccountKey($context['user'],true);
    if(strlen(genesisE2eeJson($result))>16*1024*1024)throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
    return$result;
}

/** Opt-in byte transport for a valid retained row larger than a normal page.
 * Every fragment independently rechecks the exact source/lease under the writer
 * barrier. The client must join ALL bytes, verify length/hash and strictly parse
 * the original JSON before treating this row as complete. This is not a restore
 * operation and its old-source hash must not become target remote metadata. */
function genesisE2eeLegacyArchiveFragment(PDO $db,string $actor,array $scope,array $c):array
{
    $p=genesisE2eeExactFields($c['payload'],['migrationId','fence','sourceHash','table','offset','byteOffset']);
    if(!is_string($p['table'])||!isset(GENESIS_E2EE_ARCHIVE_TABLES[$p['table']]))genesisE2eeInvalid();
    $offset=genesisE2eeInteger($p['offset']);$position=genesisE2eeInteger($p['byteOffset']);
    $base=$c;$base['payload']=array_intersect_key($p,array_flip(['migrationId','fence','sourceHash']));
    $context=genesisE2eeLegacyPersonalContext($db,$actor,$scope,$base);$totals=[];
    foreach(GENESIS_E2EE_ARCHIVE_TABLES as $name=>[$table]){
        $q=$db->prepare('SELECT COUNT(*) FROM '.$table.' WHERE user_id=?');$q->execute([$actor]);
        try{$totals[$name]=(int)$q->fetchColumn();}finally{$q->closeCursor();}
    }
    if($offset>$totals[$p['table']]||$position>64*1024*1024)genesisE2eeInvalid();
    [$table,$columns,$integers,$order]=GENESIS_E2EE_ARCHIVE_TABLES[$p['table']];
    $q=$db->prepare('SELECT '.$columns.' FROM '.$table.' WHERE user_id=? ORDER BY '.$order.' LIMIT 1 OFFSET ?');
    $q->bindValue(1,$actor);$q->bindValue(2,$offset,PDO::PARAM_INT);$q->execute();
    try{$row=$q->fetch();}finally{$q->closeCursor();}
    $result=genesisE2eeLegacyPersonalHeader($actor,$scope,$context)+[
        'encoding'=>'utf8-json-fragments-v1','table'=>$p['table'],'offset'=>$offset,'byteOffset'=>$position,'totals'=>$totals,
        'rowBytes'=>0,'rowHash'=>null,'chunk'=>'','nextByteOffset'=>null,'nextOffset'=>null,'legacyKey'=>['keyMode'=>'empty','key'=>null]];
    if(!$row){if($offset!==$totals[$p['table']]||$position!==0)genesisE2eeInvalid();return$result;}
    foreach($integers as $field)if($row[$field]!==null)$row[$field]=(int)$row[$field];
    $bytes=genesisE2eeJson(genesisE2eeLegacyArchiveRow($p['table'],$row));$length=strlen($bytes);
    if($length>64*1024*1024)throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
    if($position>=$length)genesisE2eeInvalid();
    $chunk=substr($bytes,$position,1024*1024);$next=$position+strlen($chunk);
    $result['rowBytes']=$length;$result['rowHash']=rtrim(strtr(base64_encode(hash('sha256',$bytes,true)),'+/','-_'),'=');
    $result['chunk']=rtrim(strtr(base64_encode($chunk),'+/','-_'),'=');
    $result['nextByteOffset']=$next<$length?$next:null;
    $result['nextOffset']=$next<$length?$offset:($offset+1<$totals[$p['table']]?$offset+1:null);
    if(in_array($p['table'],['stages','safety'],true))$result['legacyKey']=genesisE2eeLegacyAccountKey($context['user'],true);
    return$result;
}
