<?php
declare(strict_types=1);
require __DIR__.'/e2ee-personal-io-gate.php';
require_once dirname(__DIR__).'/src/google.php';

function cacheBoundaryUser(string $suffix):array
{
    global $db;$id='cache-boundary-'.$suffix.'-'.bin2hex(random_bytes(5));$now=genesisNow();
    $db->prepare('INSERT INTO users(id,google_sub,email,created_at,updated_at) VALUES(?,?,?,?,?)')
        ->execute([$id,$id,$id.'@example.invalid',$now,$now]);
    return ['id'=>$id,'google_sub'=>$id,'refresh_token_enc'=>'synthetic-grant','granted_scopes'=>GENESIS_GOOGLE_TASKS_SCOPE];
}
$primary=cacheBoundaryUser('primary');$other=cacheBoundaryUser('other');$linkedId='linked-'.bin2hex(random_bytes(5));
$db->prepare('INSERT INTO linked_google_accounts(id,owner_user_id,google_sub,email,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
    ->execute([$linkedId,$primary['id'],$linkedId,$linkedId.'@example.invalid','Synthetic linked',genesisNow(),genesisNow()]);
$linked=['id'=>$linkedId,'_linked_account'=>true,'_owner_user_id'=>$primary['id'],'google_sub'=>$linkedId,'refresh_token_enc'=>'synthetic-linked-grant'];
storeCheck(genesisGoogleCacheOwner($primary)===$primary['id']);
storeCheck(genesisGoogleCacheOwner($linked)===$primary['id']);
storeReject(fn()=>genesisGoogleCacheOwner([...$linked,'_owner_user_id'=>$other['id']]),'E2EE_ACCOUNT_CHANGED');
storeReject(fn()=>genesisGoogleCacheOwner(['id'=>'missing-primary']),'E2EE_ACCOUNT_CHANGED');
storeReject(fn()=>genesisGoogleCacheOwner([...$linked,'id'=>'missing-link']),'E2EE_ACCOUNT_CHANGED');
$directory=genesisGoogleCacheDirectory();$paths=[];
try {
    foreach([$primary,$linked,$other]as $account) {
        $paths[]= $directory.'/'.genesisGoogleCacheKey($account);
        genesisGoogleCacheWithLock($account,static function(array &$state)use($account):void{$state['tasks']=['items'=>[['id'=>$account['id'],'title'=>'Synthetic private task']]];});
    }
    storeCheck(count(array_unique($paths))===3);
    // An actual cache callback keeps the owner permit across all work. It cannot
    // release the surrounding request's permit when its nested borrow closes.
    genesisGoogleCacheWithLock($primary,static function(array &$state)use($primary,$other):void{
        storeCheck(ioGateProbe($primary['id'],true)==='E2EE_OPERATION_BUSY');
        storeCheck(ioGateProbe($other['id'],true)==='ACQUIRED');
        storeCheck($state['tasks']['items'][0]['id']===$primary['id']);
    },false);
    storeCheck(ioGateProbe($primary['id'],true)==='ACQUIRED');
    $original=file_get_contents($paths[0].'.enc');
    $process=proc_open([PHP_BINARY,dirname(__DIR__,2).'/scripts/qa/google-cache-lock-holder.php',$paths[0].'.lock'],
        [0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes,null,null,['bypass_shell'=>true]);
    storeCheck(is_resource($process));storeCheck(trim(fgets($pipes[1]))==='LOCKED');
    try {
        // A caller already holding SQLite must refuse immediately; it must not
        // wait for a cache callback that may itself need that SQLite writer.
        genesisBeginWriteTransaction($db);$started=microtime(true);$callback=false;
        try {storeReject(fn()=>genesisGoogleCacheWithLock($primary,static function()use(&$callback):void{$callback=true;}),'E2EE_OPERATION_BUSY');}
        finally {$db->rollBack();}
        storeCheck(microtime(true)-$started<2&&!$callback&&file_get_contents($paths[0].'.enc')===$original);
    }finally{fwrite($pipes[0],"release\n");fclose($pipes[0]);fclose($pipes[1]);$stderr=stream_get_contents($pipes[2]);fclose($pipes[2]);storeCheck(proc_close($process)===0&&$stderr==='');}
    // A stale linked account cannot reopen content after unlink. Cleanup is a
    // separate non-reading path with captured server owner metadata only.
    $db->prepare('DELETE FROM linked_google_accounts WHERE id=?')->execute([$linkedId]);$callback=false;
    storeReject(fn()=>genesisGoogleCacheWithLock($linked,static function()use(&$callback):void{$callback=true;}),'E2EE_ACCOUNT_CHANGED');
    storeCheck(!$callback&&is_file($paths[1].'.enc'));
    genesisGoogleForgetSnapshot($linked);storeCheck(!is_file($paths[1].'.enc'));
    // Test a real signed migration lease. Denied operations cannot call a loader,
    // open/create snapshot files, rotate a key or overwrite existing ciphertext.
    $f=legacyWorkspaceFixture();$migrationUser=['id'=>$owner,'google_sub'=>$owner,'granted_scopes'=>GENESIS_GOOGLE_TASKS_SCOPE];
    $migrationPath=$directory.'/'.genesisGoogleCacheKey($migrationUser);$paths[]=$migrationPath;
    foreach(['uploading','verified','active','retirement']as $state) {
        $db->prepare('UPDATE e2ee_scopes SET state=? WHERE scope_id=?')->execute([$state,$scopeId]);$called=false;
        $loader=static function()use(&$called):array{$called=true;return ['items'=>[]];};
        storeReject(fn()=>genesisGoogleReadSnapshot($migrationUser,$loader,$loader),'E2EE_MIGRATION_FENCED');
        storeReject(fn()=>genesisGoogleSnapshotTaskSaved($migrationUser,['id'=>'blocked']),'E2EE_MIGRATION_FENCED');
        storeReject(fn()=>genesisGoogleAccessToken($migrationUser),'E2EE_MIGRATION_FENCED');
        storeReject(fn()=>genesisGoogleApi('POST','/calendars/primary/events',$migrationUser,['summary'=>'blocked']),'E2EE_MIGRATION_FENCED');
        storeReject(fn()=>genesisGoogleTasksApi('POST','/lists/primary/tasks',$migrationUser,['title'=>'blocked']),'E2EE_MIGRATION_FENCED');
        storeReject(fn()=>genesisGoogleForgetSnapshot($migrationUser),'E2EE_MIGRATION_FENCED');
        storeCheck(!$called&&!is_file($migrationPath.'.enc')&&!is_file($migrationPath.'.lock'));
    }
    storeCheck(file_get_contents($paths[0].'.enc')===$original);
    // Credential fallback is forbidden after the authoritative row is removed,
    // even if a job retained an old encrypted token-bearing array.
    storeReject(fn()=>genesisGoogleAccessToken($linked),'E2EE_ACCOUNT_CHANGED');
}finally{
    foreach($paths as $base)foreach(['.enc','.lock']as $suffix)if(is_file($base.$suffix))unlink($base.$suffix);
}
echo 'PASS e2ee-google-cache-boundary '.$checks.' cumulative assertions; real primary/linked ownership, callback drain, nonblocking SQL/file contention and pre-IO migration fences'.PHP_EOL;
