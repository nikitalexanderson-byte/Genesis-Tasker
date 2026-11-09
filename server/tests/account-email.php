<?php
declare(strict_types=1);
require_once __DIR__ . '/shared-fixture-plan.php';
foreach(['bootstrap','repository','google','shared-projects']as$module)require dirname(__DIR__).'/src/'.$module.'.php';
if(!in_array(parse_url(genesisConfig()['app_url'],PHP_URL_HOST),['127.0.0.1','localhost.invalid'],true))throw new RuntimeException('Isolated configuration required');
function emailExpect(bool $ok,string $why):void{if(!$ok)throw new RuntimeException($why);}
$db=genesisDb();$prefix='email-'.bin2hex(random_bytes(5));$users=[];$space=null;$sent=[];
$make=static function(string $suffix,bool $website)use($prefix,&$users):array{
    $user=genesisUpsertGoogleUser(['sub'=>$prefix.$suffix,'email'=>$prefix.$suffix.'@example.invalid','email_verified'=>true,'name'=>'Synthetic'],[],false,$website);$users[]=$user['id'];return$user;
};
$transport=static function(array $message,array $job)use(&$sent):string{$sent[]=['message'=>$message,'job'=>$job];return'accepted';};
try{
    $owner=$make('-owner',true);$member=$make('-member',false);
    $q=$db->prepare('SELECT * FROM account_email_outbox WHERE user_id=?');$q->execute([$owner['id']]);$registration=$q->fetch();$q->closeCursor();
    emailExpect($registration&&$registration['kind']==='registration','First website registration did not enqueue confirmation');
    genesisUpsertGoogleUser(['sub'=>$prefix.'-owner','email'=>$owner['email'],'email_verified'=>true],[],false,true);
    $q->execute([$owner['id']]);emailExpect(count($q->fetchAll())===1,'Repeat login sent a new registration email');$q->closeCursor();
    $q->execute([$member['id']]);emailExpect($q->fetch()!==false,'New native registration did not receive confirmation');$q->closeCursor();
    $payload=json_decode(genesisDecrypt($registration['payload']),true);$token=$payload['token'];
    emailExpect(!str_contains($registration['payload'],$token),'Confirmation token was stored in plaintext');
    emailExpect(genesisEmailConfirmRegistration($token),'Valid confirmation link failed');
    $q=$db->prepare('SELECT confirmed_at FROM email_registrations WHERE user_id=?');$q->execute([$owner['id']]);emailExpect($q->fetchColumn()===null,'Reading link changed registration state');$q->closeCursor();
    genesisAccountEmailRun(5,$transport);emailExpect(count($sent)===2&&in_array($owner['email'],array_column(array_column($sent,'message'),'to'),true),'Registration delivery had wrong audience');
    emailExpect(str_contains($sent[0]['message']['html'],'/api/email/confirm?token='),'Confirmation action is missing');
    emailExpect(genesisEmailConfirmRegistration($token,true)&&genesisEmailConfirmRegistration($token,true),'Confirmation is not idempotent');
    $db->prepare('UPDATE email_registrations SET expires_at=? WHERE user_id=?')->execute(['2000-01-01T00:00:00Z',$owner['id']]);emailExpect(!genesisEmailConfirmRegistration($token),'Expired token was accepted');
    emailExpect(!genesisEmailConfirmRegistration(str_repeat('f',64)),'Unknown token was accepted');
    emailExpect(str_contains(genesisEmailHtml('<script>','A&B','https://localhost.invalid/','Open','Footer'),'&lt;script&gt;'),'HTML content was not escaped');
    try{genesisEmailSend("person@example.invalid\r\nBcc: another@example.invalid",'subject','body','id');throw new RuntimeException('Header injection accepted');}catch(InvalidArgumentException){}
    foreach([$owner,$member]as$user)genesisTestEnableSharedProjects($user['id']);
    $space=genesisSharedCreateSpace($owner['id'],['title'=>'Email fixture']);$db->prepare("INSERT INTO shared_space_members(space_id,user_id,role,joined_at) VALUES(?,?,'member',?)")->execute([$space['id'],$member['id'],genesisNow()]);
    $keys=[];$encode=static fn($bytes)=>rtrim(strtr(base64_encode($bytes),'+/','-_'),'=');
    $point=['kty'=>'EC','crv'=>'P-256','x'=>$encode(hex2bin('6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296')),'y'=>$encode(hex2bin('4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5'))];
    foreach([$owner,$member]as$user)$keys[$user['id']]=genesisSharedMessagingKey($user['id'],['publicKey'=>$point])['keyId'];
    $conversation=genesisSharedPrivateConversation($owner['id'],$space['id'],['userId'=>$member['id']]);$cid=$conversation['id'];genesisSharedRespondPrivateInvitation($member['id'],$cid,['accept'=>true]);
    $settings=genesisNotificationDefaults();$settings['channels']['email']=true;
    $db->prepare('INSERT INTO shared_notification_preferences(user_id,settings_json,revision,updated_at) VALUES(?,?,1,?)')->execute([$member['id'],json_encode($settings),genesisNow()]);
    $messagePayload=['version'=>1,'iv'=>'AAAAAAAAAAAAAAAA','ciphertext'=>str_repeat('A',44),'keyIds'=>$keys];$messageId=genesisUuid();
    genesisSharedPrivateSave($owner['id'],$cid,['id'=>$messageId,'payload'=>$messagePayload]);genesisSharedPrivateSave($owner['id'],$cid,['id'=>$messageId,'payload'=>$messagePayload]);
    $q=$db->prepare("SELECT COUNT(*) FROM account_email_outbox WHERE user_id=? AND kind='private-message'");$q->execute([$member['id']]);emailExpect((int)$q->fetchColumn()===1,'Retry of message creation duplicated the email');$q->closeCursor();
    $before=count($sent);genesisAccountEmailRun(5,$transport);emailExpect(count($sent)===$before+1,'Unread private message email missing');
    $mail=$sent[array_key_last($sent)]['message'];emailExpect($mail['to']===$member['email']&&!str_contains($mail['text'],$messagePayload['ciphertext'])&&!str_contains($mail['html'],$messagePayload['ciphertext']),'Private content leaked to email');
    genesisSharedPrivateSave($owner['id'],$cid,['id'=>genesisUuid(),'payload'=>$messagePayload]);
    $q=$db->prepare('SELECT MAX(seq) FROM shared_private_messages WHERE conversation_id=?');$q->execute([$cid]);$seq=(int)$q->fetchColumn();$q->closeCursor();genesisSharedPrivateRead($member['id'],$cid,['seq'=>$seq]);
    $before=count($sent);genesisAccountEmailRun(5,$transport);emailExpect(count($sent)===$before,'Already-read private messages were emailed');
    $destination=genesisSharedPrivateDestination($member['id'],$cid);
    emailExpect($destination['peerId']===$owner['id']&&$destination['spaceId']===$space['id'],'Read conversation email link lost its destination');
    $outsider=$make('-outsider',false);genesisTestEnableSharedProjects($outsider['id']);
    try{genesisSharedPrivateDestination($outsider['id'],$cid);throw new RuntimeException('Private email link bypassed membership');}catch(GenesisSharedAccessException){}
    genesisSharedPrivateSave($owner['id'],$cid,['id'=>genesisUuid(),'payload'=>$messagePayload]);$settings['channels']['email']=false;
    genesisNotificationSavePreferences($member['id'],['settings'=>$settings,'expectedRevision'=>1]);genesisAccountEmailRun(5,$transport);
    emailExpect(count($sent)===$before+1&&$sent[array_key_last($sent)]['job']['user_id']===$outsider['id']&&$sent[array_key_last($sent)]['job']['kind']==='registration','Email opt-out did not cancel queued private notification or hid mandatory registration');
    $retry=$make('-retry',true);$q=$db->prepare('SELECT id FROM account_email_outbox WHERE user_id=?');$q->execute([$retry['id']]);$retryId=$q->fetchColumn();$q->closeCursor();
    for($i=1;$i<=5;$i++){$db->prepare("UPDATE account_email_outbox SET available_at='2000-01-01T00:00:00Z' WHERE id=?")->execute([$retryId]);genesisAccountEmailRun(1,static function(){throw new RuntimeException('Synthetic transport failure with no logging');});}
    $q=$db->prepare('SELECT state,attempts,error_code FROM account_email_outbox WHERE id=?');$q->execute([$retryId]);$failed=$q->fetch();$q->closeCursor();
    emailExpect($failed['state']==='failed'&&(int)$failed['attempts']===5&&$failed['error_code']==='EMAIL_RETRY','Retries were unbounded or persisted transport details');
    $status=genesisNotificationSettings($retry['id']);emailExpect(count(array_filter($status['delivery'],static fn($row)=>$row['channel']==='email'&&$row['state']==='failed'&&(int)$row['count']===1))===1,'Failed account email is missing in settings');
    $caps=genesisNotificationCapabilities();$caps['email']['available']=true;
    emailExpect(genesisNotificationRetry($retry['id'],$caps)['resumed']===1,'Failed registration email did not resume');
    genesisAccountEmailRun(1,$transport);emailExpect($sent[array_key_last($sent)]['message']['to']===$retry['email'],'Resumed account email did not reach transport');
    $settings['channels']['email']=true;$settings['types']['comments']=false;$settings['emailTypes']['comments']=true;
    $db->prepare('UPDATE shared_notification_preferences SET settings_json=? WHERE user_id=?')->execute([json_encode($settings),$member['id']]);
    $project=genesisSharedCreateProject($owner['id'],$space['id'],['title'=>'Independent email types']);$pid=$project['id'];
    $db->prepare("INSERT INTO shared_project_members(project_id,user_id,role,joined_at) VALUES(?,?,'member',?)")->execute([$pid,$member['id'],genesisNow()]);
    $open=genesisSharedProjectSnapshot($owner['id'],$pid)['statuses'][0]['id'];
    $task=genesisSharedTask($owner['id'],$pid,['title'=>'Synthetic private title','statusId'=>$open]);genesisSharedTaskWatch($member['id'],$pid,$task['id'],['watching'=>true]);
    $comment=genesisSharedAddComment($owner['id'],$pid,$task['id'],['body'=>'Synthetic private comment']);
    $q=$db->prepare("SELECT id FROM shared_audit_events WHERE object_id=? AND action='comment.created'");$q->execute([$comment['id']]);$event=$q->fetchColumn();$q->closeCursor();
    $countChannel=static function(string $channel)use($db,$member,$event):int{$sql=genesisNotificationInboxSql($member['id'],null,true,false,$channel);$q=$db->prepare('SELECT COUNT(*)'.$sql['from'].$sql['where'].' AND e.id=:event');$q->execute($sql['values']+['event'=>$event]);$n=(int)$q->fetchColumn();$q->closeCursor();return$n;};
    emailExpect($countChannel('inbox')===0&&$countChannel('email')===1,'Email inherited disabled inbox comment type');
    $deliveryId=genesisUuid();$db->prepare("INSERT INTO shared_notification_outbox(id,user_id,channel,target_id,bucket_key,available_at,created_at,updated_at) VALUES(?,?,'email','email',?,?,?,?)")->execute([$deliveryId,$member['id'],'event:'.$event,genesisNow(),genesisNow(),genesisNow()]);
    $db->prepare("INSERT INTO shared_notification_delivery_items(delivery_id,event_id,user_id,channel,target_id) VALUES(?,?,?,'email','email')")->execute([$deliveryId,$event,$member['id']]);
    emailExpect(genesisNotificationDeliver(['deliveryId'=>$deliveryId],static function($channel,$to,$message)use($member):string{emailExpect($channel==='email'&&$to===$member['email']&&!str_contains(json_encode($message),'Synthetic private'),'Email delivery leaked content or used wrong channel');return'accepted';})==='succeeded','Email-only comment was not delivered');
    $settings['types']['comments']=true;$settings['emailTypes']['comments']=false;$db->prepare('UPDATE shared_notification_preferences SET settings_json=? WHERE user_id=?')->execute([json_encode($settings),$member['id']]);
    emailExpect($countChannel('inbox')===1&&$countChannel('email')===0,'Disabled email type was ignored');
    $preferences=genesisNotificationPreferences($member['id']);$legacy=$preferences['settings'];unset($legacy['emailTypes']);
    $legacy['types']['comments']=false;
    $saved=genesisNotificationSavePreferences($member['id'],['settings'=>$legacy,'expectedRevision'=>$preferences['revision']]);
    emailExpect(!$saved['settings']['emailTypes']['comments']&&$saved['settings']['emailTypes']['messages'],'Old client overwrote independently configured email categories');
    echo "Registration idempotency, token expiry, transport safety, message privacy, read/opt-out cancellation, bounded retries/resume/status and independent email types passed\n";
}finally{
    if($space)$db->prepare('DELETE FROM shared_spaces WHERE id=?')->execute([$space['id']]);
    foreach($users as$id)$db->prepare('DELETE FROM users WHERE id=?')->execute([$id]);
}
