<?php
declare(strict_types=1);
if(getenv('GENESIS_IMPROVEMENTS_TEST')!=='isolated'&&!getenv('GENESIS_SMOKE_ROOT'))throw new RuntimeException('Isolated environment required.');
$billingDeletionCompleted=false;
register_shutdown_function(static function()use(&$billingDeletionCompleted):void{
    if(!$billingDeletionCompleted){fwrite(STDERR,"FAIL billing deletion: suite exited before its final verification marker.\n");exit(1);}
});
require dirname(__DIR__).'/src/bootstrap.php';
// Spy replaces the Google boundary; billing transport is never loaded or called by deletion.
$GLOBALS['billingDeletionRevokes']=[];$GLOBALS['billingDeletionFamily']=[];
function genesisRevokeGoogleToken(array $user): void {$GLOBALS['billingDeletionRevokes'][]=$user['id'];}
function genesisLocalAccountMembers(array $user): array {return $GLOBALS['billingDeletionFamily'][$user['id']]??[];}
require dirname(__DIR__).'/src/repository.php';
require dirname(__DIR__).'/src/billing.php';
function deletionCheck(bool $ok,string $message): void {if(!$ok)throw new RuntimeException($message);}
function deletionUser(string $name,?string $email=null,string $provider='google'): array {
    $id=genesisUuid();$now=genesisNow();
    genesisDb()->prepare('INSERT INTO users(id,google_sub,email,auth_provider,created_at,updated_at) VALUES(?,?,?,?,?,?)')
        ->execute([$id,'deletion-'.$name.'-'.$id,$email??$id.'@example.invalid',$provider,$now,$now]);
    return genesisFindUser($id);
}
function deletionPayment(string $owner,bool $captured): array {
    $id=genesisUuid();$at=genesisNow();$db=genesisDb();
    $db->prepare('INSERT INTO billing_orders(id,user_id,idempotency_key,provider,plan,period_months,amount_minor,currency,product_id,created_at,updated_at,list_amount_minor,upgrade_credit_minor)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')->execute([$id,$owner,$id,'yookassa','premium',1,100,'RUB','synthetic-premium',$at,$at,101,1]);
    if($captured)genesisBillingApplyReceipt($db,new GenesisVerifiedBillingReceipt('yookassa','payment-'.$id,$id,'paid',100,'RUB','synthetic-premium',$at,hash('sha256',$id)),time());
    return ['id'=>$id,'at'=>$at];
}
function deletionClose(array $payment,bool $captured): void {
    genesisBillingApplyReceipt(genesisDb(),new GenesisVerifiedBillingReceipt('yookassa','payment-'.$payment['id'],$payment['id'],$captured?'refunded':'cancelled',100,'RUB','synthetic-premium',$payment['at'],hash('sha256','closed-'.$payment['id']),null,$captured?100:0),time());
}
function deletionFullPricePayment(string $owner,string $provider,bool $checkoutReady): array {
    $id=genesisUuid();$stamp=genesisNow();$currency=$provider==='lemon-squeezy'?'USD':'RUB';$reference='synthetic-payment-'.$id;
    // Age never proves that an external checkout cannot still collect money.
    genesisDb()->prepare('INSERT INTO billing_orders(id,user_id,idempotency_key,provider,plan,period_months,amount_minor,currency,product_id,checkout_url,provider_secret,created_at,updated_at,list_amount_minor,upgrade_credit_minor)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)')->execute([$id,$owner,$id,$provider,'premium',1,100,$currency,'synthetic-premium',
            $checkoutReady?'https://fixture.invalid/checkout/'.$id:null,$checkoutReady?$reference:null,'2000-01-01T00:00:00Z','2000-01-01T00:00:00Z',100]);
    return ['id'=>$id,'at'=>$stamp,'provider'=>$provider,'currency'=>$currency,'reference'=>$reference];
}
/** Synthetic provider proof enters the existing receipt boundary; no closing API is simulated. */
function deletionFullPriceReceipt(array $payment,string $state): void {
    genesisBillingApplyReceipt(genesisDb(),new GenesisVerifiedBillingReceipt($payment['provider'],$payment['reference'],$payment['id'],$state,
        100,$payment['currency'],'synthetic-premium',$payment['at'],hash('sha256',$payment['id'].':'.$state),null,$state==='refunded'?100:0),time());
}
function deletionBlocked(callable $action,string $owner,string $order): void {
    $before=count($GLOBALS['billingDeletionRevokes']);
    $beforeUser=genesisFindUser($owner);$beforeWrites=(int)genesisDb()->query('SELECT total_changes()')->fetchColumn();
    try{$action();throw new LogicException('Deletion removed unresolved money');}
    catch(GenesisResourceLimitException $error){deletionCheck($error->status===409&&$error->getMessage()==='BILLING_SETTLEMENT_REQUIRED','Wrong deletion refusal');}
    deletionCheck(count($GLOBALS['billingDeletionRevokes'])===$before,'Token revocation preceded billing preflight');
    deletionCheck(genesisFindUser($owner)===$beforeUser&&(int)genesisDb()->query('SELECT total_changes()')->fetchColumn()===$beforeWrites,'Blocked deletion changed user/access/blacklist data');
    $q=genesisDb()->prepare('SELECT COUNT(*) FROM billing_orders WHERE id=?');$q->execute([$order]);deletionCheck((int)$q->fetchColumn()===1,'Blocked deletion removed payment');
}
deletionCheck(in_array(parse_url(genesisConfig()['app_url'],PHP_URL_HOST),['127.0.0.1','localhost.invalid'],true),'Isolated configuration required');

