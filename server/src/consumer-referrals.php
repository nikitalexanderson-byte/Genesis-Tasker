<?php
declare(strict_types=1);

function genesisReferralsSchemaReady(PDO $db): bool
{
    return $db->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='consumer_referral_links'")->fetchColumn()!==false;
}

function genesisReferralMonth(int $now,int $offset=0): string
{
    $date=(new DateTimeImmutable('@'.$now))->setTimezone(new DateTimeZone((string)(genesisConfig()['timezone']??'Europe/Moscow')));
    return $date->modify('first day of this month')->modify(($offset>=0?'+':'').$offset.' months')->format('Y-m');
}
function genesisReferralHash(array $user): string { return genesisSubscriptionIdentityHashes($user)[0]; }
function genesisReferralEligible(array $user,int $now): bool
{
    $plan=$user['subscription_plan']??'free';
    $expiry=genesisSubscriptionExpiry($user['subscription_valid_until']??null);
    return $plan==='premium4life'||in_array($plan,['premium','business'],true)&&$expiry!==false&&$expiry>$now;
}
function genesisReferralRequireUser(string $userId,int $now): array
{
    $user=genesisFindUser($userId);
    if(!$user||!genesisSessionIsPrimaryGoogleUser($user))throw new GenesisResourceLimitException(403,'REFERRAL_PRIMARY_GOOGLE_REQUIRED');
    if(!genesisReferralEligible($user,$now))throw new GenesisResourceLimitException(403,'REFERRAL_PREMIUM_REQUIRED');
    $q=genesisDb()->prepare('SELECT 1 FROM partners WHERE user_id=? AND panel_enabled=1');$q->execute([$userId]);
    if($q->fetchColumn())throw new GenesisResourceLimitException(409,'REFERRAL_PRIVATE_PARTNER_PROGRAM');
    return $user;
}

/** One invitee contributes either its initial 10%, or a later active 3%, never both. */
function genesisReferralDiscount(array $rows,string $month): array
{
    $initial=[];$recurring=[];
    foreach($rows as $row){
        if(!is_string($row['first_paid_at']??null)||!($row['first_payment_valid']??false))continue;
        $first=genesisReferralMonth((int)strtotime($row['first_paid_at']));
        $reward=(new DateTimeImmutable($first.'-01'))->modify('+1 month')->format('Y-m');
        if($reward===$month)$initial[]=$row['invitee_hash'];
        elseif($reward<$month&&($row['active_paid']??false))$recurring[]=$row['invitee_hash'];
    }
    sort($initial);sort($recurring);$initial=array_values(array_unique($initial));$recurring=array_slice(array_values(array_unique($recurring)),0,10);
    return ['month'=>$month,'firstCount'=>min(10,count($initial)),'recurringCount'=>count($recurring),
        'percent'=>min(100,min(10,count($initial))*10+count($recurring)*3),
        'basis'=>['first'=>array_slice($initial,0,10),'recurring'=>$recurring]];
}

