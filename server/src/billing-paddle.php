<?php
declare(strict_types=1);

const GENESIS_PADDLE_PRICE_IDS = [
    'standart:1' => 'pri_01m87k52qwrmx6a7jxar7x0t7b',
    'standart:12' => 'pri_01m87k615tj6anjwnytv7qpfc6',
    'premium:1' => 'pri_01m87k8jpmym1f37f5tnmq0fwr',
    'premium:12' => 'pri_01m87k8menbygr50d1d4fkyak8',
    'business:1' => 'pri_01m87kadf9qgxgpq695tf9nat7',
    'business:12' => 'pri_01m87kaf7jc599trnrctzxwebg',
    'premium4life:0' => 'pri_01m87kbw7ba76bdearxvbgwy25',
];

function genesisBillingPaddleId(mixed $value, string $kind): bool
{
    return is_string($value) && preg_match('/\A'.preg_quote($kind, '/').'_[a-z0-9]{26}\z/D', $value) === 1;
}

function genesisBillingPaddlePrivateSettings(array $settings, mixed $private): array
{
    if (!is_array($private) || ($private['schema_version'] ?? null) !== 1
        || ($private['seller_id'] ?? null) !== 476362
        || !is_string($private['api_key'] ?? null)
        || preg_match('/\Apdl_live_apikey_[A-Za-z0-9_-]{24,220}\z/D', $private['api_key']) !== 1
        || !is_string($private['client_token'] ?? null)
        || preg_match('/\Alive_[A-Za-z0-9_-]{12,120}\z/D', $private['client_token']) !== 1
        || !is_string($private['webhook_secret'] ?? null)
        || strlen($private['webhook_secret']) < 24 || strlen($private['webhook_secret']) > 256
    ) return $settings;

    $settings['providers']['paddle'] = [
        'api_key' => $private['api_key'], 'client_token' => $private['client_token'],
        'webhook_secret' => $private['webhook_secret'],
    ];
    foreach (GENESIS_PADDLE_PRICE_IDS as $offer => $price)
        $settings['offers'][$offer]['products']['paddle'] = $price;
    $settings['paddle_live_verified'] = ($private['enabled'] ?? false) === true
        && ($private['verified'] ?? false) === true;
    return $settings;
}

function genesisBillingPaddleData(array $configuration, string $method, string $path, ?array $body, callable $http): array
{
    $response = $http($method, 'https://api.paddle.com'.$path, $body, [
        'Authorization: Bearer '.$configuration['api_key'],
        'Paddle-Version: 1',
    ]);
    if (!is_array($response['data'] ?? null)) throw new DomainException('BILLING_PROVIDER_RESPONSE_INVALID');
    return $response['data'];
}

function genesisBillingPaddlePriceMatches(array $price, array $order): bool
{
    return ($price['id'] ?? null) === $order['product_id']
        && ($price['status'] ?? null) === 'active'
        && array_key_exists('billing_cycle', $price) && $price['billing_cycle'] === null
        && array_key_exists('trial_period', $price) && $price['trial_period'] === null
        && ($price['unit_price']['currency_code'] ?? null) === 'USD'
        && ($price['unit_price']['amount'] ?? null) === (string)$order['amount_minor']
        && ($price['unit_price_overrides'] ?? null) === []
        && ($price['quantity']['minimum'] ?? null) === 1 && ($price['quantity']['maximum'] ?? null) === 1;
}

function genesisBillingPaddleOrderContext(array $transaction, array $order): void
{
    $item = $transaction['items'][0] ?? [];
    $price = $item['price'] ?? [];
    if (!genesisBillingPaddleId($transaction['id'] ?? null, 'txn')
        || ($order['provider_secret'] !== null && $transaction['id'] !== $order['provider_secret'])
        || ($transaction['custom_data']['genesis_order_id'] ?? null) !== $order['id']
        || ($transaction['currency_code'] ?? null) !== 'USD' || $order['currency'] !== 'USD'
        || ($transaction['collection_mode'] ?? null) !== 'automatic'
        || ($transaction['subscription_id'] ?? null) !== null || ($transaction['discount_id'] ?? null) !== null
        || !is_array($transaction['items'] ?? null) || count($transaction['items']) !== 1
        || ($item['quantity'] ?? null) !== 1 || ($price['id'] ?? null) !== $order['product_id']
        || !array_key_exists('billing_cycle', $price) || $price['billing_cycle'] !== null
        || ($price['unit_price']['currency_code'] ?? null) !== 'USD'
        || ($price['unit_price']['amount'] ?? null) !== (string)$order['amount_minor']
    ) throw new DomainException('BILLING_RECEIPT_MISMATCH');
}

