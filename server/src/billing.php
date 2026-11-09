<?php
declare(strict_types=1);
require_once __DIR__.'/subscription-identity.php';
require_once __DIR__.'/billing-upgrades.php';
require_once __DIR__.'/billing-settlement.php';

const GENESIS_BILLING_PROVIDERS = ['google-play', 'lemon-squeezy', 'yookassa'];
const GENESIS_BILLING_PLANS = ['standart', 'premium', 'business'];

function genesisBillingDefinition(): array
{
    return json_decode((string)file_get_contents(dirname(__DIR__) . '/resources/billing-catalog.json'), true, 32, JSON_THROW_ON_ERROR);
}

function genesisBillingSettings(): array
{
    $settings = genesisConfig()['billing'] ?? [];
    $settings=is_array($settings)?$settings:[];
    // Kept in config.php so the existing protected runtime backup includes the credential.
    return genesisBillingYooPrivateSettings($settings,$settings['yookassa_live']??null);
}

function genesisBillingYooPrivateSettings(array $settings,mixed $private): array
{
    if(!is_array($private)||($private['schema_version']??null)!==1||($private['verified']??null)!==true
        ||!is_string($private['shop_id']??null)||!ctype_digit($private['shop_id'])
        ||!is_string($private['secret_key']??null)||!str_starts_with($private['secret_key'],'live_')
        ||strlen($private['secret_key'])<20||!in_array($private['receipt_mode']??null,['npd-manual','fiscal'],true))return $settings;
    if($private['receipt_mode']==='fiscal'&&(!is_int($private['vat_code']??null)||!in_array($private['vat_code'],[1,2,3,4,5,6,7,8,9,10,11,12],true)))return $settings;
    $active=($private['enabled']??false)===true;
    $settings['providers']['yookassa']=['shop_id'=>$private['shop_id'],'secret_key'=>$private['secret_key'],'test_mode'=>false,
        // Old code checks the field even with receipt_required=false; 1 is unused compatibility metadata for NPD.
        'receipt_required'=>$private['receipt_mode']==='fiscal','vat_code'=>$private['vat_code']??1];
    foreach(genesisBillingDefinition()['purchasablePlans']as$plan)foreach(genesisBillingDefinition()['periodMonths']as$months)
        $settings['offers']["$plan:$months"]['products']['yookassa']="genesis-$plan-$months";
    $settings['offers']['premium4life:0']['products']['yookassa']='genesis-premium4life';
    $settings['enabled']=($settings['enabled']??false)===true||$active;
    $settings['yookassa_live_verified']=$active;
    // A verified installation can enable only YooKassa; other providers retain their own release gates.
    $settings['pending_order_closure_verified']=($settings['pending_order_closure_verified']??false)===true||$active;
    return $settings;
}

function genesisBillingProviderReady(string $provider, array $settings): bool
{
    $configuration = $settings['providers'][$provider] ?? [];
    $required = match ($provider) {
        'lemon-squeezy' => ['api_key', 'store_id', 'webhook_secret'],
        'yookassa' => ($configuration['receipt_required']??true)===true?['shop_id', 'secret_key', 'vat_code']:['shop_id', 'secret_key'],
        'google-play' => ['service_account_email', 'service_account_private_key'],
        default => [],
    };
    if (!$required || !is_array($configuration)) return false;
    foreach ($required as $key) if (!is_scalar($configuration[$key] ?? null) || trim((string)$configuration[$key]) === '') return false;
    if(in_array($provider,['lemon-squeezy','yookassa'],true)&&($configuration['test_mode']??false)!==false)return false;
    if($provider==='lemon-squeezy'&&(($configuration['currency']??null)!=='USD'||($configuration['tax_inclusive']??false)!==true
        ||($configuration['gross_total_verified']??false)!==true))return false;
    return true;
}