function genesisReferralRows(PDO $db,string $owner,int $now): array
{
    $q=$db->prepare("SELECT l.*,
        EXISTS(SELECT 1 FROM billing_receipts r WHERE r.provider=l.first_provider AND r.reference_hash=l.first_reference_hash
            AND r.state='paid' AND r.refunded_amount_minor=0) AS first_payment_valid,
        (EXISTS(SELECT 1 FROM billing_periods p JOIN billing_receipts r ON r.provider=p.provider AND r.reference_hash=p.reference_hash
            WHERE p.user_id=l.invitee_user_id AND p.starts_at<=? AND p.ends_at>? AND r.state='paid' AND r.refunded_amount_minor=0
            AND NOT EXISTS(SELECT 1 FROM subscription_access_state s JOIN billing_orders o ON o.id=r.order_id WHERE s.user_id=p.user_id AND s.receipts_after IS NOT NULL AND (r.confirmed_at<=s.receipts_after OR o.created_at<=s.receipts_after)))
         OR EXISTS(SELECT 1 FROM billing_orders o JOIN billing_receipts r ON r.order_id=o.id
            WHERE o.user_id=l.invitee_user_id AND o.plan='premium4life' AND r.state='paid' AND r.refunded_amount_minor=0
            AND NOT EXISTS(SELECT 1 FROM subscription_access_state s WHERE s.user_id=o.user_id AND s.receipts_after IS NOT NULL AND (r.confirmed_at<=s.receipts_after OR o.created_at<=s.receipts_after)))) AS active_paid
        FROM consumer_referral_links l WHERE l.owner_hash=? ORDER BY l.registered_at,l.invitee_hash");
    $stamp=gmdate('Y-m-d\TH:i:s\Z',$now);$q->execute([$stamp,$stamp,$owner]);$rows=$q->fetchAll();
    foreach($rows as &$row){$row['first_payment_valid']=(bool)$row['first_payment_valid'];$row['active_paid']=(bool)$row['active_paid'];}unset($row);
    return $rows;
}

function genesisReferralDashboard(string $userId,?int $now=null): array
{
    $now??=time();$user=genesisReferralRequireUser($userId,$now);$db=genesisDb();$owner=genesisReferralHash($user);
    $q=$db->prepare('SELECT code FROM consumer_referral_codes WHERE owner_hash=? AND user_id=?');$q->execute([$owner,$userId]);$code=$q->fetchColumn();
    $rows=genesisReferralRows($db,$owner,$now);$month=genesisReferralMonth($now);$next=genesisReferralMonth($now,1);
    $current=genesisReferralDiscount($rows,$month);$future=genesisReferralDiscount($rows,$next);
    $uses=$db->prepare('SELECT status FROM consumer_referral_uses WHERE owner_hash=? AND reward_month=?');$uses->execute([$owner,$month]);$used=$uses->fetchColumn();
    unset($current['basis'],$future['basis']);
    return ['code'=>$code?:null,'link'=>$code?rtrim(genesisConfig()['app_url'],'/').'/?invite='.rawurlencode($code):null,
        'month'=>$month,'nextMonth'=>$next,'registeredThisMonth'=>count(array_filter($rows,static fn($r)=>$r['registered_month']===$month)),
        'monthlyLimit'=>10,'current'=>$current,'next'=>$future,'used'=>$used!==false,'reserved'=>$used==='reserved',
        'canRedeemFreeMonth'=>$current['percent']===100&&$used===false&&$user['subscription_plan']!=='premium4life'];
}

function genesisReferralCreateCode(string $userId): array
{
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        $user=genesisReferralRequireUser($userId,time());
        $owner=genesisReferralHash($user);$q=$db->prepare('SELECT code FROM consumer_referral_codes WHERE owner_hash=?');$q->execute([$owner]);
        if(!$q->fetchColumn())$db->prepare('INSERT INTO consumer_referral_codes VALUES(?,?,?,?)')->execute([$owner,$userId,'g_'.bin2hex(random_bytes(10)),genesisNow()]);
        $db->commit();return genesisReferralDashboard($userId);
    }catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
}

