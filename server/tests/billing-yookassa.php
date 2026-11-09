<?php
declare(strict_types=1);
// Real order/recovery/receipt functions with an in-memory migrated SQLite and controlled transport.
if(PHP_SAPI!=='cli')exit(1);
function genesisDb(): PDO{return $GLOBALS['yooDb'];}
function genesisConfig(): array{return $GLOBALS['yooConfig'];}
function genesisNow(): string{return gmdate('Y-m-d\TH:i:s\Z');}
function genesisUuid(): string{static $n=0;return '00000000-0000-4000-8000-'.str_pad((string)++$n,12,'0',STR_PAD_LEFT);}
function genesisFindUser(string $id): ?array{$q=genesisDb()->prepare('SELECT * FROM users WHERE id=?');$q->execute([$id]);return $q->fetch()?:null;}
function genesisSessionIsPrimaryGoogleUser(array $user): bool{return true;}
function genesisIdentifierHash(string $ns,string $value): string{return hash_hmac('sha256',$ns."\0".$value,'yoo-synthetic-only');}
function genesisSharedContentEncrypt(string $value): string{return 'encrypted:'.base64_encode($value);}
function genesisSharedContentDecrypt(string $value): string{return base64_decode(substr($value,10),true);}
require dirname(__DIR__).'/src/feature-access.php';
require_once dirname(__DIR__).'/src/resource-limits.php';
require dirname(__DIR__).'/src/billing-api.php';
function yooCheck(bool $condition,string $message): void{if(!$condition)throw new RuntimeException($message);}
function yooReject(callable $action): void{try{$action();}catch(LogicException|GenesisResourceLimitException){return;}throw new RuntimeException('Expected rejection');}
$db=new PDO('sqlite::memory:',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
$GLOBALS['yooDb']=$db;
$db->exec("PRAGMA foreign_keys=ON;CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,google_sub TEXT,auth_provider TEXT,subscription_plan TEXT,subscription_valid_until TEXT);
    INSERT INTO users VALUES('buyer','buyer@example.invalid','buyer','google','free',NULL),('other','other@example.invalid','other','google','free',NULL)");
foreach(['093_billing_infrastructure','096_billing_upgrade_credit','099_billing_refund_amount','100_billing_settlement','101_billing_pending_order_deletion_guard','104_subscription_trials','105_billing_yookassa_recovery','110_modeling_service']as$name)
    $db->exec(file_get_contents(dirname(__DIR__).'/migrations/'.$name.'.sql'));
$private=['schema_version'=>1,'verified'=>true,'enabled'=>true,'shop_id'=>'1105773','secret_key'=>'live_synthetic_key_not_real','receipt_mode'=>'npd-manual'];
$settings=genesisBillingYooPrivateSettings([], $private);
$GLOBALS['yooConfig']=['app_url'=>'https://genesiscalendar.com','billing'=>$settings];
$configuration=$settings['providers']['yookassa'];$now=time();
// Pre-3.1.8 readiness required vat_code unconditionally. Reverted code must still verify outstanding payments.
foreach(['shop_id','secret_key','vat_code']as$legacyKey)yooCheck(trim((string)($configuration[$legacyKey]??''))!=='','Rollback lost provider verification readiness');
yooCheck($configuration['receipt_required']===false&&!isset(genesisBillingYooCheckoutBody(['id'=>'npd-rollback','plan'=>'premium','amount_minor'=>55500,'currency'=>'RUB'],$configuration,'https://genesiscalendar.com')['receipt']),'Compatibility VAT metadata leaked into an NPD receipt');
foreach(['web','android','android-play']as$client){
    $catalog=genesisBillingCatalog($settings,$client);
    foreach($catalog['offers']as$offer)yooCheck($offer['availableProviders']===($client==='android-play'?[]:['yookassa']),'Private launch exposed wrong platform/provider');
    yooCheck(!str_contains(json_encode($catalog),'live_synthetic')&&!isset($catalog['yookassa_live_verified']),'Catalog leaked private state');
}
foreach(['enabled'=>false,'verified'=>false,'secret_key'=>'test_invalid','receipt_mode'=>'unknown']as$key=>$value)
    yooCheck(!genesisBillingCatalog(genesisBillingYooPrivateSettings([],[...$private,$key=>$value]))['checkoutEnabled'],'Invalid/unreviewed private config activated sales');
$foreign=[...$settings,'providers'=>[...$settings['providers'],'lemon-squeezy'=>['api_key'=>'synthetic','store_id'=>'1','webhook_secret'=>'synthetic','currency'=>'USD','tax_inclusive'=>true,'gross_total_verified'=>true]]];
yooCheck(!array_column(genesisBillingCatalog($foreign)['providers'],'available','id')['lemon-squeezy'],'Yoo-only activation enabled another provider');
function yooOrder(string $id,string $plan='premium',int $months=1,int $amount=55500): array{
    $db=genesisDb();$stamp=genesisNow();
    $db->prepare('INSERT INTO billing_orders(id,user_id,idempotency_key,provider,plan,period_months,amount_minor,currency,product_id,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)')->execute([$id,'buyer',$id,'yookassa',$plan,$months,$amount,'RUB','genesis-'.$plan,$stamp,$stamp]);
    return genesisBillingOrder($db,$id);
}
function yooPayment(array $order,string $status='pending',?int $at=null): array{
    $payment=['id'=>'provider-'.$order['id'],'test'=>false,'recipient'=>['account_id'=>'1105773'],'status'=>$status,'paid'=>$status==='succeeded',
        'metadata'=>['genesis_order_id'=>$order['id']],'amount'=>['value'=>sprintf('%d.%02d',intdiv((int)$order['amount_minor'],100),(int)$order['amount_minor']%100),'currency'=>'RUB'],
        'created_at'=>gmdate('Y-m-d\TH:i:s\Z',$at??time()),'confirmation'=>['confirmation_url'=>'https://yoomoney.ru/checkout/'.$order['id']]];
    if($status==='succeeded')$payment['captured_at']=$payment['created_at'];return $payment;
}
// Approved RUB amounts, period and NPD mode survive the real immutable request and provider binding.
$expected=['standart:1'=>33300,'standart:12'=>333000,'premium:1'=>55500,'premium:12'=>555000,'business:1'=>77700,'business:12'=>777000,'premium4life:0'=>1290000];
$webOffers=array_column(genesisBillingCatalog($settings,'web')['offers'],null,'id');
foreach($expected as$key=>$amount){
    [$plan,$months]=explode(':',$key);$order=yooOrder('matrix-'.str_replace(':','-',$key),$plan,(int)$months,$amount);
    $row=genesisBillingYooPrepare($db,$order,$configuration,'https://genesiscalendar.com/?billingOrder='.$order['id'],$now);
    $http=static function($method,$url,$body,$headers,$basic)use($order,$configuration,$db):array{
        yooCheck(!$db->inTransaction()&&$method==='POST'&&$url==='https://api.yookassa.ru/v3/payments','Wrong transport/transaction boundary');
        yooCheck(!isset($body['receipt'],$body['save_payment_method'])&&$body['capture']===true,'NPD checkout invented fiscal fields or recurring billing');
        yooCheck($body['metadata']['genesis_order_id']===$order['id']&&$headers===['Idempotence-Key: '.$order['id']],'Checkout identity changed');
        yooCheck($body['amount']===yooPayment($order)['amount']&&$basic===$configuration['shop_id'].':'.$configuration['secret_key'],'Wrong approved amount or credentials');
        return yooPayment($order);
    };
    $result=genesisBillingYooReconcile($db,$order,$configuration,$http,$now,true);
    yooCheck($result['status']==='pending'&&$result['provider_secret']==='provider-'.$order['id'],'Pending payment was not bound');
    // Returning without payment, then reopening the public comparison must resume this same order.
    $offer=genesisBillingProviderOffer($webOffers[$key],'yookassa');
    $quote=genesisBillingPublicQuote(genesisBillingUpgradeQuote($db,'buyer',$offer,$now+1));
    yooCheck($quote['pendingOrderId']===$order['id']&&$quote['creditMinor']===0
        &&$quote['amountMinor']===$amount&&$quote['availableProviders']===['yookassa']
        &&$quote['upgradeUnavailableReason']===null,'Ordinary pending checkout was blocked as a credit upgrade');
    // Actual credit remains closed, including discounted Lifetime authorizations.
    $discounted=genesisBillingPendingUpgradeQuote($offer,[...$result,'upgrade_credit_minor'=>100]);
    yooCheck($discounted['availableProviders']===[]
        &&$discounted['upgradeUnavailableReason']===($months==='0'?'lifetime-credit-unavailable':'credit-checkout-unavailable'),'Credit safety gate was weakened');
}
yooCheck((int)$db->query('SELECT COUNT(*) FROM billing_receipts')->fetchColumn()===0,'Pending payment granted access');
// Ambiguous network result: body/key remain byte-for-byte stable, even if return URL/config change.
$order=yooOrder('lost-response');$row=genesisBillingYooPrepare($db,$order,$configuration,'https://genesiscalendar.com/?first',$now);$requests=[];
$http=static function($method,$url,$body,$headers)use(&$requests,$order):array{
    $requests[]=[$method,$body,$headers];if(count($requests)===1)throw new RuntimeException('synthetic timeout body must never be persisted');return yooPayment($order);
};
genesisBillingYooReconcile($db,$order,$configuration,$http,$now,true);
yooCheck(genesisBillingOrder($db,$order['id'])['provider_secret']===null&&genesisFindUser('buyer')['subscription_plan']==='free','Timeout invented payment evidence');
genesisBillingYooPrepare($db,$order,[...$configuration,'receipt_required'=>true],'https://evil.invalid/changed',$now+5);
genesisBillingYooReconcile($db,$order,$configuration,$http,$now+5,true);
yooCheck($requests[0]===$requests[1]&&genesisBillingYooRecovery($db,$order['id'])['encrypted_request']===$row['encrypted_request'],'Retry changed frozen request/key');
// After provider deduplication expires, even an explicit retry can only discover; no POST/cancel/release.
$old=yooOrder('old-unknown');genesisBillingYooPrepare($db,$old,$configuration,'https://genesiscalendar.com',$now-GENESIS_YOO_REPLAY_SECONDS-1);
$calls=[];$discovery=static function($method,$url,$body)use(&$calls):array{$calls[]=[$method,$url];yooCheck($method==='GET'&&$body===null,'Expired retry created/closed a payment');return ['items'=>[]];};
genesisBillingYooReconcile($db,$old,$configuration,$discovery,$now,true);
yooCheck(genesisBillingOrder($db,$old['id'])['status']==='pending'&&genesisBillingYooRecovery($db,$old['id'])['error_code']==='BILLING_CHECKOUT_RECONCILIATION_REQUIRED','Unknown creation was locally expired');
yooReject(fn()=>genesisBillingAssertAccountDeletable($db,'buyer'));
// Paginated discovery recovers the authenticated original object, including a payment created before a crash.
$pages=0;$find=static function($method,$url,$body)use(&$pages,$old):array{
    yooCheck($method==='GET','Discovery initiated a financial operation');$pages++;
    if($pages===1)return ['items'=>[],'next_cursor'=>'synthetic-page-2'];
    yooCheck(str_contains($url,'cursor=synthetic-page-2'),'Discovery lost pagination');return ['items'=>[yooPayment($old,'succeeded')]];
};
genesisBillingYooReconcile($db,$old,$configuration,$find,$now+1);
genesisBillingYooReconcile($db,$old,$configuration,$find,$now+2);
yooCheck(genesisBillingOrder($db,$old['id'])['status']==='paid'&&genesisFindUser('buyer')['subscription_plan']==='premium','Authenticated discovery did not grant access');
$expiry=genesisFindUser('buyer')['subscription_valid_until'];
// Webhook beats checkout response. Incoming metadata/status cannot forge an order or grant.
$race=yooOrder('webhook-race');$payment=yooPayment($race,'succeeded');
$event=json_encode(['type'=>'notification','event'=>'payment.succeeded','object'=>['id'=>$payment['id'],'metadata'=>['genesis_order_id'=>'other'],'amount'=>['value'=>'0.01']]]);
$http=static function($method,$url,$body)use($payment):array{yooCheck($method==='GET'&&$body===null&&str_ends_with($url,$payment['id']),'Webhook trusted body over authenticated lookup');return $payment;};
genesisBillingWebhook('yookassa',$event,'',$http);$expiry=genesisFindUser('buyer')['subscription_valid_until'];
genesisBillingWebhook('yookassa',$event,'',$http);
yooCheck(genesisBillingOrder($db,$race['id'])['status']==='paid'&&genesisFindUser('buyer')['subscription_valid_until']===$expiry,'Webhook replay extended access');
foreach([['recipient'=>['account_id'=>'wrong']],['amount'=>['value'=>'0.01','currency'=>'RUB']],['test'=>true],['metadata'=>['genesis_order_id'=>'wrong']],['confirmation'=>['confirmation_url'=>'https://evil.invalid/checkout']]]as$bad)
    yooReject(fn()=>genesisBillingYooBind($db,[...$payment,...$bad],$race,$configuration,$now));
foreach(['http://yoomoney.ru/a','https://yoomoney.ru.evil.invalid/','https://user@yoomoney.ru/','https://yoomoney.ru:444/a']as$url)
    yooCheck(!genesisBillingYooCheckoutUrl($url),'Unsafe checkout host accepted');
// Unknown legacy merchant payments are acknowledged and ignored, without inventing a GENESIS order.
$count=(int)$db->query('SELECT COUNT(*) FROM billing_receipts')->fetchColumn();
genesisBillingWebhook('yookassa',json_encode(['type'=>'notification','event'=>'payment.succeeded','object'=>['id'=>'legacy']]),'',
    static fn()=>[...$payment,'id'=>'legacy','metadata'=>['genesis_order_id'=>'legacy-unrelated']]);
yooCheck((int)$db->query('SELECT COUNT(*) FROM billing_receipts')->fetchColumn()===$count,'Unrelated old bot payment affected access');
// Refund notification identifies the payment_id; terminal authenticated refund defeats a late success.
$refunded=[...$payment,'refunded_amount'=>$payment['amount']];
$refundEvent=json_encode(['type'=>'notification','event'=>'refund.succeeded','object'=>['id'=>'refund-object','payment_id'=>$payment['id']]]);
genesisBillingWebhook('yookassa',$refundEvent,'',static fn($method,$url)=>str_ends_with($url,$payment['id'])?$refunded:throw new RuntimeException('Wrong refund lookup'));
genesisBillingWebhook('yookassa',$event,'',$http);
yooCheck(genesisBillingOrder($db,$race['id'])['status']==='refunded','Late success restored a refunded payment');
// A known pending payment is polled with GET only, then closed only by provider cancellation evidence.
$life=yooOrder('cancelled-life','premium4life',0,1290000);genesisBillingReserveLifetime($db,genesisFindUser('buyer'),$life['id']);
genesisBillingYooPrepare($db,$life,$configuration,'https://genesiscalendar.com',$now);
$life=genesisBillingYooBind($db,yooPayment($life),$life,$configuration,$now);
$remaining=genesisBillingLifetimeAvailability($db)['remaining'];
genesisBillingYooReconcile($db,$life,$configuration,static function($method)use($life):array{yooCheck($method==='GET','Polling made a financial mutation');return yooPayment($life);},$now);
yooCheck(genesisBillingLifetimeAvailability($db)['remaining']===$remaining,'Pending lifetime seat expired locally');
genesisBillingYooReconcile($db,$life,$configuration,static fn()=>yooPayment($life,'canceled'),$now+1);
yooCheck(genesisBillingOrder($db,$life['id'])['status']==='cancelled'&&genesisBillingLifetimeAvailability($db)['remaining']===$remaining+1,'Provider cancellation did not release unused lifetime seat');
$lease=yooOrder('leased');genesisBillingYooPrepare($db,$lease,$configuration,'https://genesiscalendar.com',$now);
$db->prepare('UPDATE billing_yookassa_recovery SET lease_token=?,lease_until=? WHERE order_id=?')->execute(['other',gmdate('Y-m-d\TH:i:s\Z',$now+30),$lease['id']]);
genesisBillingYooReconcile($db,$lease,$configuration,static fn()=>throw new RuntimeException('Concurrent lease performed I/O'),$now,true);
$db->beginTransaction();yooReject(fn()=>genesisBillingYooReconcile($db,$lease,$configuration));$db->rollBack();
echo "PASS YooKassa: approved 7 RUB offers; web/native vs Play gates; NPD without false fiscal/recurring data; immutable replay; bounded paginated discovery after 23h; no timer cancellation; authenticated early callback/refund/replay/forgery; lifetime seat closure; leases and no network in writer. No live requests.\n";
