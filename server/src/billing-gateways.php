<?php
declare(strict_types=1);
require_once __DIR__.'/billing.php';

/** Private server-to-provider transport. Never follow redirects or log bodies/credentials. */
function genesisBillingHttp(string $method, string $url, ?array $body, array $headers = [], ?string $basic = null): array
{
    $curl = curl_init($url);
    curl_setopt_array($curl,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_CONNECTTIMEOUT=>10,
        CURLOPT_TIMEOUT=>25,CURLOPT_CUSTOMREQUEST=>$method,CURLOPT_HTTPHEADER=>['Accept: application/json','Content-Type: application/json',...$headers],
        CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_SSL_VERIFYHOST=>2]);
    if ($basic !== null) curl_setopt($curl,CURLOPT_USERPWD,$basic);
    if ($body !== null) curl_setopt($curl,CURLOPT_POSTFIELDS,json_encode($body,JSON_THROW_ON_ERROR));
    $raw = curl_exec($curl); $status = (int)curl_getinfo($curl,CURLINFO_RESPONSE_CODE); curl_close($curl);
    if (!is_string($raw) || strlen($raw)>2_000_000 || $status<200 || $status>=300) throw new GenesisResourceLimitException(503,'BILLING_PROVIDER_UNAVAILABLE');
    if ($status===204 && $raw==='') return [];
    $value = json_decode($raw,true,64,JSON_THROW_ON_ERROR);
    if (!is_array($value)) throw new DomainException('BILLING_PROVIDER_RESPONSE_INVALID');
    return $value;
}

function genesisBillingGoogleAccessToken(array $configuration): string
{
    $encode = static fn(string $s):string=>rtrim(strtr(base64_encode($s),'+/','-_'),'=');
    $now = time(); $unsigned = $encode(json_encode(['alg'=>'RS256','typ'=>'JWT'],JSON_THROW_ON_ERROR)).'.'
        .$encode(json_encode(['iss'=>$configuration['service_account_email'],'scope'=>'https://www.googleapis.com/auth/androidpublisher https://www.googleapis.com/auth/playintegrity',
            'aud'=>'https://oauth2.googleapis.com/token','iat'=>$now,'exp'=>$now+900],JSON_THROW_ON_ERROR));
    if (!openssl_sign($unsigned,$signature,$configuration['service_account_private_key'],OPENSSL_ALGO_SHA256)) throw new RuntimeException('BILLING_GOOGLE_CONFIGURATION_INVALID');
    // OAuth's token endpoint requires form encoding rather than the provider JSON transport.
    $curl = curl_init('https://oauth2.googleapis.com/token');
    curl_setopt_array($curl,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_POST=>true,CURLOPT_CONNECTTIMEOUT=>10,CURLOPT_TIMEOUT=>25,
        CURLOPT_FOLLOWLOCATION=>false,CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_POSTFIELDS=>http_build_query([
            'grant_type'=>'urn:ietf:params:oauth:grant-type:jwt-bearer','assertion'=>$unsigned.'.'.$encode($signature)])]);
    $raw=curl_exec($curl);$status=(int)curl_getinfo($curl,CURLINFO_RESPONSE_CODE);curl_close($curl);
    $token = is_string($raw) && $status===200 ? json_decode($raw,true,8)['access_token']??null : null;
    if (!is_string($token) || $token==='') throw new GenesisResourceLimitException(503,'BILLING_PROVIDER_UNAVAILABLE');
    return $token;
}

function genesisBillingYooFiscalReceipt(array $order,array $configuration): array
{
    if(!filter_var($order['receipt_email']??'',FILTER_VALIDATE_EMAIL))throw new InvalidArgumentException('BILLING_RECEIPT_EMAIL_REQUIRED');
    return ['customer'=>['email'=>$order['receipt_email']],'items'=>[['description'=>'GENESIS '.$order['plan'],'quantity'=>'1.00',
        'amount'=>['value'=>sprintf('%d.%02d',intdiv((int)$order['amount_minor'],100),(int)$order['amount_minor']%100),'currency'=>$order['currency']],
        'vat_code'=>(int)$configuration['vat_code'],'payment_mode'=>'full_payment','payment_subject'=>'service']]];
}

