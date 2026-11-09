<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') exit(1);
require dirname(__DIR__) . '/src/feature-access.php';
require dirname(__DIR__) . '/src/billing.php';
require_once dirname(__DIR__) . '/src/resource-limits.php';
require_once dirname(__DIR__) . '/src/billing-gateways.php';
function genesisIdentifierHash(string $namespace,string $value): string { return hash_hmac('sha256',$namespace."\0".strtolower($value),'synthetic-test-key'); }
function billingCheck(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function billingFailure(string $code, callable $action): void {
    try { $action(); throw new RuntimeException('Expected rejection: '.$code); }
    catch (InvalidArgumentException|DomainException $failure) { billingCheck($failure->getMessage() === $code, 'Wrong rejection: '.$failure->getMessage()); }
}
function billingFixture(): PDO {
    $db = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $db->exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY,subscription_plan TEXT NOT NULL,subscription_valid_until TEXT);
        INSERT INTO users VALUES('buyer','free',NULL),('other','free',NULL),('lifetime','premium4life',NULL);
        CREATE TABLE blobs(body TEXT); INSERT INTO blobs VALUES('opaque encrypted workspace');");
    $db->exec((string)file_get_contents(dirname(__DIR__).'/migrations/093_billing_infrastructure.sql'));
    $db->exec((string)file_get_contents(dirname(__DIR__).'/migrations/096_billing_upgrade_credit.sql'));
    $db->exec((string)file_get_contents(dirname(__DIR__).'/migrations/099_billing_refund_amount.sql'));
    $db->exec((string)file_get_contents(dirname(__DIR__).'/migrations/100_billing_settlement.sql'));
    $db->exec((string)file_get_contents(dirname(__DIR__).'/migrations/101_billing_pending_order_deletion_guard.sql'));
    $db->exec((string)file_get_contents(dirname(__DIR__).'/migrations/104_subscription_trials.sql'));
    $db->exec((string)file_get_contents(dirname(__DIR__).'/migrations/111_forecast_elite_plus.sql'));
    $db->exec('CREATE TABLE linked_google_accounts(id TEXT,owner_user_id TEXT,google_sub TEXT,email TEXT)');
    return $db;
}
function billingOrder(PDO $db, string $id, string $user = 'buyer', int $months = 1, string $provider = 'yookassa', string $plan = 'premium'): void {
    $db->prepare('INSERT INTO billing_orders(id,user_id,idempotency_key,provider,plan,period_months,amount_minor,currency,product_id,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)')->execute([$id,$user,$id,$provider,$plan,$months,1000,'USD','product:'.$months,'2028-01-31T10:00:00Z','2028-01-31T10:00:00Z']);
}
function billingReceipt(string $order, string $reference, string $at = '2028-01-31T10:00:00Z', string $state = 'paid',
    string $provider = 'yookassa', int $months = 1, ?string $until = null): GenesisVerifiedBillingReceipt {
    return new GenesisVerifiedBillingReceipt($provider,$reference,$order,$state,1000,'USD','product:'.$months,$at,hash('sha256',$reference.':'.$state),$until);
}