function genesisBillingPaddleMinor(mixed $value): int
{
    if (!is_string($value) || preg_match('/\A[0-9]{1,10}\z/D', $value) !== 1)
        throw new DomainException('BILLING_RECEIPT_INVALID');
    return (int)$value;
}

function genesisBillingPaddleReceipt(array $transaction, array $order): ?GenesisVerifiedBillingReceipt
{
    genesisBillingPaddleOrderContext($transaction, $order);
    $state = match ($transaction['status'] ?? '') {
        'completed' => 'paid', 'canceled' => 'cancelled', default => null,
    };
    if ($state === null) return null;

    $refund = 0;
    $confirmedAt = $transaction['created_at'] ?? '';
    if ($state === 'paid') {
        $totals = $transaction['details']['totals'] ?? [];
        $gross = genesisBillingPaddleMinor($totals['grand_total'] ?? null);
        if ($gross === 0 || ($totals['currency_code'] ?? null) !== 'USD'
            || genesisBillingPaddleMinor($totals['discount'] ?? null) !== 0
            || genesisBillingPaddleMinor($totals['balance'] ?? null) !== 0
        ) throw new DomainException('BILLING_RECEIPT_MISMATCH');
        $captured = 0;
        $confirmedAt = '';
        foreach (($transaction['payments'] ?? []) as $payment) {
            if (($payment['status'] ?? '') !== 'captured') continue;
            $captured += genesisBillingPaddleMinor($payment['amount'] ?? null);
            $timestamp = genesisBillingProviderTimestamp((string)($payment['captured_at'] ?? ''));
            if ($timestamp > $confirmedAt) $confirmedAt = $timestamp;
        }
        if ($captured !== $gross || $confirmedAt === '') throw new DomainException('BILLING_RECEIPT_MISMATCH');

        $adjusted = $transaction['details']['adjusted_totals'] ?? null;
        if ($adjusted !== null) {
            if (($adjusted['currency_code'] ?? null) !== 'USD') throw new DomainException('BILLING_RECEIPT_MISMATCH');
            $remaining = genesisBillingPaddleMinor($adjusted['grand_total'] ?? null);
            if ($remaining > $gross) throw new DomainException('BILLING_RECEIPT_MISMATCH');
            $refund = intdiv((int)$order['amount_minor'] * ($gross - $remaining), $gross);
            if ($remaining === 0) $state = 'refunded';
        }
    }
    return new GenesisVerifiedBillingReceipt('paddle', $transaction['id'], $order['id'], $state,
        (int)$order['amount_minor'], 'USD', $order['product_id'], genesisBillingProviderTimestamp((string)$confirmedAt),
        hash('sha256', json_encode($transaction, JSON_THROW_ON_ERROR)), null, $refund);
}

