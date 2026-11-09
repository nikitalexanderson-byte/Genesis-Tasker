<?php
declare(strict_types=1);
// Standalone synthetic service/SQL tests. Never load configuration or an application database.
if(PHP_SAPI!=='cli')exit(1);
function genesisDb():PDO {return $GLOBALS['trialFixtureDb'];}
function genesisFindUser(string $id):?array {$q=genesisDb()->prepare('SELECT * FROM users WHERE id=?');$q->execute([$id]);return $q->fetch()?:null;}
function genesisUserProvider(array $user):string {return (string)($user['auth_provider']??'google');}
function genesisSessionIsPrimaryGoogleUser(array $user):bool {
    return ($GLOBALS['trialSessionUser']??null)===$user['id'] && ($GLOBALS['trialSessionPrimary']??true)
        && genesisUserProvider($user)==='google' && ($user['google_sub']??'')!=='';
}
function genesisUuid():string {return bin2hex(random_bytes(16));}
function genesisIdentifierHash(string $namespace,string $value):string {return hash_hmac('sha256',$namespace."\0".strtolower(trim($value)),'synthetic-trial-test-key');}
require_once dirname(__DIR__).'/src/feature-access.php';
require_once dirname(__DIR__).'/src/subscription-trials.php';
require_once dirname(__DIR__).'/src/billing.php';