$catalog = genesisBillingCatalog([]);
$prepared=genesisBillingDefinition();billingCheck($prepared['checkoutEnabled']===false&&$prepared['creditCheckoutEnabled']===false,'Unverified live sales were activated');
billingCheck(!$catalog['checkoutEnabled'] && count($catalog['offers']) === 7 && $catalog['periodMonths'] === [1,12], 'Prepared billing catalog is wrong');
foreach ($catalog['providers'] as $provider) billingCheck(!$provider['available'], 'Unconfigured gateway became available');
foreach ($catalog['offers'] as $offer) billingCheck(($offer['plan']==='premium4life' ? $offer['amountMinor']===1290000 && $offer['currency']==='RUB' && $offer['seatLimit']===12 : $offer['amountMinor']===genesisBillingDefinition()['prices'][$offer['plan']][(string)$offer['periodMonths']]) && !$offer['availableProviders'], 'Wrong approved price or active checkout');
$usd=['standart:1'=>400,'standart:12'=>4000,'premium:1'=>700,'premium:12'=>7000,'business:1'=>1000,'business:12'=>10000,'premium4life:0'=>16000];
$rub=['standart:1'=>33300,'standart:12'=>333000,'premium:1'=>55500,'premium:12'=>555000,'business:1'=>77700,'business:12'=>777000,'premium4life:0'=>1290000];
billingCheck($catalog['foreignPricing']['pricingModel']==='fixed'&&$catalog['foreignPricing']['rate']===['quotePerBase'=>'—','effectiveDate'=>'','source'=>''],'Fixed prices advertised a numeric conversion rate or broke legacy web metadata');
foreach($catalog['offers']as$offer){
    foreach(['yookassa','google-play']as$method){$priced=genesisBillingProviderOffer($offer,$method);billingCheck($priced['currency']==='RUB'&&$priced['amountMinor']===$rub[$offer['id']],'Domestic provider changed the approved RUB price');}
    $priced=genesisBillingProviderOffer($offer,'lemon-squeezy');
    billingCheck($priced['currency']==='USD'&&$priced['amountMinor']===$usd[$offer['id']],'Foreign provider diverged from fixed USD prices');
}
$halfUp=['baseCurrency'=>'USD','quoteCurrency'=>'RUB','quotePerBase'=>'2.0000','rounding'=>'half-up-to-minor-unit'];
billingCheck(genesisBillingRubToUsdMinor(1,$halfUp)===1&&genesisBillingRubToUsdMinor(3,$halfUp)===2,'FX half cents were rounded down');
billingFailure('BILLING_FX_INVALID',fn()=>genesisBillingRubToUsdMinor(33300,[...$halfUp,'quotePerBase'=>'2e0']));
$fixed=$prepared['foreignPricing'];
foreach([null,0,-1,400.5,'400']as$invalid)billingCheck(!isset(genesisBillingProviderPrices(33300,$fixed,$invalid)['lemon-squeezy']),'Invalid fixed USD amount enabled a foreign checkout');
billingCheck(genesisBillingProviderPrices(33300,[...$fixed,'rate'=>['quotePerBase'=>'invalid']],400)['lemon-squeezy']['amountMinor']===400,'Fixed USD still depends on RUB conversion');
foreach([['currency'=>'RUB'],['provider'=>'yookassa'],['pricingModel'=>'unknown']]as$invalid)billingCheck(!isset(genesisBillingProviderPrices(33300,[...$fixed,...$invalid],400)['lemon-squeezy']),'Invalid foreign metadata enabled a USD price');
$legacyRate=['baseCurrency'=>'USD','quoteCurrency'=>'RUB','quotePerBase'=>'80.5573','rounding'=>'half-up-to-minor-unit'];
$legacyForeign=['provider'=>'lemon-squeezy','currency'=>'USD','rate'=>$legacyRate];
billingCheck(genesisBillingProviderPrices(33300,$legacyForeign,413)['lemon-squeezy']['amountMinor']===413,'Legacy reviewed FX definition changed');
billingCheck(!isset(genesisBillingProviderPrices(33300,$legacyForeign,400)['lemon-squeezy']),'Unverified legacy FX table enabled a foreign checkout');
$settings = ['enabled'=>true,'credit_settlement_verified'=>true,'providers'=>['lemon-squeezy'=>['api_key'=>'synthetic-key','store_id'=>'1','webhook_secret'=>'synthetic-signing','currency'=>'USD','tax_inclusive'=>true,'gross_total_verified'=>true],
    'yookassa'=>['shop_id'=>'synthetic-shop','secret_key'=>'synthetic-key','vat_code'=>1],
    'google-play'=>['service_account_email'=>'fixture@example.invalid','service_account_private_key'=>'synthetic-private-not-real']],
    'offers'=>['premium:12'=>['amount_minor'=>1000,'currency'=>'USD','products'=>['lemon-squeezy'=>'variant','google-play'=>'product']]]];
