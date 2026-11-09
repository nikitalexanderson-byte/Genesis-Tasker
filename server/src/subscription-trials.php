<?php
declare(strict_types=1);
require_once __DIR__.'/subscription-identity.php';
require_once __DIR__.'/resource-limits.php';

const GENESIS_TRIAL_SECONDS = 259200;
const GENESIS_TRIAL_LABELS = ['standart'=>'Trial-Standart','premium'=>'Trial-Premium','business'=>'Trial-Business'];
const GENESIS_TRIAL_RANKS = ['free'=>0,'standart'=>1,'premium'=>2,'business'=>3,'premium4life'=>4];

/** Public policy is independent of configured payment providers. No client selects a clock. */
function genesisTrialDefinition(): array
{
    return ['schemaVersion'=>1,'durationSeconds'=>GENESIS_TRIAL_SECONDS,'maxActivationsPerAccount'=>1,
        'plans'=>GENESIS_TRIAL_LABELS,'automaticCharge'=>false];
}

/** Reuse reviewed canonical Google/Gmail identity normalization, with separate trial semantics. */
function genesisTrialIdentityHashes(PDO $db, array $user): array
{
    $keys=genesisSubscriptionIdentityHashes($user);
    $query=$db->prepare('SELECT google_sub,email,id FROM linked_google_accounts WHERE owner_user_id=?');
    $query->execute([(string)$user['id']]);
    foreach($query->fetchAll() as $identity) $keys=[...$keys,...genesisSubscriptionIdentityHashes($identity)];
    return array_values(array_unique($keys));
}

function genesisTrialClaims(PDO $db, array $keys): array
{
    if($keys===[]) throw new RuntimeException('TRIAL_IDENTITY_UNAVAILABLE');
    $query=$db->prepare('SELECT identity_hash,grant_id,used_at FROM subscription_trial_claims WHERE identity_hash IN ('
        .implode(',',array_fill(0,count($keys),'?')).') ORDER BY used_at,grant_id,identity_hash');
    $query->execute($keys);
    return $query->fetchAll();
}

function genesisTrialRow(PDO $db, string $userId): ?array
{
    $query=$db->prepare('SELECT * FROM subscription_trials WHERE user_id=?');$query->execute([$userId]);
    $row=$query->fetch();
    if(!$row) return null;
    if(!isset(GENESIS_TRIAL_LABELS[$row['plan']]) || (int)$row['starts_at']<=0
        || (int)$row['ends_at']-(int)$row['starts_at']!==GENESIS_TRIAL_SECONDS)
        throw new GenesisResourceLimitException(503,'TRIAL_STATE_UNAVAILABLE');
    return $row;
}

/** A broken/missing identity claim must never become a grant after a key or storage change. */
function genesisTrialAssertGrantClaim(PDO $db, array $user, array $row): void
{
    foreach(genesisTrialClaims($db,genesisSubscriptionIdentityHashes($user)) as $claim)
        if(hash_equals((string)$row['grant_id'],(string)$claim['grant_id'])) return;
    throw new GenesisResourceLimitException(503,'TRIAL_STATE_UNAVAILABLE');
}

function genesisTrialModerated(PDO $db, array $user): bool
{
    $state=genesisSubscriptionState($db,$user);
    return (bool)$state['automatic_grants_blocked'] || genesisSubscriptionRevokedAt($db,$user)!==null;
}

