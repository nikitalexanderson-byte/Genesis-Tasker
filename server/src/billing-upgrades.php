<?php
declare(strict_types=1);

/** Actual Gregorian calendar days, anchored to the confirmed payment (never fixed 30-day months). */
function genesisBillingUnusedCredit(int $amountMinor, string $startsAt, string $endsAt, int $now): int
{
    $start = genesisSubscriptionExpiry($startsAt); $end = genesisSubscriptionExpiry($endsAt);
    if ($amountMinor < 0 || $start === false || $end === false || $end <= $start)
        throw new InvalidArgumentException('BILLING_PERIOD_INVALID');
    if ($now >= $end) return 0;
    if ($now <= $start) return $amountMinor;
    $days = (int)ceil(($end - $start) / 86400);
    // Each completed payment-anchored day is consumed; a new day does not invent a 30-day divisor.
    $used = max(0, min($days, (int)floor(($now - $start) / 86400)));
    return intdiv($amountMinor * ($days - $used), $days);
}

/** Read-only, account-scoped quote. Administrative/test grants never create monetary credit. */
function genesisBillingUpgradeQuote(PDO $db, string $userId, array $offer, int $now): array
{
    $q = $db->prepare('SELECT * FROM users WHERE id=?'); $q->execute([$userId]); $user = $q->fetch();
    if (!$user) throw new DomainException('BILLING_ACCOUNT_NOT_FOUND');
    $access = genesisResolveFeatureAccess($user, genesisFeatureAccessPolicy(), $now);
    $current = $access['lifetimePremium'] ? 'premium4life' : $access['effectivePlan'];
    $quote = [...$offer, 'currentPlan'=>$current, 'listAmountMinor'=>$offer['amountMinor'],
        'creditMinor'=>0, 'quotedAt'=>gmdate('Y-m-d\TH:i:s\Z',$now),
        'validUntil'=>$offer['periodMonths'] === 0 ? null : genesisBillingPeriodEnd(gmdate('Y-m-d\TH:i:s\Z',$now),$offer['periodMonths']),
        'creditSource'=>null, 'upgradeUnavailableReason'=>null];
    $ranks = ['free'=>0,'standart'=>1,'premium'=>2,'business'=>3,'premium4life'=>4];
    if ($current === 'premium4life') {
        $quote['availableProviders'] = []; $quote['upgradeUnavailableReason'] = 'already-lifetime'; return $quote;
    }
    $unsettled=$db->prepare("SELECT s.order_id FROM billing_settlements s JOIN billing_orders o ON o.id=s.order_id
        WHERE o.user_id=? AND s.state NOT IN ('completed','refunded','cancelled') ORDER BY s.created_at,s.order_id LIMIT 1");
    $unsettled->execute([$userId]);$unsettledId=$unsettled->fetchColumn();
    if(is_string($unsettledId)){
        $quote['availableProviders']=[];$quote['upgradeUnavailableReason']='settlement-required';$quote['settlementOrderId']=$unsettledId;return $quote;
    }
    // An existing authorization keeps its own price/currency, even after source expiry or catalog changes.
    $pending=$db->prepare("SELECT t.* FROM billing_orders t WHERE t.user_id=? AND t.plan=? AND t.period_months=? AND t.status='pending'
        AND EXISTS(SELECT 1 FROM billing_upgrade_credits c WHERE c.order_id=t.id) ORDER BY t.created_at,t.id LIMIT 1");
    $pending->execute([$userId,$offer['plan'],$offer['periodMonths']]);$pendingOrder=$pending->fetch();
    if($pendingOrder)return genesisBillingPendingUpgradeQuote($quote,$pendingOrder);
    if(($offer['provider']??null)==='yookassa'){
        // Closing/reopening the payment dialog must resume the frozen checkout, even with a new client key.
        $pending=$db->prepare("SELECT * FROM billing_orders WHERE user_id=? AND provider='yookassa' AND plan=? AND period_months=?
            AND currency=? AND status='pending' AND upgrade_credit_minor=0 ORDER BY created_at,id LIMIT 1");
        $pending->execute([$userId,$offer['plan'],$offer['periodMonths'],$offer['currency']]);$pendingOrder=$pending->fetch();
        if($pendingOrder)return genesisBillingPendingUpgradeQuote($quote,$pendingOrder);
    }
    if (($ranks[$offer['plan']] ?? -1) <= $ranks[$current] || $current === 'free') return $quote;
    // Only the currently active purchased period is exchanged. Future prepaid renewals remain intact.
    $q = $db->prepare("SELECT p.*,r.order_id,o.amount_minor,o.list_amount_minor,o.period_months,o.currency,
        c.order_id AS reserved_order_id,t.plan AS reserved_plan,t.period_months AS reserved_months,
        t.upgrade_credit_minor,t.created_at AS reserved_at,t.status AS reserved_status,
        t.amount_minor AS reserved_amount_minor,t.list_amount_minor AS reserved_list_amount_minor,
        t.currency AS reserved_currency,t.provider AS reserved_provider
        FROM billing_periods p JOIN billing_receipts r
          ON r.provider=p.provider AND r.reference_hash=p.reference_hash
        JOIN billing_orders o ON o.id=r.order_id
        LEFT JOIN billing_upgrade_credits c ON c.source_provider=p.provider AND c.source_reference_hash=p.reference_hash
        LEFT JOIN billing_orders t ON t.id=c.order_id
        WHERE p.user_id=? AND p.plan=? AND r.state='paid'
          AND p.starts_at<=? AND p.ends_at>?
        ORDER BY (o.currency=?) DESC,p.starts_at DESC,p.ends_at DESC LIMIT 1");
    $stamp = $quote['quotedAt']; $q->execute([$userId,$current,$stamp,$stamp,$offer['currency']]); $source = $q->fetch();
    if (!$source) return $quote;
    if($source['currency']!==$offer['currency']){
        $quote['availableProviders']=[];$quote['upgradeUnavailableReason']='credit-currency-unavailable';return $quote;
    }
    if($source['provider']==='google-play'){
        $quote['availableProviders']=[];$quote['upgradeUnavailableReason']='credit-source-unverified';return $quote;
    }
    if ($source['reserved_order_id'] !== null) {
        if ($source['reserved_status'] === 'pending' && $source['reserved_plan'] === $offer['plan']
            && (int)$source['reserved_months'] === $offer['periodMonths']) {
            return genesisBillingPendingUpgradeQuote($quote,['id'=>$source['reserved_order_id'],'amount_minor'=>$source['reserved_amount_minor'],
                'list_amount_minor'=>$source['reserved_list_amount_minor'],'upgrade_credit_minor'=>$source['upgrade_credit_minor'],
                'currency'=>$source['reserved_currency'],'created_at'=>$source['reserved_at'],'provider'=>$source['reserved_provider'],
                'period_months'=>$source['reserved_months']]);
        } else {
            $quote['availableProviders'] = []; $quote['upgradeUnavailableReason'] = 'upgrade-pending'; return $quote;
        }
    } else {
        if ($offer['periodMonths'] !== 0 && $offer['periodMonths'] < (int)$source['period_months']) {
            $quote['availableProviders'] = []; $quote['upgradeUnavailableReason'] = 'shorter-period';
            $quote['recommendedPeriodMonths'] = (int)$source['period_months']; return $quote;
        }
        $value = genesisBillingFundedReceiptValue($db,$source['provider'],$source['reference_hash']);
        $quote['creditMinor'] = genesisBillingUnusedCredit($value,$source['starts_at'],$source['ends_at'],$now);
    }
    if ($quote['creditMinor'] > 0 && $offer['periodMonths'] === 0) {
        $quote['amountMinor'] = max(0,$offer['amountMinor'] - $quote['creditMinor']);
        $quote['creditMinor'] = min($offer['amountMinor'],$quote['creditMinor']);
        $quote['availableProviders'] = []; $quote['upgradeUnavailableReason'] = 'lifetime-credit-unavailable'; return $quote;
    }
    if ($quote['creditMinor'] >= $offer['amountMinor']) {
        // Never silently discard a balance or create an unverified zero-price payment.
        $quote['unusedCreditMinor'] = $quote['creditMinor'];
        $quote['creditMinor'] = $offer['amountMinor'];
        $quote['amountMinor'] = 0;
        $quote['availableProviders'] = []; $quote['upgradeUnavailableReason'] = 'credit-covers-price'; return $quote;
    }
    $quote['amountMinor'] = $offer['amountMinor'] - $quote['creditMinor'];
    if ($quote['creditMinor'] > 0) {
        $quote['creditSource'] = ['provider'=>$source['provider'],'referenceHash'=>$source['reference_hash'],
            'startsAt'=>$source['starts_at'],'endsAt'=>$source['ends_at'],'valueMinor'=>$value];
        // Play one-time product prices are fixed. A custom amount must never be claimed on such a product.
        $quote['availableProviders'] = array_values(array_filter($quote['availableProviders'],
            static fn(string $provider): bool => $provider === 'yookassa'));
        if(($quote['creditCheckoutEnabled']??false)!==true){$quote['availableProviders']=[];$quote['upgradeUnavailableReason']='credit-checkout-unavailable';}
    }
    return $quote;
}

function genesisBillingPendingUpgradeQuote(array $quote,array $order): array
{
    $quote['creditMinor']=(int)$order['upgrade_credit_minor'];$quote['amountMinor']=(int)$order['amount_minor'];
    $quote['listAmountMinor']=(int)($order['list_amount_minor']??$order['amount_minor']);$quote['currency']=$order['currency'];
    $quote['quotedAt']=$order['created_at'];$quote['pendingOrderId']=$order['id'];
    $quote['validUntil']=(int)$order['period_months']===0?null:genesisBillingPeriodEnd($order['created_at'],(int)$order['period_months']);
    $quote['availableProviders']=array_values(array_intersect($quote['_allAvailableProviders']??$quote['availableProviders'],[$order['provider']]));
    // Ordinary pending checkout has no purchased-period credit to gate.
    if($quote['creditMinor']>0){
        if((int)$order['period_months']===0){$quote['availableProviders']=[];$quote['upgradeUnavailableReason']='lifetime-credit-unavailable';}
        elseif(($quote['creditCheckoutEnabled']??false)!==true){$quote['availableProviders']=[];$quote['upgradeUnavailableReason']='credit-checkout-unavailable';}
    }
    return $quote;
}

function genesisBillingPublicQuote(array $quote): array
{
    unset($quote['creditSource'],$quote['_allAvailableProviders']);
    $quote['offerId'] = $quote['id']; unset($quote['id']);
    return $quote;
}

/** A refunded source cannot continue funding a discounted successor (including a chain of upgrades). */
function genesisBillingFundedOrderValue(PDO $db, string $orderId, array $visited = []): int
{
    $q=$db->prepare("SELECT provider,reference_hash FROM billing_receipts WHERE order_id=? AND state='paid'");
    $q->execute([$orderId]);$funded=0;
    foreach($q->fetchAll() as $receipt) $funded=max($funded,genesisBillingFundedReceiptValue($db,$receipt['provider'],$receipt['reference_hash'],$visited));
    return $funded;
}

/** Value is tied to the exact verified receipt, even if one order has multiple provider references. */
function genesisBillingFundedReceiptValue(PDO $db,string $provider,string $referenceHash,array $visited=[]): int
{
    $q=$db->prepare("SELECT o.*,r.confirmed_at,r.refunded_amount_minor FROM billing_orders o JOIN billing_receipts r ON r.order_id=o.id
        LEFT JOIN subscription_access_state s ON s.user_id=o.user_id
        WHERE r.provider=? AND r.reference_hash=? AND r.state='paid'
        AND NOT EXISTS(SELECT 1 FROM billing_settlements bs WHERE bs.order_id=o.id AND bs.state<>'completed')
        AND (s.receipts_after IS NULL OR (o.created_at>s.receipts_after AND r.confirmed_at>s.receipts_after))");
    $q->execute([$provider,$referenceHash]);$order=$q->fetch();
    if(!$order)return 0;
    $orderId=$order['id'];
    if (isset($visited[$orderId])) throw new DomainException('BILLING_CREDIT_CYCLE');
    $visited[$orderId] = true;
    $funded=max(0,(int)$order['amount_minor']-(int)$order['refunded_amount_minor']);
    $q=$db->prepare('SELECT * FROM billing_upgrade_credits WHERE order_id=?');
    $q->execute([$orderId]);
    // Discounted Lifetime settlement stays closed until it can safely compensate a funding shortfall.
    if($order['plan']!=='premium4life')foreach($q->fetchAll() as $credit) $funded+=genesisBillingEffectiveUpgradeCredit($db,$credit,genesisSubscriptionExpiry($order['confirmed_at']),$visited);
    return min((int)($order['list_amount_minor'] ?? $order['amount_minor']),$funded);
}

/** A quote is a ceiling. Actual capture time and any later source refund can only reduce its funding. */
function genesisBillingEffectiveUpgradeCredit(PDO $db,array $credit,int $at,array $visited=[]): int
{
    if($credit['source_provider']==='google-play')return 0; // ProductPurchase v1 proves the SKU, not paid amount/currency.
    $start=genesisSubscriptionExpiry($credit['source_starts_at']??null);
    $end=genesisSubscriptionExpiry($credit['source_ends_at']??null);
    $quotedValue=(int)($credit['source_value_minor']??0);
    if($start===false||$end===false||$end<=$start||$quotedValue<=0)return 0;
    $value=min($quotedValue,genesisBillingFundedReceiptValue($db,$credit['source_provider'],$credit['source_reference_hash'],$visited));
    if($value<=0)return 0;
    $end=$start+intdiv(($end-$start)*$value,$quotedValue);
    if($end<=$start)return 0;
    return min((int)$credit['amount_minor'],genesisBillingUnusedCredit($value,gmdate('Y-m-d\TH:i:s\Z',$start),gmdate('Y-m-d\TH:i:s\Z',$end),$at));
}

/** Revalidate the daily balance before capturing an authorization, so an old checkout cannot overspend it. */
function genesisBillingUpgradeCaptureValid(PDO $db, array $order, int $now): bool
{
    if ((int)($order['upgrade_credit_minor'] ?? 0) === 0) return true;
    if(($order['plan']??null)==='premium4life')return false;
    $target=$db->prepare('SELECT o.created_at,s.receipts_after FROM billing_orders o LEFT JOIN subscription_access_state s ON s.user_id=o.user_id WHERE o.id=?');
    $target->execute([$order['id']]);$target=$target->fetch();
    if(!$target||($target['receipts_after']!==null&&($target['created_at']<=$target['receipts_after']||gmdate('Y-m-d\TH:i:s\Z',$now)<=$target['receipts_after'])))return false;
    $q=$db->prepare('SELECT * FROM billing_upgrade_credits WHERE order_id=?');
    $q->execute([$order['id']]); $rows = $q->fetchAll();
    if (count($rows) !== 1) return false;
    $source = $rows[0];
    return genesisBillingEffectiveUpgradeCredit($db,$source,$now+GENESIS_BILLING_CAPTURE_MARGIN_SECONDS) === (int)$order['upgrade_credit_minor'];
}

/** Reserve under the same SQLite writer as order creation; concurrent checkouts cannot spend it twice. */
function genesisBillingReserveUpgrade(PDO $db, string $orderId, array $quote): void
{
    if ($quote['creditMinor'] <= 0 || $quote['creditSource'] === null) return;
    $source = $quote['creditSource'];
    $db->prepare('INSERT INTO billing_upgrade_credits(source_provider,source_reference_hash,order_id,amount_minor,quoted_at,source_starts_at,source_ends_at,source_value_minor)
        VALUES(?,?,?,?,?,?,?,?)')->execute([$source['provider'],$source['referenceHash'],$orderId,$quote['creditMinor'],$quote['quotedAt'],
            $source['startsAt'],$source['endsAt'],$source['valueMinor']]);
}

/** Only provider-confirmed cancellation/refund releases a reservation. */
function genesisBillingReleaseUpgrade(PDO $db, string $orderId, string $state): void
{
    if (in_array($state,['cancelled','refunded'],true))
        $db->prepare('DELETE FROM billing_upgrade_credits WHERE order_id=?')->execute([$orderId]);
}
