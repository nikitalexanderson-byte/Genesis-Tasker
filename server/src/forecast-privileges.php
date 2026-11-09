<?php
declare(strict_types=1);

/** Owner-only testing exception, bound to the current verified primary Google
 * session. A profile email, linked sign-in or administrator label is insufficient. */
function genesisForecastTestingOwner(array $user): bool
{
    return mb_strtolower((string)($user['email']??''))==='nikitalexanderson@gmail.com'
        && function_exists('genesisIsAdminUser') && genesisIsAdminUser($user)
        && function_exists('genesisSessionIsPrimaryGoogleUser') && genesisSessionIsPrimaryGoogleUser($user);
}

function genesisForecastFreeAccess(array $user): bool
{
    return genesisForecastElitePlus($user)||genesisForecastTestingOwner($user);
}

function genesisForecastElitePlus(array $user): bool
{
    return (int)($user['forecast_elite_plus']??0)===1 && ($user['subscription_plan']??'free')==='premium4life';
}

/** Keep the historical storage enum compatible with installed clients; expose one combined manual plan. */
function genesisSubscriptionPlanId(array $user): string
{
    return genesisForecastElitePlus($user)?'elite_plus':(string)($user['subscription_plan']??'free');
}

function genesisAdminSetForecastPrivilege(string $actorId,string $targetId,array $input): array
{
    $actor=genesisFindUser($actorId);
    if(!$actor||!genesisIsAdminUser($actor)||!genesisSessionIsPrimaryGoogleUser($actor))throw new GenesisResourceLimitException(403,'FORBIDDEN');
    if(array_diff(array_keys($input),['enabled','expectedRevision'])||!is_bool($input['enabled']??null)
        ||!is_int($input['expectedRevision']??null)||$input['expectedRevision']<0)
        throw new InvalidArgumentException('FORECAST_PRIVILEGE_INVALID');
    $user=genesisFindUser($targetId);if(!$user)throw new GenesisResourceLimitException(404,'USER_NOT_FOUND');
    if((int)($user['forecast_privilege_revision']??0)!==$input['expectedRevision'])throw new GenesisResourceLimitException(409,'FORECAST_PRIVILEGE_CHANGED');
    require_once __DIR__.'/subscriptions.php';
    $current=genesisSubscriptionPlanId($user);
    $desired=$input['enabled']?'elite_plus':($current==='elite_plus'?'premium4life':$current);
    if($desired!==$current)genesisAdminSetSubscription($actorId,$targetId,$desired,$current,(int)genesisSubscriptionState(genesisDb(),$user)['revision']);
    $saved=genesisFindUser($targetId);
    return ['userId'=>$targetId,'forecastElitePlus'=>genesisForecastElitePlus($saved),'forecastPrivilegeRevision'=>(int)$saved['forecast_privilege_revision']];
}
