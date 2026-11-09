<?php
declare(strict_types=1);
require_once __DIR__ . '/web-push.php';
require_once __DIR__ . '/email-transport.php';

const GENESIS_NOTIFICATION_TYPES = ['created','projects','comments','assignment','mentions','dueSoon','overdue','approvalRequest','approvalResult','changes'];

function genesisNotificationDefaults(): array
{
    return ['types'=>array_fill_keys(GENESIS_NOTIFICATION_TYPES,true),'channels'=>['inbox'=>true,'push'=>false,'email'=>false],
        'emailTypes'=>array_fill_keys([...GENESIS_NOTIFICATION_TYPES,'messages'],true),
        'frequency'=>'immediate','digestTime'=>'09:00','quiet'=>['enabled'=>false,'start'=>'22:00','end'=>'08:00'],
        'timeZone'=>genesisConfig()['timezone']??'UTC','timeZoneMode'=>'device','reminderDays'=>1];
}

function genesisNotificationPreferences(string $userId): array
{
    $q=genesisDb()->prepare('SELECT settings_json,revision FROM shared_notification_preferences WHERE user_id=?');$q->execute([$userId]);$row=$q->fetch();$q->closeCursor();
    $settings=$row?json_decode($row['settings_json'],true,16,JSON_THROW_ON_ERROR):genesisNotificationDefaults();
    $settings['emailTypes']=array_replace([...$settings['types'],'messages'=>true],$settings['emailTypes']??[]);
    return ['settings'=>$settings,'revision'=>(int)($row['revision']??0)];
}

function genesisNotificationCapabilities(): array
{
    $push=genesisPushConfiguration();$email=genesisConfig()['notifications']['email']??[];
    $mail=genesisEmailConfiguration()['available'];
    return ['push'=>array_intersect_key($push,array_flip(['available','blocker','publicKey'])),
        'email'=>['available'=>(bool)$mail,...($mail?[]:['blocker'=>'EMAIL_TRANSPORT_UNCONFIGURED'])]];
}

function genesisNotificationValidateSettings(mixed $input): array
{
    if(!is_array($input))throw new InvalidArgumentException('INVALID_NOTIFICATION_SETTINGS');$result=genesisNotificationDefaults();
    foreach(['types'=>GENESIS_NOTIFICATION_TYPES,'channels'=>['inbox','push','email']]as$key=>$names){
        if(!is_array($input[$key]??null)||array_diff(array_keys($input[$key]),$names))throw new InvalidArgumentException('INVALID_NOTIFICATION_SETTINGS');
        foreach($names as$name){if(!is_bool($input[$key][$name]??null))throw new InvalidArgumentException('INVALID_NOTIFICATION_SETTINGS');$result[$key][$name]=$input[$key][$name];}
    }
    $emailTypes=$input['emailTypes']??[...$result['types'],'messages'=>true];
    if(!is_array($emailTypes)||array_diff(array_keys($emailTypes),[...GENESIS_NOTIFICATION_TYPES,'messages']))throw new InvalidArgumentException('INVALID_NOTIFICATION_SETTINGS');
    foreach([...GENESIS_NOTIFICATION_TYPES,'messages']as$kind){if(!is_bool($emailTypes[$kind]??null))throw new InvalidArgumentException('INVALID_NOTIFICATION_SETTINGS');$result['emailTypes'][$kind]=$emailTypes[$kind];}
    if(!in_array($input['frequency']??'', ['immediate','hourly','daily'],true)||!is_int($input['reminderDays']??null)||$input['reminderDays']<0||$input['reminderDays']>30)throw new InvalidArgumentException('INVALID_NOTIFICATION_SETTINGS');
    $result['frequency']=$input['frequency'];$result['reminderDays']=$input['reminderDays'];
    $zone=$input['timeZone']??null;
    if(!is_string($zone)||!in_array($zone,DateTimeZone::listIdentifiers(DateTimeZone::ALL_WITH_BC),true))throw new InvalidArgumentException('INVALID_NOTIFICATION_TIMEZONE');
    $result['timeZone']=$zone;
    $mode=$input['timeZoneMode']??'fixed';if(!in_array($mode,['device','fixed'],true))throw new InvalidArgumentException('INVALID_NOTIFICATION_SETTINGS');$result['timeZoneMode']=$mode;
    if(!is_bool($input['quiet']['enabled']??null))throw new InvalidArgumentException('INVALID_NOTIFICATION_SETTINGS');
    $result['quiet']['enabled']=$input['quiet']['enabled'];
    foreach(['digestTime','start','end']as$field){$value=$field==='digestTime'?($input[$field]??null):($input['quiet'][$field]??null);
        if(!is_string($value)||!preg_match('/\A(?:[01][0-9]|2[0-3]):[0-5][0-9]\z/D',$value))throw new InvalidArgumentException('INVALID_NOTIFICATION_SETTINGS');
        if($field==='digestTime')$result[$field]=$value;else$result['quiet'][$field]=$value;
    }
    if($result['quiet']['enabled']&&$result['quiet']['start']===$result['quiet']['end'])throw new InvalidArgumentException('INVALID_NOTIFICATION_SETTINGS');
    return$result;
}

