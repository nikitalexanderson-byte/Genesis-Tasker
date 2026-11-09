<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit(1);
$fixture=sys_get_temp_dir().'/genesis-access314-'.bin2hex(random_bytes(6));mkdir($fixture,0700,true);mkdir($fixture.'/sessions',0700);
define('GENESIS_LOCAL_TEST_CONFIG',$fixture.'/config.php');
file_put_contents(GENESIS_LOCAL_TEST_CONFIG,'<?php return '.var_export(['app_url'=>'https://fixture.invalid','db_path'=>$fixture.'/test.sqlite',
    'session_path'=>$fixture.'/sessions','cookie_secure'=>false,'crypto_key'=>base64_encode(random_bytes(32)),'admin_email'=>'admin@example.invalid'],true).';');
require dirname(__DIR__).'/src/bootstrap.php';require dirname(__DIR__).'/src/repository.php';
require dirname(__DIR__).'/src/subscriptions.php';require dirname(__DIR__).'/src/diary.php';require dirname(__DIR__).'/src/billing-api.php';require dirname(__DIR__).'/src/play-testing.php';
function access314(bool $ok,string $why):void{if(!$ok)throw new RuntimeException($why);}
function reject314(string $code,callable $action):void{try{$action();throw new RuntimeException('Expected rejection: '.$code);}catch(GenesisResourceLimitException|DomainException|InvalidArgumentException $error){access314($error->getMessage()===$code,'Wrong rejection: '.$error->getMessage());}}
function user314(string $id,string $plan='free'):array{
    $now=genesisNow();genesisDb()->prepare('INSERT INTO users(id,google_sub,email,display_name,auth_provider,subscription_plan,subscription_valid_until,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
        ->execute([$id,'sub-'.$id,$id.'@example.invalid',$id,'google',$plan,in_array($plan,['standart','premium','business'])?'2030-01-01T00:00:00Z':null,$now,$now]);return genesisFindUser($id);
}
$db=genesisDb();$admin=user314('admin','premium4life');$user=user314('new-web');$native=user314('new-native');
access314($user['subscription_plan']==='free'&&$native['subscription_plan']==='free','New registration is not Free');
foreach(['free','standart','premium','business','premium4life'] as $plan){$test=genesisResolveFeatureAccess(['subscription_plan'=>$plan,'subscription_valid_until'=>'2030-01-01T00:00:00Z'],genesisFeatureAccessPolicy(),time());
    access314(in_array('physis',$test['allowedFeatures'],true)===($plan==='premium4life'),'Physis must be lifetime-only');access314(!in_array('assistant',$test['allowedFeatures'],true),'AI was enabled');}
$_SESSION=['user_id'=>'admin','auth_identity'=>['kind'=>'primary','sub'=>'sub-admin']];
foreach(['standart','premium','business','premium4life'] as $plan){$before=genesisFindUser('new-web')['subscription_plan'];genesisAdminSetSubscription('admin','new-web',$plan,$before);
    access314(genesisFeatureAccessForUser(genesisFindUser('new-web'))['effectivePlan']!== 'free','Admin assignment is ineffective');}
$revision=(int)genesisSubscriptionState($db,genesisFindUser('new-web'))['revision'];
genesisAdminResetSubscription('admin','new-web','premium4life',$revision);
reject314('SUBSCRIPTION_STATUS_CONFLICT',fn()=>genesisAdminResetSubscription('admin','new-web','free',$revision));
access314(genesisFindUser('new-web')['subscription_plan']==='free','Reset failed');

// Server census and encrypted document writes share one writer transaction and revision.
$usage=['personal-projects'=>['p1','p2','p3','p4','p5'],'habits'=>['h1','h2','h3','h4','h5']];
$db->beginTransaction();genesisWorkspaceResourceCensus('new-native',['quotaUsage'=>$usage],1,false);$db->commit();
reject314('SUBSCRIPTION_QUOTA_personal-projects',function()use($db,$usage){$db->beginTransaction();try{genesisWorkspaceResourceCensus('new-native',['quotaUsage'=>[...$usage,'personal-projects'=>[...$usage['personal-projects'],'p6']]],2,true);}finally{$db->rollBack();}});
reject314('WORKSPACE_UPGRADE_REQUIRED',fn()=>genesisWorkspaceResourceCensus('new-native',[],2,true));
genesisWorkspaceResourceCensus('new-native',['quotaUsage'=>$usage],2,true);

// Saved quotes are excluded from the diary quota only after proving that the account drew them.
$body=['expectedRevision'=>0,'schemaVersion'=>1,'iv'=>base64_encode(random_bytes(12)),'ciphertext'=>base64_encode(random_bytes(128))];
for($i=0;$i<100;$i++)genesisSaveDiaryNote('new-native','note-'.$i,$body);
reject314('SUBSCRIPTION_QUOTA_diary',fn()=>genesisSaveDiaryNote('new-native','one-too-many',$body));
$quote=['id'=>array_key_first(genesisPhilosopherArtwork()),'body'=>'A synthetic quote.','language'=>'ru','categories'=>[],'sources'=>[],'collection'=>'philosophers'];
$db->prepare('UPDATE users SET advice_collections_json=? WHERE id=?')->execute(['["philosophers"]','new-native']);
$draw=genesisDailyAdvice('new-native',[],[$quote]);access314($draw['dailyLimit']===1,'Philosophers-only default allowance is not one');
genesisSaveDiaryNote('new-native','saved-quote',[...$body,'adviceId'=>$quote['id']]);
reject314('DIARY_ADVICE_ALREADY_SAVED',fn()=>genesisSaveDiaryNote('new-native','duplicate-quote',[...$body,'adviceId'=>$quote['id']]));
reject314('DIARY_ADVICE_NOT_DRAWN',fn()=>genesisSaveDiaryNote('new-native','fake-quote',[...$body,'adviceId'=>'advice-'.str_repeat('b',24)]));
genesisSaveDiaryNote('new-native','note-0',[...$body,'expectedRevision'=>1,'ciphertext'=>base64_encode(random_bytes(256))]);
access314((int)$db->query("SELECT COUNT(*) FROM personal_diary_notes WHERE user_id='new-native'")->fetchColumn()===101,'Quota lost existing notes');

// Free's Aurora allowance stays one; philosopher quotas are separate account/day counters.
$freeAdvicePool=[];
$readyPhilosopherIds=array_keys(genesisPhilosopherArtwork());
for($i=0;$i<5;$i++){
    $freeAdvicePool[]=['id'=>'advice-'.substr(hash('sha256','free-Aurora-'.$i),0,24),'body'=>'Synthetic safe Aurora '.$i,'language'=>'ru','categories'=>['aretology'],'sources'=>[],'collection'=>'aurora'];
    $freeAdvicePool[]=[...$quote,'id'=>$readyPhilosopherIds[$i],'body'=>'Synthetic philosopher '.$i];
}
$freeMixed=user314('free-advice-mixed');
$freeDay=genesisDailyAdvice($freeMixed['id'],[],$freeAdvicePool);
access314($freeDay['dailyLimit']===1&&$freeDay['sequence']===1&&!$freeDay['canNext']&&$freeDay['advice']['collection']==='aurora','Free Aurora-only allowance changed');
genesisUpdateAccountPreferences($freeMixed['id'],['advicePreferences'=>['collections'=>['aurora','philosophers']]]);
$freeDay=genesisDailyAdvice($freeMixed['id'],[],$freeAdvicePool);
access314($freeDay['dailyLimit']===2&&$freeDay['sequence']===1&&$freeDay['canNext'],'Free mixed collections did not add one aphorism to the used Aurora slot');
$freeDay=genesisDailyAdvice($freeMixed['id'],['fromId'=>$freeDay['advice']['id'],'dayKey'=>$freeDay['dayKey']],$freeAdvicePool,true);
$freeCounts=array_count_values(array_column($freeDay['history'],'collection'));
access314($freeDay['sequence']===2&&$freeDay['dailyLimit']===2&&!$freeDay['canNext']&&($freeCounts['aurora']??0)===1&&($freeCounts['philosophers']??0)===1,'Free mixed mode failed to provide exactly Aurora1 plus aphorism1');
// The configurable maximum remains three; the default is one since 3.2.0.
genesisUpdateAccountPreferences($freeMixed['id'],['advicePreferences'=>['collections'=>['philosophers'],'philosophersPerDay'=>3]]);
$freeDay=genesisDailyAdvice($freeMixed['id'],[],$freeAdvicePool);
for($slot=3;$slot<=4;$slot++){
    access314($freeDay['canNext'],'Free standalone aphorisms inherited the global Free1 restriction');
    $freeDay=genesisDailyAdvice($freeMixed['id'],['fromId'=>$freeDay['advice']['id'],'dayKey'=>$freeDay['dayKey']],$freeAdvicePool,true);
    access314($freeDay['sequence']===$slot&&$freeDay['dailyLimit']===4,'Free collection switch reset or lost already spent slots');
}
access314(count($freeDay['history'])===3&&!$freeDay['canNext']&&count(array_unique(array_column($freeDay['history'],'id')))===3,'Free switch did not stop at three total daily aphorisms');
genesisUpdateAccountPreferences($freeMixed['id'],['advicePreferences'=>['collections'=>['aurora','philosophers']]]);
access314(!genesisDailyAdvice($freeMixed['id'],[],$freeAdvicePool)['canNext'],'Free switch reset an exhausted Aurora or philosopher counter');
access314((int)$db->query("SELECT draw_limit FROM daily_advice_days WHERE user_id='free-advice-mixed'")->fetchColumn()===1,'Free original persisted Aurora allowance was overwritten');
$freeOnly=user314('free-advice-philosophers');
genesisUpdateAccountPreferences($freeOnly['id'],['advicePreferences'=>['collections'=>['philosophers'],'philosophersPerDay'=>3]]);
$freeDay=genesisDailyAdvice($freeOnly['id'],[],$freeAdvicePool);
for($slot=1;$slot<=3;$slot++){
    access314($freeDay['dailyLimit']===3&&$freeDay['sequence']===$slot&&$freeDay['advice']['collection']==='philosophers','Free philosophers-only mode did not offer three daily aphorisms');
    if($slot<3)$freeDay=genesisDailyAdvice($freeOnly['id'],['fromId'=>$freeDay['advice']['id'],'dayKey'=>$freeDay['dayKey']],$freeAdvicePool,true);
}
$freeRetry=genesisDailyAdvice($freeOnly['id'],['fromId'=>$freeDay['advice']['id'],'dayKey'=>$freeDay['dayKey']],$freeAdvicePool,true);
access314(!$freeRetry['canNext']&&$freeRetry['sequence']===3&&$freeRetry['advice']['id']===$freeDay['advice']['id']&&count($freeRetry['history'])===3,'Free fourth aphorism or retry bypassed the account/day quota');
access314((int)$db->query("SELECT draw_limit FROM daily_advice_days WHERE user_id='free-advice-philosophers'")->fetchColumn()===1,'Standalone philosopher allowance replaced the stored Free Aurora budget');

// A provider-authenticated testing grant is bound to this one-use account challenge.
$tester=user314('play-tester');$stamp=gmdate('Y-m-d\TH:i:s\Z');$now=time();
$configuration=['version_codes'=>[122],'certificate_sha256'=>['synthetic-certificate']];
$challenge=['id'=>'challenge','user_id'=>$tester['id'],'request_hash'=>'synthetic-request','version_code'=>122,'created_at'=>$stamp,'expires_at'=>gmdate('Y-m-d\TH:i:s\Z',$now+120),'consumed_at'=>null];
$db->prepare('INSERT INTO billing_play_challenges(id,user_id,request_hash,version_code,created_at,expires_at)VALUES(?,?,?,?,?,?)')->execute(array_slice(array_values($challenge),0,6));
$verified=['requestDetails'=>['requestPackageName'=>'ru.genesis.calendar','requestHash'=>'synthetic-request','timestampMillis'=>(string)($now*1000)],
    'appIntegrity'=>['packageName'=>'ru.genesis.calendar','appRecognitionVerdict'=>'PLAY_RECOGNIZED','versionCode'=>'122','certificateSha256Digest'=>['synthetic-certificate']],
    'accountDetails'=>['appLicensingVerdict'=>'LICENSED']];
foreach(['UNLICENSED','UNEVALUATED'] as $verdict)reject314('PLAY_TEST_INTEGRITY_REJECTED',fn()=>genesisPlayTestingValidate([...$verified,'accountDetails'=>['appLicensingVerdict'=>$verdict]],$challenge,$configuration,$now));
reject314('PLAY_TEST_INTEGRITY_REJECTED',fn()=>genesisPlayTestingValidate([...$verified,'appIntegrity'=>[...$verified['appIntegrity'],'versionCode'=>'123']],$challenge,$configuration,$now));
genesisPlayTestingApply($db,$tester,'challenge',$verified,$configuration,$now);
access314(genesisFindUser($tester['id'])['subscription_plan']==='premium4life'&&genesisBillingLifetimeAvailability($db)['remaining']===12,'Tester consumed a paid lifetime place');
reject314('PLAY_TEST_CHALLENGE_EXPIRED',fn()=>genesisPlayTestingApply($db,$tester,'challenge',$verified,$configuration,$now));
genesisSubscriptionRevoke($db,genesisFindUser($tester['id']),$stamp);$db->prepare('DELETE FROM users WHERE id=?')->execute([$tester['id']]);
$recreated=user314('tester-recreated');$db->prepare('UPDATE users SET google_sub=?,email=? WHERE id=?')->execute([$tester['google_sub'],$tester['email'],$recreated['id']]);
access314(genesisSubscriptionRevokedAt($db,genesisFindUser($recreated['id']))!==null,'Re-registration lost revocation');
access314(genesisFindUser($recreated['id'])['subscription_plan']==='free','Re-registration restored lifetime');
echo "PASS access 3.1.4: Free defaults, default aphorism1, Aurora1 plus aphorism1, configured standalone aphorisms3, no-reset collection switches, frozen Free Aurora1 budget, lifetime-only Physis, disabled AI, admin assignments/reset/CAS, atomic quotas, diary advice exclusion, verified Play grants, replay rejection, separate twelve seats and durable revocation.\n";
