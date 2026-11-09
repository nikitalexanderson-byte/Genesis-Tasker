<?php
declare(strict_types=1);
require_once __DIR__.'/account-email.php';
require_once __DIR__.'/donations-cloudtips.php';
require_once __DIR__.'/plan-guidance.php';

/** Exact UTC timestamps only. A corrupt date always stops a destructive decision. */
function genesisRetentionStamp(int $now): string { return gmdate('Y-m-d\TH:i:s\Z',$now); }
function genesisRetentionTime(mixed $value): int
{
    $time=genesisSubscriptionExpiry($value);
    if($time===false)throw new DomainException('RETENTION_INVALID_DATE');
    return $time;
}

/** Calendar months, clamped to the last day, rather than PHP's March overflow. */
function genesisRetentionAddMonths(int $at,int $months): int
{
    $date=(new DateTimeImmutable('@'.$at))->setTimezone(new DateTimeZone('UTC'));
    $first=$date->modify('first day of this month')->modify(($months>=0?'+':'').$months.' months');
    $day=min((int)$date->format('j'),(int)$first->format('t'));
    return $first->setDate((int)$first->format('Y'),(int)$first->format('n'),$day)->getTimestamp();
}

function genesisRetentionCanonicalEmail(string $email): string
{
    $email=mb_strtolower(trim($email));
    if(preg_match('/\A([^@]+)@(gmail\.com|googlemail\.com)\z/D',$email,$parts))
        $email=str_replace('.','',explode('+',$parts[1],2)[0]).'@gmail.com';
    return $email;
}

/** These server-only exceptions must never be copied into public agreements. */
function genesisRetentionExemptEmail(string $email): bool
{
    static $emails;
    $emails??=array_fill_keys(array_map('genesisRetentionCanonicalEmail',[
        'nikitalexanderson@gmail.com','bionicharp@gmail.com','jurijjlogvinov@gmail.com','eagbread@gmail.com',
        'nactbka1982@gmail.com','sergeybond282@gmail.com','margohello@gmail.com','shamrinandy@gmail.com',
        'giostouapi@gmail.com','agishjellmur@gmail.com','2308dara@gmail.com','mechrahod@gmail.com',
        'maybenextime86@gmail.com','max.musatov.www@gmail.com',
    ]),true);
    return isset($emails[genesisRetentionCanonicalEmail($email)]);
}

/** Undirected legacy workspace family: deleting a member must not split its owner. */
function genesisRetentionFamily(PDO $db,string $userId): array
{
    $ids=[$userId=>true];$pending=[$userId];
    $q=$db->prepare('SELECT member_user_id,owner_user_id FROM linked_local_accounts WHERE member_user_id=? OR owner_user_id=?');
    while($pending){
        $id=array_pop($pending);$q->execute([$id,$id]);$links=$q->fetchAll();$q->closeCursor();
        foreach($links as$link)foreach(['member_user_id','owner_user_id']as$key)if(!isset($ids[$link[$key]])){
            if(count($ids)>=100)throw new DomainException('RETENTION_FAMILY_TOO_LARGE');
            $ids[$link[$key]]=true;$pending[]=$link[$key];
        }
    }
    $keys=array_keys($ids);sort($keys,SORT_STRING);
    $q=$db->prepare('SELECT * FROM users WHERE id IN ('.implode(',',array_fill(0,count($keys),'?')).') ORDER BY id');
    $q->execute($keys);$rows=$q->fetchAll();$q->closeCursor();
    if(count($rows)!==count($keys))throw new DomainException('RETENTION_FAMILY_INVALID');
    return $rows;
}

function genesisRetentionEnsureState(PDO $db,array $user,int $now): array
{
    $q=$db->prepare('SELECT * FROM account_retention_state WHERE user_id=?');$q->execute([$user['id']]);$state=$q->fetch();$q->closeCursor();
    if($state)return $state;
    $created=genesisRetentionTime($user['created_at']);$last=$created;
    foreach(['last_login_at','last_seen_at']as$key)if(!empty($user[$key]))$last=max($last,genesisRetentionTime($user[$key]));
    $stamp=genesisRetentionStamp($now);
    $returned=(int)($user['login_count']??0)>1||$last>$created+60;
    $db->prepare('INSERT INTO account_retention_state(user_id,last_activity_at,has_returned,next_check_at,created_at,updated_at) VALUES(?,?,?,?,?,?)')
        ->execute([$user['id'],genesisRetentionStamp($last),$returned?1:0,$stamp,$stamp,$stamp]);
    $q->execute([$user['id']]);$state=$q->fetch();$q->closeCursor();return $state;
}

