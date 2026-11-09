<?php
declare(strict_types=1);
require_once __DIR__.'/billing-gateways.php';

// Below YooKassa's documented 24-hour deduplication window, including network/clock margin.
const GENESIS_YOO_REPLAY_SECONDS = 23 * 3600;

function genesisBillingYooRecovery(PDO $db,string $id): ?array
{
    $q=$db->prepare('SELECT * FROM billing_yookassa_recovery WHERE order_id=?');$q->execute([$id]);return $q->fetch()?:null;
}

/** One immutable body per order, including receipt and return URL. Never hold a writer over I/O. */
function genesisBillingYooPrepare(PDO $db,array $order,array $configuration,string $returnUrl,int $now): array
{
    $row=genesisBillingYooRecovery($db,$order['id']);
    if(!$row){
        $body=genesisBillingYooCheckoutBody($order,$configuration,$returnUrl);
        $stamp=gmdate('Y-m-d\TH:i:s\Z',$now);
        $db->prepare('INSERT OR IGNORE INTO billing_yookassa_recovery(order_id,encrypted_request,started_at,next_check_at) VALUES(?,?,?,?)')
            ->execute([$order['id'],genesisSharedContentEncrypt(json_encode($body,JSON_THROW_ON_ERROR)),$stamp,$stamp]);
        $row=genesisBillingYooRecovery($db,$order['id']);
    }
    return $row;
}

/** Even pending objects must match the shop, frozen order amount, currency and server metadata. */
function genesisBillingYooBind(PDO $db,array $payment,array $order,array $configuration,int $now): array
{
    if(($payment['test']??null)!==false||($configuration['test_mode']??false)!==false
        ||!is_string($payment['id']??null)||preg_match('/\A[a-zA-Z0-9-]{1,100}\z/D',$payment['id'])!==1
        ||($payment['recipient']['account_id']??null)!==(string)$configuration['shop_id']
        ||($payment['metadata']['genesis_order_id']??null)!==$order['id']
        ||($payment['amount']['currency']??null)!==$order['currency']
        ||($payment['amount']['value']??null)!==sprintf('%d.%02d',intdiv((int)$order['amount_minor'],100),(int)$order['amount_minor']%100)
        ||!in_array($payment['status']??null,['pending','waiting_for_capture','succeeded','canceled'],true))
        throw new DomainException('BILLING_RECEIPT_MISMATCH');
    genesisBillingProviderTimestamp($payment['created_at']??'');
    $url=$payment['confirmation']['confirmation_url']??null;
    if($url!==null&&(!is_string($url)||!genesisBillingYooCheckoutUrl($url)))throw new DomainException('BILLING_PROVIDER_RESPONSE_INVALID');
    // A first webhook can arrive before create-checkout returns. Only authenticated API data binds it.
    $q=$db->prepare('UPDATE billing_orders SET provider_secret=?,checkout_url=COALESCE(checkout_url,?),updated_at=?
        WHERE id=? AND provider=\'yookassa\' AND (provider_secret IS NULL OR provider_secret=?)');
    $q->execute([$payment['id'],$url,gmdate('Y-m-d\TH:i:s\Z',$now),$order['id'],$payment['id']]);
    $q=$db->prepare('SELECT * FROM billing_orders WHERE id=?');$q->execute([$order['id']]);$current=$q->fetch();
    if(!$current||$current['provider_secret']!==$payment['id'])throw new DomainException('BILLING_RECEIPT_MISMATCH');
    return $current;
}

function genesisBillingYooCheckoutUrl(string $url): bool
{
    $parts=parse_url($url);$host=strtolower($parts['host']??'');
    return ($parts['scheme']??'')==='https'&&!isset($parts['user'])&&!isset($parts['pass'])&&!isset($parts['port'])
        &&in_array($host,['yoomoney.ru','yookassa.ru'],true);
}

/** Unknown creation after 23h uses authenticated discovery, never another POST or local cancellation. */
function genesisBillingYooDiscover(PDO $db,array $order,array $row,array $configuration,callable $http): ?array
{
    $start=genesisSubscriptionExpiry($row['started_at']);
    $query=['created_at.gte'=>gmdate('Y-m-d\TH:i:s\Z',$start-300),
        'created_at.lte'=>gmdate('Y-m-d\TH:i:s\Z',$start+GENESIS_YOO_REPLAY_SECONDS+300),'limit'=>100];
    if(is_string($row['scan_cursor'])&&$row['scan_cursor']!=='')$query['cursor']=$row['scan_cursor'];
    $result=$http('GET','https://api.yookassa.ru/v3/payments?'.http_build_query($query,'','&',PHP_QUERY_RFC3986),null,[],
        $configuration['shop_id'].':'.$configuration['secret_key']);
    if(!is_array($result['items']??null)||count($result['items'])>100)throw new DomainException('BILLING_PROVIDER_RESPONSE_INVALID');
    $found=null;
    foreach($result['items']as$item)if(($item['metadata']['genesis_order_id']??null)===$order['id']){
        if($found!==null)throw new DomainException('BILLING_RECEIPT_MISMATCH');$found=$item;
    }
    $cursor=$result['next_cursor']??null;
    if($cursor!==null&&(!is_string($cursor)||strlen($cursor)>2048||$cursor===$row['scan_cursor']))throw new DomainException('BILLING_PROVIDER_RESPONSE_INVALID');
    $db->prepare('UPDATE billing_yookassa_recovery SET scan_cursor=? WHERE order_id=?')->execute([$cursor,$order['id']]);
    return $found;
}

