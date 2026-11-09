<?php
declare(strict_types=1);
require_once __DIR__.'/billing-gateways.php';
require_once __DIR__.'/billing-routing.php';
require_once __DIR__.'/billing-yookassa.php';

function genesisModelingDefinition(): array
{
    return json_decode((string)file_get_contents(dirname(__DIR__).'/resources/modeling-service.json'),true,16,JSON_THROW_ON_ERROR);
}

function genesisModelingCatalog(string $client,?array $settings=null,?array $billingDefinition=null,?string $userId=null): array
{
    $settings??=genesisBillingSettings();$definition=genesisModelingDefinition();
    $billing=genesisBillingCatalog($settings,$client,$billingDefinition);$methods=[];
    foreach($billing['providers'] as $provider){
        if(!in_array($provider['id'],['yookassa','lemon-squeezy'],true))continue;
        $id=$provider['id'];$product=$id==='yookassa'?$definition['yookassaProduct']:($settings['services']['future-modeling']['products'][$id]??null);
        $currency=$id==='yookassa'?'RUB':'USD';
        $configured=is_string($product)&&($id==='yookassa'||preg_match('/\A[1-9][0-9]{0,14}\z/D',$product)===1);
        $methods[]=['provider'=>$id,'amountMinor'=>$definition['prices'][$currency],'currency'=>$currency,
            'available'=>$configured&&$provider['available']];
    }
    return ['service'=>$definition['id'],'prices'=>$definition['prices'],'methods'=>$methods,'routing'=>genesisBillingRouting($_SERVER),
        'forecastElitePlus'=>$userId!==null&&genesisForecastElitePlus(genesisFindUser($userId)??[]),
        'testingAccess'=>$userId!==null&&genesisForecastTestingOwner(genesisFindUser($userId)??[])];
}

/** Immutable result store. Aurora submits an opaque completed solution through
 * its strict manifest adapter; no public route can submit payment entitlement. */
function genesisModelingPrepareResult(string $userId,string $id,string $methodVersion,array $solution): void
{
    if(preg_match('/\A[a-f0-9-]{36}\z/D',$id)!==1||$methodVersion===''||strlen($methodVersion)>100||$solution===[])
        throw new InvalidArgumentException('MODELING_RESULT_INVALID');
    $json=json_encode($solution,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);
    if(strlen($json)>200000)throw new InvalidArgumentException('MODELING_RESULT_INVALID');
    $hash=hash('sha256',$methodVersion.':'.$json);$db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        $q=$db->prepare('SELECT user_id,result_hash FROM future_modeling_results WHERE id=?');$q->execute([$id]);$old=$q->fetch();
        if($old&&($old['user_id']!==$userId||!hash_equals($old['result_hash'],$hash)))
            throw new GenesisResourceLimitException(409,'MODELING_RESULT_IMMUTABLE');
        if(!$old)$db->prepare('INSERT INTO future_modeling_results VALUES(?,?,?,?,?,?)')
            ->execute([$id,$userId,$methodVersion,genesisSharedContentEncrypt($json),$hash,genesisNow()]);
        $db->commit();
    }catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
}

function genesisModelingOrder(string $id,?string $userId=null): array
{
    $q=genesisDb()->prepare('SELECT * FROM future_modeling_orders WHERE id=?');$q->execute([$id]);$order=$q->fetch();
    if(!$order||($userId!==null&&$order['user_id']!==$userId))throw new GenesisResourceLimitException(404,'BILLING_ORDER_NOT_FOUND');
    return $order;
}

function genesisModelingPublicOrder(array $order): array
{
    return ['id'=>$order['id'],'resultId'=>$order['result_id'],'service'=>'future-modeling-result','provider'=>$order['provider'],
        'amountMinor'=>(int)$order['amount_minor'],'currency'=>$order['currency'],'status'=>$order['status'],
        'checkoutUrl'=>$order['status']==='pending'?$order['checkout_url']:null];
}