/** Foreground presence is independent of Google/cron sync and the ordinary heartbeat.
 * No raw visit id is persisted; timestamps are assigned exclusively by the server. */
function genesisRetentionObserveActivity(string $userId,bool $login=false): void
{
    $foreground=$_SERVER['HTTP_X_GENESIS_FOREGROUND']??null;
    if($foreground!==null&&$foreground!=='1')return;
    if($foreground===null&&(!function_exists('genesisRequestClientKind')||genesisRequestClientKind($_SERVER)===null))return;
    $visit=(string)($_SERVER['HTTP_X_GENESIS_VISIT']??'');
    $validVisit=preg_match('/\A(?:[a-fA-F0-9]{16,128}|[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12})\z/D',$visit)===1;
    $identity=(string)($_SESSION['auth_login_id']??$userId);
    $visitHash=$validVisit?hash('sha256',$identity.':'.strtolower($visit)):null;
    $key=$userId.':'.($visitHash??'legacy');$now=time();
    if(!$login&&$now-(int)($_SESSION['retention_observed'][$key]??0)<60)return;
    $db=genesisDb();$owns=!$db->inTransaction();if($owns)genesisBeginWriteTransaction($db);
    try{
        foreach(genesisRetentionFamily($db,$userId)as$user){
            $state=genesisRetentionEnsureState($db,$user,$now);
            if($user['id']===$userId)genesisPlanGuidanceObserve($db,$userId,$state['last_activity_at'],$visitHash,$now);
            $returned=(bool)$state['has_returned']||($login&&(int)$user['login_count']>1)
                ||($visitHash!==null&&$state['first_visit_hash']!==null&&!hash_equals($state['first_visit_hash'],$visitHash));
            $stamp=genesisRetentionStamp($now);
            $db->prepare('UPDATE account_retention_state SET last_activity_at=?,has_returned=?,first_visit_hash=COALESCE(first_visit_hash,?),activity_revision=activity_revision+1,next_check_at=?,updated_at=? WHERE user_id=?')
                ->execute([$stamp,$returned?1:0,$visitHash,$stamp,$stamp,$user['id']]);
            // The fixed 365-day cohort rule survives activity. All inactivity warnings expire.
            $db->prepare("UPDATE account_retention_notices SET state='cancelled',lease_token=NULL,lease_until=NULL,error_code='RETENTION_ACTIVITY',updated_at=? WHERE user_id=? AND rule<>'complimentary-elite-year' AND state IN ('pending','running','accepted','failed')")
                ->execute([$stamp,$user['id']]);
        }
        if($owns)$db->commit();$_SESSION['retention_observed'][$key]=$now;
    }catch(Throwable $failure){if($owns&&$db->inTransaction())$db->rollBack();throw $failure;}
}

