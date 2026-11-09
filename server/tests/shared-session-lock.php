<?php
declare(strict_types=1);
require dirname(__DIR__).'/src/bootstrap.php';
require dirname(__DIR__).'/src/repository.php';
require dirname(__DIR__).'/src/google.php';
require dirname(__DIR__).'/src/shared-projects.php';
require dirname(__DIR__).'/src/shared-google.php';
if ((genesisConfig()['app_url'] ?? '') !== 'https://localhost.invalid') throw new RuntimeException('Isolated synthetic config required.');
$db=genesisDb(); $db->beginTransaction(); $id='session-lock-'.bin2hex(random_bytes(5));
try {
    $db->prepare('INSERT INTO users(id,google_sub,email,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)')
        ->execute([$id,$id,$id.'@example.invalid','Session fixture',genesisNow(),genesisNow()]);
    $user=genesisFindUser($id); genesisEstablishGoogleSession($user,$id);
    $sessionId=session_id(); $sessionPath=genesisConfig()['session_path']; $csrf=$_SESSION['csrf'];
    $_SERVER['HTTP_X_CSRF_TOKEN']=$csrf;
    if(genesisSharedRequestUserId('POST')!==$id || session_status()===PHP_SESSION_ACTIVE || $_SESSION['csrf']!==$csrf)
        throw new RuntimeException('Shared request retained the session lock or lost authenticated context.');
    // A second PHP process must read the same session before this request finishes its work.
    $worker='session_save_path($argv[1]);session_name("GENESISSESSID");session_id($argv[2]);session_start();'
        .'$ok=($_SESSION["user_id"]??null)===$argv[3];session_write_close();exit($ok?0:2);';
    $command=[PHP_BINARY]; if(($ini=php_ini_loaded_file())!==false) array_push($command,'-c',$ini);
    array_push($command,'-r',$worker,$sessionPath,$sessionId,$id);
    $process=proc_open($command,[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);
    if(!is_resource($process)) throw new RuntimeException('Cannot start session-lock probe.');
    fclose($pipes[0]); $started=microtime(true); $status=proc_get_status($process);
    while($status['running'] && microtime(true)-$started<3) { usleep(20000); $status=proc_get_status($process); }
    if($status['running']) { proc_terminate($process); throw new RuntimeException('Parallel PHP request waited on a session lock.'); }
    fclose($pipes[1]);fclose($pipes[2]);proc_close($process);
    if($status['exitcode']!==0) throw new RuntimeException('Parallel PHP request could not read authenticated session.');
    $calls=0;
    genesisSharedGoogleWithSyncLock($id,static function()use($id,&$calls):array{
        $busy=genesisSharedGoogleWithSyncLock($id,static function()use(&$calls):array{$calls++;return [];});
        if(($busy['busy']??false)!==true)throw new RuntimeException('Overlapping Google write was not deferred.');
        return [];
    });
    genesisSharedGoogleWithSyncLock($id,static function()use(&$calls):array{$calls++;return [];});
    if($calls!==1)throw new RuntimeException('Google sync lock was not released.');
    echo "Shared session lock: auth/CSRF retained; parallel PHP request completed before parent exit.\n";
} finally {
    if($db->inTransaction()) $db->rollBack();
    if(isset($sessionId,$sessionPath)) @unlink($sessionPath.'/sess_'.$sessionId);
}
