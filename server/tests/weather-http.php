<?php
declare(strict_types=1);
// Called only by weather.php with its explicit temporary synthetic configuration.
if(!isset($argv[1]))return;
putenv('GENESIS_WEATHER_MET_TERMS_ACCEPTED=0');
$configPath=$argv[1]??'';
if(!is_file($configPath))throw new RuntimeException('Weather HTTP synthetic config missing.');
$weatherTestConfig=require $configPath;
if(($weatherTestConfig['app_url']??'')!=='https://localhost.invalid')throw new RuntimeException('Weather HTTP requires isolated config.');
$weatherConfigPath=$configPath;$weatherTestRoot=dirname($configPath);
define('GENESIS_LOCAL_TEST_CONFIG',$configPath);define('GENESIS_STATELESS_REQUEST',true);
require dirname(__DIR__).'/src/bootstrap.php';require dirname(__DIR__).'/src/repository.php';require dirname(__DIR__).'/src/weather.php';
function weatherExpect(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);}
$point=['latitude'=>55.75581234,'longitude'=>37.61731234,'locationSource'=>'network'];
$weatherHttpProcess=null;
try{
    // Real local router checks: auth, CSRF, bounded body and disabled upstream.
    $db=genesisDb();$db->prepare('INSERT INTO users(id,google_sub,email,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)')->execute(['weather-http','weather-http-sub','weather@example.invalid','Weather fixture',genesisNow(),genesisNow()]);
    genesisEnsureDirectory($weatherTestConfig['session_path']);$sessionId=bin2hex(random_bytes(24));$csrf=bin2hex(random_bytes(24));
    $session=['user_id'=>'weather-http','security_epoch'=>0,'auth_identity'=>['kind'=>'primary','sub'=>'weather-http-sub','channel'=>'web'],'auth_login_id'=>'weather-http-login','csrf'=>$csrf];
    $encoded='';foreach($session as$key=>$value)$encoded.=$key.'|'.serialize($value);file_put_contents($weatherTestConfig['session_path'].'/sess_'.$sessionId,$encoded);
    $listener=stream_socket_server('tcp://127.0.0.1:0',$errno,$error);weatherExpect($listener!==false,'Cannot reserve local weather test port.');$address=stream_socket_get_name($listener,false);fclose($listener);
    $router=$weatherTestRoot.'/router.php';file_put_contents($router,'<?php define("GENESIS_LOCAL_TEST_CONFIG",'.var_export($weatherConfigPath,true).'); require '.var_export(dirname(__DIR__).'/public/api/index.php',true).';');
    $command=[PHP_BINARY];if(($ini=php_ini_loaded_file())!==false)array_push($command,'-c',$ini);array_push($command,'-d','disable_functions=curl_exec,mail','-S',$address,$router);
    $weatherHttpProcess=proc_open($command,[0=>['pipe','r'],1=>['file',$weatherTestRoot.'/http.log','a'],2=>['file',$weatherTestRoot.'/http.log','a']],$weatherHttpPipes,dirname(__DIR__,2));weatherExpect(is_resource($weatherHttpProcess),'Cannot start weather HTTP fixture.');fclose($weatherHttpPipes[0]);
    for($i=0;$i<50;$i++){$socket=@stream_socket_client('tcp://'.$address,$errno,$error,0.1);if($socket!==false){fclose($socket);break;}usleep(100000);}
    $http=function(?string$cookie,?string$sentCsrf,string$body,string$method='POST')use($address):array{
        $headers="Content-Type: application/json\r\nX-Genesis-Foreground: 0\r\n";if($cookie!==null)$headers.="Cookie: GENESISSESSID=$cookie\r\n";if($sentCsrf!==null)$headers.="X-CSRF-Token: $sentCsrf\r\n";
        $context=stream_context_create(['http'=>['method'=>$method,'ignore_errors'=>true,'timeout'=>10,'header'=>$headers,'content'=>$body]]);
        $bytes=file_get_contents('http://'.$address.'/?path=weather/v1/current',false,$context);preg_match('/^HTTP\/\S+ (\d+)/',($http_response_header??[])[0]??'',$match);
        return ['status'=>(int)($match[1]??0),'data'=>json_decode($bytes?:'{}',true)];};
    $body=json_encode($point,JSON_THROW_ON_ERROR);
    weatherExpect($http(null,null,$body)['status']===401,'Weather route allowed anonymous account access.');
    weatherExpect($http($sessionId,'bad',$body)['status']===403,'Weather route ignored CSRF.');
    weatherExpect($http($sessionId,$csrf,$body,'GET')['status']===405,'Weather route exposed GET coordinate queries.');
    weatherExpect($http($sessionId,$csrf,str_repeat('x',1025))['status']===413,'Weather route body not bounded.');
    $disabledHttp=$http($sessionId,$csrf,$body);weatherExpect($disabledHttp['status']===200&&($disabledHttp['data']['weather']['status']??null)==='disabled','HTTP terms gate touched disabled transport.');
    for($i=0;$i<59;$i++)weatherExpect($http($sessionId,$csrf,$body)['status']===200,'Weather account budget rejected early.');
    weatherExpect($http($sessionId,$csrf,$body)['status']===429,'Weather account budget not enforced.');
    $_SERVER['HTTP_X_CSRF_TOKEN']=$csrf;genesisStartSession();$_SESSION=$session;
    weatherExpect(genesisSharedRequestUserId('POST')==='weather-http'&&session_status()!==PHP_SESSION_ACTIVE,'Weather auth boundary held session lock.');
    echo "Weather HTTP auth, CSRF, body, terms and session boundary passed.\n";
}finally{
    if(is_resource($weatherHttpProcess)){proc_terminate($weatherHttpProcess);proc_close($weatherHttpProcess);}
    if(session_status()===PHP_SESSION_ACTIVE)session_write_close();
}
