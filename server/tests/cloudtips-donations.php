<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli'||getenv('GENESIS_IMPROVEMENTS_TEST')!=='isolated')throw new RuntimeException('Isolated CLI required.');
$root=sys_get_temp_dir().'/genesis-cloudtips-test-'.bin2hex(random_bytes(8));
mkdir($root,0700);mkdir($root.'/sessions',0700);
$config=['app_url'=>'https://localhost.invalid','db_path'=>$root.'/synthetic.sqlite','session_path'=>$root.'/sessions',
    'crypto_key'=>base64_encode(random_bytes(32)),'admin_email'=>'qa-admin@example.invalid','timezone'=>'UTC',
    'account_retention'=>['enabled'=>true],
    // Synthetic 12-character secret, matching the provider's documented generation rule.
    'cloudtips'=>['layout_id'=>'4d58d20a','webhook_secret'=>'TestTips42!?','history_reconciled'=>true]];
file_put_contents($root.'/config.php','<?php return '.var_export($config,true).';');
define('GENESIS_LOCAL_TEST_CONFIG',$root.'/config.php');
require dirname(__DIR__).'/src/bootstrap.php';
require dirname(__DIR__).'/src/repository.php';
function tipsCheck(bool $value,string $message):void {if(!$value)throw new RuntimeException($message);}
function tipsReject(callable $action,string $code,int $status=400):void {
    try{$action();throw new LogicException('Webhook accepted invalid evidence');}
    catch(GenesisResourceLimitException $error){tipsCheck($error->getMessage()===$code&&$error->status===$status,'Unexpected webhook rejection');}
}
function tipsBody(array $fields):string {return http_build_query($fields,'','&',PHP_QUERY_RFC3986);}
function tipsSend(string $body,?string $signature=null,string $type='application/x-www-form-urlencoded'):array {
    return genesisCloudTipsWebhook($body,$signature??base64_encode(hash_hmac('sha256',$body,'TestTips42!?',true)),$type);
}
$db=genesisDb();$now=genesisNow();
tipsCheck(strlen(genesisCloudTipsSettings()['secret'])===12&&genesisCloudTipsSettings()['ready'],'Documented 12-character provider secret rejected');
foreach(['donor','peer']as$id)$db->prepare('INSERT INTO users(id,google_sub,email,created_at,updated_at) VALUES(?,?,?,?,?)')
    ->execute([$id,'synthetic-'.$id,$id.'@example.invalid',$now,$now]);
tipsCheck(genesisCloudTipsDeletionReady(),'Configured and reconciled policy not available');
$link=genesisCloudTipsCheckout('donor');parse_str((string)parse_url($link['url'],PHP_URL_QUERY),$query);
tipsCheck($link['tracked']===true&&isset($query['invoiceid'])&&parse_url($link['url'],PHP_URL_HOST)==='pay.cloudtips.ru','Opaque checkout missing');
tipsCheck(genesisCloudTipsCheckout('donor')['url']===$link['url'],'Repeated click duplicated checkout');
tipsCheck(!str_contains($link['url'],'donor')&&!str_contains($link['url'],'example.invalid'),'Checkout disclosed an account identifier');
tipsCheck(genesisCloudTipsPendingDonation($db,'donor',time())&&!genesisCloudTipsHasDonation($db,'donor'),'Opening checkout fabricated payment');
$fields=['success'=>'True','layoutid'=>'4d58d20a','amount'=>'53.8','payerfee'=>'3.8','currency'=>'RUB',
    'invoiceid'=>$query['invoiceid'],'transactionid'=>'synthetic-tips-1','createddate'=>str_replace('Z','.4490000Z',$now),
    'ipaddress'=>'192.0.2.1','cardtype'=>'Synthetic','name'=>'Synthetic private sender'];
