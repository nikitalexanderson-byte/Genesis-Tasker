<?php
declare(strict_types=1);

/** The current server entitlement controls cadence; request fields cannot set it. */
function genesisSupportNoticeCadence(array $user): string
{
    if(genesisForecastElitePlus($user)||($user['subscription_plan']??'')==='premium4life')return 'monthly';
    return match(genesisFeatureAccessForUser($user)['effectivePlan']){
        'standart'=>'weekly','premium','business'=>'monthly',default=>'daily'
    };
}
function genesisSupportNoticeNext(string $cadence,int $now): string
{
    $date=(new DateTimeImmutable('@'.$now))->setTimezone(new DateTimeZone('UTC'));
    if($cadence==='monthly'){
        $month=$date->modify('first day of next month');
        $date=$month->setDate((int)$month->format('Y'),(int)$month->format('m'),min((int)$date->format('d'),(int)$month->format('t')));
    }else{$date=$date->modify($cadence==='weekly'?'+7 days':'+1 day');}
    return $date->format('Y-m-d\TH:i:s\Z');
}
function genesisSupportNoticeClaim(string $userId,string $surface): array
{
    if(!in_array($surface,['web','android','phone'],true))throw new InvalidArgumentException('SUPPORT_NOTICE_SURFACE_INVALID');
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        $user=genesisFindUser($userId);if(!$user)throw new DomainException('AUTH_REQUIRED');
        $cadence=genesisSupportNoticeCadence($user);$now=time();
        $q=$db->prepare('SELECT shown_at FROM support_notices WHERE user_id=? AND surface=?');$q->execute([$userId,$surface]);$shown=$q->fetchColumn();$q->closeCursor();
        $due=$shown===false||strtotime(genesisSupportNoticeNext($cadence,strtotime($shown)))<=$now;
        $next=genesisSupportNoticeNext($cadence,$due?$now:strtotime($shown));
        if($due)$db->prepare('INSERT INTO support_notices(user_id,surface,shown_at,next_at) VALUES(?,?,?,?) ON CONFLICT(user_id,surface) DO UPDATE SET shown_at=excluded.shown_at,next_at=excluded.next_at')
            ->execute([$userId,$surface,gmdate('Y-m-d\TH:i:s\Z',$now),$next]);
        $db->commit();return ['show'=>$due,'nextAt'=>$next,'cadence'=>$cadence];
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}