/** The same non-reversible payment claim registry also prevents reuse across subscriptions and services. */
function genesisModelingApplyReceipt(GenesisVerifiedBillingReceipt $receipt,?int $now=null): void
{
    $now??=time();$db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        $order=genesisModelingOrder($receipt->orderId);
        if($order['provider']!==$receipt->provider||(int)$order['amount_minor']!==$receipt->amountMinor
            ||$order['currency']!==$receipt->currency||$order['product_id']!==$receipt->productId
            ||!in_array($receipt->state,['paid','cancelled','refunded'],true)||$receipt->reference===''
            ||strlen($receipt->reference)>4096||preg_match('/\A[a-f0-9]{64}\z/D',$receipt->evidenceHash)!==1
            ||genesisSubscriptionExpiry($receipt->confirmedAt)===false||genesisSubscriptionExpiry($receipt->confirmedAt)>$now+300
            ||$receipt->refundedAmountMinor<0||$receipt->refundedAmountMinor>$receipt->amountMinor)
            throw new DomainException('BILLING_RECEIPT_MISMATCH');
        $user=genesisFindUser($order['user_id']);if(!$user)throw new DomainException('BILLING_ACCOUNT_NOT_FOUND');
        $owner=genesisSubscriptionIdentityHashes($user)[0];$reference=hash('sha256',$receipt->reference);
        $q=$db->prepare('SELECT * FROM billing_payment_claims WHERE provider=? AND reference_hash=?');$q->execute([$receipt->provider,$reference]);$claim=$q->fetch();
        if($claim&&($claim['order_id']!==$order['id']||!hash_equals($claim['owner_hash'],$owner)))throw new DomainException('BILLING_RECEIPT_ACCOUNT_CONFLICT');
        $db->prepare('INSERT OR IGNORE INTO billing_payment_claims VALUES(?,?,?,?)')->execute([$receipt->provider,$reference,$order['id'],$owner]);
        if($order['provider_secret']!==null&&$order['provider_secret']!==$receipt->reference)throw new DomainException('BILLING_RECEIPT_MISMATCH');
        $state=in_array($order['status'],['refunded','cancelled'],true)?$order['status']:$receipt->state;
        // A partial service refund also closes access; a single result has no fractional entitlement.
        if($receipt->refundedAmountMinor>0)$state='refunded';
        $confirmed=gmdate('Y-m-d\TH:i:s\Z',genesisSubscriptionExpiry($receipt->confirmedAt));
        if($order['confirmed_at']!==null&&$order['confirmed_at']!==$confirmed)throw new DomainException('BILLING_RECEIPT_CONFLICT');
        $db->prepare('UPDATE future_modeling_orders SET status=?,provider_secret=?,confirmed_at=?,evidence_hash=?,updated_at=? WHERE id=?')
            ->execute([$state,$receipt->reference,$confirmed,$receipt->evidenceHash,gmdate('Y-m-d\TH:i:s\Z',$now),$order['id']]);
        // No subscription plan, credit, period or lifetime seat is changed by this service.
        $db->commit();
    }catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
}

function genesisModelingAcceptYoo(array $payment,array $order,array $config): void
{
    $receipt=genesisBillingYooReceipt($payment,$order,$config);
    genesisModelingApplyReceipt($receipt);
}

function genesisModelingResult(string $userId,string $id): array
{
    $db=genesisDb();$q=$db->prepare('SELECT * FROM future_modeling_results WHERE id=? AND user_id=?');$q->execute([$id,$userId]);$result=$q->fetch();
    if(!$result)throw new GenesisResourceLimitException(404,'MODELING_RESULT_NOT_READY');
    $q=$db->prepare("SELECT id FROM future_modeling_orders WHERE result_id=? AND user_id=? AND status='paid'");$q->execute([$id,$userId]);
    if(!$q->fetchColumn()&&!genesisForecastFreeAccess(genesisFindUser($userId)??[]))throw new GenesisResourceLimitException(402,'MODELING_PAYMENT_REQUIRED');
    return ['id'=>$id,'methodVersion'=>$result['method_version'],'solution'=>json_decode(genesisSharedContentDecrypt($result['encrypted_result']),true,32,JSON_THROW_ON_ERROR)];
}

