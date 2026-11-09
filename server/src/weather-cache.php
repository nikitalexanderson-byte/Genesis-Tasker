<?php
declare(strict_types=1);

function genesisWeatherCacheRead(string $path): array
{
    if(!is_file($path))return [];
    $raw=file_get_contents($path,false,null,0,GENESIS_WEATHER_MAX_BODY+65537);
    if(!is_string($raw)||strlen($raw)>GENESIS_WEATHER_MAX_BODY+65536)return [];
    try{$value=json_decode($raw,true,64,JSON_THROW_ON_ERROR);}catch(Throwable){return [];}
    return is_array($value)?$value:[];
}

function genesisWeatherCacheWrite(string $path,array $value): void
{
    $raw=json_encode($value,JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);
    if(strlen($raw)>GENESIS_WEATHER_MAX_BODY+65536)throw new RuntimeException('WEATHER_CACHE_SIZE');
    $temporary=$path.'.'.bin2hex(random_bytes(8)).'.tmp';
    try{
        if(file_put_contents($temporary,$raw)!==strlen($raw))throw new RuntimeException('WEATHER_CACHE_WRITE');
        chmod($temporary,0600);
        if(!rename($temporary,$path))throw new RuntimeException('WEATHER_CACHE_WRITE');
    }finally{if(is_file($temporary))unlink($temporary);}
}

/** Fixed lock stripes keep lock-file count bounded even when locations change often. */
function genesisWeatherCacheLock(string $directory,string $key)
{
    $stripe=hexdec(substr($key,0,2))%64;$handle=fopen($directory.'/lock-'.$stripe,'c+');
    if($handle===false)return false;
    chmod($directory.'/lock-'.$stripe,0600);
    if(!flock($handle,LOCK_EX|LOCK_NB)){fclose($handle);return false;}
    return $handle;
}

/** Global sliding one-second ceiling, shared across PHP workers and both providers. */
function genesisWeatherTransportSlot(string $directory,string $provider,float $now): ?int
{
    $lock=fopen($directory.'/rate.lock','c+');if($lock===false)return (int)ceil($now)+5;
    try{
        if(!flock($lock,LOCK_EX|LOCK_NB))return (int)ceil($now)+5;
        chmod($directory.'/rate.lock',0600);$path=$directory.'/rate.json';$state=genesisWeatherCacheRead($path);
        $blocked=(int)($state['blocked'][$provider]??0);if($blocked>$now)return $blocked;
        $recent=array_values(array_filter($state['recent']??[],static fn($at)=>(is_int($at)||is_float($at))&&$at>$now-1&&$at<=$now));
        if(count($recent)>=20)return (int)ceil($now)+1;
        $recent[]=$now;$state['recent']=$recent;genesisWeatherCacheWrite($path,$state);return null;
    }finally{flock($lock,LOCK_UN);fclose($lock);}
}

function genesisWeatherBlockProvider(string $directory,string $provider,int $until): void
{
    $lock=fopen($directory.'/rate.lock','c+');if($lock===false)return;
    try{
        if(!flock($lock,LOCK_EX))return;
        $path=$directory.'/rate.json';$state=genesisWeatherCacheRead($path);
        $state['blocked'][$provider]=max((int)($state['blocked'][$provider]??0),$until);
        genesisWeatherCacheWrite($path,$state);
    }finally{flock($lock,LOCK_UN);fclose($lock);}
}

function genesisWeatherPruneCache(string $directory,int $now): void
{
    $paths=glob($directory.'/cell-*.json')?:[];
    usort($paths,static fn($a,$b)=>(filemtime($a)?:0)<=>(filemtime($b)?:0));
    $extra=max(0,count($paths)-1023);
    foreach($paths as $index=>$path)if($index<$extra||(filemtime($path)?:0)<$now-172800)@unlink($path);
}