/** Verified evidence, never a user's declared label or a checkout redirect. Must hold writer. */
function genesisRetentionFinance(PDO $db,array $user,array $state,int $now): array
{
    // Keep repository inclusion compatible with existing callers that explicitly
    // load billing.php after repository.php; activity observation needs no billing.
    require_once __DIR__.'/billing.php';
    $id=$user['id'];genesisBillingAssertAccountDeletable($db,$id);
    $q=$db->prepare('SELECT o.id,o.plan,o.amount_minor,o.list_amount_minor,o.status,o.created_at,o.updated_at,r.provider,r.reference_hash,r.state,r.confirmed_at,r.provider_valid_until,r.evidence_hash,r.verified_at,r.refunded_amount_minor FROM billing_orders o LEFT JOIN billing_receipts r ON r.order_id=o.id WHERE o.user_id=? ORDER BY o.id,r.provider,r.reference_hash');
    $q->execute([$id]);$evidence=$q->fetchAll();$q->closeCursor();$everPaid=false;
    foreach($evidence as$row){
        foreach(['created_at','updated_at','confirmed_at','provider_valid_until','verified_at']as$field)if($row[$field]!==null)genesisRetentionTime($row[$field]);
        if(in_array($row['state'],['paid','refunded'],true)){
            if(!is_string($row['evidence_hash'])||$row['evidence_hash']===''||(int)$row['amount_minor']<=0)throw new DomainException('RETENTION_BILLING_EVIDENCE_INVALID');
            $everPaid=true;
        }
        if($row['status']==='paid'&&$row['state']===null)throw new DomainException('RETENTION_BILLING_EVIDENCE_MISSING');
    }
    $q=$db->prepare('SELECT * FROM subscription_access_state WHERE user_id=?');$q->execute([$id]);$access=$q->fetch()?:[];$q->closeCursor();
    if(!empty($access['receipts_after']))genesisRetentionTime($access['receipts_after']);
    $q=$db->prepare('SELECT provider,reference_hash,plan,starts_at,ends_at FROM billing_periods WHERE user_id=? ORDER BY plan,starts_at,ends_at');$q->execute([$id]);$periods=$q->fetchAll();$q->closeCursor();$paidEnd=null;$windows=[];
    foreach($periods as$period){
        $start=genesisRetentionTime($period['starts_at']);$end=genesisRetentionTime($period['ends_at']);
        if($end<$start)throw new DomainException('RETENTION_BILLING_PERIOD_INVALID');
        $proof=null;foreach($evidence as$row)if($row['provider']===$period['provider']&&$row['reference_hash']===$period['reference_hash']){$proof=$row;break;}
        if(!$proof||$proof['state']!=='paid')throw new DomainException('RETENTION_BILLING_PERIOD_UNFUNDED');
        $paidEnd=max($paidEnd??$end,$end);
        $planWindows=$windows[$period['plan']]??[];$last=array_key_last($planWindows);
        if($last!==null&&$start<=$planWindows[$last]['end'])$planWindows[$last]['end']=max($end,$planWindows[$last]['end']);
        else $planWindows[]=['start'=>$start,'end'=>$end];
        $windows[$period['plan']]=$planWindows;
    }
    $declared=(string)$user['subscription_plan'];
    if(!in_array($declared,['free','standart','standard','premium','business','premium4life'],true))throw new DomainException('RETENTION_PLAN_INVALID');
    $oldUntil=null;
    if($user['subscription_valid_until']!==null)$oldUntil=genesisRetentionTime($user['subscription_valid_until']);
    $paidLifetime=false;
    if($everPaid){
        foreach($evidence as$row)if($row['plan']==='premium4life'&&$row['state']==='paid'){
            $after=$access['receipts_after']??null;
            if($after!==null&&(genesisRetentionTime($row['created_at'])<=genesisRetentionTime($after)||genesisRetentionTime($row['confirmed_at'])<=genesisRetentionTime($after)))continue;
            if(genesisBillingFundedOrderValue($db,$row['id'])>=(int)($row['list_amount_minor']??$row['amount_minor'])){$paidLifetime=true;break;}
        }
    }
    // Re-project only when the effective billing-owned value changes. SMTP preflight
    // must not increment the entitlement CAS revision for an unchanged projection.
    $rank=['standart'=>1,'premium'=>2,'business'=>3];$expected='free';$expectedUntil=null;
    foreach($windows as$plan=>$planWindows)foreach($planWindows as$window)if($window['start']<=$now&&$window['end']>$now&&($rank[$plan]??0)>($rank[$expected]??0)){
        $expected=$plan;$expectedUntil=$window['end'];
    }
    if($paidLifetime){$expected='premium4life';$expectedUntil=null;}
    if((bool)($access['materialized_billing']??false)&&($declared!==$expected||$oldUntil!==$expectedUntil)){
        genesisBillingRefreshEntitlement($db,$id,$now);$user=genesisFindUser($id);
        if(!$user)throw new DomainException('RETENTION_ACCOUNT_MISSING');
    }
    $effectiveUntil=$user['subscription_valid_until']===null?null:genesisRetentionTime($user['subscription_valid_until']);
    // A prepaid future window is retained, including a complimentary lifetime owner
    // whose visible plan is intentionally not replaced by the finite paid label.
    $active=$paidLifetime||($paidEnd!==null&&$paidEnd>$now)||($user['subscription_plan']!=='free'&&$user['subscription_plan']!=='premium4life'&&$effectiveUntil!==null&&$effectiveUntil>$now);
    if($user['subscription_plan']!=='free'&&$user['subscription_plan']!=='premium4life'&&$effectiveUntil===null)throw new DomainException('RETENTION_SUBSCRIPTION_EXPIRY_MISSING');
    $freeSince=$state['free_since']===null?null:genesisRetentionTime($state['free_since']);
    if($active){
        if($freeSince!==null)$db->prepare('UPDATE account_retention_state SET free_since=NULL WHERE user_id=?')->execute([$id]);
        $freeSince=null;
    }elseif($everPaid&&$user['subscription_plan']!=='premium4life'){
        $end=max($paidEnd??0,$oldUntil??0);
        // If no old period survives a refund/reset, start conservatively at observation.
        if($freeSince===null){$freeSince=$end>0?$end:$now;$db->prepare('UPDATE account_retention_state SET free_since=? WHERE user_id=?')->execute([genesisRetentionStamp($freeSince),$id]);}
        elseif($end>$freeSince){$freeSince=$end;$db->prepare('UPDATE account_retention_state SET free_since=? WHERE user_id=?')->execute([genesisRetentionStamp($freeSince),$id]);}
    }
    return ['user'=>$user,'everPaid'=>$everPaid,'active'=>$active,'paidLifetime'=>$paidLifetime,'freeSince'=>$freeSince,
        'fingerprint'=>hash('sha256',json_encode([$evidence,$periods,$access['receipts_after']??null],JSON_THROW_ON_ERROR))];
}

