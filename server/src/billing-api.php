<?php
declare(strict_types=1);
require_once __DIR__.'/billing-gateways.php';
require_once __DIR__.'/billing-routing.php';
require_once __DIR__.'/subscription-trials.php';
require_once __DIR__.'/billing-yookassa.php';
require_once __DIR__.'/modeling-service.php';

function genesisBillingOrder(PDO $db, string $id): array
{
    $q=$db->prepare('SELECT * FROM billing_orders WHERE id=?');$q->execute([$id]);$order=$q->fetch();
    if (!$order) throw new GenesisResourceLimitException(404,'BILLING_ORDER_NOT_FOUND');
    return $order;
}

function genesisBillingPublicOrder(array $order,?PDO $db=null): array
{
    $db??=genesisDb();$settlement=genesisBillingSettlement($db,$order['id']);$blocked=genesisBillingSettlementBlocked($settlement);
    return ['id'=>$order['id'],'plan'=>$order['plan'],'periodMonths'=>(int)$order['period_months'],'provider'=>$order['provider'],
        'status'=>$blocked?($settlement['state']==='capture-pending'?'payment-verifying':'settlement-required')
            :($order['provider']==='yookassa'&&$order['status']==='pending'&&$order['checkout_url']===null?'payment-verifying':$order['status']),
        'settlement'=>genesisBillingPublicSettlement($settlement,$order),'checkoutUrl'=>$blocked?null:$order['checkout_url'],'productId'=>$order['product_id'],
        'amountMinor'=>(int)$order['amount_minor'],'currency'=>$order['currency'],
        'listAmountMinor'=>(int)($order['list_amount_minor'] ?? $order['amount_minor']),
        'creditMinor'=>(int)($order['upgrade_credit_minor'] ?? 0)];
}

