<?php
declare(strict_types=1);
require_once __DIR__.'/google-sync-cache.php';

/** Private provider snapshots are a separate legacy source, including an absent
 * snapshot. The fixed account list is read from SQL authority; neither client
 * account hints nor old task creation receipts grant access to a linked file. */
function genesisE2eeProviderAccounts(PDO $db,string $owner):array
{
    $columns='id,google_sub,refresh_token_enc,granted_scopes';
    $q=$db->prepare('SELECT '.$columns.' FROM users WHERE id=?');$q->execute([$owner]);$primary=$q->fetch();$q->closeCursor();
    if(!$primary)throw new DomainException('E2EE_SOURCE_UNAVAILABLE');
    $accounts=[['kind'=>'primary','user'=>$primary]];
    $q=$db->prepare('SELECT '.$columns.' FROM linked_google_accounts WHERE owner_user_id=? ORDER BY id');$q->execute([$owner]);
    try{while($row=$q->fetch()){
        if(count($accounts)>=10000)throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
        $accounts[]=['kind'=>'linked','user'=>$row+['_linked_account'=>true,'_owner_user_id'=>$owner]];
    }}finally{$q->closeCursor();}
    return $accounts;
}

/** No mkdir, new lock, decrypt, provider request, token refresh or cleanup.
 * The exclusive owner gate drains current callbacks before any file/SQL read.
 * An old process holding a cache mutex causes a nonblocking retry, never a
 * SQL-writer -> blocking-file acquisition. Existing originals remain untouched. */
function genesisE2eeVisitProviderCaches(PDO $db,string $owner,callable $visit):void
{
    genesisE2eeWithPersonalIo($owner,true,static function()use($db,$owner,$visit):void{
        $directory=dirname((string)genesisConfig()['db_path']).'/google-sync';
        if(is_link($directory)||file_exists($directory)&&(!is_dir($directory)||!is_readable($directory)))throw new DomainException('E2EE_PROVIDER_CACHE_UNAVAILABLE');
        if(file_exists($directory.'/retained')&&!is_dir($directory.'/retained'))throw new DomainException('E2EE_PROVIDER_CACHE_UNAVAILABLE');
        foreach(genesisE2eeProviderAccounts($db,$owner)as $account){
            $base=$directory.'/'.genesisGoogleCacheKey($account['user']);$mutex=null;
            try{
                clearstatcache(true,$base.'.lock');
                if(is_link($base.'.lock'))throw new DomainException('E2EE_PROVIDER_CACHE_UNAVAILABLE');
                if(file_exists($base.'.lock')){
                    if(!is_file($base.'.lock')||($mutex=@fopen($base.'.lock','rb'))===false)throw new DomainException('E2EE_PROVIDER_CACHE_UNAVAILABLE');
                    if(!flock($mutex,LOCK_SH|LOCK_NB))throw new DomainException('E2EE_OPERATION_BUSY');
                }
                $targets=['current'=>$base.'.enc'];$retained=$directory.'/retained/'.genesisGoogleCacheKey($account['user']);
                if(is_link($directory.'/retained')||is_link($retained))throw new DomainException('E2EE_PROVIDER_CACHE_UNAVAILABLE');
                if(file_exists($retained)){
                    if(!is_dir($retained))throw new DomainException('E2EE_PROVIDER_CACHE_UNAVAILABLE');
                    $entries=scandir($retained);if($entries===false)throw new DomainException('E2EE_PROVIDER_CACHE_UNAVAILABLE');
                    foreach($entries as $entry){
                        if($entry==='.'||$entry==='..')continue;
                        // Incomplete/unknown retention entries need review too;
                        // silently ignoring a crashed write could lose a source.
                        if(!preg_match('/\A[a-f0-9]{64}\.enc\z/D',$entry))throw new DomainException('E2EE_PROVIDER_CACHE_REVIEW_REQUIRED');
                        if(count($targets)>=10000)throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
                        $targets['retained:'.substr($entry,0,64)]=$retained.'/'.$entry;
                    }
                }
                foreach($targets as $slot=>$path){
                    clearstatcache(true,$path);if(is_link($path))throw new DomainException('E2EE_PROVIDER_CACHE_UNAVAILABLE');
                    if(!file_exists($path)){$visit($account,$slot,null);continue;}
                    if(!is_file($path)||($handle=@fopen($path,'rb'))===false)throw new DomainException('E2EE_PROVIDER_CACHE_UNAVAILABLE');
                    try{
                        $before=fstat($handle);if(!is_array($before)||($before['mode']&0170000)!==0100000||$before['size']>32*1024*1024)
                            throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
                        $visit($account,$slot,$handle);
                        clearstatcache(true,$path);$after=stat($path);
                        if(!is_array($after)||is_link($path)||$before['size']!==$after['size']||$before['mtime']!==$after['mtime']
                            ||$before['ino']!==$after['ino']||$before['dev']!==$after['dev'])throw new DomainException('E2EE_SOURCE_CHANGED');
                    }finally{fclose($handle);}
                }
            }finally{if(is_resource($mutex)){flock($mutex,LOCK_UN);fclose($mutex);}}
        }
    });
}