$definition = genesisBillingDefinition(); $definition['checkoutEnabled'] = true; $definition['creditCheckoutEnabled'] = true;
billingCheck(genesisBillingCatalog($settings)['checkoutEnabled'] === false, 'Prepared release was activated by configuration alone');
foreach([null,false,0,1,'true',[]]as$unverified){
    $unverifiedSettings=[...$settings,'pending_order_closure_verified'=>$unverified];
    $closed=genesisBillingCatalog($unverifiedSettings,'web',$definition);
    billingCheck(!$closed['checkoutEnabled']&&!$closed['creditCheckoutEnabled']&&!array_filter(array_column($closed['providers'],'available'))
        &&!array_filter(array_column($closed['offers'],'availableProviders')),'Unverified pending closure enabled new sales');
    foreach(GENESIS_BILLING_PROVIDERS as$provider)billingCheck(genesisBillingProviderReady($provider,$unverifiedSettings),'Sales gate blocked configured verification/webhook readiness');
}
$settings['pending_order_closure_verified']=true; // Synthetic readiness, never runtime configuration.
billingCheck(!genesisBillingCatalog($settings)['checkoutEnabled']&&!genesisBillingCatalog($settings)['creditCheckoutEnabled'],'Private readiness alone activated the prepared release');
$web = genesisBillingCatalog($settings,'web',$definition); $play = genesisBillingCatalog($settings,'android-play',$definition);
billingCheck($web['checkoutEnabled']&&$web['creditCheckoutEnabled']&&array_column($web['providers'],'available','id')['yookassa']
    &&array_column($web['providers'],'available','id')['lemon-squeezy'],'Strict true readiness did not preserve eligible configured checkout');
billingCheck(array_column($web['providers'],'available','id')['google-play'] === false, 'Website offered native Play checkout');
billingCheck(array_column($play['providers'],'available','id')['lemon-squeezy'] === false, 'Play alternative billing enabled without configuration');
billingCheck(!str_contains(json_encode($web,JSON_THROW_ON_ERROR),'synthetic-key') && !str_contains(json_encode($play,JSON_THROW_ON_ERROR),'synthetic-private')
    &&!array_key_exists('pending_order_closure_verified',$web), 'Public catalog exposed private configuration');
billingFailure('BILLING_CLIENT_INVALID',fn()=>genesisBillingCatalog([],'untrusted'));

foreach (['2028-01-31T10:00:00Z'=>['2028-02-29T10:00:00Z','2028-07-31T10:00:00Z','2029-01-31T10:00:00Z'],
    '2027-01-31T10:00:00Z'=>['2027-02-28T10:00:00Z','2027-07-31T10:00:00Z','2028-01-31T10:00:00Z']] as $start=>$ends) {
    foreach ([1,6,12] as $index=>$months) billingCheck(genesisBillingPeriodEnd($start,$months) === $ends[$index], 'Calendar payment period normalized incorrectly');
}
billingFailure('BILLING_PERIOD_INVALID',fn()=>genesisBillingPeriodEnd('2028-02-30T10:00:00Z',1));
billingFailure('BILLING_PERIOD_INVALID',fn()=>genesisBillingPeriodEnd('2028-01-01T10:00:00Z',2));