/** Optional dependencies are for isolated tests only; the HTTP route passes neither. */
function genesisBillingCreateOrder(string $userId, array $input,?array $catalogDefinition=null,?callable $gatewayCheckout=null): array
{
    $user=genesisFindUser($userId);
    if (!$user || !genesisSessionIsPrimaryGoogleUser($user)) throw new GenesisResourceLimitException(403,'BILLING_PRIMARY_GOOGLE_REQUIRED');
    if (array_diff(array_keys($input),['offerId','provider','client','idempotencyKey','receiptEmail','expectedAmountMinor','expectedCurrency'])
        || !is_string($input['idempotencyKey']??null) || !preg_match('/\A[a-zA-Z0-9_-]{16,100}\z/D',$input['idempotencyKey'])) throw new InvalidArgumentException('BILLING_ORDER_INVALID');
    $settings=genesisBillingSettings();$catalog=genesisBillingCatalog($settings,(string)($input['client']??'web'),$catalogDefinition);
    $offer=null;foreach($catalog['offers'] as $candidate) if ($candidate['id']===($input['offerId']??null)) $offer=$candidate;
    $provider=$input['provider']??'';
    if (!$offer || !in_array($provider,$offer['availableProviders'],true)) throw new GenesisResourceLimitException(503,'BILLING_NOT_CONFIGURED');
    $offer=genesisBillingProviderOffer($offer,$provider);
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try {
        $q=$db->prepare('SELECT * FROM billing_orders WHERE user_id=? AND idempotency_key=?');$q->execute([$userId,$input['idempotencyKey']]);$order=$q->fetch();
        if ($order && ($order['provider']!==$provider || $order['plan']!==$offer['plan'] || (int)$order['period_months']!==$offer['periodMonths']))
            throw new GenesisResourceLimitException(409,'BILLING_IDEMPOTENCY_CONFLICT');
        if($order&&(!is_int($input['expectedAmountMinor']??null)||$input['expectedAmountMinor']!==(int)$order['amount_minor']
            ||($input['expectedCurrency']??null)!==$order['currency']||$order['currency']!==$offer['currency']))
            throw new GenesisResourceLimitException(409,'BILLING_QUOTE_CHANGED');
        if($order&&$order['plan']==='premium4life'&&(int)$order['upgrade_credit_minor']>0)
            throw new GenesisResourceLimitException(409,'BILLING_UPGRADE_UNAVAILABLE');
        if($order&&(int)$order['upgrade_credit_minor']>0&&!$catalog['creditCheckoutEnabled'])
            throw new GenesisResourceLimitException(409,'BILLING_CREDIT_CHECKOUT_DISABLED');
        if (!$order) {
            if (($user['subscription_plan']??'free')==='premium4life') throw new GenesisResourceLimitException(409,'BILLING_ALREADY_LIFETIME');
            $id=genesisUuid();$now=gmdate('Y-m-d\TH:i:s\Z');
            $quote=genesisBillingUpgradeQuote($db,$userId,$offer,time());
            if($quote['upgradeUnavailableReason']==='settlement-required')throw new GenesisResourceLimitException(409,'BILLING_SETTLEMENT_REQUIRED');
            if($quote['upgradeUnavailableReason']==='credit-checkout-unavailable')throw new GenesisResourceLimitException(409,'BILLING_CREDIT_CHECKOUT_DISABLED');
            if ($quote['upgradeUnavailableReason']!==null || !in_array($provider,$quote['availableProviders'],true))
                throw new GenesisResourceLimitException(409,'BILLING_UPGRADE_UNAVAILABLE');
            if (!is_int($input['expectedAmountMinor']??null) || $input['expectedAmountMinor']!==$quote['amountMinor']
                ||($input['expectedCurrency']??null)!==$quote['currency']||$quote['currency']!==$offer['currency'])
                throw new GenesisResourceLimitException(409,'BILLING_QUOTE_CHANGED');
            if($quote['creditMinor']>0&&!$catalog['creditCheckoutEnabled'])throw new GenesisResourceLimitException(409,'BILLING_CREDIT_CHECKOUT_DISABLED');
            if (isset($quote['pendingOrderId'])) {
                $order=genesisBillingOrder($db,$quote['pendingOrderId']);
                if ($order['provider']!==$provider||$order['currency']!==$offer['currency']) throw new GenesisResourceLimitException(409,'BILLING_UPGRADE_PENDING');
            } else {
                $db->prepare('INSERT INTO billing_orders(id,user_id,idempotency_key,provider,plan,period_months,amount_minor,currency,product_id,created_at,updated_at,list_amount_minor,upgrade_credit_minor) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
                    ->execute([$id,$userId,$input['idempotencyKey'],$provider,$offer['plan'],$offer['periodMonths'],$quote['amountMinor'],$offer['currency'],
                        $settings['offers'][$offer['id']]['products'][$provider],$now,$now,$offer['amountMinor'],$quote['creditMinor']]);
                genesisBillingReserveUpgrade($db,$id,$quote);
                if($provider==='google-play')$db->prepare('UPDATE billing_orders SET play_profile_hash=? WHERE id=?')->execute([hash('sha256',$id),$id]);
                if ($offer['plan']==='premium4life') genesisBillingReserveLifetime($db,$user,$id);
                $order=genesisBillingOrder($db,$id);
            }
        }
        $db->commit();
    } catch(Throwable $e) { if($db->inTransaction())$db->rollBack();throw $e; }
    if ($order['checkout_url']!==null || $order['status']!=='pending') return genesisBillingPublicOrder($order);
    $order['owner_hash']=genesisSubscriptionIdentityHashes($user)[0];
    $order['receipt_email']=$input['receiptEmail']??$user['email'];
    if($provider==='yookassa'&&($settings['providers'][$provider]['receipt_required']??true)===true&&$order['encrypted_receipt']===null){
        $snapshot=genesisSharedContentEncrypt(json_encode(genesisBillingYooFiscalReceipt($order,$settings['providers'][$provider]),JSON_THROW_ON_ERROR));
        $db->prepare('UPDATE billing_orders SET encrypted_receipt=COALESCE(encrypted_receipt,?) WHERE id=?')->execute([$snapshot,$order['id']]);
        $order['encrypted_receipt']=genesisBillingOrder($db,$order['id'])['encrypted_receipt'];
    }
    // No grant is issued here, including for Play. A verified receipt is always required.
    $returnUrl=rtrim(genesisConfig()['app_url'],'/').'/?billingOrder='.rawurlencode($order['id']).'#settings/account';
    if($provider==='yookassa'&&$gatewayCheckout===null){
        genesisBillingYooPrepare($db,$order,$settings['providers'][$provider],$returnUrl,time());
        return genesisBillingPublicOrder(genesisBillingYooReconcile($db,$order,$settings['providers'][$provider],null,null,true));
    }
    $gatewayCheckout??='genesisBillingGatewayCheckout';
    $result=$gatewayCheckout($order,$settings['providers'][$provider],$returnUrl);
    if ($provider!=='google-play') $db->prepare('UPDATE billing_orders SET checkout_url=?,provider_secret=?,updated_at=? WHERE id=? AND checkout_url IS NULL')
        ->execute([$result['checkoutUrl'],$result['providerReference'],genesisNow(),$order['id']]);
    // A webhook may change settlement during checkout I/O. Its public projection must win.
    return [...$result,...genesisBillingPublicOrder(genesisBillingOrder($db,$order['id']))];
}

function genesisBillingVerifyOrder(string $userId, string $id, array $input = []): array
{
    $db=genesisDb();$order=genesisBillingOrder($db,$id);
    if ($order['user_id']!==$userId) throw new GenesisResourceLimitException(404,'BILLING_ORDER_NOT_FOUND');
    $user=genesisFindUser($userId);
    if (!$user || !genesisSessionIsPrimaryGoogleUser($user)) throw new GenesisResourceLimitException(403,'BILLING_PRIMARY_GOOGLE_REQUIRED');
    $settings=genesisBillingSettings();$provider=$order['provider'];$configuration=$settings['providers'][$provider]??[];
    if (!genesisBillingProviderReady($provider,$settings)) throw new GenesisResourceLimitException(503,'BILLING_NOT_CONFIGURED');
    if ($provider==='yookassa') {
        if(genesisBillingYooRecovery($db,$id)!==null&&(int)$order['upgrade_credit_minor']===0){
            genesisBillingYooReconcile($db,$order,$configuration);
            return [...genesisBillingRefreshEntitlement($db,$userId,time()),'order'=>genesisBillingPublicOrder(genesisBillingOrder($db,$id))];
        }
        if (!is_string($order['provider_secret']) || $order['provider_secret']==='') throw new DomainException('BILLING_CHECKOUT_NOT_CREATED');
        if((int)$order['upgrade_credit_minor']>0){
            genesisBillingSettlementReconcile($db,$order,$configuration);
            return [...genesisBillingRefreshEntitlement($db,$userId,time()),'order'=>genesisBillingPublicOrder(genesisBillingOrder($db,$id))];
        }
        $verified=genesisBillingHttp('GET','https://api.yookassa.ru/v3/payments/'.rawurlencode($order['provider_secret']),null,[],
            $configuration['shop_id'].':'.$configuration['secret_key']);
        $verified=genesisBillingYooSettleUpgrade($db,$verified,$order,$configuration);
        $receipt=genesisBillingYooReceipt($verified,$order,$configuration);
    } elseif ($provider==='google-play') {
        $token=$input['purchaseToken']??null;
        if (!is_string($token) || strlen($token)<10 || strlen($token)>4096) throw new InvalidArgumentException('BILLING_PURCHASE_TOKEN_REQUIRED');
        $order['owner_hash']=genesisSubscriptionIdentityHashes($user)[0];
        $base='https://androidpublisher.googleapis.com/androidpublisher/v3/applications/ru.genesis.calendar/purchases/products/'.rawurlencode($order['product_id']).'/tokens/'.rawurlencode($token);
        $headers=['Authorization: Bearer '.genesisBillingGoogleAccessToken($configuration)];
        $verified=genesisBillingHttp('GET',$base,null,$headers);
        $receipt=genesisBillingPlayReceipt($verified,$order,$token);
        $result=genesisBillingApplyReceipt($db,$receipt,time());
        // Delivery is durable before acknowledging/consuming; either call is safe to retry.
        if($receipt->state==='paid') {
            if($order['plan']!=='premium4life' && ($verified['consumptionState']??0)===0) genesisBillingHttp('POST',$base.':consume',[], $headers);
            elseif($order['plan']==='premium4life' && ($verified['acknowledgementState']??0)===0) genesisBillingHttp('POST',$base.':acknowledge',[], $headers);
        }
        return $result;
    } else throw new DomainException('BILLING_WEBHOOK_REQUIRED');
    return genesisBillingApplyReceipt($db,$receipt,time());
}

function genesisBillingWebhook(string $provider, string $raw, string $signature,?callable $http=null): void
{
    $http??='genesisBillingHttp';
    if ($provider==='lemon-squeezy-test') {
        require_once __DIR__.'/billing-lemon-test.php';
        genesisBillingLemonTestWebhook($raw,$signature);return;
    }
    $settings=genesisBillingSettings();$config=$settings['providers'][$provider]??[];
    if (!genesisBillingProviderReady($provider,$settings)) throw new GenesisResourceLimitException(503,'BILLING_NOT_CONFIGURED');
    if ($provider==='lemon-squeezy') {
        $event=genesisBillingLemonEvent($raw,$signature,$config);
        $id=$event['meta']['custom_data']['genesis_order_id']??'';
        if (!is_string($id)) throw new InvalidArgumentException('BILLING_ORDER_INVALID');
        $serviceQuery=genesisDb()->prepare('SELECT * FROM future_modeling_orders WHERE id=?');$serviceQuery->execute([$id]);$serviceOrder=$serviceQuery->fetch();
        if($serviceOrder){
            if($serviceOrder['provider']!==$provider)throw new DomainException('BILLING_RECEIPT_MISMATCH');
            $resource=(string)($event['data']['id']??'');
            if(!ctype_digit($resource))throw new InvalidArgumentException('BILLING_EVENT_INVALID');
            $verified=$http('GET','https://api.lemonsqueezy.com/v1/orders/'.$resource,null,['Authorization: Bearer '.$config['api_key']]);
            if((string)($verified['data']['id']??'')!==$resource)throw new DomainException('BILLING_RECEIPT_MISMATCH');
            genesisModelingApplyReceipt(genesisBillingLemonReceipt($verified,$serviceOrder,$config));return;
        }
        $order=genesisBillingOrder(genesisDb(),$id);
        if ($order['provider']!==$provider) throw new DomainException('BILLING_RECEIPT_MISMATCH');
        $resource=(string)($event['data']['id']??'');
        if (!ctype_digit($resource)) throw new InvalidArgumentException('BILLING_EVENT_INVALID');
        $verified=$http('GET','https://api.lemonsqueezy.com/v1/orders/'.$resource,null,['Authorization: Bearer '.$config['api_key']]);
        genesisBillingApplyReceipt(genesisDb(),genesisBillingLemonReceipt($verified,$order,$config),time());return;
    }
    if ($provider==='yookassa') {
        $event=json_decode($raw,true,32,JSON_THROW_ON_ERROR);
        if(!is_array($event)||($event['type']??null)!=='notification'
            ||!in_array($event['event']??null,['payment.succeeded','payment.waiting_for_capture','payment.canceled','refund.succeeded'],true))
            throw new InvalidArgumentException('BILLING_EVENT_INVALID');
        $id=($event['event']??'')==='refund.succeeded' ? ($event['object']['payment_id']??'') : ($event['object']['id']??'');
        if (!is_string($id) || !preg_match('/\A[a-zA-Z0-9-]{1,100}\z/D',$id)) throw new InvalidArgumentException('BILLING_EVENT_INVALID');
        $q=genesisDb()->prepare('SELECT * FROM billing_orders WHERE provider=? AND provider_secret=?');$q->execute([$provider,$id]);$order=$q->fetch();
        $verified=$http('GET','https://api.yookassa.ru/v3/payments/'.rawurlencode($id),null,[],$config['shop_id'].':'.$config['secret_key']);
        if(($verified['id']??null)!==$id)throw new DomainException('BILLING_RECEIPT_MISMATCH');
        $serviceQuery=genesisDb()->prepare("SELECT * FROM future_modeling_orders WHERE provider='yookassa' AND id=?");
        $serviceQuery->execute([$verified['metadata']['genesis_order_id']??'']);$serviceOrder=$serviceQuery->fetch();
        if($serviceOrder){
            if(in_array($verified['status']??null,['succeeded','canceled'],true))genesisModelingAcceptYoo($verified,$serviceOrder,$config);
            return;
        }
        if(!$order){
            // Metadata in the incoming body is untrusted. This metadata came from authenticated GET.
            $q=genesisDb()->prepare("SELECT * FROM billing_orders WHERE id=? AND provider='yookassa'");
            $q->execute([$verified['metadata']['genesis_order_id']??'']);$order=$q->fetch();
            if(!$order){
                genesisPartnerAcceptRetainedYooPayment(genesisDb(), $verified, $config, time());
                return; // Unrelated merchant payments remain untouched.
            }
        }
        $order=genesisBillingYooBind(genesisDb(),$verified,$order,$config,time());
        if((int)$order['upgrade_credit_minor']>0){
            genesisBillingSettlementReconcile(genesisDb(),$order,$config,$http);
            $recovery=genesisBillingSettlement(genesisDb(),$order['id']);
            if(in_array($recovery['error_code']??null,['BILLING_CAPTURE_UNKNOWN','BILLING_REFUND_UNKNOWN','BILLING_PROVIDER_UNAVAILABLE'],true))
                throw new GenesisResourceLimitException(503,'BILLING_PROVIDER_UNAVAILABLE');
            return;
        }
        $verified=genesisBillingYooSettleUpgrade(genesisDb(),$verified,$order,$config,$http);
        if(in_array($verified['status']??null,['pending','waiting_for_capture'],true))return;
        genesisBillingApplyReceipt(genesisDb(),genesisBillingYooReceipt($verified,$order,$config),time());return;
    }
    throw new InvalidArgumentException('BILLING_PROVIDER_INVALID');
}

function genesisBillingRoute(string $method, array $segments): never
{
    header('Cache-Control: no-store');
    if (count($segments)===3 && $segments[1]==='webhooks' && $method==='POST') {
        $raw=(string)file_get_contents('php://input',false,null,0,500001);
        if (strlen($raw)>500000) throw new InvalidArgumentException('BILLING_EVENT_INVALID');
        genesisBillingWebhook($segments[2],$raw,(string)($_SERVER['HTTP_X_SIGNATURE']??''));genesisJson(['ok'=>true]);
    }
    $userId=genesisRequireUserId();
    if(($segments[1]??'')==='modeling')genesisModelingRoute($method,$segments,$userId);
    if (($segments[1]??'')==='play-testing' && $method==='POST' && count($segments)===3) {
        genesisRequireCsrf();require_once __DIR__.'/play-testing.php';$input=genesisReadJson();
        if($segments[2]==='challenge')genesisJson(genesisPlayTestingChallenge($userId,$input));
        if($segments[2]==='claim')genesisJson(genesisPlayTestingClaim($userId,$input));
    }
    if ($method==='GET' && count($segments)===2 && $segments[1]==='catalog') {
        $catalog=genesisBillingCatalog(genesisBillingSettings(),(string)($_GET['client']??'web'));
        $trialUser=genesisFindUser($userId);
        if(!$trialUser)throw new GenesisResourceLimitException(401,'UNAUTHORIZED');
        genesisJson([...$catalog,'lifetimeSeats'=>genesisBillingLifetimeAvailability(genesisDb()),'policy'=>genesisFeatureAccessPolicy(),
            'routing'=>genesisBillingRouting($_SERVER),'trial'=>genesisTrialStateForUser($trialUser,time())]);
    }
    if ($method==='GET' && count($segments)===2 && $segments[1]==='quote') {
        $catalog=genesisBillingCatalog(genesisBillingSettings(),(string)($_GET['client']??'web'));
        foreach($catalog['offers'] as $offer) if ($offer['id']===($_GET['offerId']??null)){
            if(isset($_GET['provider'])){
                if(!is_string($_GET['provider']))throw new InvalidArgumentException('BILLING_PROVIDER_INVALID');
                $offer=genesisBillingProviderOffer($offer,$_GET['provider']);
            }
            genesisJson(genesisBillingPublicQuote(genesisBillingUpgradeQuote(genesisDb(),$userId,$offer,time())));
        }
        throw new GenesisResourceLimitException(404,'BILLING_OFFER_NOT_FOUND');
    }
    if ($method==='GET' && count($segments)===3 && $segments[1]==='orders') {
        $order=genesisBillingOrder(genesisDb(),$segments[2]);
        if ($order['user_id']!==$userId) throw new GenesisResourceLimitException(404,'BILLING_ORDER_NOT_FOUND');
        if($order['provider']==='yookassa'&&$order['status']==='pending'&&(int)$order['upgrade_credit_minor']===0){
            $recovery=genesisBillingYooRecovery(genesisDb(),$order['id']);
            if($recovery&&($recovery['checked_at']===null||time()-(int)strtotime($recovery['checked_at'])>=5))
                $order=genesisBillingYooReconcile(genesisDb(),$order,genesisBillingSettings()['providers']['yookassa']??[]);
        }
        genesisJson(genesisBillingPublicOrder($order));
    }
    genesisRequireCsrf();
    if ($method==='POST' && count($segments)===2 && $segments[1]==='restore') {
        $input=genesisReadJson();$hash=$input['profileHash']??null;
        if(!is_string($hash)||preg_match('/\A[a-f0-9]{64}\z/D',$hash)!==1)throw new InvalidArgumentException('BILLING_ORDER_INVALID');
        $q=genesisDb()->prepare("SELECT id FROM billing_orders WHERE user_id=? AND provider='google-play' AND play_profile_hash=?");$q->execute([$userId,$hash]);$id=$q->fetchColumn();
        if(!is_string($id))throw new GenesisResourceLimitException(404,'BILLING_ORDER_NOT_FOUND');
        genesisJson(genesisBillingVerifyOrder($userId,$id,$input));
    }
    if($method==='POST' && count($segments)===2 && $segments[1]==='trial') {
        $result=genesisTrialActivate($userId,genesisReadJson());
        $trialUser=genesisFindUser($userId);
        if(!$trialUser)throw new GenesisResourceLimitException(401,'UNAUTHORIZED');
        $profile=[...genesisUserForClient($trialUser),'trial'=>$result['trial'],'featureAccess'=>$result['featureAccess']];
        genesisJson([...$result,'user'=>$profile]);
    }
    if ($method==='POST' && count($segments)===2 && $segments[1]==='orders') genesisJson(genesisBillingCreateOrder($userId,genesisReadJson()),201);
    if ($method==='POST' && count($segments)===4 && $segments[1]==='orders' && $segments[3]==='verify')
        genesisJson(genesisBillingVerifyOrder($userId,$segments[2],genesisReadJson()));
    genesisJson(['error'=>'NOT_FOUND'],404);
}
