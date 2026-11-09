<?php
declare(strict_types=1);
// Isolated service, SQLite concurrency and real localhost API tests; never use private config.
if(PHP_SAPI!=='cli')exit(1);
$guidanceChecks=0;
function guidanceExpect(bool $ok,string $message):void {
    global $guidanceChecks;if(!$ok)throw new RuntimeException($message);$guidanceChecks++;
}
function guidanceReject(string $code,callable $operation):void {
    try{$operation();}catch(InvalidArgumentException $error){guidanceExpect($error->getMessage()===$code,'Wrong validation rejection: '.$error->getMessage());return;}
    throw new RuntimeException('Invalid plan guidance request accepted: '.$code);
}
function guidanceCommand(array $arguments):array {
    $command=[PHP_BINARY];if(($ini=php_ini_loaded_file())!==false)array_push($command,'-c',$ini);
    return [...$command,'-d','disable_functions=curl_exec,mail',__FILE__,...$arguments];
}
function guidanceStart(array $arguments):array {
    $process=proc_open(guidanceCommand($arguments),[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes,dirname(__DIR__,2));
    guidanceExpect(is_resource($process),'Cannot start isolated plan guidance child.');fclose($pipes[0]);return [$process,$pipes];
}
function guidanceFinish(array $child):string {
    [$process,$pipes]=$child;$output=stream_get_contents($pipes[1]);$errors=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);
    guidanceExpect(proc_close($process)===0,'Plan guidance child failed: '.$output.$errors);return $output;
}
function guidanceCleanup(string $root):void {
    $resolved=realpath($root);$temporary=realpath(sys_get_temp_dir());
    if($resolved===false||$temporary===false||dirname($resolved)!==$temporary||preg_match('/\Agenesis-plan-guidance-[a-f0-9]{16}\z/D',basename($resolved))!==1)
        throw new RuntimeException('Unsafe plan guidance fixture cleanup path.');
    $items=new RecursiveIteratorIterator(new RecursiveDirectoryIterator($resolved,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::CHILD_FIRST);
    foreach($items as$item)if(!($item->isDir()?rmdir($item->getPathname()):unlink($item->getPathname())))throw new RuntimeException('Plan guidance fixture cleanup failed.');
    if(!rmdir($resolved))throw new RuntimeException('Plan guidance fixture cleanup failed.');
}

if(!isset($argv[1])) {
    $root=sys_get_temp_dir().'/genesis-plan-guidance-'.bin2hex(random_bytes(8));mkdir($root,0700);
    $config=['app_url'=>'https://localhost.invalid','db_path'=>$root.'/genesis.sqlite','session_path'=>$root.'/sessions',
        'crypto_key'=>base64_encode(random_bytes(32)),'cookie_secure'=>false,'timezone'=>'UTC','google_only'=>true,
        'admin_email'=>'guidance-admin@example.invalid','notifications'=>['email'=>['transport'=>'disabled']]];
    $configPath=$root.'/config.php';file_put_contents($configPath,'<?php return '.var_export($config,true).';');
    try{echo guidanceFinish(guidanceStart(['--acceptance',$configPath]));}
    finally{guidanceCleanup($root);}
    return;
}

$mode=$argv[1];$configPath=$argv[2]??'';$root=realpath(dirname($configPath));
guidanceExpect(in_array($mode,['--acceptance','--race'],true)&&$root!==false&&dirname($root)===realpath(sys_get_temp_dir())
    &&preg_match('/\Agenesis-plan-guidance-[a-f0-9]{16}\z/D',basename($root))===1&&is_file($configPath),'Invalid synthetic guidance fixture.');
$config=require $configPath;guidanceExpect(($config['app_url']??'')==='https://localhost.invalid'&&realpath(dirname($config['db_path']??''))===$root,'Guidance config is not isolated.');
define('GENESIS_LOCAL_TEST_CONFIG',$configPath);define('GENESIS_STATELESS_REQUEST',true);
require dirname(__DIR__).'/src/bootstrap.php';require dirname(__DIR__).'/src/repository.php';

function guidanceUser(string $id,string $plan='free',bool $confirmed=true):array {
    $db=genesisDb();$now=genesisNow();
    $db->prepare('INSERT INTO users(id,google_sub,email,display_name,subscription_plan,subscription_valid_until,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
        ->execute([$id,'guidance-sub-'.$id,$id.'@example.invalid','Guidance fixture',$plan,gmdate('Y-m-d\TH:i:s\Z',time()+30*86400),$now,$now]);
    if($confirmed)$db->prepare('INSERT INTO email_registrations(user_id,email,token_hash,expires_at,confirmed_at,created_at) VALUES(?,?,?,?,?,?)')
        ->execute([$id,$id.'@example.invalid',hash('sha256',$id),gmdate('Y-m-d\TH:i:s\Z',time()+172800),$now,$now]);
    return genesisFindUser($id);
}
function guidanceState(string $id):?array {
    $q=genesisDb()->prepare('SELECT * FROM plan_guidance_state WHERE user_id=?');$q->execute([$id]);$row=$q->fetch();$q->closeCursor();return $row?:null;
}
function guidanceSession(array $user):array {
    return ['user_id'=>$user['id'],'security_epoch'=>0,'auth_identity'=>['kind'=>'primary','sub'=>$user['google_sub'],'channel'=>'web'],
        'auth_login_id'=>'guidance-login-'.$user['id'],'csrf'=>bin2hex(random_bytes(24))];
}

$db=genesisDb();
if($mode==='--race') {
    $id=$argv[3];$at=(int)$argv[4];$ready=$root.'/ready-'.$argv[5];file_put_contents($ready,'ready');
    $deadline=microtime(true)+10;while(!is_file($root.'/race-go')){if(microtime(true)>$deadline)throw new RuntimeException('Guidance race barrier timed out.');usleep(10000);}
    echo json_encode(genesisPlanGuidanceClaim($id,['topic'=>'overview','reason'=>'scheduled'],$at),JSON_THROW_ON_ERROR);return;
}

$now=time();$interval=259200;
guidanceExpect((int)$db->query("SELECT COUNT(*) FROM schema_migrations WHERE name='122_plan_guidance.sql'")->fetchColumn()===1,'Guidance migration not recorded.');
$free=guidanceUser('guidance-free');$other=guidanceUser('guidance-other');
guidanceExpect(genesisPlanGuidanceEligible($free),'Confirmed FREE account is not eligible.');
foreach(['standart','premium','business','premium4life']as$plan) {
    $paid=guidanceUser('guidance-'.$plan,$plan);
    guidanceExpect(genesisPlanGuidanceClaim($paid['id'],[],$now)===['show'=>false,'eligible'=>false,'nextAt'=>null,'serverNow'=>genesisPlanGuidanceStamp($now)],'Paid/lifetime account received a tip.');
    guidanceExpect(guidanceState($paid['id'])===null,'Ineligible claim created a lease.');
}
$unverified=guidanceUser('guidance-unverified','free',false);
guidanceExpect(!genesisPlanGuidanceClaim($unverified['id'],[],$now)['eligible'],'Unconfirmed registration received a tip.');
$trial=guidanceUser('guidance-trial');$_SESSION=guidanceSession($trial);genesisTrialActivate($trial['id'],['plan'=>'standart'],$now-10);
guidanceExpect(!genesisPlanGuidanceClaim($trial['id'],[],$now)['eligible'],'Active trial received a tip.');
$_SESSION=[];

foreach([['userId'=>$other['id']],['now'=>'2100-01-01T00:00:00Z'],['topic'=>'billing'],['reason'=>'return'],['topic'=>[]],
    ['resource'=>'unknown'],['feature'=>'private/data'],['feature'=>str_repeat('a',65)],[0=>'not-an-object']]as$bad)
    guidanceReject('PLAN_GUIDANCE_REQUEST_INVALID',fn()=>genesisPlanGuidanceClaim($free['id'],$bad,$now));
guidanceReject('PLAN_GUIDANCE_TOKEN_INVALID',fn()=>genesisPlanGuidanceAcknowledge($free['id'],'bad',$now));
guidanceReject('PLAN_GUIDANCE_TOKEN_INVALID',fn()=>genesisPlanGuidanceRelease($free['id'],'bad'));
guidanceReject('PLAN_GUIDANCE_NOTICE_INVALID',fn()=>genesisPlanGuidanceRead($free['id'],'bad'));

// Claims do not start the timer. Leases are global to the account, never to a tab/device.
$claim=genesisPlanGuidanceClaim($free['id'],[],$now);$token=$claim['token'];
guidanceExpect($claim['show']&&$claim['notice']['reason']==='scheduled'&&$claim['notice']['topic']==='projects','Initial tip/rotation changed.');
guidanceExpect($claim['notice']['createdAt']===genesisPlanGuidanceStamp($now)&&$claim['leaseUntil']===genesisPlanGuidanceStamp($now+120),'Lease ignored server clock.');
guidanceExpect(guidanceState($free['id'])['lease_token']===hash('sha256',$token)&&guidanceState($free['id'])['last_shown_at']===null,'Raw token stored or unshown lease started cooldown.');
guidanceExpect(!genesisPlanGuidanceClaim($free['id'],[],$now+119)['show'],'Second tab acquired an unexpired lease.');
guidanceExpect(!genesisPlanGuidanceAcknowledge($free['id'],$token,$now+120)['ok'],'Acknowledgement accepted at exact lease expiry.');
$replacement=genesisPlanGuidanceClaim($free['id'],[],$now+120);
guidanceExpect($replacement['show']&&!genesisPlanGuidanceAcknowledge($free['id'],$token,$now+120)['ok'],'Expired lease/token was not replaced.');
genesisPlanGuidanceRelease($other['id'],$replacement['token']);guidanceExpect(guidanceState($free['id'])['lease_json']!==null,'Other account released the lease.');
genesisPlanGuidanceRelease($free['id'],$token);guidanceExpect(guidanceState($free['id'])['lease_json']!==null,'Old token released the new lease.');
genesisPlanGuidanceRelease($free['id'],$replacement['token']);genesisPlanGuidanceRelease($free['id'],$replacement['token']);
guidanceExpect(guidanceState($free['id'])['lease_token']===null&&guidanceState($free['id'])['last_shown_at']===null,'Not-shown release changed timer or was not idempotent.');
$shownClaim=genesisPlanGuidanceClaim($free['id'],[],$now+121);$shownAt=$now+122;
$shown=genesisPlanGuidanceAcknowledge($free['id'],$shownClaim['token'],$shownAt);
guidanceExpect($shown['ok']&&$shown['nextAt']===genesisPlanGuidanceStamp($shownAt+$interval),'Visible acknowledgement did not start 72 hours.');
$shownState=guidanceState($free['id']);
guidanceExpect(genesisPlanGuidanceAcknowledge($free['id'],$shownClaim['token'],$shownAt+100)===$shown&&guidanceState($free['id'])===$shownState,'Retry changed notice/timer or response.');
genesisPlanGuidanceRelease($free['id'],$shownClaim['token']);guidanceExpect(guidanceState($free['id'])===$shownState,'Late release cleared an acknowledged notice.');
foreach(['UTC','America/New_York','Europe/Berlin','Pacific/Kiritimati']as$zone) {
    date_default_timezone_set($zone);guidanceExpect(!genesisPlanGuidanceClaim($free['id'],[],$shownAt+$interval-1)['show'],'72-hour UTC cooldown ended early.');
}date_default_timezone_set('UTC');
$due=genesisPlanGuidanceClaim($free['id'],[],$shownAt+$interval);
guidanceExpect($due['show']&&$due['notice']['topic']==='habits','Exact 72-hour boundary or topic rotation failed.');

// Explicit limits have priority, bypass cooldown and move the next automatic tip by 72h.
$context=genesisPlanGuidanceClaim($free['id'],['topic'=>'mindmaps','reason'=>'quota','resource'=>'mindmaps'],$shownAt+$interval+1);
guidanceExpect($context['show']&&!genesisPlanGuidanceAcknowledge($free['id'],$due['token'],$shownAt+$interval+1)['ok'],'Contextual tip did not replace automatic lease.');
$contextAt=$shownAt+$interval+2;$contextShown=genesisPlanGuidanceAcknowledge($free['id'],$context['token'],$contextAt);
guidanceExpect($contextShown['ok']&&$contextShown['nextAt']===genesisPlanGuidanceStamp($contextAt+$interval)
    &&(int)guidanceState($free['id'])['rotation']===1,'Contextual tip timer/automatic rotation changed.');
guidanceExpect(!genesisPlanGuidanceClaim($free['id'],[],$contextAt+1)['show'],'Automatic tip opened immediately after limit tip.');
$feature=genesisPlanGuidanceClaim($free['id'],['topic'=>'dreams','reason'=>'feature','feature'=>'dream-journal'],$contextAt+1);
guidanceExpect($feature['show']&&$feature['notice']['reason']==='feature','Explicit feature tip did not bypass cooldown.');
genesisPlanGuidanceRelease($free['id'],$feature['token']);

// Reading an old notification cannot mark its replacement as read; IDs/tokens stay scoped.
$oldId=$contextShown['notice']['id'];$second=genesisPlanGuidanceClaim($free['id'],['topic'=>'diary','reason'=>'feature'],$contextAt+2);
$secondShown=genesisPlanGuidanceAcknowledge($free['id'],$second['token'],$contextAt+3);
genesisPlanGuidanceRead($free['id'],$oldId);genesisPlanGuidanceRead($other['id'],$secondShown['notice']['id']);
guidanceExpect(genesisPlanGuidanceLatest($free['id'])['notice']===$secondShown['notice']&&genesisPlanGuidanceLatest($other['id'])['notice']===null,'Stale read or switched account consumed another notice.');
guidanceExpect(!genesisPlanGuidanceAcknowledge($other['id'],$second['token'],$contextAt+4)['ok'],'Token acknowledged another account.');
genesisPlanGuidanceRead($free['id'],$secondShown['notice']['id']);guidanceExpect(genesisPlanGuidanceLatest($free['id'])['notice']===null,'Read notice remains unread.');

// A payment/trial made in another tab before /shown suppresses both acknowledgement and inbox.
$upgrade=guidanceUser('guidance-upgrade');$upgradeClaim=genesisPlanGuidanceClaim($upgrade['id'],[],$now);
$db->prepare("UPDATE users SET subscription_plan='premium' WHERE id=?")->execute([$upgrade['id']]);
guidanceExpect(!genesisPlanGuidanceAcknowledge($upgrade['id'],$upgradeClaim['token'],$now+1)['ok']&&genesisPlanGuidanceLatest($upgrade['id'])['notice']===null,'Payment before shown did not suppress offer.');
$trialBeforeShown=guidanceUser('guidance-trial-before-shown');$trialClaim=genesisPlanGuidanceClaim($trialBeforeShown['id'],[],$now);
$_SESSION=guidanceSession($trialBeforeShown);genesisTrialActivate($trialBeforeShown['id'],['plan'=>'standart'],$now-10);
guidanceExpect(!genesisPlanGuidanceAcknowledge($trialBeforeShown['id'],$trialClaim['token'],$now+1)['ok'],'Trial before shown did not suppress offer.');$_SESSION=[];

// Previous FOREGROUND retention activity is read before touch; ordinary last_seen is irrelevant.
$returning=guidanceUser('guidance-returning');$returnId=$returning['id'];
foreach([[$now-$interval+1,'too-recent'],[$now+1,'future'],['bad-date','invalid']]as[$previous,$label]) {
    genesisPlanGuidanceObserve($db,$returnId,is_int($previous)?genesisPlanGuidanceStamp($previous):$previous,'visit-'.$label,$now);
    guidanceExpect(guidanceState($returnId)===null,'Invalid/recent presence manufactured a return.');
}
genesisPlanGuidanceObserve($db,$returnId,genesisPlanGuidanceStamp($now-$interval),null,$now);guidanceExpect(guidanceState($returnId)===null,'Missing visit manufactured a return.');
genesisPlanGuidanceObserve($db,$returnId,genesisPlanGuidanceStamp($now-$interval),'return-exact',$now);
$returnClaim=genesisPlanGuidanceClaim($returnId,[],$now);guidanceExpect($returnClaim['notice']['reason']==='return','Exact 72h return was not detected.');
genesisPlanGuidanceAcknowledge($returnId,$returnClaim['token'],$now+1);
genesisPlanGuidanceObserve($db,$returnId,genesisPlanGuidanceStamp($now),'same-active-visit',$now+2);
guidanceExpect(guidanceState($returnId)['return_visit_hash']==='return-exact'&&!genesisPlanGuidanceClaim($returnId,[],$now+2)['show'],'Active refresh manufactured another return.');
genesisPlanGuidanceObserve($db,$returnId,genesisPlanGuidanceStamp($now-$interval),'pending-return',$now+3);
$limitReturn=genesisPlanGuidanceClaim($returnId,['reason'=>'quota','topic'=>'habits','resource'=>'habits'],$now+3);
genesisPlanGuidanceAcknowledge($returnId,$limitReturn['token'],$now+4);
guidanceExpect(!genesisPlanGuidanceClaim($returnId,[],$now+5)['show']&&guidanceState($returnId)['last_return_notice_hash']==='return-exact','Pending return bypassed freshly shown limit tip or was consumed.');

$observed=guidanceUser('guidance-observed');$relative=time();$retention=genesisRetentionEnsureState($db,$observed,$relative);
$db->prepare('UPDATE account_retention_state SET last_activity_at=? WHERE user_id=?')->execute([genesisPlanGuidanceStamp($relative-$interval-10),$observed['id']]);
$db->prepare('UPDATE users SET last_seen_at=? WHERE id=?')->execute([genesisPlanGuidanceStamp($relative+86400),$observed['id']]);
$_SESSION=guidanceSession($observed);$_SERVER=['HTTP_USER_AGENT'=>'Mozilla Windows NT','HTTP_X_GENESIS_FOREGROUND'=>'0','HTTP_X_GENESIS_VISIT'=>str_repeat('a',32)];
genesisRetentionObserveActivity($observed['id'],true);guidanceExpect(guidanceState($observed['id'])===null,'Background heartbeat created return marker.');
$_SERVER['HTTP_X_GENESIS_FOREGROUND']='1';genesisRetentionObserveActivity($observed['id'],true);
$expectedHash=hash('sha256',$_SESSION['auth_login_id'].':'.str_repeat('a',32));
guidanceExpect(guidanceState($observed['id'])['return_visit_hash']===$expectedHash,'Retention hook read touched/generic activity instead of previous foreground time.');
$q=$db->prepare('SELECT last_activity_at FROM account_retention_state WHERE user_id=?');$q->execute([$observed['id']]);
guidanceExpect(strtotime($q->fetchColumn())>=$relative,'Foreground retention time was not touched after return detection.');$q->closeCursor();
$linked=guidanceUser('guidance-linked');
$db->prepare("INSERT INTO linked_local_accounts(member_user_id,owner_user_id,provider,provider_uid,email,display_name,created_at,updated_at) VALUES(?,?,'vk',?,?,?,?,?)")
    ->execute([$linked['id'],$observed['id'],'guidance-linked',$linked['email'],'Linked fixture',genesisNow(),genesisNow()]);
genesisRetentionEnsureState($db,$linked,$relative);$db->prepare('UPDATE account_retention_state SET last_activity_at=? WHERE user_id=?')->execute([genesisPlanGuidanceStamp($relative-$interval-10),$linked['id']]);
genesisRetentionObserveActivity($observed['id'],true);guidanceExpect(guidanceState($linked['id'])===null,'Opening one legacy family account manufactured return for another.');$_SESSION=[];$_SERVER=[];

// Two independent PHP processes contend for one account lease under SQLite's writer lock.
$race=guidanceUser('guidance-race');$children=[];
try {
    foreach(['a','b']as$worker)$children[]=guidanceStart(['--race',$configPath,$race['id'],(string)$now,$worker]);
    $deadline=microtime(true)+10;while(!is_file($root.'/ready-a')||!is_file($root.'/ready-b')){if(microtime(true)>$deadline)throw new RuntimeException('Guidance race setup timed out.');usleep(10000);}
    file_put_contents($root.'/race-go','go');$raceResults=[];
    foreach($children as$child)$raceResults[]=json_decode(guidanceFinish($child),true,64,JSON_THROW_ON_ERROR);$children=[];
    guidanceExpect(count(array_filter($raceResults,fn(array $result):bool=>$result['show']))===1,'Concurrent tabs acquired two automatic leases.');
}finally{foreach($children as[$process])if(is_resource($process)){proc_terminate($process);proc_close($process);}}

// Migration is additive and FK-safe. VACUUM INTO (the runtime backup primitive) retains it.
$legacy=new PDO('sqlite::memory:',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);$legacy->exec("PRAGMA foreign_keys=ON;CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT);INSERT INTO users VALUES('legacy','legacy@example.invalid');CREATE TABLE opaque(body TEXT);INSERT INTO opaque VALUES('existing encrypted content');");
$legacy->beginTransaction();$legacy->exec((string)file_get_contents(dirname(__DIR__).'/migrations/122_plan_guidance.sql'));$legacy->commit();
guidanceExpect($legacy->query('SELECT body FROM opaque')->fetchColumn()==='existing encrypted content','Migration changed existing content.');
$legacy->exec("UPDATE users SET email='old-code@example.invalid' WHERE id='legacy';INSERT INTO plan_guidance_state(user_id,updated_at) VALUES('legacy','2026-11-06T00:00:00Z');DELETE FROM users WHERE id='legacy'");
guidanceExpect((int)$legacy->query('SELECT COUNT(*) FROM plan_guidance_state')->fetchColumn()===0,'Old-code account deletion did not cascade guidance.');
guidanceExpect($legacy->query('PRAGMA foreign_key_check')->fetchAll()===[],'Migration introduced foreign-key violations.');unset($legacy);
$backup=$root.'/backup.sqlite';$db->exec('VACUUM INTO '.$db->quote($backup));$copy=new PDO('sqlite:'.$backup,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
guidanceExpect($copy->query('PRAGMA integrity_check')->fetchColumn()==='ok'
    &&(int)$copy->query('SELECT COUNT(*) FROM plan_guidance_state')->fetchColumn()===(int)$db->query('SELECT COUNT(*) FROM plan_guidance_state')->fetchColumn(),'SQLite runtime backup lost guidance state.');unset($copy);

// Real HTTP boundary: auth, CSRF, foreground-only claims/shown/read, strict bodies and scope.
$httpUser=guidanceUser('guidance-http');$httpOther=guidanceUser('guidance-http-other');$session=guidanceSession($httpUser);$otherSession=guidanceSession($httpOther);
genesisEnsureDirectory($config['session_path']);$cookie=bin2hex(random_bytes(24));$otherCookie=bin2hex(random_bytes(24));
foreach([[$cookie,$session],[$otherCookie,$otherSession]]as[$sessionId,$values]){$encoded='';foreach($values as$key=>$value)$encoded.=$key.'|'.serialize($value);file_put_contents($config['session_path'].'/sess_'.$sessionId,$encoded);}
$listener=stream_socket_server('tcp://127.0.0.1:0',$errno,$error);guidanceExpect($listener!==false,'Cannot reserve guidance HTTP port.');$address=stream_socket_get_name($listener,false);fclose($listener);
$router=$root.'/router.php';file_put_contents($router,'<?php define("GENESIS_LOCAL_TEST_CONFIG",'.var_export($configPath,true).'); require '.var_export(dirname(__DIR__).'/public/api/index.php',true).';');
$serverCommand=[PHP_BINARY];if(($ini=php_ini_loaded_file())!==false)array_push($serverCommand,'-c',$ini);array_push($serverCommand,'-d','disable_functions=curl_exec,mail','-S',$address,$router);
$server=proc_open($serverCommand,[0=>['pipe','r'],1=>['file',$root.'/http.log','a'],2=>['file',$root.'/http.log','a']],$serverPipes,dirname(__DIR__,2));guidanceExpect(is_resource($server),'Cannot start guidance HTTP fixture.');fclose($serverPipes[0]);
try {
    for($i=0;$i<50;$i++){$socket=@stream_socket_client('tcp://'.$address,$errno,$error,0.1);if($socket!==false){fclose($socket);break;}usleep(100000);}
    $http=function(string $path,?string $sentCookie,?string $csrf,string $body='{}',string $foreground='1',string $method='POST')use($address):array {
        $headers="Content-Type: application/json\r\nUser-Agent: GENESIS isolated guidance test\r\n";
        if($foreground!=='')$headers.="X-Genesis-Foreground: $foreground\r\n";if($sentCookie!==null)$headers.="Cookie: GENESISSESSID=$sentCookie\r\n";if($csrf!==null)$headers.="X-CSRF-Token: $csrf\r\n";
        $context=stream_context_create(['http'=>['method'=>$method,'ignore_errors'=>true,'timeout'=>10,'header'=>$headers,'content'=>$body]]);
        $bytes=file_get_contents('http://'.$address.'/?path=account/plan-guidance'.$path,false,$context);$responseHeaders=$http_response_header??[];preg_match('/^HTTP\/\S+ (\d+)/',$responseHeaders[0]??'',$match);
        return ['status'=>(int)($match[1]??0),'data'=>json_decode($bytes?:'{}',true),'headers'=>$responseHeaders];
    };
    guidanceExpect($http('',null,null,'','1','GET')['status']===401&&$http('/claim',null,null)['status']===401,'Guidance API allowed anonymous access.');
    guidanceExpect($http('/claim',$cookie,'bad')['status']===403,'Guidance API ignored CSRF.');
    foreach(['0','']as$background)guidanceExpect($http('/claim',$cookie,$session['csrf'],'{}',$background)['status']===409,'Background/missing foreground claim accepted.');
    guidanceExpect(guidanceState($httpUser['id'])===null,'Rejected HTTP requests manufactured lease state.');
    guidanceExpect($http('/claim',$cookie,$session['csrf'],str_repeat('x',1025))['status']===413,'Guidance body limit missing.');
    foreach(['{"userId":"guidance-http-other"}','{"now":9999999999}','{"topic":[]}','null','{"reason":"return"}']as$bad)
        guidanceExpect($http('/claim',$cookie,$session['csrf'],$bad)['status']===400,'HTTP guidance claim body accepted invalid/account-selected data.');
    $before=time();$httpClaim=$http('/claim',$cookie,$session['csrf']);$after=time();$httpToken=$httpClaim['data']['token'];
    guidanceExpect($httpClaim['status']===200&&$httpClaim['data']['show']&&strtotime($httpClaim['data']['notice']['createdAt'])>=$before
        &&strtotime($httpClaim['data']['notice']['createdAt'])<=$after,'API claim did not use server clock.');
    guidanceExpect($http('/claim',$cookie,$session['csrf'])['data']['show']===false,'HTTP retry acquired another automatic lease.');
    guidanceExpect($http('/shown',$cookie,$session['csrf'],json_encode(['token'=>$httpToken]),'0')['status']===409,'Background shown accepted.');
    guidanceExpect($http('/shown',$otherCookie,$otherSession['csrf'],json_encode(['token'=>$httpToken]))['data']['ok']===false,'HTTP account switch acknowledged old token.');
    $released=$http('/release',$cookie,$session['csrf'],json_encode(['token'=>$httpToken]),'0');guidanceExpect($released['status']===200&&$released['data']['ok'],'Hidden client could not release its unshown lease.');
    $httpClaim=$http('/claim',$cookie,$session['csrf']);$httpToken=$httpClaim['data']['token'];
    guidanceExpect($http('/shown',$cookie,$session['csrf'],json_encode(['token'=>$httpToken,'id'=>'extraneous']))['status']===400,'Acknowledgement allowed extra keys.');
    $httpShown=$http('/shown',$cookie,$session['csrf'],json_encode(['token'=>$httpToken]));$id=$httpShown['data']['notice']['id'];
    guidanceExpect($httpShown['status']===200&&$httpShown['data']['ok']&&$http('/shown',$cookie,$session['csrf'],json_encode(['token'=>$httpToken]))['data']===$httpShown['data'],'HTTP shown retry is not idempotent.');
    $inbox=$http('',$cookie,$session['csrf'],'','1','GET');guidanceExpect($inbox['data']['notice']['id']===$id&&in_array('Cache-Control: no-store',$inbox['headers'],true),'Guidance inbox/cache contract changed.');
    guidanceExpect($http('/read',$cookie,$session['csrf'],json_encode(['id'=>$id]),'0')['status']===409,'Background read accepted.');
    $http('/read',$otherCookie,$otherSession['csrf'],json_encode(['id'=>$id]));guidanceExpect($http('',$cookie,$session['csrf'],'','1','GET')['data']['notice']['id']===$id,'HTTP cross-account read consumed notice.');
    $http('/read',$cookie,$session['csrf'],json_encode(['id'=>$id]));guidanceExpect($http('',$cookie,$session['csrf'],'','1','GET')['data']['notice']===null,'HTTP read left notice unread.');
}finally{if(is_resource($server)){proc_terminate($server);proc_close($server);}}
echo 'Plan guidance: '.$guidanceChecks." checks passed (eligibility, exact 72h, lease race/release/ack, contextual priority, returns, account isolation, migration/backup and real HTTP auth/CSRF/foreground/body).\n";