function genesisBillingPaddleEvent(string $raw, string $header, string $secret, int $now): array
{
    if ($raw === '' || strlen($raw) > 500_000 || strlen($header) > 1024)
        throw new GenesisResourceLimitException(403, 'BILLING_SIGNATURE_INVALID');
    $timestamp = null; $signatures = [];
    foreach (explode(';', $header) as $part) {
        if (preg_match('/\Ats=([0-9]{1,12})\z/D', trim($part), $matches) === 1 && $timestamp === null)
            $timestamp = $matches[1];
        elseif (preg_match('/\Ah1=([a-f0-9]{64})\z/D', trim($part), $matches) === 1)
            $signatures[] = $matches[1];
        else throw new GenesisResourceLimitException(403, 'BILLING_SIGNATURE_INVALID');
    }
    if ($timestamp === null || abs($now - (int)$timestamp) > 300)
        throw new GenesisResourceLimitException(403, 'BILLING_SIGNATURE_INVALID');
    $expected = hash_hmac('sha256', $timestamp.':'.$raw, $secret);
    foreach ($signatures as $signature) {
        if (!hash_equals($expected, $signature)) continue;
        $event = json_decode($raw, true, 48, JSON_THROW_ON_ERROR);
        if (!is_array($event) || !is_string($event['event_type'] ?? null))
            throw new InvalidArgumentException('BILLING_EVENT_INVALID');
        return $event;
    }
    throw new GenesisResourceLimitException(403, 'BILLING_SIGNATURE_INVALID');
}

