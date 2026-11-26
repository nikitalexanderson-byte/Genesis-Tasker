<?php
declare(strict_types=1);
require_once __DIR__.'/e2ee-legacy-personal.php';

/** Exact historical content for the current signed personal owner/device/lease.
 * No diary bootstrap, privacy toggle/purge, quota check, date conversion, voice
 * provider or receipt acknowledgement. Historical content is retained even when
 * its old feature entitlement has expired or sync was previously disabled. */
function genesisE2eeLegacyDiary(PDO $db,string $actor,array $scope,array $c):array
{
    $context=genesisE2eeLegacyPersonalContext($db,$actor,$scope,$c);
    $result=genesisE2eeLegacyPersonalHeader($actor,$scope,$context)+[
        'notes'=>[],'deletions'=>[],'settings'=>[],'dreams'=>[],'dreamSettings'=>[],'adviceReferences'=>[]];
    $queries=[
        'notes'=>['personal_diary_notes','id,revision,schema_version,iv,ciphertext,payload_hash,updated_at',['revision','schema_version'],'id'],
        'deletions'=>['personal_diary_deletions','id,revision,local_only,updated_at',['revision','local_only'],'id'],
        'settings'=>['personal_diary_settings','sync_enabled,revision,command_hash,removed_count,updated_at',['sync_enabled','revision','removed_count'],'user_id'],
        'dreams'=>['personal_diary_dreams','note_id,dream_day,time_zone',[],'note_id'],
        'dreamSettings'=>['dream_journal_preferences','today_mode,revision,updated_at',['revision'],'user_id'],
        'adviceReferences'=>['personal_diary_advice_references','note_id,advice_id',[],'note_id'],
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
    $result['legacyKey']=$result['notes']?genesisE2eeLegacyAccountKey($context['user'],true):['keyMode'=>'empty','key'=>null];
    if(strlen(genesisE2eeJson($result))>16*1024*1024)throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
    return $result;
}