/** Fixed reviewed FX snapshot: integer arithmetic, with half-up rounding to USD cents. */
function genesisBillingRubToUsdMinor(int $rubMinor,array $rate): int
{
    if($rubMinor<=0||($rate['baseCurrency']??null)!=='USD'||($rate['quoteCurrency']??null)!=='RUB'
        ||($rate['rounding']??null)!=='half-up-to-minor-unit'||!is_string($rate['quotePerBase']??null)
        ||preg_match('/\A([1-9][0-9]{0,5})\.([0-9]{1,6})\z/D',$rate['quotePerBase'],$parts)!==1)
        throw new InvalidArgumentException('BILLING_FX_INVALID');
    $scale=10**strlen($parts[2]);$denominator=(int)$parts[1]*$scale+(int)$parts[2];
    if($rubMinor>intdiv(PHP_INT_MAX,$scale))throw new InvalidArgumentException('BILLING_FX_INVALID');
    $numerator=$rubMinor*$scale;$cents=intdiv($numerator,$denominator);
    return $cents+(($numerator%$denominator)*2>=$denominator?1:0);
}

function genesisBillingProviderPrices(int $rubMinor,array $foreign,mixed $usdMinor): array
{
    $prices=['yookassa'=>['amountMinor'=>$rubMinor,'currency'=>'RUB'],'google-play'=>['amountMinor'=>$rubMinor,'currency'=>'RUB']];
    if(($foreign['provider']??null)==='lemon-squeezy'&&($foreign['currency']??null)==='USD'&&is_int($usdMinor)&&$usdMinor>0){
        $pricingModel=$foreign['pricingModel']??'fx-snapshot';
        if($pricingModel==='fixed')$prices['lemon-squeezy']=['amountMinor'=>$usdMinor,'currency'=>'USD'];
        elseif($pricingModel==='fx-snapshot'){
            try{if(genesisBillingRubToUsdMinor($rubMinor,$foreign['rate']??[])===$usdMinor)$prices['lemon-squeezy']=['amountMinor'=>$usdMinor,'currency'=>'USD'];}
            catch(InvalidArgumentException){ /* A malformed legacy FX snapshot cannot enable a foreign checkout. */ }
        }
    }
    return $prices;
}

function genesisBillingProviderOffer(array $offer,string $provider): array
{
    $price=$offer['pricesByProvider'][$provider]??null;
    $currency=$provider==='lemon-squeezy'?'USD':'RUB';
    if(!in_array($provider,GENESIS_BILLING_PROVIDERS,true)||!is_array($price)||!is_int($price['amountMinor']??null)
        ||$price['amountMinor']<=0||($price['currency']??null)!==$currency)throw new GenesisResourceLimitException(503,'BILLING_PRICE_NOT_CONFIGURED');
    return [...$offer,'amountMinor'=>$price['amountMinor'],'currency'=>$currency,
        'provider'=>$provider,'_allAvailableProviders'=>$offer['availableProviders'],
        'availableProviders'=>array_values(array_intersect($offer['availableProviders'],[$provider]))];
}