/** The body is frozen before any request, so every retry uses identical receipt/confirmation data. */
function genesisBillingYooCheckoutBody(array $order,array $configuration,string $returnUrl): array
{
    if(($configuration['test_mode']??false)!==false)throw new DomainException('BILLING_TEST_PAYMENT_UNSUPPORTED');
    $body=['amount'=>['value'=>sprintf('%d.%02d',intdiv((int)$order['amount_minor'],100),(int)$order['amount_minor']%100),'currency'=>$order['currency']],
        'capture'=>(int)($order['upgrade_credit_minor']??0)===0,'confirmation'=>['type'=>'redirect','return_url'=>$returnUrl],
        'description'=>'GENESIS '.$order['plan'], 'metadata'=>['genesis_order_id'=>$order['id']]];
    if (($configuration['receipt_required']??true)===true) {
        $body['receipt']=is_string($order['encrypted_receipt']??null)
            ?json_decode(genesisSharedContentDecrypt($order['encrypted_receipt']),true,16,JSON_THROW_ON_ERROR):genesisBillingYooFiscalReceipt($order,$configuration);
    }
    return $body;
}

/** Checkout URLs and totals come from a provider response, never from the browser. */
function genesisBillingGatewayCheckout(array $order, array $configuration, string $returnUrl, ?callable $http = null): array
{
    $http ??= 'genesisBillingHttp';
    if ($order['provider']==='yookassa') {
        if(($configuration['test_mode']??false)!==false)throw new DomainException('BILLING_TEST_PAYMENT_UNSUPPORTED');
        $body=genesisBillingYooCheckoutBody($order,$configuration,$returnUrl);
        $result=$http('POST','https://api.yookassa.ru/v3/payments',$body,['Idempotence-Key: '.$order['id']],$configuration['shop_id'].':'.$configuration['secret_key']);
        if(($result['test']??false)!==false)throw new DomainException('BILLING_TEST_PAYMENT_UNSUPPORTED');
        $url=$result['confirmation']['confirmation_url']??null;
        if (!is_string($result['id']??null) || !is_string($url) || !str_starts_with($url,'https://')) throw new DomainException('BILLING_PROVIDER_RESPONSE_INVALID');
        return ['checkoutUrl'=>$url,'providerReference'=>$result['id']];
    }
    if ($order['provider']==='lemon-squeezy') {
        if(($configuration['test_mode']??false)!==false)throw new DomainException('BILLING_TEST_PAYMENT_UNSUPPORTED');
        if(($configuration['currency']??null)!=='USD'||($configuration['tax_inclusive']??false)!==true
            ||($configuration['gross_total_verified']??false)!==true||$order['currency']!=='USD')throw new DomainException('BILLING_GROSS_PRICE_UNVERIFIED');
        if(!is_string($order['product_id'])||preg_match('/\A[1-9][0-9]{0,14}\z/D',$order['product_id'])!==1)throw new DomainException('BILLING_PROVIDER_RESPONSE_INVALID');
        $variant=(int)$order['product_id'];
        $result=$http('POST','https://api.lemonsqueezy.com/v1/checkouts',['data'=>['type'=>'checkouts','attributes'=>[
            'custom_price'=>(int)$order['amount_minor'],'test_mode'=>false,'preview'=>true,
            'checkout_options'=>['discount'=>false],
            'checkout_data'=>['custom'=>['genesis_order_id'=>$order['id']],'variant_quantities'=>[['variant_id'=>$variant,'quantity'=>1]]],
            'product_options'=>['redirect_url'=>$returnUrl,'enabled_variants'=>[$variant]]],
            'relationships'=>['store'=>['data'=>['type'=>'stores','id'=>(string)$configuration['store_id']]],
                'variant'=>['data'=>['type'=>'variants','id'=>$order['product_id']]]]]],['Authorization: Bearer '.$configuration['api_key']],null);
        $attributes=$result['data']['attributes']??[];$preview=$attributes['preview']??[];
        if(($attributes['test_mode']??false)!==false||(string)($attributes['store_id']??'')!==(string)$configuration['store_id']
            ||(string)($attributes['variant_id']??'')!==$order['product_id']||($attributes['custom_price']??null)!==(int)$order['amount_minor']
            ||($preview['currency']??null)!==$order['currency']||($preview['total']??null)!==(int)$order['amount_minor']
            ||($preview['discount_total']??null)!==0)throw new DomainException('BILLING_GROSS_PRICE_UNVERIFIED');
        $url=$attributes['url']??null;
        if (!is_string($url) || !str_starts_with($url,'https://')) throw new DomainException('BILLING_PROVIDER_RESPONSE_INVALID');
        return ['checkoutUrl'=>$url,'providerReference'=>(string)($result['data']['id']??'')];
    }
    if ($order['provider']==='google-play') return ['checkoutUrl'=>null,'productId'=>$order['product_id'],
        'obfuscatedAccountId'=>$order['owner_hash'],'obfuscatedProfileId'=>hash('sha256',$order['id'])];
    throw new InvalidArgumentException('BILLING_PROVIDER_INVALID');
}

