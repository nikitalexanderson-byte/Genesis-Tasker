<?php
declare(strict_types=1);

const GENESIS_PLAN_GUIDANCE_INTERVAL = 3 * 86400;
const GENESIS_PLAN_GUIDANCE_TOPICS = ['projects','habits','mindmaps','diary','dreams','overview'];

function genesisPlanGuidanceStamp(int $now): string { return gmdate('Y-m-d\TH:i:s\Z',$now); }
function genesisPlanGuidanceEligible(array $user): bool
{
    $access=genesisFeatureAccessForUser($user);
    return ($access['enforcementEnabled']??false)===true && ($access['effectivePlan']??null)==='free'
        && ($access['source']??'')!=='trial' && !genesisEmailRegistrationStatus($user)['required'];
}

function genesisPlanGuidanceEnsure(PDO $db,string $userId,int $now): array
{
    $db->prepare('INSERT INTO plan_guidance_state(user_id,updated_at) VALUES(?,?) ON CONFLICT(user_id) DO NOTHING')
        ->execute([$userId,genesisPlanGuidanceStamp($now)]);
    $q=$db->prepare('SELECT * FROM plan_guidance_state WHERE user_id=?');$q->execute([$userId]);
    $row=$q->fetch();$q->closeCursor();return $row;
}

/** Called before recording foreground presence, never by a worker or an ordinary sync.
 * The previous activity is server-owned; refreshes do not manufacture new returns. */
function genesisPlanGuidanceObserve(PDO $db,string $userId,string $previousActivity,?string $visitHash,int $now): void
{
    $previous=strtotime($previousActivity);
    if($visitHash===null||$previous===false||$previous>$now||$now-$previous<GENESIS_PLAN_GUIDANCE_INTERVAL)return;
    genesisPlanGuidanceEnsure($db,$userId,$now);
    $db->prepare('UPDATE plan_guidance_state SET return_visit_hash=?,updated_at=? WHERE user_id=?')
        ->execute([$visitHash,genesisPlanGuidanceStamp($now),$userId]);
}

function genesisPlanGuidanceNotice(mixed $json): ?array
{
    if(!is_string($json))return null;
    $notice=json_decode($json,true);
    return is_array($notice)&&($notice['schemaVersion']??null)===1&&is_string($notice['id']??null)
        &&in_array($notice['topic']??null,GENESIS_PLAN_GUIDANCE_TOPICS,true)?$notice:null;
}

/** A short global lease stops web/Android/two tabs from opening the same automatic tip.
 * Only acknowledgement of a visible tip starts the 72-hour interval. */
function genesisPlanGuidanceClaim(string $userId,array $payload,?int $at=null): array
{
    $now=$at??time();$topic=$payload['topic']??'overview';$reason=$payload['reason']??'scheduled';
    if(array_diff(array_keys($payload),['topic','reason','resource','feature'])
        ||!in_array($topic,GENESIS_PLAN_GUIDANCE_TOPICS,true)||!in_array($reason,['scheduled','quota','feature'],true))
        throw new InvalidArgumentException('PLAN_GUIDANCE_REQUEST_INVALID');
    $resource=$payload['resource']??null;$feature=$payload['feature']??null;
    if(($resource!==null&&(!is_string($resource)||!in_array($resource,['personal-projects','habits','mindmaps','diary','shared-projects','shared-mindmaps','advice'],true)))
        ||($feature!==null&&(!is_string($feature)||!preg_match('/\A[a-z][a-z0-9-]{0,63}\z/D',$feature))))
        throw new InvalidArgumentException('PLAN_GUIDANCE_REQUEST_INVALID');
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        $user=genesisFindUser($userId);if(!$user)throw new DomainException('AUTH_REQUIRED');
        if(!genesisPlanGuidanceEligible($user)){$db->commit();return ['show'=>false,'eligible'=>false,'nextAt'=>null,'serverNow'=>genesisPlanGuidanceStamp($now)];}
        $state=genesisPlanGuidanceEnsure($db,$userId,$now);
        $shown=$state['last_shown_at']===null?null:strtotime($state['last_shown_at']);
        $next=$shown===null?null:genesisPlanGuidanceStamp($shown+GENESIS_PLAN_GUIDANCE_INTERVAL);
        $return=$state['return_visit_hash']!==null&&$state['return_visit_hash']!==$state['last_return_notice_hash'];
        $contextual=$reason!=='scheduled';
        if((!$contextual&&$shown!==null&&$now<$shown+GENESIS_PLAN_GUIDANCE_INTERVAL)
            ||(!$contextual&&$state['lease_until']!==null&&strtotime($state['lease_until'])>$now)){
            $db->commit();return ['show'=>false,'eligible'=>true,'nextAt'=>$next,'serverNow'=>genesisPlanGuidanceStamp($now)];
        }
        // Context is the section being used. Generic sections rotate through real plan benefits.
        if($topic==='overview')$topic=GENESIS_PLAN_GUIDANCE_TOPICS[(int)$state['rotation']%count(GENESIS_PLAN_GUIDANCE_TOPICS)];
        $notice=['schemaVersion'=>1,'id'=>bin2hex(random_bytes(16)),'topic'=>$topic,
            'reason'=>$contextual?$reason:($return?'return':'scheduled'),'createdAt'=>genesisPlanGuidanceStamp($now)];
        if($resource!==null)$notice['resource']=$resource;if($feature!==null)$notice['feature']=$feature;
        $token=bin2hex(random_bytes(24));$leaseUntil=genesisPlanGuidanceStamp($now+120);
        $lease=['notice'=>$notice,'returnHash'=>$state['return_visit_hash']];
        $db->prepare('UPDATE plan_guidance_state SET lease_token=?,lease_until=?,lease_json=?,updated_at=? WHERE user_id=?')
            ->execute([hash('sha256',$token),$leaseUntil,json_encode($lease,JSON_THROW_ON_ERROR),genesisPlanGuidanceStamp($now),$userId]);
        $db->commit();return ['show'=>true,'eligible'=>true,'notice'=>$notice,'token'=>$token,'leaseUntil'=>$leaseUntil,'nextAt'=>$next,'serverNow'=>genesisPlanGuidanceStamp($now)];
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}