/** Whitelisted public metadata only. Credentials and purchase tokens never enter a profile. */
function genesisBillingCatalog(array $settings, string $client = 'web', ?array $definition = null): array
{
    if (!in_array($client, ['web', 'android', 'android-play'], true)) throw new InvalidArgumentException('BILLING_CLIENT_INVALID');
    $definition ??= genesisBillingDefinition();
    $foreign=$definition['foreignPricing']??[];
    // Sales stay closed until provider-backed pending-order closure is independently verified.
    // Provider readiness is separate so existing verification/webhooks/recovery remain usable.
    $yooEnabled=($definition['yookassaCheckoutEnabled']??false)===true&&($settings['yookassa_live_verified']??false)===true;
    $enabled = (($definition['checkoutEnabled'] ?? false) === true || $yooEnabled) && ($settings['enabled'] ?? false) === true
        && ($settings['pending_order_closure_verified'] ?? false) === true;
    $creditEnabled=$enabled&&($definition['creditCheckoutEnabled']??false)===true&&($settings['credit_settlement_verified']??false)===true;
    $providers = [];
    foreach ($definition['providers'] as $provider) {
        $allowed = in_array($client, $provider['clients'], true)
            || ($client === 'android-play' && $provider['id'] !== 'google-play' && ($settings['play_external_billing_enabled'] ?? false) === true);
        $released=($definition['checkoutEnabled']??false)===true||($provider['id']==='yookassa'&&$yooEnabled);
        $ready=$enabled&&$released&&genesisBillingProviderReady($provider['id'],$settings);
        $providers[] = ['id' => $provider['id'], 'name' => $provider['name'],
            'available' => $ready && $allowed,
            'reason' => !$allowed ? 'client-unavailable' : ($ready ? null : 'not-configured')];
    }
    $offers = [];
    foreach ($definition['purchasablePlans'] as $plan) foreach ($definition['periodMonths'] as $months) {
        $id = "$plan:$months";
        $configuration = $settings['offers'][$id] ?? [];
        $amount = $definition['prices'][$plan][(string)$months] ?? null; $currency = $definition['currency'] ?? null;
        $priced = is_int($amount) && $amount > 0 && is_string($currency) && preg_match('/\A[A-Z]{3}\z/D', $currency) === 1;
        $prices=$priced&&$currency==='RUB'?genesisBillingProviderPrices($amount,$foreign,$foreign['prices'][$plan][(string)$months]??null):[];
        $methods = [];
        foreach ($providers as $provider) {
            $product = $configuration['products'][$provider['id']] ?? null;
            if ($priced && isset($prices[$provider['id']]) && $provider['available'] && is_string($product) && $product !== '') $methods[] = $provider['id'];
        }
        $offers[] = ['id' => $id, 'plan' => $plan, 'periodMonths' => $months,
            'amountMinor' => $priced ? $amount : null, 'currency' => $priced ? $currency : null,
            'availableProviders' => $methods,'pricesByProvider'=>$prices];
    }
    $life = $definition['lifetimeOffer'];
    $configuration = $settings['offers'][$life['id']] ?? [];
    $prices=genesisBillingProviderPrices($life['amountMinor'],$foreign,$foreign['lifetimeAmountMinor']??null);
    $methods = [];
    foreach ($providers as $provider) if (isset($prices[$provider['id']]) && $provider['available'] && is_string($configuration['products'][$provider['id']] ?? null)
        && $configuration['products'][$provider['id']] !== '') $methods[] = $provider['id'];
    $offers[] = ['id'=>$life['id'],'plan'=>'premium4life','periodMonths'=>0,'amountMinor'=>$life['amountMinor'],
        'currency'=>$life['currency'],'seatLimit'=>$life['seats'],'availableProviders'=>$methods,'pricesByProvider'=>$prices];
    foreach($offers as &$creditOffer)$creditOffer['creditCheckoutEnabled']=$creditEnabled;
    unset($creditOffer);
    return ['schemaVersion' => 1, 'revision' => $definition['revision'], 'checkoutEnabled' => $enabled,
        'creditCheckoutEnabled'=>$creditEnabled,
        'providers' => $providers, 'periodMonths' => $definition['periodMonths'], 'offers' => $offers,
        'foreignPricing'=>['provider'=>$foreign['provider']??null,'currency'=>$foreign['currency']??null,
            'pricingModel'=>$foreign['pricingModel']??'fx-snapshot',
            // Older cached web clients dereference rate directly; keep its shape without advertising a numeric FX rate.
            'rate'=>($foreign['pricingModel']??null)==='fixed'?['quotePerBase'=>'—','effectiveDate'=>'','source'=>'']:($foreign['rate']??null)]];
}

