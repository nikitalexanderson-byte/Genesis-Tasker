<?php
declare(strict_types=1);

const GENESIS_WEATHER_USER_AGENT = 'GENESIS/3.2.4 (+https://genesiscalendar.com; https://github.com/nikitalexanderson-byte/calendar-genesis)';
const GENESIS_WEATHER_MAX_BODY = 2097152;

function genesisWeatherProvider(string $id): array
{
    return $id === 'open-meteo'
        ? ['id'=>$id,'name'=>'Open-Meteo','attributionUrl'=>'https://open-meteo.com/','licenseUrl'=>'https://open-meteo.com/en/terms','dataKind'=>'forecast']
        : ['id'=>'met-norway','name'=>'MET Norway','attributionUrl'=>'https://www.met.no/','licenseUrl'=>'https://creativecommons.org/licenses/by/4.0/','dataKind'=>'forecast'];
}

function genesisWeatherNumber(mixed $value, float $minimum, float $maximum): ?float
{
    return (is_int($value)||is_float($value)) && is_finite((float)$value) && $value >= $minimum && $value <= $maximum ? (float)$value : null;
}

function genesisWeatherTime(mixed $value): ?int
{
    if (is_int($value)) return $value >= 0 && $value <= 4133980800 ? $value : null;
    if (!is_string($value)||preg_match('/\A\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\z/D',$value)!==1) return null;
    $date=DateTimeImmutable::createFromFormat('!Y-m-d\TH:i:s\Z',$value,new DateTimeZone('UTC'));
    return $date && $date->format('Y-m-d\TH:i:s\Z')===$value ? $date->getTimestamp() : null;
}

function genesisWeatherStamp(?int $value): ?string { return $value===null?null:gmdate('Y-m-d\TH:i:s\Z',$value); }

function genesisWeatherEmptyCurrent(): array
{
    return array_fill_keys(['temperatureC','apparentTemperatureC','humidityPercent','pressureMslHpa','windSpeedMps','windDirectionDeg','windGustMps',
        'cloudCoverPercent','precipitation1hMm','rain1hMm','snowWaterEquivalent1hMm','precipitationRateMmH','snowDepthCm','visibilityM'],null)
        + ['condition'=>'unknown','phenomena'=>[],'precipitationKind'=>'unknown','intensity'=>'unknown','providerCode'=>null,'thunderstorm'=>null,'storm'=>null,'blizzard'=>null];
}

function genesisWeatherMetCondition(mixed $symbol): array
{
    $empty=['condition'=>'unknown','phenomena'=>[],'precipitationKind'=>'unknown','intensity'=>'unknown','providerCode'=>null,'thunderstorm'=>null,'storm'=>null,'blizzard'=>null];
    if (!is_string($symbol)||strlen($symbol)>80||preg_match('/\A[a-z]+(?:_(?:day|night|polartwilight))?\z/D',$symbol)!==1) return $empty;
    $code=preg_replace('/_(?:day|night|polartwilight)\z/','',$symbol);
    $thunder=str_ends_with($code,'andthunder');
    if ($thunder) $code=substr($code,0,-10);
    // MET's symbol catalog retains these two historic double-s spellings.
    $code=['lightssleetshowers'=>'lightsleetshowers','lightssnowshowers'=>'lightsnowshowers'][$code]??$code;
    $simple=['clearsky'=>'clear','fair'=>'partly-cloudy','partlycloudy'=>'partly-cloudy','cloudy'=>'cloudy','fog'=>'fog'];
    if (isset($simple[$code])&&!$thunder) return [...$empty,'condition'=>$simple[$code],'phenomena'=>$code==='fog'?['fog']:[],
        'precipitationKind'=>'none','intensity'=>'none','providerCode'=>$symbol,'thunderstorm'=>false];
    if (preg_match('/\A(light|heavy)?(rain|sleet|snow)(?:showers)?\z/D',$code,$match)!==1) return $empty;
    $kind=$match[2];$phenomena=[$kind];if($thunder)$phenomena[]='thunderstorm';
    return [...$empty,'condition'=>$thunder?'thunderstorm':$kind,'phenomena'=>$phenomena,'precipitationKind'=>$kind,
        'intensity'=>($match[1]??'')==='light'?'light':(($match[1]??'')==='heavy'?'heavy':'moderate'),'providerCode'=>$symbol,'thunderstorm'=>$thunder,'storm'=>$thunder?true:null];
}