$db = billingFixture(); billingOrder($db,'first');
// A checkout, failure or cancellation never upgrades a Free account, for any provider/offer.
foreach (GENESIS_BILLING_PROVIDERS as $providerName) {
    foreach (['standart','premium','business','premium4life'] as $planName) {
        $unpaid=billingFixture();$months=$planName==='premium4life'?0:1;
        billingOrder($unpaid,'unpaid','buyer',$months,$providerName,$planName);
        $cancelAt=strtotime('2028-01-31T10:00:00Z');
        billingCheck(genesisBillingRefreshEntitlement($unpaid,'buyer',$cancelAt)===['plan'=>'free','validUntil'=>null],'Pending checkout granted access');
        foreach (['pending','failed'] as $unverified) {
            billingFailure('BILLING_RECEIPT_INVALID',fn()=>genesisBillingApplyReceipt($unpaid,
                billingReceipt('unpaid','unpaid-ref',state:$unverified,provider:$providerName,months:$months),$cancelAt));
            billingCheck($unpaid->query("SELECT subscription_plan FROM users WHERE id='buyer'")->fetchColumn()==='free','Failed payment granted access');
        }
        $cancelled=billingReceipt('unpaid','unpaid-ref',state:'cancelled',provider:$providerName,months:$months);
        billingCheck(genesisBillingApplyReceipt($unpaid,$cancelled,$cancelAt)===['plan'=>'free','validUntil'=>null],'Cancellation granted access');
        billingCheck(genesisBillingApplyReceipt($unpaid,$cancelled,$cancelAt)===['plan'=>'free','validUntil'=>null],'Replayed cancellation changed access');
        billingCheck(genesisBillingApplyReceipt($unpaid,billingReceipt('unpaid','unpaid-ref',provider:$providerName,months:$months),$cancelAt)===['plan'=>'free','validUntil'=>null],'Late paid event resurrected a cancelled order');
        billingCheck($unpaid->query('SELECT body FROM blobs')->fetchColumn()==='opaque encrypted workspace','Cancellation modified personal data');
    }
}
$now = strtotime('2028-01-31T10:00:00Z');
$first = genesisBillingApplyReceipt($db,billingReceipt('first','receipt-1'),$now);
billingCheck($first === ['plan'=>'premium','validUntil'=>'2028-02-29T10:00:00Z'], 'Confirmed payment did not start one calendar month');
for ($i=0;$i<3;$i++) billingCheck(genesisBillingApplyReceipt($db,billingReceipt('first','receipt-1'),$now) === $first, 'A replay extended paid time');
billingCheck($db->query('SELECT count(*) FROM billing_receipts')->fetchColumn() == 1, 'Receipt replay inserted duplicates');
billingOrder($db,'renewal'); $renewal = billingReceipt('renewal','receipt-2','2028-02-15T10:00:00Z');
$now = strtotime('2028-02-15T10:00:00Z');
$extended = genesisBillingApplyReceipt($db,$renewal,$now);
billingCheck($extended['validUntil'] === '2028-03-29T10:00:00Z', 'Early renewal lost existing paid time or is hidden until its boundary');
$reversed = billingFixture(); billingOrder($reversed,'first'); billingOrder($reversed,'renewal');
genesisBillingApplyReceipt($reversed,$renewal,$now);
billingCheck(genesisBillingApplyReceipt($reversed,billingReceipt('first','receipt-1'),$now) === $extended, 'Delivery order changed paid access');

billingOrder($db,'stolen','other');
billingFailure('BILLING_RECEIPT_ACCOUNT_CONFLICT',fn()=>genesisBillingApplyReceipt($db,billingReceipt('stolen','receipt-1'),$now));
billingCheck($db->query("SELECT subscription_plan FROM users WHERE id='other'")->fetchColumn() === 'free', 'Payment leaked to another account');
$wrong = new GenesisVerifiedBillingReceipt('yookassa','wrong','first','paid',1,'USD','product:1','2028-01-31T10:00:00Z',hash('sha256','wrong'));
billingFailure('BILLING_RECEIPT_MISMATCH',fn()=>genesisBillingApplyReceipt($db,$wrong,$now));
billingCheck($db->query('SELECT count(*) FROM billing_receipts')->fetchColumn() == 2, 'Rejected evidence changed the ledger');