/** YooKassa webhooks are hints: re-fetch the payment with shop credentials before applying it. */
function genesisBillingYooSettleUpgrade(PDO $db, array $payment, array $order, array $configuration, ?callable $http = null, ?int $now = null): array
{
    if(($payment['test']??false)!==false||($configuration['test_mode']??false)!==false)throw new DomainException('BILLING_TEST_PAYMENT_UNSUPPORTED');
    if (($payment['status']??'') !== 'waiting_for_capture' || (int)($order['upgrade_credit_minor']??0) === 0) return $payment;
    if (($payment['metadata']['genesis_order_id']??null)!==$order['id']
        || ($payment['recipient']['account_id']??null)!==(string)$configuration['shop_id']
        || ($payment['id']??null)!==$order['provider_secret']
        || ($payment['amount']['currency']??null)!==$order['currency']
        || ($payment['amount']['value']??null)!==sprintf('%d.%02d',intdiv((int)$order['amount_minor'],100),(int)$order['amount_minor']%100)) throw new DomainException('BILLING_RECEIPT_MISMATCH');
    $http ??= 'genesisBillingHttp';
    $now??=time();
    $valid = genesisBillingUpgradeCaptureValid($db,$order,$now);
    $action=genesisBillingSettlementCaptureBegin($db,$order,$valid?'capture':'cancel',$now);
    $valid=$action==='capture';
    $body = $valid ? ['amount'=>['value'=>sprintf('%d.%02d',intdiv((int)$order['amount_minor'],100),(int)$order['amount_minor']%100),'currency'=>$order['currency']]] : null;
    return $http('POST','https://api.yookassa.ru/v3/payments/'.rawurlencode($payment['id']).($valid?'/capture':'/cancel'),
        $body,['Idempotence-Key: '.hash('sha256',$order['id'].($valid?':capture':':cancel'))],$configuration['shop_id'].':'.$configuration['secret_key']);
}

function genesisBillingYooReceipt(array $payment, array $order, array $configuration): GenesisVerifiedBillingReceipt
{
    if(($payment['test']??false)!==false||($configuration['test_mode']??false)!==false)throw new DomainException('BILLING_TEST_PAYMENT_UNSUPPORTED');
    $amount=$payment['amount']['value']??'';
    if (!is_string($amount) || !preg_match('/\A([0-9]{1,10})\.([0-9]{2})\z/D',$amount,$parts)
        || ($payment['recipient']['account_id']??null)!==(string)$configuration['shop_id']
        || ($payment['metadata']['genesis_order_id']??null)!==$order['id']
        ||(is_string($order['provider_secret']??null)&&$order['provider_secret']!==''&&($payment['id']??null)!==$order['provider_secret'])) throw new DomainException('BILLING_RECEIPT_MISMATCH');
    $state=($payment['status']??'')==='succeeded' && ($payment['paid']??false)===true ? 'paid'
        : (($payment['status']??'')==='canceled'?'cancelled':null);
    $amountMinor=(int)$parts[1]*100+(int)$parts[2];$refunded=0;
    if(array_key_exists('refunded_amount',$payment)){
        $refund=$payment['refunded_amount'];
        if(!is_array($refund)||($refund['currency']??null)!==($payment['amount']['currency']??null)
            ||!is_string($refund['value']??null)||preg_match('/\A([0-9]{1,10})\.([0-9]{2})\z/D',$refund['value'],$refundParts)!==1)
            throw new DomainException('BILLING_RECEIPT_MISMATCH');
        $refunded=(int)$refundParts[1]*100+(int)$refundParts[2];
        if($refunded>$amountMinor)throw new DomainException('BILLING_RECEIPT_MISMATCH');
    }
    if($state==='paid'&&$refunded===$amountMinor)$state='refunded';
    if ($state===null) throw new DomainException('BILLING_PAYMENT_NOT_CONFIRMED');
    return new GenesisVerifiedBillingReceipt('yookassa',(string)$payment['id'],$order['id'],$state,
        $amountMinor,(string)$payment['amount']['currency'],$order['product_id'],
        genesisBillingProviderTimestamp($payment['captured_at']??$payment['created_at']??''),hash('sha256',json_encode($payment,JSON_THROW_ON_ERROR)),null,$refunded);
}

