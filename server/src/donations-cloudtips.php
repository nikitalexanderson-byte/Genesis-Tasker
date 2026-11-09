<?php
declare(strict_types=1);

/** CloudTips' own webhook contract, not the separate CloudPayments payment API.
 * Notifications and HMAC: https://cloudpayments.atlassian.net/wiki/spaces/CA/pages/2612003114
 * Payment page and invoiceid: https://cloudpayments.atlassian.net/wiki/spaces/CA/pages/2612658209
 */
function genesisCloudTipsSettings(): array
{
    $settings=genesisConfig()['cloudtips']??[];
    if(!is_array($settings))$settings=[];
    $layout=$settings['layout_id']??'4d58d20a';
    $secret=$settings['webhook_secret']??'';
    $ready=is_string($layout)&&preg_match('/\A[A-Za-z0-9-]{8,100}\z/D',$layout)
        &&is_string($secret)&&strlen($secret)>=12&&strlen($secret)<=512;
    return ['ready'=>(bool)$ready,'layout'=>$layout,'secret'=>$secret,
        'historyReconciled'=>($settings['history_reconciled']??false)===true];
}

/** Unknown tips are not proof of zero donations. New unmatched receipts pause deletion too. */
function genesisCloudTipsDeletionReady(): bool
{
    $settings=genesisCloudTipsSettings();
    return (genesisConfig()['account_retention']['enabled']??false)===true
        &&$settings['ready']&&$settings['historyReconciled']
        &&genesisDb()->query('SELECT 1 FROM donation_receipts WHERE user_id IS NULL LIMIT 1')->fetchColumn()===false;
}

function genesisCloudTipsHasDonation(PDO $db,string $userId): bool
{
    $q=$db->prepare('SELECT 1 FROM donation_receipts WHERE user_id=? LIMIT 1');$q->execute([$userId]);
    return $q->fetchColumn()!==false;
}

