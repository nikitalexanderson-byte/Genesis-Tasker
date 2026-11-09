<?php
declare(strict_types=1);

function genesisGoogleIdentityManagementEnabled(): bool { return (genesisConfig()['google_identity_management_enabled']??false)===true; }
function genesisGoogleLoginIdentities(string $owner): array
{
    $user=genesisFindUser($owner);if(!$user)return [];
    $rows=[['id'=>$owner,'sub'=>$user['google_sub'],'email'=>$user['email'],'active'=>(bool)$user['google_login_active']]];
    foreach(genesisLinkedGoogleAccounts($owner)as$row)$rows[]=['id'=>$row['id'],'sub'=>$row['google_sub'],'email'=>$row['email'],'active'=>(bool)$row['login_active']];
    return array_map(static fn(array $row):array=>[...$row,'issuer'=>'https://accounts.google.com','primary'=>$row['id']===$user['primary_google_identity_id'],
        'current'=>($row['sub']===($_SESSION['auth_identity']['sub']??null))],$rows);
}
function genesisGoogleLoginIdentity(string $owner,string $sub): ?array
{
    foreach(genesisGoogleLoginIdentities($owner)as$row)if(hash_equals($row['sub'],$sub))return $row;return null;
}
function genesisGoogleSecurityEvent(string $owner,string $kind,string $actor,string $target): void
{
    genesisDb()->prepare('INSERT INTO google_security_events VALUES(?,?,?,?,?,?)')->execute([genesisUuid(),$owner,$kind,$actor,$target,genesisNow()]);
    genesisDb()->prepare('INSERT INTO account_security_outbox(id,user_id,kind,payload_enc,created_at) VALUES(?,?,?,?,?)')->execute([genesisUuid(),$owner,'notify',
        genesisEncrypt(json_encode(['kind'=>$kind,'actor'=>$actor,'target'=>$target,'channels'=>array_column(genesisGoogleLoginIdentities($owner),'email')],JSON_THROW_ON_ERROR)),genesisNow()]);
}
function genesisGoogleRequireFresh(string $owner,?string $mustRemain=null): array
{
    $proof=$_SESSION['google_step_up']??null;$user=genesisFindUser($owner);
    if(!is_array($proof)||($proof['owner']??null)!==$owner||($proof['epoch']??null)!==(int)$user['security_epoch']||($proof['expiresAt']??0)<time())throw new GenesisResourceLimitException(403,'GOOGLE_FRESH_AUTH_REQUIRED');
    $identity=genesisGoogleLoginIdentity($owner,$proof['sub']);
    if(!$identity||!$identity['active']||($mustRemain!==null&&$identity['id']===$mustRemain))throw new GenesisResourceLimitException(403,'GOOGLE_REMAINING_AUTH_REQUIRED');
    return $identity;
}
function genesisGoogleInvalidatePendingRecovery(string $owner): void
{
    genesisDb()->prepare("UPDATE account_recovery_requests SET state='invalidated' WHERE user_id=? AND state IN ('pending','approved')")->execute([$owner]);
}
function genesisGoogleSetPrimary(string $owner,string $target): void
{
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        $actor=genesisGoogleRequireFresh($owner);$rows=genesisGoogleLoginIdentities($owner);
        if(!array_filter($rows,static fn(array $row):bool=>$row['id']===$target&&$row['active']))throw new GenesisResourceLimitException(409,'GOOGLE_PRIMARY_INVALID');
        $db->prepare('UPDATE users SET primary_google_identity_id=? WHERE id=?')->execute([$target,$owner]);
        genesisGoogleSecurityEvent($owner,'primary-changed',$actor['id'],$target);$db->commit();unset($_SESSION['google_step_up']);
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}
function genesisGoogleDisableLogin(string $owner,string $target,string $replacement): void
{
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        $actor=genesisGoogleRequireFresh($owner,$target);$user=genesisFindUser($owner);$rows=genesisGoogleLoginIdentities($owner);
        $found=array_values(array_filter($rows,static fn(array $row):bool=>$row['id']===$target&&$row['active']));
        if(!$found||count(array_filter($rows,static fn(array $row):bool=>$row['active']))<2)throw new GenesisResourceLimitException(409,'GOOGLE_LAST_LOGIN');
        if($user['primary_google_identity_id']===$target){
            if(!array_filter($rows,static fn(array $row):bool=>$row['id']===$replacement&&$row['active']&&$row['id']!==$target))throw new GenesisResourceLimitException(409,'GOOGLE_REPLACEMENT_REQUIRED');
            $db->prepare('UPDATE users SET primary_google_identity_id=? WHERE id=?')->execute([$replacement,$owner]);
        }
        if($target===$owner)$db->prepare('UPDATE users SET google_login_active=0,security_epoch=security_epoch+1 WHERE id=?')->execute([$owner]);
        else{$db->prepare('UPDATE linked_google_accounts SET login_active=0 WHERE owner_user_id=? AND id=?')->execute([$owner,$target]);$db->prepare('UPDATE users SET security_epoch=security_epoch+1 WHERE id=?')->execute([$owner]);}
        genesisGoogleInvalidatePendingRecovery($owner);genesisGoogleSecurityEvent($owner,'login-disabled',$actor['id'],$target);$db->commit();
        // Safe fallback: all pre-change sessions, including this one, are invalidated.
        unset($_SESSION['google_step_up']);
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}
/** Verified token first; a newly issued ID token alone is not fresh reauthentication. */
function genesisGoogleAcceptStepUp(string $owner,string $token,array $challenge,?callable $certificates=null): void
{
    $profile=genesisVerifyNativeGoogleToken($token,(string)genesisConfig()['google_client_id'],$challenge,time(),$certificates??static fn():array=>genesisNativeGoogleCertificates($_SESSION,time()));
    $claims=json_decode(genesisNativeDecodeSegment(explode('.',$token)[1]),true,16,JSON_THROW_ON_ERROR);
    if(!is_int($claims['auth_time']??null)||$claims['auth_time']<$challenge['issuedAt']-60||$claims['auth_time']>time()+60)throw new GenesisResourceLimitException(403,'GOOGLE_FRESH_AUTH_NOT_PROVEN');
    $identity=genesisGoogleLoginIdentity($owner,$profile['sub']);$user=genesisFindUser($owner);
    if(!$identity||!$identity['active'])throw new GenesisResourceLimitException(403,'GOOGLE_IDENTITY_NOT_LINKED');
    $_SESSION['google_step_up']=['owner'=>$owner,'sub'=>$profile['sub'],'epoch'=>(int)$user['security_epoch'],'expiresAt'=>time()+300];
}
function genesisGoogleCreateRecoveryCode(string $owner): string
{
    $code=genesisBase64Url(random_bytes(32));$hash=password_hash($code,PASSWORD_ARGON2ID);$db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        genesisGoogleRequireFresh($owner);
        $db->prepare('INSERT INTO account_recovery_codes VALUES(?,?,?,NULL,?) ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash,security_epoch=excluded.security_epoch,used_at=NULL,created_at=excluded.created_at')
            ->execute([$owner,$hash,(int)genesisFindUser($owner)['security_epoch'],genesisNow()]);
        $db->commit();unset($_SESSION['google_step_up']);return $code;
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}
/** Candidate is only supplied by a verified recovery OAuth callback, never request JSON. */
function genesisGoogleCreateRecoveryRequest(string $owner,array $candidate,string $code): array
{
    if((genesisConfig()['account_recovery_enabled']??false)!==true)throw new GenesisResourceLimitException(503,'ACCOUNT_RECOVERY_DISABLED');
    $user=genesisFindUser($owner);
    if(!$user||genesisIsAdminUser($user)||genesisGoogleLoginIdentity($owner,(string)($candidate['sub']??'')))throw new GenesisResourceLimitException(403,'RECOVERY_REVIEW_REQUIRED');
    if(!is_string($candidate['sub']??null)||!is_string($candidate['email']??null)||!($candidate['email_verified']??false))throw new InvalidArgumentException('RECOVERY_IDENTITY_INVALID');
    $q=genesisDb()->prepare('SELECT * FROM account_recovery_codes WHERE user_id=?');$q->execute([$owner]);$proof=$q->fetch();
    $kind=$code===''?'manual':'code';
    if($kind==='code'&&(!$proof||$proof['used_at']!==null||!password_verify($code,$proof['code_hash'])))throw new GenesisResourceLimitException(403,'RECOVERY_REVIEW_REQUIRED');
    $id=genesisUuid();$db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        $user=genesisFindUser($owner);
        if(!$user||genesisIsAdminUser($user))throw new GenesisResourceLimitException(403,'RECOVERY_REVIEW_REQUIRED');
        if($kind==='code'){
            $q=$db->prepare('SELECT code_hash,used_at FROM account_recovery_codes WHERE user_id=?');$q->execute([$owner]);$latest=$q->fetch();
            if(!$latest||$latest['used_at']!==null||!hash_equals($proof['code_hash'],$latest['code_hash']))throw new GenesisResourceLimitException(403,'RECOVERY_REVIEW_REQUIRED');
        }
        $q=$db->prepare("SELECT COUNT(*) FROM account_recovery_requests WHERE user_id=? AND state IN ('pending','approved')");$q->execute([$owner]);
        if((int)$q->fetchColumn()>=3)throw new GenesisResourceLimitException(429,'RECOVERY_REVIEW_REQUIRED');
        $db->prepare("INSERT INTO account_recovery_requests(id,user_id,candidate_sub,candidate_email,security_epoch,proof_kind,proof_hash,state,expires_at,created_at) VALUES(?,?,?,?,?,?,?,'pending',?,?)")
            ->execute([$id,$owner,$candidate['sub'],$candidate['email'],(int)$user['security_epoch'],$kind,$kind==='code'?$proof['code_hash']:null,time()+7*86400,genesisNow()]);$db->commit();
        return ['requestId'=>$id,'state'=>'pending'];
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}
function genesisGoogleReviewRecovery(string $reviewer,string $id,bool $approved,string $reason): void
{
    if(!genesisIsAdminUser(genesisFindUser($reviewer))||!in_array($reviewer,genesisConfig()['account_recovery_reviewers']??[],true))throw new GenesisResourceLimitException(403,'RECOVERY_REVIEW_FORBIDDEN');
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        genesisGoogleRequireFresh($reviewer);
        $q=$db->prepare('SELECT * FROM account_recovery_requests WHERE id=?');$q->execute([$id]);$row=$q->fetch();
        if(!$row||$row['state']!=='pending'||$row['expires_at']<time()||$row['user_id']===$reviewer||mb_strlen(trim($reason))<10||mb_strlen($reason)>1000
            ||genesisIsAdminUser(genesisFindUser($row['user_id']))||$row['candidate_sub']===($_SESSION['auth_identity']['sub']??''))throw new GenesisResourceLimitException(409,'RECOVERY_REVIEW_INVALID');
        if((int)genesisFindUser($row['user_id'])['security_epoch']!==(int)$row['security_epoch'])throw new GenesisResourceLimitException(409,'RECOVERY_STALE');
        $db->prepare('UPDATE account_recovery_requests SET state=?,reviewer_id=?,reason=? WHERE id=?')->execute([$approved?'approved':'rejected',$reviewer,trim($reason),$id]);
        genesisGoogleSecurityEvent($row['user_id'],$approved?'recovery-approved':'recovery-rejected',$reviewer,$id);$db->commit();unset($_SESSION['google_step_up']);
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}
function genesisGoogleCompleteRecovery(string $id,array $candidate): array
{
    if((genesisConfig()['account_recovery_enabled']??false)!==true)throw new GenesisResourceLimitException(503,'ACCOUNT_RECOVERY_DISABLED');
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        $q=$db->prepare('SELECT * FROM account_recovery_requests WHERE id=?');$q->execute([$id]);$row=$q->fetch();
        if(!$row||$row['state']!=='approved'||$row['expires_at']<time()||!hash_equals($row['candidate_sub'],(string)($candidate['sub']??''))||($candidate['email_verified']??false)!==true)throw new GenesisResourceLimitException(403,'RECOVERY_NOT_APPROVED');
        $owner=$row['user_id'];$user=genesisFindUser($owner);
        if(genesisIsAdminUser($user)||(int)$user['security_epoch']!==(int)$row['security_epoch'])throw new GenesisResourceLimitException(409,'RECOVERY_STALE');
        if($row['proof_kind']==='code'){
            $q=$db->prepare('SELECT code_hash,used_at FROM account_recovery_codes WHERE user_id=?');$q->execute([$owner]);$proof=$q->fetch();
            if(!$proof||$proof['used_at']!==null||!hash_equals($row['proof_hash'],$proof['code_hash']))throw new GenesisResourceLimitException(409,'RECOVERY_PROOF_USED');
        }
        if(genesisFindUserByGoogleSub($candidate['sub'])||genesisFindLinkedGoogleAccountBySub($candidate['sub']))throw new GenesisResourceLimitException(409,'GOOGLE_IDENTITY_OWNED');
        $new=genesisUuid();$now=genesisNow();
        $db->prepare("INSERT INTO linked_google_accounts(id,owner_user_id,google_sub,email,display_name,position,created_at,updated_at) VALUES(?,?,?,?,?,999,?,?)")->execute([$new,$owner,$candidate['sub'],$candidate['email'],$candidate['email'],$now,$now]);
        $db->prepare('UPDATE users SET primary_google_identity_id=? WHERE id=?')->execute([$new,$owner]);
        foreach(genesisGoogleAccountsForUser($user)as$account){
            if($account['id']===$new)continue;
            if(!empty($account['refresh_token_enc'])||!empty($account['access_token_enc']))$db->prepare('INSERT INTO account_security_outbox(id,user_id,kind,payload_enc,created_at) VALUES(?,?,?,?,?)')->execute([genesisUuid(),$owner,'revoke-google',genesisEncrypt(json_encode(['refresh_token_enc'=>$account['refresh_token_enc'],'access_token_enc'=>$account['access_token_enc']],JSON_THROW_ON_ERROR)),$now]);
        }
        $db->prepare('UPDATE linked_google_accounts SET login_active=0,access_token_enc=NULL,refresh_token_enc=NULL,granted_scopes=\'\' WHERE owner_user_id=? AND id<>?')->execute([$owner,$new]);
        $db->prepare('UPDATE users SET google_login_active=0,security_epoch=security_epoch+1,access_token_enc=NULL,refresh_token_enc=NULL,granted_scopes=\'\' WHERE id=?')->execute([$owner]);
        if($row['proof_kind']==='code')$db->prepare('UPDATE account_recovery_codes SET used_at=? WHERE user_id=?')->execute([$now,$owner]);
        genesisGoogleInvalidatePendingRecovery($owner);
        $db->prepare("UPDATE account_recovery_requests SET state='completed' WHERE id=?")->execute([$id]);
        genesisGoogleSecurityEvent($owner,'access-recovered',$new,$id);$db->commit();return genesisFindUser($owner);
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}

