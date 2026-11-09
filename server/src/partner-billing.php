<?php
declare(strict_types=1);

function genesisPartnerCalculation(PDO $db, array $payment, string $kind, ?int $fee, ?int $tax, string $state,
    string $reason, ?string $actor = null, ?string $evidenceHash = null): array
{
    $refunded = (int)$payment['refunded_minor'];
    $base = $fee !== null && $tax !== null ? (int)$payment['amount_minor'] - $refunded - $fee - $tax : null;
    $share = $base === null ? null : genesisPartnerHalf($base);
    $revision = (int)$payment['revision'] + 1; $id = genesisUuid();
    $db->prepare('INSERT INTO partner_calculations(id,payment_id,revision,kind,state,refunded_minor,fee_minor,tax_minor,base_minor,share_minor,share_bps,actor_id,reason,evidence_hash,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')->execute([$id, $payment['id'], $revision, $kind, $state, $refunded, $fee, $tax,
        $base, $share, GENESIS_PARTNER_SHARE_BPS, $actor, $reason, $evidenceHash, genesisNow()]);
    $db->prepare('UPDATE partner_payments SET revision=?,refunded_minor=? WHERE id=?')->execute([$revision, $refunded, $payment['id']]);
    $db->prepare('UPDATE partners SET revision=revision+1 WHERE id=?')->execute([$payment['partner_id']]);
    return ['calculationId' => $id, 'revision' => $revision, 'shareMinor' => $share];
}

