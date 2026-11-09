<?php
declare(strict_types=1);
foreach(['bootstrap','repository','google','billing-api']as$module)require_once dirname(__DIR__).'/src/'.$module.'.php';
if(!in_array(parse_url(genesisConfig()['app_url'],PHP_URL_HOST),['127.0.0.1','localhost.invalid'],true))throw new RuntimeException('Isolated configuration required');
function modelingCheck(bool $ok,string $why):void{if(!$ok)throw new RuntimeException($why);}
function modelingReject(string $code,callable $action):void{
    try{$action();throw new RuntimeException('Missing rejection: '.$code);}catch(GenesisResourceLimitException|InvalidArgumentException|DomainException $e){modelingCheck($e->getMessage()===$code,'Wrong rejection: '.$e->getMessage());}
}
$db=genesisDb();$suffix=bin2hex(random_bytes(4));
$buyer=genesisUpsertGoogleUser(['sub'=>'modeling-'.$suffix,'email'=>'modeling-'.$suffix.'@example.invalid','email_verified'=>true],[],false,false);
$other=genesisUpsertGoogleUser(['sub'=>'modeling-other-'.$suffix,'email'=>'modeling-other-'.$suffix.'@example.invalid','email_verified'=>true],[],false,false);
$db->prepare("UPDATE users SET subscription_plan='premium4life' WHERE id=?")->execute([$buyer['id']]);$buyer=genesisFindUser($buyer['id']);
genesisEstablishGoogleSession($buyer,$buyer['google_sub']);
$settings=genesisBillingYooPrivateSettings([],['schema_version'=>1,'verified'=>true,'enabled'=>true,'shop_id'=>'1105773',
    'secret_key'=>'live_synthetic_modeling_not_real','receipt_mode'=>'npd-manual']);