/** Reliable local queue; provider revocations and mail delivery never hold a database writer. */
function genesisSecurityOutboxRun(int $limit=5,?callable $deliver=null): array
{
    $db=genesisDb();$done=0;$retry=0;
    $q=$db->prepare("SELECT id FROM account_security_outbox WHERE state IN ('pending','processing') AND available_at<=? AND lease_until<? ORDER BY created_at LIMIT ?");
    $q->bindValue(1,time(),PDO::PARAM_INT);$q->bindValue(2,time(),PDO::PARAM_INT);$q->bindValue(3,min(20,max(1,$limit)),PDO::PARAM_INT);$q->execute();
    foreach($q->fetchAll(PDO::FETCH_COLUMN)as$id){
        $claim=$db->prepare("UPDATE account_security_outbox SET state='processing',lease_until=?,attempts=attempts+1 WHERE id=? AND lease_until<? AND state IN ('pending','processing')");$claim->execute([time()+120,$id,time()]);if($claim->rowCount()!==1)continue;
        $row=$db->prepare('SELECT * FROM account_security_outbox WHERE id=?');$row->execute([$id]);$job=$row->fetch();
        try{
            $payload=json_decode(genesisDecrypt($job['payload_enc']),true,16,JSON_THROW_ON_ERROR);
            if($deliver)$deliver($job['kind'],$payload,$id);
            elseif($job['kind']==='revoke-google')genesisRevokeGoogleToken($payload);
            else{
                if(!genesisEmailConfiguration()['available'])throw new RuntimeException('SECURITY_MAIL_NOT_CONFIGURED');
                foreach(array_unique($payload['channels']??[])as$email){
                    if(!filter_var($email,FILTER_VALIDATE_EMAIL))continue;
                    genesisEmailSend($email,'GENESIS: безопасность аккаунта','Изменены способы входа в GENESIS. Событие: '.$payload['kind'].'. Если это были не вы, свяжитесь с поддержкой: nikitalexanderson@gmail.com. Содержимое личных данных и ключи в уведомление не включены.',$id.'-'.substr(hash('sha256',$email),0,16));
                }
            }
            $db->prepare("UPDATE account_security_outbox SET state='done',payload_enc='',lease_until=0 WHERE id=?")->execute([$id]);$done++;
        }catch(Throwable){
            $db->prepare("UPDATE account_security_outbox SET state=?,available_at=?,lease_until=0 WHERE id=?")->execute([(int)$job['attempts']>=12?'attention':'pending',time()+min(86400,30*(2**min(11,(int)$job['attempts']))),$id]);$retry++;
        }
    }
    return ['done'=>$done,'retry'=>$retry];
}