function genesisWeatherWmoCondition(mixed $code): array
{
    $empty=['condition'=>'unknown','phenomena'=>[],'precipitationKind'=>'unknown','intensity'=>'unknown','providerCode'=>null,'thunderstorm'=>null,'storm'=>null,'blizzard'=>null];
    if (!is_int($code)||$code<0||$code>99) return $empty;
    $simple=[0=>'clear',1=>'partly-cloudy',2=>'partly-cloudy',3=>'cloudy',45=>'fog',48=>'fog'];
    if(isset($simple[$code]))return [...$empty,'condition'=>$simple[$code],'phenomena'=>$simple[$code]==='fog'?['fog']:[],
        'precipitationKind'=>'none','intensity'=>'none','providerCode'=>(string)$code,'thunderstorm'=>false];
    $groups=[51=>['drizzle','light'],53=>['drizzle','moderate'],55=>['drizzle','heavy'],56=>['freezing-rain','light'],57=>['freezing-rain','heavy'],
        61=>['rain','light'],63=>['rain','moderate'],65=>['rain','heavy'],66=>['freezing-rain','light'],67=>['freezing-rain','heavy'],
        71=>['snow','light'],73=>['snow','moderate'],75=>['snow','heavy'],77=>['snow','light'],80=>['rain','light'],81=>['rain','moderate'],82=>['rain','heavy'],85=>['snow','light'],86=>['snow','heavy']];
    if(isset($groups[$code])){[$kind,$intensity]=$groups[$code];return [...$empty,'condition'=>$kind,'phenomena'=>[$kind],
        'precipitationKind'=>$kind,'intensity'=>$intensity,'providerCode'=>(string)$code,'thunderstorm'=>false];}
    if(in_array($code,[95,96,99],true))return [...$empty,'condition'=>'thunderstorm','phenomena'=>$code===95?['thunderstorm']:['thunderstorm','hail'],
        'precipitationKind'=>$code===95?'unknown':'hail','intensity'=>$code===99?'heavy':'moderate','providerCode'=>(string)$code,'thunderstorm'=>true,'storm'=>true];
    return $empty;
}

/** Only metric units explicitly supplied by the provider are accepted. */
function genesisWeatherMetric(array $values,array $units,string $key,string $unit,float $min,float $max): ?float
{
    return ($units[$key]??null)===$unit?genesisWeatherNumber($values[$key]??null,$min,$max):null;
}

function genesisWeatherNormalizeMet(array $body,int $now): array
{
    $properties=$body['properties']??null;$issued=genesisWeatherTime($properties['meta']['updated_at']??null);
    $rows=$properties['timeseries']??null;$units=$properties['meta']['units']??null;
    if($issued===null||$issued>$now+300||!is_array($rows)||!array_is_list($rows)||count($rows)>2048||!is_array($units))throw new UnexpectedValueException('WEATHER_UPSTREAM_INVALID');
    $points=[];
    foreach($rows as $row){
        $at=genesisWeatherTime($row['time']??null);$values=$row['data']['instant']['details']??null;
        if($at===null||!is_array($values))continue;
        $hour=$row['data']['next_1_hours']??[];
        $current=[...genesisWeatherEmptyCurrent(),...genesisWeatherMetCondition($hour['summary']['symbol_code']??null)];
        foreach(['temperatureC'=>['air_temperature','celsius',-100,70],'humidityPercent'=>['relative_humidity','%',0,100],
            'pressureMslHpa'=>['air_pressure_at_sea_level','hPa',300,1200],'windSpeedMps'=>['wind_speed','m/s',0,150],
            'windDirectionDeg'=>['wind_from_direction','degrees',0,360],'windGustMps'=>['wind_speed_of_gust','m/s',0,200],
            'cloudCoverPercent'=>['cloud_area_fraction','%',0,100]] as $key=>[$source,$unit,$min,$max])$current[$key]=genesisWeatherMetric($values,$units,$source,$unit,$min,$max);
        if($current['windDirectionDeg']===360.0)$current['windDirectionDeg']=0.0;
        $current['precipitation1hMm']=genesisWeatherMetric($hour['details']??[],$units,'precipitation_amount','mm',0,1000);
        $current['precipitationRateMmH']=$current['precipitation1hMm'];
        // Total water equivalent is not rain amount, snowfall depth or snow cover.
        $points[]=['at'=>$at,'until'=>$at+3600,'current'=>$current];
    }
    if(!$points)throw new UnexpectedValueException('WEATHER_UPSTREAM_INVALID');
    usort($points,static fn($a,$b)=>$a['at']<=>$b['at']);
    return ['issuedAt'=>$issued,'observedAt'=>null,'points'=>$points];
}