function genesisReferralInvitation(?string $token=null): ?array
{
    $token??=$_COOKIE['genesis_consumer_referral']??$_SESSION['consumer_referral_token']??null;
    if(!is_string($token)||preg_match('/\A[a-f0-9]{64}\z/D',$token)!==1)return null;
    $q=genesisDb()->prepare('SELECT i.*,c.user_id FROM consumer_referral_invites i JOIN consumer_referral_codes c ON c.owner_hash=i.owner_hash WHERE i.token_hash=? AND i.consumed_at IS NULL AND i.expires_at>?');
    $q->execute([hash('sha256',$token),genesisNow()]);return $q->fetch()?:null;
}
function genesisReferralCapture(string $code): array
{
    if(genesisCurrentUserId()!==null)throw new GenesisResourceLimitException(409,'REFERRAL_NEW_ACCOUNT_ONLY');
    if(preg_match('/\Ag_[a-f0-9]{20}\z/D',$code)!==1)throw new InvalidArgumentException('REFERRAL_CODE_INVALID');
    $q=genesisDb()->prepare('SELECT * FROM consumer_referral_codes WHERE code=?');$q->execute([$code]);$row=$q->fetch();
    if(!$row)throw new GenesisResourceLimitException(404,'REFERRAL_CODE_UNAVAILABLE');
    genesisReferralRequireUserForInvitation($row['user_id']);
    if(genesisReferralInvitation())return ['accepted'=>true];
    genesisDb()->prepare('DELETE FROM consumer_referral_invites WHERE expires_at<=? OR consumed_at IS NOT NULL')->execute([genesisNow()]);
    $token=bin2hex(random_bytes(32));$expires=gmdate('Y-m-d\TH:i:s\Z',time()+30*86400);
    genesisDb()->prepare('INSERT INTO consumer_referral_invites(token_hash,owner_hash,created_at,expires_at) VALUES(?,?,?,?)')->execute([hash('sha256',$token),$row['owner_hash'],genesisNow(),$expires]);
    setcookie('genesis_consumer_referral',$token,['expires'=>time()+30*86400,'path'=>'/','secure'=>(genesisConfig()['cookie_secure']??true)===true,'httponly'=>true,'samesite'=>'Lax']);
    $_COOKIE['genesis_consumer_referral']=$token;$_SESSION['consumer_referral_token']=$token;return ['accepted'=>true];
}
function genesisReferralRequireUserForInvitation(string $userId): void
{
    $user=genesisFindUser($userId);if(!$user||!genesisReferralEligible($user,time()))throw new GenesisResourceLimitException(404,'REFERRAL_CODE_UNAVAILABLE');
    $q=genesisDb()->prepare('SELECT 1 FROM partners WHERE user_id=? AND panel_enabled=1');$q->execute([$userId]);
    if($q->fetchColumn())throw new GenesisResourceLimitException(404,'REFERRAL_CODE_UNAVAILABLE');
}

/** Consume completed authentication attempts, including existing-account logins. */
function genesisReferralFinishOAuth(?string $hash): void
{
    unset($_SESSION['consumer_referral_token']);
    if($hash)genesisDb()->prepare('UPDATE consumer_referral_invites SET consumed_at=COALESCE(consumed_at,?) WHERE token_hash=?')->execute([genesisNow(),$hash]);
    if(isset($_COOKIE['genesis_consumer_referral'])){
        setcookie('genesis_consumer_referral','',['expires'=>1,'path'=>'/','secure'=>(genesisConfig()['cookie_secure']??true)===true,'httponly'=>true,'samesite'=>'Lax']);
        unset($_COOKIE['genesis_consumer_referral']);
    }
}