/** Receives only the existing billing adapter's verified receipt, within its payment transaction. */
function genesisPartnerObserveReceipt(PDO $db, array $order, GenesisVerifiedBillingReceipt $receipt, int $now): void
{
    if (!genesisPartnersEnabled() || $receipt->provider !== 'yookassa' || $receipt->currency !== 'RUB'
        || $receipt->amountMinor === 0 || !in_array($receipt->state, ['paid', 'refunded'], true)) return;
    if (!$db->inTransaction()) throw new LogicException('PARTNER_RECEIPT_TRANSACTION_REQUIRED');
    if (($order['provider'] ?? null) !== 'yookassa' || $order['id'] !== $receipt->orderId
        || (int)$order['amount_minor'] !== $receipt->amountMinor || $order['currency'] !== $receipt->currency
        || $order['product_id'] !== $receipt->productId) throw new DomainException('BILLING_RECEIPT_MISMATCH');
    genesisPartnerMoney($receipt->amountMinor); genesisPartnerMoney($receipt->refundedAmountMinor);
    $hash = hash('sha256', $receipt->reference);
    $q = $db->prepare('SELECT * FROM partner_payments WHERE provider=? AND reference_hash=?'); $q->execute(['yookassa', $hash]); $payment = $q->fetch();
    if (!$payment) {
        $q = $db->prepare('SELECT c.* FROM partner_clients c WHERE c.user_id=? AND c.bound_at<=?
            AND (c.ended_at IS NULL OR c.ended_at>?) ORDER BY c.bound_at DESC LIMIT 1');
        $q->execute([$order['user_id'], $order['created_at'], $order['created_at']]); $client = $q->fetch();
        if (!$client || $receipt->confirmedAt < $client['bound_at']) return;
        $context = array_intersect_key($order, array_flip(['id', 'amount_minor', 'currency', 'product_id', 'provider_secret', 'created_at']));
        $context['provider_secret'] = $receipt->reference;
        $id = genesisUuid();
        $db->prepare('INSERT INTO partner_payments(id,partner_id,client_id,policy_id,order_id,provider,reference_hash,plan,period_months,amount_minor,currency,confirmed_at,created_at,verification_context)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')->execute([$id, $client['partner_id'], $client['id'], $client['policy_id'], $order['id'], 'yookassa', $hash,
            $order['plan'], (int)$order['period_months'], $receipt->amountMinor, 'RUB', $receipt->confirmedAt, gmdate('Y-m-d\TH:i:s\Z', $now),
            genesisSharedContentEncrypt(json_encode($context, JSON_THROW_ON_ERROR))]);
        $q = $db->prepare('SELECT * FROM partner_payments WHERE id=?'); $q->execute([$id]); $payment = $q->fetch();
        $payment['refunded_minor'] = $receipt->state === 'refunded' ? $receipt->amountMinor : $receipt->refundedAmountMinor;
        genesisPartnerCalculation($db, $payment, $payment['refunded_minor'] > 0 ? 'refund' : 'payment', null, null, 'preliminary',
            'Verified YooKassa receipt; actual commission and NPD tax require owner confirmation', null, $receipt->evidenceHash);
        return;
    }
    genesisPartnerValidateRetainedReceipt($payment, $receipt);
    $refund = $receipt->state === 'refunded' ? $receipt->amountMinor : $receipt->refundedAmountMinor;
    if ($refund <= (int)$payment['refunded_minor']) return;
    $q = $db->prepare('SELECT * FROM partner_calculations WHERE payment_id=? AND revision=?'); $q->execute([$payment['id'], $payment['revision']]); $last = $q->fetch();
    $payment['refunded_minor'] = $refund;
    genesisPartnerCalculation($db, $payment, 'refund', $last['fee_minor'] === null ? null : (int)$last['fee_minor'],
        $last['tax_minor'] === null ? null : (int)$last['tax_minor'], 'preliminary',
        'Verified refund; previous costs are provisional and are not assumed to change proportionally', null, $receipt->evidenceHash);
}

function genesisPartnerValidateRetainedReceipt(array $payment, GenesisVerifiedBillingReceipt $receipt): void
{
    if ($receipt->provider !== 'yookassa' || $receipt->orderId !== $payment['order_id'] || $receipt->currency !== $payment['currency']
        || $receipt->amountMinor !== (int)$payment['amount_minor'] || !hash_equals($payment['reference_hash'], hash('sha256', $receipt->reference))
        || $receipt->confirmedAt !== $payment['confirmed_at'] || $receipt->refundedAmountMinor < 0 || $receipt->refundedAmountMinor > $receipt->amountMinor)
        throw new DomainException('BILLING_RECEIPT_MISMATCH');
}

/** Called after the webhook has fetched the payment using the authenticated merchant API. */
function genesisPartnerAcceptRetainedYooPayment(PDO $db, array $verifiedPayment, array $configuration, int $now): bool
{
    if (!genesisPartnersEnabled() || !is_string($verifiedPayment['id'] ?? null)) return false;
    $q = $db->prepare("SELECT p.* FROM partner_payments p LEFT JOIN billing_orders o ON o.id=p.order_id
        WHERE p.provider='yookassa' AND p.reference_hash=? AND o.id IS NULL");
    $q->execute([hash('sha256', $verifiedPayment['id'])]); $payment = $q->fetch();
    if (!$payment) return false;
    $context = json_decode(genesisSharedContentDecrypt($payment['verification_context']), true, 16, JSON_THROW_ON_ERROR);
    $receipt = genesisBillingYooReceipt($verifiedPayment, $context, $configuration);
    genesisPartnerValidateRetainedReceipt($payment, $receipt);
    $owns = !$db->inTransaction(); if ($owns) genesisPartnerWrite($db);
    try {
        genesisPartnerObserveReceipt($db, [...$context, 'provider' => 'yookassa', 'user_id' => null], $receipt, $now);
        if ($owns) $db->commit(); return true;
    } catch (Throwable $error) { if ($owns && $db->inTransaction()) $db->rollBack(); throw $error; }
}

function genesisPartnerConfirmCalculation(string $actorId, string $partnerId, string $paymentId, array $input): array
{
    genesisPartnerFields($input, ['expectedRevision', 'feeMinor', 'taxMinor', 'confirmed', 'reason']);
    if (!is_bool($input['confirmed'] ?? null)) throw new InvalidArgumentException('PARTNER_INPUT_INVALID');
    $fee = ($input['feeMinor'] ?? null) === null && !$input['confirmed'] ? null : genesisPartnerMoney($input['feeMinor'] ?? null);
    $tax = ($input['taxMinor'] ?? null) === null && !$input['confirmed'] ? null : genesisPartnerMoney($input['taxMinor'] ?? null);
    $reason = genesisPartnerText($input['reason'] ?? null, 500);
    return genesisPartnerMutate($actorId, 'calculation:' . $paymentId, $input, static function (PDO $db) use ($actorId, $partnerId, $paymentId, $input, $fee, $tax, $reason): array {
        $q = $db->prepare('SELECT * FROM partner_payments WHERE id=? AND partner_id=?'); $q->execute([$paymentId, $partnerId]); $payment = $q->fetch();
        if (!$payment) throw new GenesisResourceLimitException(404, 'PARTNER_PAYMENT_NOT_FOUND');
        genesisPartnerRevision($payment, $input['expectedRevision'] ?? null);
        if (($fee !== null && $fee > (int)$payment['amount_minor']) || ($tax !== null && $tax > (int)$payment['amount_minor'])) throw new InvalidArgumentException('PARTNER_MONEY_INVALID');
        $q = $db->prepare("SELECT COUNT(*) FROM partner_calculations WHERE payment_id=? AND state='confirmed'"); $q->execute([$paymentId]); $hasConfirmed = (int)$q->fetchColumn() > 0;
        $result = genesisPartnerCalculation($db, $payment, !$input['confirmed'] ? 'estimate' : ($hasConfirmed ? 'correction' : 'confirmation'),
            $fee, $tax, $input['confirmed'] ? 'confirmed' : 'preliminary', $reason, $actorId);
        genesisPartnerAudit($db, $actorId, $input['confirmed'] ? 'actual-costs-confirmed' : 'estimated-costs-recorded', $partnerId, $paymentId, $reason);
        return $result;
    });
}
