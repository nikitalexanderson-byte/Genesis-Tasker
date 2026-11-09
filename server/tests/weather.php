<?php
declare(strict_types=1);

// Never load private config or make a real provider request in this test.
putenv('GENESIS_WEATHER_MET_TERMS_ACCEPTED');putenv('GENESIS_OPEN_METEO_COMMERCIAL_API_KEY');
$weatherTestRoot=sys_get_temp_dir().'/genesis-weather-'.bin2hex(random_bytes(8));mkdir($weatherTestRoot,0700);
$weatherTestConfig=['app_url'=>'https://localhost.invalid','google_only'=>true,'timezone'=>'UTC','cookie_secure'=>false,
    'db_path'=>$weatherTestRoot.'/genesis.sqlite','session_path'=>$weatherTestRoot.'/sessions','crypto_key'=>base64_encode(random_bytes(32)),
    'weather'=>['provider'=>'met-norway','met_terms_accepted'=>false]];
$weatherConfigPath=$weatherTestRoot.'/config.php';file_put_contents($weatherConfigPath,'<?php return '.var_export($weatherTestConfig,true).';');
define('GENESIS_LOCAL_TEST_CONFIG',$weatherConfigPath);define('GENESIS_STATELESS_REQUEST',true);
require dirname(__DIR__).'/src/bootstrap.php';require dirname(__DIR__).'/src/repository.php';require dirname(__DIR__).'/src/weather.php';
function weatherExpect(bool $ok,string $message): void { if(!$ok)throw new RuntimeException($message); }
function weatherReject(callable $operation): void {try{$operation();}catch(InvalidArgumentException){return;}throw new RuntimeException('Weather invalid request accepted.');}
function weatherRemoveTestTree(string $root): void {
    $resolved=realpath($root);$temporary=realpath(sys_get_temp_dir());
    if($resolved===false||$temporary===false||dirname($resolved)!==$temporary||preg_match('/\Agenesis-weather-[a-f0-9]{16}\z/D',basename($resolved))!==1)throw new RuntimeException('Unsafe weather test cleanup path.');
    $items=new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::CHILD_FIRST);
    foreach($items as$item)if(!($item->isDir()?rmdir($item->getPathname()):unlink($item->getPathname())))throw new RuntimeException('Weather test cleanup failed.');
    if(!rmdir($root))throw new RuntimeException('Weather test cleanup failed.');
}
try{
    $now=strtotime('2026-11-06T12:30:00Z');$base=strtotime('2026-11-06T12:00:00Z');
    $fixture=json_decode((string)file_get_contents(dirname(__DIR__,2).'/tests/fixtures/weather-met-v1.json'),true,64,JSON_THROW_ON_ERROR);
    $row=$fixture['properties']['timeseries'][0];$fixture['properties']['timeseries']=[];
    for($i=0;$i<48;$i++){$item=$row;$item['time']=genesisWeatherStamp($base+$i*3600);if($i===1)$item['data']['next_1_hours']['summary']['symbol_code']='heavysnow';$fixture['properties']['timeseries'][]=$item;}
    $point=['latitude'=>55.75581234,'longitude'=>37.61731234,'locationSource'=>'network'];
    $accepted=[...$weatherTestConfig,'weather'=>['provider'=>'met-norway','met_terms_accepted'=>true]];
    $calls=[];$transport=function(array $request)use(&$calls,$fixture):array{$calls[]=$request;return ['status'=>200,'headers'=>['last-modified'=>'Fri, 06 Nov 2026 12:00:00 GMT'],'body'=>json_encode($fixture,JSON_THROW_ON_ERROR)];};
    $disabled=genesisWeatherCurrent($point,$now,$transport,$weatherTestConfig);
    weatherExpect($disabled['status']==='disabled'&&$disabled['current']===null&&$calls===[]&&!is_dir($weatherTestRoot.'/weather'),'Terms gate accessed transport/cache.');
    $publicPolicy=genesisWeatherPublicPolicy();$defaultConfig=$weatherTestConfig;unset($defaultConfig['weather']);
    weatherExpect($publicPolicy['metNorway']['termsVersion']==='2026-11-05'&&$publicPolicy['metNorway']['operatorAcceptedOn']==='2026-11-07'
        &&genesisWeatherSettings($defaultConfig)['metAccepted'],'Documented human acceptance did not enable the tracked default.');
    putenv('GENESIS_WEATHER_MET_TERMS_ACCEPTED=1');
    $explicitFalse=genesisWeatherCurrent($point,$now,$transport,$weatherTestConfig);
    weatherExpect($explicitFalse['status']==='disabled'&&$calls===[]&&!is_dir($weatherTestRoot.'/weather'),'Environment opt-in overrode explicit config opt-out.');
    putenv('GENESIS_WEATHER_MET_TERMS_ACCEPTED=0');
    weatherExpect(!genesisWeatherSettings($defaultConfig)['metAccepted']&&!genesisWeatherSettings($accepted)['metAccepted'],'Environment opt-out did not suppress default/config acceptance.');
    putenv('GENESIS_WEATHER_MET_TERMS_ACCEPTED');
    $off=genesisWeatherCurrent($point,$now,$transport,[...$defaultConfig,'weather'=>['enabled'=>false]]);
    weatherExpect($off['status']==='disabled'&&$calls===[]&&!is_dir($weatherTestRoot.'/weather'),'Weather kill switch accessed transport/cache.');
    foreach(['timezone-network','timezone-fallback']as$source){$missing=genesisWeatherCurrent([...$point,'locationSource'=>$source],$now,$transport,$accepted);weatherExpect($missing['status']==='requires-location'&&$missing['current']===null&&$calls===[],'Timezone reference became local weather.');}
    weatherExpect(genesisWeatherCurrent([],$now,$transport,$accepted)['status']==='requires-location','Missing place not distinguished.');
    foreach([NAN,INF,-INF,'55.7',true,null,91,-91]as$value)weatherReject(fn()=>genesisWeatherPoint([...$point,'latitude'=>$value]));
    weatherReject(fn()=>genesisWeatherPoint([...$point,'longitude'=>181]));weatherReject(fn()=>genesisWeatherPoint([...$point,'url'=>'https://example.invalid']));
    $fresh=genesisWeatherCurrent($point,$now,$transport,$accepted);
    $expected=json_decode((string)file_get_contents(dirname(__DIR__,2).'/tests/fixtures/weather-v1.json'),true,64,JSON_THROW_ON_ERROR);
    weatherExpect($fresh==$expected,'Shared weather DTO/units changed.');
    weatherExpect(count($calls)===1&&str_contains($calls[0]['url'],'lat=55.7558')&&str_contains($calls[0]['url'],'lon=37.6173'),'Unbounded precision/upstream cell.');
    weatherExpect($calls[0]['connectTimeoutMs']===2000&&$calls[0]['timeoutMs']===6000&&$calls[0]['maxBytes']===2097152,'Provider transport unbounded.');
    $_SERVER['HTTP_COOKIE']='OAuthPrivateCookie';$_SERVER['HTTP_AUTHORIZATION']='Bearer OAuthPrivateToken';$_SERVER['HTTP_X_CSRF_TOKEN']='PrivateCsrf';
    $request=genesisWeatherProviderRequest('met-norway',$fresh['location'],genesisWeatherSettings($accepted),[]);
    weatherExpect(!preg_match('/OAuthPrivate|PrivateCsrf|Authorization:|Cookie:/',json_encode($request,JSON_THROW_ON_ERROR)),'Application auth leaked upstream.');
    $next=genesisWeatherCurrent($point,$now+3600,$transport,$accepted);
    weatherExpect(count($calls)===1&&$next['validAt']==='2026-11-06T13:00:00Z'&&$next['current']['condition']==='snow'&&$next['current']['snowDepthCm']===null,'Hourly cached slice/snow-cover distinction failed.');
    foreach(['UTC','Pacific/Kiritimati','America/New_York','Europe/Berlin']as$zone){date_default_timezone_set($zone);$same=genesisWeatherCurrent($point,$now,$transport,$accepted);weatherExpect($same==$fresh,'Server timezone changed weather/UTC timestamps.');}date_default_timezone_set('UTC');
    weatherExpect(genesisWeatherTime('2026-02-30T00:00:00Z')===null&&genesisWeatherTime('2026-11-01T01:30:00-04:00')===null,'Malformed/ambiguous times accepted.');
    foreach(['2026-03-08T06:59:59Z','2026-03-08T07:00:00Z','2026-11-01T05:30:00Z','2026-11-01T06:30:00Z']as$stamp)weatherExpect(genesisWeatherStamp(genesisWeatherTime($stamp))===$stamp,'UTC DST instant changed.');
    $badUnits=$fixture;$badUnits['properties']['meta']['units']['wind_speed']='km/h';
    weatherExpect(genesisWeatherNormalizeMet($badUnits,$now)['points'][0]['current']['windSpeedMps']===null,'Unknown unit invented metric wind.');
    weatherExpect(genesisWeatherMetCondition('lightsnowshowersandthunder_night')['phenomena']===['snow','thunderstorm'],'MET combined condition lost.');
    weatherExpect(genesisWeatherMetCondition('lightssnowshowersandthunder_day')['phenomena']===['snow','thunderstorm'],'MET catalog alias lost.');
    weatherExpect(genesisWeatherMetCondition('notarealcondition')['condition']==='unknown','Unknown condition guessed.');
    $again=genesisWeatherCurrent($point,$now+11101,function(array$request)use(&$calls):array{$calls[]=$request;return ['status'=>304,'headers'=>[],'body'=>''];},$accepted);
    weatherExpect(count($calls)===2&&in_array('If-Modified-Since: Fri, 06 Nov 2026 12:00:00 GMT',$calls[1]['headers'],true)&&$again['status']==='fresh','Conditional revalidation failed.');
    $stale=genesisWeatherCurrent($point,$now+22202,static function():array{throw new RuntimeException('Synthetic outage');},$accepted);
    weatherExpect($stale['status']==='stale'&&$stale['current']!==null&&$stale['observedAt']===null,'Outage lost safe stale state.');
    $outdated=genesisWeatherCurrent($point,$now+11101+86401,static function():array{throw new RuntimeException('Synthetic outage');},$accepted);
    weatherExpect($outdated['status']==='unavailable'&&$outdated['current']===null,'Old sample remained current.');
    $different=genesisWeatherCurrent([...$point,'latitude'=>50],$now,$transport,$accepted);weatherExpect($different['location']['latitude']===50.0,'Cell/account location mixed.');
    $expiryConfig=[...$accepted,'db_path'=>$weatherTestRoot.'/expiry/test.sqlite'];$expiryCalls=0;
    $expires=function()use(&$expiryCalls,$fixture,$now):array{$expiryCalls++;return ['status'=>200,'headers'=>['expires'=>gmdate('D, d M Y H:i:s \G\M\T',$now+20000)],'body'=>json_encode($fixture,JSON_THROW_ON_ERROR)];};
    genesisWeatherCurrent($point,$now,$expires,$expiryConfig);genesisWeatherCurrent($point,$now+15000,$expires,$expiryConfig);weatherExpect($expiryCalls===1,'Provider Expires ignored.');
    $failureConfig=[...$accepted,'db_path'=>$weatherTestRoot.'/failure/test.sqlite'];$failureCalls=0;
    $malformed=function()use(&$failureCalls):array{$failureCalls++;return ['status'=>200,'headers'=>[],'body'=>'{"properties":"bad"}'];};
    for($i=0;$i<10;$i++){$failed=genesisWeatherCurrent($point,$now+$i,$malformed,$failureConfig);weatherExpect($failed['status']==='unavailable'&&$failed['current']===null,'Malformed response fabricated weather.');}
    weatherExpect($failureCalls===1,'Malformed payload caused retry storm.');
    $throttleConfig=[...$accepted,'db_path'=>$weatherTestRoot.'/throttle/test.sqlite'];$throttleCalls=0;
    $throttled=function()use(&$throttleCalls):array{$throttleCalls++;return ['status'=>429,'headers'=>['retry-after'=>'600'],'body'=>'sensitive upstream error'];};
    $limited=genesisWeatherCurrent($point,$now,$throttled,$throttleConfig);genesisWeatherCurrent([...$point,'latitude'=>51],$now+1,$throttled,$throttleConfig);
    weatherExpect($throttleCalls===1&&$limited['status']==='unavailable'&&!str_contains(json_encode($limited),'sensitive'),'429 cooldown/error leaked across cells.');
    $rate=$weatherTestRoot.'/rate';genesisEnsureDirectory($rate);
    for($i=0;$i<20;$i++)weatherExpect(genesisWeatherTransportSlot($rate,'met-norway',1000.9)===null,'Rate slot lost early.');
    weatherExpect(genesisWeatherTransportSlot($rate,'open-meteo',1001.01)!==null&&genesisWeatherTransportSlot($rate,'met-norway',1001.91)===null,'Global sliding max20/s failed.');
    $locked=$weatherTestRoot.'/locktest';genesisEnsureDirectory($locked);$key=hash('sha256','test');$lock=genesisWeatherCacheLock($locked,$key);
    weatherExpect(is_resource($lock)&&genesisWeatherCacheLock($locked,$key)===false,'Concurrent refresh did not return immediately.');flock($lock,LOCK_UN);fclose($lock);
    file_put_contents($locked.'/corrupt.json','{');weatherExpect(genesisWeatherCacheRead($locked.'/corrupt.json')===[],'Corrupt cache accepted.');
    $om=[...$accepted,'db_path'=>$weatherTestRoot.'/commercial/test.sqlite','weather'=>['provider'=>'open-meteo','open_meteo_commercial_api_key'=>'synthetic-commercial-key']];
    $omBody=['hourly_units'=>['time'=>'unixtime','temperature_2m'=>'°C','apparent_temperature'=>'°C','relative_humidity_2m'=>'%','pressure_msl'=>'hPa','wind_speed_10m'=>'m/s','wind_direction_10m'=>'°','wind_gusts_10m'=>'m/s','cloud_cover'=>'%','precipitation'=>'mm','rain'=>'mm','showers'=>'mm','snow_depth'=>'m','visibility'=>'m'],
        'hourly'=>['time'=>[$base,$base+3600],'temperature_2m'=>[2,3],'apparent_temperature'=>[0,1],'relative_humidity_2m'=>[80,70],'pressure_msl'=>[1000,1001],'wind_speed_10m'=>[5,6],'wind_direction_10m'=>[360,90],'wind_gusts_10m'=>[8,9],'cloud_cover'=>[80,70],'precipitation'=>[1,0],'rain'=>[0.5,0],'showers'=>[0.5,0],'snow_depth'=>[0.03,0],'visibility'=>[800,10000],'weather_code'=>[51,96]],
        'current_units'=>['time'=>'unixtime','temperature_2m'=>'°C','relative_humidity_2m'=>'%','wind_speed_10m'=>'m/s'],
        'current'=>['time'=>$now,'interval'=>900,'temperature_2m'=>2.5,'relative_humidity_2m'=>75,'wind_speed_10m'=>5.5,'weather_code'=>51]];
    $omRequest=null;$commercial=genesisWeatherCurrent($point,$now,function($request)use(&$omRequest,$omBody){$omRequest=$request;return ['status'=>200,'headers'=>[],'body'=>json_encode($omBody,JSON_THROW_ON_ERROR)];},$om);
    weatherExpect($commercial['status']==='fresh'&&$commercial['current']['snowDepthCm']===3.0&&$commercial['current']['condition']==='drizzle'&&$commercial['current']['rain1hMm']===1.0,'Commercial units/current normalization failed.');
    weatherExpect($commercial['issuedAt']===null&&$commercial['observedAt']===null&&$commercial['provider']['dataKind']==='forecast','Model estimate became observation.');
    weatherExpect(str_starts_with($omRequest['url'],'https://customer-api.open-meteo.com/')&&str_contains($omRequest['url'],'models=best_match')&&!str_contains(json_encode($commercial),'synthetic-commercial-key'),'Commercial credentials/endpoint leaked.');
    $noKey=genesisWeatherCurrent($point,$now,$transport,[...$om,'weather'=>['provider'=>'open-meteo']]);weatherExpect($noKey['status']==='disabled','Public noncommercial fallback enabled.');

    // Run DB/router checks in a child so its static PDO closes before Windows cleanup.
    $childCommand=[PHP_BINARY];if(($ini=php_ini_loaded_file())!==false)array_push($childCommand,'-c',$ini);
    array_push($childCommand,'-d','disable_functions=curl_exec,mail',__DIR__.'/weather-http.php',$weatherConfigPath);
    $child=proc_open($childCommand,[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$childPipes,dirname(__DIR__,2));
    weatherExpect(is_resource($child),'Cannot start weather HTTP acceptance child.');fclose($childPipes[0]);
    $childOutput=stream_get_contents($childPipes[1]);$childError=stream_get_contents($childPipes[2]);fclose($childPipes[1]);fclose($childPipes[2]);
    weatherExpect(proc_close($child)===0,'Weather HTTP acceptance failed: '.$childOutput.$childError);
    echo "Weather offline DTO, coordinates, times, stale/cache/304/429/rate limits, commercial units, auth isolation and real HTTP auth/CSRF/body/terms checks passed.\n";
}finally{
    if(session_status()===PHP_SESSION_ACTIVE)session_write_close();
    gc_collect_cycles();weatherRemoveTestTree($weatherTestRoot);
}