/** Preserve an in-flight donor while the provider retries a delayed signed callback. */
function genesisCloudTipsPendingDonation(PDO $db,string $userId,int $now): bool
{
    $q=$db->prepare('SELECT 1 FROM donation_intents i WHERE i.user_id=? AND i.created_at>=?
        AND NOT EXISTS(SELECT 1 FROM donation_receipts r WHERE r.intent_id=i.id) LIMIT 1');
    $q->execute([$userId,gmdate('Y-m-d\TH:i:s\Z',$now-7*86400)]);
    return $q->fetchColumn()!==false;
}

/** The amount stays the donor's choice. The opaque invoice binds the verified callback. */
function genesisCloudTipsCheckout(string $userId): array
{
    if(genesisFindUser($userId)===null)throw new GenesisResourceLimitException(401,'AUTH_REQUIRED');
    $settings=genesisCloudTipsSettings();
    // Before provider setup the existing public donation page stays available.
    if(!$settings['ready'])return ['url'=>'https://pay.cloudtips.ru/p/4d58d20a','tracked'=>false];
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        if(genesisFindUser($userId)===null)throw new GenesisResourceLimitException(401,'AUTH_REQUIRED');
        $q=$db->prepare('SELECT id FROM donation_intents WHERE user_id=? AND created_at>=? ORDER BY created_at DESC LIMIT 1');
        $q->execute([$userId,gmdate('Y-m-d\TH:i:s\Z',time()-600)]);$id=$q->fetchColumn();
        if($id===false){$id=genesisUuid();$db->prepare('INSERT INTO donation_intents(id,user_id,created_at) VALUES(?,?,?)')->execute([$id,$userId,genesisNow()]);}
        $db->commit();
        return ['url'=>'https://pay.cloudtips.ru/p/'.$settings['layout'].'?invoiceid='.rawurlencode($id),'tracked'=>true];
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}

/** Parse signed form fields without PHP's duplicate-key or bracket normalization. */
function genesisCloudTipsForm(string $raw): array
{
    $fields=[];
    foreach(explode('&',$raw)as$part){
        if($part==='')continue;
        [$key,$value]=array_pad(explode('=',$part,2),2,'');
        $key=strtolower(urldecode($key));$value=urldecode($value);
        if(!preg_match('/\A[a-z][a-z0-9]{0,63}\z/D',$key)||array_key_exists($key,$fields)
            ||preg_match('//u',$value)!==1)throw new GenesisResourceLimitException(400,'CLOUDTIPS_INVALID_PAYLOAD');
        $fields[$key]=$value;
    }
    return $fields;
}

/** Verify exact UTF-8 request bytes before interpreting any payment or account field. */
function genesisCloudTipsWebhook(string $raw,string $signature,string $contentType): array
{
    $settings=genesisCloudTipsSettings();
    if(!$settings['ready'])throw new GenesisResourceLimitException(503,'CLOUDTIPS_NOT_CONFIGURED');
    if(strlen($raw)>16384||strtolower(trim(explode(';',$contentType,2)[0]))!=='application/x-www-form-urlencoded')
        throw new GenesisResourceLimitException(400,'CLOUDTIPS_INVALID_PAYLOAD');
    $provided=base64_decode($signature,true);
    if($provided===false||strlen($provided)!==32||!hash_equals(hash_hmac('sha256',$raw,$settings['secret'],true),$provided))
        throw new GenesisResourceLimitException(403,'CLOUDTIPS_INVALID_SIGNATURE');
    $fields=genesisCloudTipsForm($raw);
    if(!isset($fields['success'])||!in_array(strtolower($fields['success']),['true','false'],true))
        throw new GenesisResourceLimitException(400,'CLOUDTIPS_INVALID_PAYLOAD');
    if(($fields['layoutid']??'')!==$settings['layout'])throw new GenesisResourceLimitException(400,'CLOUDTIPS_WRONG_LAYOUT');
    if(strtolower($fields['success'])==='false')return ['code'=>0];
    $amount=$fields['amount']??'';
    if(!preg_match('/\A(0|[1-9][0-9]{0,8})(?:\.([0-9]{1,2}))?\z/D',$amount,$parts))
        throw new GenesisResourceLimitException(400,'CLOUDTIPS_INVALID_AMOUNT');
    $minor=(int)$parts[1]*100+(int)str_pad($parts[2]??'',2,'0');
    $transaction=$fields['transactionid']??'';$invoice=$fields['invoiceid']??'';$currency=$fields['currency']??'';
    $date=$fields['createddate']??'';
    if($minor<=0||$currency!=='RUB'||!preg_match('/\A[A-Za-z0-9_-]{1,128}\z/D',$transaction)
        ||($invoice!==''&&!preg_match('/\A[a-f0-9-]{36}\z/D',$invoice))
        ||!preg_match('/\A\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.[0-9]{1,7})?Z\z/D',$date))
        throw new GenesisResourceLimitException(400,'CLOUDTIPS_INVALID_PAYLOAD');
    $normalized=preg_replace('/\.[0-9]+Z$/','Z',$date);
    $paid=genesisSubscriptionExpiry($normalized);
    if($paid===false||$paid>time()+300)throw new GenesisResourceLimitException(400,'CLOUDTIPS_INVALID_DATE');
    $stamp=gmdate('Y-m-d\TH:i:s\Z',$paid);
    $hash=hash('sha256','cloudtips:'.$transaction);
    // Only the fields needed for reconciliation. No raw body, card data, IP or sender name.
    $evidence=hash('sha256',json_encode([$transaction,$invoice,$settings['layout'],$minor,$currency,$stamp],JSON_THROW_ON_ERROR));
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        $q=$db->prepare('SELECT evidence_hash FROM donation_receipts WHERE transaction_hash=?');$q->execute([$hash]);$old=$q->fetchColumn();
        if($old!==false){
            if(!hash_equals($old,$evidence))throw new GenesisResourceLimitException(409,'CLOUDTIPS_RECEIPT_CONFLICT');
            $db->commit();return ['code'=>0];
        }
        $q=$db->prepare('SELECT id,user_id FROM donation_intents WHERE id=?');$q->execute([$invoice]);$intent=$q->fetch();
        $db->prepare('INSERT INTO donation_receipts(transaction_hash,intent_id,user_id,amount_minor,currency,paid_at,verified_at,evidence_hash) VALUES(?,?,?,?,?,?,?,?)')
            ->execute([$hash,$intent['id']??null,$intent['user_id']??null,$minor,$currency,$stamp,genesisNow(),$evidence]);
        $db->commit();return ['code'=>0];
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}
