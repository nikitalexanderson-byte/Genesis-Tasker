<?php
declare(strict_types=1);
// Isolated real API functions with synthetic SQLite/config and an injected checkout. No network/config.php.
if(PHP_SAPI!=='cli')exit(1);
function genesisDb(): PDO {return $GLOBALS['ordersFixtureDb'];}
function genesisConfig(): array {return $GLOBALS['ordersFixtureConfig'];}
function genesisFindUser(string $id): ?array {$q=genesisDb()->prepare('SELECT * FROM users WHERE id=?');$q->execute([$id]);return $q->fetch()?:null;}
function genesisSessionIsPrimaryGoogleUser(array $user): bool {return $user['auth_provider']==='google'&&$user['google_sub']!=='';}
function genesisUuid(): string {static $counter=0;return '00000000-0000-4000-8000-'.str_pad((string)++$counter,12,'0',STR_PAD_LEFT);}
function genesisNow(): string {return gmdate('Y-m-d\TH:i:s\Z');}
function genesisIdentifierHash(string $namespace,string $value): string {return hash_hmac('sha256',$namespace."\0".$value,'synthetic-order-key');}
function genesisSharedContentEncrypt(string $value): string {return 'fixture:'.base64_encode($value);}
function genesisSharedContentDecrypt(string $value): string {return base64_decode(substr($value,8),true);}
require dirname(__DIR__).'/src/feature-access.php';
require_once dirname(__DIR__).'/src/resource-limits.php';
require dirname(__DIR__).'/src/billing-api.php';
function orderCheck(bool $ok,string $message): void {if(!$ok)throw new RuntimeException($message);}
function orderReject(string $code,callable $action): void {
    try{$action();}catch(GenesisResourceLimitException|DomainException|InvalidArgumentException $error){orderCheck($error->getMessage()===$code,'Wrong rejection: '.$error->getMessage());return;}
    throw new RuntimeException('Expected rejection: '.$code);
}
$db=new PDO('sqlite::memory:',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
$GLOBALS['ordersFixtureDb']=$db;
$db->exec("PRAGMA foreign_keys=ON;CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,google_sub TEXT,auth_provider TEXT,subscription_plan TEXT,subscription_valid_until TEXT);
    INSERT INTO users VALUES('buyer','buyer@example.invalid','synthetic-google','google','free',NULL),('other','other@example.invalid','synthetic-other','google','free',NULL)");
foreach(['093_billing_infrastructure','096_billing_upgrade_credit','099_billing_refund_amount','100_billing_settlement','101_billing_pending_order_deletion_guard']as$name)$db->exec(file_get_contents(dirname(__DIR__).'/migrations/'.$name.'.sql'));
$db->exec("CREATE TABLE resource_quota_limits(name TEXT PRIMARY KEY,amount INTEGER);INSERT INTO resource_quota_limits VALUES('tasks_per_user',1)");
$definition=genesisBillingDefinition();$definition['checkoutEnabled']=true;$definition['creditCheckoutEnabled']=true;
$offers=[];foreach(genesisBillingCatalog([])['offers']as$index=>$offer)$offers[$offer['id']]=['products'=>['yookassa'=>'yoo-'.$index,'google-play'=>'play-'.$index,'lemon-squeezy'=>(string)(12345+$index)]];
$GLOBALS['ordersFixtureConfig']=['app_url'=>'https://example.invalid','billing'=>['enabled'=>true,'credit_settlement_verified'=>true,'offers'=>$offers,'providers'=>[
    'yookassa'=>['shop_id'=>'synthetic','secret_key'=>'synthetic','vat_code'=>1,'receipt_required'=>false],
    'lemon-squeezy'=>['api_key'=>'synthetic','store_id'=>'1','webhook_secret'=>'synthetic','currency'=>'USD','tax_inclusive'=>true,'gross_total_verified'=>true],
    'google-play'=>['service_account_email'=>'synthetic@example.invalid','service_account_private_key'=>'synthetic-not-real']
]]];
$checkoutCalls=0;$checkout=function(array $order,array $configuration,string $returnUrl)use(&$checkoutCalls):array{
    orderCheck($returnUrl==='https://example.invalid/?billingOrder='.rawurlencode($order['id']).'#settings/account','Return URL lost immutable order identity');
    $checkoutCalls++;return ['checkoutUrl'=>'https://example.invalid/checkout/'.$order['id'],'providerReference'=>'synthetic-'.$order['id']];
};
function orderInput(string $key,string $provider,int $amount,?string $currency): array {
    $result=['offerId'=>'premium:1','provider'=>$provider,'client'=>'web','idempotencyKey'=>$key,'expectedAmountMinor'=>$amount];
    if($currency!==null)$result['expectedCurrency']=$currency;return$result;
}
// Public sales flags and configured providers cannot bypass the separate private closure gate.
foreach(['lemon-squeezy','yookassa']as$provider){
    $input=orderInput('closure-readiness-'.$provider,$provider,$provider==='lemon-squeezy'?700:55500,$provider==='lemon-squeezy'?'USD':'RUB');
    orderReject('BILLING_ORDER_INVALID',fn()=>genesisBillingCreateOrder('buyer',[...$input,'pending_order_closure_verified'=>true],$definition,$checkout));
    orderReject('BILLING_NOT_CONFIGURED',fn()=>genesisBillingCreateOrder('buyer',$input,$definition,$checkout));
    foreach([null,false,0,1,'true',[]]as$unverified){
        $GLOBALS['ordersFixtureConfig']['billing']['pending_order_closure_verified']=$unverified;
        orderReject('BILLING_NOT_CONFIGURED',fn()=>genesisBillingCreateOrder('buyer',$input,$definition,$checkout));
    }
    unset($GLOBALS['ordersFixtureConfig']['billing']['pending_order_closure_verified']);
}
orderCheck($checkoutCalls===0&&(int)$db->query('SELECT COUNT(*) FROM billing_orders')->fetchColumn()===0,'Unverified closure reached checkout or created a payable order');
$GLOBALS['ordersFixtureConfig']['billing']['pending_order_closure_verified']=true; // Synthetic readiness only.
foreach([
    orderInput('bad-rubles-as-dollars','lemon-squeezy',55500,'RUB'),
    orderInput('stale-dollar-price','lemon-squeezy',689,'USD'),
    orderInput('bad-currency-missing','lemon-squeezy',700,null),
    orderInput('bad-currency-same-number','lemon-squeezy',700,'RUB'),
    orderInput('bad-rub-currency-missing','yookassa',55500,null)
]as$input)orderReject('BILLING_QUOTE_CHANGED',fn()=>genesisBillingCreateOrder('buyer',$input,$definition,$checkout));
orderCheck($checkoutCalls===0&&(int)$db->query('SELECT COUNT(*) FROM billing_orders')->fetchColumn()===0,'Invalid expected price/currency created a payable order');
$input=orderInput('valid-dollar-order-key','lemon-squeezy',700,'USD');
$dollars=genesisBillingCreateOrder('buyer',$input,$definition,$checkout);
orderCheck($dollars['amountMinor']===700&&$dollars['listAmountMinor']===700&&$dollars['currency']==='USD'&&$checkoutCalls===1,'Foreign order used RUB magnitude instead of USD cents');
orderCheck(genesisBillingCreateOrder('buyer',$input,$definition,$checkout)['id']===$dollars['id']&&$checkoutCalls===1,'Idempotent retry created a second checkout');
orderReject('BILLING_QUOTE_CHANGED',fn()=>genesisBillingCreateOrder('buyer',[...$input,'expectedCurrency'=>'RUB'],$definition,$checkout));
orderReject('BILLING_QUOTE_CHANGED',fn()=>genesisBillingCreateOrder('buyer',[...$input,'expectedAmountMinor'=>689],$definition,$checkout));
$rubles=genesisBillingCreateOrder('other',orderInput('valid-ruble-order-key','yookassa',55500,'RUB'),$definition,$checkout);
orderCheck($rubles['amountMinor']===55500&&$rubles['currency']==='RUB','Domestic order changed denomination');
$rubleCallCount=$checkoutCalls;
$rubleRetry=genesisBillingCreateOrder('other',orderInput('ruble-dialog-reopened','yookassa',55500,'RUB'),$definition,$checkout);
orderCheck($rubleRetry['id']===$rubles['id']&&$checkoutCalls===$rubleCallCount,'Reopened full-price Yoo dialog created a second payable checkout');

// Real create/reserve/pending paths use current account funding, and never fall back to an unconsented price.
$now=time();$sourceAt=gmdate('Y-m-d\TH:i:s\Z',$now-15*86400);
$db->prepare('INSERT INTO billing_orders(id,user_id,idempotency_key,provider,plan,period_months,amount_minor,currency,product_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)')->execute(['synthetic-source','buyer','synthetic-source','yookassa','standart',1,33300,'RUB','synthetic-base',$sourceAt,$sourceAt]);
genesisBillingApplyReceipt($db,new GenesisVerifiedBillingReceipt('yookassa','synthetic-source-payment','synthetic-source','paid',33300,'RUB','synthetic-base',$sourceAt,hash('sha256','synthetic-source-evidence')),$now);
$catalog=genesisBillingCatalog(genesisBillingSettings(),'web',$definition);
foreach($catalog['offers']as$offer)if($offer['id']==='premium:1')$premium=genesisBillingProviderOffer($offer,'yookassa');
$quote=genesisBillingUpgradeQuote($db,'buyer',$premium,$now);
orderCheck($quote['creditMinor']>0&&$quote['amountMinor']<55500,'Source fixture did not create an unused paid balance');
$discountInput=orderInput('discounted-order-key','yookassa',$quote['amountMinor'],'RUB');
$closedDefinition=[...$definition,'creditCheckoutEnabled'=>false];
orderReject('BILLING_CREDIT_CHECKOUT_DISABLED',fn()=>genesisBillingCreateOrder('buyer',$discountInput,$closedDefinition,$checkout));
$GLOBALS['ordersFixtureConfig']['billing']['credit_settlement_verified']=false;
orderReject('BILLING_CREDIT_CHECKOUT_DISABLED',fn()=>genesisBillingCreateOrder('buyer',$discountInput,$definition,$checkout));
$GLOBALS['ordersFixtureConfig']['billing']['credit_settlement_verified']=true;
$discount=genesisBillingCreateOrder('buyer',$discountInput,$definition,$checkout);
orderCheck($discount['creditMinor']===$quote['creditMinor']&&$discount['amountMinor']===$quote['amountMinor'],'CreateOrder discarded the quote credit');
$callCount=$checkoutCalls;
$retry=genesisBillingCreateOrder('buyer',[...$discountInput,'idempotencyKey'=>'discounted-second-key'],$definition,$checkout);
orderCheck($retry['id']===$discount['id']&&$checkoutCalls===$callCount&&(int)$db->query('SELECT COUNT(*) FROM billing_upgrade_credits')->fetchColumn()===1,'New retry key spent a reserved source twice');
orderReject('BILLING_QUOTE_CHANGED',fn()=>genesisBillingCreateOrder('buyer',[...$discountInput,'expectedAmountMinor'=>55500],$definition,$checkout));
orderReject('BILLING_UPGRADE_UNAVAILABLE',fn()=>genesisBillingCreateOrder('buyer',orderInput('different-pending-provider','lemon-squeezy',700,'USD'),$definition,$checkout));
$repriced=$definition;$repriced['prices']['premium']['1']+=1000;
$stillPending=genesisBillingCreateOrder('buyer',[...$discountInput,'idempotencyKey'=>'repriced-pending-key'],$repriced,$checkout);
orderCheck($stillPending['id']===$discount['id']&&$stillPending['amountMinor']===$quote['amountMinor'],'Catalog repricing replaced a pending charge');
$life=[...$discountInput,'offerId'=>'premium4life:0','idempotencyKey'=>'lifetime-full-price-fallback','expectedAmountMinor'=>1290000];
orderReject('BILLING_UPGRADE_UNAVAILABLE',fn()=>genesisBillingCreateOrder('buyer',$life,$definition,$checkout));
orderCheck($checkoutCalls===$callCount,'A rejected price/provider/Lifetime attempt opened checkout');

// Refund fiscal data is immutable server-encrypted evidence, never a public order field.
$GLOBALS['ordersFixtureConfig']['billing']['providers']['yookassa']['receipt_required']=true;
$db->exec("INSERT INTO users VALUES('fiscal-buyer','fiscal@example.invalid','synthetic-fiscal','google','free',NULL)");
$fiscalOrder=genesisBillingCreateOrder('fiscal-buyer',[...orderInput('fiscal-receipt-order-key','yookassa',55500,'RUB'),'receiptEmail'=>'receipt@example.invalid'],$definition,$checkout);
$storedFiscal=genesisBillingOrder($db,$fiscalOrder['id']);$receipt=json_decode(genesisSharedContentDecrypt($storedFiscal['encrypted_receipt']),true,16,JSON_THROW_ON_ERROR);
orderCheck($receipt['customer']['email']==='receipt@example.invalid'&&!isset($fiscalOrder['encrypted_receipt'])&&!str_contains(json_encode($fiscalOrder),'receipt@example.invalid'),'Fiscal snapshot lost original customer or leaked private receipt');

// A provider callback during checkout creation must not resurrect a blocked checkout URL.
$db->exec("INSERT INTO users VALUES('race','race@example.invalid','synthetic-race','google','free',NULL)");
$db->prepare('INSERT INTO billing_orders(id,user_id,idempotency_key,provider,plan,period_months,amount_minor,currency,product_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    ->execute(['race-source','race','race-source','yookassa','standart',1,33300,'RUB','synthetic-base',$sourceAt,$sourceAt]);
genesisBillingApplyReceipt($db,new GenesisVerifiedBillingReceipt('yookassa','race-source-payment','race-source','paid',33300,'RUB','synthetic-base',$sourceAt,hash('sha256','race-source-evidence')),$now);
$raceQuote=genesisBillingUpgradeQuote($db,'race',$premium,$now);
$raceCheckout=static function(array $order,array $configuration,string $returnUrl)use($db,$checkout,$now):array{
    $result=$checkout($order,$configuration,$returnUrl);
    genesisBillingSettlementCaptureBegin($db,$order,'capture',$now);
    return $result;
};
$race=genesisBillingCreateOrder('race',orderInput('race-checkout-key','yookassa',$raceQuote['amountMinor'],'RUB'),$definition,$raceCheckout);
orderCheck($race['checkoutUrl']===null&&$race['status']==='payment-verifying'&&$race['settlement']['status']==='verifying','Gateway response overrode a settlement created during checkout I/O');
// Every fixed USD offer reaches the real quote/create/gateway-preview chain with identical integer cents.
// This is an independent acceptance matrix; no live settings or provider network are read.
$usdMatrix=['standart:1'=>400,'standart:12'=>4000,'premium:1'=>700,'premium:12'=>7000,'business:1'=>1000,'business:12'=>10000,'premium4life:0'=>16000];
$usdCatalog=genesisBillingCatalog(genesisBillingSettings(),'web',$definition);
foreach($usdCatalog['offers']as$index=>$publicOffer){
    $expected=$usdMatrix[$publicOffer['id']];$matrixUser='usd-matrix-'.$index;
    $db->prepare('INSERT INTO users VALUES(?,?,?,?,?,NULL)')->execute([$matrixUser,$matrixUser.'@example.invalid',$matrixUser,'google','free']);
    $priced=genesisBillingProviderOffer($publicOffer,'lemon-squeezy');
    $matrixQuote=genesisBillingUpgradeQuote($db,$matrixUser,$priced,time());
    orderCheck($priced['amountMinor']===$expected&&$matrixQuote['listAmountMinor']===$expected&&$matrixQuote['amountMinor']===$expected&&$matrixQuote['currency']==='USD','Fixed USD catalog and quote diverged: '.$publicOffer['id']);
    $matrixInput=[...orderInput('fixed-usd-matrix-key-'.$index,'lemon-squeezy',$expected,'USD'),'offerId'=>$publicOffer['id']];
    $providerCalls=0;
    $matrixGateway=static function(array $order,array $configuration,string $returnUrl)use($expected,&$providerCalls):array{
        orderCheck((int)$order['amount_minor']===$expected&&(int)$order['list_amount_minor']===$expected&&$order['currency']==='USD','Persisted order changed fixed USD amount');
        return genesisBillingGatewayCheckout($order,$configuration,$returnUrl,static function($method,$url,$body)use($expected,&$providerCalls):array{
            $providerCalls++;$attributes=$body['data']['attributes'];$variant=$attributes['product_options']['enabled_variants'][0];
            orderCheck($method==='POST'&&str_ends_with($url,'/checkouts')&&$attributes['custom_price']===$expected&&$attributes['preview']===true,'Provider request changed fixed USD amount');
            return ['data'=>['id'=>'synthetic-fixed-'.$expected,'attributes'=>['store_id'=>1,'variant_id'=>$variant,'custom_price'=>$expected,'test_mode'=>false,
                'url'=>'https://example.invalid/fixed-checkout','preview'=>['currency'=>'USD','total'=>$expected,'discount_total'=>0]]]];
        });
    };
    $matrixOrder=genesisBillingCreateOrder($matrixUser,$matrixInput,$definition,$matrixGateway);
    orderCheck($providerCalls===1&&$matrixOrder['amountMinor']===$expected&&$matrixOrder['listAmountMinor']===$expected&&$matrixOrder['currency']==='USD','Checkout and preview diverged from fixed USD quote');
    $changedDefinition=$definition;
    if($publicOffer['plan']==='premium4life')$changedDefinition['foreignPricing']['lifetimeAmountMinor']++;
    else $changedDefinition['foreignPricing']['prices'][$publicOffer['plan']][(string)$publicOffer['periodMonths']]++;
    $retried=genesisBillingCreateOrder($matrixUser,$matrixInput,$changedDefinition,$matrixGateway);
    orderCheck($retried['id']===$matrixOrder['id']&&$retried['amountMinor']===$expected&&$providerCalls===1,'Fixed USD revision rewrote an immutable pending order');
}

// A pending order created under the previous USD catalog keeps its historical 689-cent charge.
$db->exec("INSERT INTO users VALUES('legacy-usd','legacy-usd@example.invalid','legacy-usd','google','free',NULL)");
$db->prepare('INSERT INTO billing_orders(id,user_id,idempotency_key,provider,plan,period_months,amount_minor,currency,product_id,created_at,updated_at,list_amount_minor,upgrade_credit_minor,checkout_url) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    ->execute(['legacy-usd-order','legacy-usd','legacy-usd-order-key','lemon-squeezy','premium',1,689,'USD',$offers['premium:1']['products']['lemon-squeezy'],genesisNow(),genesisNow(),689,0,'https://example.invalid/historical-checkout']);
$historical=genesisBillingCreateOrder('legacy-usd',orderInput('legacy-usd-order-key','lemon-squeezy',689,'USD'),$definition,static function():array{throw new RuntimeException('Historical checkout was recreated');});
orderCheck($historical['amountMinor']===689&&$historical['listAmountMinor']===689&&$historical['currency']==='USD','Fixed catalog repriced a historical order');

echo "PASS billing orders: strict private pending-closure gate before order/provider I/O, real CreateOrder rejects absent/wrong currency and RUB-as-USD, binds all seven fixed USD catalog/quote/order/provider-preview amounts, immutable idempotent/pending orders, atomic credit retry, price changes and no Lifetime full-price fallback; synthetic DB/config, no network.\n";
