<?php
declare(strict_types=1);
require_once __DIR__.'/e2ee-membership-atomic-contract.php';

/** A staging signature authorizes only immutable technical storage. It never
 * permits an ACL write, a product commit, an owner rotation or a trust grant. */
function genesisMembershipAtomicAuthorization(PDO $db,string $actor,mixed $packet,string $action,array $payload,bool $fresh=true):array
{
    $packet=genesisE2eeExactFields($packet,['command','signature']);$command=genesisE2eeCommand($packet['command']);$scope=genesisE2eeScope($actor,$command['scopeId']);
    if($scope['kind']!=='personal'||$scope['owner_id']!==$actor||$scope['resource_id']!==$actor||$scope['state']!=='active'
        ||$command['ownerId']!==$actor||$command['action']!==$action)throw new DomainException('E2EE_SCOPE_BINDING_MISMATCH');
    $device=genesisE2eeRow($db,'SELECT * FROM e2ee_devices WHERE scope_id=? AND device_id=?',[$scope['scope_id'],$command['deviceId']]);
    if(!$device||$device['revoked']||$device['user_id']!==$actor||$device['role']!=='owner')throw new DomainException('E2EE_REVOKED_DEVICE');
    genesisE2eeVerifyCommand($packet,$device['signing_key']);
    if($fresh&&($command['securityEpoch']!==(int)$scope['security_epoch']||$command['expectedRevision']!==(int)$scope['directory_revision']
        ||$command['checkpointHash']!==$scope['checkpoint_hash']))throw new DomainException('E2EE_STALE_EPOCH');
    if(!hash_equals(genesisMembershipAtomicDigest($command['payload']),genesisMembershipAtomicDigest($payload)))throw new DomainException('E2EE_CONTEXT_MISMATCH');
    return ['scope'=>$scope,'command'=>$command];
}
function genesisMembershipAtomicNotCancelled(PDO $db,string $actor,string $intent):void
{
    if(genesisE2eeRow($db,'SELECT intent_id FROM e2ee_membership_atomic_cancellations WHERE actor_id=? AND intent_id=?',[$actor,$intent]))throw new DomainException('E2EE_MEMBERSHIP_CANCELLED');
}
function genesisMembershipAtomicStoredPlan(PDO $db,string $actor,string $intent,string $hash,string $personalScope):array
{
    $row=genesisE2eeRow($db,'SELECT * FROM e2ee_membership_atomic_plans WHERE actor_id=? AND intent_id=?',[$actor,$intent]);
    if(!$row)throw new DomainException('E2EE_MEMBERSHIP_PLAN_REQUIRED');
    if(!hash_equals($row['plan_hash'],$hash)||$row['personal_scope_id']!==$personalScope)throw new DomainException('E2EE_IDEMPOTENCY_CONFLICT');
    return $row;
}
/** Verify complete persisted originals one page at a time. A hash-only status
 * response does not establish that these pages form a complete manifest. */
function genesisMembershipAtomicCompletePages(PDO $db,string $actor,string $intent,string $phase,array $refs):void
{
    $q=$db->prepare('SELECT page_index,kind,item_count,page_hash,payload_json FROM e2ee_membership_atomic_pages WHERE actor_id=? AND intent_id=? AND phase=? ORDER BY page_index');
    $q->execute([$actor,$intent,$phase]);$index=0;
    try{
        while($row=$q->fetch()){
            if(!isset($refs[$index])||(int)$row['page_index']!==$index)throw new DomainException('E2EE_MEMBERSHIP_PAGE_INCOMPLETE');
            $page=genesisMembershipAtomicPage(json_decode($row['payload_json'],true,64,JSON_THROW_ON_ERROR));$ref=genesisMembershipAtomicPageRef($index,$page);
            if($row['page_hash']!==$ref['pageHash']||$row['kind']!==$ref['kind']||(int)$row['item_count']!==$ref['count']
                ||!hash_equals(genesisMembershipAtomicDigest($ref),genesisMembershipAtomicDigest($refs[$index])))throw new DomainException('E2EE_CONTEXT_MISMATCH');
            $index++;
        }
        if($index!==count($refs))throw new DomainException('E2EE_MEMBERSHIP_PAGE_INCOMPLETE');
    }finally{$q->closeCursor();}
}
/** Freeze the exact packet-page set under the same writer as page upload and
 * cancellation. This is storage-only: no uploaded signature is executed here. */