/** Eligibility snapshot. Any missing/corrupt financial evidence throws and retains data. */
function genesisRetentionEvaluate(PDO $db,array $user,int $now): array
{
    $state=genesisRetentionEnsureState($db,$user,$now);$id=$user['id'];
    $q=$db->prepare('SELECT id,email FROM linked_google_accounts WHERE owner_user_id=? ORDER BY id');$q->execute([$id]);$linked=$q->fetchAll();$q->closeCursor();
    $q=$db->prepare('SELECT member_user_id,owner_user_id,email FROM linked_local_accounts WHERE member_user_id=? OR owner_user_id=? ORDER BY member_user_id');$q->execute([$id,$id]);$legacy=$q->fetchAll();$q->closeCursor();
    $recipient=$user['email'];
    // Legacy provider members use a technical users.email while their real
    // provider address remains on the link. Never send to an internal placeholder.
    if(str_ends_with(strtolower($recipient),'@internal.genesis.invalid'))foreach($legacy as$link)if($link['member_user_id']===$id&&genesisIsValidEmail($link['email'])){$recipient=$link['email'];break;}
    foreach([$user,...$linked,...$legacy]as$identity)if(genesisRetentionExemptEmail((string)$identity['email'])
        ||genesisRetentionCanonicalEmail((string)$identity['email'])===genesisRetentionCanonicalEmail(genesisAdminEmail()))return ['protected'=>'exception'];
    $finance=genesisRetentionFinance($db,$user,$state,$now);$user=$finance['user'];
    if(!genesisCloudTipsDeletionReady())return ['protected'=>'donation-history-unready'];
    if(genesisCloudTipsHasDonation($db,$id))return ['protected'=>'donor'];
    if(genesisCloudTipsPendingDonation($db,$id,$now))return ['protected'=>'donation-pending'];
    if($finance['active'])return ['protected'=>'paid-or-current-period'];
    $created=genesisRetentionTime($user['created_at']);$last=genesisRetentionTime($state['last_activity_at']);
    if($last<$created)$last=$created;
    $complimentary=$user['subscription_plan']==='premium4life'&&!$finance['paidLifetime'];
    if($complimentary){
        $rule='complimentary-elite-inactive';$deadline=genesisRetentionAddMonths($last,3);
    }elseif($finance['everPaid']){
        $rule='former-paid-inactive';$deadline=genesisRetentionAddMonths(max($last,$finance['freeSince']??$last),12);
    }else{
        $rule=(bool)$state['has_returned']?'free-inactive':'free-unreturned';$deadline=genesisRetentionAddMonths($last,(bool)$state['has_returned']?6:3);
    }
    // Fixed membership survives a later unpaid downgrade; a verified payment or
    // donation, rather than a mutable plan label, removes the extra cohort rule.
    if(!$finance['everPaid']&&(bool)$state['complimentary_elite_cohort']&&$created+365*86400<=$deadline){$rule='complimentary-elite-year';$deadline=$created+365*86400;}
    $fingerprint=hash('sha256',json_encode(['policy'=>1,'id'=>$id,'email'=>$user['email'],'recipient'=>$recipient,'linked'=>$linked,'legacy'=>$legacy,'rule'=>$rule,'deadline'=>$deadline,
        'activity'=>$rule==='complimentary-elite-year'?null:[$state['activity_revision'],$state['last_activity_at'],$state['has_returned']],
        'financial'=>$finance['fingerprint'],'plan'=>$user['subscription_plan'],'until'=>$user['subscription_valid_until']],JSON_THROW_ON_ERROR));
    return ['user'=>$user,'recipientEmail'=>$recipient,'rule'=>$rule,'deadline'=>$deadline,'warnAt'=>genesisRetentionAddMonths($deadline,-1),'fingerprint'=>$fingerprint];
}