function genesisPlanGuidanceAcknowledge(string $userId,string $token,?int $at=null): array
{
    if(!preg_match('/\A[a-f0-9]{48}\z/D',$token))throw new InvalidArgumentException('PLAN_GUIDANCE_TOKEN_INVALID');
    $now=$at??time();$db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        $user=genesisFindUser($userId);if(!$user)throw new DomainException('AUTH_REQUIRED');
        $q=$db->prepare('SELECT * FROM plan_guidance_state WHERE user_id=?');$q->execute([$userId]);$state=$q->fetch();$q->closeCursor();
        if(!$state||!genesisPlanGuidanceEligible($user)||!is_string($state['lease_token'])
            ||!hash_equals($state['lease_token'],hash('sha256',$token))){
            $db->commit();return ['ok'=>false,'notice'=>null];
        }
        if($state['lease_json']===null&&$state['lease_until']===null){
            $notice=genesisPlanGuidanceNotice($state['notice_json']);$db->commit();return ['ok'=>$notice!==null,'notice'=>$notice,
                'nextAt'=>$notice===null?null:genesisPlanGuidanceStamp(strtotime($notice['createdAt'])+GENESIS_PLAN_GUIDANCE_INTERVAL)];
        }
        if(strtotime($state['lease_until']??'')<=$now){$db->commit();return ['ok'=>false,'notice'=>null];}
        $lease=json_decode($state['lease_json'],true,512,JSON_THROW_ON_ERROR);$notice=$lease['notice'];
        $notice['createdAt']=genesisPlanGuidanceStamp($now);
        $scheduled=in_array($notice['reason'],['scheduled','return'],true);
        $db->prepare('UPDATE plan_guidance_state SET last_shown_at=?,
            last_return_notice_hash=CASE WHEN ? THEN ? ELSE last_return_notice_hash END,
            rotation=rotation+?,lease_until=NULL,lease_json=NULL,notice_json=?,read_at=NULL,updated_at=? WHERE user_id=?')
            ->execute([genesisPlanGuidanceStamp($now),$scheduled?1:0,$lease['returnHash'],$scheduled?1:0,
                json_encode($notice,JSON_THROW_ON_ERROR),genesisPlanGuidanceStamp($now),$userId]);
        // Keep only a hash for safe idempotent retry of this acknowledgement.
        $db->commit();return ['ok'=>true,'notice'=>$notice,'nextAt'=>genesisPlanGuidanceStamp($now+GENESIS_PLAN_GUIDANCE_INTERVAL)];
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}

/** A client that could not actually show a notice releases only its own current lease. */
function genesisPlanGuidanceRelease(string $userId,string $token): array
{
    if(!preg_match('/\A[a-f0-9]{48}\z/D',$token))throw new InvalidArgumentException('PLAN_GUIDANCE_TOKEN_INVALID');
    $db=genesisDb();
    $db->prepare('UPDATE plan_guidance_state SET lease_token=NULL,lease_until=NULL,lease_json=NULL,updated_at=?
        WHERE user_id=? AND lease_token=? AND lease_json IS NOT NULL')
        ->execute([genesisPlanGuidanceStamp(time()),$userId,hash('sha256',$token)]);
    return ['ok'=>true];
}

function genesisPlanGuidanceLatest(string $userId): array
{
    $user=genesisFindUser($userId);if(!$user)throw new DomainException('AUTH_REQUIRED');
    if(!genesisPlanGuidanceEligible($user))return ['notice'=>null];
    $q=genesisDb()->prepare('SELECT notice_json,read_at FROM plan_guidance_state WHERE user_id=?');$q->execute([$userId]);$row=$q->fetch();$q->closeCursor();
    return ['notice'=>$row&&$row['read_at']===null?genesisPlanGuidanceNotice($row['notice_json']):null];
}

function genesisPlanGuidanceRead(string $userId,string $noticeId): array
{
    if(!preg_match('/\A[a-f0-9]{32}\z/D',$noticeId))throw new InvalidArgumentException('PLAN_GUIDANCE_NOTICE_INVALID');
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        $q=$db->prepare('SELECT notice_json FROM plan_guidance_state WHERE user_id=?');$q->execute([$userId]);$row=$q->fetch();$q->closeCursor();
        $notice=$row?genesisPlanGuidanceNotice($row['notice_json']):null;
        if($notice&&hash_equals($notice['id'],$noticeId))$db->prepare('UPDATE plan_guidance_state SET read_at=? WHERE user_id=?')->execute([genesisPlanGuidanceStamp(time()),$userId]);
        $db->commit();return ['ok'=>true];
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}