/** Server metadata only. Reading never consumes a trial; caller clock is supplied by trusted PHP. */
function genesisTrialStateForUser(array $user, int $now, ?PDO $db=null): array
{
    $db??=genesisDb();
    $row=genesisTrialRow($db,(string)$user['id']);
    $result=[...genesisTrialDefinition(),'status'=>'ineligible','plan'=>$row['plan']??null,
        'label'=>$row===null?null:GENESIS_TRIAL_LABELS[$row['plan']],
        'startsAt'=>$row===null?null:gmdate('Y-m-d\TH:i:s\Z',(int)$row['starts_at']),
        'endsAt'=>$row===null?null:gmdate('Y-m-d\TH:i:s\Z',(int)$row['ends_at']),
        'serverNow'=>gmdate('Y-m-d\TH:i:s\Z',$now),'eligiblePlans'=>[]];
    // Trial metadata never advertises internal identity hashes or opaque grant identifiers.
    unset($result['plans']);
    if($row!==null) {
        genesisTrialAssertGrantClaim($db,$user,$row);
        $result['status']=$row['revoked_at']!==null || genesisTrialModerated($db,$user) ? 'revoked'
            : ($now>=(int)$row['ends_at'] ? 'expired' : ($now>=(int)$row['starts_at'] ? 'active' : 'ineligible'));
        return $result;
    }
    if(genesisTrialClaims($db,genesisTrialIdentityHashes($db,$user))!==[]) {
        $result['status']='used';return $result;
    }
    if(genesisUserProvider($user)!=='google' || !genesisSessionIsPrimaryGoogleUser($user)
        || genesisTrialModerated($db,$user)) return $result;
    $paid=genesisResolveFeatureAccess($user,genesisFeatureAccessPolicy(),$now);
    $rank=GENESIS_TRIAL_RANKS[$paid['lifetimePremium']?'premium4life':$paid['effectivePlan']];
    $result['eligiblePlans']=array_values(array_filter(array_keys(GENESIS_TRIAL_LABELS),
        static fn(string $plan):bool=>GENESIS_TRIAL_RANKS[$plan]>$rank));
    if($result['eligiblePlans']!==[]) $result['status']='available';
    return $result;
}

/** Pure overlay. Monetary quotes continue using the separate pure PAID resolver unchanged. */
function genesisTrialOverlayAccess(array $user, array $paid, array $trial, array $policy, int $now): array
{
    $base=[...$paid,'source'=>'subscription','trial'=>$trial];
    $paidRank=GENESIS_TRIAL_RANKS[$paid['lifetimePremium']?'premium4life':$paid['effectivePlan']];
    $end=genesisSubscriptionExpiry($trial['endsAt']??null);
    $start=genesisSubscriptionExpiry($trial['startsAt']??null);
    $plan=$trial['plan']??null;
    if(($trial['status']??null)!=='active' || !is_string($plan) || !isset(GENESIS_TRIAL_LABELS[$plan])
        || GENESIS_TRIAL_RANKS[$plan]<=$paidRank || $start===false || $end===false
        || $end-$start!==GENESIS_TRIAL_SECONDS || $now<$start || $now>=$end) return $base;
    $overlay=genesisResolveFeatureAccess([...$user,'subscription_plan'=>$plan,'subscription_valid_until'=>$trial['endsAt']],$policy,$now);
    return [...$overlay,'declaredPlan'=>$paid['declaredPlan'],'source'=>'trial','trial'=>$trial,'paidAccess'=>$paid];
}

function genesisTrialSnapshotForUser(array $user, int $now, ?PDO $db=null): array
{
    $policy=genesisFeatureAccessPolicy();$paid=genesisResolveFeatureAccess($user,$policy,$now);
    $trial=genesisTrialStateForUser($user,$now,$db);
    return ['trial'=>$trial,'featureAccess'=>genesisTrialOverlayAccess($user,$paid,$trial,$policy,$now)];
}

/** Must run within the same writer transaction as link/unlink/delete/revocation.
 * Existing use propagates to newly proved identities; an unused account is never consumed here.
 * Conflicting older claims remain immutable and cannot transfer or extend either original grant.
 */