function genesisWeatherNormalizeOpenMeteo(array $body,int $now): array
{
    $hourly=$body['hourly']??null;$units=$body['hourly_units']??null;$times=$hourly['time']??null;
    if(!is_array($hourly)||!is_array($units)||!is_array($times)||!array_is_list($times)||count($times)>2048||($units['time']??null)!=='unixtime')throw new UnexpectedValueException('WEATHER_UPSTREAM_INVALID');
    $points=[];
    foreach($times as $index=>$time){
        $at=genesisWeatherTime($time);if($at===null)continue;
        $values=[];foreach($hourly as $key=>$items)if(is_array($items))$values[$key]=$items[$index]??null;
        $current=[...genesisWeatherEmptyCurrent(),...genesisWeatherWmoCondition($values['weather_code']??null)];
        foreach(['temperatureC'=>['temperature_2m','°C',-100,70],'apparentTemperatureC'=>['apparent_temperature','°C',-120,80],
            'humidityPercent'=>['relative_humidity_2m','%',0,100],'pressureMslHpa'=>['pressure_msl','hPa',300,1200],
            'windSpeedMps'=>['wind_speed_10m','m/s',0,150],'windDirectionDeg'=>['wind_direction_10m','°',0,360],
            'windGustMps'=>['wind_gusts_10m','m/s',0,200],'cloudCoverPercent'=>['cloud_cover','%',0,100],
            'precipitation1hMm'=>['precipitation','mm',0,1000],'visibilityM'=>['visibility','m',0,200000]] as $key=>[$source,$unit,$min,$max])$current[$key]=genesisWeatherMetric($values,$units,$source,$unit,$min,$max);
        if($current['windDirectionDeg']===360.0)$current['windDirectionDeg']=0.0;
        $rain=genesisWeatherMetric($values,$units,'rain','mm',0,1000);$showers=genesisWeatherMetric($values,$units,'showers','mm',0,1000);
        $current['rain1hMm']=$rain!==null&&$showers!==null?genesisWeatherNumber($rain+$showers,0,1000):null;
        $depth=genesisWeatherMetric($values,$units,'snow_depth','m',0,30);$current['snowDepthCm']=$depth===null?null:$depth*100;
        $current['precipitationRateMmH']=$current['precipitation1hMm'];
        $points[]=['at'=>$at,'until'=>$at+3600,'current'=>$current];
    }
    if(!$points)throw new UnexpectedValueException('WEATHER_UPSTREAM_INVALID');
    // Current API values are model estimates at a shorter interval, not observations.
    $live=$body['current']??[];$liveUnits=$body['current_units']??[];$at=genesisWeatherTime($live['time']??null);
    $interval=$live['interval']??null;
    if($at!==null&&($liveUnits['time']??null)==='unixtime'&&is_int($interval)&&$interval>=60&&$interval<=3600){
        $base=null;foreach($points as $point)if($point['at']<=$at&&$point['until']>$at)$base=$point['current'];
        if($base!==null){
            $short=[...$base,...genesisWeatherWmoCondition($live['weather_code']??null)];
            foreach(['temperatureC'=>['temperature_2m','°C',-100,70],'apparentTemperatureC'=>['apparent_temperature','°C',-120,80],
                'humidityPercent'=>['relative_humidity_2m','%',0,100],'pressureMslHpa'=>['pressure_msl','hPa',300,1200],
                'windSpeedMps'=>['wind_speed_10m','m/s',0,150],'windDirectionDeg'=>['wind_direction_10m','°',0,360],
                'windGustMps'=>['wind_gusts_10m','m/s',0,200],'cloudCoverPercent'=>['cloud_cover','%',0,100]] as $key=>[$source,$unit,$min,$max])$short[$key]=genesisWeatherMetric($live,$liveUnits,$source,$unit,$min,$max);
            if($short['windDirectionDeg']===360.0)$short['windDirectionDeg']=0.0;
            $points[]=['at'=>$at,'until'=>$at+$interval,'current'=>$short];
        }
    }
    usort($points,static fn($a,$b)=>$a['at']<=>$b['at']);
    return ['issuedAt'=>null,'observedAt'=>null,'points'=>$points];
}

