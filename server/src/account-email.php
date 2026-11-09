<?php
declare(strict_types=1);
require_once __DIR__.'/email-transport.php';

function genesisAccountEmailQueue(string $userId,string $kind,string $key,array $payload,?string $available=null): void
{
    $now=genesisNow();
    genesisDb()->prepare('INSERT OR IGNORE INTO account_email_outbox(id,user_id,kind,unique_key,payload,available_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
        ->execute([genesisUuid(),$userId,$kind,$key,genesisEncrypt(json_encode($payload,JSON_THROW_ON_ERROR)),$available??$now,$now,$now]);
}

/** Enrollment is passed only by the genuine new-user branch, never a resend. */
function genesisEmailQueueRegistration(string $userId,bool $enroll=false): void
{
    $user=genesisFindUser($userId);if(!$user)return;
    if(genesisIsAdminUser($user))return;
    // Confirmation verifies the address; it no longer enrolls an account in the
    // retired five-day purge. Account retention has its own month-long warning.
    $token=bin2hex(random_bytes(32));$now=genesisNow();$expires=gmdate('Y-m-d\TH:i:s\Z',time()+172800);
    $q=genesisDb()->prepare('INSERT OR IGNORE INTO email_registrations(user_id,email,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)');
    $q->execute([$userId,$user['email'],hash('sha256',$token),$expires,$now]);
    if(genesisDb()->query('SELECT changes()')->fetchColumn())genesisAccountEmailQueue($userId,'registration','registration:'.$userId,['email'=>$user['email'],'token'=>$token]);
    genesisEmailScheduleDelivery();
}

function genesisEmailConfirmRegistration(string $token,bool $confirm=false): bool
{
    if(!preg_match('/\A[a-f0-9]{64}\z/D',$token))return false;
    $db=genesisDb();$q=$db->prepare('SELECT r.user_id,r.confirmed_at FROM email_registrations r JOIN users u ON u.id=r.user_id AND u.email=r.email WHERE r.token_hash=? AND r.expires_at>=?');
    $q->execute([hash('sha256',$token),genesisNow()]);$row=$q->fetch();$q->closeCursor();if(!$row)return false;
    if($confirm)$db->prepare('UPDATE email_registrations SET confirmed_at=COALESCE(confirmed_at,?) WHERE user_id=? AND token_hash=? AND expires_at>=?')
        ->execute([genesisNow(),$row['user_id'],hash('sha256',$token),genesisNow()]);
    return true;
}

function genesisEmailRegistrationLanguage(string $token): string
{
    if(!preg_match('/\A[a-f0-9]{64}\z/D',$token))return 'ru';
    $q=genesisDb()->prepare('SELECT u.language FROM email_registrations r JOIN users u ON u.id=r.user_id WHERE r.token_hash=?');
    $q->execute([hash('sha256',$token)]);$language=$q->fetchColumn();$q->closeCursor();
    return in_array($language,['ru','en','el','de','fr','es','it','pt','pl','sr','uk','zh','tr','ja'],true)?$language:'ru';
}

/** Account notices are mandatory and independent of optional notification preferences. */
function genesisEmailRegistrationStatus(array $user): array
{
    $q=genesisDb()->prepare('SELECT confirmed_at,expires_at FROM email_registrations WHERE user_id=? AND email=?');
    $q->execute([$user['id'],$user['email']]);$row=$q->fetch();$q->closeCursor();
    $confirmed=is_array($row)&&$row['confirmed_at']!==null;
    $required=genesisIsValidEmail((string)$user['email'])&&!genesisIsAdminUser($user)&&!$confirmed;
    // Expiry is always issued-at + 48h; deriving cooldown preserves the original created_at.
    $issued=is_array($row)?strtotime($row['expires_at'])-172800:0;
    $retry=$required?max(0,min(60,$issued+60-time())):0;
    $q=genesisDb()->prepare('SELECT dismissed_until FROM email_verification_dismissals WHERE user_id=?');
    $q->execute([$user['id']]);$until=$q->fetchColumn();$q->closeCursor();$until=$until===false?null:$until;
    return ['required'=>$required,'confirmed'=>$confirmed,'hasRequest'=>is_array($row),'retryAfter'=>$retry,
        'reminderDue'=>$required&&($until===null||strtotime($until)<=time()),'dismissedUntil'=>$until,
        'deadlineAt'=>null];
}

function genesisEmailDismissRegistration(string $userId): array
{
    $user=genesisFindUser($userId);if(!$user)throw new DomainException('AUTH_REQUIRED');
    // Dismissing a historic account never enrolls it for deletion.
    genesisDb()->prepare('INSERT INTO email_verification_dismissals(user_id,dismissed_until) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET dismissed_until=excluded.dismissed_until')
        ->execute([$userId,gmdate('Y-m-d\TH:i:s\Z',time()+86400)]);
    return ['verification'=>genesisEmailRegistrationStatus($user)];
}

/** SMTP starts after the registration response and transaction have finished. */
function genesisEmailScheduleDelivery(): void
{
    static $scheduled=false;
    if($scheduled||PHP_SAPI==='cli'||!function_exists('fastcgi_finish_request'))return;
    $scheduled=true;register_shutdown_function(static function():void{
        try{
            if(genesisDb()->inTransaction())return;
            if(session_status()===PHP_SESSION_ACTIVE)session_write_close();
            fastcgi_finish_request();genesisAccountEmailRun(2);
        }catch(Throwable){/* Durable outbox/cron retries; never print tokens or mail. */}
    });
}

/** Compatibility for old cron callers. Unconfirmed registration alone never
 * deletes an account; the retention worker requires an accepted month's notice. */
function genesisEmailPurgeUnconfirmed(int $limit=20): array
{
    return ['deleted'=>0,'protected'=>0,'retired'=>true];
}

/** Only an explicit authenticated action queues mail; reading a reminder never does. */
function genesisEmailRequestRegistration(string $userId): array
{
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try {
        $user=genesisFindUser($userId);if(!$user)throw new DomainException('AUTH_REQUIRED');
        $status=genesisEmailRegistrationStatus($user);
        if(!$status['required']||$status['retryAfter']>0){$db->commit();return ['verification'=>$status,'queued'=>false];}
        $token=bin2hex(random_bytes(32));$hash=hash('sha256',$token);$now=genesisNow();
        $db->prepare('INSERT INTO email_registrations(user_id,email,token_hash,expires_at,created_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,token_hash=excluded.token_hash,expires_at=excluded.expires_at,confirmed_at=NULL')
            ->execute([$userId,$user['email'],$hash,gmdate('Y-m-d\TH:i:s\Z',time()+172800),$now]);
        genesisAccountEmailQueue($userId,'registration','registration:'.$userId.':'.$hash,['email'=>$user['email'],'token'=>$token]);
        $status=genesisEmailRegistrationStatus($user);$db->commit();genesisEmailScheduleDelivery();
        return ['verification'=>$status,'queued'=>true];
    } catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}

/** No message body or key leaves the encrypted conversation. */
function genesisEmailQueuePrivateMessage(array $conversation,string $senderId,string $messageId): void
{
    $recipient=$conversation['user_a']===$senderId?$conversation['user_b']:$conversation['user_a'];
    $settings=genesisNotificationPreferences($recipient)['settings'];
    if(!$settings['channels']['email']||empty($settings['emailTypes']['messages']))return;
    $available=genesisNotificationScheduleAt($settings);$db=genesisDb();
    $key='message:'.$recipient.':'.$conversation['id'].':'.($settings['frequency']==='immediate'?$messageId:$available);
    $q=$db->prepare('SELECT state FROM account_email_outbox WHERE unique_key=?');$q->execute([$key]);$state=$q->fetchColumn();$q->closeCursor();
    if($state!==false&&$state!=='pending')$key.=':'.$messageId;
    genesisAccountEmailQueue($recipient,'private-message',$key,['conversationId'=>$conversation['id']],$available);
}

/** Resolve access and preferences again immediately before external delivery. */
function genesisAccountEmailMessage(array $job): ?array
{
    $user=genesisFindUser($job['user_id']);if(!$user)return null;
    $payload=json_decode((string)genesisDecrypt($job['payload']),true,16,JSON_THROW_ON_ERROR);
    $origin=rtrim(genesisConfig()['app_url'],'/');$language=$user['language']??'ru';
    $copy=static fn(string $key):string=>genesisNotificationCopy($key,$language);
    if($job['kind']==='registration'){
        if($user['email']!==($payload['email']??null)||!genesisEmailConfirmRegistration($payload['token']??''))return null;
        $q=genesisDb()->prepare('SELECT confirmed_at FROM email_registrations WHERE user_id=?');$q->execute([$user['id']]);$confirmed=$q->fetchColumn();$q->closeCursor();if($confirmed!==null)return null;
        $title=$copy('Подтвердите регистрацию в GENESIS');
        $text=$copy('Ваш аккаунт создан через Google. Подтвердите регистрацию. Ссылка действует 48 часов.');
        $url=$origin.'/api/email/confirm?token='.rawurlencode($payload['token']);
        $action=$copy('Подтвердить регистрацию');
        $footer='';
    }else{
        $settings=genesisNotificationPreferences($user['id'])['settings'];
        if(!$settings['channels']['email']||empty($settings['emailTypes']['messages']))return null;
        try{genesisSharedPrivateAccess($user['id'],$payload['conversationId']);}catch(GenesisSharedAccessException){return null;}
        $q=genesisDb()->prepare('SELECT COUNT(*) FROM shared_private_messages m LEFT JOIN shared_private_message_reads r ON r.conversation_id=m.conversation_id AND r.user_id=? WHERE m.conversation_id=? AND m.sender_id<>? AND m.deleted_at IS NULL AND m.seq>COALESCE(r.last_read_seq,0)');
        $q->execute([$user['id'],$payload['conversationId'],$user['id']]);$count=(int)$q->fetchColumn();$q->closeCursor();if(!$count)return null;
        $title=$copy('Новые личные сообщения в GENESIS');
        $text=$copy('Откройте GENESIS, чтобы прочитать сообщения. Переписка остаётся зашифрованной.');
        $url=$origin.'/?conversation='.rawurlencode($payload['conversationId']);$action=$copy('Открыть сообщения');
        $footer=$copy('Настройки писем доступны в личном кабинете GENESIS.');
    }
    return ['to'=>$user['email'],'subject'=>$title,'text'=>$text."\n\n".$url."\n\n".$footer,'html'=>genesisEmailHtml($title,$text,$url,$action,$footer)];
}

/** A short independent lease keeps SMTP outside SQLite write transactions. */
function genesisAccountEmailRun(int $limit=5,?callable $transport=null): array
{
    if($transport===null&&!genesisEmailConfiguration()['available'])return ['processed'=>0,'configured'=>false];
    $db=genesisDb();$result=['processed'=>0,'accepted'=>0,'cancelled'=>0,'failed'=>0];$started=microtime(true);
    for($i=0;$i<max(1,min(20,$limit))&&microtime(true)-$started<40;$i++){
        genesisBeginWriteTransaction($db);
        try{
            $now=genesisNow();
            $db->prepare("UPDATE account_email_outbox SET state=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,lease_token=NULL,lease_until=NULL,error_code='EMAIL_LEASE_EXPIRED' WHERE state='running' AND lease_until<?")->execute([$now]);
            $q=$db->prepare("SELECT * FROM account_email_outbox WHERE state='pending' AND available_at<=? ORDER BY CASE WHEN kind='registration' THEN 0 ELSE 1 END,available_at,id LIMIT 1");$q->execute([$now]);$job=$q->fetch();$q->closeCursor();
            if(!$job){$db->commit();break;}
            $lease=bin2hex(random_bytes(16));$db->prepare("UPDATE account_email_outbox SET state='running',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=? WHERE id=?")
                ->execute([$lease,gmdate('Y-m-d\TH:i:s\Z',time()+120),$now,$job['id']]);$db->commit();
        }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
        $state='cancelled';$code=null;$available=$now;
        try{
            $message=genesisAccountEmailMessage($job);
            if($message&&$job['kind']==='private-message'){
                $quiet=genesisNotificationQuietUntil(genesisNotificationPreferences($job['user_id'])['settings']);
                if($quiet!==null){$message=null;$state='pending';$available=$quiet;}
            }
            if($message){
                $sent=$transport?$transport($message,$job):genesisEmailSend($message['to'],$message['subject'],$message['text'],$job['id'],$message['html']);
                if($sent!=='accepted')throw new RuntimeException('EMAIL_RETRY');$state='accepted';
            }
        }catch(Throwable){$state=(int)$job['attempts']+1>=5?'failed':'pending';$code='EMAIL_RETRY';$available=gmdate('Y-m-d\TH:i:s\Z',time()+min(3600,60*2**(int)$job['attempts']));}
        $db->prepare('UPDATE account_email_outbox SET state=?,available_at=?,lease_token=NULL,lease_until=NULL,error_code=?,updated_at=?,attempts=CASE WHEN ? THEN MAX(0,attempts-1) ELSE attempts END WHERE id=? AND lease_token=?')
            ->execute([$state,$available,$code,genesisNow(),$state==='pending'&&$code===null?1:0,$job['id'],$lease]);
        $result['processed']++;if(isset($result[$state]))$result[$state]++;
    }
    return $result;
}
