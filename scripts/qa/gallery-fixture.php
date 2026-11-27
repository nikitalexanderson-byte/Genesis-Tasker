<?php
declare(strict_types=1);
// Adds ordinary Free demo accounts only to an explicitly owned loopback QA runtime.
if(PHP_SAPI!=='cli')exit(1);
$options=getopt('',['dir:']);$directory=str_replace('\\','/',(string)realpath((string)($options['dir']??'')));
$owner=json_decode((string)file_get_contents($directory.'/owner.json'),true,16,JSON_THROW_ON_ERROR);
if(($owner['synthetic']??false)!==true||($owner['directory']??'')!==$directory
    ||!preg_match('~\Ahttp://127\.0\.0\.1:\d+$~D',$owner['origin']??'')
    ||!hash_equals($owner['configSha256'],hash_file('sha256',$directory.'/config.php')))throw new RuntimeException('Owned loopback fixture required');
define('GENESIS_LOCAL_TEST_CONFIG',$directory.'/config.php');
foreach(['bootstrap','repository'] as $module)require_once dirname(__DIR__,2).'/server/src/'.$module.'.php';
if(genesisConfig()['db_path']!==$directory.'/genesis.sqlite')throw new RuntimeException('Database isolation mismatch');
$fixture=json_decode(file_get_contents($directory.'/users.json'),true,16,JSON_THROW_ON_ERROR);
foreach(['ru','en','el','de','fr','es','it','pt','pl','sr','uk','zh','tr','ja','he','ar','ko','nl'] as $language){
    $tier='gallery-'.$language;$id='qa-'.$owner['runId'].'-'.$tier;$email='demo-'.$language.'@example.invalid';
    genesisDb()->prepare("INSERT OR IGNORE INTO users(id,google_sub,email,display_name,auth_provider,subscription_plan,shared_projects_enabled,calendar_mode,task_calendar_mode,language,created_at,updated_at) VALUES(?,?,?,'GENESIS Demo','google','free',0,'profane','profane',?,?,?)")
        ->execute([$id,'synthetic-'.$id,$email,$language,genesisNow(),genesisNow()]);
    $user=genesisEnsureWorkspaceKey(genesisFindUser($id));
    if(!$user||$user['subscription_plan']!=='free'||genesisIsAdminUser($user)||genesisSharedTester($user))throw new RuntimeException('Ordinary Free account required');
    genesisDb()->prepare('INSERT OR IGNORE INTO email_registrations(user_id,email,token_hash,expires_at,confirmed_at,created_at) VALUES(?,?,?,?,?,?)')
        ->execute([$id,$email,hash('sha256','synthetic-gallery-'.$id),'2035-01-01T00:00:00Z',genesisNow(),genesisNow()]);
    // Demo accounts represent ordinary use after the introductory plan notice.
    // Keep Free entitlements unchanged while preventing a timed notice over a screenshot.
    genesisDb()->prepare('INSERT INTO plan_guidance_state(user_id,last_shown_at,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET last_shown_at=excluded.last_shown_at')
        ->execute([$id,genesisNow(),genesisNow()]);
    $fixture['users'][$tier]=['id'=>$id,'plan'=>'free','role'=>'ordinary-user','validUntil'=>null,'loginPath'=>'/api/qa/login?tier='.$tier];
}
file_put_contents($directory.'/users.json',json_encode($fixture,JSON_PRETTY_PRINT|JSON_THROW_ON_ERROR),LOCK_EX);
echo "All isolated Free gallery accounts ready; external delivery disabled.\n";