$refunded = genesisBillingApplyReceipt($db,billingReceipt('first','receipt-1',state:'refunded'),$now);
billingCheck($refunded['plan'] === 'premium' && $refunded['validUntil'] === '2028-03-15T10:00:00Z', 'Refund removed another paid month');
billingCheck(genesisBillingApplyReceipt($db,billingReceipt('first','receipt-1'),$now) === $refunded, 'Late paid event restored a refunded payment');
billingCheck(genesisBillingRefreshEntitlement($db,'buyer',strtotime('2028-03-15T10:00:00Z')) === ['plan'=>'free','validUntil'=>null], 'Paid access survived its exact expiry');
billingOrder($db,'lifetime-payment','lifetime');
genesisBillingApplyReceipt($db,billingReceipt('lifetime-payment','receipt-life'),$now);
genesisBillingApplyReceipt($db,billingReceipt('lifetime-payment','receipt-life',state:'refunded'),$now);
billingCheck(genesisBillingRefreshEntitlement($db,'lifetime',strtotime('2050-01-01T00:00:00Z')) === ['plan'=>'premium4life','validUntil'=>null], 'Payment/refund revoked lifetime access');
billingCheck($db->query('SELECT body FROM blobs')->fetchColumn() === 'opaque encrypted workspace', 'Billing changed encrypted workspace content');

$provider = billingFixture(); billingOrder($provider,'play','buyer',6,'google-play');
$receipt = billingReceipt('play','GPA.synthetic','2028-01-31T13:00:00+03:00',provider:'google-play',months:6,until:'2028-07-31T13:00:00+03:00');
billingCheck(genesisBillingApplyReceipt($provider,$receipt,$now)['validUntil'] === '2028-07-31T10:00:00Z', 'Verified provider expiry was not authoritative/UTC');

// A moderation reset survives old receipts and deletion. A different account cannot claim a used payment.
genesisSubscriptionRevoke($db,['id'=>'buyer'],'2028-02-16T10:00:00Z');
genesisBillingApplyReceipt($db,$renewal,strtotime('2028-02-17T10:00:00Z'));
billingCheck($db->query("SELECT subscription_plan FROM users WHERE id='buyer'")->fetchColumn()==='free','Old receipt restored revoked access');
$db->exec("DELETE FROM users WHERE id='buyer'; INSERT INTO users(id,subscription_plan,subscription_valid_until) VALUES('buyer','free',NULL)");billingOrder($db,'recreated');
billingFailure('BILLING_RECEIPT_ACCOUNT_CONFLICT',fn()=>genesisBillingApplyReceipt($db,billingReceipt('recreated','receipt-2','2028-02-15T10:00:00Z'),strtotime('2028-02-18T10:00:00Z')));
billingCheck(genesisSubscriptionRevokedAt($db,['id'=>'buyer'])==='2028-02-16T10:00:00Z','Account deletion lost revocation');
billingCheck(genesisSubscriptionIdentityHashes(['id'=>'x','google_sub'=>'same-google','email'=>'f.irst+tag@googlemail.com'])===genesisSubscriptionIdentityHashes(['id'=>'y','google_sub'=>'same-google','email'=>'first@gmail.com']),'Gmail alias bypasses identity');

$seats=billingFixture();
for($index=1;$index<=12;$index++) {
    $seats->beginTransaction();billingCheck(genesisBillingReserveLifetime($seats,['id'=>'person-'.$index],'seat-order-'.$index)===$index,'Wrong atomic lifetime seat');$seats->commit();
}
billingCheck(genesisBillingLifetimeAvailability($seats)===['total'=>12,'remaining'=>0],'Lifetime offer exceeded twelve people');
try { genesisBillingReserveLifetime($seats,['id'=>'thirteenth'],'seat-order-13');throw new RuntimeException('Thirteenth purchaser was accepted'); }
catch(GenesisResourceLimitException $error){billingCheck($error->getMessage()==='BILLING_LIFETIME_SOLD_OUT','Wrong sold-out error');}
genesisBillingReserveLifetime($seats,['id'=>'person-1'],'seat-order-1');
// Purchased seats remain occupied after an administrator's reset.
$seats->exec("UPDATE billing_lifetime_seats SET purchased_at='2028-01-31T10:00:00Z' WHERE seat=1");
$seats->exec("INSERT INTO users(id,subscription_plan,subscription_valid_until) VALUES('person-1','premium4life',NULL)");genesisSubscriptionRevoke($seats,['id'=>'person-1'],'2028-02-01T10:00:00Z');
billingCheck(genesisBillingLifetimeAvailability($seats)['remaining']===0,'Revocation incorrectly sold a thirteenth lifetime place');

