<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit(1);
$fixture=sys_get_temp_dir().'/genesis-consumer-referrals-'.bin2hex(random_bytes(8));
mkdir($fixture,0700);mkdir($fixture.'/sessions',0700);
$offers=[];foreach(['standart','premium','business']as$plan)foreach([1,12]as$months)$offers["$plan:$months"]=['products'=>['yookassa'=>"synthetic-$plan-$months"]];
$configuration=['app_url'=>'https://localhost.invalid','db_path'=>$fixture.'/app.sqlite','session_path'=>$fixture.'/sessions',
    'crypto_key'=>base64_encode(random_bytes(32)),'cookie_secure'=>false,'timezone'=>'Europe/Moscow',
    'billing'=>['enabled'=>true,'pending_order_closure_verified'=>true,'offers'=>$offers,
        'providers'=>['yookassa'=>['shop_id'=>'synthetic','secret_key'=>'synthetic','receipt_required'=>false]]]];
file_put_contents($fixture.'/config.php','<?php return '.var_export($configuration,true).';');
define('GENESIS_LOCAL_TEST_CONFIG',$fixture.'/config.php');
foreach(['bootstrap','repository','google','billing-api']as$module)require_once dirname(__DIR__).'/src/'.$module.'.php';
function referralCheck(bool $ok,string $why):void {if(!$ok)throw new RuntimeException($why);}
function referralReject(string $code,callable $run):void {
    try{$run();}catch(GenesisResourceLimitException|DomainException|InvalidArgumentException $e){referralCheck($e->getMessage()===$code,$e->getMessage().' != '.$code);return;}
    throw new RuntimeException('Accepted '.$code);
}
function referralUser(string $sub,?string $invite=null):array {
    return genesisUpsertGoogleUser(['sub'=>$sub,'email'=>$sub.'@example.invalid','email_verified'=>true],[],false,false,null,$invite);
}
function referralSignIn(array $user):void {genesisEstablishGoogleSession(genesisFindUser($user['id']),$user['google_sub']);}
function referralAnonymous():void {$_SESSION=[];unset($_COOKIE['genesis_consumer_referral']);}
function referralPurchase(array $user,string $id,string $at,string $state='paid',int $refund=0):void {
    $db=genesisDb();$q=$db->prepare('SELECT 1 FROM billing_orders WHERE id=?');$q->execute([$id]);
    if(!$q->fetchColumn())$db->prepare('INSERT INTO billing_orders(id,user_id,idempotency_key,provider,plan,period_months,amount_minor,currency,product_id,created_at,updated_at,list_amount_minor) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
        ->execute([$id,$user['id'],$id,'yookassa','standart',12,333000,'RUB','synthetic-standart-12',$at,$at,333000]);
    genesisBillingApplyReceipt($db,new GenesisVerifiedBillingReceipt('yookassa','receipt-'.$id,$id,$state,333000,'RUB','synthetic-standart-12',$at,hash('sha256',$id.$state.$refund),null,$refund),time());
}
$db=genesisDb();$now=time();$month=genesisReferralMonth($now);$next=genesisReferralMonth($now,1);
$previous=(new DateTimeImmutable($month.'-01T12:00:00Z'))->modify('-1 month')->format('Y-m-d\TH:i:s\Z');
$owner=referralUser('referral-owner');$until=genesisBillingPeriodEnd(genesisNow(),1);
$db->prepare("UPDATE users SET subscription_plan='premium',subscription_valid_until=? WHERE id=?")->execute([$until,$owner['id']]);
referralSignIn($owner);$first=genesisReferralCreateCode($owner['id']);$again=genesisReferralCreateCode($owner['id']);
referralCheck($first['code']===$again['code']&&str_starts_with($first['link'],'https://localhost.invalid/?invite=g_'),'Code creation was not idempotent');
referralReject('REFERRAL_NEW_ACCOUNT_ONLY',fn()=>genesisReferralCapture($first['code']));
$users=[];
for($i=0;$i<11;$i++){
    referralAnonymous();genesisReferralCapture($first['code']);$invitation=genesisReferralInvitation();
    // Native requests retain only the session cookie; attribution must also work there.
    unset($_COOKIE['genesis_consumer_referral']);referralCheck(genesisReferralInvitation()!==null,'Native session lost invitation');
    $users[]=referralUser('referral-invitee-'.$i,$invitation['token_hash']);
    genesisReferralFinishOAuth($invitation['token_hash']);referralCheck(genesisReferralInvitation()===null,'Finished login kept its attribution');
}
referralCheck((int)$db->query('SELECT COUNT(*) FROM consumer_referral_links')->fetchColumn()===10,'Registration cap exceeded ten');
referralAnonymous();genesisReferralCapture($first['code']);$invitation=genesisReferralInvitation();
referralUser('referral-owner',$invitation['token_hash']);genesisReferralFinishOAuth($invitation['token_hash']);
referralCheck((int)$db->query('SELECT COUNT(*) FROM consumer_referral_links')->fetchColumn()===10,'Existing login or self-referral was attached');
foreach($users as$i=>$user)referralPurchase($user,'referral-paid-'.$i,$previous);
referralSignIn($owner);$dashboard=genesisReferralDashboard($owner['id']);
referralCheck($dashboard['current']['percent']===100&&$dashboard['current']['firstCount']===10&&$dashboard['canRedeemFreeMonth'],'Ten verified purchases did not earn next-month 100%');
$snapshot=genesisReferralRedeemFreeMonth($owner['id']);$expected=genesisBillingPeriodEnd($until,1);
referralCheck($snapshot===['plan'=>'premium','validUntil'=>$expected],'100% reward lost the existing administrative period');
genesisReferralRedeemFreeMonth($owner['id']);
referralCheck((int)$db->query('SELECT COUNT(*) FROM consumer_referral_grants')->fetchColumn()===1&&(int)$db->query('SELECT COUNT(*) FROM consumer_referral_uses')->fetchColumn()===1,'Free month was spent twice');
referralCheck((int)$db->query('SELECT COUNT(*) FROM billing_receipts')->fetchColumn()===11,'Free month invented a paid receipt');
$rows=genesisReferralRows($db,genesisReferralHash($owner),$now);
referralCheck(genesisReferralDiscount($rows,$next)['percent']===30,'Later recurring reward did not cap at 30%');
referralPurchase($users[0],'referral-paid-0',$previous,'refunded',333000);
$rows=genesisReferralRows($db,genesisReferralHash($owner),$now);
referralCheck(genesisReferralDiscount($rows,$month)['percent']===90&&genesisReferralDiscount($rows,$next)['percent']===27,'Refund did not remove its contribution');
$future=(new DateTimeImmutable($previous))->modify('+13 months')->getTimestamp();
referralCheck(genesisReferralDiscount(genesisReferralRows($db,genesisReferralHash($owner),$future),genesisReferralMonth($future))['percent']===0,'Expired annual access kept contributing');
// New and recurring sources share a 100% cap, but never count one invitee twice.
$pure=[];for($i=0;$i<15;$i++)$pure[]=['invitee_hash'=>'old-'.$i,'first_paid_at'=>'2024-01-01T00:00:00Z','first_payment_valid'=>true,'active_paid'=>true];
for($i=0;$i<8;$i++)$pure[]=['invitee_hash'=>'new-'.$i,'first_paid_at'=>$previous,'first_payment_valid'=>true,'active_paid'=>true];
$discount=genesisReferralDiscount($pure,$month);referralCheck($discount['percent']===100&&$discount['recurringCount']===10&&$discount['firstCount']===8,'Mixed reward caps changed');

// A partial reward buys a full month and is not refundable cash or upgrade credit.
$owner2=referralUser('referral-discount-owner');$db->prepare("UPDATE users SET subscription_plan='premium',subscription_valid_until=? WHERE id=?")->execute([$until,$owner2['id']]);
$ownerHash=genesisReferralHash($owner2);$link=$db->query('SELECT * FROM consumer_referral_links WHERE first_reference_hash IS NOT NULL LIMIT 1 OFFSET 1')->fetch();
$db->prepare('UPDATE consumer_referral_links SET owner_hash=? WHERE invitee_hash=?')->execute([$ownerHash,$link['invitee_hash']]);
referralSignIn($owner2);$definition=genesisBillingDefinition();$definition['checkoutEnabled']=true;
$catalog=genesisBillingCatalog(genesisBillingSettings(),'web',$definition);$offer=array_values(array_filter($catalog['offers'],fn($o)=>$o['id']==='premium:1'))[0];
$offer=genesisBillingProviderOffer($offer,'yookassa');$quote=genesisBillingUpgradeQuote($db,$owner2['id'],$offer,$now);
referralCheck($quote['referralPercent']===10&&$quote['amountMinor']===49950&&$quote['referralDiscountMinor']===5550,'10% monthly quote incorrect');
$annual=[...$offer,'periodMonths'=>12,'amountMinor'=>555000];
referralCheck(genesisBillingUpgradeQuote($db,$owner2['id'],$annual,$now)['referralDiscountMinor']===0,'A one-month discount reduced a whole year');
$checkout=fn($o,$c,$u)=>['checkoutUrl'=>'https://yookassa.ru/synthetic/'.$o['id'],'providerReference'=>'synthetic-'.$o['id']];
$input=['offerId'=>'premium:1','provider'=>'yookassa','client'=>'web','idempotencyKey'=>'synthetic-referral-order','expectedAmountMinor'=>49950,'expectedCurrency'=>'RUB'];
$order=genesisBillingCreateOrder($owner2['id'],$input,$definition,$checkout);
$retry=genesisBillingCreateOrder($owner2['id'],[...$input,'idempotencyKey'=>'synthetic-referral-retry'],$definition,$checkout);
referralCheck($order['id']===$retry['id']&&$order['referralDiscountMinor']===5550,'Reopening checkout spent or dropped the reserved discount');
$at=genesisNow();genesisBillingApplyReceipt($db,new GenesisVerifiedBillingReceipt('yookassa','discounted-receipt',$order['id'],'paid',49950,'RUB','synthetic-premium-1',$at,hash('sha256','synthetic-referral-evidence')),$now);
$period=$db->query('SELECT * FROM billing_periods WHERE user_id='.$db->quote($owner2['id']))->fetch();
referralCheck($period['ends_at']===genesisBillingPeriodEnd($at,1),'A discount shortened the purchased month');
referralCheck(genesisBillingFundedOrderValue($db,$order['id'])===49950,'A promotional discount became refundable cash');
referralCheck(genesisBillingUpgradeQuote($db,$owner2['id'],$offer,$now)['referralDiscountMinor']===0,'Used discount became available again');
$db->prepare("UPDATE users SET subscription_valid_until=? WHERE id=?")->execute([gmdate('Y-m-d\TH:i:s\Z',$now-1),$owner2['id']]);
referralReject('REFERRAL_PREMIUM_REQUIRED',fn()=>genesisReferralDashboard($owner2['id']));
echo "Consumer referrals: PASS (registration-only attribution, cap 10, verified purchases, 10% then 3%, annual coverage/expiry/refund, 30%/100% caps, idempotent reward/order, full duration, no invented money)\n";