/** Exact calendar months from confirmed payment time; Jan 31 + one month is Feb 28/29. */
function genesisBillingPeriodEnd(string $start, int $months): string
{
    if (!in_array($months, [1, 6, 12], true) || genesisSubscriptionExpiry($start) === false) throw new InvalidArgumentException('BILLING_PERIOD_INVALID');
    $date = (new DateTimeImmutable($start))->setTimezone(new DateTimeZone('UTC'));
    $first = $date->setDate((int)$date->format('Y'), (int)$date->format('m'), 1)->modify("+$months months");
    return $first->setDate((int)$first->format('Y'), (int)$first->format('m'), min((int)$date->format('d'), (int)$first->format('t')))->format('Y-m-d\TH:i:s\Z');
}

/** Produced only by authenticated provider adapters, never constructed from a client success body. */
final readonly class GenesisVerifiedBillingReceipt
{
    public function __construct(public string $provider, public string $reference, public string $orderId,
        public string $state, public int $amountMinor, public string $currency, public string $productId,
        public string $confirmedAt, public string $evidenceHash, public ?string $validUntil = null,
        public int $refundedAmountMinor = 0) {}
}

/** Idempotent evidence ingestion. A replay cannot extend a period or move payment to another account. */
function genesisBillingApplyReceipt(PDO $db, GenesisVerifiedBillingReceipt $receipt, int $now): array
{
    if (!in_array($receipt->provider, GENESIS_BILLING_PROVIDERS, true) || !in_array($receipt->state, ['paid','refunded','cancelled'], true)
        || $receipt->reference === '' || strlen($receipt->reference) > 4096 || preg_match('/\A[a-f0-9]{64}\z/D', $receipt->evidenceHash) !== 1
        || $receipt->refundedAmountMinor < 0 || $receipt->refundedAmountMinor > $receipt->amountMinor
        || genesisSubscriptionExpiry($receipt->confirmedAt) === false || genesisSubscriptionExpiry($receipt->confirmedAt) > $now + 300
        || ($receipt->validUntil !== null && (genesisSubscriptionExpiry($receipt->validUntil) === false
            || genesisSubscriptionExpiry($receipt->validUntil) <= genesisSubscriptionExpiry($receipt->confirmedAt)))) throw new InvalidArgumentException('BILLING_RECEIPT_INVALID');
    $owns = !$db->inTransaction(); if ($owns) $db->beginTransaction();
    try {
        $query = $db->prepare('SELECT * FROM billing_orders WHERE id=?'); $query->execute([$receipt->orderId]); $order = $query->fetch();
        if (!$order || $order['provider'] !== $receipt->provider || (int)$order['amount_minor'] !== $receipt->amountMinor
            || $order['currency'] !== $receipt->currency || $order['product_id'] !== $receipt->productId) throw new DomainException('BILLING_RECEIPT_MISMATCH');
        $reference = hash('sha256', $receipt->reference);
        $query = $db->prepare('SELECT * FROM users WHERE id=?'); $query->execute([$order['user_id']]); $owner = $query->fetch();
        if (!$owner) throw new DomainException('BILLING_ACCOUNT_NOT_FOUND');
        $ownerHash = genesisSubscriptionIdentityHashes($owner)[0];
        $query = $db->prepare('SELECT * FROM billing_payment_claims WHERE provider=? AND reference_hash=?');
        $query->execute([$receipt->provider,$reference]); $claim = $query->fetch();
        if ($claim && ($claim['order_id'] !== $receipt->orderId || !hash_equals($claim['owner_hash'],$ownerHash)))
            throw new DomainException('BILLING_RECEIPT_ACCOUNT_CONFLICT');
        $db->prepare('INSERT OR IGNORE INTO billing_payment_claims(provider,reference_hash,order_id,owner_hash) VALUES(?,?,?,?)')
            ->execute([$receipt->provider,$reference,$receipt->orderId,$ownerHash]);
        $query = $db->prepare('SELECT * FROM billing_receipts WHERE provider=? AND reference_hash=?'); $query->execute([$receipt->provider, $reference]); $existing = $query->fetch();
        if ($existing && $existing['order_id'] !== $receipt->orderId) throw new DomainException('BILLING_RECEIPT_ACCOUNT_CONFLICT');
        if ($existing && $existing['confirmed_at'] !== gmdate('Y-m-d\TH:i:s\Z', genesisSubscriptionExpiry($receipt->confirmedAt))) throw new DomainException('BILLING_RECEIPT_CONFLICT');
        // A full refund/cancellation remains terminal if an older paid notification arrives later.
        $state = $existing && in_array($existing['state'], ['refunded','cancelled'], true) ? $existing['state'] : $receipt->state;
        $refundedAmount=$state==='refunded'?$receipt->amountMinor:max($receipt->refundedAmountMinor,(int)($existing['refunded_amount_minor']??0));
        if($state==='paid'&&$refundedAmount===$receipt->amountMinor)$state='refunded';
        $query = $db->prepare('INSERT INTO billing_receipts(provider,reference_hash,order_id,state,confirmed_at,provider_valid_until,evidence_hash,verified_at,refunded_amount_minor)
            VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(provider,reference_hash) DO UPDATE SET state=excluded.state,
            provider_valid_until=excluded.provider_valid_until,evidence_hash=excluded.evidence_hash,verified_at=excluded.verified_at,
            refunded_amount_minor=excluded.refunded_amount_minor');
        $validUntil = $receipt->validUntil === null ? null : gmdate('Y-m-d\TH:i:s\Z', genesisSubscriptionExpiry($receipt->validUntil));
        if ($state === 'paid' && $existing && $existing['provider_valid_until'] !== null && $validUntil !== null)
            $validUntil = max($validUntil, $existing['provider_valid_until']);
        $query->execute([$receipt->provider, $reference, $receipt->orderId, $state,
            gmdate('Y-m-d\TH:i:s\Z', genesisSubscriptionExpiry($receipt->confirmedAt)), $validUntil,
            $receipt->evidenceHash, gmdate('Y-m-d\TH:i:s\Z', $now),$refundedAmount]);
        $db->prepare('UPDATE billing_orders SET status=?,updated_at=? WHERE id=?')->execute([$state,gmdate('Y-m-d\TH:i:s\Z',$now),$receipt->orderId]);
        $observed=new GenesisVerifiedBillingReceipt($receipt->provider,$receipt->reference,$receipt->orderId,$state,$receipt->amountMinor,
            $receipt->currency,$receipt->productId,$receipt->confirmedAt,$receipt->evidenceHash,$receipt->validUntil,$refundedAmount);
        genesisBillingSettlementObserve($db,$order,$observed,$existing?:null,$now);
        if ($order['plan'] === 'premium4life' && $state === 'paid' && !genesisBillingSettlementBlocked(genesisBillingSettlement($db,$order['id']))) {
            $seat = $db->prepare('SELECT seat FROM billing_lifetime_seats WHERE order_id=? AND owner_hash=?'); $seat->execute([$order['id'],$ownerHash]);
            if ($seat->fetchColumn() === false) throw new DomainException('BILLING_LIFETIME_RESERVATION_REQUIRED');
            $db->prepare('UPDATE billing_lifetime_seats SET purchased_at=COALESCE(purchased_at,?),reserved_until=NULL WHERE order_id=?')
                ->execute([$receipt->confirmedAt,$order['id']]);
        }
        // Only an authenticated terminal cancellation releases a never-purchased lifetime seat.
        if($order['plan']==='premium4life'&&$state==='cancelled')$db->prepare('UPDATE billing_lifetime_seats SET owner_hash=NULL,order_id=NULL,reserved_until=NULL
            WHERE order_id=? AND purchased_at IS NULL AND revoked_at IS NULL')->execute([$order['id']]);
        genesisBillingReleaseUpgrade($db, $receipt->orderId, $state);
        genesisBillingRebuildPeriods($db, $order['user_id']);
        $snapshot = genesisBillingRefreshEntitlement($db, $order['user_id'], $now);
        if ($owns) $db->commit();
        return $snapshot;
    } catch (Throwable $failure) { if ($owns && $db->inTransaction()) $db->rollBack(); throw $failure; }
}

/** A deterministic projection of receipts, independent of webhook delivery order. */
function genesisBillingRebuildPeriods(PDO $db, string $userId): void
{
    $query = $db->prepare("SELECT r.*,o.user_id,o.plan,o.period_months,o.amount_minor,o.list_amount_minor FROM billing_receipts r JOIN billing_orders o ON o.id=r.order_id
        LEFT JOIN subscription_access_state s ON s.user_id=o.user_id
        WHERE o.user_id=? AND r.state='paid' AND o.plan<>'premium4life'
        AND NOT EXISTS(SELECT 1 FROM billing_settlements bs WHERE bs.order_id=o.id AND bs.state<>'completed')
        AND (s.receipts_after IS NULL OR (o.created_at>s.receipts_after AND r.confirmed_at>s.receipts_after))
        ORDER BY r.confirmed_at,r.provider,r.reference_hash"); $query->execute([$userId]);
    $receipts = $query->fetchAll(); $endByPlan = [];
    $db->prepare('DELETE FROM billing_periods WHERE user_id=?')->execute([$userId]);
    $insert = $db->prepare('INSERT INTO billing_periods(provider,reference_hash,user_id,plan,starts_at,ends_at) VALUES(?,?,?,?,?,?)');
    foreach ($receipts as $receipt) {
        $plan = $receipt['plan']; $start = $receipt['confirmed_at'];
        if ($receipt['provider_valid_until'] !== null) $end = $receipt['provider_valid_until'];
        else { $start = max($start, $endByPlan[$plan] ?? $start); $end = genesisBillingPeriodEnd($start,(int)$receipt['period_months']); }
        $endByPlan[$plan] = max($end, $endByPlan[$plan] ?? $end);
        $listValue = (int)($receipt['list_amount_minor'] ?? $receipt['amount_minor']);
        $funded = genesisBillingFundedReceiptValue($db,$receipt['provider'],$receipt['reference_hash']);
        if ($listValue > 0 && $funded < $listValue) {
            $starts = genesisSubscriptionExpiry($start); $ends = genesisSubscriptionExpiry($end);
            $end = gmdate('Y-m-d\TH:i:s\Z',$starts + intdiv(($ends-$starts)*$funded,$listValue));
        }
        $retired = $db->prepare("SELECT MIN(r.confirmed_at) FROM billing_upgrade_credits c
            JOIN billing_receipts r ON r.order_id=c.order_id AND r.state='paid'
            WHERE c.source_provider=? AND c.source_reference_hash=?
            AND NOT EXISTS(SELECT 1 FROM billing_settlements bs WHERE bs.order_id=c.order_id AND bs.state<>'completed')");
        $retired->execute([$receipt['provider'],$receipt['reference_hash']]); $retiredAt = $retired->fetchColumn();
        if (is_string($retiredAt)) $end = min($end,max($start,$retiredAt));
        $insert->execute([$receipt['provider'],$receipt['reference_hash'],$userId,$plan,$start,$end]);
    }
}

/** The materialized plan is server-owned. A receipt or refund never downgrades lifetime access. */
function genesisBillingRefreshEntitlement(PDO $db, string $userId, int $now): array
{
    $query = $db->prepare('SELECT * FROM users WHERE id=?'); $query->execute([$userId]); $user = $query->fetch();
    if (!$user) throw new DomainException('BILLING_ACCOUNT_NOT_FOUND');
    $state = genesisSubscriptionState($db,$user);
    if ($user['subscription_plan'] === 'premium4life' && !(bool)$state['materialized_billing']) return ['plan' => 'premium4life', 'validUntil' => null];
    $stamp = gmdate('Y-m-d\TH:i:s\Z',$now);
    $query = $db->prepare('SELECT plan,starts_at,ends_at FROM billing_periods WHERE user_id=? ORDER BY plan,starts_at,ends_at');
    $query->execute([$userId]); $windows = [];
    foreach ($query->fetchAll() as $period) {
        $planWindows = $windows[$period['plan']] ?? []; $last = array_key_last($planWindows);
        if ($last !== null && $period['starts_at'] <= $planWindows[$last]['ends_at'])
            $planWindows[$last]['ends_at'] = max($planWindows[$last]['ends_at'], $period['ends_at']);
        else $planWindows[] = $period;
        $windows[$period['plan']] = $planWindows;
    }
    $rows = [];
    foreach ($windows as $planWindows) foreach ($planWindows as $period)
        if ($period['starts_at'] <= $stamp && $period['ends_at'] > $stamp) $rows[] = $period;
    $rank = ['standart'=>1,'premium'=>2,'business'=>3]; usort($rows, static fn(array $a,array $b):int => $rank[$b['plan']] <=> $rank[$a['plan']]);
    $plan = $rows[0]['plan'] ?? 'free'; $until = $rows[0]['ends_at'] ?? null;
    $query = $db->prepare("SELECT o.id FROM billing_receipts r JOIN billing_orders o ON o.id=r.order_id
        WHERE o.user_id=? AND o.plan='premium4life' AND r.state='paid' AND (? IS NULL OR (o.created_at>? AND r.confirmed_at>?))");
    $after = $state['receipts_after']; $query->execute([$userId,$after,$after,$after]);
    foreach($query->fetchAll() as $lifetimeOrder) {
        $q=$db->prepare('SELECT COALESCE(list_amount_minor,amount_minor) FROM billing_orders WHERE id=?');
        $q->execute([$lifetimeOrder['id']]); $listValue=(int)$q->fetchColumn();
        if(genesisBillingFundedOrderValue($db,$lifetimeOrder['id']) >= $listValue) { $plan='premium4life'; $until=null; break; }
    }
    $db->prepare('UPDATE users SET subscription_plan=?,subscription_valid_until=? WHERE id=?')->execute([$plan,$until,$userId]);
    $db->prepare('INSERT INTO subscription_access_state(user_id,materialized_billing,revision) VALUES(?,1,1)
        ON CONFLICT(user_id) DO UPDATE SET materialized_billing=1,revision=revision+1')->execute([$userId]);
    return ['plan' => $plan, 'validUntil' => $until];
}

function genesisBillingLifetimeAvailability(PDO $db): array
{
    // Pending reservations stay occupied until the provider confirms cancellation.
    // Releasing by a local timer could oversell while a delayed confirmation is in flight.
    $used = (int)$db->query('SELECT COUNT(*) FROM billing_lifetime_seats WHERE owner_hash IS NOT NULL')->fetchColumn();
    return ['total'=>12,'remaining'=>max(0,12-$used)];
}

/** Must be called after acquiring the SQLite writer, in the order-creation transaction. */
function genesisBillingReserveLifetime(PDO $db, array $owner, string $orderId): int
{
    $hash = genesisSubscriptionIdentityHashes($owner)[0];
    $query = $db->prepare('SELECT * FROM billing_lifetime_seats WHERE owner_hash=?'); $query->execute([$hash]); $existing = $query->fetch();
    if ($existing) {
        if ($existing['order_id'] !== $orderId) throw new DomainException('BILLING_LIFETIME_ALREADY_RESERVED');
        return (int)$existing['seat'];
    }
    $query = $db->prepare('UPDATE billing_lifetime_seats SET owner_hash=?,order_id=? WHERE seat=(SELECT MIN(seat) FROM billing_lifetime_seats WHERE owner_hash IS NULL) AND owner_hash IS NULL');
    $query->execute([$hash,$orderId]);
    if ($query->rowCount() !== 1) throw new GenesisResourceLimitException(409,'BILLING_LIFETIME_SOLD_OUT');
    $query = $db->prepare('SELECT seat FROM billing_lifetime_seats WHERE order_id=?'); $query->execute([$orderId]); return (int)$query->fetchColumn();
}