/** Registration attribution is permanent and never attaches to an existing account login. */
function genesisReferralBindRegistration(PDO $db,string $userId,?string $tokenHash,?int $now=null): void
{
    if(!$tokenHash)return;$now??=time();$stamp=gmdate('Y-m-d\TH:i:s\Z',$now);
    if(!$db->inTransaction())throw new LogicException('REFERRAL_REGISTRATION_TRANSACTION_REQUIRED');
    $q=$db->prepare('SELECT i.*,c.user_id AS owner_user_id FROM consumer_referral_invites i JOIN consumer_referral_codes c ON c.owner_hash=i.owner_hash WHERE i.token_hash=? AND i.consumed_at IS NULL AND i.expires_at>?');
    $q->execute([$tokenHash,$stamp]);$invite=$q->fetch();if(!$invite)return;
    $db->prepare('UPDATE consumer_referral_invites SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL')->execute([$stamp,$tokenHash]);
    $user=genesisFindUser($userId);$owner=genesisFindUser($invite['owner_user_id']);
    if(!$user||!$owner||!genesisReferralEligible($owner,$now))return;$identity=genesisReferralHash($user);
    $q=$db->prepare('SELECT 1 FROM partners WHERE user_id=? AND panel_enabled=1');$q->execute([$owner['id']]);if($q->fetchColumn())return;
    if(hash_equals($invite['owner_hash'],$identity))return;
    $q=$db->prepare('SELECT 1 FROM partner_clients WHERE user_id=? AND ended_at IS NULL');$q->execute([$userId]);if($q->fetchColumn())return;
    $month=genesisReferralMonth($now);$q=$db->prepare('SELECT COUNT(*) FROM consumer_referral_links WHERE owner_hash=? AND registered_month=?');$q->execute([$invite['owner_hash'],$month]);
    if((int)$q->fetchColumn()>=10)return;
    $db->prepare('INSERT OR IGNORE INTO consumer_referral_links(invitee_hash,owner_hash,invitee_user_id,registered_month,registered_at) VALUES(?,?,?,?,?)')->execute([$identity,$invite['owner_hash'],$userId,$month,$stamp]);
}

/** Runs in the verified-payment transaction. No signup, trial, local selector or redirect qualifies. */
function genesisReferralObserveReceipt(PDO $db,array $order,GenesisVerifiedBillingReceipt $receipt): void
{
    if(!genesisReferralsSchemaReady($db))return;
    if($receipt->state==='cancelled')$db->prepare("DELETE FROM consumer_referral_uses WHERE order_id=? AND status='reserved'")->execute([$order['id']]);
    elseif(in_array($receipt->state,['paid','refunded'],true))$db->prepare("UPDATE consumer_referral_uses SET status='used' WHERE order_id=?")->execute([$order['id']]);
    if($receipt->state!=='paid'||$receipt->amountMinor<=0||$receipt->refundedAmountMinor>0||!in_array($order['plan'],['standart','premium','business','premium4life'],true))return;
    $db->prepare('UPDATE consumer_referral_links SET first_paid_at=?,first_provider=?,first_reference_hash=? WHERE invitee_user_id=? AND first_paid_at IS NULL')
        ->execute([$receipt->confirmedAt,$receipt->provider,hash('sha256',$receipt->reference),$order['user_id']]);
    $db->prepare("UPDATE consumer_referral_uses SET status='used' WHERE order_id=?")->execute([$order['id']]);
}

function genesisReferralApplyQuote(PDO $db,string $userId,array $quote,int $now): array
{
    $quote['referralDiscountMinor']=0;$quote['referralPercent']=0;$quote['referralMonth']=null;
    if(!genesisReferralsSchemaReady($db))return $quote;
    if(isset($quote['pendingOrderId'])){
        $q=$db->prepare('SELECT referral_discount_minor,referral_reward_month FROM billing_orders WHERE id=? AND user_id=?');$q->execute([$quote['pendingOrderId'],$userId]);$order=$q->fetch();
        if($order){$quote['referralDiscountMinor']=(int)$order['referral_discount_minor'];$quote['referralMonth']=$order['referral_reward_month'];}
        return $quote;
    }
    $q=$db->prepare('SELECT * FROM users WHERE id=?');$q->execute([$userId]);$user=$q->fetch();
    if(!$user||!genesisReferralEligible($user,$now)||$quote['periodMonths']!==1||($quote['creditMinor']??0)>0||($quote['upgradeUnavailableReason']??null)!==null||($quote['provider']??null)!=='yookassa')return $quote;
    $q=$db->prepare('SELECT 1 FROM partners WHERE user_id=? AND panel_enabled=1');$q->execute([$userId]);if($q->fetchColumn())return $quote;
    $owner=genesisReferralHash($user);$month=genesisReferralMonth($now);
    $q=$db->prepare('SELECT 1 FROM consumer_referral_uses WHERE owner_hash=? AND reward_month=?');$q->execute([$owner,$month]);if($q->fetchColumn())return $quote;
    $discount=genesisReferralDiscount(genesisReferralRows($db,$owner,$now),$month);
    if($discount['percent']===0)return $quote;
    $minor=intdiv($quote['listAmountMinor']*$discount['percent'],100);
    $quote['amountMinor']-=$minor;$quote['referralDiscountMinor']=$minor;$quote['referralPercent']=$discount['percent'];$quote['referralMonth']=$month;
    if($quote['amountMinor']===0){$quote['availableProviders']=[];$quote['referralFreeMonthAvailable']=true;}
    return $quote;
}

