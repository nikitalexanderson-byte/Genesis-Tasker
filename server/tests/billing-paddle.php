<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') exit(1);

function paddleCheck(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}
function paddleReject(string $code, callable $operation): void
{
    try { $operation(); }
    catch (GenesisResourceLimitException|DomainException|InvalidArgumentException $error) {
        paddleCheck($error->getMessage() === $code, 'Wrong rejection: '.$error->getMessage());
        return;
    }
    throw new RuntimeException('Expected rejection: '.$code);
}

$private = [
    'schema_version'=>1, 'seller_id'=>476362, 'enabled'=>true, 'verified'=>true,
    'api_key'=>'pdl_live_apikey_SYNTHETIC_ONLY_TEST_CONFIGURATION',
    'client_token'=>'live_SYNTHETIC_ONLY_TEST', 'webhook_secret'=>'synthetic-paddle-webhook-secret',
];
$localConfig = tempnam(sys_get_temp_dir(), 'genesis-paddle-config-');
file_put_contents($localConfig, '<?php return '.var_export([
    'app_url'=>'https://genesis.invalid', 'crypto_key'=>base64_encode(str_repeat('t',32)),
    'billing'=>['paddle_live'=>$private],
], true).';');
define('GENESIS_LOCAL_TEST_CONFIG', $localConfig);
define('GENESIS_STATELESS_REQUEST', true);

