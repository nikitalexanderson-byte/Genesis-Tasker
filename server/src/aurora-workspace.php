<?php
declare(strict_types=1);

function genesisAuroraWorkspace(string $userId): ?array
{
    $q=genesisDb()->prepare('SELECT revision,iv,ciphertext,updated_at FROM aurora_workspaces WHERE user_id=?');
    $q->execute([$userId]);$row=$q->fetch();
    return $row?['revision'=>(int)$row['revision'],'iv'=>$row['iv'],'ciphertext'=>$row['ciphertext'],'updatedAt'=>$row['updated_at']]:null;
}

/** Opaque E2EE document. The server receives no dialogue, dreams or intentions. */
function genesisSaveAuroraWorkspace(string $userId,array $input): array
{
    $revision=$input['expectedRevision']??null;$iv=$input['iv']??null;$ciphertext=$input['ciphertext']??null;
    if(array_diff(array_keys($input),['expectedRevision','iv','ciphertext'])||!is_int($revision)||$revision<0||$revision>9007199254740990
        ||!is_string($iv)||strlen($iv)!==16||strlen((string)base64_decode($iv,true))!==12
        ||!is_string($ciphertext)||strlen($ciphertext)<24||strlen($ciphertext)>4_000_000||base64_decode($ciphertext,true)===false)
        throw new InvalidArgumentException('AURORA_ENVELOPE_INVALID');
    $hash=hash('sha256',$revision.':'.$iv.':'.$ciphertext);$db=genesisDb();$owns=!$db->inTransaction();if($owns)genesisBeginWriteTransaction($db);
    try{
        $q=$db->prepare('SELECT revision,payload_hash,updated_at FROM aurora_workspaces WHERE user_id=?');$q->execute([$userId]);$old=$q->fetch();
        if($old&&hash_equals($old['payload_hash'],$hash)){if($owns)$db->commit();return ['revision'=>(int)$old['revision'],'updatedAt'=>$old['updated_at']];}
        if((int)($old['revision']??0)!==$revision)throw new GenesisResourceLimitException(409,'AURORA_REVISION_CONFLICT');
        $next=$revision+1;$now=genesisNow();
        $db->prepare('INSERT INTO aurora_workspaces(user_id,revision,iv,ciphertext,payload_hash,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET revision=excluded.revision,iv=excluded.iv,ciphertext=excluded.ciphertext,payload_hash=excluded.payload_hash,updated_at=excluded.updated_at')
            ->execute([$userId,$next,$iv,$ciphertext,$hash,$now]);
        if($owns)$db->commit();return ['revision'=>$next,'updatedAt'=>$now];
    }catch(Throwable $error){if($owns&&$db->inTransaction())$db->rollBack();throw $error;}
}

/** Bind the locally completed, encrypted solution to one immutable paid result.
 * The deterministic engine runs on the user's device; private context is never
 * sent to a third-party model. A manifest is not a payment entitlement.
 */
function genesisAuroraPrepareResult(string $userId,array $input): array
{
    genesisRequireFeature($userId,'future-modeling');
    if(array_diff(array_keys($input),['id','methodVersion','forecastHashes','contextHash','iv','ciphertext'])
        ||!is_string($input['id']??null)||preg_match('/\A[a-f0-9-]{36}\z/D',$input['id'])!==1
        ||($input['methodVersion']??null)!=='aurora-two-circles-v2'
        ||!is_array($input['forecastHashes']??null)||count($input['forecastHashes'])<1||count($input['forecastHashes'])>5
        ||!is_string($input['contextHash']??null)||preg_match('/\A[a-f0-9]{64}\z/D',$input['contextHash'])!==1
        ||!is_string($input['iv']??null)||strlen($input['iv'])!==16||strlen((string)base64_decode($input['iv'],true))!==12
        ||!is_string($input['ciphertext']??null)||strlen($input['ciphertext'])<24||strlen($input['ciphertext'])>190000||base64_decode($input['ciphertext'],true)===false)
        throw new InvalidArgumentException('AURORA_RESULT_INVALID');
    foreach($input['forecastHashes']as$hash)if(!is_string($hash)||preg_match('/\A[a-f0-9]{64}\z/D',$hash)!==1)throw new InvalidArgumentException('AURORA_RESULT_INVALID');
    require_once __DIR__.'/modeling-service.php';
    genesisModelingPrepareResult($userId,$input['id'],$input['methodVersion'],[
        'kind'=>'aurora-encrypted-solution-v1','forecastHashes'=>$input['forecastHashes'],'contextHash'=>$input['contextHash'],
        'iv'=>$input['iv'],'ciphertext'=>$input['ciphertext']
    ]);
    return ['id'=>$input['id'],'ready'=>true];
}