/** Extend the already private HMAC revision with exact ciphertext bytes,
 * presence/absence, account ownership and current grant binding. No digest of
 * plaintext or provider token is returned independently to the client. */
function genesisE2eeHashProviderCaches(PDO $db,string $owner,HashContext $hash,int &$bytes):void
{
    hash_update($hash,"provider-cache-v1\0");
    genesisE2eeVisitProviderCaches($db,$owner,static function(array $account,string $slot,$handle)use($hash,&$bytes):void{
        hash_update($hash,serialize([$account['kind'],$account['user']['id'],genesisGoogleCacheFingerprint($account['user']),$slot,is_resource($handle)]));
        if(is_resource($handle)){
            $size=fstat($handle)['size'];$bytes+=$size;
            if($bytes>128*1024*1024)throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
            hash_update($hash,pack('N',$size));
            if(hash_update_stream($hash,$handle)!==$size)throw new DomainException('E2EE_PROVIDER_CACHE_UNAVAILABLE');
        }
    });
}

/** Validate JSON grammar/depth first, then reject duplicate decoded names.
 * json_decode alone silently projects {"title":a,"\u0074itle":b} to one value. */
function genesisE2eeProviderJson(string $plain):stdClass
{
    if(strlen($plain)>16*1024*1024)throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
    try{$decoded=json_decode($plain,false,40,JSON_THROW_ON_ERROR);}catch(JsonException){throw new DomainException('E2EE_PROVIDER_CACHE_CORRUPT');}
    if(!$decoded instanceof stdClass)throw new DomainException('E2EE_PROVIDER_CACHE_CORRUPT');
    $stack=[];$length=strlen($plain);
    for($i=0;$i<$length;$i++){
        $char=$plain[$i];
        if($char==='{'||$char==='[')$stack[]=$char==='{'?[]:null;
        elseif($char==='}'||$char===']')array_pop($stack);
        elseif($char==='"'){
            $start=$i;$i++;
            while($i<$length&&$plain[$i]!=='"'){if($plain[$i]==='\\')$i++;$i++;}
            $next=$i+1;while($next<$length&&str_contains(" \r\n\t",$plain[$next]))$next++;
            if($next<$length&&$plain[$next]===':'){
                $name=json_decode(substr($plain,$start,$i-$start+1),true,2,JSON_THROW_ON_ERROR);$last=count($stack)-1;
                if($last<0||$stack[$last]===null||array_key_exists($name,$stack[$last]))throw new DomainException('E2EE_PROVIDER_CACHE_CORRUPT');
                $stack[$last][$name]=true;
            }
        }
    }
    return $decoded;
}

/** Content projection deliberately excludes fingerprint and syncToken. These
 * are current provider credentials/cursors, never new-root execution grants.
 * Unknown fields refuse migration instead of silently losing private content. */