/** Fresh allowlisted request headers only: no application auth, cookies or caller headers. */
function genesisWeatherProviderRequest(string $provider,array $point,array $settings,array $cached): array
{
    $headers=['Accept: application/json','User-Agent: '.GENESIS_WEATHER_USER_AGENT];
    if($provider==='met-norway'){
        if(!$settings['metAccepted'])throw new LogicException('WEATHER_TERMS_NOT_ACCEPTED');
        $url='https://api.met.no/weatherapi/locationforecast/2.0/compact?'.http_build_query(['lat'=>$point['latitude'],'lon'=>$point['longitude']]);
        if(is_string($cached['lastModified']??null)&&strtotime($cached['lastModified'])!==false&&!preg_match('/[\r\n]/',$cached['lastModified']))$headers[]='If-Modified-Since: '.$cached['lastModified'];
    }else{
        if($settings['commercialKey']==='')throw new LogicException('WEATHER_COMMERCIAL_KEY_REQUIRED');
        $hourly='temperature_2m,relative_humidity_2m,apparent_temperature,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,precipitation,rain,showers,snow_depth,visibility,weather_code';
        $url='https://customer-api.open-meteo.com/v1/forecast?'.http_build_query(['latitude'=>$point['latitude'],'longitude'=>$point['longitude'],
            'apikey'=>$settings['commercialKey'],'models'=>'best_match','current'=>'temperature_2m,relative_humidity_2m,apparent_temperature,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,weather_code',
            'hourly'=>$hourly,'temperature_unit'=>'celsius','wind_speed_unit'=>'ms','precipitation_unit'=>'mm','timezone'=>'UTC','timeformat'=>'unixtime','forecast_days'=>2,'past_days'=>1]);
    }
    return ['url'=>$url,'headers'=>$headers,'connectTimeoutMs'=>2000,'timeoutMs'=>6000,'maxBytes'=>GENESIS_WEATHER_MAX_BODY];
}

function genesisWeatherHttp(array $request): array
{
    $host=parse_url($request['url'],PHP_URL_HOST);
    if(parse_url($request['url'],PHP_URL_SCHEME)!=='https'||!in_array($host,['api.met.no','customer-api.open-meteo.com'],true))throw new LogicException('WEATHER_HOST_INVALID');
    $body='';$headers=[];$curl=curl_init($request['url']);if($curl===false)throw new RuntimeException('WEATHER_UPSTREAM_UNAVAILABLE');
    try{
        curl_setopt_array($curl,[CURLOPT_FOLLOWLOCATION=>false,CURLOPT_MAXREDIRS=>0,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_SSL_VERIFYHOST=>2,
            CURLOPT_CONNECTTIMEOUT_MS=>$request['connectTimeoutMs'],CURLOPT_TIMEOUT_MS=>$request['timeoutMs'],CURLOPT_HTTPHEADER=>$request['headers'],
            CURLOPT_HEADERFUNCTION=>static function($curl,string $line)use(&$headers):int{$parts=explode(':',$line,2);if(count($parts)===2){$key=strtolower(trim($parts[0]));if(in_array($key,['expires','last-modified','retry-after','cache-control'],true))$headers[$key]=trim($parts[1]);}return strlen($line);},
            CURLOPT_WRITEFUNCTION=>static function($curl,string $bytes)use(&$body,$request):int{if(strlen($body)+strlen($bytes)>$request['maxBytes'])return 0;$body.=$bytes;return strlen($bytes);}]);
        if(curl_exec($curl)===false)throw new RuntimeException('WEATHER_UPSTREAM_UNAVAILABLE');
        return ['status'=>(int)curl_getinfo($curl,CURLINFO_RESPONSE_CODE),'headers'=>$headers,'body'=>$body];
    }finally{curl_close($curl);}
}
