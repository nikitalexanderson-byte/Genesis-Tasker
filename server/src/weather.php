<?php
declare(strict_types=1);
require_once __DIR__.'/weather-providers.php';
require_once __DIR__.'/weather-cache.php';

/** Public operator decision; never contains credentials or account/location data. */
function genesisWeatherPublicPolicy(): array
{
    static $policy;
    return $policy??=json_decode((string)file_get_contents(dirname(__DIR__).'/resources/weather-provider-policy.json'),true,16,JSON_THROW_ON_ERROR);
}

function genesisWeatherSettings(array $config): array
{
    $weather=is_array($config['weather']??null)?$config['weather']:[];
    $policy=genesisWeatherPublicPolicy();
    $provider=$weather['provider']??$policy['defaultProvider']??'met-norway';
    if(!in_array($provider,['met-norway','open-meteo'],true))$provider='met-norway';
    $accepted=($policy['schemaVersion']??null)===1&&($policy['metNorway']['termsAccepted']??false)===true
        &&($policy['metNorway']['termsVersion']??null)==='2026-11-05';
    // An explicit operator opt-out wins over the public default and any opt-in.
    $hasAcceptance=array_key_exists('met_terms_accepted',$weather);$acceptanceEnv=getenv('GENESIS_WEATHER_MET_TERMS_ACCEPTED');
    if($hasAcceptance)$accepted=$weather['met_terms_accepted']===true;
    if($acceptanceEnv!==false)$accepted=$acceptanceEnv==='1'&&(!$hasAcceptance||$accepted);
    $key=$weather['open_meteo_commercial_api_key']??'';
    if($key==='')$key=getenv('GENESIS_OPEN_METEO_COMMERCIAL_API_KEY')?:'';
    return ['enabled'=>($weather['enabled']??true)===true,'provider'=>$provider,
        'metAccepted'=>$accepted,
        'commercialKey'=>is_string($key)&&strlen($key)<=256&&!preg_match('/[\x00-\x20\x7f]/',$key)?$key:'',
        'cacheDirectory'=>dirname((string)$config['db_path']).'/weather'];
}

/** A time-zone reference is suitable for approximate solar light, not local weather. */
function genesisWeatherPoint(array $input): ?array
{
    if(array_diff(array_keys($input),['latitude','longitude','locationSource']))throw new InvalidArgumentException('WEATHER_REQUEST_INVALID');
    $source=$input['locationSource']??null;
    if($input===[]||in_array($source,['timezone-network','timezone-fallback'],true))return null;
    if(!in_array($source,['selected-city','network'],true))throw new InvalidArgumentException('WEATHER_LOCATION_SOURCE_INVALID');
    $latitude=genesisWeatherNumber($input['latitude']??null,-90,90);$longitude=genesisWeatherNumber($input['longitude']??null,-180,180);
    if($latitude===null||$longitude===null)throw new InvalidArgumentException('WEATHER_COORDINATES_INVALID');
    return ['latitude'=>round($latitude,4)+0.0,'longitude'=>round($longitude,4)+0.0,'approximate'=>$source==='network'];
}

function genesisWeatherEnvelope(string $provider,?array $point): array
{
    return ['schemaVersion'=>1,'status'=>'unavailable','reason'=>null,'provider'=>genesisWeatherProvider($provider),'location'=>$point,
        'issuedAt'=>null,'observedAt'=>null,'validAt'=>null,'validUntil'=>null,'fetchedAt'=>null,'expiresAt'=>null,'retryAt'=>null,'current'=>null];
}

/** Adapter selection is server-owned. Clients never submit a provider, URL or key. */
function genesisWeatherCurrent(array $input,?int $now=null,?callable $transport=null,?array $testConfig=null): array
{
    $rateNow=$now===null?microtime(true):(float)$now;$now??=time();$settings=genesisWeatherSettings($testConfig??genesisConfig());$settings['rateNow']=$rateNow;
    $point=genesisWeatherPoint($input);$result=genesisWeatherEnvelope($settings['provider'],$point);
    if($point===null)return [...$result,'status'=>'requires-location','reason'=>'place-required'];
    if(!$settings['enabled']||($settings['provider']==='met-norway'&&!$settings['metAccepted'])||($settings['provider']==='open-meteo'&&$settings['commercialKey']===''))
        return [...$result,'status'=>'disabled','reason'=>!$settings['enabled']?'not-configured':($settings['provider']==='met-norway'?'terms-not-accepted':'not-configured')];
    try{
        $cached=genesisWeatherLoadCell($point,$settings,$now,$transport??'genesisWeatherHttp');
        if(!is_array($cached['payload']??null))return [...$result,'reason'=>$cached['failure']??'refreshing','retryAt'=>genesisWeatherStamp(max($now+300,(int)($cached['nextAttemptAt']??0)))];
        $series=$settings['provider']==='met-norway'?genesisWeatherNormalizeMet($cached['payload'],$now):genesisWeatherNormalizeOpenMeteo($cached['payload'],$now);
        $fetched=$cached['fetchedAt']??null;$selected=null;
        foreach($series['points'] as $sample)if($sample['at']<=$now&&$sample['until']>$now&&($selected===null||$sample['at']>=$selected['at']))$selected=$sample;
        if(!is_int($fetched)||$fetched>$now+60||$fetched<$now-86400||$selected===null||($series['issuedAt']!==null&&$series['issuedAt']<$now-129600))
            return [...$result,'reason'=>'source-outdated','retryAt'=>genesisWeatherStamp(max($now+300,(int)($cached['nextAttemptAt']??0)))];
        $fresh=empty($cached['failure'])&&empty($cached['busy'])&&(int)($cached['goodUntil']??0)>$now;
        $expires=min($selected['until'],(int)($cached['goodUntil']??$now));
        return [...$result,'status'=>$fresh?'fresh':'stale','reason'=>$fresh?null:($cached['failure']??'refreshing'),
            'issuedAt'=>genesisWeatherStamp($series['issuedAt']),'observedAt'=>genesisWeatherStamp($series['observedAt']),
            'validAt'=>genesisWeatherStamp($selected['at']),'validUntil'=>genesisWeatherStamp($selected['until']),
            'fetchedAt'=>genesisWeatherStamp($fetched),'expiresAt'=>genesisWeatherStamp($expires),
            'retryAt'=>genesisWeatherStamp($fresh?$expires:max($now+300,min($selected['until'],(int)($cached['nextAttemptAt']??$now+300)))),'current'=>$selected['current']];
    }catch(Throwable $error){
        genesisLogError('Weather service unavailable.',$error);
        return [...$result,'reason'=>'upstream-unavailable','retryAt'=>genesisWeatherStamp($now+300)];
    }
}
