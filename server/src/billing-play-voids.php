<?php
declare(strict_types=1);
require_once __DIR__.'/billing-gateways.php';

/** One authorized Google page per cron pass. Purchase tokens are never persisted. */
function genesisBillingPlayVoidPage(PDO $db, int $now, callable $list): int
{
    if($db->inTransaction())throw new LogicException('BILLING_PLAY_SCAN_REQUIRES_AUTOCOMMIT');
    $lease=$now+300;
    $claim=$db->prepare('UPDATE billing_play_void_scan SET next_attempt_at=? WHERE id=1 AND next_attempt_at<=?');
    $claim->execute([$lease,$now]);
    if(!$claim->rowCount())return 0;
    $scan=$db->query('SELECT * FROM billing_play_void_scan WHERE id=1')->fetch(PDO::FETCH_ASSOC);
    $resume=is_string($scan['page_token'])&&(int)$scan['window_end']>=$now-86400;
    $end=$resume?(int)$scan['window_end']:$now;
    $params=['type'=>0,'maxResults'=>100];
    if($resume)$params['token']=$scan['page_token'];
    else {
        // Google lists the last 30 days. Overlap completed windows to include late visibility.
        $params['startTime']=1000*max($now-29*86400,(int)$scan['checked_through']-3600,0);
        $params['endTime']=1000*$end;
    }
    $page=$list($params);
    $rows=$page['voidedPurchases']??[];
    $next=$page['tokenPagination']['nextPageToken']??null;
    if(!is_array($rows)||!array_is_list($rows)||count($rows)>100
        ||($next!==null&&(!is_string($next)||strlen($next)>4096||trim($next)===''
            ||($resume&&$next===$scan['page_token']))))throw new DomainException('BILLING_PLAY_VOID_PAGE_INVALID');

    $lookup=$db->prepare("SELECT o.id,o.amount_minor,o.currency,o.product_id,r.confirmed_at
        FROM billing_receipts r JOIN billing_orders o ON o.id=r.order_id
        WHERE r.provider='google-play' AND o.provider='google-play' AND r.reference_hash=? AND r.state='paid'");
    $count=0;
    foreach($rows as $row){
        $token=is_array($row)?($row['purchaseToken']??null):null;
        if(!is_string($token)||strlen($token)<10||strlen($token)>4096)
            throw new DomainException('BILLING_PLAY_VOID_INVALID');
        $lookup->execute([hash('sha256',$token)]);
        $order=$lookup->fetch(PDO::FETCH_ASSOC);
        $lookup->closeCursor();
        if(!$order)continue;
        $purchased=$row['purchaseTimeMillis']??null;
        $voided=$row['voidedTimeMillis']??null;
        if(!is_scalar($purchased)||!preg_match('/\A[0-9]{1,13}\z/D',(string)$purchased)
            ||!is_scalar($voided)||!preg_match('/\A[0-9]{1,13}\z/D',(string)$voided)
            ||(int)$voided<(int)$purchased||intdiv((int)$voided,1000)>$now+300
            ||($row['voidedQuantity']??1)!==1
            ||gmdate('Y-m-d\TH:i:s\Z',intdiv((int)$purchased,1000))!==$order['confirmed_at'])
            throw new DomainException('BILLING_PLAY_VOID_MISMATCH');
        genesisBillingApplyReceipt($db,new GenesisVerifiedBillingReceipt('google-play',$token,$order['id'],'refunded',
            (int)$order['amount_minor'],$order['currency'],$order['product_id'],$order['confirmed_at'],
            hash('sha256',json_encode($row,JSON_THROW_ON_ERROR))),$now);
        $count++;
    }
    $update=$db->prepare('UPDATE billing_play_void_scan SET checked_through=?,page_token=?,window_end=?,next_attempt_at=?
        WHERE id=1 AND next_attempt_at=?');
    $update->execute([$next===null?$end:(int)$scan['checked_through'],$next,$next===null?null:$end,
        $now+($next===null?900:60),$lease]);
    return $count;
}

function genesisBillingPlayVoidScan(): void
{
    try {
        $settings=genesisBillingSettings();
        if(!genesisBillingProviderReady('google-play',$settings))return;
        $db=genesisDb();
        if(!$db->query("SELECT 1 FROM billing_receipts WHERE provider='google-play' AND state='paid' LIMIT 1")->fetchColumn())return;
        $configuration=$settings['providers']['google-play'];
        genesisBillingPlayVoidPage($db,time(),static function(array $params)use($configuration):array{
            $token=genesisBillingGoogleAccessToken($configuration);
            return genesisBillingHttp('GET','https://androidpublisher.googleapis.com/androidpublisher/v3/applications/'
                .'ru.genesis.calendar/purchases/voidedpurchases?'.http_build_query($params,'','&',PHP_QUERY_RFC3986),
                null,['Authorization: Bearer '.$token]);
        });
    }catch(Throwable){
        genesisLogError('[PlayBilling] Refund reconciliation deferred');
    }
}
