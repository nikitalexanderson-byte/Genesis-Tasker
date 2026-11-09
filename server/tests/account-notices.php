<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit(1);
$fixture=sys_get_temp_dir().'/genesis-notices-test-'.bin2hex(random_bytes(8));mkdir($fixture,0700);mkdir($fixture.'/sessions',0700);
$config=['app_url'=>'https://localhost.invalid','db_path'=>$fixture.'/genesis.sqlite','session_path'=>$fixture.'/sessions','crypto_key'=>base64_encode(random_bytes(32)),'cookie_secure'=>false,'timezone'=>'UTC','admin_email'=>'admin@example.invalid','notifications'=>['email'=>['transport'=>'disabled']]];
file_put_contents($fixture.'/config.php','<?php return '.var_export($config,true).';');define('GENESIS_LOCAL_TEST_CONFIG',$fixture.'/config.php');
foreach(['bootstrap','repository','shared-projects']as$module)require dirname(__DIR__).'/src/'.$module.'.php';
function noticesExpect(bool $value,string $reason):void{if(!$value)throw new RuntimeException($reason);}
$db=genesisDb();$now=genesisNow();
$make=static fn(string $id)=>genesisUpsertGoogleUser(['sub'=>'notices-'.$id,'email'=>$id.'@example.invalid','email_verified'=>true,'name'=>'Synthetic'],[],false);
$db->prepare('INSERT INTO users(id,google_sub,email,created_at,updated_at) VALUES(?,?,?,?,?)')->execute(['legacy','notices-legacy','legacy@example.invalid','2026-01-01T00:00:00Z',$now]);
$legacy=genesisFindUser('legacy');genesisEmailRequestRegistration('legacy');
noticesExpect(genesisEmailRegistrationStatus($legacy)['deadlineAt']===null,'Legacy resend enrolled an established account for deletion.');
$new=$make('new');$confirmed=$make('confirmed');$admin=$make('admin');
noticesExpect(genesisEmailRegistrationStatus($new)['hasRequest'],'Native-created account did not queue confirmation.');
noticesExpect(!genesisEmailRegistrationStatus($admin)['required'],'Administrator received a mandatory registration notice.');
$status=genesisEmailRegistrationStatus($new);
noticesExpect($status['deadlineAt']===null,'Verification still advertises the retired five-day deletion deadline.');
$dismissed=genesisEmailDismissRegistration($new['id'])['verification'];
noticesExpect(!$dismissed['reminderDue']&&abs(strtotime($dismissed['dismissedUntil'])-time()-86400)<3,'Dismissal did not suppress a full day.');
$db->prepare('UPDATE email_verification_dismissals SET dismissed_until=? WHERE user_id=?')->execute(['2000-01-01T00:00:00Z',$new['id']]);
noticesExpect(genesisEmailRegistrationStatus($new)['reminderDue'],'Daily reminder did not return.');
$db->prepare('UPDATE email_registrations SET confirmed_at=? WHERE user_id=?')->execute([$now,$confirmed['id']]);
$db->exec("UPDATE email_registration_lifecycle SET deadline_at='2000-01-01T00:00:00Z'");
// Even an accidentally imported cohort row cannot make an administrator eligible.
$db->prepare('INSERT INTO email_registration_lifecycle VALUES(?,?,?,?)')->execute([$admin['id'],$admin['email'],$now,'2000-01-01T00:00:00Z']);
$purged=genesisEmailPurgeUnconfirmed();
noticesExpect($purged['deleted']===0&&genesisFindUser($new['id'])!==null,'Retired verification purge still removes an unconfirmed account without a retention warning.');
foreach(['legacy',$confirmed['id'],$admin['id']]as$id)noticesExpect(genesisFindUser($id)!==null,'A protected historical/confirmed/admin account was removed.');
noticesExpect((int)$db->query("SELECT COUNT(*) FROM email_verification_dismissals")->fetchColumn()===1,'Verification purge changed reminder data.');
foreach(['free'=>'daily','standart'=>'weekly','premium'=>'monthly','business'=>'monthly','premium4life'=>'monthly']as$plan=>$cadence){
 $db->prepare('UPDATE users SET subscription_plan=?,subscription_valid_until=? WHERE id=?')->execute([$plan,'2099-01-01T00:00:00Z','legacy']);
 $user=genesisFindUser('legacy');noticesExpect(genesisSupportNoticeCadence($user)===$cadence,'Incorrect cadence for '.$plan);
 $db->exec('DELETE FROM support_notices');$first=genesisSupportNoticeClaim('legacy','web');$retry=genesisSupportNoticeClaim('legacy','web');
 noticesExpect($first['show']&&!$retry['show']&&$first['nextAt']===$retry['nextAt'],'Repeat claim bypassed cadence.');
 noticesExpect(genesisSupportNoticeClaim('legacy','android')['show']&&genesisSupportNoticeClaim('legacy','phone')['show'],'Requested notification surfaces were not independent.');
}
$db->exec("UPDATE users SET subscription_plan='free',forecast_elite_plus=1 WHERE id='legacy'");
noticesExpect(genesisSupportNoticeCadence(genesisFindUser('legacy'))==='daily','A stale legacy flag overrode the canonical plan.');
// Migration118 and the owner-only grant route persist both parts of the combined Elite+ plan.
$db->exec("UPDATE users SET subscription_plan='premium4life',subscription_valid_until=NULL WHERE id='legacy'");
noticesExpect(genesisSupportNoticeCadence(genesisFindUser('legacy'))==='monthly','Elite+ received free-plan daily tips.');
noticesExpect(genesisSupportNoticeNext('monthly',strtotime('2027-01-31T12:34:00Z'))==='2027-02-28T12:34:00Z','Monthly cadence overflowed a short month.');
$source=new PDO('sqlite:'.$fixture.'/genesis.sqlite');$backup=$fixture.'/backup.sqlite';$source->exec('VACUUM INTO '.$source->quote($backup));
$copy=new PDO('sqlite:'.$backup);noticesExpect((int)$copy->query('SELECT COUNT(*) FROM support_notices')->fetchColumn()===3,'Backup omitted notice cadence.');
noticesExpect(!$db->query('PRAGMA foreign_key_check')->fetch(),'Foreign keys broken.');
echo "Account notices: retired five-day purge, historic/admin/confirmed protection, daily dismiss/reappear, queued native email, per-plan and per-surface cadence, calendar-month edge and backup passed.\n";