$catalog=genesisModelingCatalog('web',$settings);
modelingCheck($catalog['prices']===['RUB'=>2000000,'USD'=>20000],'Fixed service prices changed');
modelingCheck(array_column($catalog['methods'],'available','provider')['yookassa']===true,'Approved existing checkout was not reused');
modelingCheck(array_column($catalog['methods'],'available','provider')['lemon-squeezy']===false,'Unconfigured USD product was exposed');
$resultId=genesisUuid();$input=['resultId'=>$resultId,'provider'=>'yookassa','client'=>'web','idempotencyKey'=>str_repeat('a',20)];
$posts=[];$payments=[];$loseReply=true;
$http=static function($method,$url,$body=null,$headers=[],$basic=null)use(&$posts,&$payments,&$loseReply):array{
    if($method==='POST'){
        modelingCheck($url==='https://api.yookassa.ru/v3/payments','Unexpected service endpoint');
        modelingCheck($body['amount']===['value'=>'20000.00','currency'=>'RUB']&&$body['capture']===true,'Checkout did not freeze the exact service amount');
        $posts[]=[$body,$headers];$orderId=$body['metadata']['genesis_order_id'];$id='service-'.$orderId;
        $payments[$id]??=['id'=>$id,'test'=>false,'recipient'=>['account_id'=>'1105773'],'metadata'=>['genesis_order_id'=>$orderId],
            'amount'=>['value'=>'20000.00','currency'=>'RUB'],'status'=>'pending','paid'=>false,'created_at'=>genesisNow(),
            'confirmation'=>['confirmation_url'=>'https://yoomoney.ru/checkout/'.$orderId]];
        if($loseReply){$loseReply=false;throw new RuntimeException('Synthetic lost reply');}
        return $payments[$id];
    }
    $id=basename(parse_url($url,PHP_URL_PATH));return $payments[$id]??throw new RuntimeException('Unexpected payment read');
};
modelingReject('MODELING_RESULT_NOT_READY',fn()=>genesisModelingCreateOrder($buyer['id'],$input,$settings,$http));
modelingCheck($posts===[],'An unfinished method could charge a user');
genesisModelingPrepareResult($buyer['id'],$resultId,'synthetic-method-v1',['answer'=>'Synthetic private solution']);
genesisModelingPrepareResult($buyer['id'],$resultId,'synthetic-method-v1',['answer'=>'Synthetic private solution']);
modelingReject('MODELING_RESULT_IMMUTABLE',fn()=>genesisModelingPrepareResult($buyer['id'],$resultId,'synthetic-method-v1',['answer'=>'Changed']));
modelingReject('BILLING_ORDER_INVALID',fn()=>genesisModelingCreateOrder($buyer['id'],[...$input,'amountMinor'=>1],$settings,$http));
modelingReject('MODELING_RESULT_NOT_READY',fn()=>genesisModelingResult($other['id'],$resultId));
modelingReject('MODELING_PAYMENT_REQUIRED',fn()=>genesisModelingResult($buyer['id'],$resultId));
try{genesisModelingCreateOrder($buyer['id'],$input,$settings,$http);throw new LogicException('Lost reply ignored');}catch(RuntimeException $e){modelingCheck($e->getMessage()==='Synthetic lost reply','Wrong simulated failure: '.$e->getMessage());}
$order=genesisModelingCreateOrder($buyer['id'],$input,$settings,$http);
modelingCheck(count($posts)===2&&$posts[0]===$posts[1],'Lost-reply retry changed the frozen request or deduplication key');
modelingCheck($order['amountMinor']===2000000&&$order['currency']==='RUB'&&$order['status']==='pending','Wrong public service invoice');
modelingCheck(str_contains($order['checkoutUrl'],'yoomoney.ru'),'No verified checkout URL');
genesisModelingCreateOrder($buyer['id'],[...$input,'idempotencyKey'=>str_repeat('b',20)],$settings,$http);
modelingCheck(count($posts)===2,'A second click created another checkout');
modelingReject('BILLING_SETTLEMENT_REQUIRED',fn()=>genesisBillingAssertAccountDeletable($db,$buyer['id']));
modelingReject('BILLING_ORDER_NOT_FOUND',fn()=>genesisModelingOrder($order['id'],$other['id']));
$raw=genesisModelingOrder($order['id']);$paymentId=$raw['provider_secret'];
$bad=[...$payments[$paymentId],'amount'=>['value'=>'22.22','currency'=>'RUB'],'status'=>'succeeded','paid'=>true];
modelingReject('BILLING_RECEIPT_MISMATCH',fn()=>genesisModelingAcceptYoo($bad,$raw,$settings['providers']['yookassa']));
modelingReject('MODELING_PAYMENT_REQUIRED',fn()=>genesisModelingResult($buyer['id'],$resultId));
$before=[$buyer['subscription_plan'],$buyer['subscription_valid_until'],$db->query('SELECT COUNT(*) FROM billing_periods')->fetchColumn()];
$payments[$paymentId]['status']='succeeded';$payments[$paymentId]['paid']=true;$payments[$paymentId]['captured_at']=$payments[$paymentId]['created_at'];
genesisModelingReconcile($raw,$settings,$http);
$solution=genesisModelingResult($buyer['id'],$resultId);
modelingCheck($solution['solution']===['answer'=>'Synthetic private solution'],'Confirmed payment did not unlock the bound result');
$fresh=genesisFindUser($buyer['id']);modelingCheck($before===[$fresh['subscription_plan'],$fresh['subscription_valid_until'],$db->query('SELECT COUNT(*) FROM billing_periods')->fetchColumn()],'Service payment changed the subscription');
$paid=$payments[$paymentId];$refunded=[...$paid,'refunded_amount'=>['value'=>'0.01','currency'=>'RUB']];
genesisModelingAcceptYoo($refunded,genesisModelingOrder($order['id']),$settings['providers']['yookassa']);
genesisModelingAcceptYoo($paid,genesisModelingOrder($order['id']),$settings['providers']['yookassa']);
modelingReject('MODELING_PAYMENT_REQUIRED',fn()=>genesisModelingResult($buyer['id'],$resultId));
modelingCheck(genesisModelingOrder($order['id'])['status']==='refunded','Late paid event resurrected refunded access');
genesisBillingAssertAccountDeletable($db,$buyer['id']);

