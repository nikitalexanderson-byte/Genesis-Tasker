<?php
declare(strict_types=1);
// Real state machine, synthetic shop/payment evidence and SQLite; every HTTP call is injected.
if(PHP_SAPI!=='cli')exit(1);
function genesisDb(): PDO {return $GLOBALS['settlementDb'];}
function genesisConfig(): array {return ['billing'=>['enabled'=>false,'credit_settlement_verified'=>false,'providers'=>['yookassa'=>settlementConfig()]]];}
function genesisNow(): string {return gmdate('Y-m-d\TH:i:s\Z',$GLOBALS['settlementNow']);}
function genesisUuid(): string {static $i=0;return 'synthetic-job-'.++$i;}
function genesisSharedContentEncrypt(string $value): string {return 'fixture:'.base64_encode($value);}
function genesisSharedContentDecrypt(string $value): string {return base64_decode(substr($value,8),true);}
function genesisIdentifierHash(string $namespace,string $value): string {return hash_hmac('sha256',$namespace."\0".$value,'synthetic-settlement-key');}
require dirname(__DIR__).'/src/feature-access.php';
require dirname(__DIR__).'/src/resource-limits.php';
require dirname(__DIR__).'/src/billing-api.php';
require dirname(__DIR__).'/src/background-jobs.php';
function settlementCheck(bool $condition,string $message): void {if(!$condition)throw new RuntimeException($message);}
function settlementConfig(): array {return ['shop_id'=>'synthetic-shop','secret_key'=>'synthetic-key','vat_code'=>1,'receipt_required'=>false];}
function settlementReceipt(string $id,int $amount,string $at,int $refunded=0): GenesisVerifiedBillingReceipt {
    return new GenesisVerifiedBillingReceipt('yookassa','ref-'.$id,$id,'paid',$amount,'RUB','product-'.($id==='base'?'standart':'premium'),$at,hash('sha256',$id.':'.$refunded),null,$refunded);
}
function settlementPayment(string $at,string $status='succeeded',int $refunded=0): array {
    return ['id'=>'ref-target','status'=>$status,'paid'=>$status==='succeeded','test'=>false,'recipient'=>['account_id'=>'synthetic-shop'],
        'metadata'=>['genesis_order_id'=>'target'],'amount'=>['value'=>'388.50','currency'=>'RUB'],
        'refunded_amount'=>['value'=>sprintf('%d.%02d',intdiv($refunded,100),$refunded%100),'currency'=>'RUB'],'created_at'=>'2026-11-16T10:00:00Z','captured_at'=>$at];
}
function settlementRefund(string $status='succeeded',int $amount=38850): array {
    return ['id'=>'refund-synthetic','payment_id'=>'ref-target','status'=>$status,'amount'=>['value'=>sprintf('%d.%02d',intdiv($amount,100),$amount%100),'currency'=>'RUB']];
}
function settlementFixture(): array {
    $db=new PDO('sqlite::memory:',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    $db->exec("PRAGMA foreign_keys=ON;CREATE TABLE users(id TEXT PRIMARY KEY,subscription_plan TEXT,subscription_valid_until TEXT);
        INSERT INTO users VALUES('buyer','free',NULL);CREATE TABLE blobs(body TEXT);INSERT INTO blobs VALUES('opaque protected content');
        CREATE TABLE resource_quota_limits(name TEXT PRIMARY KEY,amount INTEGER);INSERT INTO resource_quota_limits VALUES('tasks_per_user',1)");
    foreach(['093_billing_infrastructure','096_billing_upgrade_credit','099_billing_refund_amount','100_billing_settlement','101_billing_pending_order_deletion_guard','059_shared_series_jobs']as$name)
        $db->exec(file_get_contents(dirname(__DIR__).'/migrations/'.$name.'.sql'));
    $start='2026-11-01T10:00:00Z';$at='2026-11-16T10:00:00Z';$now=strtotime($at);
    $db->prepare('INSERT INTO billing_orders(id,user_id,idempotency_key,provider,plan,period_months,amount_minor,currency,product_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        ->execute(['base','buyer','base','yookassa','standart',1,33300,'RUB','product-standart',$start,$start]);
    genesisBillingApplyReceipt($db,settlementReceipt('base',33300,$start),$now);
    foreach(genesisBillingCatalog([])['offers']as$offer)if($offer['id']==='premium:1')$offerForQuote=[...$offer,'creditCheckoutEnabled'=>true,'availableProviders'=>['yookassa']];
    $quote=genesisBillingUpgradeQuote($db,'buyer',$offerForQuote,$now);
    $db->prepare('INSERT INTO billing_orders(id,user_id,idempotency_key,provider,plan,period_months,amount_minor,currency,product_id,provider_secret,checkout_url,created_at,updated_at,list_amount_minor,upgrade_credit_minor) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        ->execute(['target','buyer','target','yookassa','premium',1,38850,'RUB','product-premium','ref-target','https://example.invalid/pay',$at,$at,55500,16650]);
    genesisBillingReserveUpgrade($db,'target',$quote);
    $GLOBALS['settlementDb']=$db;$GLOBALS['settlementNow']=$now;
    return [$db,genesisBillingOrder($db,'target'),$now,$start,$at];
}
function settlementHold(PDO $db,string $start,int $now): void {
    genesisBillingApplyReceipt($db,settlementReceipt('base',33300,$start,9990),$now);
    genesisBillingApplyReceipt($db,settlementReceipt('target',38850,gmdate('Y-m-d\TH:i:s\Z',$now)),$now);
    settlementCheck(genesisBillingSettlement($db,'target')['state']==='refund-required','Deficit not durable');
}
function settlementNoGrant(PDO $db): void {
    settlementCheck((int)$db->query("SELECT COUNT(*) FROM billing_periods WHERE reference_hash='".hash('sha256','ref-target')."'")->fetchColumn()===0,'Deficit created a shortened target period');
    settlementCheck((int)$db->query('SELECT COUNT(*) FROM billing_upgrade_credits')->fetchColumn()===1,'Unconfirmed refund released reservation');
    settlementCheck($db->query("SELECT ends_at FROM billing_periods WHERE reference_hash='".hash('sha256','ref-base')."'")->fetchColumn()>'2026-11-16T10:00:00Z','Unsettled target retired source');
}

// 61/60/59 seconds before cutoff; a remote confirmation can exceed both timeout and safety margin.
$boundaryCases=0;
foreach([61,60,59]as$remaining)foreach([0,25,61]as$delay){
    [$db,$order,$now,$start,$at]=settlementFixture();$checkAt=$now+86400-$remaining;$capturedAt=$checkAt+$delay;$calls=[];
    $payment=genesisBillingYooSettleUpgrade($db,settlementPayment($at,'waiting_for_capture'),$order,settlementConfig(),
        function($method,$url,$body)use(&$calls,$remaining,$capturedAt,$db):array{
            settlementCheck(!$db->inTransaction(),'Provider I/O held SQLite writer');$calls[]=$url;
            settlementCheck(str_ends_with($url,$remaining>60?'/capture':'/cancel'),'Safety margin captured near cutoff');
            return settlementPayment(gmdate('Y-m-d\TH:i:s\Z',$capturedAt),$remaining>60?'succeeded':'canceled');
        },$checkAt);
    genesisBillingApplyReceipt($db,genesisBillingYooReceipt($payment,$order,settlementConfig()),$capturedAt);
    $state=genesisBillingSettlement($db,'target')['state'];
    if($remaining<=60)settlementCheck($state==='cancelled'&&count($calls)===1,'Unsafe authorization not cancelled');
    elseif($delay>=61){settlementCheck($state==='refund-required','Late capture not held');settlementNoGrant($db);}
    else settlementCheck($state==='completed'&&genesisBillingRefreshEntitlement($db,'buyer',$capturedAt)['validUntil']===genesisBillingPeriodEnd(gmdate('Y-m-d\TH:i:s\Z',$capturedAt),1),'Funded capture did not grant full month');
    $boundaryCases++;
}

// Capture timeout: next attempt GETs the exact payment and never blindly captures it again.
[$db,$order,$now,$start,$at]=settlementFixture();$calls=[];$mode=0;
$http=function($method,$url,$body,$headers=[])use(&$calls,&$mode,$at):array{
    $calls[]=[$method,$url,$body,$headers];
    if($method==='GET')return settlementPayment($at,$mode===0?'waiting_for_capture':'succeeded');
    if(str_ends_with($url,'/capture'))throw new RuntimeException('synthetic transport unknown secret-do-not-store');
    throw new RuntimeException('Unexpected operation');
};
settlementCheck(genesisBillingSettlementReconcile($db,$order,settlementConfig(),$http,$now)==='capture-pending','Unknown capture lost recovery state');
$pending=genesisBillingPublicOrder($order,$db);settlementCheck($pending['status']==='payment-verifying'&&$pending['checkoutUrl']===null,'Unknown capture exposed checkout/paid');
$mode=1;settlementCheck(genesisBillingSettlementReconcile($db,$order,settlementConfig(),$http,$now+1)==='completed','Verified unknown capture not completed');
settlementCheck(count(array_filter($calls,fn($call)=>$call[0]==='POST'))===1&&$calls[2][0]==='GET','Capture retry did not refetch first');

// Source refund inside provider capture creates durable receipt + refund, never shortened fulfilment.
[$db,$order,$now,$start,$at]=settlementFixture();$postCount=0;
$http=function($method,$url,$body,$headers=[])use($db,$now,$start,$at,&$postCount):array{
    settlementCheck(!$db->inTransaction(),'Provider I/O inside writer');
    if($method==='GET')return settlementPayment($at,'waiting_for_capture');
    $postCount++;
    if(str_ends_with($url,'/capture')){genesisBillingApplyReceipt($db,settlementReceipt('base',33300,$start,9990),$now);return settlementPayment($at);}
    settlementNoGrant($db);settlementCheck($db->query("SELECT state FROM billing_receipts WHERE order_id='target'")->fetchColumn()==='paid','Money evidence was rolled back');
    settlementCheck($url==='https://api.yookassa.ru/v3/refunds'&&$body['payment_id']==='ref-target'&&$body['amount']===['value'=>'388.50','currency'=>'RUB'],'Refund targeted source or wrong cash');
    return settlementRefund();
};
settlementCheck(genesisBillingSettlementReconcile($db,$order,settlementConfig(),$http,$now)==='refunded'&&$postCount===2,'Racing source refund not fully compensated');
settlementCheck((int)$db->query('SELECT COUNT(*) FROM billing_upgrade_credits')->fetchColumn()===0&&genesisBillingFundedOrderValue($db,'target')===0,'Verified refund did not release only target reservation');
genesisBillingApplyReceipt($db,settlementReceipt('target',38850,$at),$now+1);
settlementCheck(genesisBillingOrder($db,'target')['status']==='refunded'&&genesisBillingSettlement($db,'target')['state']==='refunded','Stale paid replay revived refund');

// Unknown refund POST: frozen body/key, GET before replay, then refund-id GET only.
[$db,$order,$now,$start,$at]=settlementFixture();settlementHold($db,$start,$now);$calls=[];$refundAttempts=0;$refundReads=0;
$http=function($method,$url,$body,$headers=[])use(&$calls,&$refundAttempts,&$refundReads,$at):array{
    $calls[]=[$method,$url,$body,$headers];
    if($method==='GET'&&str_contains($url,'/payments/'))return settlementPayment($at);
    if($method==='POST'){
        $refundAttempts++;if($refundAttempts===1)throw new RuntimeException('synthetic timeout private-secret');
        return settlementRefund('pending');
    }
    $refundReads++;return settlementRefund('succeeded');
};
settlementCheck(genesisBillingSettlementReconcile($db,$order,settlementConfig(),$http,$now)==='refund-pending','Unknown refund not held');settlementNoGrant($db);
$first=genesisBillingSettlement($db,'target');settlementCheck($first['error_code']==='BILLING_REFUND_UNKNOWN'&&!str_contains(json_encode($first),'private-secret'),'Exception/secret leaked');
settlementCheck(genesisBillingSettlementReconcile($db,$order,settlementConfig(),$http,$now+60)==='refund-pending','Refund pending response not retained');
settlementCheck(genesisBillingSettlementReconcile($db,$order,settlementConfig(),$http,$now+180)==='refunded'&&$refundReads===1,'Refund-id reconciliation failed');
$posts=array_values(array_filter($calls,fn($row)=>$row[0]==='POST'));
settlementCheck(count($posts)===2&&$posts[0][2]===$posts[1][2]&&$posts[0][3]===$posts[1][3]&&$calls[2][0]==='GET','Refund replay changed body/key or skipped refetch');

// A fully refunded payment found after unknown outcome is enough; never POST a second refund.
[$db,$order,$now,$start,$at]=settlementFixture();settlementHold($db,$start,$now);$mode=0;$posts=0;
$http=function($method,$url,$body)use(&$mode,&$posts,$at):array{if($method==='GET')return settlementPayment($at,'succeeded',$mode===0?0:38850);$posts++;throw new RuntimeException('unknown');};
genesisBillingSettlementReconcile($db,$order,settlementConfig(),$http,$now);$mode=1;
settlementCheck(genesisBillingSettlementReconcile($db,$order,settlementConfig(),$http,$now+60)==='refunded'&&$posts===1,'Unknown successful refund was duplicated');

// Old unknown request cannot be recreated after bounded provider deduplication expires.
[$db,$order,$now,$start,$at]=settlementFixture();settlementHold($db,$start,$now);$posts=0;
$http=function($method,$url,$body)use(&$posts,$at):array{if($method==='GET')return settlementPayment($at);$posts++;throw new RuntimeException('unknown');};
genesisBillingSettlementReconcile($db,$order,settlementConfig(),$http,$now);
settlementCheck(genesisBillingSettlementReconcile($db,$order,settlementConfig(),$http,$now+23*3600)==='failed'&&$posts===1,'Expired idempotency request was blindly retried');settlementNoGrant($db);

// Partial external refund is netted before first request; ambiguity after an unknown request is held for review.
foreach([false,true]as$changedAfterRequest){
    [$db,$order,$now,$start,$at]=settlementFixture();settlementHold($db,$start,$now);$posts=0;$mode=0;
    $http=function($method,$url,$body)use(&$posts,&$mode,$changedAfterRequest,$at):array{
        if($method==='GET')return settlementPayment($at,'succeeded',$changedAfterRequest?($mode===0?0:10000):10000);
        $posts++;if($changedAfterRequest)throw new RuntimeException('unknown');
        settlementCheck($body['amount']['value']==='288.50','Partial refund was charged/refunded twice');return settlementRefund('succeeded',28850);
    };
    $result=genesisBillingSettlementReconcile($db,$order,settlementConfig(),$http,$now);
    if(!$changedAfterRequest)settlementCheck($result==='refunded'&&$posts===1,'Remaining cash not fully refunded');
    else{$mode=1;settlementCheck(genesisBillingSettlementReconcile($db,$order,settlementConfig(),$http,$now+60)==='failed'&&$posts===1,'Ambiguous changed balance created new refund');settlementNoGrant($db);}
}

// Failed/mismatched/test refunds stay blocked, retain reservation and disclose no private provider identifiers.
foreach(['cancelled','wrong-payment','wrong-currency','wrong-amount','test']as$failure){
    [$db,$order,$now,$start,$at]=settlementFixture();settlementHold($db,$start,$now);
    $http=function($method,$url,$body)use($failure,$at):array{
        if($method==='GET')return settlementPayment($at);$refund=settlementRefund($failure==='cancelled'?'canceled':'succeeded');
        if($failure==='wrong-payment')$refund['payment_id']='other-payment';if($failure==='wrong-currency')$refund['amount']['currency']='USD';
        if($failure==='wrong-amount')$refund['amount']['value']='1.00';if($failure==='test')$refund['test']=true;return $refund;
    };
    settlementCheck(genesisBillingSettlementReconcile($db,$order,settlementConfig(),$http,$now)==='failed',"Unsafe refund accepted: $failure");settlementNoGrant($db);
    $public=genesisBillingPublicOrder(genesisBillingOrder($db,'target'),$db);
    settlementCheck($public['status']==='settlement-required'&&$public['checkoutUrl']===null&&!preg_match('/ref-target|refund-synthetic|refund_key|reference_hash|secret/',json_encode($public)),'Public settlement exposed secrets or false success');
}

// Completed purchase: later source refund is legitimate net-access change, target full refund still ingests.
[$db,$order,$now,$start,$at]=settlementFixture();$calls=0;$refund=0;
$http=function($method,$url,$body)use(&$calls,&$refund,$at):array{$calls++;settlementCheck($method==='GET','Accepted upgrade started unsolicited compensation');return settlementPayment($at,'succeeded',$refund);};
genesisBillingSettlementReconcile($db,$order,settlementConfig(),$http,$now);
try{genesisBillingSettlementReconcile($db,$order,settlementConfig(),fn()=>throw new RuntimeException('provider unavailable'),$now+1);throw new LogicException('Unverified refund hint acknowledged');}
catch(RuntimeException $expected){settlementCheck($expected->getMessage()==='provider unavailable','Accepted payment lost provider retry semantics');}
genesisBillingApplyReceipt($db,settlementReceipt('base',33300,$start,33300),$now+1);
settlementCheck(genesisBillingSettlementReconcile($db,$order,settlementConfig(),$http,$now+2)==='completed'&&genesisBillingRefreshEntitlement($db,'buyer',$now+2)['validUntil']==='2026-12-07T10:00:00Z','Later source refund reopened capture fulfilment');
$refund=38850;settlementCheck(genesisBillingSettlementReconcile($db,$order,settlementConfig(),$http,$now+3)==='refunded'&&$calls===3,'Completed target refund webhook was ignored');

// Fiscal refund copies the original encrypted receipt; request body stays immutable across config changes.
[$db,$order,$now,$start,$at]=settlementFixture();settlementHold($db,$start,$now);
$fiscal=genesisBillingYooFiscalReceipt([...$order,'receipt_email'=>'receipt@example.invalid'],settlementConfig());
$order['encrypted_receipt']=genesisSharedContentEncrypt(json_encode($fiscal,JSON_THROW_ON_ERROR));
$db->prepare('UPDATE billing_orders SET encrypted_receipt=? WHERE id=?')->execute([$order['encrypted_receipt'],$order['id']]);
$requests=[];$http=function($method,$url,$body)use(&$requests,$at):array{
    if($method==='GET')return settlementPayment($at);$requests[]=$body;
    settlementCheck($body['receipt']['customer']['email']==='receipt@example.invalid'&&$body['receipt']['items'][0]['amount']===['value'=>'388.50','currency'=>'RUB'],'Fiscal refund lost original customer/items');
    if(count($requests)===1)throw new RuntimeException('timeout');return settlementRefund();
};
genesisBillingSettlementReconcile($db,$order,[...settlementConfig(),'receipt_required'=>true],$http,$now);
settlementCheck(genesisBillingSettlementReconcile($db,$order,settlementConfig(),$http,$now+60)==='refunded'&&$requests[0]===$requests[1],'Config change altered the immutable refund request');

// Five unresolved attempts stop safely with a durable error; later verified full refund can still close it.
[$db,$order,$now,$start,$at]=settlementFixture();settlementHold($db,$start,$now);$posts=0;$resolved=false;
$http=function($method,$url,$body)use(&$posts,&$resolved,$at):array{
    if($method==='GET')return settlementPayment($at,'succeeded',$resolved?38850:0);$posts++;throw new RuntimeException('unknown');
};
for($attempt=0;$attempt<5;$attempt++)$last=genesisBillingSettlementReconcile($db,$order,settlementConfig(),$http,$now+$attempt*120);
settlementCheck($last==='failed'&&genesisBillingSettlement($db,'target')['next_attempt_at']===null&&$posts===5,'Unbounded recovery loop or missing durable error');settlementNoGrant($db);
$resolved=true;settlementCheck(genesisBillingSettlementReconcile($db,$order,settlementConfig(),$http,$now+601)==='refunded'&&$posts===5,'Late verified refund could not close failed recovery');

// Durable worker scan/claim, pending retry, stale lease and recovery after process restart.
[$db,$order,$now,$start,$at]=settlementFixture();
$db->exec("UPDATE billing_orders SET plan='premium4life',period_months=0,product_id='product-life' WHERE id='target'");
$lifeReceipt=new GenesisVerifiedBillingReceipt('yookassa','ref-target','target','paid',38850,'RUB','product-life',$at,hash('sha256','synthetic-life'));
genesisBillingApplyReceipt($db,$lifeReceipt,$now);
settlementCheck(genesisBillingSettlement($db,'target')['state']==='refund-required'&&genesisBillingRefreshEntitlement($db,'buyer',$now)['plan']==='standart','Unsupported captured Lifetime retired source or granted access');

// Durable worker scan/claim, pending retry, stale lease and recovery after process restart.
[$db,$order,$now,$start,$at]=settlementFixture();settlementHold($db,$start,$now);genesisBillingSettlementScan();genesisBillingSettlementScan();
settlementCheck((int)$db->query('SELECT COUNT(*) FROM background_jobs')->fetchColumn()===1,'Scanner duplicated durable job');
$job=genesisBackgroundClaim(gmdate('Y-m-d\TH:i:s\Z',$now));settlementCheck($job['kind']==='billing-settlement','Settlement job not claimable');
$workerCalls=0;$http=function($method,$url,$body)use($db,&$workerCalls,$at):array{
    settlementCheck(!$db->inTransaction(),'Worker network held writer');$workerCalls++;
    if($method==='GET')return settlementPayment($at);return settlementRefund('pending');
};
settlementCheck(genesisBillingSettlementPerformLeased($job,$http,$now)==='pending','Pending refund job acknowledged as success');settlementNoGrant($db);
$row=genesisBillingSettlement($db,'target');$job=genesisBackgroundClaim($row['next_attempt_at']);
$http=function($method,$url,$body)use($db,$at):array{
    settlementCheck(!$db->inTransaction(),'Retry network held writer');
    if(str_contains($url,'/payments/'))return settlementPayment($at);
    $db->exec("UPDATE background_jobs SET lease_token='new-owner' WHERE kind='billing-settlement'");return settlementRefund();
};
settlementCheck(genesisBillingSettlementPerformLeased($job,$http,strtotime($row['next_attempt_at']))==='superseded','Old lease acknowledged another worker');
settlementCheck(genesisBillingSettlement($db,'target')['state']==='refunded'&&(int)$db->query('SELECT COUNT(*) FROM billing_upgrade_credits')->fetchColumn()===0,'Stale lease lost verified money recovery');
settlementCheck($db->query('SELECT body FROM blobs')->fetchColumn()==='opaque protected content','Settlement touched personal data');
$job['lease_token']='new-owner';settlementCheck(genesisBillingSettlementPerformLeased($job,fn()=>throw new RuntimeException('Terminal job used network'),$now+181)==='succeeded','Durable terminal settlement was not acknowledged without network');

// Two independent connections overlap a refund POST. Both see the same durable body/key; provider deduplicates it.
[$memory,$order,$now,$start,$at]=settlementFixture();settlementHold($memory,$start,$now);
$path=tempnam(sys_get_temp_dir(),'genesis-settlement-race-');settlementCheck(is_string($path),'Missing race fixture path');
try{
    $memory->exec('VACUUM INTO '.$memory->quote($path));
    $options=[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC];
    $first=new PDO('sqlite:'.$path,null,null,$options);$second=new PDO('sqlite:'.$path,null,null,$options);
    $posts=[];$inside=false;$providerKeys=[];
    $http=function($method,$url,$body,$headers=[])use(&$http,$first,$second,$order,$now,$at,&$posts,&$inside,&$providerKeys):array{
        settlementCheck(!$first->inTransaction()&&!$second->inTransaction(),'Competing refund network held writer');
        if($method==='GET')return settlementPayment($at);
        $posts[]=[$body,$headers];$providerKeys[$headers[0]]=true;
        if(!$inside){$inside=true;genesisBillingSettlementReconcile($second,$order,settlementConfig(),$http,$now+1);return settlementRefund();}
        return settlementRefund('pending');
    };
    settlementCheck(genesisBillingSettlementReconcile($first,$order,settlementConfig(),$http,$now)==='refunded','Overlapping refund did not close');
    settlementCheck(count($posts)===2&&$posts[0]===$posts[1]&&count($providerKeys)===1,'Concurrent connections created different refund operations');
    settlementCheck(genesisBillingSettlement($second,'target')['state']==='refunded'&&(int)$second->query('SELECT COUNT(*) FROM billing_upgrade_credits')->fetchColumn()===0,'Concurrent replay lost terminal refund');
}finally{$http=null;$first=null;$second=null;gc_collect_cycles();if(is_file($path))unlink($path);}

// A worker crash on its final lease becomes a durable review state without touching the network.
[$db,$order,$now,$start,$at]=settlementFixture();settlementHold($db,$start,$now);genesisBillingSettlementScan();
$job=genesisBackgroundClaim(gmdate('Y-m-d\TH:i:s\Z',$now));
$db->prepare("UPDATE background_jobs SET attempts=5,lease_until=? WHERE id=?")->execute([gmdate('Y-m-d\TH:i:s\Z',$now-1),$job['id']]);
settlementCheck(genesisBackgroundClaim(gmdate('Y-m-d\TH:i:s\Z',$now),'billing-settlement:target')===null&&genesisBillingSettlement($db,'target')['state']==='failed','Final lease crash stayed pending forever');settlementNoGrant($db);

// An account cascade cannot erase an unresolved capture/refund (including before the first settlement record).
[$db,$order,$now,$start,$at]=settlementFixture();settlementHold($db,$start,$now);
$off=genesisBillingSettings();$disabledCatalog=genesisBillingCatalog($off);
settlementCheck(!$off['enabled']&&!($off['pending_order_closure_verified']??false)&&!$disabledCatalog['checkoutEnabled']&&!$disabledCatalog['creditCheckoutEnabled']&&genesisBillingProviderReady('yookassa',$off),'Disabled-sales/closure fixture did not retain recovery credentials');
genesisBillingSettlementScan();$job=genesisBackgroundClaim(gmdate('Y-m-d\TH:i:s\Z',$now));$recoveryCalls=[];
$http=function($method,$url,$body)use(&$recoveryCalls,$at):array{$recoveryCalls[]=[$method,$url];return $method==='GET'?settlementPayment($at):settlementRefund();};
settlementCheck(genesisBillingSettlementPerformLeased($job,$http,$now)==='succeeded'&&genesisBillingSettlement($db,'target')['state']==='refunded'&&count($recoveryCalls)===2,'Disabling new sales disabled existing cash recovery');

// An account cascade cannot erase an unresolved capture/refund (including before the first settlement record).
foreach([false,true]as$captured){
    [$db,$order,$now,$start,$at]=settlementFixture();if($captured)settlementHold($db,$start,$now);
    try{genesisBillingAssertAccountDeletable($db,'buyer');throw new LogicException('Preflight allowed unresolved money');}
    catch(GenesisResourceLimitException $expected){settlementCheck($expected->status===409&&$expected->getMessage()==='BILLING_SETTLEMENT_REQUIRED','Wrong preflight result');}
    try{$db->exec("DELETE FROM users WHERE id='buyer'");throw new LogicException('Account erased unresolved money');}
    catch(PDOException $expected){settlementCheck(str_contains($expected->getMessage(),'BILLING_SETTLEMENT_REQUIRED'),'Wrong account deletion guard');}
    settlementCheck((int)$db->query('SELECT COUNT(*) FROM users')->fetchColumn()===1&&(int)$db->query('SELECT COUNT(*) FROM billing_upgrade_credits')->fetchColumn()===1,'Aborted cascade partially erased recovery evidence');
    $cancelled=new GenesisVerifiedBillingReceipt('yookassa','ref-target','target',$captured?'refunded':'cancelled',38850,'RUB','product-premium',$at,hash('sha256','delete-recovery-proof'),null,$captured?38850:0);
    genesisBillingApplyReceipt($db,$cancelled,$now);genesisBillingAssertAccountDeletable($db,'buyer');$db->exec("DELETE FROM users WHERE id='buyer'");
    settlementCheck((int)$db->query('SELECT COUNT(*) FROM users')->fetchColumn()===0,'Verified closure kept an unnecessary deletion block');
}

echo "PASS billing settlement: {$boundaryCases} safety-margin cases, durable capture/refund timeouts, immutable idempotent refunds, partial/racing refunds, stale replay, public status, lease recovery and no network inside SQLite writers; synthetic only.\n";
