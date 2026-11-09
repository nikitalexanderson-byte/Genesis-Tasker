<?php
declare(strict_types=1);

const GENESIS_BILLING_CAPTURE_MARGIN_SECONDS = 60;
// YooKassa idempotency is time-bounded. Never blindly recreate an unknown refund after that window.
const GENESIS_BILLING_REFUND_REPLAY_SECONDS = 23 * 3600;

function genesisBillingSettlement(PDO $db,string $orderId): ?array
{
    $q=$db->prepare('SELECT * FROM billing_settlements WHERE order_id=?');$q->execute([$orderId]);return $q->fetch()?:null;
}

function genesisBillingSettlementBlocked(?array $row): bool
{
    return $row!==null&&!in_array($row['state'],['completed','refunded','cancelled'],true);
}

/** Run before account token revocation; the SQL trigger remains the race-safe backstop. */
function genesisBillingAssertAccountDeletable(PDO $db,string $userId): void
{
    $q=$db->prepare("SELECT 1 FROM billing_orders o LEFT JOIN billing_settlements s ON s.order_id=o.id
        WHERE o.user_id=? AND (o.status='pending'
        OR s.state NOT IN ('completed','refunded','cancelled')) LIMIT 1");$q->execute([$userId]);
    if($q->fetchColumn()!==false)throw new GenesisResourceLimitException(409,'BILLING_SETTLEMENT_REQUIRED');
    // Older schema fixtures retain the previous subscription-only deletion contract.
    if($db->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='future_modeling_orders'")->fetchColumn()!==false){
        $q=$db->prepare("SELECT 1 FROM future_modeling_orders WHERE user_id=? AND status='pending' LIMIT 1");$q->execute([$userId]);
        if($q->fetchColumn()!==false)throw new GenesisResourceLimitException(409,'BILLING_SETTLEMENT_REQUIRED');
    }
}

function genesisBillingPublicSettlement(?array $row,array $order): ?array
{
    if(!$row||$row['state']==='completed')return null;
    return ['status'=>$row['state']==='capture-pending'?'verifying':$row['state'],'reason'=>$row['reason'],
        'deficitMinor'=>(int)$row['deficit_minor'],'refundAmountMinor'=>$row['refund_amount_minor']===null?null:(int)$row['refund_amount_minor'],
        'currency'=>$order['currency'],'retryAt'=>$row['next_attempt_at'],'errorCode'=>$row['error_code']];
}

/** This durable marker precedes network I/O, so a crash/timeout can be reconciled by the worker. */
function genesisBillingSettlementCaptureBegin(PDO $db,array $order,string $action,int $now): string
{
    $stamp=gmdate('Y-m-d\TH:i:s\Z',$now);
    $db->prepare("INSERT OR IGNORE INTO billing_settlements(order_id,state,reason,capture_action,next_attempt_at,created_at,updated_at)
        VALUES(?,'capture-pending',?,?,?, ?,?)")->execute([$order['id'],$action==='cancel'?'capture-window-expired':'capture-unknown',$action,
            gmdate('Y-m-d\TH:i:s\Z',$now+60),$stamp,$stamp]);
    $row=genesisBillingSettlement($db,$order['id']);
    // A confirmed cancellation decision is never changed into a later capture.
    if($row['state']!=='capture-pending')throw new DomainException('BILLING_SETTLEMENT_NOT_CAPTURABLE');
    if($action==='cancel'&&$row['capture_action']!=='cancel'){
        $db->prepare("UPDATE billing_settlements SET capture_action='cancel',reason='capture-window-expired',updated_at=? WHERE order_id=? AND state='capture-pending'")->execute([$stamp,$order['id']]);
    }
    return genesisBillingSettlement($db,$order['id'])['capture_action']??$action;
}

