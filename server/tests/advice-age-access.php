<?php
declare(strict_types=1);
if(getenv('GENESIS_IMPROVEMENTS_TEST')!=='isolated'&&!getenv('GENESIS_SMOKE_ROOT'))throw new RuntimeException('Isolated environment required.');
require dirname(__DIR__).'/src/bootstrap.php';
require dirname(__DIR__).'/src/repository.php';
require dirname(__DIR__).'/src/shared-projects.php';

function ageAssert(bool $ok,string $message):void {if(!$ok)throw new RuntimeException($message);}
function ageReject(callable $action):void {try{$action();}catch(InvalidArgumentException){return;}throw new RuntimeException('Invalid age preference accepted');}
$policy=genesisAdviceAgePolicy();$published=[...$policy,'corpusEnabled'=>true];
$defaults=genesisPsychopompiaPreferences([]);$psych=[...$defaults,'adultConfirmed'=>true];
$entry=['id'=>'advice-'.substr(hash('sha256','synthetic-psychopompia'),0,24),'body'=>'Synthetic exact preserved text.','title'=>'Synthetic title','language'=>'en','sources'=>[],
    'categories'=>['psychopompia'],'requiresAdult'=>true,'containsAlcohol'=>false,'subcategories'=>['inner-work'],'review'=>['status'=>'cleared'],'status'=>'published'];
$prefs=genesisAdvicePreferences(['psychopompia'=>$psych]);
ageAssert($policy['corpusEnabled']===true,'Reviewed first Psychopompia release must be enabled');
ageAssert(!$defaults['adultConfirmed']&&!$defaults['alcohol']['consent']&&$defaults['alcohol']['countryCode']==='','Consent or jurisdiction was inferred');
ageAssert(genesisPsychopompiaAllowed($entry,$prefs,$published),'Explicit18+ nonalcohol entry should be eligible after publication');
ageAssert(!genesisPsychopompiaAllowed($entry,$prefs,[...$policy,'corpusEnabled'=>false]),'Disabled corpus became accessible');
foreach([['RU','',18],['GB','',18],['US','',21],['JP','',20],['TH','',20],['KR','',19],['CA','CA-ON',19],['CA','CA-MB',18],['IN','IN-DL',25],['ID','ID-BA',21],['AE','AE-DU',21]]as[$country,$subdivision,$age]){
    $wine=[...$psych,'alcohol'=>['consent'=>true,'countryCode'=>$country,'subdivisionCode'=>$subdivision,'ageAtLeast'=>$age,'policyVersion'=>$policy['policyVersion']]];
    ageAssert(genesisAdviceAlcoholAllowed($wine),"Verified threshold rejected: $country/$subdivision");
    ageAssert(!genesisAdviceAlcoholAllowed([...$wine,'alcohol'=>[...$wine['alcohol'],'ageAtLeast'=>$age===18?19:18]]),'A different age threshold was accepted');
    ageAssert(!genesisAdviceAlcoholAllowed([...$wine,'alcohol'=>[...$wine['alcohol'],'policyVersion'=>'2025-01-01']]),'Stale policy consent survived');
}
foreach([['ZZ',''],['CA',''],['IN','IN-KA'],['ID','ID-AC'],['AE','AE-SH'],['KW',''],['IR',''],['SA',''],['RS','']]as[$country,$subdivision]){
    $unknown=[...$psych,'alcohol'=>['consent'=>true,'countryCode'=>$country,'subdivisionCode'=>$subdivision,'ageAtLeast'=>25,'policyVersion'=>$policy['policyVersion']]];
    ageAssert(!genesisAdviceAlcoholAllowed($unknown),'Unknown/blocked jurisdiction defaulted to an age');
    ageAssert(genesisPsychopompiaAllowed($entry,[...$prefs,'psychopompia'=>$unknown],$published),'Unknown jurisdiction blocked nonalcohol18+ content');
    ageAssert(!genesisPsychopompiaAllowed([...$entry,'containsAlcohol'=>true],[...$prefs,'psychopompia'=>$unknown],$published),'Unknown jurisdiction admitted alcohol');
}
foreach([['categories'=>['aretology']],['requiresAdult'=>false],['containsAlcohol'=>null],['status'=>'draft'],['review'=>['status'=>'unreviewed']],['review'=>['status'=>'blocked']],['subcategories'=>[]],['subcategories'=>['unknown']]]as$bad)
    ageAssert(!genesisPsychopompiaAllowed([...$entry,...$bad],$prefs,$published),'Missing/blocked review metadata admitted an entry');
ageAssert(!genesisPsychopompiaAllowed($entry,[...$prefs,'psychopompia'=>[...$psych,'subcategories'=>[]]],$published),'Empty selected subcategories admitted an entry');
foreach([$entry,[...$entry,'categories'=>['aphrodisia']],[...$entry,'categories'=>['aretology'],'requiresAdult'=>false,'containsAlcohol'=>true]]as$adult)
    ageAssert(!genesisAdviceNotificationSafe($adult),'Adult content admitted to notifications');
foreach([['adultConfirmed'=>'true'],['subcategories'=>['unknown']],['subcategories'=>[[]]],['alcohol'=>['consent'=>'true']],['alcohol'=>['countryCode'=>'en']],['alcohol'=>['countryCode'=>'US','subdivisionCode'=>'CA-ON']],['alcohol'=>['ageAtLeast'=>22]],['birthday'=>'2000-01-01']]as$bad)ageReject(fn()=>genesisPsychopompiaPreferences($bad));