function genesisE2eeProviderContent(stdClass $snapshot,array $account):array
{
    $fields=get_object_vars($snapshot);
    if(array_diff(array_keys($fields),['fingerprint','calendar','tasks'])!==[])throw new DomainException('E2EE_PROVIDER_CACHE_FORMAT_UNSUPPORTED');
    if(!is_string($fields['fingerprint']??null)||!preg_match('/\A[a-f0-9]{64}\z/D',$fields['fingerprint']))throw new DomainException('E2EE_PROVIDER_CACHE_CORRUPT');
    $result=['provenance'=>hash_equals(genesisGoogleCacheFingerprint($account['user']),$fields['fingerprint'])?'current-grant':'historical-grant','calendar'=>null,'tasks'=>null];
    foreach(['calendar','tasks']as $service){
        if(!array_key_exists($service,$fields))continue;
        $state=$fields[$service];if(!$state instanceof stdClass)throw new DomainException('E2EE_PROVIDER_CACHE_CORRUPT');
        $values=get_object_vars($state);$allowed=['items','checkedAt','fullAt','nextAttempt','warning',$service==='tasks'?'lists':'syncToken'];
        if(array_diff(array_keys($values),$allowed)!==[])throw new DomainException('E2EE_PROVIDER_CACHE_FORMAT_UNSUPPORTED');
        foreach(['items',...($service==='tasks'?['lists']:[])]as $list)if(isset($values[$list])&&!is_array($values[$list]))throw new DomainException('E2EE_PROVIDER_CACHE_CORRUPT');
        if(isset($values['syncToken'])&&!is_string($values['syncToken']))throw new DomainException('E2EE_PROVIDER_CACHE_CORRUPT');
        unset($values['syncToken']);$result[$service]=(object)$values;
    }
    return $result;
}

function genesisE2eeReadProviderCaches(PDO $db,string $owner):array
{
    $result=[];$bytes=0;$count=0;
    genesisE2eeVisitProviderCaches($db,$owner,static function(array $account,string $slot,$handle)use(&$result,&$bytes,&$count):void{
        if(++$count>10000)throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
        $value=['kind'=>$account['kind'],'accountId'=>$account['user']['id'],'slot'=>$slot,'version'=>null,'presence'=>'missing','provenance'=>'none','calendar'=>null,'tasks'=>null];
        if(is_resource($handle)){
            $cipher=stream_get_contents($handle);if(!is_string($cipher))throw new DomainException('E2EE_PROVIDER_CACHE_UNAVAILABLE');
            $version=hash('sha256',$cipher);
            if(str_starts_with($slot,'retained:')&&!hash_equals(substr($slot,9),$version))throw new DomainException('E2EE_PROVIDER_CACHE_CORRUPT');
            $blob=base64_decode($cipher,true);$key=base64_decode((string)genesisConfig()['crypto_key'],true);
            if(!is_string($key)||strlen($key)!==SODIUM_CRYPTO_SECRETBOX_KEYBYTES||!is_string($blob)||strlen($blob)<=SODIUM_CRYPTO_SECRETBOX_NONCEBYTES+SODIUM_CRYPTO_SECRETBOX_MACBYTES
                ||base64_encode($blob)!==$cipher)throw new DomainException('E2EE_PROVIDER_CACHE_CORRUPT');
            $plain=genesisDecrypt($cipher);if(!is_string($plain))throw new DomainException('E2EE_PROVIDER_CACHE_CORRUPT');
            try{$content=genesisE2eeProviderContent(genesisE2eeProviderJson($plain),$account);}finally{sodium_memzero($plain);}
            $value=array_replace($value,$content,['version'=>$version,'presence'=>'stored']);
        }
        $bytes+=strlen(json_encode($value,JSON_THROW_ON_ERROR));
        if($bytes>16*1024*1024)throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
        $result[]=$value;
    });
    return $result;
}