$trialChecks=0;
function trialCheck(bool $ok,string $message):void {
    global $trialChecks;if(!$ok)throw new RuntimeException($message);$trialChecks++;
}
function trialReject(string $code,callable $action):void {
    try{$action();}catch(GenesisResourceLimitException|InvalidArgumentException $error){trialCheck($error->getMessage()===$code,'Expected '.$code.', got '.$error->getMessage());return;}
    throw new RuntimeException('Expected rejection '.$code);
}
function trialSqlReject(PDO $db,string $sql):void {
    try{$db->exec($sql);}catch(PDOException){trialCheck(true,'SQL invariant rejected');return;}
    throw new RuntimeException('SQL accepted invalid trial mutation');
}
function trialConnection(string $path):PDO {
    $db=new PDO('sqlite:'.$path,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    $db->exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=10000');return $db;
}
function trialFixture(string $path=':memory:'):PDO {
    $db=trialConnection($path);
    $db->exec("CREATE TABLE users(id TEXT PRIMARY KEY,google_sub TEXT,email TEXT,auth_provider TEXT,subscription_plan TEXT,subscription_valid_until TEXT);
        CREATE TABLE linked_google_accounts(id TEXT PRIMARY KEY,owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,google_sub TEXT,email TEXT);
        CREATE TABLE resource_quota_limits(name TEXT PRIMARY KEY,amount INTEGER);INSERT INTO resource_quota_limits VALUES('tasks_per_user',100000);
        CREATE TABLE opaque(body TEXT);INSERT INTO opaque VALUES('unchanged encrypted user content');");
    foreach(['093_billing_infrastructure','096_billing_upgrade_credit','099_billing_refund_amount','100_billing_settlement','101_billing_pending_order_deletion_guard','104_subscription_trials','111_forecast_elite_plus']as$migration)
        $db->exec((string)file_get_contents(dirname(__DIR__).'/migrations/'.$migration.'.sql'));
    return $db;
}
function trialUser(PDO $db,string $plan='free',?string $until=null,?string $subject=null,?string $email=null):array {
    $id=genesisUuid();$db->prepare('INSERT INTO users(id,google_sub,email,auth_provider,subscription_plan,subscription_valid_until) VALUES(?,?,?,?,?,?)')->execute([$id,$subject??'synthetic-'.$id,$email??$id.'@example.invalid','google',$plan,$until]);
    return genesisFindUser($id);
}
function trialAs(array $user,bool $primary=true):void {$GLOBALS['trialSessionUser']=$user['id'];$GLOBALS['trialSessionPrimary']=$primary;}
function trialGrant(array $user,string $plan,int $now):array {trialAs($user);return genesisTrialActivate($user['id'],['plan'=>$plan],$now);}
function trialBillingRows(PDO $db):array {
    $out=[];foreach(['billing_orders','billing_receipts','billing_periods','billing_upgrade_credits','billing_lifetime_seats','subscription_access_state']as$table)
        $out[$table]=$db->query('SELECT * FROM '.$table.' ORDER BY rowid')->fetchAll();
    return $out;
}

if(($argv[1]??'')==='--race-worker') {
    $GLOBALS['trialFixtureDb']=trialConnection($argv[2]);$user=genesisFindUser($argv[3]);trialAs($user);
    $deadline=microtime(true)+15;while(!is_file($argv[5])){if(microtime(true)>$deadline)exit(43);usleep(10000);}
    try{$result=genesisTrialActivate($user['id'],['plan'=>$argv[4]]);echo json_encode($result,JSON_THROW_ON_ERROR);exit(0);}
    catch(GenesisResourceLimitException $error){if($error->getMessage()==='TRIAL_ALREADY_USED')exit(42);throw $error;}
}

$db=trialFixture();$GLOBALS['trialFixtureDb']=$db;$now=strtotime('2030-03-30T12:34:56Z');$policy=genesisFeatureAccessPolicy();
trialCheck(genesisTrialDefinition()===['schemaVersion'=>1,'durationSeconds'=>259200,'maxActivationsPerAccount'=>1,
    'plans'=>['standart'=>'Trial-Standart','premium'=>'Trial-Premium','business'=>'Trial-Business'],'automaticCharge'=>false],'Trial policy changed');

// Strict selection and authenticated owner. No body field can choose another identity or clock.
$free=trialUser($db);trialAs($free);
foreach([[],['plan'=>'free'],['plan'=>'premium4life'],['plan'=>'elite'],['plan'=>'standard'],['plan'=>'Premium'],['plan'=>true],
    ['plan'=>'premium','userId'=>'other'],['plan'=>'premium','startsAt'=>'2000-01-01T00:00:00Z'],['plan'=>'premium','durationSeconds'=>999999]]as$bad)
    trialReject('TRIAL_REQUEST_INVALID',fn()=>genesisTrialActivate($free['id'],$bad,$now));
$beforeClaims=(int)$db->query('SELECT COUNT(*) FROM subscription_trial_claims')->fetchColumn();
trialAs($free,false);trialReject('TRIAL_PRIMARY_GOOGLE_REQUIRED',fn()=>genesisTrialActivate($free['id'],['plan'=>'premium'],$now));
$other=trialUser($db);trialAs($other);trialReject('TRIAL_PRIMARY_GOOGLE_REQUIRED',fn()=>genesisTrialActivate($free['id'],['plan'=>'premium'],$now));
$db->prepare("UPDATE users SET auth_provider='yandex' WHERE id=?")->execute([$other['id']]);$other=genesisFindUser($other['id']);trialAs($other);
trialReject('TRIAL_PRIMARY_GOOGLE_REQUIRED',fn()=>genesisTrialActivate($other['id'],['plan'=>'premium'],$now));
trialCheck((int)$db->query('SELECT COUNT(*) FROM subscription_trial_claims')->fetchColumn()===$beforeClaims,'Denied requests consumed trial');

// Each allowed tier, exact72hours across DST/month boundary, immutable replay/window and fallback.
foreach(GENESIS_TRIAL_LABELS as$plan=>$label) {
    $user=trialUser($db);trialAs($user);$available=genesisTrialStateForUser($user,$now);
    trialCheck($available['status']==='available'&&$available['eligiblePlans']===['standart','premium','business'],'Free trial choices wrong');
    $granted=trialGrant($user,$plan,$now);$trial=$granted['trial'];$access=$granted['featureAccess'];
    trialCheck($trial['label']===$label&&$trial['plan']===$plan&&$trial['status']==='active','Wrong exact trial label');
    trialCheck(strtotime($trial['endsAt'])-strtotime($trial['startsAt'])===259200&&$trial['startsAt']===gmdate('Y-m-d\TH:i:s\Z',$now),'Not a server-owned72hour window');
    $expected=genesisResolveFeatureAccess(['subscription_plan'=>$plan,'subscription_valid_until'=>$trial['endsAt']],$policy,$now);
    trialCheck($access['source']==='trial'&&$access['effectivePlan']===$plan&&$access['declaredPlan']==='free'
        &&$access['allowedFeatures']===$expected['allowedFeatures']&&$access['limits']===$expected['limits'],'Trial did not use canonical tier policy');
    trialCheck($access['paidAccess']['effectivePlan']==='free'&&genesisFindUser($user['id'])['subscription_plan']==='free','Trial mutated paid plan');
    trialCheck(genesisTrialSnapshotForUser($user,$now-1)['featureAccess']['source']==='subscription','Future grant activated early');
    trialCheck(genesisTrialSnapshotForUser($user,$now+259199)['featureAccess']['source']==='trial','Trial ended early');
    $expired=genesisTrialSnapshotForUser($user,$now+259200);
    trialCheck($expired['trial']['status']==='expired'&&$expired['featureAccess']['source']==='subscription'
        &&$expired['featureAccess']['effectivePlan']==='free','Exact expiry retained paid rights');
    $retry=genesisTrialActivate($user['id'],['plan'=>$plan],$now+999999);
    trialCheck($retry['trial']['startsAt']===$trial['startsAt']&&$retry['trial']['endsAt']===$trial['endsAt']&&$retry['trial']['status']==='expired','Replay extended or switched trial');
    $different=$plan==='business'?'premium':'business';trialReject('TRIAL_ALREADY_USED',fn()=>genesisTrialActivate($user['id'],['plan'=>$different],$now+10));
    trialSqlReject($db,"UPDATE subscription_trials SET ends_at=ends_at+1 WHERE user_id='".$user['id']."'");
    $changedPlan=$plan==='business'?'premium':'business';
    trialSqlReject($db,"UPDATE subscription_trials SET plan='".$changedPlan."' WHERE user_id='".$user['id']."'");
}

// Never downgrade or waste paid subscription; preserve it when the trial expires.
foreach(['standart'=>['premium','business'],'premium'=>['business'],'business'=>[],'premium4life'=>[]]as$paidPlan=>$eligible) {
    $user=trialUser($db,$paidPlan,gmdate('Y-m-d\TH:i:s\Z',$now+400000));trialAs($user);
    trialCheck(genesisTrialStateForUser($user,$now)['eligiblePlans']===$eligible,'Wrong paid-tier eligibility');
    foreach(GENESIS_TRIAL_LABELS as$plan=>$label)if(!in_array($plan,$eligible,true))trialReject('TRIAL_NOT_AN_UPGRADE',fn()=>genesisTrialActivate($user['id'],['plan'=>$plan],$now));
    if($eligible===[])continue;
    trialGrant($user,'business',$now);$fallback=genesisTrialSnapshotForUser($user,$now+259200)['featureAccess'];
    trialCheck($fallback['effectivePlan']===$paidPlan&&$fallback['source']==='subscription','Expiry removed existing paid plan');
    $endsDuringTrial=[...$user,'subscription_valid_until'=>gmdate('Y-m-d\TH:i:s\Z',$now+10)];
    trialCheck(genesisTrialSnapshotForUser($endsDuringTrial,$now+259200)['featureAccess']['effectivePlan']==='free','Expired paid fallback revived');
    $purchased=[...$user,'subscription_plan'=>'premium4life','subscription_valid_until'=>null];
    trialCheck(genesisTrialSnapshotForUser($purchased,$now+100)['featureAccess']['lifetimePremium']===true,'Trial hid a new lifetime purchase');
    $equalPurchase=[...$user,'subscription_plan'=>'business'];
    trialCheck(genesisTrialSnapshotForUser($equalPurchase,$now+100)['featureAccess']['source']==='subscription','Equal paid tier was hidden by trial');
}

// Identity tombstones persist after deletion and Gmail aliases cannot renew a trial.
$identity=trialUser($db,subject:'permanent-google-sub',email:'f.irst+trial@googlemail.com');trialGrant($identity,'premium',$now);
$db->prepare('DELETE FROM users WHERE id=?')->execute([$identity['id']]);
$sameSub=trialUser($db,subject:'permanent-google-sub',email:'changed@example.invalid');trialAs($sameSub);
trialReject('TRIAL_ALREADY_USED',fn()=>genesisTrialActivate($sameSub['id'],['plan'=>'business'],$now+10));
$alias=trialUser($db,subject:'different-subject',email:'first@gmail.com');trialAs($alias);
trialReject('TRIAL_ALREADY_USED',fn()=>genesisTrialActivate($alias['id'],['plan'=>'business'],$now+10));
trialCheck(genesisTrialStateForUser($alias,$now+10)['status']==='used','Deletion restored eligibility');
$distinct=trialUser($db);trialAs($distinct);trialCheck(genesisTrialStateForUser($distinct,$now)['status']==='available','Independent verified identity incorrectly conflated');

// Link/unlink preserve used identity and propagate prior use to a previously unused owner.
$owner=trialUser($db);trialGrant($owner,'business',$now);$linked=['id'=>genesisUuid(),'google_sub'=>'new-linked-sub','email'=>'linked@example.invalid'];
genesisBeginWriteTransaction($db);genesisTrialPreserveIdentityClaims($db,$owner,$linked);
$db->prepare('INSERT INTO linked_google_accounts VALUES(?,?,?,?)')->execute([$linked['id'],$owner['id'],$linked['google_sub'],$linked['email']]);
$db->commit();
$linkedSessionSnapshot=genesisTrialSnapshotForUser($owner,$now+1);trialAs($owner,false);
trialCheck($linkedSessionSnapshot['featureAccess']['effectivePlan']==='business','Linked session lost owner rights');
trialReject('TRIAL_PRIMARY_GOOGLE_REQUIRED',fn()=>genesisTrialActivate($owner['id'],['plan'=>'business'],$now+1));
genesisBeginWriteTransaction($db);genesisTrialPreserveIdentityClaims($db,$owner,$linked);$db->prepare('DELETE FROM linked_google_accounts WHERE id=?')->execute([$linked['id']]);$db->commit();
$standalone=trialUser($db,subject:$linked['google_sub'],email:$linked['email']);trialAs($standalone);
trialReject('TRIAL_ALREADY_USED',fn()=>genesisTrialActivate($standalone['id'],['plan'=>'premium'],$now+10));
$unusedOwner=trialUser($db);genesisBeginWriteTransaction($db);genesisTrialPreserveIdentityClaims($db,$unusedOwner,$linked);$db->commit();trialAs($unusedOwner);
trialReject('TRIAL_ALREADY_USED',fn()=>genesisTrialActivate($unusedOwner['id'],['plan'=>'premium'],$now+10));
$prelinkedOwner=trialUser($db);$prelinked=['id'=>genesisUuid(),'google_sub'=>'before-activation-link','email'=>'before-activation@example.invalid'];
$db->prepare('INSERT INTO linked_google_accounts VALUES(?,?,?,?)')->execute([$prelinked['id'],$prelinkedOwner['id'],$prelinked['google_sub'],$prelinked['email']]);
trialGrant($prelinkedOwner,'premium',$now);$db->prepare('DELETE FROM linked_google_accounts WHERE id=?')->execute([$prelinked['id']]);
$prelinkedStandalone=trialUser($db,subject:$prelinked['google_sub'],email:$prelinked['email']);trialAs($prelinkedStandalone);
trialReject('TRIAL_ALREADY_USED',fn()=>genesisTrialActivate($prelinkedStandalone['id'],['plan'=>'business'],$now+1));

// Moderation resets access immediately but never return trial or lifetime seats to the pool.
trialAs($owner);$beforeModerationClaims=(int)$db->query('SELECT COUNT(*) FROM subscription_trial_claims')->fetchColumn();
genesisSubscriptionRevoke($db,$owner,gmdate('Y-m-d\TH:i:s\Z',$now+20));
$revoked=genesisTrialSnapshotForUser(genesisFindUser($owner['id']),$now+20);
trialCheck($revoked['trial']['status']==='revoked'&&$revoked['featureAccess']['effectivePlan']==='free','Moderation left trial active');
trialCheck((int)$db->query('SELECT COUNT(*) FROM subscription_trial_claims')->fetchColumn()===$beforeModerationClaims,'Reset changed identity claims');
trialCheck(genesisTrialActivate($owner['id'],['plan'=>'business'],$now+21)['trial']['status']==='revoked','Replay restored revoked grant');
$moderated=trialUser($db);genesisSubscriptionRevoke($db,$moderated,gmdate('Y-m-d\TH:i:s\Z',$now));trialAs($moderated);
trialReject('TRIAL_ACCESS_REVOKED',fn()=>genesisTrialActivate($moderated['id'],['plan'=>'business'],$now+1));

// SQL and exception atomicity: no partial grant or identity reservation after injected failure.
$atomic=trialUser($db);trialAs($atomic);$atomicEmail=genesisSubscriptionIdentityHashes($atomic)[1];
$db->exec("CREATE TRIGGER synthetic_trial_claim_failure BEFORE INSERT ON subscription_trial_claims WHEN NEW.identity_hash='".$atomicEmail."' BEGIN SELECT RAISE(ABORT,'synthetic_trial_failure');END");
try{genesisTrialActivate($atomic['id'],['plan'=>'premium'],$now);throw new RuntimeException('Injected claim failure ignored');}catch(PDOException){}
$db->exec('DROP TRIGGER synthetic_trial_claim_failure');
trialCheck(genesisTrialRow($db,$atomic['id'])===null&&genesisTrialClaims($db,genesisTrialIdentityHashes($db,$atomic))===[],'Failed activation was not atomic');
trialGrant($atomic,'premium',$now);$row=genesisTrialRow($db,$atomic['id']);
trialSqlReject($db,"UPDATE subscription_trials SET starts_at=starts_at+1,ends_at=ends_at+1 WHERE user_id='".$atomic['id']."'");
trialSqlReject($db,"DELETE FROM subscription_trial_claims WHERE grant_id='".$row['grant_id']."'");
trialSqlReject($db,"UPDATE subscription_trial_claims SET used_at=used_at+1 WHERE grant_id='".$row['grant_id']."'");
$broken=trialUser($db);$db->prepare('INSERT INTO subscription_trials(user_id,grant_id,plan,starts_at,ends_at) VALUES(?,?,?,?,?)')
    ->execute([$broken['id'],'synthetic-missing-claim','business',$now,$now+259200]);
trialReject('TRIAL_STATE_UNAVAILABLE',fn()=>genesisTrialSnapshotForUser($broken,$now));
$db->prepare('DELETE FROM users WHERE id=?')->execute([$broken['id']]);

// The additive migration is atomic and preserves existing data; local restore uses a real backup.
$legacy=new SQLite3(':memory:');$legacy->exec("CREATE TABLE users(id TEXT PRIMARY KEY,subscription_plan TEXT);INSERT INTO users VALUES('legacy','premium4life');CREATE TABLE opaque(body TEXT);INSERT INTO opaque VALUES('legacy encrypted sentinel')");
$backup=new SQLite3(':memory:');trialCheck($legacy->backup($backup),'Local pre-migration backup failed');
$migration=(string)file_get_contents(dirname(__DIR__).'/migrations/104_subscription_trials.sql');
$legacy->exec('BEGIN');$legacy->exec($migration);$legacy->exec('ROLLBACK');
trialCheck((int)$legacy->querySingle("SELECT COUNT(*) FROM sqlite_master WHERE name='subscription_trials'")===0,'Failed migration rollback left partial schema');
trialCheck($legacy->exec($migration)&&$legacy->querySingle("SELECT subscription_plan FROM users WHERE id='legacy'")==='premium4life'
    &&$legacy->querySingle('SELECT body FROM opaque')==='legacy encrypted sentinel','Migration changed paid access/content');
$restored=new SQLite3(':memory:');trialCheck($backup->backup($restored)&&$restored->querySingle('SELECT body FROM opaque')==='legacy encrypted sentinel'
    &&(int)$restored->querySingle("SELECT COUNT(*) FROM sqlite_master WHERE name='subscription_trials'")===0,'Local backup restore failed');

// Actual paid receipt/upgrade-credit algorithm must see only the paid plan during an overlay.
$buyer=trialUser($db);$confirmed=gmdate('Y-m-d\TH:i:s\Z',$now-86400);
$db->prepare('INSERT INTO billing_orders(id,user_id,idempotency_key,provider,plan,period_months,amount_minor,currency,product_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    ->execute(['paid-source',$buyer['id'],'paid-source-key','yookassa','standart',1,33300,'RUB','standart-source',$confirmed,$confirmed]);
$receipt=new GenesisVerifiedBillingReceipt('yookassa','synthetic-paid-reference','paid-source','paid',33300,'RUB','standart-source',$confirmed,hash('sha256','synthetic-paid-evidence'));
genesisBillingApplyReceipt($db,$receipt,$now);$buyer=genesisFindUser($buyer['id']);
$offer=null;foreach(genesisBillingCatalog([])['offers']as$candidate)if($candidate['id']==='premium:1')$offer=[...$candidate,'availableProviders'=>['yookassa'],'creditCheckoutEnabled'=>true];
$beforeQuote=genesisBillingUpgradeQuote($db,$buyer['id'],$offer,$now);$beforeBilling=trialBillingRows($db);
trialGrant($buyer,'business',$now);$afterQuote=genesisBillingUpgradeQuote($db,$buyer['id'],$offer,$now);
trialCheck($beforeQuote===$afterQuote&&$afterQuote['currentPlan']==='standart'&&$afterQuote['creditMinor']>0,'Trial altered monetary upgrade credit');
trialCheck(trialBillingRows($db)===$beforeBilling&&genesisFindUser($buyer['id'])['subscription_plan']==='standart','Trial wrote billing evidence/paid materialization');

// The real owner-wide quota helper uses the owner's trial, regardless of acting member.
$db->exec("CREATE TABLE resource_space_owners(space_id TEXT PRIMARY KEY,user_id TEXT);CREATE TABLE shared_projects(id TEXT PRIMARY KEY,space_id TEXT,parent_id TEXT,is_inbox INTEGER,kind TEXT)");
$quotaOwner=trialUser($db);trialGrant($quotaOwner,'business',time());$member=trialUser($db);trialAs($member);
$db->prepare('INSERT INTO resource_space_owners VALUES(?,?)')->execute(['trial-space',$quotaOwner['id']]);
for($i=0;$i<100;$i++)$db->prepare("INSERT INTO shared_projects VALUES(?,?,NULL,0,'project')")->execute(['root-'.$i,'trial-space']);
for($i=0;$i<150;$i++)$db->prepare("INSERT INTO shared_projects VALUES(?,?,'root-0',0,'project')")->execute(['child-'.$i,'trial-space']);
$usage=genesisSharedOwnerResourceUsage('trial-space','shared-projects');
trialCheck($usage['owner']===$quotaOwner['id']&&$usage['count']===100&&$usage['limit']===100,'Trial shared pool used member or counted nested projects');
trialReject('SUBSCRIPTION_QUOTA_shared-projects',fn()=>genesisRequireSharedOwnerQuota('trial-space','shared-projects'));
trialCheck(!in_array('shared-projects',genesisFeatureAccessForUser($member)['allowedFeatures'],true),'Owner trial leaked into member own account');
trialCheck($db->query('SELECT body FROM opaque')->fetchColumn()==='unchanged encrypted user content','Trial deleted existing data');
$public=json_encode(genesisTrialSnapshotForUser($quotaOwner,time()),JSON_THROW_ON_ERROR);
foreach(['identity_hash','grant_id','synthetic-trial-test-key','purchaseToken']as$private)trialCheck(!str_contains($public,$private),'Public metadata exposed '.$private);

// Two processes/DB connections race on different tiers; exactly one may consume the account.
$directory=sys_get_temp_dir().'/genesis-trial-race-'.bin2hex(random_bytes(8));trialCheck(mkdir($directory,0700),'Cannot create owned race fixture');
$workers=[];$racePath=$directory.'/fixture.sqlite';$gate=$directory.'/go';$savedDb=$db;
try {
    $raceDb=trialFixture($racePath);$GLOBALS['trialFixtureDb']=$raceDb;$racer=trialUser($raceDb);
    foreach(['premium','business']as$plan) {
        $command=[PHP_BINARY];if(($ini=php_ini_loaded_file())!==false)array_push($command,'-c',$ini);
        array_push($command,__FILE__,'--race-worker',$racePath,$racer['id'],$plan,$gate);
        $process=proc_open($command,[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes,dirname(__DIR__,2));
        trialCheck(is_resource($process),'Cannot start trial race worker');fclose($pipes[0]);$workers[]=[$process,$pipes];
    }
    touch($gate);$codes=[];
    foreach($workers as[$process,$pipes]) {
        $out=stream_get_contents($pipes[1]);$err=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);$code=proc_close($process);$codes[]=$code;
        trialCheck(in_array($code,[0,42],true),'Unexpected trial race result '.$code.' '.$err);
        if($code===0)trialCheck(json_decode($out,true,32,JSON_THROW_ON_ERROR)['trial']['status']==='active','Race winner lacks grant');
    }
    $workers=[];sort($codes);
    trialCheck($codes===[0,42]&&(int)$raceDb->query('SELECT COUNT(*) FROM subscription_trials')->fetchColumn()===1,'Parallel activations both won');
    trialCheck((int)$raceDb->query('SELECT COUNT(*) FROM subscription_trial_claims')->fetchColumn()===2,'Race left partial/duplicate identities');
} finally {
    foreach($workers as[$process,$pipes]){foreach([1,2]as$p)if(is_resource($pipes[$p]))fclose($pipes[$p]);proc_terminate($process);proc_close($process);}
    $raceDb=null;$GLOBALS['trialFixtureDb']=$savedDb;
    foreach([$gate,$racePath.'-wal',$racePath.'-shm',$racePath]as$file)if(is_file($file))unlink($file);
    if(is_dir($directory))rmdir($directory);
}
echo 'PASS subscription trials: '.$trialChecks." assertions; exact72hours, one use, replay/race/reset/deletion/aliases/links, paid-credit neutrality and owner quota isolation.\n";