function genesisRetentionCancelStale(PDO $db,string $id,?string $fingerprint,int $now): void
{
    $db->prepare("UPDATE account_retention_notices SET state='cancelled',lease_token=NULL,lease_until=NULL,error_code='RETENTION_POLICY_CHANGED',updated_at=? WHERE user_id=? AND state IN ('pending','running','accepted','failed') AND (? IS NULL OR policy_fingerprint<>?)")
        ->execute([genesisRetentionStamp($now),$id,$fingerprint,$fingerprint]);
}

/** A bad account must not monopolize the first bounded page on every cron run. */
function genesisRetentionReschedule(PDO $db,array $ids,int $now): void
{
    if(!$ids)return;
    genesisBeginWriteTransaction($db);
    try{
        $q=$db->prepare('UPDATE account_retention_state SET next_check_at=? WHERE user_id=?');
        foreach(array_unique($ids)as$id)$q->execute([genesisRetentionStamp($now+3600),$id]);
        $db->commit();
    }catch(Throwable){if($db->inTransaction())$db->rollBack();}
}

/** Writer is obtained by the shared transaction helper before *any* recheck reads;
 * its first UPDATE acquires the same SQLite reserved writer as BEGIN IMMEDIATE. */
function genesisRetentionRun(int $limit=100,?int $now=null): array
{
    if(PHP_SAPI!=='cli')throw new DomainException('RETENTION_CLI_ONLY');
    $now??=time();$limit=max(1,min(500,$limit));$db=genesisDb();$stamp=genesisRetentionStamp($now);
    $result=['checked'=>0,'queued'=>0,'deleted'=>0,'protected'=>0,'failed'=>0,'configured'=>genesisCloudTipsDeletionReady()];
    if($db->inTransaction())throw new DomainException('RETENTION_IN_TRANSACTION');
    // New users with no foreground observer are still considered, including abandoned registrations.
    $q=$db->prepare('SELECT u.* FROM users u LEFT JOIN account_retention_state s ON s.user_id=u.id WHERE s.user_id IS NULL ORDER BY u.id LIMIT ?');$q->bindValue(1,$limit,PDO::PARAM_INT);$q->execute();$missing=$q->fetchAll();$q->closeCursor();
    foreach($missing as$user){genesisBeginWriteTransaction($db);try{genesisRetentionEnsureState($db,$user,$now);$db->commit();}catch(Throwable){if($db->inTransaction())$db->rollBack();$result['failed']++;}}
    $q=$db->prepare('SELECT user_id FROM account_retention_state WHERE next_check_at<=? ORDER BY next_check_at,user_id LIMIT ?');$q->bindValue(1,$stamp);$q->bindValue(2,$limit,PDO::PARAM_INT);$q->execute();$ids=$q->fetchAll(PDO::FETCH_COLUMN);$q->closeCursor();$visited=[];
    foreach($ids as$id){
        if(isset($visited[$id]))continue;$family=[];$revocations=[];$familyQueued=0;genesisBeginWriteTransaction($db);
        try{
            $family=genesisRetentionFamily($db,$id);if(!$family){$db->commit();continue;}$ready=true;$snapshots=[];
            $familyProtected=false;
            foreach($family as$user){
                $uid=$user['id'];$visited[$uid]=true;$result['checked']++;
                $snapshot=genesisRetentionEvaluate($db,$user,$now);$snapshots[$uid]=$snapshot;
                $db->prepare('UPDATE account_retention_state SET next_check_at=? WHERE user_id=?')->execute([genesisRetentionStamp($now+3600),$uid]);
                if(isset($snapshot['protected']))$familyProtected=true;
            }
            if($familyProtected){
                foreach($family as$user)genesisRetentionCancelStale($db,$user['id'],null,$now);
                $result['protected']+=count($family);$db->commit();continue;
            }
            foreach($family as$user){
                $uid=$user['id'];$snapshot=$snapshots[$uid];
                genesisRetentionCancelStale($db,$uid,$snapshot['fingerprint'],$now);
                $recipient=$snapshot['recipientEmail'];
                if(!genesisIsValidEmail($recipient)||str_ends_with(strtolower($recipient),'.invalid')){
                    // Synthetic/internal legacy identities have no deliverable address.
                    if(!defined('GENESIS_LOCAL_TEST_CONFIG')||!str_ends_with(strtolower($recipient),'@example.invalid')){$result['protected']++;$ready=false;continue;}
                }
                if($now>=$snapshot['warnAt']){
                    $db->prepare("INSERT INTO account_retention_notices(id,user_id,rule,policy_fingerprint,recipient_email,rule_deadline_at,promised_delete_at,available_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)
                        ON CONFLICT(user_id,policy_fingerprint) DO UPDATE SET id=excluded.id,state='pending',attempts=0,available_at=excluded.available_at,accepted_at=NULL,
                        promised_delete_at=excluded.promised_delete_at,lease_token=NULL,lease_until=NULL,error_code=NULL,created_at=excluded.created_at,updated_at=excluded.updated_at
                        WHERE account_retention_notices.state='cancelled'")
                        ->execute([genesisUuid(),$uid,$snapshot['rule'],$snapshot['fingerprint'],$recipient,genesisRetentionStamp($snapshot['deadline']),genesisRetentionStamp(max($snapshot['deadline'],genesisRetentionAddMonths($now,1))),$stamp,$stamp,$stamp]);
                    if($db->query('SELECT changes()')->fetchColumn())$familyQueued++;
                }
                $q=$db->prepare("SELECT * FROM account_retention_notices WHERE user_id=? AND policy_fingerprint=? AND state='accepted'");$q->execute([$uid,$snapshot['fingerprint']]);$notice=$q->fetch();$q->closeCursor();
                if(!$notice||$notice['recipient_email']!==$recipient||$notice['accepted_at']===null){$ready=false;continue;}
                $deadline=max($snapshot['deadline'],genesisRetentionTime($notice['promised_delete_at']),genesisRetentionAddMonths(genesisRetentionTime($notice['accepted_at']),1));
                if($now<$deadline)$ready=false;
            }
            if($ready){
                if(!function_exists('genesisSharedPrepareAccountDeletion'))throw new DomainException('RETENTION_SHARED_SAFEGUARD_UNAVAILABLE');
                // All members passed payment/donor/exception/notice checks while the writer is held.
                foreach($family as$user)genesisBillingAssertAccountDeletable($db,$user['id']);
                foreach($family as$user)$revocations=[$user,...genesisLinkedGoogleAccounts($user['id']),...$revocations];
                foreach($family as$user)genesisDeleteAccountRows($user['id']);
            }
            $db->commit();$result['queued']+=$familyQueued;if($ready)$result['deleted']+=count($family);
        }catch(Throwable){
            if($db->inTransaction())$db->rollBack();$result['failed']++;$revocations=[];
            genesisRetentionReschedule($db,$family?array_column($family,'id'):[$id],$now);
        }
        // Provider I/O never holds the SQLite writer. A failed revocation cannot
        // resurrect deleted local data or revoke a financially protected account.
        if(function_exists('genesisRevokeGoogleToken'))foreach($revocations as$identity){
            try{genesisRevokeGoogleToken($identity);}catch(Throwable $failure){genesisLogError('Retention token revocation failed.',$failure);}
        }
    }
    return $result;
}

/** A newly protected legacy member also cancels mail to its workspace owner. */
function genesisRetentionNoticeSnapshot(PDO $db,array $user,int $now): array
{
    $snapshot=genesisRetentionEvaluate($db,$user,$now);
    if(isset($snapshot['protected']))return $snapshot;
    foreach(genesisRetentionFamily($db,$user['id'])as$member)if($member['id']!==$user['id']){
        if(isset(genesisRetentionEvaluate($db,$member,$now)['protected']))return ['protected'=>'family'];
    }
    return $snapshot;
}

/** An incomplete catalog must stop preparation before a warning can be accepted. */
function genesisRetentionEmailCopy(string $json): array
{
    $catalog=json_decode($json,true,512,JSON_THROW_ON_ERROR);
    $languages=['ru','en','el','de','fr','es','it','pt','pl','sr','uk','zh','tr','ja'];
    $fields=['subject','deadline','actionsInactive','actionsYear','data','footer','action'];
    $rules=['free-unreturned','free-inactive','former-paid-inactive','complimentary-elite-inactive','complimentary-elite-year'];
    if(!is_array($catalog)||count($catalog)!==count($languages))throw new DomainException('RETENTION_EMAIL_COPY_INVALID');
    foreach($languages as$language){
        $copy=$catalog[$language]??null;
        if(!is_array($copy)||count($copy)!==count($fields)+1||!is_array($copy['reasons']??null)||count($copy['reasons'])!==count($rules))
            throw new DomainException('RETENTION_EMAIL_COPY_INVALID');
        foreach([...$fields,...$rules]as$field){
            $value=in_array($field,$rules,true)?($copy['reasons'][$field]??null):($copy[$field]??null);
            if(!is_string($value)||trim($value)===''||preg_match('/[\x00-\x1F\x7F]/',$value))throw new DomainException('RETENTION_EMAIL_COPY_INVALID');
            if($field==='deadline'&&substr_count($value,'{date}')!==1)throw new DomainException('RETENTION_EMAIL_COPY_INVALID');
            if(preg_match('/[{}]/',$field==='deadline'?str_replace('{date}','',$value):$value))throw new DomainException('RETENTION_EMAIL_COPY_INVALID');
        }
    }
    return $catalog;
}

function genesisRetentionEmailMessage(array $notice,array $snapshot,int $now): array
{
    static $catalog;
    $catalog??=genesisRetentionEmailCopy((string)file_get_contents(__DIR__.'/../resources/account-retention-email-copy.json'));
    $language=$snapshot['user']['language']??'en';
    $copy=is_string($language)&&isset($catalog[$language])?$catalog[$language]:$catalog['en'];
    $rule=$notice['rule']??null;
    if(!is_string($rule)||!isset($copy['reasons'][$rule]))throw new DomainException('RETENTION_RULE_UNKNOWN');
    $date=genesisRetentionStamp(max($snapshot['deadline'],genesisRetentionTime($notice['promised_delete_at']),genesisRetentionAddMonths($now,1)));
    $text=$copy['reasons'][$rule]."\n\n".str_replace('{date}',$date,$copy['deadline'])
        ."\n\n".$copy[$rule==='complimentary-elite-year'?'actionsYear':'actionsInactive']."\n\n".$copy['data'];
    $origin=rtrim((string)genesisConfig()['app_url'],'/');$url=$origin.'/';
    return ['to'=>$snapshot['recipientEmail'],'subject'=>$copy['subject'],'text'=>$text."\n\n".$url."\n\n".$copy['footer'],
        'html'=>genesisEmailHtml($copy['subject'],$text,$url,$copy['action'],$copy['footer']),'promisedDeleteAt'=>$date];
}

/** SMTP runs outside the SQLite writer. Only an accepted response followed by a
 * valid lease and a fresh policy recheck can create accepted_at. */
function genesisRetentionEmailRun(int $limit=5,?callable $transport=null,?int $now=null): array
{
    if(PHP_SAPI!=='cli')throw new DomainException('RETENTION_CLI_ONLY');
    $clock=$now;$now??=time();$db=genesisDb();
    if($transport===null&&!genesisEmailConfiguration()['available'])return ['processed'=>0,'accepted'=>0,'failed'=>0,'cancelled'=>0,'configured'=>false];
    if($db->inTransaction())throw new DomainException('RETENTION_IN_TRANSACTION');
    $result=['processed'=>0,'accepted'=>0,'failed'=>0,'cancelled'=>0,'configured'=>true];$started=microtime(true);
    for($i=0;$i<max(1,min(20,$limit))&&microtime(true)-$started<40;$i++){
        $now=$clock??time();$stamp=genesisRetentionStamp($now);$job=null;$lease=null;$message=null;
        genesisBeginWriteTransaction($db);
        try{
            $db->prepare("UPDATE account_retention_notices SET state=CASE WHEN attempts>=8 THEN 'failed' ELSE 'pending' END,lease_token=NULL,lease_until=NULL,error_code='RETENTION_LEASE_EXPIRED',updated_at=? WHERE state='running' AND lease_until<=?")->execute([$stamp,$stamp]);
            $q=$db->prepare("SELECT * FROM account_retention_notices WHERE state='pending' AND available_at<=? ORDER BY available_at,id LIMIT 1");$q->execute([$stamp]);$job=$q->fetch();$q->closeCursor();
            if(!$job){$db->commit();break;}
            $user=genesisFindUser($job['user_id']);$snapshot=$user?genesisRetentionNoticeSnapshot($db,$user,$now):['protected'=>'missing'];
            if(isset($snapshot['protected'])||!hash_equals($job['policy_fingerprint'],$snapshot['fingerprint'])||$snapshot['recipientEmail']!==$job['recipient_email']){
                genesisRetentionCancelStale($db,$job['user_id'],null,$now);$db->commit();$result['processed']++;$result['cancelled']++;continue;
            }
            $message=genesisRetentionEmailMessage($job,$snapshot,$now);$lease=bin2hex(random_bytes(16));
            $db->prepare("UPDATE account_retention_notices SET state='running',attempts=attempts+1,lease_token=?,lease_until=?,promised_delete_at=?,updated_at=? WHERE id=? AND state='pending'")
                ->execute([$lease,genesisRetentionStamp($now+120),$message['promisedDeleteAt'],$stamp,$job['id']]);$db->commit();
        }catch(Throwable){
            if($db->inTransaction())$db->rollBack();$result['failed']++;
            if(!$job)break;
            // An invalid policy row is retained without blocking unrelated mail.
            try{
                genesisBeginWriteTransaction($db);
                $db->prepare("UPDATE account_retention_notices SET available_at=?,error_code='RETENTION_PREFLIGHT_RETRY',updated_at=? WHERE id=? AND state='pending'")
                    ->execute([genesisRetentionStamp($now+3600),$stamp,$job['id']]);$db->commit();
            }catch(Throwable){if($db->inTransaction())$db->rollBack();break;}
            continue;
        }
        $accepted=false;try{$sent=$transport?$transport($message,$job):genesisEmailSend($message['to'],$message['subject'],$message['text'],$job['id'],$message['html']);$accepted=$sent==='accepted';}catch(Throwable){/* Never persist transport errors or recipient content. */}
        $finished=$clock??time();$end=genesisRetentionStamp($finished);genesisBeginWriteTransaction($db);
        try{
            $q=$db->prepare("SELECT * FROM account_retention_notices WHERE id=? AND state='running' AND lease_token=? AND lease_until>?");$q->execute([$job['id'],$lease,$end]);$current=$q->fetch();$q->closeCursor();
            if(!$current){$db->commit();$result['processed']++;$result['cancelled']++;continue;}
            $user=genesisFindUser($job['user_id']);$snapshot=$user?genesisRetentionNoticeSnapshot($db,$user,$finished):['protected'=>'missing'];
            if(isset($snapshot['protected'])||!hash_equals($job['policy_fingerprint'],$snapshot['fingerprint'])||$snapshot['recipientEmail']!==$job['recipient_email']){
                genesisRetentionCancelStale($db,$job['user_id'],null,$finished);$db->commit();$result['processed']++;$result['cancelled']++;continue;
            }
            $state=$accepted?'accepted':((int)$current['attempts']>=8?'failed':'pending');
            $promise=max(genesisRetentionTime($current['promised_delete_at']),genesisRetentionAddMonths($finished,1));
            $db->prepare('UPDATE account_retention_notices SET state=?,accepted_at=?,promised_delete_at=?,available_at=?,lease_token=NULL,lease_until=NULL,error_code=?,updated_at=? WHERE id=? AND lease_token=?')
                ->execute([$state,$accepted?$end:null,genesisRetentionStamp($promise),genesisRetentionStamp($finished+min(86400,60*2**min(10,(int)$current['attempts']))),$accepted?null:'EMAIL_RETRY',$end,$job['id'],$lease]);
            $db->commit();$result['processed']++;$result[$accepted?'accepted':'failed']++;
        }catch(Throwable){if($db->inTransaction())$db->rollBack();$result['processed']++;$result['failed']++;}
    }
    return $result;
}
