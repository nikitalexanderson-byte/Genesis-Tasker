<?php
declare(strict_types=1);
require_once __DIR__.'/e2ee-legacy-page.php';

/** Exact, read-only pages of every retained Physis table. Ordinary helpers prune
 * tombstones/receipts and bootstrap owner state, so must never be called here.
 * A 32 MiB vault is larger than the bridge's one-message limit. Each signed page
 * is fenced to the SAME immutable source; an exhausted page is explicit. */
function genesisE2eeLegacyPhysis(PDO $db,string $actor,array $scope,array $c):array
{
    $queries=[
        'owners'=>['physis_owners','current_cursor,min_cursor,vault_json,vault_revision,key_version',['current_cursor','min_cursor','vault_revision','key_version'],'owner_id'],
        'records'=>['physis_records','id,revision,sequence,envelope_json,updated_at,deleted_at',['revision','sequence'],'id'],
        'usedIds'=>['physis_used_ids','id',[],'id'],
        'receipts'=>['physis_receipts','request_id,payload_hash,response_json,created_at',[],'request_id'],
    ];
    [$result,$context]=genesisE2eeLegacyPersonalPage($db,$actor,$scope,$c,$queries,'owner_id');
    // Only an existing account-v2 wrapper requires the OLD account key. A v1
    // password/recovery vault is independent, not an empty account-key vault.
    if($result['table']==='owners'&&$result['rows']){
        $raw=$result['rows'][0]['vault_json'];
        if($raw!==null){
            try{$vault=json_decode($raw,true,32,JSON_THROW_ON_ERROR);}catch(JsonException){throw new DomainException('E2EE_PHYSIS_SOURCE_INVALID');}
            if(!is_array($vault)||!in_array($vault['version']??null,[1,2],true))throw new DomainException('E2EE_PHYSIS_FORMAT_UNSUPPORTED');
            if($vault['version']===2)$result['legacyKey']=genesisE2eeLegacyAccountKey($context['user'],true);
        }
    }
    if(strlen(genesisE2eeJson($result))>16*1024*1024)throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
    return$result;
}
