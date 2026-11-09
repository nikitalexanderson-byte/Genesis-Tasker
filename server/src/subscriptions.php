<?php
declare(strict_types=1);

const GENESIS_SUBSCRIPTION_PLANS = ['free', 'standart', 'premium', 'business', 'premium4life', 'elite_plus'];

// Primary-admin assignment only. Premium4Life permanently includes every product capability;
// ordinary plan labels are metadata until a verified expiry is recorded.
// Plans never grant administrative or project roles.
function genesisAdminSetSubscription(string $actorId, string $targetId, string $plan, string $expectedPlan, ?int $expectedRevision = null): array
{
    $actor = genesisFindUser($actorId) ?? [];
    genesisRequireAdmin($actor);
    // Linked identities can open the owner's workspace, but cannot issue permanent grants.
    if (!genesisSessionIsPrimaryGoogleUser($actor)) genesisJson(['error' => 'FORBIDDEN'], 403);
    if (!in_array($plan, GENESIS_SUBSCRIPTION_PLANS, true)
        || !in_array($expectedPlan, GENESIS_SUBSCRIPTION_PLANS, true)) {
        throw new InvalidArgumentException('INVALID_SUBSCRIPTION_PLAN');
    }
    $target = genesisFindUser($targetId);
    if ($target === null) throw new DomainException('SUBSCRIPTION_USER_NOT_FOUND');
    if (genesisSubscriptionPlanId($target) !== $expectedPlan) throw new DomainException('SUBSCRIPTION_STATUS_CONFLICT');
    if ($plan === 'free') {
        if ($expectedRevision === null) throw new InvalidArgumentException('SUBSCRIPTION_REVISION_REQUIRED');
        return genesisAdminResetSubscription($actorId, $targetId, $expectedPlan, $expectedRevision);
    }
    $db = genesisDb(); genesisBeginWriteTransaction($db);
    try {
        $target = genesisFindUser($targetId);
        if ($target === null) throw new DomainException('SUBSCRIPTION_USER_NOT_FOUND');
        $state = genesisSubscriptionState($db, $target);
        if (genesisSubscriptionPlanId($target) !== $expectedPlan
            || ($expectedRevision !== null && (int)$state['revision'] !== $expectedRevision))
            throw new GenesisResourceLimitException(409, 'SUBSCRIPTION_STATUS_CONFLICT');
        $db->prepare('UPDATE users SET subscription_plan=?, subscription_valid_until=?, updated_at=? WHERE id=?')
            ->execute([$plan==='elite_plus'?'premium4life':$plan, in_array($plan,['premium4life','elite_plus'],true)?null:'9999-12-31T23:59:59Z', genesisNow(), $targetId]);
        $enabled=$plan==='elite_plus';
        if((int)($target['forecast_elite_plus']??0)!==(int)$enabled){
            $privilegeRevision=(int)($target['forecast_privilege_revision']??0)+1;
            $db->prepare('UPDATE users SET forecast_elite_plus=?,forecast_privilege_revision=? WHERE id=?')->execute([(int)$enabled,$privilegeRevision,$targetId]);
            $db->prepare('INSERT INTO forecast_privilege_events VALUES(?,?,?,?,?,?)')->execute([genesisUuid(),$targetId,$actorId,(int)$enabled,$privilegeRevision,genesisNow()]);
        }
        $db->prepare('INSERT INTO subscription_access_state(user_id,revision,materialized_billing) VALUES(?,1,0)
            ON CONFLICT(user_id) DO UPDATE SET revision=revision+1,materialized_billing=0')->execute([$targetId]);
        $db->commit();
        return ['userId'=>$targetId, 'subscriptionPlan'=>$plan, 'subscriptionRevision'=>(int)$state['revision']+1];
    } catch (Throwable $error) { if ($db->inTransaction()) $db->rollBack(); throw $error; }
}

/** An explicit moderation action. Never triggered by a client profile or payment callback. */
function genesisAdminResetSubscription(string $actorId, string $targetId, string $expectedPlan, int $expectedRevision): array
{
    $actor = genesisFindUser($actorId) ?? []; genesisRequireAdmin($actor);
    if (!genesisSessionIsPrimaryGoogleUser($actor)) genesisJson(['error'=>'FORBIDDEN'],403);
    $db = genesisDb(); genesisBeginWriteTransaction($db);
    try {
        $target = genesisFindUser($targetId);
        if (!$target) throw new DomainException('SUBSCRIPTION_USER_NOT_FOUND');
        $state = genesisSubscriptionState($db,$target);
        if (genesisSubscriptionPlanId($target) !== $expectedPlan || (int)$state['revision'] !== $expectedRevision)
            throw new GenesisResourceLimitException(409,'SUBSCRIPTION_STATUS_CONFLICT');
        genesisSubscriptionRevoke($db,$target,genesisNow());
        if((int)($target['forecast_elite_plus']??0)===1)$db->prepare('INSERT INTO forecast_privilege_events VALUES(?,?,?,?,?,?)')
            ->execute([genesisUuid(),$targetId,$actorId,0,(int)$target['forecast_privilege_revision']+1,genesisNow()]);
        $db->commit();
        return ['userId'=>$targetId,'subscriptionPlan'=>'free','subscriptionRevision'=>$expectedRevision+1];
    } catch (Throwable $error) { if ($db->inTransaction()) $db->rollBack(); throw $error; }
}