/** Fixed-price checkout, independently of all subscription plans. Never accept an amount from the client. */
function genesisModelingCreateOrder(string $userId,array $input,?array $settings=null,?callable $http=null,?array $billingDefinition=null): array
{
    $settings??=genesisBillingSettings();$http??='genesisBillingHttp';$user=genesisFindUser($userId);
    if(!$user||!genesisSessionIsPrimaryGoogleUser($user))throw new GenesisResourceLimitException(403,'BILLING_PRIMARY_GOOGLE_REQUIRED');
    if(array_diff(array_keys($input),['resultId','provider','client','idempotencyKey'])
        ||!is_string($input['resultId']??null)||preg_match('/\A[a-f0-9-]{36}\z/D',$input['resultId'])!==1
        ||!is_string($input['idempotencyKey']??null)||preg_match('/\A[a-zA-Z0-9_-]{16,100}\z/D',$input['idempotencyKey'])!==1)
        throw new InvalidArgumentException('BILLING_ORDER_INVALID');
    $db=genesisDb();$q=$db->prepare('SELECT id FROM future_modeling_results WHERE id=? AND user_id=?');$q->execute([$input['resultId'],$userId]);
    if(!$q->fetchColumn())throw new GenesisResourceLimitException(404,'MODELING_RESULT_NOT_READY');
    if(genesisForecastFreeAccess($user))throw new GenesisResourceLimitException(409,'MODELING_PAYMENT_NOT_REQUIRED');
    // Existing tariff access is still required for the method; payment never upgrades it.
    genesisRequireFeature($userId,'future-modeling');
    $provider=$input['provider']??'';$catalog=genesisModelingCatalog((string)($input['client']??'web'),$settings,$billingDefinition);$offer=null;
    foreach($catalog['methods']as$method)if($method['provider']===$provider&&$method['available'])$offer=$method;
    if($offer===null)throw new GenesisResourceLimitException(503,'BILLING_NOT_CONFIGURED');
    $definition=genesisModelingDefinition();$product=$provider==='yookassa'?$definition['yookassaProduct']:$settings['services']['future-modeling']['products'][$provider];
    $config=$settings['providers'][$provider];$returnUrl=rtrim(genesisConfig()['app_url'],'/').'/?modelingOrder=';
    genesisBeginWriteTransaction($db);
    try{
        $q=$db->prepare('SELECT * FROM future_modeling_orders WHERE user_id=? AND idempotency_key=?');$q->execute([$userId,$input['idempotencyKey']]);$order=$q->fetch();
        if($order&&($order['result_id']!==$input['resultId']||$order['provider']!==$provider))throw new GenesisResourceLimitException(409,'BILLING_IDEMPOTENCY_CONFLICT');
        if(!$order){
            $q=$db->prepare("SELECT * FROM future_modeling_orders WHERE result_id=? AND status IN ('pending','paid')");$q->execute([$input['resultId']]);$order=$q->fetch();
            if($order&&$order['provider']!==$provider)throw new GenesisResourceLimitException(409,'MODELING_PAYMENT_PENDING');
        }
        if(!$order){
            $id=genesisUuid();$stamp=genesisNow();
            $order=['id'=>$id,'user_id'=>$userId,'result_id'=>$input['resultId'],'provider'=>$provider,'plan'=>'Future modeling result',
                'amount_minor'=>$offer['amountMinor'],'currency'=>$offer['currency'],'product_id'=>$product,'receipt_email'=>$user['email']];
            $body=$provider==='yookassa'?genesisBillingYooCheckoutBody($order,$config,$returnUrl.rawurlencode($id).'#stoicheion'):null;
            $db->prepare('INSERT INTO future_modeling_orders(id,user_id,result_id,provider,amount_minor,currency,product_id,idempotency_key,encrypted_request,started_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
                ->execute([$id,$userId,$input['resultId'],$provider,$offer['amountMinor'],$offer['currency'],$product,$input['idempotencyKey'],
                    $body===null?null:genesisSharedContentEncrypt(json_encode($body,JSON_THROW_ON_ERROR)),$stamp,$stamp]);
            $order=genesisModelingOrder($id);
        }
        $db->commit();
    }catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
    return genesisModelingPublicOrder(genesisModelingReconcile($order,$settings,$http,true));
}

/** Lease external I/O; replay a frozen YooKassa request only inside its deduplication window. */
function genesisModelingReconcile(array $order,?array $settings=null,?callable $http=null,bool $create=false): array
{
    if($order['status']!=='pending')return $order;
    if(!$create&&$order['provider_secret']===null&&time()-(int)strtotime($order['started_at'])<23*3600)return $order;
    $settings??=genesisBillingSettings();$http??='genesisBillingHttp';$config=$settings['providers'][$order['provider']]??[];
    if(!genesisBillingProviderReady($order['provider'],$settings))throw new GenesisResourceLimitException(503,'BILLING_NOT_CONFIGURED');
    $db=genesisDb();$token=genesisUuid();$now=time();$stamp=genesisNow();
    $q=$db->prepare('UPDATE future_modeling_orders SET lease_token=?,lease_until=? WHERE id=? AND (lease_until IS NULL OR lease_until<=?)');
    $q->execute([$token,gmdate('Y-m-d\TH:i:s\Z',$now+90),$order['id'],$stamp]);if(!$q->rowCount())return genesisModelingOrder($order['id']);
    try{
        if($order['provider']==='yookassa'){
            $basic=$config['shop_id'].':'.$config['secret_key'];
            if($order['provider_secret']!==null)$payment=$http('GET','https://api.yookassa.ru/v3/payments/'.rawurlencode($order['provider_secret']),null,[],$basic);
            elseif($create&&$now-(int)strtotime($order['started_at'])<23*3600){
                $body=json_decode(genesisSharedContentDecrypt($order['encrypted_request']),true,32,JSON_THROW_ON_ERROR);
                $payment=$http('POST','https://api.yookassa.ru/v3/payments',$body,['Idempotence-Key: '.$order['id']],$basic);
            }else{
                // An unknown creation must be discovered, never charged again after provider deduplication expires.
                $query=['created_at.gte'=>gmdate('Y-m-d\TH:i:s\Z',(int)strtotime($order['started_at'])-300),
                    'created_at.lte'=>gmdate('Y-m-d\TH:i:s\Z',(int)strtotime($order['started_at'])+23*3600),'limit'=>100];
                if(is_string($order['scan_cursor'])&&$order['scan_cursor']!=='')$query['cursor']=$order['scan_cursor'];
                $list=$http('GET','https://api.yookassa.ru/v3/payments?'.http_build_query($query,'','&',PHP_QUERY_RFC3986),null,[],$basic);
                if(!is_array($list['items']??null)||count($list['items'])>100)throw new DomainException('BILLING_PROVIDER_RESPONSE_INVALID');
                $matches=array_values(array_filter($list['items'],static fn($item)=>($item['metadata']['genesis_order_id']??null)===$order['id']));
                if(count($matches)>1)throw new DomainException('BILLING_RECEIPT_MISMATCH');
                $cursor=$list['next_cursor']??null;
                if($cursor!==null&&(!is_string($cursor)||strlen($cursor)>2048||$cursor===$order['scan_cursor']))throw new DomainException('BILLING_PROVIDER_RESPONSE_INVALID');
                $db->prepare('UPDATE future_modeling_orders SET scan_cursor=? WHERE id=?')->execute([$cursor,$order['id']]);
                $payment=$matches[0]??null;
                if($payment===null)throw new GenesisResourceLimitException(409,'MODELING_PAYMENT_RECONCILIATION_REQUIRED');
            }
            if(($payment['test']??null)!==false||($payment['metadata']['genesis_order_id']??null)!==$order['id']
                ||($payment['recipient']['account_id']??null)!==(string)$config['shop_id']
                ||($payment['amount']['currency']??null)!==$order['currency']
                ||($payment['amount']['value']??null)!==sprintf('%d.%02d',intdiv((int)$order['amount_minor'],100),(int)$order['amount_minor']%100)
                ||!is_string($payment['id']??null)||preg_match('/\A[a-zA-Z0-9-]{1,100}\z/D',$payment['id'])!==1
                ||($order['provider_secret']!==null&&$order['provider_secret']!==$payment['id']))throw new DomainException('BILLING_RECEIPT_MISMATCH');
            $url=$payment['confirmation']['confirmation_url']??null;
            if($url!==null&&(!is_string($url)||!genesisBillingYooCheckoutUrl($url)))throw new DomainException('BILLING_PROVIDER_RESPONSE_INVALID');
            $db->prepare('UPDATE future_modeling_orders SET provider_secret=?,checkout_url=COALESCE(checkout_url,?),updated_at=? WHERE id=? AND (provider_secret IS NULL OR provider_secret=?)')
                ->execute([$payment['id'],$url,genesisNow(),$order['id'],$payment['id']]);
            if(in_array($payment['status']??null,['succeeded','canceled'],true))genesisModelingAcceptYoo($payment,genesisModelingOrder($order['id']),$config);
        }elseif($create&&$order['checkout_url']===null){
            $result=genesisBillingGatewayCheckout($order,$config,rtrim(genesisConfig()['app_url'],'/').'/?modelingOrder='.rawurlencode($order['id']).'#stoicheion',$http);
            $db->prepare('UPDATE future_modeling_orders SET checkout_url=?,updated_at=? WHERE id=? AND checkout_url IS NULL')
                ->execute([$result['checkoutUrl'],genesisNow(),$order['id']]);
            // Lemon checkout IDs and paid order IDs differ. The verified signed callback binds the latter.
        }
    }finally{$db->prepare('UPDATE future_modeling_orders SET lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?')->execute([$order['id'],$token]);}
    return genesisModelingOrder($order['id']);
}

function genesisModelingRoute(string $method,array $segments,string $userId): never
{
    if($method==='GET'&&count($segments)===3&&$segments[2]==='catalog')genesisJson(genesisModelingCatalog((string)($_GET['client']??'web'),null,null,$userId));
    if($method==='GET'&&count($segments)===4&&$segments[2]==='results')genesisJson(genesisModelingResult($userId,$segments[3]));
    if($method==='GET'&&count($segments)===4&&$segments[2]==='orders')genesisJson(genesisModelingPublicOrder(genesisModelingReconcile(genesisModelingOrder($segments[3],$userId))));
    genesisRequireCsrf();
    if($method==='POST'&&count($segments)===3&&$segments[2]==='orders')genesisJson(genesisModelingCreateOrder($userId,genesisReadJson()),201);
    if($method==='POST'&&count($segments)===5&&$segments[2]==='orders'&&$segments[4]==='verify')
        genesisJson(genesisModelingPublicOrder(genesisModelingReconcile(genesisModelingOrder($segments[3],$userId))));
    genesisJson(['error'=>'NOT_FOUND'],404);
}
