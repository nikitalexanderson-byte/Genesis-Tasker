<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit(1);
$fixture=sys_get_temp_dir().'/genesis-dream-test-'.bin2hex(random_bytes(8));mkdir($fixture,0700);mkdir($fixture.'/sessions',0700);
$config=['app_url'=>'https://localhost.invalid','db_path'=>$fixture.'/genesis.sqlite','session_path'=>$fixture.'/sessions','crypto_key'=>base64_encode(random_bytes(32)),'cookie_secure'=>false,'timezone'=>'UTC'];
file_put_contents($fixture.'/config.php','<?php return '.var_export($config,true).';');define('GENESIS_LOCAL_TEST_CONFIG',$fixture.'/config.php');
require dirname(__DIR__).'/src/bootstrap.php';require dirname(__DIR__).'/src/repository.php';require dirname(__DIR__).'/src/diary.php';
$db=genesisDb();$now=genesisNow();
foreach(['free','standart','premium','expired'] as $id){
    $db->prepare('INSERT INTO users(id,google_sub,email,display_name,created_at,updated_at,subscription_plan,subscription_valid_until) VALUES(?,?,?,?,?,?,?,?)')
        ->execute([$id,$id,$id.'@example.invalid','Synthetic',$now,$now,$id==='expired'?'premium':$id,$id==='free'?null:($id==='expired'?'2000-01-01T00:00:00Z':'2099-01-01T00:00:00Z')]);
}
$today=genesisDreamClock('UTC')['today'];$future=(new DateTimeImmutable($today,new DateTimeZone('UTC')))->modify('+1 day')->format('Y-m-d');
$body=['schemaVersion'=>1,'expectedRevision'=>0,'iv'=>base64_encode(random_bytes(12)),'ciphertext'=>base64_encode(random_bytes(256)),
    'dream'=>['day'=>$today,'timeZone'=>'UTC']];
