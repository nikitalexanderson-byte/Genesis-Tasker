<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') exit(1);
require dirname(__DIR__).'/src/feature-access.php';
require dirname(__DIR__).'/src/billing.php';
require dirname(__DIR__).'/src/billing-gateways.php';
function genesisIdentifierHash(string $namespace,string $value): string {return hash_hmac('sha256',$namespace."\0".$value,'synthetic-upgrade-test');}
function checkUpgrade(bool $ok,string $message): void {if(!$ok)throw new RuntimeException($message);}
function upgradeFixture(array $migrations=['093_billing_infrastructure','096_billing_upgrade_credit','099_billing_refund_amount','100_billing_settlement','101_billing_pending_order_deletion_guard','104_subscription_trials','111_forecast_elite_plus']): PDO {
    $db=new PDO('sqlite::memory:',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    $db->exec("PRAGMA foreign_keys=ON;CREATE TABLE users(id TEXT PRIMARY KEY,subscription_plan TEXT,subscription_valid_until TEXT);
        INSERT INTO users VALUES('buyer','free',NULL),('other','free',NULL),('admin-grant','premium','2029-01-01T00:00:00Z');
        CREATE TABLE blobs(body TEXT);INSERT INTO blobs VALUES('opaque encrypted document');");
    $db->exec('CREATE TABLE linked_google_accounts(id TEXT,owner_user_id TEXT,google_sub TEXT,email TEXT)');
    foreach($migrations as $migration)
        $db->exec((string)file_get_contents(dirname(__DIR__).'/migrations/'.$migration.'.sql'));
    return $db;
}
function upgradeOrder(PDO $db,string $id,string $plan,int $months,int $amount,string $at,?array $quote=null): void {
    $db->prepare('INSERT INTO billing_orders(id,user_id,idempotency_key,provider,plan,period_months,amount_minor,currency,product_id,created_at,updated_at,list_amount_minor,upgrade_credit_minor)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')->execute([$id,'buyer',$id,'yookassa',$plan,$months,$amount,'RUB','product-'.$plan,$at,$at,
            $quote['listAmountMinor']??null,$quote['creditMinor']??0]);
    if($quote)genesisBillingReserveUpgrade($db,$id,$quote);
}
function upgradeReceipt(string $id,int $amount,string $at,string $state='paid',?string $plan=null,int $refundedAmountMinor=0): GenesisVerifiedBillingReceipt {
    return new GenesisVerifiedBillingReceipt('yookassa','ref-'.$id,$id,$state,$amount,'RUB','product-'.($plan??($id==='base'||$id==='renewal'?'standart':($id==='life'?'premium4life':'premium'))),
        $at,hash('sha256',$id.':'.$state.':'.$refundedAmountMinor),null,$refundedAmountMinor);
}
function upgradePayment(string $id,int $amount,string $at,array $extra=[]): array {
    return [...['id'=>'ref-'.$id,'status'=>'succeeded','paid'=>true,'test'=>false,
        'recipient'=>['account_id'=>'synthetic-shop'],'metadata'=>['genesis_order_id'=>$id],
        'amount'=>['value'=>sprintf('%d.%02d',intdiv($amount,100),$amount%100),'currency'=>'RUB'],
        'captured_at'=>$at,'created_at'=>$at],...$extra];
}
function upgradeOffer(string $plan='premium',int $months=1): array {
    foreach(genesisBillingCatalog([])['offers'] as $offer) if($offer['plan']===$plan&&$offer['periodMonths']===$months)
        return [...$offer,'availableProviders'=>['yookassa','google-play','lemon-squeezy'],'creditCheckoutEnabled'=>true];
    throw new RuntimeException('Missing approved offer');
}

// Gregorian month boundaries, leap years and exact expiry; no 30-day approximation.
foreach([
    ['2027-01-31T10:00:00Z','2027-02-28T10:00:00Z',28],
    ['2028-01-31T10:00:00Z','2028-02-29T10:00:00Z',29],
    ['2026-11-01T10:00:00Z','2026-12-01T10:00:00Z',30],
    ['2026-12-01T10:00:00Z','2027-01-01T10:00:00Z',31],
    ['2027-01-01T10:00:00Z','2028-01-01T10:00:00Z',365],
    ['2028-01-01T10:00:00Z','2029-01-01T10:00:00Z',366],
] as [$start,$end,$days]) {
    checkUpgrade(genesisBillingUnusedCredit(33300,$start,$end,strtotime($start)+10*86400)===intdiv(33300*($days-10),$days),'Wrong actual-day credit');
    checkUpgrade(genesisBillingUnusedCredit(33300,$start,$end,strtotime($end))===0,'Credit survived exact expiry');
    checkUpgrade(genesisBillingUnusedCredit(33300,$start,$end,strtotime($start))===33300,'First day lost balance');
    foreach([33300,55500,77700,333000,555000,777000,33301]as$amount){
        $previous=$amount;
        for($used=0;$used<=$days;$used++){
            $value=genesisBillingUnusedCredit($amount,$start,$end,strtotime($start)+$used*86400);
            checkUpgrade($value===intdiv($amount*($days-$used),$days)&&$value<=$previous&&$value>=0,'Daily integer rounding or monotonicity failed');
            if($used<$days)checkUpgrade(genesisBillingUnusedCredit($amount,$start,$end,strtotime($start)+$used*86400+86399)===$value,'Credit changed before a completed payment-anchored day');
            $previous=$value;
        }
    }
}

$db=upgradeFixture();$start='2026-11-01T10:00:00Z';$at='2026-11-16T10:00:00Z';$now=strtotime($at);
upgradeOrder($db,'base','standart',1,33300,$start);
genesisBillingApplyReceipt($db,upgradeReceipt('base',33300,$start),$now);
$quote=genesisBillingUpgradeQuote($db,'buyer',upgradeOffer(),$now);
checkUpgrade($quote['creditMinor']===16650&&$quote['amountMinor']===38850&&$quote['listAmountMinor']===55500,'Monthly upgrade double-charged unused days');
checkUpgrade($quote['availableProviders']===['yookassa'],'Fixed-price product offered unsupported custom charge');
checkUpgrade(!isset(genesisBillingPublicQuote($quote)['creditSource']),'Public quote exposed private source fingerprint');
checkUpgrade(genesisBillingUpgradeQuote($db,'other',upgradeOffer(),$now)['creditMinor']===0,'Balance leaked between accounts');
checkUpgrade(genesisBillingUpgradeQuote($db,'admin-grant',upgradeOffer('business'),$now)['creditMinor']===0,'Administrative grant became money');
upgradeOrder($db,'target','premium',1,38850,$at,$quote);
$pending=genesisBillingUpgradeQuote($db,'buyer',upgradeOffer(),$now+60);
checkUpgrade($pending['pendingOrderId']==='target'&&$pending['creditMinor']===16650,'Retry did not reuse pending quote');
$repriced=upgradeOffer();$repriced['amountMinor']+=1000;
$immutable=genesisBillingUpgradeQuote($db,'buyer',$repriced,$now+60);
checkUpgrade($immutable['amountMinor']===38850&&$immutable['listAmountMinor']===55500&&$immutable['creditMinor']===16650
    &&$immutable['quotedAt']===$at&&$immutable['currency']==='RUB'&&$immutable['availableProviders']===['yookassa'],'Pending quote drifted from immutable stored order');
$repriced['currency']='USD';$oldCurrency=genesisBillingUpgradeQuote($db,'buyer',$repriced,$now+60);
checkUpgrade($oldCurrency['currency']==='RUB'&&$oldCurrency['amountMinor']===38850,'Catalog currency change replaced an existing authorization');
$otherMethod=genesisBillingProviderOffer(upgradeOffer(),'lemon-squeezy');$pendingMethod=genesisBillingPublicQuote(genesisBillingUpgradeQuote($db,'buyer',$otherMethod,$now));
checkUpgrade($pendingMethod['availableProviders']===['yookassa']&&$pendingMethod['currency']==='RUB'&&!isset($pendingMethod['_allAvailableProviders']),'Other-provider request lost the immutable pending provider or exposed internal metadata');
checkUpgrade(genesisBillingUpgradeQuote($db,'buyer',upgradeOffer(),$now+31*86400)['pendingOrderId']==='target','Source expiry hid an unsettled discounted authorization');
checkUpgrade(genesisBillingUpgradeQuote($db,'buyer',upgradeOffer('business'),$now)['upgradeUnavailableReason']==='upgrade-pending','Concurrent upgrade reused reserved balance');
$db->beginTransaction();
try{upgradeOrder($db,'duplicate','premium',1,38850,$at,$quote);throw new RuntimeException('Credit spent twice');}
catch(PDOException $expected){$db->rollBack();checkUpgrade(str_contains($expected->getMessage(),'UNIQUE'),'Wrong atomic credit failure');}
checkUpgrade((int)$db->query("SELECT COUNT(*) FROM billing_orders WHERE id='duplicate'")->fetchColumn()===0,'Failed reservation left a payable duplicate order');
checkUpgrade(genesisBillingUpgradeCaptureValid($db,['id'=>'target','upgrade_credit_minor'=>16650],$now+60),'Fresh authorization rejected');
checkUpgrade(!genesisBillingUpgradeCaptureValid($db,['id'=>'target','upgrade_credit_minor'=>16650],$now+86400),'Stale authorization can spend already consumed days');

// Payment retires only the exchanged active period; an already prepaid future renewal keeps its dates.
upgradeOrder($db,'renewal','standart',1,33300,'2026-11-10T10:00:00Z');
genesisBillingApplyReceipt($db,upgradeReceipt('renewal',33300,'2026-11-10T10:00:00Z'),$now);
$before=$db->query("SELECT starts_at,ends_at FROM billing_periods WHERE reference_hash='".hash('sha256','ref-renewal')."'")->fetch();
$target=upgradeReceipt('target',38850,$at);
genesisBillingApplyReceipt($db,$target,$now);
$after=$db->query("SELECT starts_at,ends_at FROM billing_periods WHERE reference_hash='".hash('sha256','ref-renewal')."'")->fetch();
checkUpgrade($before===$after,'Upgrade moved/lost a prepaid future renewal');
checkUpgrade($db->query("SELECT ends_at FROM billing_periods WHERE reference_hash='".hash('sha256','ref-base')."'")->fetchColumn()===$at,'Consumed source period remained available');
$snapshot=genesisBillingRefreshEntitlement($db,'buyer',$now);
checkUpgrade($snapshot===['plan'=>'premium','validUntil'=>'2026-12-16T10:00:00Z'],'Paid upgrade did not start one new month');
checkUpgrade(genesisBillingApplyReceipt($db,$target,$now)===$snapshot,'Replay extended upgrade');

// Refunding the credit SOURCE shrinks successor access to the money actually left paid.
genesisBillingApplyReceipt($db,upgradeReceipt('base',33300,$start,'refunded'),$now);
checkUpgrade(genesisBillingFundedOrderValue($db,'target')===38850,'Refunded money still funds upgrade');
checkUpgrade(genesisBillingRefreshEntitlement($db,'buyer',$now)['validUntil']==='2026-12-07T10:00:00Z','Refunded credit retained a full target period');
checkUpgrade($db->query('SELECT body FROM blobs')->fetchColumn()==='opaque encrypted document','Billing touched personal data');

// Refunding/cancelling the TARGET releases only its reservation, never another account or payment.
genesisBillingApplyReceipt($db,upgradeReceipt('target',38850,$at,'refunded'),$now);
checkUpgrade((int)$db->query('SELECT COUNT(*) FROM billing_upgrade_credits')->fetchColumn()===0,'Confirmed refund did not release reservation');
$year=upgradeFixture();upgradeOrder($year,'base','standart',12,333000,$start);
genesisBillingApplyReceipt($year,upgradeReceipt('base',333000,$start),$now);
$short=genesisBillingUpgradeQuote($year,'buyer',upgradeOffer(),$now);
checkUpgrade($short['recommendedPeriodMonths']===12&&$short['availableProviders']===[],'Annual balance was discarded for shorter upgrade');
$annual=genesisBillingUpgradeQuote($year,'buyer',upgradeOffer('premium',12),$now);
checkUpgrade($annual['creditMinor']===intdiv(333000*350,365),'Annual upgrade used monthly price instead of actual year');

// The provider can confirm after the day boundary even when validation before POST was fresh.
$cross=upgradeFixture();upgradeOrder($cross,'base','standart',1,33300,$start);
genesisBillingApplyReceipt($cross,upgradeReceipt('base',33300,$start),$now);
$crossQuote=genesisBillingUpgradeQuote($cross,'buyer',upgradeOffer(),$now);upgradeOrder($cross,'target','premium',1,38850,$at,$crossQuote);
$cross->exec("UPDATE billing_orders SET provider_secret='ref-target' WHERE id='target'");
$crossOrder=$cross->query("SELECT * FROM billing_orders WHERE id='target'")->fetch();
$beforeBoundary=$now+86400-61;$capturedAt=gmdate('Y-m-d\TH:i:s\Z',$beforeBoundary+62);
$waiting=upgradePayment('target',38850,$at,['status'=>'waiting_for_capture']);$captureCalls=0;
$captured=genesisBillingYooSettleUpgrade($cross,$waiting,$crossOrder,['shop_id'=>'synthetic-shop','secret_key'=>'synthetic'],
    function($method,$url,$body)use(&$captureCalls,$capturedAt):array{
        $captureCalls++;checkUpgrade($method==='POST'&&str_ends_with($url,'/capture')&&$body['amount']['value']==='388.50','Fresh capture did not use exact stored charge');
        return upgradePayment('target',38850,$capturedAt);
    },$beforeBoundary);
$crossAccess=genesisBillingApplyReceipt($cross,genesisBillingYooReceipt($captured,$crossOrder,['shop_id'=>'synthetic-shop']),$beforeBoundary+62);
checkUpgrade($captureCalls===1&&genesisBillingFundedOrderValue($cross,'target')===0,'Capture deficit became an access grant');
checkUpgrade($crossAccess===['plan'=>'standart','validUntil'=>'2026-12-01T10:00:00Z']&&genesisBillingSettlement($cross,'target')['state']==='refund-required','Late capture silently shortened a purchased month or retired source');

// A source refund racing capture is reflected after the verified capture, although POST began earlier.
$race=upgradeFixture();upgradeOrder($race,'base','standart',1,33300,$start);
genesisBillingApplyReceipt($race,upgradeReceipt('base',33300,$start),$now);
$raceQuote=genesisBillingUpgradeQuote($race,'buyer',upgradeOffer(),$now);upgradeOrder($race,'target','premium',1,38850,$at,$raceQuote);
$race->exec("UPDATE billing_orders SET provider_secret='ref-target' WHERE id='target'");$raceOrder=$race->query("SELECT * FROM billing_orders WHERE id='target'")->fetch();
$racePayment=genesisBillingYooSettleUpgrade($race,$waiting,$raceOrder,['shop_id'=>'synthetic-shop','secret_key'=>'synthetic'],
    function()use($race,$start,$now,$at):array{
        genesisBillingApplyReceipt($race,upgradeReceipt('base',33300,$start,refundedAmountMinor:9990),$now);
        return upgradePayment('target',38850,$at);
    },$now);
genesisBillingApplyReceipt($race,genesisBillingYooReceipt($racePayment,$raceOrder,['shop_id'=>'synthetic-shop']),$now);
checkUpgrade(genesisBillingFundedOrderValue($race,'target')===0&&genesisBillingSettlement($race,'target')['state']==='refund-required','Racing source refund issued an underfunded successor');

// Partial refunds are net money, monotonic under stale replays, and cannot fund another upgrade.
$partial=upgradeFixture();upgradeOrder($partial,'base','standart',1,33300,$start);
$baseOrder=$partial->query("SELECT * FROM billing_orders WHERE id='base'")->fetch();
$partialReceipt=genesisBillingYooReceipt(upgradePayment('base',33300,$start,['refunded_amount'=>['value'=>'332.99','currency'=>'RUB']]),$baseOrder,['shop_id'=>'synthetic-shop']);
genesisBillingApplyReceipt($partial,$partialReceipt,$now);
checkUpgrade(genesisBillingFundedOrderValue($partial,'base')===1&&genesisBillingUpgradeQuote($partial,'buyer',upgradeOffer(),$now)['creditMinor']===0,'Partially refunded cash became a full upgrade balance');
genesisBillingApplyReceipt($partial,upgradeReceipt('base',33300,$start),$now);
checkUpgrade(genesisBillingFundedOrderValue($partial,'base')===1,'A stale paid replay erased a partial refund');
genesisBillingApplyReceipt($race,upgradeReceipt('target',38850,$at,refundedAmountMinor:10000),$now);
checkUpgrade(genesisBillingFundedOrderValue($race,'target')===0,'Unsettled partial target refund became usable credit');

// A refund of the first purchase reaches a second upgrade without reusing the nominal amount.
$chain=upgradeFixture();upgradeOrder($chain,'base','standart',1,33300,$start);
genesisBillingApplyReceipt($chain,upgradeReceipt('base',33300,$start),$now);
$firstQuote=genesisBillingUpgradeQuote($chain,'buyer',upgradeOffer(),$now);upgradeOrder($chain,'target','premium',1,38850,$at,$firstQuote);
genesisBillingApplyReceipt($chain,upgradeReceipt('target',38850,$at),$now);
$later=$now+3*86400;$secondQuote=genesisBillingUpgradeQuote($chain,'buyer',upgradeOffer('business'),$later);
checkUpgrade($secondQuote['creditMinor']===49950,'Second upgrade has wrong unused source value');
upgradeOrder($chain,'business','business',1,27750,gmdate('Y-m-d\TH:i:s\Z',$later),$secondQuote);
genesisBillingApplyReceipt($chain,upgradeReceipt('business',27750,gmdate('Y-m-d\TH:i:s\Z',$later),plan:'business'),$later);
genesisBillingApplyReceipt($chain,upgradeReceipt('base',33300,$start,'refunded'),$later);
checkUpgrade(genesisBillingFundedOrderValue($chain,'business')===61050,'Refunded first-source credit survived an upgrade chain');

// A different still-paid receipt for the same order cannot replace the exact refunded credit source.
$exact=upgradeFixture();upgradeOrder($exact,'base','standart',1,33300,$start);
genesisBillingApplyReceipt($exact,upgradeReceipt('base',33300,$start),$now);
$exactQuote=genesisBillingUpgradeQuote($exact,'buyer',upgradeOffer(),$now);upgradeOrder($exact,'target','premium',1,38850,$at,$exactQuote);
genesisBillingApplyReceipt($exact,upgradeReceipt('target',38850,$at),$now);
genesisBillingApplyReceipt($exact,new GenesisVerifiedBillingReceipt('yookassa','another-base-reference','base','paid',33300,'RUB','product-standart',$start,hash('sha256','another-base-reference')),$now);
genesisBillingApplyReceipt($exact,upgradeReceipt('base',33300,$start,'refunded'),$now);
checkUpgrade(genesisBillingFundedOrderValue($exact,'base')===33300&&genesisBillingFundedOrderValue($exact,'target')===38850,'A different provider reference replaced the refunded source evidence');

// A later legitimate refund reduces accepted access; a known deficit at first capture requires compensation.
$reordered=[];
foreach([false,true]as$refundFirst){
    $events=upgradeFixture();upgradeOrder($events,'base','standart',1,33300,$start);
    genesisBillingApplyReceipt($events,upgradeReceipt('base',33300,$start),$now);
    $eventQuote=genesisBillingUpgradeQuote($events,'buyer',upgradeOffer(),$now);upgradeOrder($events,'target','premium',1,38850,$at,$eventQuote);
    if($refundFirst)genesisBillingApplyReceipt($events,upgradeReceipt('base',33300,$start,'refunded'),$now);
    genesisBillingApplyReceipt($events,upgradeReceipt('target',38850,$at),$now);
    if(!$refundFirst)genesisBillingApplyReceipt($events,upgradeReceipt('base',33300,$start,'refunded'),$now);
    $reordered[]=genesisBillingRefreshEntitlement($events,'buyer',$now);
    genesisBillingApplyReceipt($events,upgradeReceipt('target',38850,$at,'refunded'),$now);
    genesisBillingApplyReceipt($events,upgradeReceipt('target',38850,$at),$now);
    checkUpgrade(genesisBillingFundedOrderValue($events,'target')===0&&(int)$events->query('SELECT COUNT(*) FROM billing_upgrade_credits')->fetchColumn()===0,'Late paid webhook revived a refunded target/reservation');
}
checkUpgrade($reordered[0]['validUntil']==='2026-12-07T10:00:00Z'&&$reordered[1]===['plan'=>'free','validUntil'=>null],'A known capture deficit issued normal paid access or a later legitimate refund reopened fulfilment');

$foreign=upgradeFixture();upgradeOrder($foreign,'base','standart',1,33300,$start);
genesisBillingApplyReceipt($foreign,upgradeReceipt('base',33300,$start),$now);
$foreignOffer=upgradeOffer();$foreignOffer['currency']='USD';$foreignQuote=genesisBillingUpgradeQuote($foreign,'buyer',$foreignOffer,$now);
checkUpgrade($foreignQuote['creditMinor']===0&&$foreignQuote['availableProviders']===[]&&$foreignQuote['upgradeUnavailableReason']==='credit-currency-unavailable','Cross-currency credit silently became a full-price payment');

// A revoked pending authorization is cancelled before capture and cannot resurrect paid source evidence.
$revoked=upgradeFixture();upgradeOrder($revoked,'base','standart',1,33300,$start);
genesisBillingApplyReceipt($revoked,upgradeReceipt('base',33300,$start),$now);
$revokeQuote=genesisBillingUpgradeQuote($revoked,'buyer',upgradeOffer(),$now);upgradeOrder($revoked,'target','premium',1,38850,$at,$revokeQuote);
$revoked->exec("UPDATE billing_orders SET provider_secret='ref-target' WHERE id='target'");
genesisSubscriptionRevoke($revoked,['id'=>'buyer'],gmdate('Y-m-d\TH:i:s\Z',$now+1));
$revokeOrder=$revoked->query("SELECT * FROM billing_orders WHERE id='target'")->fetch();$cancelCalls=0;
genesisBillingYooSettleUpgrade($revoked,$waiting,$revokeOrder,['shop_id'=>'synthetic-shop','secret_key'=>'synthetic'],function($method,$url,$body)use(&$cancelCalls,$at):array{
    $cancelCalls++;checkUpgrade($method==='POST'&&str_ends_with($url,'/cancel')&&$body===null,'Revoked authorization was captured');
    return upgradePayment('target',38850,$at,['status'=>'canceled','paid'=>false]);
},$now+2);
checkUpgrade($cancelCalls===1&&genesisBillingFundedOrderValue($revoked,'base')===0,'Revoked source became upgrade money');

// Seventy-two deterministic combinations independently bound applied credit and granted paid seconds.
$invariantCases=0;
foreach([
    ['2027-01-31T10:00:00Z',1,28],['2028-01-31T10:00:00Z',1,29],
    ['2026-11-01T10:00:00Z',1,30],['2026-12-01T10:00:00Z',1,31],
    ['2027-01-01T10:00:00Z',12,365],['2028-01-01T10:00:00Z',12,366]
]as[$periodStart,$months,$days]){
    foreach([0,1,intdiv($days,2),$days-1]as$used)foreach([0,1,2]as$delay){
        $property=upgradeFixture();$sourceAmount=$months===12?333000:33300;$startEpoch=strtotime($periodStart);
        $quoteEpoch=$startEpoch+$used*86400;$quoteStamp=gmdate('Y-m-d\TH:i:s\Z',$quoteEpoch);
        upgradeOrder($property,'base','standart',$months,$sourceAmount,$periodStart);
        genesisBillingApplyReceipt($property,upgradeReceipt('base',$sourceAmount,$periodStart),$quoteEpoch);
        $propertyQuote=genesisBillingUpgradeQuote($property,'buyer',upgradeOffer('premium',$months),$quoteEpoch);
        $cash=$propertyQuote['amountMinor'];upgradeOrder($property,'target','premium',$months,$cash,$quoteStamp,$propertyQuote);
        $refund=intdiv($sourceAmount*($invariantCases%4),4);$netSource=$sourceAmount-$refund;
        $captureEpoch=$quoteEpoch+$delay*86400;$captureStamp=gmdate('Y-m-d\TH:i:s\Z',$captureEpoch);
        genesisBillingApplyReceipt($property,upgradeReceipt('base',$sourceAmount,$periodStart,refundedAmountMinor:$refund),$captureEpoch);
        $targetRefund=$invariantCases%3===0?intdiv($cash,4):0;
        genesisBillingApplyReceipt($property,upgradeReceipt('target',$cash,$captureStamp,refundedAmountMinor:$targetRefund),$captureEpoch);
        $netEnd=$startEpoch+intdiv($days*86400*$netSource,$sourceAmount);$netDays=(int)ceil(($netEnd-$startEpoch)/86400);
        $netUnused=$captureEpoch>=$netEnd?0:intdiv($netSource*max(0,$netDays-(int)floor(($captureEpoch-$startEpoch)/86400)),$netDays);
        $allowedCredit=min($propertyQuote['creditMinor'],$netUnused);$expectedValue=$cash-$targetRefund+$allowedCredit;
        $actualValue=genesisBillingFundedOrderValue($property,'target');$deficit=$allowedCredit<$propertyQuote['creditMinor'];
        checkUpgrade($actualValue===($deficit?0:$expectedValue)&&$allowedCredit<=$netUnused&&$allowedCredit<=$propertyQuote['creditMinor'],'Applied credit exceeded net unused receipt funding');
        $period=$property->query("SELECT starts_at,ends_at FROM billing_periods WHERE reference_hash='".hash('sha256','ref-target')."'")->fetch();
        checkUpgrade(!$deficit||$period===false,'Capture shortfall issued a shortened target period');
        $granted=$period?strtotime($period['ends_at'])-strtotime($period['starts_at']):0;$nominal=strtotime(genesisBillingPeriodEnd($captureStamp,$months))-$captureEpoch;
        checkUpgrade($granted>=0&&$granted*$propertyQuote['listAmountMinor']<=$nominal*$expectedValue,'Granted seconds exceeded the paid target balance');
        $invariantCases++;
    }
}
checkUpgrade($invariantCases===72,'Invariant matrix was incomplete');

// Two independent SQLite connections interleave at the writer boundary, then retry the same reservation.
$concurrentSource=upgradeFixture();upgradeOrder($concurrentSource,'base','standart',1,33300,$start);
genesisBillingApplyReceipt($concurrentSource,upgradeReceipt('base',33300,$start),$now);
$concurrentPath=tempnam(sys_get_temp_dir(),'genesis-billing-writer-');checkUpgrade(is_string($concurrentPath),'Cannot create concurrency fixture');
try{
    $concurrentSource->exec('VACUUM INTO '.$concurrentSource->quote($concurrentPath));
    $connections=[];for($i=0;$i<2;$i++){
        $connection=new PDO('sqlite:'.$concurrentPath,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
        $connection->exec('PRAGMA busy_timeout=0');$connection->exec('PRAGMA foreign_keys=ON');$connections[]=$connection;
    }
    [$writerA,$writerB]=$connections;$writerA->beginTransaction();$writerA->exec("UPDATE users SET subscription_plan=subscription_plan WHERE id='buyer'");
    $writerB->beginTransaction();$blocked=false;
    try{$writerB->exec("UPDATE users SET subscription_plan=subscription_plan WHERE id='buyer'");}
    catch(PDOException $expected){$blocked=str_contains(strtolower($expected->getMessage()),'locked');}
    $writerB->rollBack();checkUpgrade($blocked,'A concurrent checkout bypassed the SQLite writer');
    $oneQuote=genesisBillingUpgradeQuote($writerA,'buyer',upgradeOffer(),$now);upgradeOrder($writerA,'target','premium',1,38850,$at,$oneQuote);$writerA->commit();
    $writerB->beginTransaction();$writerB->exec("UPDATE users SET subscription_plan=subscription_plan WHERE id='buyer'");
    $twoQuote=genesisBillingUpgradeQuote($writerB,'buyer',upgradeOffer(),$now);$writerB->commit();
    checkUpgrade($twoQuote['pendingOrderId']==='target'&&(int)$writerB->query('SELECT COUNT(*) FROM billing_upgrade_credits')->fetchColumn()===1,'Concurrent retry spent a reserved source twice');
}finally{
    $connections=[];$writerA=null;$writerB=null;$connection=null;
    if(is_file($concurrentPath))unlink($concurrentPath);
}

// Discounted Lifetime is explicitly closed and cannot fall back to an unexpected full-price charge.
$lifeQuote=genesisBillingUpgradeQuote($year,'buyer',upgradeOffer('premium4life',0),$now);
checkUpgrade($lifeQuote['creditMinor']>0&&$lifeQuote['upgradeUnavailableReason']==='lifetime-credit-unavailable'&&$lifeQuote['availableProviders']===[],'Discounted Lifetime was silently offered at a full or unsafe price');
checkUpgrade(genesisBillingUpgradeQuote(upgradeFixture(),'buyer',upgradeOffer('premium4life',0),$now)['upgradeUnavailableReason']===null,'Ordinary Lifetime without credit was disabled');

// Test-shop evidence cannot create live access or money, before or after authorization.
foreach([true,'true',1]as$testMode){
    try{genesisBillingYooReceipt(upgradePayment('target',38850,$at,['test'=>$testMode]),$raceOrder,['shop_id'=>'synthetic-shop']);throw new RuntimeException('Test receipt accepted');}
    catch(DomainException $expected){checkUpgrade($expected->getMessage()==='BILLING_TEST_PAYMENT_UNSUPPORTED','Wrong test-mode error');}
}
$testCalls=0;
try{genesisBillingYooSettleUpgrade($race,[...$waiting,'test'=>true],$raceOrder,['shop_id'=>'synthetic-shop','secret_key'=>'synthetic'],function()use(&$testCalls):array{$testCalls++;return[];},$now);throw new RuntimeException('Test capture accepted');}
catch(DomainException $expected){checkUpgrade($testCalls===0&&$expected->getMessage()==='BILLING_TEST_PAYMENT_UNSUPPORTED','Test authorization reached a capture call');}

// Provider-confirmed Lemon partial refunds enter the same net ledger; test orders never do.
$lemon=upgradeFixture();upgradeOrder($lemon,'target','premium',1,689,$start);
$lemon->exec("UPDATE billing_orders SET provider='lemon-squeezy',currency='USD',product_id='12345' WHERE id='target'");
$lemonOrder=$lemon->query("SELECT * FROM billing_orders WHERE id='target'")->fetch();
$lemonPayment=['data'=>['id'=>'synthetic-lemon-payment','attributes'=>['store_id'=>1,'first_order_item'=>['variant_id'=>12345],
    'status'=>'partial_refund','total'=>689,'currency'=>'USD','refunded_amount'=>100,'created_at'=>$start,'test_mode'=>false]]];
$lemonReceipt=genesisBillingLemonReceipt($lemonPayment,$lemonOrder,['store_id'=>'1']);
genesisBillingApplyReceipt($lemon,$lemonReceipt,$now);
checkUpgrade($lemonReceipt->refundedAmountMinor===100&&genesisBillingFundedOrderValue($lemon,'target')===589,'Lemon partial refund did not reduce net funding');
try{$testLemon=$lemonPayment;$testLemon['data']['attributes']['test_mode']=true;genesisBillingLemonReceipt($testLemon,$lemonOrder,['store_id'=>'1']);throw new RuntimeException('Lemon test grant accepted');}
catch(DomainException $expected){checkUpgrade($expected->getMessage()==='BILLING_TEST_PAYMENT_UNSUPPORTED','Wrong Lemon test-mode error');}

// Google confirms a normal paid SKU but does not expose its actual price/currency in ProductPurchase v1.
$play=upgradeFixture();upgradeOrder($play,'target','premium',1,55500,$start);
$play->exec("UPDATE billing_orders SET provider='google-play' WHERE id='target'");$playOrder=$play->query("SELECT * FROM billing_orders WHERE id='target'")->fetch();
$playOrder['owner_hash']='synthetic-owner';$playPayment=['obfuscatedExternalAccountId'=>'synthetic-owner',
    'obfuscatedExternalProfileId'=>hash('sha256','target'),'purchaseState'=>0,'purchaseTimeMillis'=>(string)(strtotime($start)*1000)];
foreach([0,1,2]as$type){try{genesisBillingPlayReceipt([...$playPayment,'purchaseType'=>$type],$playOrder,'synthetic-token');throw new RuntimeException('Non-monetary Play purchase accepted');}
    catch(DomainException $expected){checkUpgrade($expected->getMessage()==='BILLING_TEST_PAYMENT_UNSUPPORTED','Wrong non-monetary Play error');}}
$playAccess=genesisBillingApplyReceipt($play,genesisBillingPlayReceipt($playPayment,$playOrder,'synthetic-paid-token'),$now);
checkUpgrade($playAccess['plan']==='premium','Normal paid Play SKU lost its access grant');
$playQuote=genesisBillingUpgradeQuote($play,'buyer',upgradeOffer('business'),$now);
checkUpgrade($playQuote['availableProviders']===[]&&$playQuote['upgradeUnavailableReason']==='credit-source-unverified','Unverified regional Play price became monetary upgrade credit');

// Actual096/099 rollback and pre-migration backup: old orders/receipts and old-style writers survive.
$migration=upgradeFixture(['093_billing_infrastructure']);
$migration->exec("INSERT INTO billing_orders(id,user_id,idempotency_key,provider,plan,period_months,amount_minor,currency,product_id,created_at,updated_at)
    VALUES('legacy','buyer','legacy','yookassa','standart',1,33300,'RUB','legacy-product','2026-11-01T10:00:00Z','2026-11-01T10:00:00Z')");
$migration->exec("INSERT INTO billing_receipts(provider,reference_hash,order_id,state,confirmed_at,evidence_hash,verified_at)
    VALUES('yookassa','legacy-reference','legacy','paid','2026-11-01T10:00:00Z','legacy-evidence','2026-11-01T10:00:00Z')");
$backupPath=tempnam(sys_get_temp_dir(),'genesis-billing-099-');checkUpgrade(is_string($backupPath),'Cannot create migration backup fixture');
try{
    $migration->exec('VACUUM INTO '.$migration->quote($backupPath));
    $migration->beginTransaction();
    foreach(['096_billing_upgrade_credit','099_billing_refund_amount','100_billing_settlement']as$name)$migration->exec(file_get_contents(dirname(__DIR__).'/migrations/'.$name.'.sql'));
    checkUpgrade(in_array('refunded_amount_minor',array_column($migration->query('PRAGMA table_info(billing_receipts)')->fetchAll(),'name'),true),'Refund migration did not run');
    $migration->rollBack();
    checkUpgrade(!in_array('list_amount_minor',array_column($migration->query('PRAGMA table_info(billing_orders)')->fetchAll(),'name'),true)
        &&!in_array('refunded_amount_minor',array_column($migration->query('PRAGMA table_info(billing_receipts)')->fetchAll(),'name'),true)
        &&(int)$migration->query("SELECT COUNT(*) FROM sqlite_master WHERE name IN ('billing_upgrade_credits','billing_settlements')")->fetchColumn()===0
        &&!in_array('encrypted_receipt',array_column($migration->query('PRAGMA table_info(billing_orders)')->fetchAll(),'name'),true),'Actual billing migrations did not roll back atomically');
    foreach(['096_billing_upgrade_credit','099_billing_refund_amount','100_billing_settlement']as$name)$migration->exec(file_get_contents(dirname(__DIR__).'/migrations/'.$name.'.sql'));
    $migration->exec("UPDATE billing_orders SET status='paid' WHERE id='legacy'; UPDATE billing_receipts SET verified_at='2026-11-02T10:00:00Z' WHERE order_id='legacy'");
    checkUpgrade($migration->query("SELECT refunded_amount_minor FROM billing_receipts WHERE order_id='legacy'")->fetchColumn()===0,'Legacy receipt acquired an invented refund');
    checkUpgrade(genesisBillingFundedOrderValue($migration,'legacy')===33300&&$migration->query('SELECT body FROM blobs')->fetchColumn()==='opaque encrypted document','Additive migrations changed legacy money or encrypted data');
    $backup=new PDO('sqlite:'.$backupPath);
    checkUpgrade($backup->query('PRAGMA integrity_check')->fetchColumn()==='ok'&&!in_array('refunded_amount_minor',array_column($backup->query('PRAGMA table_info(billing_receipts)')->fetchAll(PDO::FETCH_ASSOC),'name'),true),'Backup is not intact pre-migration evidence');
}finally{$backup=null;if(is_file($backupPath))unlink($backupPath);}
echo "PASS upgrade billing: immutable pending quotes, atomic reservation/retry, capture boundary/source-refund races, net partial/full refunds, upgrade chains, Lifetime credit closure, live/test isolation, actual migration backup/rollback and legacy/encrypted-data preservation.\n";