function genesisMembershipAtomicSeal(string $actor,array $input):array
{
    genesisE2eeExactFields($input,['intentId','planHash','packetPages','authorization']);$intent=genesisE2eeIdentifier($input['intentId']);$hash=$input['planHash'];genesisE2eeDecode($hash,32);
    $refs=genesisMembershipAtomicRefs($input['packetPages'],true);if(!$refs)throw new InvalidArgumentException('E2EE_MEMBERSHIP_ATOMIC_INVALID');
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        $stored=genesisE2eeRow($db,'SELECT * FROM e2ee_membership_atomic_plans WHERE actor_id=? AND intent_id=?',[$actor,$intent]);
        if(!$stored)throw new DomainException('E2EE_MEMBERSHIP_PLAN_REQUIRED');$plan=genesisMembershipAtomicPlan(json_decode($stored['manifest_json'],true,64,JSON_THROW_ON_ERROR));$batch=genesisMembershipAtomicBatchHash($plan,$refs);
        $authorized=genesisMembershipAtomicAuthorization($db,$actor,$input['authorization'],'membership-atomic-seal',['intentId'=>$intent,'planHash'=>$hash,'batchHash'=>$batch]);
        genesisMembershipAtomicNotCancelled($db,$actor,$intent);genesisMembershipAtomicStoredPlan($db,$actor,$intent,$hash,$authorized['scope']['scope_id']);
        $old=genesisE2eeRow($db,'SELECT * FROM e2ee_membership_atomic_packet_manifests WHERE actor_id=? AND intent_id=?',[$actor,$intent]);
        if($old&&($old['plan_hash']!==$hash||!hash_equals($old['batch_hash'],$batch)))throw new DomainException('E2EE_IDEMPOTENCY_CONFLICT');
        if($stored['state']!=='staged')throw new DomainException('E2EE_MEMBERSHIP_OUTCOME_REVIEW_REQUIRED');
        if(!$old){
            genesisMembershipAtomicCompletePages($db,$actor,$intent,'plan',$plan['pages']);genesisMembershipAtomicCompletePages($db,$actor,$intent,'packets',$refs);
            $db->prepare('INSERT INTO e2ee_membership_atomic_packet_manifests(actor_id,intent_id,plan_hash,batch_hash,manifest_json,created_at) VALUES(?,?,?,?,?,?)')
                ->execute([$actor,$intent,$hash,$batch,genesisE2eeJson($refs),genesisNow()]);
        }
        $db->commit();return ['intentId'=>$intent,'planHash'=>$hash,'batchHash'=>$batch,'state'=>'sealed'];
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}
function genesisMembershipAtomicBegin(string $actor,array $input):array
{
    genesisE2eeExactFields($input,['plan','authorization']);$plan=genesisMembershipAtomicPlan($input['plan']);
    if($plan['actorId']!==$actor)throw new DomainException('E2EE_SCOPE_BINDING_MISMATCH');$hash=genesisMembershipAtomicDigest($plan);$intent=$plan['intentId'];
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        $authorized=genesisMembershipAtomicAuthorization($db,$actor,$input['authorization'],'membership-atomic-begin',['intentId'=>$intent,'planHash'=>$hash]);
        genesisMembershipAtomicNotCancelled($db,$actor,$intent);
        $existing=genesisE2eeRow($db,'SELECT * FROM e2ee_membership_atomic_plans WHERE actor_id=? AND intent_id=?',[$actor,$intent]);
        if($existing){
            if(!hash_equals($existing['plan_hash'],$hash)||$existing['personal_scope_id']!==$authorized['scope']['scope_id'])throw new DomainException('E2EE_IDEMPOTENCY_CONFLICT');
        }else{
            $now=genesisNow();$db->prepare('INSERT INTO e2ee_membership_atomic_plans(actor_id,intent_id,personal_scope_id,plan_hash,manifest_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
                ->execute([$actor,$intent,$authorized['scope']['scope_id'],$hash,genesisE2eeJson($plan),$now,$now]);
        }
        $db->commit();return ['intentId'=>$intent,'planHash'=>$hash,'state'=>$existing?$existing['state']:'staged'];
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}
function genesisMembershipAtomicStagePage(string $actor,array $input):array
{
    genesisE2eeExactFields($input,['intentId','planHash','phase','index','page','authorization']);$intent=genesisE2eeIdentifier($input['intentId']);$hash=$input['planHash'];genesisE2eeDecode($hash,32);
    $phase=$input['phase'];$index=genesisMembershipAtomicInteger($input['index']);
    if(!in_array($phase,['plan','packets'],true)||$index>=10000)throw new InvalidArgumentException('E2EE_MEMBERSHIP_ATOMIC_INVALID');
    $page=genesisMembershipAtomicPage($input['page']);$ref=genesisMembershipAtomicPageRef($index,$page);
    if(!in_array($page['kind'],$phase==='plan'?GENESIS_MEMBERSHIP_PLAN_KINDS:GENESIS_MEMBERSHIP_PACKET_KINDS,true))throw new InvalidArgumentException('E2EE_MEMBERSHIP_ATOMIC_INVALID');
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        $authorized=genesisMembershipAtomicAuthorization($db,$actor,$input['authorization'],'membership-atomic-page',[
            'intentId'=>$intent,'planHash'=>$hash,'phase'=>$phase,'index'=>$index,'pageHash'=>$ref['pageHash']]);
        genesisMembershipAtomicNotCancelled($db,$actor,$intent);$stored=genesisMembershipAtomicStoredPlan($db,$actor,$intent,$hash,$authorized['scope']['scope_id']);
        if($stored['state']!=='staged')throw new DomainException('E2EE_MEMBERSHIP_PLAN_LOCKED');
        $manifest=genesisMembershipAtomicPlan(json_decode($stored['manifest_json'],true,64,JSON_THROW_ON_ERROR));
        if($phase==='plan'&&(!isset($manifest['pages'][$index])||!hash_equals(genesisMembershipAtomicDigest($manifest['pages'][$index]),genesisMembershipAtomicDigest($ref))))throw new DomainException('E2EE_CONTEXT_MISMATCH');
        $old=genesisE2eeRow($db,'SELECT page_hash FROM e2ee_membership_atomic_pages WHERE actor_id=? AND intent_id=? AND phase=? AND page_index=?',[$actor,$intent,$phase,$index]);
        if($old){if(!hash_equals($old['page_hash'],$ref['pageHash']))throw new DomainException('E2EE_MEMBERSHIP_PAGE_IMMUTABLE');}
        else $db->prepare('INSERT INTO e2ee_membership_atomic_pages(actor_id,intent_id,phase,page_index,kind,item_count,page_hash,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
            ->execute([$actor,$intent,$phase,$index,$ref['kind'],$ref['count'],$ref['pageHash'],genesisE2eeJson($page),genesisNow()]);
        $db->commit();return ['intentId'=>$intent,'planHash'=>$hash,'phase'=>$phase,'page'=>$ref];
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}
/** Bounded status pages return hashes/counts only. No uploaded signed command,
 * decrypted draft, device key or ciphertext is exposed through status. */
function genesisMembershipAtomicStatus(string $actor,array $input):array
{
    genesisE2eeExactFields($input,['intentId','planHash','phase','after','authorization']);$intent=genesisE2eeIdentifier($input['intentId']);$hash=$input['planHash'];genesisE2eeDecode($hash,32);
    $phase=$input['phase'];$after=genesisMembershipAtomicInteger($input['after']);if(!in_array($phase,['plan','packets'],true)||$after>10000)throw new InvalidArgumentException('E2EE_MEMBERSHIP_ATOMIC_INVALID');
    $db=genesisDb();$db->beginTransaction();
    try{
        $authorized=genesisMembershipAtomicAuthorization($db,$actor,$input['authorization'],'membership-atomic-status',['intentId'=>$intent,'planHash'=>$hash,'phase'=>$phase,'after'=>$after]);
        $cancelled=genesisE2eeRow($db,'SELECT plan_hash FROM e2ee_membership_atomic_cancellations WHERE actor_id=? AND intent_id=?',[$actor,$intent]);
        if($cancelled){if(!hash_equals($cancelled['plan_hash'],$hash))throw new DomainException('E2EE_IDEMPOTENCY_CONFLICT');$db->commit();return ['intentId'=>$intent,'planHash'=>$hash,'state'=>'cancelled','pages'=>[],'next'=>null];}
        $stored=genesisMembershipAtomicStoredPlan($db,$actor,$intent,$hash,$authorized['scope']['scope_id']);
        $q=$db->prepare('SELECT page_index,kind,item_count,page_hash FROM e2ee_membership_atomic_pages WHERE actor_id=? AND intent_id=? AND phase=? AND page_index>=? ORDER BY page_index LIMIT 201');
        $q->execute([$actor,$intent,$phase,$after]);$rows=$q->fetchAll();$q->closeCursor();$more=count($rows)>200;$rows=array_slice($rows,0,200);
        $pages=array_map(static fn($row)=>['index'=>(int)$row['page_index'],'kind'=>$row['kind'],'count'=>(int)$row['item_count'],'pageHash'=>$row['page_hash']],$rows);
        $result=['intentId'=>$intent,'planHash'=>$hash,'state'=>$stored['state'],'pages'=>$pages,'next'=>$more?end($pages)['index']+1:null];$db->commit();return $result;
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}
/** Cancellation and eventual final application use the same SQLite writer.
 * The tombstone also covers a begin/page request which arrives late. */
function genesisMembershipAtomicCancel(string $actor,array $input):array
{
    genesisE2eeExactFields($input,['intentId','planHash','authorization']);$intent=genesisE2eeIdentifier($input['intentId']);$hash=$input['planHash'];genesisE2eeDecode($hash,32);
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        $authorized=genesisMembershipAtomicAuthorization($db,$actor,$input['authorization'],'membership-atomic-cancel',['intentId'=>$intent,'planHash'=>$hash]);
        $stored=genesisE2eeRow($db,'SELECT * FROM e2ee_membership_atomic_plans WHERE actor_id=? AND intent_id=?',[$actor,$intent]);
        if($stored&&(!hash_equals($stored['plan_hash'],$hash)||$stored['personal_scope_id']!==$authorized['scope']['scope_id']))throw new DomainException('E2EE_IDEMPOTENCY_CONFLICT');
        if($stored&&$stored['state']==='committed'){$result=json_decode($stored['result_json'],true,512,JSON_THROW_ON_ERROR);$db->commit();return ['intentId'=>$intent,'planHash'=>$hash,'state'=>'committed','result'=>$result];}
        $old=genesisE2eeRow($db,'SELECT plan_hash FROM e2ee_membership_atomic_cancellations WHERE actor_id=? AND intent_id=?',[$actor,$intent]);
        if($old&&!hash_equals($old['plan_hash'],$hash))throw new DomainException('E2EE_IDEMPOTENCY_CONFLICT');
        if(!$old)$db->prepare('INSERT INTO e2ee_membership_atomic_cancellations(actor_id,intent_id,plan_hash,personal_scope_id,device_id,created_at) VALUES(?,?,?,?,?,?)')
            ->execute([$actor,$intent,$hash,$authorized['scope']['scope_id'],$authorized['command']['deviceId'],genesisNow()]);
        if($stored)$db->prepare("UPDATE e2ee_membership_atomic_plans SET state='cancelled',updated_at=? WHERE actor_id=? AND intent_id=? AND state='staged'")->execute([genesisNow(),$actor,$intent]);
        $db->commit();return ['intentId'=>$intent,'planHash'=>$hash,'state'=>'cancelled'];
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}