/** Only first verified capture is a fulfilment decision. Later legitimate refunds keep normal net-period rules. */
function genesisBillingSettlementObserve(PDO $db,array $order,GenesisVerifiedBillingReceipt $receipt,?array $existing,int $now): void
{
    if((int)($order['upgrade_credit_minor']??0)<=0)return;
    $row=genesisBillingSettlement($db,$order['id']);$stamp=gmdate('Y-m-d\TH:i:s\Z',$now);
    if($receipt->state!=='paid'||$receipt->refundedAmountMinor===$receipt->amountMinor){
        $state=$receipt->state==='cancelled'?'cancelled':'refunded';
        if($row)$db->prepare('UPDATE billing_settlements SET state=?,next_attempt_at=NULL,error_code=NULL,updated_at=? WHERE order_id=?')
            ->execute([$state,$stamp,$order['id']]);
        return;
    }
    if($row&&$row['state']!=='capture-pending')return;
    $actual=0;
    $q=$db->prepare('SELECT * FROM billing_upgrade_credits WHERE order_id=?');$q->execute([$order['id']]);
    foreach($q->fetchAll()as$credit)if($order['plan']!=='premium4life')$actual+=genesisBillingEffectiveUpgradeCredit($db,$credit,genesisSubscriptionExpiry($receipt->confirmedAt),[$order['id']=>true]);
    // Previously accepted receipts are not retroactively classified as capture failures after a source refund.
    $deficit=$existing&&$existing['state']==='paid'?0:max(0,(int)$order['upgrade_credit_minor']-$actual);
    $state=$deficit>0?'refund-required':'completed';
    $db->prepare("INSERT INTO billing_settlements(order_id,state,reason,reference_hash,captured_at,promised_ends_at,deficit_minor,next_attempt_at,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET state=excluded.state,reason=excluded.reason,
        reference_hash=excluded.reference_hash,captured_at=excluded.captured_at,promised_ends_at=excluded.promised_ends_at,
        deficit_minor=excluded.deficit_minor,next_attempt_at=excluded.next_attempt_at,error_code=NULL,updated_at=excluded.updated_at")
        ->execute([$order['id'],$state,$deficit>0?'capture-credit-deficit':null,hash('sha256',$receipt->reference),$receipt->confirmedAt,
            (int)$order['period_months']===0?null:genesisBillingPeriodEnd($receipt->confirmedAt,(int)$order['period_months']),$deficit,$deficit>0?$stamp:null,$stamp,$stamp]);
}

/** Sanitized, durable retry/error. Never persist exception bodies, tokens or credentials. */
function genesisBillingSettlementRetry(PDO $db,string $orderId,int $now,string $code,bool $terminal=false): void
{
    $row=genesisBillingSettlement($db,$orderId);if(!genesisBillingSettlementBlocked($row))return;
    $allowed=['BILLING_CAPTURE_UNKNOWN','BILLING_REFUND_UNKNOWN','BILLING_REFUND_PENDING','BILLING_REFUND_CANCELLED',
        'BILLING_REFUND_RECONCILIATION_REQUIRED','BILLING_REFUND_REPLAY_EXPIRED','BILLING_RECEIPT_MISMATCH',
        'BILLING_TEST_PAYMENT_UNSUPPORTED','BILLING_PROVIDER_UNAVAILABLE','BILLING_SETTLEMENT_CONFIGURATION_REQUIRED','BACKGROUND_LEASE_EXPIRED'];
    if(!in_array($code,$allowed,true))$code='BILLING_PROVIDER_UNAVAILABLE';
    $attempts=(int)$row['attempts']+1;$terminal=$terminal||$attempts>=5;
    $next=$terminal?null:gmdate('Y-m-d\TH:i:s\Z',$now+min(3600,30*(2**min(7,$attempts))));
    $db->prepare('UPDATE billing_settlements SET state=?,attempts=?,next_attempt_at=?,error_code=?,updated_at=? WHERE order_id=? AND state NOT IN (\'completed\',\'refunded\',\'cancelled\')')
        ->execute([$terminal?'failed':$row['state'],$attempts,$next,$code,gmdate('Y-m-d\TH:i:s\Z',$now),$orderId]);
}

/** Refund evidence must bind the exact shop-verified target payment, currency and frozen refund request. */
function genesisBillingSettlementRefundStatus(array $refund,array $order,array $row): string
{
    $expected=sprintf('%d.%02d',intdiv((int)$row['refund_amount_minor'],100),(int)$row['refund_amount_minor']%100);
    if(($refund['test']??false)!==false||!is_string($refund['id']??null)||!preg_match('/\A[a-zA-Z0-9-]{1,100}\z/D',$refund['id'])
        ||($refund['payment_id']??null)!==$order['provider_secret']||($refund['amount']['value']??null)!==$expected
        ||($refund['amount']['currency']??null)!==$order['currency']||($row['refund_id']!==null&&$row['refund_id']!==$refund['id'])
        ||!in_array($refund['status']??null,['pending','succeeded','canceled'],true))throw new DomainException('BILLING_RECEIPT_MISMATCH');
    return $refund['status'];
}

function genesisBillingSettlementRefundBody(array $order,array $row,array $configuration): array
{
    $body=['payment_id'=>$order['provider_secret'],'amount'=>['value'=>sprintf('%d.%02d',intdiv((int)$row['refund_amount_minor'],100),(int)$row['refund_amount_minor']%100),'currency'=>$order['currency']],
        'description'=>'GENESIS upgrade settlement'];
    if(($configuration['receipt_required']??true)===true){
        if(!is_string($order['encrypted_receipt']??null)||!function_exists('genesisSharedContentDecrypt'))throw new DomainException('BILLING_SETTLEMENT_CONFIGURATION_REQUIRED');
        $receipt=json_decode(genesisSharedContentDecrypt($order['encrypted_receipt']),true,16,JSON_THROW_ON_ERROR);
        $item=$receipt['items'][0]??null;
        if(!is_array($receipt)||!filter_var($receipt['customer']['email']??'',FILTER_VALIDATE_EMAIL)||!is_array($item)||count($receipt['items'])!==1
            ||($item['amount']['currency']??null)!==$order['currency']||($item['amount']['value']??null)!==sprintf('%d.%02d',intdiv((int)$order['amount_minor'],100),(int)$order['amount_minor']%100)
            ||($item['quantity']??null)!=='1.00'||($item['payment_subject']??null)!=='service'||($item['payment_mode']??null)!=='full_payment'
            ||!is_int($item['vat_code']??null)||!is_string($item['description']??null))throw new DomainException('BILLING_SETTLEMENT_CONFIGURATION_REQUIRED');
        $receipt['items'][0]['amount']=$body['amount'];$body['receipt']=$receipt;
    }
    return $body;
}

/** All provider calls run without a SQLite writer; every mutation is replay-safe. No extra charge is possible here. */
function genesisBillingSettlementReconcile(PDO $db,array $order,array $configuration,?callable $http=null,?int $now=null): string
{
    $now??=time();$http??='genesisBillingHttp';$row=genesisBillingSettlement($db,$order['id']);
    if($row&&in_array($row['state'],['refunded','cancelled'],true))return $row['state'];
    if($db->inTransaction())throw new LogicException('BILLING_NETWORK_IN_TRANSACTION');
    try{
        if($order['provider']!=='yookassa'||(int)$order['upgrade_credit_minor']<=0||!is_string($order['provider_secret'])||$order['provider_secret']===''
            ||!is_string($configuration['shop_id']??null)||!is_string($configuration['secret_key']??null))throw new DomainException('BILLING_SETTLEMENT_CONFIGURATION_REQUIRED');
        $basic=$configuration['shop_id'].':'.$configuration['secret_key'];$paymentUrl='https://api.yookassa.ru/v3/payments/'.rawurlencode($order['provider_secret']);
        // After every unknown outcome, verify the payment before considering the same idempotent operation again.
        $payment=$http('GET',$paymentUrl,null,[],$basic);
        if(($payment['id']??null)!==$order['provider_secret'])throw new DomainException('BILLING_RECEIPT_MISMATCH');
        $payment=genesisBillingYooSettleUpgrade($db,$payment,$order,$configuration,$http,$now);
        $receipt=genesisBillingYooReceipt($payment,$order,$configuration);
        genesisBillingApplyReceipt($db,$receipt,$now);
        $row=genesisBillingSettlement($db,$order['id']);
        if(!$row||in_array($row['state'],['completed','refunded','cancelled'],true))return $row['state']??'completed';
        if($row['state']==='failed')return 'failed';
        if($row['state']==='capture-pending')throw new DomainException('BILLING_CAPTURE_UNKNOWN');
        $stamp=gmdate('Y-m-d\TH:i:s\Z',$now);
        if($row['refund_key']===null){
            $base=$receipt->refundedAmountMinor;$remaining=$receipt->amountMinor-$base;
            $body=genesisBillingSettlementRefundBody($order,[...$row,'refund_amount_minor'=>$remaining],$configuration);
            $encryptedRequest=genesisSharedContentEncrypt(json_encode($body,JSON_THROW_ON_ERROR));
            $db->prepare("UPDATE billing_settlements SET state='refund-pending',refund_amount_minor=?,refund_base_minor=?,refund_key=?,
                encrypted_refund_request=?,refund_started_at=?,updated_at=? WHERE order_id=? AND refund_key IS NULL AND state='refund-required'")
                ->execute([$remaining,$base,hash('sha256',$order['id'].':settlement-refund:v1'),$encryptedRequest,$stamp,$stamp,$order['id']]);
            $row=genesisBillingSettlement($db,$order['id']);
        }
        if(!genesisBillingSettlementBlocked($row))return $row['state'];
        if($row['refund_id']!==null){
            $refund=$http('GET','https://api.yookassa.ru/v3/refunds/'.rawurlencode($row['refund_id']),null,[],$basic);
        }else{
            // Do not change an unknown request's amount/key, or recreate it after provider deduplication can expire.
            if($now-genesisSubscriptionExpiry($row['refund_started_at'])>=GENESIS_BILLING_REFUND_REPLAY_SECONDS){
                genesisBillingSettlementRetry($db,$order['id'],$now,'BILLING_REFUND_REPLAY_EXPIRED',true);return 'failed';
            }
            if($receipt->refundedAmountMinor!==(int)$row['refund_base_minor']){
                genesisBillingSettlementRetry($db,$order['id'],$now,'BILLING_REFUND_RECONCILIATION_REQUIRED',true);return 'failed';
            }
            if(!is_string($row['encrypted_refund_request']))throw new DomainException('BILLING_SETTLEMENT_CONFIGURATION_REQUIRED');
            $body=json_decode(genesisSharedContentDecrypt($row['encrypted_refund_request']),true,16,JSON_THROW_ON_ERROR);
            if(!is_array($body)||($body['payment_id']??null)!==$order['provider_secret']||($body['amount']['currency']??null)!==$order['currency']
                ||($body['amount']['value']??null)!==sprintf('%d.%02d',intdiv((int)$row['refund_amount_minor'],100),(int)$row['refund_amount_minor']%100))throw new DomainException('BILLING_RECEIPT_MISMATCH');
            $refund=$http('POST','https://api.yookassa.ru/v3/refunds',$body,['Idempotence-Key: '.$row['refund_key']],$basic);
        }
        $status=genesisBillingSettlementRefundStatus($refund,$order,$row);
        $db->prepare('UPDATE billing_settlements SET refund_id=COALESCE(refund_id,?),updated_at=? WHERE order_id=?')->execute([$refund['id'],$stamp,$order['id']]);
        if($status==='succeeded'){
            // Authenticated refund evidence plus the previously verified refunded base proves the full target cash returned.
            $proof=new GenesisVerifiedBillingReceipt('yookassa',$receipt->reference,$order['id'],'refunded',$receipt->amountMinor,$receipt->currency,$receipt->productId,
                $receipt->confirmedAt,hash('sha256',json_encode([$payment,$refund],JSON_THROW_ON_ERROR)),null,$receipt->amountMinor);
            genesisBillingApplyReceipt($db,$proof,$now);return 'refunded';
        }
        genesisBillingSettlementRetry($db,$order['id'],$now,$status==='canceled'?'BILLING_REFUND_CANCELLED':'BILLING_REFUND_PENDING',$status==='canceled');
    }catch(Throwable $error){
        $row=genesisBillingSettlement($db,$order['id']);
        // An accepted purchase still needs provider retries for later refund events; never acknowledge an unverified hint.
        if($row&&$row['state']==='completed')throw $error;
        if(!$row){
            // A failed initial verification still needs a durable reconciliation record, without claiming any payment.
            genesisBillingSettlementCaptureBegin($db,$order,'cancel',$now);$row=genesisBillingSettlement($db,$order['id']);
        }
        $code=$error->getMessage();
        if(!in_array($code,['BILLING_RECEIPT_MISMATCH','BILLING_TEST_PAYMENT_UNSUPPORTED','BILLING_SETTLEMENT_CONFIGURATION_REQUIRED'],true))
            $code=$row['refund_key']===null?'BILLING_CAPTURE_UNKNOWN':'BILLING_REFUND_UNKNOWN';
        genesisBillingSettlementRetry($db,$order['id'],$now,$code,in_array($code,['BILLING_RECEIPT_MISMATCH','BILLING_TEST_PAYMENT_UNSUPPORTED','BILLING_SETTLEMENT_CONFIGURATION_REQUIRED'],true));
    }
    return genesisBillingSettlement($db,$order['id'])['state'];
}

/** The settlement table is the durable outbox even if the process dies before enqueue. */
function genesisBillingSettlementScan(): void
{
    require_once __DIR__.'/billing-gateways.php';
    $q=genesisDb()->query("SELECT order_id,next_attempt_at FROM billing_settlements WHERE state IN ('capture-pending','refund-required','refund-pending') ORDER BY next_attempt_at,order_id LIMIT 100");
    foreach($q->fetchAll()as$row)genesisBackgroundEnqueue('billing-settlement','billing-settlement:'.$row['order_id'],['orderId'=>$row['order_id']],$row['next_attempt_at']);
}

function genesisBillingSettlementJobFailed(array $job,string $code): void
{
    $payload=json_decode(genesisSharedContentDecrypt($job['payload']),true,8,JSON_THROW_ON_ERROR);
    if(is_string($payload['orderId']??null))genesisBillingSettlementRetry(genesisDb(),$payload['orderId'],time(),$code,true);
}

/** Preserve existing notification handlers; this handler alone performs billing I/O outside a writer. */
function genesisBillingSettlementPerformLeased(array $job,?callable $http=null,?int $now=null): string
{
    require_once __DIR__.'/billing-gateways.php';$now??=time();$db=genesisDb();
    $owns=static function()use($db,$job):bool{$q=$db->prepare('SELECT state,lease_token FROM background_jobs WHERE id=?');$q->execute([$job['id']]);$row=$q->fetch();return $row&&$row['state']==='running'&&$row['lease_token']===$job['lease_token'];};
    if(!$owns())return 'superseded';
    $payload=json_decode(genesisSharedContentDecrypt($job['payload']),true,8,JSON_THROW_ON_ERROR);
    $q=$db->prepare('SELECT * FROM billing_orders WHERE id=?');$q->execute([$payload['orderId']??'']);$order=$q->fetch();
    $settled=$order?genesisBillingSettlement($db,$order['id']):null;
    $result=$settled&&in_array($settled['state'],['completed','refunded','cancelled'],true)?$settled['state']
        :($order?genesisBillingSettlementReconcile($db,$order,genesisBillingSettings()['providers'][$order['provider']]??[],$http,$now):'cancelled');
    genesisBeginWriteTransaction($db);
    try{
        if(!$owns()){$db->commit();return 'superseded';}
        $row=$order?genesisBillingSettlement($db,$order['id']):null;
        $state=in_array($result,['completed','refunded'],true)?'succeeded':($result==='cancelled'?'cancelled':($result==='failed'?'failed':'pending'));
        if($state==='pending'&&(int)$job['attempts']>=5){genesisBillingSettlementRetry($db,$order['id'],$now,'BACKGROUND_LEASE_EXPIRED',true);$state='failed';}
        $db->prepare('UPDATE background_jobs SET state=?,available_at=?,lease_until=NULL,lease_token=NULL,error_code=?,updated_at=? WHERE id=?')
            ->execute([$state,$row['next_attempt_at']??gmdate('Y-m-d\TH:i:s\Z',$now),$row['error_code']??null,gmdate('Y-m-d\TH:i:s\Z',$now),$job['id']]);
        $db->commit();return $state;
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}
