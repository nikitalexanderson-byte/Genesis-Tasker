<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit(1);
require __DIR__.'/../src/resource-limits.php';
require __DIR__.'/../src/billing-lemon-test.php';
function lemonTestCheck(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);}
function lemonTestReject(string $code,callable $action):void{
    try{$action();}catch(GenesisResourceLimitException|DomainException $e){lemonTestCheck($e->getMessage()===$code,'Wrong rejection: '.$e->getMessage());return;}
    throw new RuntimeException('Expected '.$code);
}
$now=strtotime('2026-11-02T00:00:00Z');
$configuration=['enabled'=>true,'test_mode'=>true,'api_key'=>'synthetic-test-key','store_id'=>'42',
    'webhook_secret'=>str_repeat('a',64),'expires_at'=>'2027-05-01T00:00:00Z'];
$event=['meta'=>['event_name'=>'order_created','test_mode'=>true],
    'data'=>['type'=>'orders','id'=>'123','attributes'=>['store_id'=>42,'test_mode'=>true,'user_email'=>'never-persist@example.invalid']]];
$send=static function(array $value,array $config=[])use($configuration,$now):array{
    $raw=json_encode($value,JSON_THROW_ON_ERROR);return genesisBillingLemonTestProof($raw,hash_hmac('sha256',$raw,$configuration['webhook_secret']),$config?:$configuration,$now);
};
$proof=$send($event);lemonTestCheck($proof['signatureVerified']&&$proof['entitlementsChanged']===false,'Test boundary changed access.');
lemonTestCheck(!str_contains(json_encode($proof),'never-persist')&&!str_contains(json_encode($proof),'synthetic-test-key'),'Diagnostic leaked private fields.');
lemonTestCheck($send($event)===$proof,'Replay was not idempotent.');
$refund=$event;$refund['meta']['event_name']='order_refunded';lemonTestCheck($send($refund)['eventName']==='order_refunded','Refund transport rejected.');
$raw=json_encode($event);$signature=hash_hmac('sha256',$raw,$configuration['webhook_secret']);
lemonTestReject('BILLING_SIGNATURE_INVALID',fn()=>genesisBillingLemonTestProof($raw.' ',$signature,$configuration,$now));
lemonTestReject('BILLING_SIGNATURE_INVALID',fn()=>genesisBillingLemonTestProof($raw,str_repeat('0',64),$configuration,$now));
foreach(['enabled','test_mode']as$key)foreach([false,'true',1,null]as$value)
    lemonTestReject('BILLING_TEST_NOT_CONFIGURED',fn()=>$send($event,[...$configuration,$key=>$value]));
lemonTestReject('BILLING_TEST_NOT_CONFIGURED',fn()=>genesisBillingLemonTestProof($raw,$signature,$configuration,strtotime($configuration['expires_at'])));
foreach(['test_mode'=>false,'store_id'=>7]as$key=>$value){$bad=$event;$bad['data']['attributes'][$key]=$value;lemonTestReject('BILLING_TEST_EVENT_INVALID',fn()=>$send($bad));}
$bad=$event;unset($bad['data']['attributes']['test_mode']);lemonTestReject('BILLING_TEST_EVENT_INVALID',fn()=>$send($bad));
$bad=$event;$bad['meta']['test_mode']=false;lemonTestReject('BILLING_TEST_EVENT_INVALID',fn()=>$send($bad));
$bad=$event;$bad['meta']['event_name']='subscription_created';lemonTestReject('BILLING_TEST_EVENT_INVALID',fn()=>$send($bad));
echo "Lemon test webhook checks passed.\n";
