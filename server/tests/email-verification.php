<?php
declare(strict_types=1);
foreach(['bootstrap','repository','google','shared-projects'] as $module)require dirname(__DIR__).'/src/'.$module.'.php';
if(!in_array(parse_url(genesisConfig()['app_url'],PHP_URL_HOST),['127.0.0.1','localhost.invalid'],true))throw new RuntimeException('Isolated configuration required');
function verificationExpect(bool $ok,string $why):void{if(!$ok)throw new RuntimeException($why);}
$db=genesisDb();$prefix='verify-'.bin2hex(random_bytes(5));$users=[];
$make=static function(string $suffix,bool $website=false)use($prefix,&$users):array{
    $user=genesisUpsertGoogleUser(['sub'=>$prefix.$suffix,'email'=>$prefix.$suffix.'@example.invalid','email_verified'=>true,'name'=>'Synthetic'],[],false,$website);
    $users[]=$user['id'];return $user;
};
$jobs=static function(string $id)use($db):array{$q=$db->prepare('SELECT * FROM account_email_outbox WHERE user_id=? ORDER BY created_at,id');$q->execute([$id]);$rows=$q->fetchAll();$q->closeCursor();return $rows;};
try{
    $native=$make('-native');$web=$make('-web',true);
    $initial=genesisEmailRegistrationStatus($native);
    verificationExpect($initial['required']&&!$initial['confirmed']&&$initial['hasRequest']&&$initial['retryAfter']>0&&$initial['reminderDue'],'New native accounts need a queued registration and mandatory notice');
    verificationExpect(genesisUserForClient($native)['emailVerification']===$initial,'Session omitted verification status');
    for($i=0;$i<5;$i++)genesisEmailRegistrationStatus($native);
    verificationExpect(count($jobs($native['id']))===1,'Reading a notice queued additional mail');
    $settings=genesisNotificationDefaults();$settings['enabled']=false;$settings['channels']['email']=false;$settings['channels']['inbox']=false;
    $db->prepare('INSERT INTO shared_notification_preferences(user_id,settings_json,revision,updated_at) VALUES(?,?,1,?)')
        ->execute([$native['id'],json_encode($settings),genesisNow()]);
    verificationExpect(genesisEmailRegistrationStatus($native)['required'],'Optional notification settings hid account verification');
    $first=genesisEmailRequestRegistration($native['id']);
    verificationExpect(!$first['queued']&&$first['verification']['required']&&$first['verification']['hasRequest']&&$first['verification']['retryAfter']>0,'Initial queued registration did not retain cooldown');
    $retry=genesisEmailRequestRegistration($native['id']);
    verificationExpect(!$retry['queued']&&count($jobs($native['id']))===1,'Immediate retry bypassed cooldown');
    verificationExpect(!isset($first['token'])&&!str_contains(json_encode($first),'token'),'Response exposed a confirmation token');
    $oldPayload=json_decode(genesisDecrypt($jobs($native['id'])[0]['payload']),true,16,JSON_THROW_ON_ERROR);
    verificationExpect(genesisEmailConfirmRegistration($oldPayload['token']),'Fresh token is unusable');
    // An expired request can be replaced without changing account identity or other preferences.
    $db->prepare('UPDATE email_registrations SET expires_at=? WHERE user_id=?')->execute(['2000-01-01T00:00:00Z',$native['id']]);
    $second=genesisEmailRequestRegistration($native['id']);$queued=$jobs($native['id']);
    verificationExpect($second['queued']&&count($queued)===2,'Expired token cannot be resent');
    verificationExpect(!genesisEmailConfirmRegistration($oldPayload['token'],true),'Resend left old token usable');
    $fresh=null;foreach($queued as $job){$payload=json_decode(genesisDecrypt($job['payload']),true,16,JSON_THROW_ON_ERROR);if(genesisEmailConfirmRegistration($payload['token']))$fresh=$payload;}
    verificationExpect(is_array($fresh),'Replacement token is missing');
    $delivered=[];genesisAccountEmailRun(10,static function($mail,$job)use(&$delivered):string{$delivered[]=$job['user_id'];return 'accepted';});
    verificationExpect(count(array_filter($delivered,static fn($id)=>$id===$native['id']))===1,'Stale token was delivered or mandatory email inherited opt-out');
    verificationExpect(genesisEmailRegistrationStatus($native)['required'],'Sending a message confirmed the account');
    verificationExpect(genesisEmailConfirmRegistration($fresh['token'],true),'Confirmation failed');
    $confirmed=genesisEmailRegistrationStatus($native);
    verificationExpect(!$confirmed['required']&&$confirmed['confirmed']&&$confirmed['retryAfter']===0,'Confirmed account retained notice');
    verificationExpect(!genesisEmailRequestRegistration($native['id'])['queued']&&count($jobs($native['id']))===2,'Confirmed account queued another message');
    verificationExpect(genesisEmailRegistrationStatus($web)['required'],'One account confirmation leaked to another');
    $db->prepare('UPDATE users SET email=? WHERE id=?')->execute([$prefix.'-changed@example.invalid',$native['id']]);
    $changed=genesisFindUser($native['id']);
    verificationExpect(genesisEmailRegistrationStatus($changed)['required']&&!genesisEmailRegistrationStatus($changed)['confirmed'],'Changed address inherited previous confirmation');
    verificationExpect(genesisEmailRequestRegistration($native['id'])['queued'],'Changed address could not request its own confirmation');
    echo "Mandatory verification status, read-only notices, explicit send, cooldown, expired resend, token replacement, opt-out independence and account isolation passed\n";
}finally{foreach($users as $id)$db->prepare('DELETE FROM users WHERE id=?')->execute([$id]);}