function genesisBillingPaddleCheckout(PDO $db, array $order, array $config, ?callable $http = null): array
{
    $http ??= 'genesisBillingHttp';
    $id = $order['id'];
    $db->prepare('INSERT OR IGNORE INTO billing_paddle_checkout(order_id) VALUES(?)')->execute([$id]);
    $lease = genesisUuid();
    $claim = $db->prepare("UPDATE billing_paddle_checkout SET lease_id=?,lease_until=?
        WHERE order_id=? AND lease_until<=? AND EXISTS(SELECT 1 FROM billing_orders
            WHERE id=? AND provider='paddle' AND status='pending' AND provider_secret IS NULL)");
    $now = time();
    $claim->execute([$lease, $now+90, $id, $now, $id]);
    if ($claim->rowCount() !== 1) return genesisBillingOrder($db, $id);

    try {
        $priceId = $order['product_id'];
        if (!genesisBillingPaddleId($priceId, 'pri')) throw new DomainException('BILLING_PRICE_NOT_CONFIGURED');
        $price = genesisBillingPaddleData($config, 'GET', '/prices/'.$priceId, null, $http);
        if (!genesisBillingPaddlePriceMatches($price, $order)) throw new DomainException('BILLING_PRICE_NOT_CONFIGURED');
        $transaction = genesisBillingPaddleData($config, 'POST', '/transactions', [
            'items' => [['price_id'=>$priceId, 'quantity'=>1]],
            'currency_code'=>'USD', 'collection_mode'=>'automatic',
            'custom_data'=>['genesis_order_id'=>$id],
        ], $http);
        genesisBillingPaddleOrderContext($transaction, $order);
        if (!in_array($transaction['status'] ?? null, ['draft','ready'], true))
            throw new DomainException('BILLING_PROVIDER_RESPONSE_INVALID');

        // Paddle draft transactions can be abandoned on a lost response. Only the lease
        // holder can publish a checkout and only the saved transaction can grant access.
        $url = genesisBillingPaddleCheckoutUrl($id);
        $write = $db->prepare("UPDATE billing_orders SET provider_secret=?,checkout_url=?,updated_at=?
            WHERE id=? AND status='pending' AND provider_secret IS NULL
            AND EXISTS(SELECT 1 FROM billing_paddle_checkout WHERE order_id=? AND lease_id=?)");
        $write->execute([$transaction['id'],$url,genesisNow(),$id,$id,$lease]);
        return genesisBillingOrder($db, $id);
    } finally {
        $db->prepare('UPDATE billing_paddle_checkout SET lease_id=NULL,lease_until=0 WHERE order_id=? AND lease_id=?')
            ->execute([$id,$lease]);
    }
}

function genesisBillingPaddleCheckoutUrl(string $id): string
{
    return rtrim(genesisConfig()['app_url'], '/').'/pay-paddle.html?billingOrder='.rawurlencode($id);
}

function genesisBillingPaddleVerify(PDO $db, array $order, array $config, callable $http, bool $throttle = false): array
{
    if (!genesisBillingPaddleId($order['provider_secret'], 'txn')) return $order;
    if ($throttle) {
        $now = time();
        $claim = $db->prepare('UPDATE billing_paddle_checkout SET checked_at=? WHERE order_id=? AND checked_at<=?');
        $claim->execute([$now, $order['id'], $now-10]);
        if ($claim->rowCount() !== 1) return genesisBillingOrder($db, $order['id']);
    }
    $transaction = genesisBillingPaddleData($config, 'GET', '/transactions/'.$order['provider_secret'], null, $http);
    $receipt = genesisBillingPaddleReceipt($transaction, $order);
    if ($receipt !== null) genesisBillingApplyReceipt($db, $receipt, time());
    return genesisBillingOrder($db, $order['id']);
}

function genesisBillingPaddleWebhook(PDO $db, array $event, array $configuration, callable $http): void
{
    $id = match ($event['event_type']) {
        'transaction.completed','transaction.canceled' => $event['data']['id'] ?? null,
        'adjustment.created','adjustment.updated' => $event['data']['transaction_id'] ?? null,
        default => null,
    };
    if (!genesisBillingPaddleId($id, 'txn')) return;
    $query = $db->prepare("SELECT * FROM billing_orders WHERE provider='paddle' AND provider_secret=?");
    $query->execute([$id]);
    $order = $query->fetch();
    if ($order) genesisBillingPaddleVerify($db, $order, $configuration, $http);
}

function genesisBillingPaddleExpire(PDO $db, array $order, array $configuration, callable $http, int $now): void
{
    $transactionId = $order['provider_secret'];
    if ($transactionId === null) {
        genesisBeginWriteTransaction($db);
        try {
            $write = $db->prepare("UPDATE billing_orders SET status='cancelled',updated_at=?
                WHERE id=? AND status='pending' AND provider_secret IS NULL
                AND NOT EXISTS(SELECT 1 FROM billing_paddle_checkout WHERE order_id=? AND lease_until>?)");
            $write->execute([genesisNow(),$order['id'],$order['id'],$now]);
            if ($write->rowCount() === 1)
                $db->prepare('UPDATE billing_lifetime_seats SET owner_hash=NULL,order_id=NULL,reserved_until=NULL
                    WHERE order_id=? AND purchased_at IS NULL AND revoked_at IS NULL')->execute([$order['id']]);
            $db->commit();
        } catch (Throwable $error) {
            if ($db->inTransaction()) $db->rollBack();
            throw $error;
        }
        return;
    }
    if (!genesisBillingPaddleId($transactionId, 'txn')) throw new DomainException('BILLING_RECEIPT_MISMATCH');
    $transaction = genesisBillingPaddleData($configuration, 'GET', '/transactions/'.$transactionId, null, $http);
    genesisBillingPaddleOrderContext($transaction, $order);
    if (in_array($transaction['status'] ?? null, ['draft','ready','past_due'], true))
        $transaction = genesisBillingPaddleData($configuration,'PATCH','/transactions/'.$transactionId,
            ['status'=>'canceled'],$http);
    $receipt = genesisBillingPaddleReceipt($transaction, $order);
    if ($receipt !== null) genesisBillingApplyReceipt($db, $receipt, $now);
}

function genesisBillingPaddleScan(): void
{
    $settings = genesisBillingSettings();
    if (!genesisBillingProviderReady('paddle', $settings)) return;
    $db = genesisDb();
    $now = time();
    $query = $db->prepare("SELECT * FROM billing_orders WHERE provider='paddle' AND status='pending' AND created_at<=?
        AND updated_at<=? ORDER BY updated_at,id LIMIT 3");
    $query->execute([gmdate('Y-m-d\TH:i:s\Z',$now-86400),gmdate('Y-m-d\TH:i:s\Z',$now-300)]);
    foreach ($query->fetchAll() as $order) {
        try {
            genesisBillingPaddleExpire($db, $order, $settings['providers']['paddle'], 'genesisBillingHttp', $now);
        } catch (Throwable) {
            // Rotate failed provider lookups out of the next batch without logging raw bodies.
            $db->prepare("UPDATE billing_orders SET updated_at=? WHERE id=? AND status='pending'")
                ->execute([genesisNow(),$order['id']]);
        }
    }
}