function genesisNotificationSavePreferences(string $userId,array $input): array
{
    if(!genesisFindUser($userId))throw new GenesisSharedAccessException();$settings=genesisNotificationValidateSettings($input['settings']??null);$capabilities=genesisNotificationCapabilities();
    if(!is_int($input['expectedRevision']??null))throw new InvalidArgumentException('INVALID_NOTIFICATION_SETTINGS');
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        $current=genesisNotificationPreferences($userId);if($current['revision']!==$input['expectedRevision'])throw new GenesisSharedAccessException('NOTIFICATION_SETTINGS_CONFLICT',409);
        // Older clients do not know about the separate email categories.
        if(!array_key_exists('emailTypes',$input['settings']))$settings['emailTypes']=$current['settings']['emailTypes'];
        foreach(['push','email']as$channel)if($settings['channels'][$channel]&&!$current['settings']['channels'][$channel]&&!$capabilities[$channel]['available'])throw new GenesisSharedAccessException($capabilities[$channel]['blocker'],409);
        $db->prepare('INSERT INTO shared_notification_preferences(user_id,settings_json,revision,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET settings_json=excluded.settings_json,revision=excluded.revision,updated_at=excluded.updated_at')
            ->execute([$userId,json_encode($settings,JSON_THROW_ON_ERROR),$current['revision']+1,genesisNow()]);
        // An explicit opt-out cancels queued external work. Inbox history and read state remain intact.
        foreach(['push','email']as$channel)if(!$settings['channels'][$channel])$db->prepare("UPDATE shared_notification_outbox SET state='cancelled',updated_at=? WHERE user_id=? AND channel=? AND state='pending'")->execute([genesisNow(),$userId,$channel]);
        $db->commit();return genesisNotificationSettings($userId);
    }catch(Throwable$e){if($db->inTransaction())$db->rollBack();throw$e;}
}

/** Only the device timezone is reported; manual recipient preferences always win. */
function genesisNotificationDeviceContext(string $userId,array $input): array
{
    genesisSharedRequireEnabled($userId);$preferences=genesisNotificationPreferences($userId);$zone=$input['timeZone']??null;
    if(!is_string($zone)||!in_array($zone,DateTimeZone::listIdentifiers(DateTimeZone::ALL_WITH_BC),true))throw new InvalidArgumentException('INVALID_NOTIFICATION_TIMEZONE');
    if(($preferences['settings']['timeZoneMode']??'fixed')!=='device'||$preferences['settings']['timeZone']===$zone)return['ok'=>true];
    $settings=$preferences['settings'];$settings['timeZone']=$zone;genesisNotificationSavePreferences($userId,['settings'=>$settings,'expectedRevision'=>$preferences['revision']]);return['ok'=>true];
}

function genesisNotificationSettings(string $userId): array
{
    if(!genesisFindUser($userId))throw new GenesisSharedAccessException();$q=genesisDb()->prepare('SELECT id,last_error AS lastError FROM shared_push_subscriptions WHERE user_id=? ORDER BY created_at DESC LIMIT 20');$q->execute([$userId]);$subscriptions=$q->fetchAll();$q->closeCursor();
    $q=genesisDb()->prepare("SELECT channel,state,COUNT(*) AS count FROM shared_notification_outbox WHERE user_id=? AND state IN ('pending','failed') GROUP BY channel,state");$q->execute([$userId]);$delivery=$q->fetchAll();$q->closeCursor();
    $q=genesisDb()->prepare("SELECT 'email' AS channel,CASE WHEN state='running' THEN 'pending' ELSE state END AS state,COUNT(*) AS count FROM account_email_outbox WHERE user_id=? AND state IN ('pending','running','failed') GROUP BY 2");$q->execute([$userId]);$accountDelivery=$q->fetchAll();$q->closeCursor();$totals=[];
    foreach([...$delivery,...$accountDelivery]as$item){$key=$item['channel'].':'.$item['state'];if(!isset($totals[$key]))$totals[$key]=['channel'=>$item['channel'],'state'=>$item['state'],'count'=>0];$totals[$key]['count']+=(int)$item['count'];}$delivery=array_values($totals);
    $user=genesisFindUser($userId);
    return [...genesisNotificationPreferences($userId),'capabilities'=>genesisNotificationCapabilities(),'subscriptions'=>$subscriptions,'delivery'=>$delivery,
        'context'=>['language'=>$user['language']??'ru','calendarMode'=>$user['calendar_mode']??'profane','gregorianYearStart'=>$user['gregorian_year_start']??'january','timeFormat'=>$user['time_format']??'24h']];
}