/** Stores anonymous public forecast cells, never account identifiers or auth headers. */
function genesisWeatherLoadCell(array $point,array $settings,int $now,callable $transport): array
{
    $directory=$settings['cacheDirectory'];genesisEnsureDirectory($directory);
    $provider=$settings['provider'];$key=hash('sha256','v1:'.$provider.':'.sprintf('%.4F:%.4F',$point['latitude'],$point['longitude']));
    $path=$directory.'/cell-'.$key.'.json';$cached=genesisWeatherCacheRead($path);
    if(($cached['schemaVersion']??null)!==1||($cached['provider']??null)!==$provider)$cached=[];
    if((int)($cached['nextAttemptAt']??0)>$now)return $cached;
    $lock=genesisWeatherCacheLock($directory,$key);
    if($lock===false)return [...$cached,'busy'=>true,'nextAttemptAt'=>$now+5];
    try{
        $fresh=genesisWeatherCacheRead($path);
        if(($fresh['schemaVersion']??null)===1&&($fresh['provider']??null)===$provider)$cached=$fresh;
        if((int)($cached['nextAttemptAt']??0)>$now)return $cached;
        if(($blocked=genesisWeatherTransportSlot($directory,$provider,$settings['rateNow']))!==null)return [...$cached,'busy'=>true,'nextAttemptAt'=>$blocked];
        $interval=$provider==='met-norway'?10800:900;
        $next=$now+$interval+(hexdec(substr($key,0,4))%301);
        $entry=[...$cached,'schemaVersion'=>1,'provider'=>$provider,'nextAttemptAt'=>$next,'failure'=>null,'busy'=>false];
        try{
            $response=$transport(genesisWeatherProviderRequest($provider,$point,$settings,$cached));
            $status=$response['status']??0;$headers=$response['headers']??[];
            if(!is_int($status)||!is_array($headers))throw new UnexpectedValueException('WEATHER_UPSTREAM_INVALID');
            if($status===429||$status===503){
                $retry=$headers['retry-after']??null;
                $until=is_string($retry)&&ctype_digit($retry)?$now+min(86400,(int)$retry):(is_string($retry)?strtotime($retry):false);
                $until=max($now+60,is_int($until)?min($until,$now+86400):0);
                genesisWeatherBlockProvider($directory,$provider,$until);$entry['nextAttemptAt']=max($next,$until);
                throw new RuntimeException('WEATHER_UPSTREAM_UNAVAILABLE');
            }
            if($status===304){
                if(!is_array($cached['payload']??null))throw new UnexpectedValueException('WEATHER_UPSTREAM_INVALID');
            }elseif($status===200){
                $raw=$response['body']??null;if(!is_string($raw)||strlen($raw)>GENESIS_WEATHER_MAX_BODY)throw new UnexpectedValueException('WEATHER_UPSTREAM_INVALID');
                $body=json_decode($raw,true,64,JSON_THROW_ON_ERROR);
                if(!is_array($body))throw new UnexpectedValueException('WEATHER_UPSTREAM_INVALID');
                $provider==='met-norway'?genesisWeatherNormalizeMet($body,$now):genesisWeatherNormalizeOpenMeteo($body,$now);
                $entry['payload']=$body;
            }else{throw new RuntimeException('WEATHER_UPSTREAM_UNAVAILABLE');}
            // Honour provider expiry and conditional requests; never re-fetch MET within three hours.
            $expires=is_string($headers['expires']??null)?strtotime($headers['expires']):false;
            $entry['nextAttemptAt']=max($next,is_int($expires)?min($expires,$now+86400):0);
            $modified=$headers['last-modified']??null;
            if(is_string($modified)&&strlen($modified)<=128&&strtotime($modified)!==false&&!preg_match('/[\r\n]/',$modified))$entry['lastModified']=$modified;
            $entry['fetchedAt']=$now;$entry['goodUntil']=$entry['nextAttemptAt'];
        }catch(Throwable $error){
            $entry['failure']=$error instanceof UnexpectedValueException||$error instanceof JsonException?'upstream-invalid':'upstream-unavailable';
        }
        genesisWeatherPruneCache($directory,$now);genesisWeatherCacheWrite($path,$entry);return $entry;
    }finally{flock($lock,LOCK_UN);fclose($lock);}
}