/** Reconcile only; pending/full-price checkouts are never captured or cancelled by a local timer. */
function genesisBillingYooReconcile(PDO $db,array $order,array $configuration,?callable $http=null,?int $now=null,bool $allowReplay=false): array
{
    $http??='genesisBillingHttp';$now??=time();
    if($db->inTransaction())throw new LogicException('BILLING_NETWORK_IN_TRANSACTION');
    $row=genesisBillingYooRecovery($db,$order['id']);
    if(!$row)return $order;
    $token=genesisUuid();$stamp=gmdate('Y-m-d\TH:i:s\Z',$now);
    $claim=$db->prepare('UPDATE billing_yookassa_recovery SET lease_token=?,lease_until=? WHERE order_id=? AND (lease_until IS NULL OR lease_until<=?)');
    $claim->execute([$token,gmdate('Y-m-d\TH:i:s\Z',$now+90),$order['id'],$stamp]);
    if(!$claim->rowCount())return $order;
    $code=null;
    try{
        if(!genesisBillingProviderReady('yookassa',['providers'=>['yookassa'=>$configuration]]))throw new DomainException('BILLING_NOT_CONFIGURED');
        $basic=$configuration['shop_id'].':'.$configuration['secret_key'];
        if(is_string($order['provider_secret'])&&$order['provider_secret']!==''){
            $payment=$http('GET','https://api.yookassa.ru/v3/payments/'.rawurlencode($order['provider_secret']),null,[],$basic);
        }elseif($allowReplay&&$now-genesisSubscriptionExpiry($row['started_at'])<GENESIS_YOO_REPLAY_SECONDS){
            $body=json_decode(genesisSharedContentDecrypt($row['encrypted_request']),true,32,JSON_THROW_ON_ERROR);
            $payment=$http('POST','https://api.yookassa.ru/v3/payments',$body,['Idempotence-Key: '.$order['id']],$basic);
        }else{
            $payment=genesisBillingYooDiscover($db,$order,$row,$configuration,$http);
            if($payment===null)throw new DomainException('BILLING_CHECKOUT_RECONCILIATION_REQUIRED');
        }
        $order=genesisBillingYooBind($db,$payment,$order,$configuration,$now);
        if((int)($order['upgrade_credit_minor']??0)>0){
            genesisBillingSettlementReconcile($db,$order,$configuration,$http,$now);
        }elseif(in_array($payment['status'],['succeeded','canceled'],true)){
            genesisBillingApplyReceipt($db,genesisBillingYooReceipt($payment,$order,$configuration),$now);
        }
        $q=$db->prepare('SELECT * FROM billing_orders WHERE id=?');$q->execute([$order['id']]);$order=$q->fetch();
    }catch(Throwable $error){
        $code=in_array($error->getMessage(),['BILLING_RECEIPT_MISMATCH','BILLING_CHECKOUT_RECONCILIATION_REQUIRED','BILLING_NOT_CONFIGURED'],true)
            ?$error->getMessage():'BILLING_PROVIDER_UNAVAILABLE';
    }finally{
        $db->prepare('UPDATE billing_yookassa_recovery SET checked_at=?,next_check_at=?,error_code=?,lease_token=NULL,lease_until=NULL WHERE order_id=? AND lease_token=?')
            ->execute([$stamp,gmdate('Y-m-d\TH:i:s\Z',$now+($code?900:300)),$code,$order['id'],$token]);
    }
    return $order;
}

/** Bounded maintenance from the existing cron, separate from its leased application jobs. */
function genesisBillingYooScan(?callable $http=null,?int $now=null): void
{
    $now??=time();$configuration=genesisBillingSettings()['providers']['yookassa']??[];
    if(!genesisBillingProviderReady('yookassa',['providers'=>['yookassa'=>$configuration]]))return;
    $db=genesisDb();$q=$db->prepare("SELECT o.* FROM billing_orders o JOIN billing_yookassa_recovery r ON r.order_id=o.id
        WHERE o.provider='yookassa' AND o.status='pending' AND r.next_check_at<=? ORDER BY r.next_check_at,o.id LIMIT 2");
    $q->execute([gmdate('Y-m-d\TH:i:s\Z',$now)]);$orders=$q->fetchAll();$q->closeCursor();
    foreach($orders as$order)genesisBillingYooReconcile($db,$order,$configuration,$http,$now);
}