/** Reservations share the billing writer lock: a monthly reward cannot fund two concurrent orders. */
function genesisReferralReserve(PDO $db,array $user,array $quote,string $orderId,int $now): void
{
    if(($quote['referralDiscountMinor']??0)<=0)return;
    $owner=genesisReferralHash($user);$month=$quote['referralMonth'];
    $discount=genesisReferralDiscount(genesisReferralRows($db,$owner,$now),$month);
    $db->prepare("INSERT INTO consumer_referral_uses VALUES(?,?,?,NULL,?,'reserved',?,?)")->execute([$owner,$month,$orderId,$discount['percent'],json_encode($discount['basis'],JSON_THROW_ON_ERROR),gmdate('Y-m-d\TH:i:s\Z',$now)]);
    $db->prepare('UPDATE billing_orders SET referral_discount_minor=?,referral_reward_month=? WHERE id=?')->execute([$quote['referralDiscountMinor'],$month,$orderId]);
}

/** A 100% reward creates an auditable non-cash month, never a forged payment receipt. */
function genesisReferralRedeemFreeMonth(string $userId): array
{
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        $now=time();$user=genesisReferralRequireUser($userId,$now);
        if($user['subscription_plan']==='premium4life')throw new DomainException('REFERRAL_NO_MONTHLY_RENEWAL');
        $owner=genesisReferralHash($user);$month=genesisReferralMonth($now);$q=$db->prepare('SELECT g.* FROM consumer_referral_grants g WHERE g.user_id=? AND g.reward_month=?');$q->execute([$userId,$month]);
        if($old=$q->fetch()){$db->commit();return ['plan'=>$old['plan'],'validUntil'=>$old['ends_at']];}
        $discount=genesisReferralDiscount(genesisReferralRows($db,$owner,$now),$month);
        if($discount['percent']!==100)throw new DomainException('REFERRAL_FREE_MONTH_UNAVAILABLE');
        $q=$db->prepare('SELECT 1 FROM consumer_referral_uses WHERE owner_hash=? AND reward_month=?');$q->execute([$owner,$month]);if($q->fetchColumn())throw new DomainException('REFERRAL_REWARD_USED');
        $start=gmdate('Y-m-d\TH:i:s\Z',max($now,genesisSubscriptionExpiry($user['subscription_valid_until']??null)?:$now));$end=genesisBillingPeriodEnd($start,1);$id=genesisUuid();
        // Preserve a timed administrative entitlement when first materializing its extension.
        if(!(bool)genesisSubscriptionState($db,$user)['materialized_billing'])$start=gmdate('Y-m-d\TH:i:s\Z',$now);
        $db->prepare('INSERT INTO consumer_referral_grants VALUES(?,?,?,?,?,?)')->execute([$id,$userId,$month,$user['subscription_plan'],$start,$end]);
        $db->prepare("INSERT INTO consumer_referral_uses VALUES(?,?,NULL,?,100,'used',?,?)")->execute([$owner,$month,$id,json_encode($discount['basis'],JSON_THROW_ON_ERROR),genesisNow()]);
        $snapshot=genesisBillingRefreshEntitlement($db,$userId,$now);$db->commit();return $snapshot;
    }catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
}