function genesisTrialPreserveIdentityClaims(PDO $db, array $owner, ?array $linkedIdentity=null, ?int $now=null): void
{
    if(!$db->inTransaction()) throw new RuntimeException('TRIAL_WRITER_TRANSACTION_REQUIRED');
    $keys=genesisTrialIdentityHashes($db,$owner);
    if($linkedIdentity!==null) $keys=array_values(array_unique([...$keys,...genesisSubscriptionIdentityHashes($linkedIdentity)]));
    $row=genesisTrialRow($db,(string)$owner['id']);$claims=genesisTrialClaims($db,$keys);
    if($row===null && $claims===[]) return;
    if($row!==null) genesisTrialAssertGrantClaim($db,$owner,$row);
    $grant=$row['grant_id']??$claims[0]['grant_id'];$usedAt=$row===null?(int)$claims[0]['used_at']:(int)$row['starts_at'];
    $insert=$db->prepare('INSERT INTO subscription_trial_claims(identity_hash,grant_id,used_at) VALUES(?,?,?) ON CONFLICT(identity_hash) DO NOTHING');
    foreach($keys as $key) $insert->execute([$key,$grant,$usedAt]);
}

/** Explicit moderation ends an active trial without refunding its single-use identity claims. */
function genesisTrialRevoke(PDO $db, array $user, int $now): void
{
    genesisTrialPreserveIdentityClaims($db,$user,null,$now);
    $db->prepare('UPDATE subscription_trials SET revoked_at=COALESCE(revoked_at,?) WHERE user_id=?')->execute([$now,$user['id']]);
}

/** HTTP passes no clock override. Optional serverNow is exclusively for isolated service tests. */
function genesisTrialActivate(string $userId, array $input, ?int $serverNow=null): array
{
    if(array_diff(array_keys($input),['plan']) || count($input)!==1 || !is_string($input['plan']??null)
        || !isset(GENESIS_TRIAL_LABELS[$input['plan']])) throw new InvalidArgumentException('TRIAL_REQUEST_INVALID');
    $user=genesisFindUser($userId);
    if(!$user || genesisUserProvider($user)!=='google' || !genesisSessionIsPrimaryGoogleUser($user))
        throw new GenesisResourceLimitException(403,'TRIAL_PRIMARY_GOOGLE_REQUIRED');
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try {
        $user=genesisFindUser($userId);
        if(!$user || genesisUserProvider($user)!=='google' || !genesisSessionIsPrimaryGoogleUser($user))
            throw new GenesisResourceLimitException(403,'TRIAL_PRIMARY_GOOGLE_REQUIRED');
        $now=$serverNow??time();
        if($now<=0 || $now>PHP_INT_MAX-GENESIS_TRIAL_SECONDS) throw new InvalidArgumentException('TRIAL_SERVER_CLOCK_INVALID');
        $row=genesisTrialRow($db,$userId);
        if($row!==null) {
            genesisTrialAssertGrantClaim($db,$user,$row);
            if($row['plan']!==$input['plan']) throw new GenesisResourceLimitException(409,'TRIAL_ALREADY_USED');
        } else {
            $state=genesisTrialStateForUser($user,$now,$db);
            if($state['status']==='used') throw new GenesisResourceLimitException(409,'TRIAL_ALREADY_USED');
            if(genesisTrialModerated($db,$user)) throw new GenesisResourceLimitException(403,'TRIAL_ACCESS_REVOKED');
            if(!in_array($input['plan'],$state['eligiblePlans'],true)) throw new GenesisResourceLimitException(409,'TRIAL_NOT_AN_UPGRADE');
            $grant=genesisUuid();
            $db->prepare('INSERT INTO subscription_trials(user_id,grant_id,plan,starts_at,ends_at) VALUES(?,?,?,?,?)')
                ->execute([$userId,$grant,$input['plan'],$now,$now+GENESIS_TRIAL_SECONDS]);
            $insert=$db->prepare('INSERT INTO subscription_trial_claims(identity_hash,grant_id,used_at) VALUES(?,?,?)');
            foreach(genesisTrialIdentityHashes($db,$user) as $identity) $insert->execute([$identity,$grant,$now]);
        }
        $result=genesisTrialSnapshotForUser($user,$now,$db);
        $db->commit();return $result;
    } catch(Throwable $error) {if($db->inTransaction())$db->rollBack();throw $error;}
}
