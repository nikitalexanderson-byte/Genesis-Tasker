<?php
declare(strict_types=1);
require __DIR__.'/e2ee-legacy-workspace.php';
require_once dirname(__DIR__).'/src/e2ee-provider-cache.php';
require_once dirname(__DIR__).'/src/google.php';

$providerOriginals=[];$providerPaths=[];
function providerCacheFixture():array
{
    global $db,$providerOriginals,$providerPaths;
    $linked=null;
    $fixture=legacyWorkspaceFixture('legacy',false,null,static function(string $id)use($db,&$linked,&$providerOriginals,&$providerPaths):void{
        $db->prepare('UPDATE users SET refresh_token_enc=?,granted_scopes=? WHERE id=?')->execute([genesisEncrypt('synthetic-provider-refresh'),GENESIS_GOOGLE_TASKS_SCOPE.' '.GENESIS_GOOGLE_CALENDAR_SCOPE,$id]);
        $linked='provider-link-'.$id;$db->prepare('INSERT INTO linked_google_accounts(id,owner_user_id,google_sub,email,display_name,refresh_token_enc,granted_scopes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
            ->execute([$linked,$id,$linked,$linked.'@example.invalid','Synthetic linked',genesisEncrypt('synthetic-linked-refresh'),GENESIS_GOOGLE_TASKS_SCOPE,genesisNow(),genesisNow()]);
        foreach([genesisFindUser($id),genesisFindLinkedGoogleAccount($linked)]as $account){
            genesisGoogleCacheWithLock($account,static function(array &$state)use($account):void{
                $state['calendar']=['items'=>[['id'=>'calendar-'.$account['id'],'title'=>'Private cached event','createdIn'=>'google-calendar','googleEventId'=>'event-'.$account['id']]],
                    'syncToken'=>'synthetic-private-provider-cursor','checkedAt'=>123];
                $state['tasks']=['items'=>[['id'=>'task-'.$account['id'],'title'=>'Private cached task','createdIn'=>'google-tasks','googleTaskId'=>'native-'.$account['id'],'googleTaskListId'=>'list-'.$account['id']]],
                    'lists'=>[['id'=>'list-'.$account['id'],'title'=>'Private cached list','updatedAt'=>null,'isDefault'=>true]],'nextAttempt'=>456,'warning'=>null];
            });
            $base=genesisGoogleCacheDirectory().'/'.genesisGoogleCacheKey($account);$providerPaths[]=$base;
            $providerOriginals[$base.'.enc']=file_get_contents($base.'.enc');
        }
    });
    return $fixture+['linkedId'=>$linked];
}
function providerAssertOriginals():void {global $providerOriginals;foreach($providerOriginals as $path=>$bytes)storeCheck(file_get_contents($path)===$bytes);}
try{
    $fixture=providerCacheFixture();$id=$owner;$scope=$scopeId;$sourceHash=$fixture['payload']['sourceHash'];
    $items=genesisE2eeReadProviderCaches($db,$id);storeCheck(count($items)===2);
    storeCheck($items[0]['kind']==='primary'&&$items[0]['accountId']===$id&&$items[1]['accountId']===$fixture['linkedId']);
    foreach($items as $item){
        storeCheck($item['presence']==='stored'&&$item['provenance']==='current-grant'&&preg_match('/\A[a-f0-9]{64}\z/D',$item['version'])===1);
        storeCheck($item['calendar']->items[0]->title==='Private cached event'&&$item['tasks']->lists[0]->title==='Private cached list');
        storeCheck(!isset($item['calendar']->syncToken));
        foreach(['fingerprint','refresh_token_enc','access_token_enc','google_sub','email']as $field)storeCheck(!array_key_exists($field,$item));
    }
    storeCheck(!str_contains(genesisE2eeJson($items),'synthetic-private-provider-cursor'));
    storeCheck(genesisE2eeRead($id,storeCommand('legacy-tasks',$fixture['payload']),$session)['providerCaches']==$items);
    providerAssertOriginals();storeCheck($sourceHash===genesisE2eeSourceHash($db,genesisE2eeScope($id,$scope)));
    // A foreign file is outside the SQL owner list, even when an old receipt
    // happens to mention that account. Its content never contributes a grant.
    $foreign='provider-foreign-'.bin2hex(random_bytes(4));$db->prepare('INSERT INTO users(id,google_sub,email,created_at,updated_at) VALUES(?,?,?,?,?)')
        ->execute([$foreign,$foreign,$foreign.'@example.invalid',genesisNow(),genesisNow()]);
    genesisGoogleCacheWithLock(['id'=>$foreign],static function(array &$state):void{$state['tasks']=['items'=>[['id'=>'FOREIGN','title'=>'FOREIGN PRIVATE CANARY']]];});
    $foreignBase=genesisGoogleCacheDirectory().'/'.genesisGoogleCacheKey(['id'=>$foreign]);$providerPaths[]=$foreignBase;
    storeCheck($sourceHash===genesisE2eeSourceHash($db,genesisE2eeScope($id,$scope)));
    storeCheck(!str_contains(genesisE2eeJson(genesisE2eeReadProviderCaches($db,$id)),'FOREIGN PRIVATE CANARY'));
    // Exact ciphertext changes and missing/new cache presence are source changes,
    // including re-encryption of identical private content with a fresh nonce.
    $primaryBase=genesisGoogleCacheDirectory().'/'.genesisGoogleCacheKey(['id'=>$id]);$original=$providerOriginals[$primaryBase.'.enc'];
    $holder=proc_open([PHP_BINARY,dirname(__DIR__,2).'/scripts/qa/google-cache-lock-holder.php',$primaryBase.'.lock'],
        [0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes,null,null,['bypass_shell'=>true]);
    storeCheck(is_resource($holder));storeCheck(trim(fgets($pipes[1]))==='LOCKED');
    try{
        genesisBeginWriteTransaction($db);$started=microtime(true);
        try{storeReject(fn()=>genesisE2eeSourceHash($db,genesisE2eeScope($id,$scope)),'E2EE_OPERATION_BUSY');}finally{$db->rollBack();}
        storeCheck(microtime(true)-$started<2&&file_get_contents($primaryBase.'.enc')===$original);
        // Terminate the process while its file mutex is held. OS teardown releases
        // the mutex; the next exact snapshot can proceed without file cleanup.
        storeCheck(proc_terminate($holder));
    }finally{fclose($pipes[0]);fclose($pipes[1]);fclose($pipes[2]);proc_close($holder);}
    storeCheck($sourceHash===genesisE2eeSourceHash($db,genesisE2eeScope($id,$scope)));
    $same=genesisEncrypt(genesisDecrypt($original));file_put_contents($primaryBase.'.enc',$same);
    storeCheck($sourceHash!==genesisE2eeSourceHash($db,genesisE2eeScope($id,$scope)));
    storeReject(fn()=>genesisE2eeRead($id,storeCommand('legacy-tasks',$fixture['payload']),$session),'E2EE_SOURCE_CHANGED');
    file_put_contents($primaryBase.'.enc',$original);storeCheck($sourceHash===genesisE2eeSourceHash($db,genesisE2eeScope($id,$scope)));
    unlink($primaryBase.'.enc');storeCheck($sourceHash!==genesisE2eeSourceHash($db,genesisE2eeScope($id,$scope)));
    $missing=genesisE2eeReadProviderCaches($db,$id)[0];storeCheck($missing['presence']==='missing'&&$missing['calendar']===null&&$missing['tasks']===null);
    storeCheck(!is_file($primaryBase.'.enc'));file_put_contents($primaryBase.'.enc',$original);
    // Bad ciphertext/key/JSON must not become an empty cache, replace originals
    // or cause a provider refresh. Both escaped and direct duplicate names fail.
    $validPlain=genesisDecrypt($original);$decoded=json_decode($validPlain,true,40,JSON_THROW_ON_ERROR);
    foreach(['damaged',base64_encode(random_bytes(80)),genesisEncrypt('{broken'),genesisEncrypt(str_replace('"Private cached event"','"Private cached event","\u0074itle":"Duplicate"',$validPlain))]as $bad){
        file_put_contents($primaryBase.'.enc',$bad);storeReject(fn()=>genesisE2eeReadProviderCaches($db,$id),'E2EE_PROVIDER_CACHE_CORRUPT');
        storeCheck(file_get_contents($primaryBase.'.enc')===$bad);
    }
    $unknown=$decoded;$unknown['futurePrivateState']=['text'=>'Preserve'];file_put_contents($primaryBase.'.enc',genesisEncrypt(json_encode($unknown,JSON_THROW_ON_ERROR)));
    storeReject(fn()=>genesisE2eeReadProviderCaches($db,$id),'E2EE_PROVIDER_CACHE_FORMAT_UNSUPPORTED');
    $historical=$decoded;$historical['fingerprint']=str_repeat('b',64);file_put_contents($primaryBase.'.enc',genesisEncrypt(json_encode($historical,JSON_THROW_ON_ERROR)));
    storeCheck(genesisE2eeReadProviderCaches($db,$id)[0]['provenance']==='historical-grant');file_put_contents($primaryBase.'.enc',$original);
    // A grant change or linked reassignment between capture and final validation
    // must invalidate the opaque revision, without exporting any token values.
    $db->prepare('UPDATE linked_google_accounts SET owner_user_id=? WHERE id=?')->execute([$foreign,$fixture['linkedId']]);
    storeCheck($sourceHash!==genesisE2eeSourceHash($db,genesisE2eeScope($id,$scope)));
    storeCheck(count(genesisE2eeReadProviderCaches($db,$id))===1);
    $db->prepare('UPDATE linked_google_accounts SET owner_user_id=? WHERE id=?')->execute([$id,$fixture['linkedId']]);
    storeCheck($sourceHash===genesisE2eeSourceHash($db,genesisE2eeScope($id,$scope)));providerAssertOriginals();
    // The final commit independently validates filesystem changes even when
    // already-uploaded shadow objects and their manifest have been verified.
    genesisE2eeExecute($id,storePut('provider-shadow-object',0,$fixture['lease']),$session);
    $currentScope=genesisE2eeScope($id,$scope);$manifest=genesisE2eeManifest($db,$currentScope);$checkpoint=$currentScope['checkpoint_hash'];
    genesisE2eeExecute($id,storeCommand('migration-verify',['migrationId'=>$fixture['payload']['migrationId'],'fence'=>1,'manifestHash'=>$manifest['manifestHash'],
        'objectCount'=>$manifest['objectCount'],'verifiedCheckpoint'=>$checkpoint]),$session);
    file_put_contents($primaryBase.'.enc',$same);
    storeReject(fn()=>genesisE2eeExecute($id,storeCommand('migration-commit',['migrationId'=>$fixture['payload']['migrationId'],'fence'=>1,'manifestHash'=>$manifest['manifestHash'],
        'objectCount'=>$manifest['objectCount'],'verifiedCheckpoint'=>$checkpoint,'generation'=>(int)$currentScope['generation']]),$session),'E2EE_MIGRATION_UNVERIFIED');
    storeCheck(genesisE2eeScope($id,$scope)['state']==='verified'&&file_get_contents($primaryBase.'.enc')===$same);file_put_contents($primaryBase.'.enc',$original);
    genesisE2eeExecute($id,storeCommand('migration-cancel',['migrationId'=>$fixture['payload']['migrationId'],'fence'=>1]),$session);
    // Corruption in the ordinary working cache must fail before its callback,
    // rather than silently publishing an empty replacement or a new key.
    file_put_contents($primaryBase.'.enc','corrupt-original');$called=false;
    storeReject(fn()=>genesisGoogleCacheWithLock(genesisFindUser($id),static function()use(&$called):void{$called=true;}),'E2EE_PROVIDER_CACHE_CORRUPT');
    storeCheck(!$called&&file_get_contents($primaryBase.'.enc')==='corrupt-original');file_put_contents($primaryBase.'.enc',$original);
    $db->prepare('UPDATE users SET refresh_token_enc=? WHERE id=?')->execute([genesisEncrypt('synthetic-new-grant'),$id]);
    genesisGoogleCacheWithLock(genesisFindUser($id),static function(array &$state):void{$state['tasks']=['items'=>[['id'=>'new-grant-task','title'=>'Synthetic new grant']]];});
    $retained=dirname($primaryBase).'/retained/'.basename($primaryBase).'/'.hash('sha256',$original).'.enc';
    storeCheck(file_get_contents($retained)===$original);$newInventory=genesisE2eeReadProviderCaches($db,$id);
    storeCheck(count($newInventory)===3&&$newInventory[1]['provenance']==='historical-grant'&&$newInventory[1]['slot']==='retained:'.hash('sha256',$original));
    $withRetention=genesisE2eeSourceHash($db,genesisE2eeScope($id,$scope));unlink($retained);
    storeCheck($withRetention!==genesisE2eeSourceHash($db,genesisE2eeScope($id,$scope)));file_put_contents($retained,$original);
    // Explicit authorized provider cleanup removes current and retained copies;
    // the migration reader itself never invokes this mutating helper.
    genesisGoogleForgetSnapshot(genesisFindUser($id));storeCheck(!is_file($primaryBase.'.enc')&&!is_file($retained));
    file_put_contents($primaryBase.'.enc',$original);
    $fixture=legacyWorkspaceFixture('legacy',false);$base=genesisGoogleCacheDirectory().'/'.genesisGoogleCacheKey(['id'=>$owner]);
    $absent=genesisE2eeReadProviderCaches($db,$owner);storeCheck(count($absent)===1&&$absent[0]['presence']==='missing'&&!is_file($base.'.enc')&&!is_file($base.'.lock'));
    // JSON text within a string is ordinary text, not another object to project.
    $json=genesisE2eeProviderJson('{"text":"{\"x\":1,\"x\":2}"}');storeCheck($json->text==='{"x":1,"x":2}');
}finally{
    foreach($providerPaths as $base)foreach(['.enc','.lock']as $suffix)if(is_file($base.$suffix))unlink($base.$suffix);
}
echo 'PASS e2ee-provider-cache '.$checks.' cumulative assertions; exact owner-only ciphertext inventory, grant/presence revision, strict content read and unchanged originals'.PHP_EOL;