$mode=$argv[1]??'';
if($mode==='free'||$mode==='expired'){genesisSaveDiaryNote($mode,'blocked',$body);throw new RuntimeException('Unpaid dream write accepted.');}
if($mode==='voice-standard'){genesisRequireFeature('standart','dream-voice');throw new RuntimeException('Standard voice accepted.');}
if($mode==='palette-standard'){genesisUpdateAccountPreferences('standart',['darkPalette'=>'violet']);throw new RuntimeException('Standard palette accepted.');}
function dreamExpect(bool $yes,string $message):void{if(!$yes)throw new RuntimeException($message);}
function dreamDenied(string $mode):void{
    $pipes=[];$process=proc_open([PHP_BINARY,'-c',php_ini_loaded_file(),__FILE__,$mode],[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);
    if(!is_resource($process))throw new RuntimeException('Could not run isolated authorization check.');
    fclose($pipes[0]);$output=stream_get_contents($pipes[1]);$errors=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);$code=proc_close($process);
    dreamExpect($code===0&&$errors===''&&json_decode($output,true)['error']==='FEATURE_SUBSCRIPTION_REQUIRED','Authorization did not fail closed: '.$mode);
}
foreach(['free','expired','voice-standard','palette-standard'] as $mode)dreamDenied($mode);
genesisRequireFeature('premium','dream-voice');
dreamExpect(genesisUserForClient(genesisFindUser('standart'))['darkPalette']==='green','Existing account palette changed.');
genesisUpdateAccountPreferences('premium',['darkPalette'=>'violet']);dreamExpect(genesisUserForClient(genesisFindUser('premium'))['darkPalette']==='violet','Premium palette not saved.');
genesisUpdateAccountPreferences('standart',['darkPalette'=>'green']);
dreamExpect(genesisSaveDiaryNote('standart','dream',$body)['revision']===1,'Standard text dream denied.');
dreamExpect(genesisSaveDiaryNote('standart','dream',$body)['revision']===1,'Dream replay changed receipt.');
dreamExpect(genesisDiaryNotes('premium')===[],'Dream escaped owner scope.');
$past=[...$body,'dream'=>['day'=>'2024-02-29','timeZone'=>'Europe/Moscow']];
dreamExpect(genesisSaveDiaryNote('standart','backdated',$past)['revision']===1,'Past dream denied.');
foreach([['day'=>'2026-02-29','timeZone'=>'UTC'],['day'=>'2026-04-31','timeZone'=>'UTC'],['day'=>$today,'timeZone'=>'Unknown/Zone'],['day'=>$today,'timeZone'=>'UTC','body'=>'plaintext']] as $invalid){
    try{genesisSaveDiaryNote('standart','invalid',[...$body,'dream'=>$invalid]);throw new RuntimeException('Invalid dream date accepted.');}catch(InvalidArgumentException){}
}
try{genesisSaveDiaryNote('standart','future',[...$body,'dream'=>['day'=>$future,'timeZone'=>'UTC']]);throw new RuntimeException('Future dream accepted.');}
catch(GenesisResourceLimitException $error){dreamExpect($error->getMessage()==='DREAM_FUTURE_DATE','Wrong future-date error.');}
$without=$body;unset($without['dream']);$without['expectedRevision']=1;
try{genesisSaveDiaryNote('standart','dream',$without);throw new RuntimeException('Stripped persisted dream metadata.');}catch(InvalidArgumentException){}
$changed=[...$body,'expectedRevision'=>1,'dream'=>['day'=>'2020-01-01','timeZone'=>'UTC']];
dreamExpect(genesisSaveDiaryNote('standart','dream',$changed)['revision']===2,'Metadata change did not increment revision.');
try{genesisSaveDiaryNote('standart','dream',$body);throw new RuntimeException('Old metadata replay accepted.');}catch(GenesisResourceLimitException $error){dreamExpect($error->getMessage()==='DIARY_REVISION_CONFLICT','Wrong replay conflict.');}
$db->exec('VACUUM INTO '.$db->quote($fixture.'/backup.sqlite'));$backup=new PDO('sqlite:'.$fixture.'/backup.sqlite');
dreamExpect((int)$backup->query('SELECT COUNT(*) FROM personal_diary_dreams')->fetchColumn()===2,'Backup omitted dream dates.');
dreamExpect(genesisDreamSettings('standart')===['todayMode'=>'off','revision'=>0],'Existing account opted in.');
dreamExpect(genesisUpdateDreamSettings('standart',['todayMode'=>'morning','expectedRevision'=>0])['dreamSettings']['revision']===1,'Morning setting not saved.');
dreamExpect(genesisUpdateDreamSettings('standart',['todayMode'=>'morning','expectedRevision'=>0])['dreamSettings']['revision']===1,'Lost receipt retry incremented settings.');
try{genesisUpdateDreamSettings('standart',['todayMode'=>'all-day','expectedRevision'=>0]);throw new RuntimeException('Stale settings overwrote newer device.');}
catch(GenesisResourceLimitException $error){dreamExpect($error->getMessage()==='DREAM_SETTINGS_CONFLICT','Wrong setting conflict.');}
dreamExpect(genesisDreamSettings('premium')['todayMode']==='off','Dream preferences escaped owner.');
foreach([['todayMode'=>'always','expectedRevision'=>1],['todayMode'=>'morning','expectedRevision'=>1,'lucid'=>true]] as $invalid){
    try{genesisUpdateDreamSettings('standart',$invalid);throw new RuntimeException('Invalid dream setting accepted.');}catch(InvalidArgumentException){}
}
dreamExpect(count($db->query('PRAGMA table_info(personal_diary_settings)')->fetchAll())===6,'Old diary layout changed; code rollback incompatible.');
$db->exec('VACUUM INTO '.$db->quote($fixture.'/preferences-backup.sqlite'));$preferencesBackup=new PDO('sqlite:'.$fixture.'/preferences-backup.sqlite');
dreamExpect($preferencesBackup->query("SELECT today_mode FROM dream_journal_preferences WHERE user_id='standart'")->fetchColumn()==='morning','Backup omitted preferences.');
$columns=$db->query('PRAGMA table_info(personal_diary_dreams)')->fetchAll(PDO::FETCH_COLUMN,1);
foreach(['body','title','audio','transcript'] as $field)dreamExpect(!in_array($field,$columns,true),'Plaintext dream data stored.');
genesisDeleteDiaryNote('standart','dream',['expectedRevision'=>2]);dreamExpect((int)$db->query('SELECT COUNT(*) FROM personal_diary_dreams')->fetchColumn()===1,'Dream metadata survived note deletion.');
$db->exec("DELETE FROM users WHERE id='standart'");dreamExpect((int)$db->query('SELECT COUNT(*) FROM personal_diary_dreams')->fetchColumn()===0,'Dream metadata survived account deletion.');
dreamExpect((int)$db->query('SELECT COUNT(*) FROM dream_journal_preferences')->fetchColumn()===0,'Dream preferences survived account deletion.');
echo "Dreams: server day, past/future dates, paid/voice/palette gates, owner isolation, ciphertext, replay/CAS, backup and deletion passed.\n";