// Additive migration/back-up/code rollback contract, using synthetic in-memory data only.
$legacy=new PDO('sqlite::memory:',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
$legacy->exec("CREATE TABLE users(id TEXT PRIMARY KEY,advice_preferences_json TEXT NOT NULL DEFAULT '{}',advice_collections_json TEXT NOT NULL DEFAULT '[\"aurora\"]',advice_notifications_json TEXT NOT NULL DEFAULT '{}')");
$legacy->exec("INSERT INTO users(id,advice_preferences_json) VALUES('synthetic-age','{\"enabled\":true,\"smart\":true}')");
$backupPath=tempnam(sys_get_temp_dir(),'genesis-age-98-');ageAssert(is_string($backupPath),'Cannot create migration backup fixture');
try{
    $legacy->exec('VACUUM INTO '.$legacy->quote($backupPath));
    $legacy->beginTransaction();$legacy->exec(file_get_contents(dirname(__DIR__).'/migrations/098_advice_psychopompia.sql'));$legacy->commit();
    $legacy->exec("UPDATE users SET advice_psychopompia_json='{\"adultConfirmed\":true}' WHERE id='synthetic-age'");
    $legacy->exec("UPDATE users SET advice_preferences_json='{\"enabled\":false,\"smart\":true}' WHERE id='synthetic-age'");
    $row=$legacy->query('SELECT * FROM users')->fetch();ageAssert(genesisUserAdvicePreferences($row)['psychopompia']['adultConfirmed'],'Legacy writer erased the new consent column');
    ageAssert(!array_key_exists('psychopompia',json_decode($row['advice_preferences_json'],true)),'Legacy strict JSON gained a new key');
    $backup=new PDO('sqlite:'.$backupPath);ageAssert($backup->query('PRAGMA integrity_check')->fetchColumn()==='ok','Migration backup invalid');
    ageAssert(!in_array('advice_psychopompia_json',array_column($backup->query('PRAGMA table_info(users)')->fetchAll(PDO::FETCH_ASSOC),'name'),true),'Backup is post-migration');
}finally{$backup=null;if(is_file($backupPath))unlink($backupPath);}

$db=genesisDb();$user='test-age-'.bin2hex(random_bytes(4));$day='2026-11-01';
try{
    $db->prepare('INSERT INTO users(id,google_sub,email,language,created_at,updated_at) VALUES(?,?,?,?,?,?)')->execute([$user,$user,$user.'@example.invalid','en',genesisNow(),genesisNow()]);
    $db->prepare("UPDATE users SET subscription_plan='premium4life' WHERE id=?")->execute([$user]);
    genesisUpdateAccountPreferences($user,['advicePreferences'=>['psychopompia'=>$psych]]);
    $saved=genesisFindUser($user);ageAssert(genesisUserAdvicePreferences($saved)['psychopompia']===$psych,'Account did not persist separate psych preferences');
    ageAssert(!array_key_exists('psychopompia',json_decode($saved['advice_preferences_json'],true)),'New consent leaked into old preference JSON');
    $blockedEntry=[...$entry,'review'=>['status'=>'unreviewed']];
    $json=json_encode($blockedEntry,JSON_THROW_ON_ERROR);$selection=json_encode(['enabled'=>true,'smart'=>true,'categories'=>['psychopompia']],JSON_THROW_ON_ERROR);
    $db->prepare('INSERT INTO daily_advice_entries(user_id,day_key,slot,advice_id,entry_json,created_at) VALUES(?,?,?,?,?,?)')->execute([$user,$day,1,$entry['id'],$json,genesisNow()]);
    $db->prepare('INSERT INTO daily_advice_days(user_id,day_key,advice_id,entry_json,created_at,draw_limit,selection_json) VALUES(?,?,?,?,?,?,?)')->execute([$user,$day,$entry['id'],$json,genesisNow(),3,$selection]);
    ageAssert(genesisSavedAdvice($user,['id'=>$entry['id'],'dayKey'=>$day,'collection'=>'aurora'])['advice']===null,'Saved API leaked unapproved historical content');
    genesisRecordAdvice($user,['id'=>$entry['id'],'dayKey'=>$day],false);
    ageAssert($db->query('SELECT viewed_at FROM daily_advice_entries WHERE user_id='.$db->quote($user))->fetchColumn()===null,'Blocked content changed a view counter');
    $today=genesisDailyAdvice($user,[],[],false,new DateTimeImmutable($day.'T12:00:00+03:00'));
    ageAssert($today['advice']===null&&$today['history']===[],'Today/history leaked blocked content');
    genesisDailyAdvice($user,['fromId'=>$entry['id'],'dayKey'=>$day],[],true,new DateTimeImmutable($day.'T12:00:00+03:00'));
    ageAssert($db->query('SELECT viewed_at FROM daily_advice_entries WHERE user_id='.$db->quote($user))->fetchColumn()===null,'Advancing a blocked entry changed its view counter');
    ageAssert((int)$db->query('SELECT COUNT(*) FROM daily_advice_entries WHERE user_id='.$db->quote($user))->fetchColumn()===1,'Gate removed historical content');
}finally{$db->prepare('DELETE FROM users WHERE id=?')->execute([$user]);}
echo "Advice age access: PASS (jurisdiction, consent, review, notification exclusion, migration backup/rollback, account persistence and blocked API history/saved/view).\n";