$config=['webhook_secret'=>'synthetic-secret'];$raw=json_encode(['meta'=>['custom_data'=>['genesis_order_id'=>'first']],'data'=>['type'=>'orders','id'=>'1']],JSON_THROW_ON_ERROR);
billingCheck(genesisBillingLemonEvent($raw,hash_hmac('sha256',$raw,$config['webhook_secret']),$config)['data']['id']==='1','Valid signed Lemon event rejected');
try{genesisBillingLemonEvent($raw.' ',hash_hmac('sha256',$raw,$config['webhook_secret']),$config);throw new RuntimeException('Forged webhook accepted');}
catch(GenesisResourceLimitException $error){billingCheck($error->getMessage()==='BILLING_SIGNATURE_INVALID','Wrong signature error');}

// A checkout URL is returned only for the exact immutable USD gross amount, variant and no discount.
$lsOrder=['id'=>'synthetic-ls','provider'=>'lemon-squeezy','product_id'=>'12345','amount_minor'=>700,'currency'=>'USD'];
$lsConfig=['api_key'=>'synthetic','store_id'=>'1','currency'=>'USD','tax_inclusive'=>true,'gross_total_verified'=>true];
$lsResult=['data'=>['id'=>'synthetic-checkout','attributes'=>['store_id'=>1,'variant_id'=>12345,'custom_price'=>700,'test_mode'=>false,
    'url'=>'https://example.invalid/checkout','preview'=>['currency'=>'USD','total'=>700,'discount_total'=>0]]]];
$checkout=genesisBillingGatewayCheckout($lsOrder,$lsConfig,'https://example.invalid/return',function($method,$url,$body)use($lsResult):array{
    $attributes=$body['data']['attributes'];billingCheck($method==='POST'&&str_ends_with($url,'/checkouts')&&$attributes['custom_price']===700
        &&$attributes['product_options']['enabled_variants']===[12345]&&$attributes['checkout_options']['discount']===false
        &&$attributes['checkout_data']['variant_quantities']===[['variant_id'=>12345,'quantity'=>1]]&&$attributes['preview']===true,'Checkout did not bind exact amount/variant/quantity/discount');
    return $lsResult;
});
billingCheck($checkout['checkoutUrl']==='https://example.invalid/checkout','Verified gross checkout URL missing');
foreach([['currency'=>'RUB'],['total'=>689],['total'=>701],['discount_total'=>1]]as$bad){
    $wrong=$lsResult;$wrong['data']['attributes']['preview']=[...$wrong['data']['attributes']['preview'],...$bad];
    billingFailure('BILLING_GROSS_PRICE_UNVERIFIED',fn()=>genesisBillingGatewayCheckout($lsOrder,$lsConfig,'https://example.invalid/return',fn()=>$wrong));
}
$networkCalls=0;
billingFailure('BILLING_GROSS_PRICE_UNVERIFIED',fn()=>genesisBillingGatewayCheckout($lsOrder,[...$lsConfig,'gross_total_verified'=>false],'https://example.invalid/return',function()use(&$networkCalls):array{$networkCalls++;return[];}));
billingCheck($networkCalls===0&&!genesisBillingProviderReady('lemon-squeezy',['providers'=>['lemon-squeezy'=>[...$lsConfig,'webhook_secret'=>'synthetic','gross_total_verified'=>false]]]),'Unreviewed gross pricing reached a provider');

echo "PASS billing foundation: fixed USD and unchanged RUB provider prices, legacy half-up FX compatibility, gross-safe immutable Lemon checkout, disabled/unconfigured gateways, private metadata, calendar periods, idempotence/reorder/account binding, refunds, expiry and permanent access.\n";