try {
    require_once dirname(__DIR__).'/src/bootstrap.php';
    require_once dirname(__DIR__).'/src/feature-access.php';
    require_once dirname(__DIR__).'/src/billing-api.php';
    $db = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    $db->exec("PRAGMA foreign_keys = ON;
        CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,google_sub TEXT,auth_provider TEXT,subscription_plan TEXT,subscription_valid_until TEXT);
        INSERT INTO users VALUES('buyer','buyer@example.invalid','buyer-google','google','free',NULL),
            ('legacy','legacy@example.invalid','legacy-google','google','free',NULL);
        CREATE TABLE linked_google_accounts(id TEXT,owner_user_id TEXT,google_sub TEXT,email TEXT);
        CREATE TABLE resource_quota_limits(name TEXT PRIMARY KEY,amount INTEGER);
        INSERT INTO resource_quota_limits VALUES('tasks_per_user',1);
        CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL);");
    foreach (['093_billing_infrastructure','096_billing_upgrade_credit','099_billing_refund_amount',
        '100_billing_settlement','101_billing_pending_order_deletion_guard','105_billing_yookassa_recovery'] as $name)
        $db->exec(file_get_contents(dirname(__DIR__).'/migrations/'.$name.'.sql'));
    $db->exec("ALTER TABLE billing_orders ADD COLUMN referral_discount_minor INTEGER NOT NULL DEFAULT 0 CHECK(referral_discount_minor>=0);
        ALTER TABLE billing_orders ADD COLUMN referral_reward_month TEXT;
        INSERT INTO billing_orders(id,user_id,idempotency_key,provider,plan,period_months,amount_minor,currency,product_id,created_at,updated_at,status)
            VALUES('legacy','legacy','old-key','yookassa','premium',1,55500,'RUB','old-product','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z','paid');
        INSERT INTO billing_receipts(provider,reference_hash,order_id,state,confirmed_at,evidence_hash,verified_at)
            VALUES('yookassa','old-receipt','legacy','paid','2026-11-01T00:00:00Z','old-evidence','2026-11-01T00:00:00Z');
        INSERT INTO billing_periods VALUES('yookassa','old-receipt','legacy','premium','2026-11-01T00:00:00Z','2026-12-01T00:00:00Z');");
    $old = array_map(fn($table)=>$db->query('SELECT * FROM '.$table)->fetchAll(), ['billing_orders','billing_receipts','billing_periods']);
    $migration = '141_paddle_billing.sql';
    $sql = file_get_contents(dirname(__DIR__).'/migrations/'.$migration);
    genesisMigratePaddleBilling($db,$sql,$migration);
    genesisMigratePaddleBilling($db,$sql,$migration);
    paddleCheck($old === array_map(fn($table)=>$db->query('SELECT * FROM '.$table)->fetchAll(), ['billing_orders','billing_receipts','billing_periods'])
        && (int)$db->query('PRAGMA foreign_keys')->fetchColumn()===1 && $db->query('PRAGMA foreign_key_check')->fetch()===false,
        'Paddle migration changed historical records or foreign keys');

    $configuration = genesisBillingSettings()['providers']['paddle'];
    $web = genesisBillingCatalog(genesisBillingSettings(),'web');
    paddleCheck($web['checkoutEnabled']&&array_column($web['providers'],'id')===['yookassa','paddle']
        && !str_contains(json_encode($web, JSON_THROW_ON_ERROR), 'SYNTHETIC'), 'Paddle catalog readiness or privacy changed');
    foreach (['android','android-play'] as $client)
        paddleCheck(!genesisBillingCatalog(genesisBillingSettings(),$client)['checkoutEnabled'],'Paddle exposed to native billing');
    $disabled = genesisBillingPaddlePrivateSettings([], [...$private,'verified'=>false]);
    paddleCheck(!genesisBillingCatalog($disabled)['checkoutEnabled'], 'Unverified Paddle checkout became sellable');

    $offer = genesisBillingProviderOffer(array_values(array_filter($web['offers'],fn($offer)=>$offer['id']==='premium:1'))[0],'paddle');
    $priceId = GENESIS_PADDLE_PRICE_IDS['premium:1'];
    $price = ['id'=>$priceId,'status'=>'active','billing_cycle'=>null,'trial_period'=>null,'quantity'=>['minimum'=>1,'maximum'=>1],
        'unit_price'=>['currency_code'=>'USD','amount'=>'700'],'unit_price_overrides'=>[]];
    $orderId = 'synthetic-paddle-order';
    $now = time(); $stamp = gmdate('Y-m-d\TH:i:s\Z',$now);
    $db->prepare('INSERT INTO billing_orders(id,user_id,idempotency_key,provider,plan,period_months,amount_minor,currency,product_id,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)')->execute([$orderId,'buyer','local-paddle-key','paddle','premium',1,700,'USD',$priceId,$stamp,$stamp]);
    $order = genesisBillingOrder($db,$orderId);
    paddleCheck($offer['availableProviders']===['paddle']&&$offer['amountMinor']===700
        && genesisBillingUpgradeQuote($db,'buyer',$offer,$now)['pendingOrderId']===$orderId
        && genesisBillingPaddlePriceMatches($price,$order), 'Paddle quote did not resume the same USD order');
    paddleCheck(!genesisBillingPaddlePriceMatches([...$price,'billing_cycle'=>['interval'=>'month','frequency'=>1]],$order),
        'Recurring price accepted for fixed-term purchase');

    $transactionId = 'txn_'.str_repeat('a',26);
    $transaction = ['id'=>$transactionId,'status'=>'draft','currency_code'=>'USD','collection_mode'=>'automatic',
        'items'=>[['quantity'=>1,'price'=>$price]],'custom_data'=>['genesis_order_id'=>$orderId],'created_at'=>$stamp];
    $calls = 0;
    $http = function($method,$url,$body)use(&$calls,$priceId,$price,$transaction,$orderId):array{
        $calls++;
        if ($method==='GET') {
            paddleCheck($url==='https://api.paddle.com/prices/'.$priceId,'Unexpected Paddle price API call');
            return ['data'=>$price];
        }
        paddleCheck($method==='POST'&&$url==='https://api.paddle.com/transactions'&&$body===[
            'items'=>[['price_id'=>$priceId,'quantity'=>1]], 'currency_code'=>'USD',
            'collection_mode'=>'automatic','custom_data'=>['genesis_order_id'=>$orderId],
        ],'Checkout sent a different price, received customer data, or enabled a subscription');
        return ['data'=>$transaction];
    };
    $bound = genesisBillingPaddleCheckout($db,$order,$configuration,$http);
    $retry = genesisBillingPaddleCheckout($db,$bound,$configuration,$http);
    paddleCheck($calls===2 && $retry['provider_secret']===$transactionId
        && genesisBillingPublicOrder($bound,$db)['checkoutUrl']==='https://genesis.invalid/pay-paddle.html?billingOrder='.$orderId
        && genesisBillingPaddleReceipt($transaction,$bound)===null, 'Checkout retry duplicated a charge or granted access');

    $completed = [...$transaction,'status'=>'completed','payments'=>[['status'=>'captured','amount'=>'770','captured_at'=>$stamp]],
        'details'=>['totals'=>['currency_code'=>'USD','grand_total'=>'770','balance'=>'0','discount'=>'0']]];
    paddleReject('BILLING_RECEIPT_MISMATCH',fn()=>genesisBillingPaddleReceipt([...$completed,'currency_code'=>'EUR'],$bound));
    $event = ['event_type'=>'transaction.completed','data'=>['id'=>$transactionId]];
    $body = json_encode($event,JSON_THROW_ON_ERROR);
    $signature = 'ts='.$now.';h1='.hash_hmac('sha256',$now.':'.$body,$private['webhook_secret']);
    paddleReject('BILLING_SIGNATURE_INVALID',fn()=>genesisBillingPaddleEvent($body.' ',$signature,$private['webhook_secret'],$now));
    $verified = genesisBillingPaddleEvent($body,$signature,$private['webhook_secret'],$now);
    $verifyHttp = fn($method,$url)=>['data'=>$completed];
    genesisBillingPaddleWebhook($db,$verified,$configuration,$verifyHttp);
    genesisBillingPaddleWebhook($db,$verified,$configuration,$verifyHttp);
    paddleCheck(genesisBillingOrder($db,$orderId)['status']==='paid'
        && (int)$db->query("SELECT COUNT(*) FROM billing_receipts WHERE provider='paddle'")->fetchColumn()===1,
        'Paddle did not apply one verified receipt');
    $refund = $completed;
    $refund['details']['adjusted_totals'] = ['currency_code'=>'USD','grand_total'=>'0'];
    genesisBillingPaddleWebhook($db,['event_type'=>'adjustment.updated','data'=>['transaction_id'=>$transactionId]],
        $configuration,fn()=>['data'=>$refund]);
    genesisBillingPaddleWebhook($db,$verified,$configuration,$verifyHttp);
    paddleCheck(genesisBillingOrder($db,$orderId)['status']==='refunded'
        && $db->query("SELECT subscription_plan FROM users WHERE id='buyer'")->fetchColumn()==='free',
        'A late paid notification restored refunded access');
    echo "PASS Paddle: existing records preserved, fixed USD, web-only gate, single checkout, verified payment and refund.\n";
} finally {
    unlink($localConfig);
}