// Apply101 to an existing100 database: backup, atomic trigger replacement and old-code backstop.
$legacy=new PDO('sqlite::memory:',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
$legacy->exec("PRAGMA foreign_keys=ON;CREATE TABLE users(id TEXT PRIMARY KEY);CREATE TABLE opaque(body TEXT);INSERT INTO opaque VALUES('encrypted workspace sentinel')");
foreach(['093_billing_infrastructure','096_billing_upgrade_credit','099_billing_refund_amount','100_billing_settlement']as$name)$legacy->exec(file_get_contents(dirname(__DIR__).'/migrations/'.$name.'.sql'));
$existing=[];
foreach(['lemon-squeezy','yookassa']as$provider)foreach([false,true]as$ready){
    $id=$provider.($ready?'-ready':'-inflight');$existing[]=$id;$legacy->prepare('INSERT INTO users(id) VALUES(?)')->execute([$id]);
    $legacy->prepare('INSERT INTO billing_orders(id,user_id,idempotency_key,provider,plan,period_months,amount_minor,currency,product_id,checkout_url,provider_secret,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')->execute([$id,$id,$id,$provider,'premium',1,100,$provider==='lemon-squeezy'?'USD':'RUB','synthetic-product',
            $ready?'https://fixture.invalid/checkout':null,$ready?'synthetic-'.$id:null,'2000-01-01T00:00:00Z','2000-01-01T00:00:00Z']);
}
$beforeOrders=$legacy->query('SELECT * FROM billing_orders ORDER BY id')->fetchAll();
$beforeTables=$legacy->query("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name")->fetchAll();
$oldTrigger=$legacy->query("SELECT sql FROM sqlite_master WHERE name='billing_unsettled_order_delete'")->fetchColumn();
$backupPath=tempnam(sys_get_temp_dir(),'genesis-billing-101-');$backup=null;
try{
    $legacy->exec('VACUUM INTO '.$legacy->quote($backupPath));
    $backup=new PDO('sqlite:'.$backupPath,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    deletionCheck($backup->query('PRAGMA integrity_check')->fetchColumn()==='ok'&&$backup->query('SELECT * FROM billing_orders ORDER BY id')->fetchAll()===$beforeOrders,'Pre101 backup lost pending payment context');
    $migration=(string)file_get_contents(dirname(__DIR__).'/migrations/101_billing_pending_order_deletion_guard.sql');
    $legacy->beginTransaction();
    try{$legacy->exec($migration);$legacy->exec('SELECT * FROM synthetic_missing_table');throw new LogicException('Expected transaction failure');}
    catch(PDOException){$legacy->rollBack();}
    deletionCheck($legacy->query("SELECT sql FROM sqlite_master WHERE name='billing_unsettled_order_delete'")->fetchColumn()===$oldTrigger,'Failed migration lost the old trigger');
    $legacy->beginTransaction();$legacy->exec($migration);$legacy->commit();
    deletionCheck($legacy->query('SELECT * FROM billing_orders ORDER BY id')->fetchAll()===$beforeOrders
        &&$legacy->query("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name")->fetchAll()===$beforeTables
        &&$legacy->query('SELECT body FROM opaque')->fetchColumn()==='encrypted workspace sentinel'
        &&$legacy->query('PRAGMA foreign_key_check')->fetchAll()===[],'Migration101 changed existing orders, schema columns or unrelated data');
    foreach($existing as$id){
        // The previous PHP preflight permits pending0; the migrated SQL guard must still stop it.
        $q=$legacy->prepare("SELECT COUNT(*) FROM billing_orders WHERE user_id=? AND status='pending' AND upgrade_credit_minor>0");$q->execute([$id]);
        deletionCheck((int)$q->fetchColumn()===0,'Legacy rollback fixture unexpectedly protected pending0');
        foreach(['DELETE FROM billing_orders WHERE id=?','DELETE FROM users WHERE id=?']as$sql){
            try{$legacy->prepare($sql)->execute([$id]);throw new LogicException('SQL erased a pending full-price checkout');}
            catch(PDOException $error){deletionCheck(str_contains($error->getMessage(),'BILLING_SETTLEMENT_REQUIRED'),'Wrong direct/cascade deletion refusal');}
        }
        try{genesisBillingAssertAccountDeletable($legacy,$id);throw new LogicException('Ancient/unknown checkout expired by local age');}
        catch(GenesisResourceLimitException $error){deletionCheck($error->getMessage()==='BILLING_SETTLEMENT_REQUIRED','Wrong pending0 preflight refusal');}
    }
    deletionCheck($legacy->query('SELECT * FROM billing_orders ORDER BY id')->fetchAll()===$beforeOrders,'Blocked SQL cascade partially changed recovery data');
    // Existing writers remain schema-compatible; the server-owned terminal status releases the SQL guard.
    $legacy->exec("UPDATE billing_orders SET status='cancelled'");$legacy->exec('DELETE FROM users');
    deletionCheck((int)$legacy->query('SELECT COUNT(*) FROM billing_orders')->fetchColumn()===0
        &&$backup->query('SELECT * FROM billing_orders ORDER BY id')->fetchAll()===$beforeOrders,'Terminal deletion failed or changed the pre101 backup');
}finally{$backup=null;if(is_file($backupPath))unlink($backupPath);}

$admin=deletionUser('admin',genesisConfig()['admin_email']);$_SESSION=['user_id'=>$admin['id'],'auth_identity'=>['kind'=>'primary','sub'=>$admin['google_sub']]];
$cases=0;
foreach([false,true]as$captured)foreach([false,true]as$isAdmin){
    $user=deletionUser('buyer');$payment=deletionPayment($user['id'],$captured);
    $action=$isAdmin?fn()=>genesisAdminDeleteUser($admin['id'],$user['id'],true):fn()=>genesisDeleteAccount($user['id']);
    deletionBlocked($action,$user['id'],$payment['id']);
    deletionCheck(genesisFindUser($user['id'])['subscription_plan']===$user['subscription_plan'],'Blocked admin deletion revoked access');
    deletionClose($payment,$captured);$action();deletionCheck(genesisFindUser($user['id'])===null,'Verified payment closure did not unblock deletion');$cases++;
}
foreach([false,true]as$isAdmin){
    $owner=deletionUser('family-owner',null,'yandex');$member=deletionUser('family-member');$payment=deletionPayment($member['id'],false);
    $GLOBALS['billingDeletionFamily'][$owner['id']]=[['id'=>$owner['id'],'isPrimary'=>true],['id'=>$member['id'],'isPrimary'=>false]];
    $action=$isAdmin?fn()=>genesisAdminDeleteUser($admin['id'],$owner['id'],false):fn()=>genesisDeleteAccount($owner['id']);
    deletionBlocked($action,$member['id'],$payment['id']);deletionCheck(genesisFindUser($owner['id'])!==null,'Family preflight removed owner');
    deletionClose($payment,false);$action();deletionCheck(genesisFindUser($owner['id'])===null&&genesisFindUser($member['id'])===null,'Closed family payment kept deletion blocked');$cases++;
}
foreach(['lemon-squeezy','yookassa']as$provider)foreach([false,true]as$ready)foreach(['self','admin','family-self','family-admin']as$path){
    $family=str_starts_with($path,'family-');$isAdmin=str_ends_with($path,'admin');
    $owner=deletionUser('full-price-owner',null,$family?'yandex':'google');$member=$family?deletionUser('full-price-member'):$owner;
    if($family)$GLOBALS['billingDeletionFamily'][$owner['id']]=[['id'=>$owner['id'],'isPrimary'=>true],['id'=>$member['id'],'isPrimary'=>false]];
    $payment=deletionFullPricePayment($member['id'],$provider,$ready);
    $action=$isAdmin?fn()=>genesisAdminDeleteUser($admin['id'],$owner['id'],true):fn()=>genesisDeleteAccount($owner['id']);
    deletionBlocked($action,$member['id'],$payment['id']);
    deletionCheck(genesisFindUser($owner['id'])===$owner,'Blocked full-price deletion changed primary owner data');
    $q=genesisDb()->prepare('SELECT COUNT(*) FROM billing_receipts WHERE order_id=?');$q->execute([$payment['id']]);
    deletionCheck((int)$q->fetchColumn()===0,'Pending fixture already received its first callback');
    // A second check cannot treat an old timestamp or absent provider reference as unpaid proof.
    deletionBlocked($action,$member['id'],$payment['id']);
    deletionFullPriceReceipt($payment,$isAdmin?'refunded':'cancelled');$action();
    deletionCheck(genesisFindUser($owner['id'])===null&&genesisFindUser($member['id'])===null,'Confirmed full-price closure did not unblock account/family deletion');$cases++;
}
// A first paid callback remains deliverable because blocked deletion retained both owner and order.
foreach(['lemon-squeezy','yookassa']as$provider)foreach([false,true]as$ready){
    $owner=deletionUser('first-paid');$payment=deletionFullPricePayment($owner['id'],$provider,$ready);
    deletionBlocked(fn()=>genesisDeleteAccount($owner['id']),$owner['id'],$payment['id']);
    deletionFullPriceReceipt($payment,'paid');
    $q=genesisDb()->prepare('SELECT state FROM billing_receipts WHERE order_id=?');$q->execute([$payment['id']]);
    deletionCheck($q->fetchColumn()==='paid'&&genesisFindUser($owner['id'])['subscription_plan']==='premium','First paid callback was orphaned instead of credited to its retained owner');
    genesisDeleteAccount($owner['id']);deletionCheck(genesisFindUser($owner['id'])===null,'Confirmed paid fulfilment kept a pending deletion block');$cases++;
}
genesisDeleteAccount($admin['id']);
$billingDeletionCompleted=true;
echo "PASS billing deletion: {$cases} real repository self/admin/family cases, both providers pending0/NULL refs before first callback, ancient unknown stays blocked, paid callback remains deliverable, terminal proof unblocks, migration101 backup/atomic rollback/unchanged data and direct/cascade SQL backstop; no provider I/O or provider-closing implementation.\n";
