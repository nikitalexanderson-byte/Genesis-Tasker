<?php
declare(strict_types=1);
require_once __DIR__.'/billing-gateways.php';

function genesisPlayTestingConfiguration(): array
{
    $settings=genesisBillingSettings();$testing=$settings['play_testing']??[];
    if (($testing['enabled']??false)!==true || !is_int($testing['cloud_project_number']??null) || $testing['cloud_project_number']<=0
        || !is_array($testing['version_codes']??null) || !$testing['version_codes'] || !is_array($testing['certificate_sha256']??null)
        || !$testing['certificate_sha256'] || !genesisBillingProviderReady('google-play',$settings)) throw new GenesisResourceLimitException(503,'PLAY_TESTING_NOT_CONFIGURED');
    return $testing;
}

function genesisPlayTestingChallenge(string $userId,array $input): array
{
    $configuration=genesisPlayTestingConfiguration();$version=$input['versionCode']??null;
    $user=genesisFindUser($userId);
    if (!$user || !genesisSessionOwnsGoogleAccount($user)) throw new GenesisResourceLimitException(403,'FORBIDDEN');
    if (!is_int($version) || !in_array($version,$configuration['version_codes'],true)) throw new GenesisResourceLimitException(403,'PLAY_TEST_VERSION_REQUIRED');
    $state=genesisSubscriptionState(genesisDb(),$user);
    if ($state['automatic_grants_blocked'] || genesisSubscriptionRevokedAt(genesisDb(),$user)!==null) throw new GenesisResourceLimitException(403,'PLAY_TEST_ACCESS_REVOKED');
    $now=genesisNow();$id=genesisUuid();$hash=rtrim(strtr(base64_encode(random_bytes(32)),'+/','-_'),'=');
    genesisDb()->prepare('DELETE FROM billing_play_challenges WHERE user_id=? AND expires_at<?')->execute([$userId,$now]);
    $q=genesisDb()->prepare('SELECT COUNT(*) FROM billing_play_challenges WHERE user_id=? AND consumed_at IS NULL');$q->execute([$userId]);
    if ((int)$q->fetchColumn()>=5) throw new GenesisResourceLimitException(429,'PLAY_TEST_CHALLENGE_LIMIT');
    genesisDb()->prepare('INSERT INTO billing_play_challenges(id,user_id,request_hash,version_code,created_at,expires_at) VALUES(?,?,?,?,?,?)')
        ->execute([$id,$userId,$hash,$version,$now,gmdate('Y-m-d\TH:i:s\Z',time()+180)]);
    return ['id'=>$id,'requestHash'=>$hash,'cloudProjectNumber'=>$configuration['cloud_project_number']];
}

/** Only the payload returned by Google's authenticated decodeIntegrityToken endpoint is accepted. */
function genesisPlayTestingValidate(array $payload,array $challenge,array $configuration,int $now): void
{
    $request=$payload['requestDetails']??[];$app=$payload['appIntegrity']??[];
    $millis=$request['timestampMillis']??null;$stamp=is_string($millis)&&ctype_digit($millis)?intdiv((int)$millis,1000):0;
    $certificates=$app['certificateSha256Digest']??[];
    if (($request['requestPackageName']??null)!=='ru.genesis.calendar' || ($app['packageName']??null)!=='ru.genesis.calendar'
        || ($request['requestHash']??null)!==$challenge['request_hash'] || $stamp<$now-180 || $stamp>$now+30
        || $stamp<strtotime($challenge['created_at'])-5 || ($app['appRecognitionVerdict']??null)!=='PLAY_RECOGNIZED'
        || ($payload['accountDetails']['appLicensingVerdict']??null)!=='LICENSED'
        || !in_array((int)($app['versionCode']??0),$configuration['version_codes'],true)
        || (int)($app['versionCode']??0)!==(int)$challenge['version_code'] || !is_array($certificates)
        || !array_intersect($certificates,$configuration['certificate_sha256'])) throw new GenesisResourceLimitException(403,'PLAY_TEST_INTEGRITY_REJECTED');
}

/** The grant and one-use challenge receipt are committed together; no paid place is consumed. */
function genesisPlayTestingApply(PDO $db,array $user,string $challengeId,array $verified,array $configuration,int $now): array
{
    $owns=!$db->inTransaction();if($owns)genesisBeginWriteTransaction($db);
    try {
        $q=$db->prepare('SELECT * FROM billing_play_challenges WHERE id=? AND user_id=?');$q->execute([$challengeId,$user['id']]);$challenge=$q->fetch();
        if (!$challenge || $challenge['consumed_at']!==null || strtotime($challenge['expires_at'])<=$now) throw new GenesisResourceLimitException(409,'PLAY_TEST_CHALLENGE_EXPIRED');
        $state=genesisSubscriptionState($db,$user);
        if ($state['automatic_grants_blocked'] || genesisSubscriptionRevokedAt($db,$user)!==null) throw new GenesisResourceLimitException(403,'PLAY_TEST_ACCESS_REVOKED');
        genesisPlayTestingValidate($verified,$challenge,$configuration,$now);
        $stamp=gmdate('Y-m-d\TH:i:s\Z',$now);
        $db->prepare('INSERT OR IGNORE INTO subscription_lifetime_grants(id,user_id,source,granted_at,evidence_hash,previous_plan,previous_valid_until) VALUES(?,?,\'play-testing\',?,?,?,?)')
            ->execute(['play-testing:'.$user['id'],$user['id'],$stamp,hash('sha256',json_encode($verified,JSON_THROW_ON_ERROR)),$user['subscription_plan'],$user['subscription_valid_until']]);
        $db->prepare("UPDATE users SET subscription_plan='premium4life',subscription_valid_until=NULL WHERE id=?")->execute([$user['id']]);
        $db->prepare('UPDATE billing_play_challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL')->execute([$stamp,$challengeId]);
        $db->prepare('INSERT INTO subscription_access_state(user_id,revision,materialized_billing) VALUES(?,1,0) ON CONFLICT(user_id) DO UPDATE SET revision=revision+1,materialized_billing=0')->execute([$user['id']]);
        if($owns)$db->commit();return ['plan'=>'premium4life','validUntil'=>null];
    }catch(Throwable $e){if($owns&&$db->inTransaction())$db->rollBack();throw $e;}
}

function genesisPlayTestingClaim(string $userId,array $input): array
{
    $configuration=genesisPlayTestingConfiguration();$user=genesisFindUser($userId);
    if (!$user || !genesisSessionOwnsGoogleAccount($user)) throw new GenesisResourceLimitException(403,'FORBIDDEN');
    $token=$input['integrityToken']??null;$id=$input['challengeId']??null;
    if (!is_string($token)||strlen($token)>100000||strlen($token)<20||!is_string($id)||strlen($id)>100)throw new InvalidArgumentException('PLAY_TEST_CLAIM_INVALID');
    $access=genesisBillingGoogleAccessToken(genesisBillingSettings()['providers']['google-play']);
    $decoded=genesisBillingHttp('POST','https://playintegrity.googleapis.com/v1/ru.genesis.calendar:decodeIntegrityToken',['integrityToken'=>$token],['Authorization: Bearer '.$access]);
    return genesisPlayTestingApply(genesisDb(),$user,$id,$decoded['tokenPayloadExternal']??[],$configuration,time());
}