// A verified USD service receipt uses its own product and exactly $200, without subscription credit.
$usdResult=genesisUuid();$usdOrder=genesisUuid();$stamp=genesisNow();
genesisModelingPrepareResult($buyer['id'],$usdResult,'synthetic-method-v1',['answer'=>'USD result']);
$db->prepare('INSERT INTO future_modeling_orders(id,user_id,result_id,provider,amount_minor,currency,product_id,idempotency_key,started_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    ->execute([$usdOrder,$buyer['id'],$usdResult,'lemon-squeezy',20000,'USD','12345','usd-service-key-0001',$stamp,$stamp]);
$lemon=['data'=>['id'=>'123456789','attributes'=>['test_mode'=>false,'store_id'=>'7','first_order_item'=>['variant_id'=>'12345'],
    'status'=>'paid','total'=>20000,'currency'=>'USD','created_at'=>$stamp]]];
$receipt=genesisBillingLemonReceipt($lemon,genesisModelingOrder($usdOrder),['store_id'=>'7','test_mode'=>false]);
genesisModelingApplyReceipt($receipt);modelingCheck(genesisModelingResult($buyer['id'],$usdResult)['solution']['answer']==='USD result','USD service receipt failed');

// Permanent Elite+ is admin-owned, survives all plan changes, and prevents creating a charge.
$previousAdmin=genesisFindUserByEmail(genesisAdminEmail());
$admin=$previousAdmin??genesisUpsertGoogleUser(['sub'=>'modeling-admin-'.$suffix,'email'=>genesisAdminEmail(),'email_verified'=>true],[],false,false);
genesisEstablishGoogleSession($admin,$admin['google_sub']);
$privilege=genesisAdminSetForecastPrivilege($admin['id'],$buyer['id'],['enabled'=>true,'expectedRevision'=>0]);
modelingCheck($privilege['forecastElitePlus']&&$privilege['forecastPrivilegeRevision']===1,'Admin grant failed');
// Elite+ is now a combined permanent manual plan; an ordinary expiry cannot end it.
$buyer=genesisFindUser($buyer['id']);$access=genesisResolveFeatureAccess($buyer,genesisFeatureAccessPolicy(),time());
modelingCheck($access['effectivePlan']==='business'&&$access['lifetimePremium']&&in_array('future-modeling',$access['allowedFeatures'],true)&&in_array('future-modeling',$access['freeFeatures'],true),'Elite+ did not survive plan expiry');
$ordinary=genesisResolveFeatureAccess([...$buyer,'forecast_elite_plus'=>0],genesisFeatureAccessPolicy(),time());
modelingCheck(genesisSubscriptionPlanId($buyer)==='elite_plus'&&in_array('physis',$access['allowedFeatures'],true),'Elite+ did not include the lifetime product');
modelingCheck(genesisModelingResult($buyer['id'],$resultId)['solution']['answer']==='Synthetic private solution','Elite+ did not waive payment');
genesisEstablishGoogleSession($buyer,$buyer['google_sub']);
$postCount=count($posts);modelingReject('MODELING_PAYMENT_NOT_REQUIRED',fn()=>genesisModelingCreateOrder($buyer['id'],$input,$settings,$http));
modelingCheck(count($posts)===$postCount,'Elite+ user was sent to checkout');
modelingReject('FORBIDDEN',fn()=>genesisAdminSetForecastPrivilege($buyer['id'],$other['id'],['enabled'=>true,'expectedRevision'=>0]));
genesisEstablishGoogleSession($admin,$admin['google_sub']);
modelingReject('FORECAST_PRIVILEGE_CHANGED',fn()=>genesisAdminSetForecastPrivilege($admin['id'],$buyer['id'],['enabled'=>false,'expectedRevision'=>0]));
genesisAdminSetForecastPrivilege($admin['id'],$buyer['id'],['enabled'=>false,'expectedRevision'=>1]);
genesisUpdateAccountPreferences($buyer['id'],['timeFormat'=>'24h','forecastElitePlus'=>true,'forecast_elite_plus'=>1,'forecastPrivilegeRevision'=>999]);
modelingCheck(!genesisForecastElitePlus(genesisFindUser($buyer['id'])),'A client profile patch granted its own Elite+ privilege');
modelingReject('MODELING_PAYMENT_REQUIRED',fn()=>genesisModelingResult($buyer['id'],$resultId));
modelingCheck((int)$db->query('SELECT COUNT(*) FROM forecast_privilege_events')->fetchColumn()===2,'Privilege audit lost grant/revoke or duplicated a stale mutation');
modelingCheck(genesisModelingResult($buyer['id'],$usdResult)['solution']['answer']==='USD result','Revoking Elite+ removed a separately paid result');

// Additive schema/code rollback: old subscription reads still work; the pre-release backup is readable.
$backup=sys_get_temp_dir().'/genesis-modeling-backup-'.bin2hex(random_bytes(10)).'.sqlite';$db->exec("VACUUM INTO '".str_replace("'","''",$backup)."'");
$check=new PDO('sqlite:'.$backup);modelingCheck((int)$check->query('SELECT COUNT(*) FROM users')->fetchColumn()>=3,'Backup lost owners');
modelingCheck((int)$check->query('SELECT COUNT(*) FROM future_modeling_results')->fetchColumn()===2,'Backup lost immutable results');
modelingCheck($check->query("SELECT subscription_plan FROM users WHERE id=".$check->quote($buyer['id']))->fetchColumn()==='premium4life','Legacy plan projection changed');
$check=null;unlink($backup);
// Deploy runs suites against one synthetic database. Preserve a pre-existing administrator,
// but do not leave this suite's temporary email owner for the following deletion suite.
if($previousAdmin===null)$db->prepare('DELETE FROM users WHERE id=? AND google_sub=?')
    ->execute([$admin['id'],'modeling-admin-'.$suffix]);
echo "Fixed RUB/USD service invoices, no premature checkout, immutable retry, verified receipts/refunds, separate subscriptions, owner/admin checks, permanent Elite+ and backup compatibility passed\n";