function genesisBillingProviderTimestamp(string $value): string
{
    if (!preg_match('/\A\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})\z/D',$value)) throw new DomainException('BILLING_RECEIPT_INVALID');
    return (new DateTimeImmutable($value))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');
}

/** A valid signature authenticates the raw bytes; metadata alone never authenticates a callback. */
function genesisBillingLemonEvent(string $raw, string $signature, array $configuration): array
{
    if (strlen($raw)>500_000 || preg_match('/\A[a-f0-9]{64}\z/Di',$signature)!==1
        || !hash_equals(hash_hmac('sha256',$raw,$configuration['webhook_secret']),strtolower($signature)))
        throw new GenesisResourceLimitException(403,'BILLING_SIGNATURE_INVALID');
    $event=json_decode($raw,true,48,JSON_THROW_ON_ERROR);
    if (!is_array($event) || ($event['data']['type']??'')!=='orders') throw new DomainException('BILLING_EVENT_UNSUPPORTED');
    return $event;
}

function genesisBillingLemonReceipt(array $verified, array $order, array $configuration): GenesisVerifiedBillingReceipt
{
    $row=$verified['data']['attributes']??[];
    if(($row['test_mode']??false)!==false||($configuration['test_mode']??false)!==false)throw new DomainException('BILLING_TEST_PAYMENT_UNSUPPORTED');
    if ((string)($row['store_id']??'')!==(string)$configuration['store_id']
        || (string)($row['first_order_item']['variant_id']??'')!==$order['product_id']) throw new DomainException('BILLING_RECEIPT_MISMATCH');
    $state=match($row['status']??'') {'paid','partial_refund'=>'paid','refunded'=>'refunded',default=>null};
    if ($state===null || !is_int($row['total']??null)||$row['total']<=0) throw new DomainException('BILLING_PAYMENT_NOT_CONFIRMED');
    $refunded=$row['refunded_amount']??0;
    if(!is_int($refunded)||$refunded<0||$refunded>$row['total']||(($row['status']??null)==='partial_refund'&&$refunded===0))throw new DomainException('BILLING_RECEIPT_MISMATCH');
    return new GenesisVerifiedBillingReceipt('lemon-squeezy',(string)$verified['data']['id'],$order['id'],$state,$row['total'],
        (string)$row['currency'],$order['product_id'],genesisBillingProviderTimestamp($row['created_at']),hash('sha256',json_encode($verified,JSON_THROW_ON_ERROR)),null,$refunded);
}

/** Play Billing one-time products represent the chosen 1/6/12 month or lifetime offer. */
function genesisBillingPlayReceipt(array $verified, array $order, string $purchaseToken): GenesisVerifiedBillingReceipt
{
    if(array_key_exists('purchaseType',$verified))throw new DomainException('BILLING_TEST_PAYMENT_UNSUPPORTED');
    if (($verified['obfuscatedExternalAccountId']??null)!==$order['owner_hash']
        || ($verified['obfuscatedExternalProfileId']??null)!==hash('sha256',$order['id'])
        || !in_array($verified['purchaseState']??null,[0,1],true) || !ctype_digit((string)($verified['purchaseTimeMillis']??'')))
        throw new DomainException('BILLING_RECEIPT_MISMATCH');
    return new GenesisVerifiedBillingReceipt('google-play',$purchaseToken,$order['id'],$verified['purchaseState']===0?'paid':'refunded',
        (int)$order['amount_minor'],$order['currency'],$order['product_id'],gmdate('Y-m-d\TH:i:s\Z',intdiv((int)$verified['purchaseTimeMillis'],1000)),
        hash('sha256',json_encode($verified,JSON_THROW_ON_ERROR)));
}
