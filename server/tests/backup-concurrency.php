<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit(1);
$worker=($argv[1]??'')==='--worker';
if($worker){
    $path=(string)($argv[2]??'');
    if(!str_starts_with(str_replace('\\','/',$path),str_replace('\\','/',sys_get_temp_dir()).'/genesis-backup-race-'))throw new RuntimeException('Owned fixture required');
    define('GENESIS_LOCAL_TEST_CONFIG',$path);
}else{
    $root=sys_get_temp_dir().'/genesis-backup-race-'.bin2hex(random_bytes(8));mkdir($root,0700);mkdir($root.'/sessions',0700);
    $config=['app_url'=>'https://localhost.invalid','db_path'=>$root.'/db.sqlite','session_path'=>$root.'/sessions','crypto_key'=>base64_encode(random_bytes(32)),
        'cookie_secure'=>false,'timezone'=>'UTC','google_identity_management_enabled'=>true,'backup_v1_enabled'=>true];
    file_put_contents($root.'/config.php','<?php return '.var_export($config,true).';');define('GENESIS_LOCAL_TEST_CONFIG',$root.'/config.php');
}
foreach(['bootstrap','repository','diary','backups']as$module)require dirname(__DIR__).'/src/'.$module.'.php';
$db=genesisDb();
if($worker){
    $job=json_decode(file_get_contents($argv[3]),true,32,JSON_THROW_ON_ERROR);
    $_SESSION['google_step_up']=['owner'=>'race-owner','sub'=>'race-sub','epoch'=>0,'expiresAt'=>time()+300];
    echo "ready\n";flush();if(trim((string)fgets(STDIN))!=='go')throw new RuntimeException('Missing barrier');echo "attempt\n";flush();
    try{
        if($job['kind']==='disable')genesisGoogleDisableLogin('race-owner',$job['target'],'race-owner');
        else genesisBackupCommit('race-owner',$job['request']);
        echo "ok\n";
    }catch(GenesisResourceLimitException){echo "rejected\n";}
    exit;
}
$db->prepare("INSERT INTO users(id,google_sub,email,display_name,subscription_plan,created_at,updated_at) VALUES('race-owner','race-sub','race@example.invalid','Synthetic','premium4life',?,?)")->execute([genesisNow(),genesisNow()]);
foreach(['link-a','link-b']as$id)$db->prepare('INSERT INTO linked_google_accounts(id,owner_user_id,google_sub,email,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')->execute([$id,'race-owner','sub-'.$id,$id.'@example.invalid','Synthetic',genesisNow(),genesisNow()]);
function backupRace(array $jobs):array{
    $workers=[];$results=[];$db=genesisDb();
    try{
        foreach($jobs as$index=>$job){
            $file=dirname(GENESIS_LOCAL_TEST_CONFIG).'/job-'.bin2hex(random_bytes(6)).'.json';file_put_contents($file,json_encode($job,JSON_THROW_ON_ERROR));$pipes=[];
            $process=proc_open([PHP_BINARY,'-d','auto_prepend_file=',__FILE__,'--worker',GENESIS_LOCAL_TEST_CONFIG,$file],[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);
            if(!is_resource($process))throw new RuntimeException('Worker unavailable');
            foreach([$pipes[1],$pipes[2]]as$pipe)stream_set_timeout($pipe,15);
            $workers[]=['process'=>$process,'pipes'=>$pipes];
            if(trim((string)fgets($pipes[1]))!=='ready')throw new RuntimeException('Worker did not reach barrier');
        }
        genesisBeginWriteTransaction($db);
        foreach($workers as$worker){fwrite($worker['pipes'][0],"go\n");fflush($worker['pipes'][0]);}
        foreach($workers as$worker)if(trim((string)fgets($worker['pipes'][1]))!=='attempt')throw new RuntimeException('Worker did not attempt write');
        $db->commit();
        foreach($workers as&$worker){
            fclose($worker['pipes'][0]);$result=trim(stream_get_contents($worker['pipes'][1]));$errors=trim(stream_get_contents($worker['pipes'][2]));fclose($worker['pipes'][1]);fclose($worker['pipes'][2]);
            $exit=proc_close($worker['process']);$worker['process']=null;
            if($exit!==0||$errors!==''||!in_array($result,['ok','rejected'],true))throw new RuntimeException('Worker failed: '.$errors);
            $results[]=$result;
        }unset($worker);return $results;
    }finally{if($db->inTransaction())$db->rollBack();foreach($workers as$worker)if(is_resource($worker['process'])){proc_terminate($worker['process']);proc_close($worker['process']);}}
}
$results=backupRace([['kind'=>'disable','target'=>'link-a'],['kind'=>'disable','target'=>'link-b']]);sort($results);
if($results!==['ok','rejected']||(int)genesisFindUser('race-owner')['security_epoch']!==1)throw new RuntimeException('Concurrent stale proof was accepted');
echo "PASS concurrent unlink consumes only the matching security epoch\n";
$notice=['noticeVersion'=>GENESIS_BACKUP_NOTICE];
$preview=genesisBackupPreview('race-owner',[...$notice,'operations'=>[['section'=>'diary','id'=>'note','input'=>['schemaVersion'=>1,'expectedRevision'=>0,'iv'=>base64_encode(random_bytes(12)),'ciphertext'=>base64_encode(random_bytes(100))]]]]);
$request=[...$notice,'stageId'=>$preview['stageId'],'digest'=>$preview['digest'],'operationId'=>genesisUuid(),'confirmed'=>true];
$results=backupRace([['kind'=>'commit','request'=>$request],['kind'=>'commit','request'=>$request]]);
if($results!==['ok','ok']||count(genesisDiaryNotes('race-owner'))!==1||(int)genesisFindUser('race-owner')['data_generation']!==1)throw new RuntimeException('Concurrent commit duplicated data');
echo "PASS concurrent restore returns one durable commit and one idempotent receipt\n";