function genesisNotificationQuietUntil(array $settings,?string $now=null): ?string
{
    if(!$settings['quiet']['enabled'])return null;
    $time=(new DateTimeImmutable($now??genesisNow()))->setTimezone(new DateTimeZone($settings['timeZone']));$clock=$time->format('H:i');$start=$settings['quiet']['start'];$end=$settings['quiet']['end'];
    $quiet=$start<$end?($clock>=$start&&$clock<$end):($clock>=$start||$clock<$end);if(!$quiet)return null;
    [$hour,$minute]=array_map('intval',explode(':',$end));$until=$time->setTime($hour,$minute,0);
    if($until<=$time)$until=$until->modify('+1 day');
    return$until->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');
}

function genesisNotificationScheduleAt(array $settings,?string $now=null): string
{
    $now??=genesisNow();$time=(new DateTimeImmutable($now))->setTimezone(new DateTimeZone($settings['timeZone']));
    if($settings['frequency']==='hourly')$time=$time->setTimestamp($time->getTimestamp()+(3600-(int)$time->format('i')*60-(int)$time->format('s')));
    if($settings['frequency']==='daily'){
        [$hour,$minute]=array_map('intval',explode(':',$settings['digestTime']));$candidate=$time->setTime($hour,$minute,0);$time=$candidate>$time?$candidate:$candidate->modify('+1 day');
    }
    $scheduled=$time->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');return genesisNotificationQuietUntil($settings,$scheduled)??$scheduled;
}

function genesisNotificationPushRegister(string $userId,array $input): array
{
    genesisSharedRequireEnabled($userId);$capabilities=genesisNotificationCapabilities();if(!$capabilities['push']['available'])throw new GenesisSharedAccessException($capabilities['push']['blocker'],409);
    $subscription=genesisPushSubscription($input);$db=genesisDb();$now=genesisNow();$hash=hash('sha256',$subscription['endpoint']);genesisBeginWriteTransaction($db);
    try{
        $q=$db->prepare('SELECT id,user_id FROM shared_push_subscriptions WHERE endpoint_hash=?');$q->execute([$hash]);$old=$q->fetch();$q->closeCursor();
        // A browser endpoint belongs to its explicitly authenticated current account.
        if($old&&$old['user_id']!==$userId){$db->prepare('DELETE FROM shared_push_subscriptions WHERE id=?')->execute([$old['id']]);$old=false;}
        if(!$old){$q=$db->prepare('SELECT COUNT(*) FROM shared_push_subscriptions WHERE user_id=?');$q->execute([$userId]);$count=(int)$q->fetchColumn();$q->closeCursor();if($count>=20)throw new GenesisSharedAccessException('PUSH_DEVICE_LIMIT',409);}
        $id=$old['id']??genesisUuid();
        $db->prepare('INSERT INTO shared_push_subscriptions(id,user_id,endpoint_hash,payload,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at,last_error=NULL')
            ->execute([$id,$userId,$hash,genesisSharedContentEncrypt(json_encode($subscription,JSON_THROW_ON_ERROR)),$now,$now]);
        $db->commit();return['id'=>$id];
    }catch(Throwable$e){if($db->inTransaction())$db->rollBack();throw$e;}
}

function genesisNotificationPushDelete(string $userId,string $id): void
{
    genesisSharedRequireEnabled($userId);$db=genesisDb();genesisBeginWriteTransaction($db);
    try{$db->prepare('DELETE FROM shared_push_subscriptions WHERE id=? AND user_id=?')->execute([$id,$userId]);
        $db->prepare("UPDATE shared_notification_outbox SET state='cancelled',updated_at=? WHERE user_id=? AND channel='push' AND target_id=? AND state='pending'")->execute([genesisNow(),$userId,$id]);$db->commit();
    }catch(Throwable$e){if($db->inTransaction())$db->rollBack();throw$e;}
}
