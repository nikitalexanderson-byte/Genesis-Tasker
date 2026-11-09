<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit(1);
$fixture=sys_get_temp_dir().'/genesis-retention-test-'.bin2hex(random_bytes(8));mkdir($fixture,0700);mkdir($fixture.'/sessions',0700);
$mode=getenv('GENESIS_RETENTION_TEST_MODE')?:'ready';
$config=['app_url'=>'https://localhost.invalid','db_path'=>$fixture.'/genesis.sqlite','session_path'=>$fixture.'/sessions','crypto_key'=>base64_encode(random_bytes(32)),
    'cookie_secure'=>false,'timezone'=>'UTC','admin_email'=>'admin@example.invalid','notifications'=>['email'=>['transport'=>'disabled']],
    'account_retention'=>['enabled'=>true],'cloudtips'=>['layout_id'=>'synthetic-retention','webhook_secret'=>'synthetic-fixture-secret-only','history_reconciled'=>$mode!=='unready']];
file_put_contents($fixture.'/config.php','<?php return '.var_export($config,true).';');define('GENESIS_LOCAL_TEST_CONFIG',$fixture.'/config.php');
foreach(['bootstrap','repository','shared-projects']as$module)require_once dirname(__DIR__).'/src/'.$module.'.php';
$GLOBALS['retentionRevoked']=[];
function genesisRevokeGoogleToken(array $user): void
{
    if(genesisDb()->inTransaction())throw new LogicException('Token revocation held the SQLite writer');
    $GLOBALS['retentionRevoked'][]=$user['id'];
}
function retentionExpect(bool $ok,string $reason): void {if(!$ok)throw new RuntimeException($reason);}
function retentionUser(string $name,string $created='2025-01-01T00:00:00Z',string $last='2026-07-31T12:34:56Z',bool $returned=true,string $plan='free',?string $email=null): string
{
    $id=genesisUuid();$db=genesisDb();$now=genesisNow();
    $db->prepare('INSERT INTO users(id,google_sub,email,created_at,updated_at,subscription_plan,login_count,last_login_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?)')
        ->execute([$id,'retention-'.$name.'-'.$id,$email??$name.'-'.$id.'@example.invalid',$created,$now,$plan,$returned?2:1,$last,$last]);
    genesisRetentionEnsureState($db,genesisFindUser($id),time());
    $db->prepare('UPDATE account_retention_state SET last_activity_at=?,has_returned=?,next_check_at=? WHERE user_id=?')->execute([$last,$returned?1:0,'2999-01-01T00:00:00Z',$id]);
    return $id;
}
function retentionState(string $id): array {$q=genesisDb()->prepare('SELECT * FROM account_retention_state WHERE user_id=?');$q->execute([$id]);return $q->fetch()?:[];}
function retentionSnapshot(string $id,int $now): array
{
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try{$value=genesisRetentionEvaluate($db,genesisFindUser($id),$now);$db->commit();return $value;}catch(Throwable $e){$db->rollBack();throw $e;}
}
function retentionTick(string $id,int $now): array
{
    $db=genesisDb();$db->exec("UPDATE account_retention_state SET next_check_at='2999-01-01T00:00:00Z'");
    foreach(genesisRetentionFamily($db,$id)as$user)$db->prepare("UPDATE account_retention_state SET next_check_at='2000-01-01T00:00:00Z' WHERE user_id=?")->execute([$user['id']]);
    return genesisRetentionRun(500,$now);
}
function retentionNotice(string $id): ?array {$q=genesisDb()->prepare('SELECT * FROM account_retention_notices WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1');$q->execute([$id]);return $q->fetch()?:null;}
function retentionMail(string $id,int $now,?callable $transport=null): array
{
    $db=genesisDb();$db->exec("UPDATE account_retention_notices SET available_at='2999-01-01T00:00:00Z'");
    $db->prepare("UPDATE account_retention_notices SET available_at='2000-01-01T00:00:00Z' WHERE user_id=? AND state='pending'")->execute([$id]);
    return genesisRetentionEmailRun(1,$transport??static fn(array $message,array $job): string=>'accepted',$now);
}
/** Synthetic verified provider evidence, using the same durable schema as the real receipt boundary. */
function retentionPayment(string $id,string $plan='premium',string $ends='2026-08-31T12:34:56Z',string $receiptState='paid'): string
{
    $db=genesisDb();$order=genesisUuid();$at='2026-07-31T12:34:56Z';$reference=hash('sha256',$order);
    $db->prepare('INSERT INTO billing_orders(id,user_id,idempotency_key,provider,plan,period_months,amount_minor,currency,product_id,status,created_at,updated_at,list_amount_minor) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
        ->execute([$order,$id,$order,'yookassa',$plan,$plan==='premium4life'?0:1,100,'RUB','synthetic-'.$plan,$receiptState,$at,$at,100]);
    $db->prepare('INSERT INTO billing_receipts(provider,reference_hash,order_id,state,confirmed_at,evidence_hash,verified_at,refunded_amount_minor) VALUES(?,?,?,?,?,?,?,?)')
        ->execute(['yookassa',$reference,$order,$receiptState,$at,hash('sha256','proof-'.$order),$at,$receiptState==='refunded'?100:0]);
    if($plan!=='premium4life'&&$receiptState==='paid')$db->prepare('INSERT INTO billing_periods(provider,reference_hash,user_id,plan,starts_at,ends_at) VALUES(?,?,?,?,?,?)')
        ->execute(['yookassa',$reference,$id,$plan,$at,$ends]);
    $db->prepare('INSERT INTO subscription_access_state(user_id,materialized_billing) VALUES(?,1) ON CONFLICT(user_id) DO UPDATE SET materialized_billing=1')->execute([$id]);
    $db->prepare('UPDATE users SET subscription_plan=?,subscription_valid_until=? WHERE id=?')->execute([$plan,$plan==='premium4life'?null:$ends,$id]);
    return $order;
}
function retentionDonate(string $id): void
{
    $db=genesisDb();$invoice=genesisUuid();$db->prepare('INSERT INTO donation_intents(id,user_id,created_at) VALUES(?,?,?)')->execute([$invoice,$id,genesisNow()]);
    $body=http_build_query(['success'=>'true','layoutid'=>'synthetic-retention','invoiceid'=>$invoice,'transactionid'=>'fixture-'.str_replace('-','',genesisUuid()),'amount'=>'1.00','currency'=>'RUB','createddate'=>genesisNow()]);
    genesisCloudTipsWebhook($body,base64_encode(hash_hmac('sha256',$body,'synthetic-fixture-secret-only',true)),'application/x-www-form-urlencoded');
}
function retentionAcceptNotice(string $id,int $clock): void
{
    retentionTick($id,$clock);$result=retentionMail($id,$clock);retentionExpect($result['accepted']===1,'Synthetic accepted warning missing');
}
$db=genesisDb();$now=strtotime('2027-01-31T12:34:56Z');
retentionExpect(genesisRetentionAddMonths(strtotime('2027-01-31T12:34:56Z'),1)===strtotime('2027-02-28T12:34:56Z'),'Calendar month overflowed February');
retentionExpect(genesisRetentionAddMonths(strtotime('2028-02-29T12:34:56Z'),12)===strtotime('2029-02-28T12:34:56Z'),'Calendar year overflowed leap day');
if($mode==='unready'){
    $id=retentionUser('unreconciled');$snapshot=retentionSnapshot($id,$now);
    retentionExpect(($snapshot['protected']??'')==='donation-history-unready','Unreconciled historical tips were treated as zero donations');
    $run=retentionTick($id,$now+5*365*86400);retentionExpect(!$run['configured']&&$run['deleted']===0&&$run['queued']===0&&genesisFindUser($id)!==null,'Disabled/reconciliation gate allowed automatic deletion or false warning');
    echo "Account retention: unreconciled CloudTips history safely blocks automatic warnings and deletion.\n";return;
}

// Exact rule boundaries and the distinction between first registration and return.
$unreturned=retentionUser('unreturned','2026-10-31T12:34:56Z','2026-10-31T12:34:56Z',false);
$snapshot=retentionSnapshot($unreturned,$now);retentionExpect($snapshot['rule']==='free-unreturned'&&$snapshot['deadline']===$now,'Abandoned FREE registration does not expire after three calendar months');
$free=retentionUser('free');$snapshot=retentionSnapshot($free,$now);retentionExpect($snapshot['rule']==='free-inactive'&&$snapshot['deadline']===$now,'Returning FREE user does not get six calendar months of inactivity');
retentionExpect(retentionTick($free,strtotime('2026-12-30T12:34:56Z'))['queued']===0,'Warning was sent before the last calendar month');
retentionExpect(retentionTick($free,strtotime('2026-12-31T12:34:56Z'))['queued']===1,'Month-ahead warning was not queued');
retentionExpect(retentionTick($free,$now+10*86400)['deleted']===0&&genesisFindUser($free)!==null,'Pending warning allowed deletion');
$notConfigured=genesisRetentionEmailRun(1,null,$now);retentionExpect(!$notConfigured['configured']&&retentionNotice($free)['accepted_at']===null,'Missing SMTP configuration created a delivered warning');
$fail=retentionMail($free,$now,static function(): string {throw new RuntimeException('Synthetic transport failure');});
retentionExpect($fail['failed']===1&&retentionNotice($free)['accepted_at']===null,'Failed mail was marked delivered');
retentionExpect(retentionTick($free,$now+365*86400)['deleted']===0,'Failed mandatory email allowed deletion');

// Late delivery starts a full calendar month, even when the original deadline passed.
$late=strtotime('2027-03-31T12:34:56Z');$seen=[];
$mail=retentionMail($free,$late,static function(array $message,array $job)use(&$seen): string {$seen=$message;return 'accepted';});
$notice=retentionNotice($free);$deleteAt=strtotime('2027-04-30T12:34:56Z');
retentionExpect($mail['accepted']===1&&$notice['accepted_at']===genesisRetentionStamp($late)&&genesisRetentionTime($notice['promised_delete_at'])===$deleteAt,'Late SMTP acceptance did not postpone deletion by a full month');
retentionExpect(str_contains($seen['text'],'2027-04-30T12:34:56Z')&&str_contains($seen['text'],'шести календарных месяцев')&&str_contains($seen['text'],'Обязательное служебное письмо'),'Warning omitted its deadline/reason/service nature');
$db->prepare('INSERT INTO workspace_blobs(user_id,ciphertext,iv,updated_at) VALUES(?,?,?,?)')->execute([$free,'encrypted-sentinel','fixture-iv',genesisNow()]);
retentionExpect(retentionTick($free,$deleteAt-1)['deleted']===0,'Deletion happened one second before the promised full month');
retentionExpect(retentionTick($free,$deleteAt)['deleted']===1&&genesisFindUser($free)===null,'Eligible account was not deleted at the promised boundary');
retentionExpect(in_array($free,$GLOBALS['retentionRevoked'],true),'Committed account deletion did not revoke its provider token outside the writer');
retentionExpect(retentionState($free)===[]&&retentionNotice($free)===null,'Cascade retained account activity or warning recipients');
$q=$db->prepare('SELECT COUNT(*) FROM workspace_blobs WHERE user_id=?');$q->execute([$free]);retentionExpect((int)$q->fetchColumn()===0,'Cascade retained personal encrypted workspace');

// Foreground signals update server time; background and cron-like requests never do.
$foreground=retentionUser('foreground',genesisRetentionStamp(time()-1000),genesisRetentionStamp(time()-1000),false);
$_SERVER=['HTTP_USER_AGENT'=>'Mozilla Windows NT','HTTP_X_GENESIS_FOREGROUND'=>'0','HTTP_X_GENESIS_VISIT'=>str_repeat('a',32)];$_SESSION['auth_login_id']=$foreground;
$before=retentionState($foreground);genesisRetentionObserveActivity($foreground,true);retentionExpect(retentionState($foreground)===$before,'Background activity renewed retention');
$_SERVER['HTTP_X_GENESIS_FOREGROUND']='1';genesisRetentionObserveActivity($foreground);
$first=retentionState($foreground);retentionExpect(genesisRetentionTime($first['last_activity_at'])>=time()-2&&!(bool)$first['has_returned']&&strlen($first['first_visit_hash'])===64&&!str_contains($first['first_visit_hash'],str_repeat('a',32)),'First visit was not hashed or registration counted as returning');
$_SERVER['HTTP_X_GENESIS_VISIT']=str_repeat('b',32);genesisRetentionObserveActivity($foreground);
retentionExpect((bool)retentionState($foreground)['has_returned'],'A later foreground visit was not recognized');
$before=retentionState($foreground);$_SERVER=[];genesisRetentionObserveActivity($foreground,true);retentionExpect(retentionState($foreground)===$before,'Cron-like request extended account activity');
$_SERVER=['HTTP_USER_AGENT'=>'Mozilla Android'];genesisRetentionObserveActivity($foreground,true);retentionExpect((int)retentionState($foreground)['activity_revision']>(int)$before['activity_revision'],'Legacy authenticated mobile fallback lost activity');

// Active paid, purchased lifetime, refunded historical payment, and expiry projection.
$paid=retentionUser('paid');retentionPayment($paid,'premium','2027-03-31T12:34:56Z');retentionExpect(isset(retentionSnapshot($paid,$now)['protected']),'Active verified paid period was eligible for deletion');
$revision=(int)$db->query('SELECT revision FROM subscription_access_state WHERE user_id='.$db->quote($paid))->fetchColumn();retentionSnapshot($paid,$now);retentionSnapshot($paid,$now);
retentionExpect((int)$db->query('SELECT revision FROM subscription_access_state WHERE user_id='.$db->quote($paid))->fetchColumn()===$revision,'Unchanged entitlement preflight churned the admin CAS revision');
$paidGift=retentionUser('paid-gift',plan:'premium4life');retentionPayment($paidGift,'premium','2027-03-31T12:34:56Z');
$db->prepare("UPDATE users SET subscription_plan='premium4life',subscription_valid_until=NULL WHERE id=?")->execute([$paidGift]);$db->prepare('UPDATE subscription_access_state SET materialized_billing=0 WHERE user_id=?')->execute([$paidGift]);
retentionExpect(isset(retentionSnapshot($paidGift,$now)['protected'])&&genesisFindUser($paidGift)['subscription_plan']==='premium4life','Paid period on a complimentary lifetime owner was ignored or its administrative grant was erased');
$futurePaid=retentionUser('future-paid');retentionPayment($futurePaid,'premium','2027-12-31T12:34:56Z');
$db->prepare("UPDATE billing_periods SET starts_at='2027-06-30T12:34:56Z' WHERE user_id=?")->execute([$futurePaid]);
retentionExpect(isset(retentionSnapshot($futurePaid,$now)['protected']),'A verified prepaid future window was deleted before it started');
$lifetime=retentionUser('lifetime');retentionPayment($lifetime,'premium4life');retentionExpect(isset(retentionSnapshot($lifetime,$now+100*365*86400)['protected']),'Purchased lifetime account was eligible for deletion');
$former=retentionUser('former');retentionPayment($former);$snapshot=retentionSnapshot($former,$now);
retentionExpect($snapshot['rule']==='former-paid-inactive'&&$snapshot['deadline']===strtotime('2027-08-31T12:34:56Z')&&genesisFindUser($former)['subscription_plan']==='free','Expired payment was not downgraded to FREE with twelve calendar months after the paid period');
$refunded=retentionUser('refunded');retentionPayment($refunded,'premium','2026-08-31T12:34:56Z','refunded');retentionExpect(retentionSnapshot($refunded,$now)['rule']==='former-paid-inactive','A historical verified payment lost the former-payer retention rule after refund');
$corrupt=retentionUser('corrupt');retentionPayment($corrupt);$db->prepare("UPDATE billing_receipts SET confirmed_at='2026-02-30T00:00:00Z' WHERE order_id IN (SELECT id FROM billing_orders WHERE user_id=?)")->execute([$corrupt]);
retentionExpect(retentionTick($corrupt,$now+10*365*86400)['deleted']===0&&genesisFindUser($corrupt)!==null,'Corrupt financial dates were guessed to mean FREE');

// Existing complimentary cohort has both deadlines; future gifts have only inactivity.
$elite=retentionUser('elite','2026-01-31T12:34:56Z','2027-01-30T12:34:56Z',true,'premium4life');
$db->prepare('UPDATE account_retention_state SET complimentary_elite_cohort=1 WHERE user_id=?')->execute([$elite]);$snapshot=retentionSnapshot($elite,$now);
retentionExpect($snapshot['rule']==='complimentary-elite-year'&&$snapshot['deadline']===$now,'Active existing complimentary ELITE escaped the fixed 365-day rule');
$downgradedCohort=retentionUser('downgraded-cohort','2026-01-31T12:34:56Z','2027-01-30T12:34:56Z');$db->prepare('UPDATE account_retention_state SET complimentary_elite_cohort=1 WHERE user_id=?')->execute([$downgradedCohort]);
retentionExpect(retentionSnapshot($downgradedCohort,$now)['rule']==='complimentary-elite-year','An unpaid plan-label change removed fixed historical cohort membership');
$gift=retentionUser('future-gift','2020-01-01T00:00:00Z','2027-01-31T12:34:56Z',true,'premium4life');
retentionExpect(retentionSnapshot($gift,$now)['rule']==='complimentary-elite-inactive'&&retentionSnapshot($gift,$now)['deadline']===strtotime('2027-04-30T12:34:56Z'),'Future lifetime grant was added to the historical 365-day cohort');
$adminGift=retentionUser('admin-gift','2020-01-01T00:00:00Z','2027-01-31T12:34:56Z',true,'premium4life');
retentionSnapshot($adminGift,$now);retentionExpect(genesisFindUser($adminGift)['subscription_plan']==='premium4life','Billing refresh erased an administrative lifetime grant');
$oldElite=retentionUser('inactive-elite','2025-01-01T00:00:00Z','2026-10-31T12:34:56Z',true,'premium4life');retentionExpect(retentionSnapshot($oldElite,$now)['deadline']===$now,'Complimentary ELITE inactivity is not three calendar months');
retentionAcceptNotice($elite,$now);$oldNotice=retentionNotice($elite);
$_SERVER=['HTTP_USER_AGENT'=>'Mozilla Windows NT','HTTP_X_GENESIS_FOREGROUND'=>'1','HTTP_X_GENESIS_VISIT'=>str_repeat('c',32)];$_SESSION['auth_login_id']=$elite;genesisRetentionObserveActivity($elite,true);
retentionExpect(retentionNotice($elite)['state']==='accepted'&&retentionSnapshot($elite,$now)['fingerprint']===$oldNotice['policy_fingerprint'],'Activity cancelled the fixed 365-day ELITE warning');

// Every listed exception supports case, Gmail dots/+ aliases and linked identities.
$exceptions=['nikitalexanderson@gmail.com','bionicharp@gmail.com','jurijjlogvinov@gmail.com','eagbread@gmail.com','nactbka1982@gmail.com','sergeybond282@gmail.com','margohello@gmail.com','shamrinandy@gmail.com','giostouapi@gmail.com','agishjellmur@gmail.com','2308dara@gmail.com','mechrahod@gmail.com','maybenextime86@gmail.com','max.musatov.www@gmail.com'];
foreach($exceptions as$email){[$local]=explode('@',$email);$alias=strtoupper(substr($local,0,1).'.'.substr($local,1).'+retention@googlemail.com');retentionExpect(genesisRetentionExemptEmail($alias),'Protected Gmail alias was not normalized');}
$exception=retentionUser('exception',email:'BIONIC.HARP+alias@googlemail.com');retentionExpect((retentionSnapshot($exception,$now)['protected']??'')==='exception','Protected account was eligible');
$primaryAdmin=retentionUser('admin',email:'admin@example.invalid');retentionExpect(isset(retentionSnapshot($primaryAdmin,$now)['protected']),'Configured primary administrator was not protected');
$linkedOwner=retentionUser('linked-owner');$db->prepare('INSERT INTO linked_google_accounts(id,owner_user_id,google_sub,email,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')->execute([genesisUuid(),$linkedOwner,'linked-'.genesisUuid(),'MARGO.HELLO+linked@gmail.com','Fixture',genesisNow(),genesisNow()]);
retentionExpect(isset(retentionSnapshot($linkedOwner,$now)['protected']),'Protected linked Google identity did not protect its owner');

// A real signed donation protects every automatic rule indefinitely, without activity.
$donor=retentionUser('donor','2020-01-01T00:00:00Z','2020-01-01T00:00:00Z',false,'premium4life');retentionDonate($donor);
retentionExpect(genesisCloudTipsHasDonation($db,$donor)&&(retentionSnapshot($donor,$now+50*365*86400)['protected']??'')==='donor','Verified donor did not receive permanent deletion protection');
$pending=retentionUser('pending-donation');$db->prepare('INSERT INTO donation_intents(id,user_id,created_at) VALUES(?,?,?)')->execute([genesisUuid(),$pending,genesisRetentionStamp($now)]);
retentionExpect((retentionSnapshot($pending,$now+6*86400)['protected']??'')==='donation-pending'&&!isset(retentionSnapshot($pending,$now+8*86400)['protected']),'Donation intent grace is not seven days');

// Races between policy preflight and SMTP acceptance must never yield a valid warning.
foreach(['activity','email','donation','payment','lease']as$race){
    $id=retentionUser('race-'.$race);retentionTick($id,$now);
    $sent=retentionMail($id,$now,static function(array $message,array $job)use($race,$id,$db,$now): string {
        if($race==='activity')$db->prepare('UPDATE account_retention_state SET last_activity_at=?,activity_revision=activity_revision+1 WHERE user_id=?')->execute([genesisRetentionStamp($now),$id]);
        if($race==='email')$db->prepare('UPDATE users SET email=? WHERE id=?')->execute(['changed-'.$id.'@example.invalid',$id]);
        if($race==='donation')retentionDonate($id);
        if($race==='payment')retentionPayment($id,'premium','2028-01-31T12:34:56Z');
        if($race==='lease')$db->prepare("UPDATE account_retention_notices SET lease_token='another-worker' WHERE user_id=?")->execute([$id]);
        return 'accepted';
    });
    retentionExpect($sent['accepted']===0&&retentionNotice($id)['accepted_at']===null,'SMTP race produced valid deletion approval: '.$race);
    retentionExpect(retentionTick($id,$now+10*86400)['deleted']===0&&genesisFindUser($id)!==null,'SMTP race deleted data: '.$race);
}

// A cancellation with unchanged policy can be safely reissued, with a new full month.
$reissued=retentionUser('reissued');retentionAcceptNotice($reissued,$now);$old=retentionNotice($reissued);
$db->prepare("UPDATE account_retention_notices SET state='cancelled',accepted_at=NULL WHERE user_id=?")->execute([$reissued]);
retentionExpect(retentionTick($reissued,$now+86400)['queued']===1&&retentionNotice($reissued)['state']==='pending','Same-fingerprint cancellation prevented a new mandatory warning');
retentionMail($reissued,$now+86400);$new=retentionNotice($reissued);
retentionExpect($new['id']!==$old['id']&&genesisRetentionTime($new['accepted_at'])===$now+86400&&genesisRetentionTime($new['promised_delete_at'])>=genesisRetentionAddMonths($now+86400,1),'Reissued warning reused the old Message-ID/acceptance or shortened the full month');

// A whole page of corrupt accounts cannot starve the next eligible account.
$blocked=retentionUser('blocked-page');retentionPayment($blocked);$db->prepare("UPDATE billing_receipts SET confirmed_at='invalid' WHERE order_id IN (SELECT id FROM billing_orders WHERE user_id=?)")->execute([$blocked]);
$next=retentionUser('after-blocked-page');$db->exec("UPDATE account_retention_state SET next_check_at='2999-01-01T00:00:00Z'");
$db->prepare("UPDATE account_retention_state SET next_check_at=? WHERE user_id=?")->execute(['2000-01-01T00:00:00Z',$blocked]);
$db->prepare("UPDATE account_retention_state SET next_check_at=? WHERE user_id=?")->execute(['2001-01-01T00:00:00Z',$next]);
retentionExpect(genesisRetentionRun(1,$now)['failed']===1,'Corrupt financial row fixture did not block the first bounded page');
retentionExpect(genesisRetentionTime(retentionState($blocked)['next_check_at'])===$now+3600&&genesisRetentionRun(1,$now)['queued']===1&&retentionNotice($next)!==null,'Corrupt first page starved a later account');
$badMail=retentionUser('bad-mail-page');retentionTick($badMail,$now);retentionPayment($badMail);$db->prepare("UPDATE billing_receipts SET confirmed_at='invalid' WHERE order_id IN (SELECT id FROM billing_orders WHERE user_id=?)")->execute([$badMail]);
$goodMail=retentionUser('good-mail-page');retentionTick($goodMail,$now);$db->exec("UPDATE account_retention_notices SET available_at='2999-01-01T00:00:00Z'");
$db->prepare("UPDATE account_retention_notices SET available_at='2000-01-01T00:00:00Z' WHERE user_id=?")->execute([$badMail]);
$db->prepare("UPDATE account_retention_notices SET available_at='2001-01-01T00:00:00Z' WHERE user_id=?")->execute([$goodMail]);
$batch=genesisRetentionEmailRun(2,static fn():string=>'accepted',$now);
retentionExpect($batch['failed']===1&&$batch['accepted']===1&&retentionNotice($badMail)['accepted_at']===null&&retentionNotice($goodMail)['accepted_at']!==null,'Corrupt email preflight starved a valid mandatory warning');

// Activity, donation and unresolved checkout after acceptance are rechecked under writer.
foreach(['activity','donation','checkout']as$race){
    $id=retentionUser('delete-race-'.$race);retentionAcceptNotice($id,$now);
    if($race==='activity')$db->prepare('UPDATE account_retention_state SET last_activity_at=?,activity_revision=activity_revision+1 WHERE user_id=?')->execute([genesisRetentionStamp($now+86400),$id]);
    if($race==='donation')retentionDonate($id);
    if($race==='checkout'){
        $order=genesisUuid();$db->prepare('INSERT INTO billing_orders(id,user_id,idempotency_key,provider,plan,period_months,amount_minor,currency,product_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')->execute([$order,$id,$order,'yookassa','premium',1,100,'RUB','synthetic-pending',genesisNow(),genesisNow()]);
    }
    retentionExpect(retentionTick($id,genesisRetentionAddMonths($now,1))['deleted']===0&&genesisFindUser($id)!==null,'Final deletion recheck missed '.$race);
}

// Family owners cannot discard a protected or paid member's workspace.
$owner=retentionUser('family-owner');$member=retentionUser('family-member',email:'jurijj.logvinov+family@gmail.com');
$db->prepare("INSERT INTO linked_local_accounts(member_user_id,owner_user_id,provider,provider_uid,email,display_name,created_at,updated_at) VALUES(?,?,'yandex',?,?,?, ?,?)")->execute([$member,$owner,'fixture-'.$member,'jurijj.logvinov+family@gmail.com','Fixture',genesisNow(),genesisNow()]);
retentionExpect(retentionTick($owner,$now+10*365*86400)['deleted']===0&&genesisFindUser($owner)!==null&&genesisFindUser($member)!==null,'Legacy family deletion removed an exempt participant');
$paidOwner=retentionUser('paid-family-owner');$paidMember=retentionUser('paid-family-member');retentionPayment($paidMember,'premium4life');
$db->prepare("INSERT INTO linked_local_accounts(member_user_id,owner_user_id,provider,provider_uid,email,display_name,created_at,updated_at) VALUES(?,?,'yandex',?,?,?, ?,?)")->execute([$paidMember,$paidOwner,'fixture-'.$paidMember,'family-'.$paidMember.'@example.invalid','Fixture',genesisNow(),genesisNow()]);
retentionExpect(retentionTick($paidOwner,$now+10*365*86400)['deleted']===0&&genesisFindUser($paidOwner)!==null,'Legacy family deletion ignored a paid member');
$technicalOwner=retentionUser('technical-family-owner');$technicalMember=retentionUser('technical-family-member',email:'linked-'.genesisUuid().'@internal.genesis.invalid');
$db->prepare("INSERT INTO linked_local_accounts(member_user_id,owner_user_id,provider,provider_uid,email,display_name,created_at,updated_at) VALUES(?,?,'yandex',?,?,?, ?,?)")->execute([$technicalMember,$technicalOwner,'fixture-'.$technicalMember,'BIONIC.HARP+legacy@gmail.com','Fixture',genesisNow(),genesisNow()]);
retentionExpect(retentionTick($technicalOwner,$now)['queued']===0&&(retentionSnapshot($technicalOwner,$now)['protected']??'')==='exception','Actual protected legacy provider email was hidden by a technical users.email');
$ordinaryOwner=retentionUser('ordinary-family-owner');$ordinaryMember=retentionUser('ordinary-family-member',email:'linked-'.genesisUuid().'@internal.genesis.invalid');
$realMemberEmail='real-legacy-member-'.genesisUuid().'@example.invalid';
$db->prepare("INSERT INTO linked_local_accounts(member_user_id,owner_user_id,provider,provider_uid,email,display_name,created_at,updated_at) VALUES(?,?,'yandex',?,?,?, ?,?)")->execute([$ordinaryMember,$ordinaryOwner,'fixture-'.$ordinaryMember,$realMemberEmail,'Fixture',genesisNow(),genesisNow()]);
retentionExpect(retentionTick($ordinaryOwner,$now)['queued']===2&&retentionNotice($ordinaryMember)['recipient_email']===$realMemberEmail,'Legacy family warning used an internal placeholder instead of its real provider email');
retentionMail($ordinaryOwner,$now);retentionMail($ordinaryMember,$now);
$familyDone=retentionTick($ordinaryOwner,genesisRetentionAddMonths($now,1));
retentionExpect($familyDone['deleted']===2&&genesisFindUser($ordinaryOwner)===null&&genesisFindUser($ordinaryMember)===null,'Fully warned eligible legacy family did not delete atomically');

// Existing shared-participant policy transfers ownership and preserves their records.
$sharedOwner=retentionUser('shared-owner');$survivor=retentionUser('shared-survivor');$space=genesisUuid();$project=genesisUuid();$status=genesisUuid();$task=genesisUuid();$at=genesisNow();
$db->prepare('INSERT INTO shared_spaces(id,title,created_by,created_at,updated_at) VALUES(?,?,?,?,?)')->execute([$space,'Shared fixture',$sharedOwner,$at,$at]);
$db->prepare("INSERT INTO shared_space_members(space_id,user_id,role,joined_at) VALUES(?,?,'owner',?),(?,?,'member',?)")->execute([$space,$sharedOwner,$at,$space,$survivor,$at]);
$db->prepare('INSERT INTO shared_projects(id,space_id,title,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?)')->execute([$project,$space,'Project fixture',$sharedOwner,$at,$at]);
$db->prepare("INSERT INTO shared_project_members(project_id,user_id,role,joined_at) VALUES(?,?,'owner',?),(?,?,'member',?)")->execute([$project,$sharedOwner,$at,$project,$survivor,$at]);
$db->prepare('INSERT INTO shared_project_statuses(id,project_id,title,position) VALUES(?,?,?,0)')->execute([$status,$project,'Open']);
$db->prepare('INSERT INTO shared_tasks(id,project_id,status_id,title,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')->execute([$task,$project,$status,'Surviving participant record',$survivor,$survivor,$at,$at]);
retentionAcceptNotice($sharedOwner,$now);$finish=genesisRetentionAddMonths($now,1);$run=retentionTick($sharedOwner,$finish);
retentionExpect($run['deleted']===1&&genesisFindUser($sharedOwner)===null&&genesisFindUser($survivor)!==null,'Shared account did not use the existing deletion flow');
$q=$db->prepare('SELECT role FROM shared_space_members WHERE space_id=? AND user_id=?');$q->execute([$space,$survivor]);retentionExpect($q->fetchColumn()==='owner','Space ownership was not transferred to the surviving participant');
$q=$db->prepare('SELECT title FROM shared_tasks_read WHERE id=?');$q->execute([$task]);retentionExpect($q->fetchColumn()==='Surviving participant record','Automatic deletion erased another participant shared data');
// An unmatched new public-link donation invalidates prior reconciliation before
// either an already-warned deletion or a pending warning can proceed.
$unmatchedDelete=retentionUser('unmatched-delete');retentionAcceptNotice($unmatchedDelete,$now);
$unmatchedMail=retentionUser('unmatched-mail');retentionTick($unmatchedMail,$now);
$anonymousBody=http_build_query(['success'=>'true','layoutid'=>'synthetic-retention','invoiceid'=>'',
    'transactionid'=>'unmatched-'.str_replace('-','',genesisUuid()),'amount'=>'1.00','currency'=>'RUB','createddate'=>genesisNow()]);
genesisCloudTipsWebhook($anonymousBody,base64_encode(hash_hmac('sha256',$anonymousBody,'synthetic-fixture-secret-only',true)),'application/x-www-form-urlencoded');
$unmatchedRun=retentionTick($unmatchedDelete,genesisRetentionAddMonths($now,1));
retentionExpect(!$unmatchedRun['configured']&&$unmatchedRun['deleted']===0&&genesisFindUser($unmatchedDelete)!==null
    &&retentionNotice($unmatchedDelete)['state']==='cancelled','Unmatched donation did not block an already-warned deletion');
$unmatchedSent=0;
$unmatchedDelivery=retentionMail($unmatchedMail,$now,static function()use(&$unmatchedSent):string{$unmatchedSent++;return 'accepted';});
retentionExpect($unmatchedSent===0&&$unmatchedDelivery['cancelled']===1&&retentionNotice($unmatchedMail)['accepted_at']===null,
    'Unmatched donation allowed a pending mandatory warning to be sent');
retentionExpect(!$db->query('PRAGMA foreign_key_check')->fetch(),'Retention flow broke foreign keys');
require __DIR__.'/account-retention-email-i18n.php';
echo "Account retention: 3/6/12 calendar months, 365-day cohort, foreground/legacy activity, exemptions and linked families, verified donations/payments, unmatched receipt barrier, expiry downgrade, mandatory mail failure/late delivery, lease and policy races, deletion cascades and shared survivors passed.\n";