$body=tipsBody($fields);
tipsReject(fn()=>tipsSend($body,base64_encode(str_repeat('x',32))),'CLOUDTIPS_INVALID_SIGNATURE',403);
tipsReject(fn()=>tipsSend($body,base64_encode(hash_hmac('sha256',$body.'x','TestTips42!?',true))),'CLOUDTIPS_INVALID_SIGNATURE',403);
tipsCheck(!genesisCloudTipsHasDonation($db,'donor'),'Invalid signature protected an account');
tipsCheck(tipsSend($body)===['code'=>0]&&tipsSend($body)===['code'=>0],'Retry is not idempotent');
tipsCheck(genesisCloudTipsHasDonation($db,'donor')&&!genesisCloudTipsHasDonation($db,'peer'),'Donor crossed account boundary');
tipsCheck(!genesisCloudTipsPendingDonation($db,'donor',time()),'Verified donation left intent pending');
$row=$db->query('SELECT * FROM donation_receipts')->fetch();
tipsCheck((int)$row['amount_minor']===5380&&$row['currency']==='RUB'&&$row['paid_at']===$now,'Money/date precision changed');
tipsCheck(!str_contains(json_encode($row),'192.0.2.1')&&!str_contains(json_encode($row),'private sender'),'Webhook retained unnecessary personal data');
// Equivalent decoded form values must not permit signing a rewritten body.
$unicodeFields=[...$fields,'transactionid'=>'synthetic-tips-utf8','name'=>'Синтетический донор + ☀'];
$unicodeForm=http_build_query($unicodeFields,'','&',PHP_QUERY_RFC1738);
$rewrittenSignature=base64_encode(hash_hmac('sha256',tipsBody($unicodeFields),'TestTips42!?',true));
tipsCheck($unicodeForm!==tipsBody($unicodeFields),'UTF-8 form fixture lost its space-encoding distinction');
tipsReject(fn()=>tipsSend($unicodeForm,$rewrittenSignature),'CLOUDTIPS_INVALID_SIGNATURE',403);
tipsCheck(json_encode(tipsSend($unicodeForm,null,'application/x-www-form-urlencoded; charset=UTF-8'))==='{"code":0}','Signed UTF-8 form did not return the documented JSON code');
$rawUnicodeForm=str_replace(urlencode($unicodeFields['name']),'Синтетический+донор+%2B+☀',$unicodeForm);
tipsCheck(str_contains($rawUnicodeForm,'Синтетический')&&preg_match('//u',$rawUnicodeForm)===1,'Raw UTF-8 fixture is not UTF-8');
tipsReject(fn()=>tipsSend($rawUnicodeForm,base64_encode(hash_hmac('sha256',$unicodeForm,'TestTips42!?',true))),'CLOUDTIPS_INVALID_SIGNATURE',403);
tipsCheck(tipsSend($rawUnicodeForm)===['code'=>0],'Exact raw UTF-8 bytes failed verification or idempotent response');
$unicodeReceipt=$db->query("SELECT * FROM donation_receipts WHERE transaction_hash='".hash('sha256','cloudtips:synthetic-tips-utf8')."'")->fetch();
tipsCheck($unicodeReceipt&&$unicodeReceipt['user_id']==='donor'&&!str_contains(json_encode($unicodeReceipt,JSON_UNESCAPED_UNICODE),'Синтетический'),'UTF-8 evidence lost account association or retained sender data');
tipsReject(fn()=>tipsSend(tipsBody([...$fields,'amount'=>'53.81'])),'CLOUDTIPS_RECEIPT_CONFLICT',409);
$peer=genesisCloudTipsCheckout('peer');parse_str((string)parse_url($peer['url'],PHP_URL_QUERY),$peerQuery);
tipsReject(fn()=>tipsSend(tipsBody([...$fields,'invoiceid'=>$peerQuery['invoiceid']])),'CLOUDTIPS_RECEIPT_CONFLICT',409);
tipsCheck(!genesisCloudTipsHasDonation($db,'peer'),'Replay reassigned a paid receipt');
foreach(['0','0.00','-1','1e3','1.001','NaN','1,50','1000000000']as$amount)
    tipsReject(fn()=>tipsSend(tipsBody([...$fields,'amount'=>$amount,'transactionid'=>'invalid-'.$amount])),$amount==='0'||$amount==='0.00'?'CLOUDTIPS_INVALID_PAYLOAD':'CLOUDTIPS_INVALID_AMOUNT');
tipsReject(fn()=>tipsSend(tipsBody([...$fields,'layoutid'=>'wronglayout'])),'CLOUDTIPS_WRONG_LAYOUT');
tipsReject(fn()=>tipsSend(tipsBody([...$fields,'currency'=>'USD'])),'CLOUDTIPS_INVALID_PAYLOAD');
tipsReject(fn()=>tipsSend(tipsBody([...$fields,'createddate'=>'2026-02-30T10:00:00Z'])),'CLOUDTIPS_INVALID_DATE');
tipsReject(fn()=>tipsSend(tipsBody([...$fields,'createddate'=>gmdate('Y-m-d\TH:i:s\Z',time()+86400)])),'CLOUDTIPS_INVALID_DATE');
tipsReject(fn()=>tipsSend($body.'&success=False'),'CLOUDTIPS_INVALID_PAYLOAD');
tipsReject(fn()=>tipsSend($body.'&invoiceid%5B%5D=bad'),'CLOUDTIPS_INVALID_PAYLOAD');
tipsReject(fn()=>tipsSend($body,null,'application/json'),'CLOUDTIPS_INVALID_PAYLOAD');
tipsCheck(tipsSend(tipsBody([...$fields,'success'=>'False','invoiceid'=>$peerQuery['invoiceid'],'transactionid'=>'failed']))===['code'=>0]
    &&!genesisCloudTipsHasDonation($db,'peer'),'Failed donation counted');
tipsCheck(tipsSend(tipsBody([...$fields,'invoiceid'=>'','transactionid'=>'anonymous']))===['code'=>0]
    &&(int)$db->query('SELECT COUNT(*) FROM donation_receipts WHERE user_id IS NULL')->fetchColumn()===1,'Anonymous donation was assigned by guess');
tipsCheck(!genesisCloudTipsDeletionReady(),'New unmatched donation left automatic deletion enabled');
tipsCheck(tipsSend(tipsBody([...$fields,'invoiceid'=>'00000000-0000-0000-0000-000000000000','transactionid'=>'unknown-invoice']))===['code'=>0]
    &&(int)$db->query('SELECT COUNT(*) FROM donation_receipts WHERE user_id IS NULL')->fetchColumn()===2
    &&!genesisCloudTipsDeletionReady(),'Unknown invoice failed to pause automatic deletion');
$db->prepare("UPDATE donation_intents SET created_at=? WHERE user_id='peer'")->execute([gmdate('Y-m-d\TH:i:s\Z',time()-8*86400)]);
tipsCheck(!genesisCloudTipsPendingDonation($db,'peer',time()),'Abandoned checkout preserved account indefinitely');
$db->exec("DELETE FROM users WHERE id='donor'");
tipsCheck((int)$db->query("SELECT COUNT(*) FROM donation_receipts WHERE user_id='donor'")->fetchColumn()===0,'Explicit deletion retained identified donation data');
tipsCheck($db->query('PRAGMA foreign_key_check')->fetchAll()===[],'Donation foreign keys broken');
echo "PASS CloudTips: documented 12-character secret and JSON code; authenticated opaque invoice; exact-byte UTF-8/form HMAC; amount/date/layout validation; idempotency and conflict isolation; no fabricated donor; unmatched receipts block deletion; failed callbacks; pending grace; cascade privacy.\n";
