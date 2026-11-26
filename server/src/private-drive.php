<?php
declare(strict_types=1);

/** Ciphertext-only personal backups. No vault/content repository is consulted.
 * No Drive/Calendar/Tasks token is ever copied between credential stores. */
const GENESIS_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const GENESIS_DRIVE_MAX_FILE = 24 * 1024 * 1024;
const GENESIS_DRIVE_CONSENT = 'encrypted-drive-backup-336-v1';

function genesisDriveEnabled(): bool
{
    return (genesisConfig()['private_drive_enabled'] ?? false) === true
        && !empty(genesisConfig()['google_client_id']) && !empty(genesisConfig()['google_client_secret']);
}
function genesisDriveRequireEnabled(): void
{
    if (!genesisDriveEnabled()) throw new GenesisResourceLimitException(503,'DRIVE_DISABLED');
}
function genesisDriveUuid(mixed $value): string
{
    if (!is_string($value) || !preg_match('/\A[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\z/D',$value)) throw new InvalidArgumentException('DRIVE_INVALID');
    return $value;
}
function genesisDriveFileId(mixed $value): string
{
    if (!is_string($value) || !preg_match('/\A[A-Za-z0-9_-]{10,200}\z/D',$value)) throw new InvalidArgumentException('DRIVE_INVALID');
    return $value;
}
function genesisDriveConnection(string $owner): ?array
{
    $q=genesisDb()->prepare('SELECT * FROM private_drive_connections WHERE user_id=?');$q->execute([$owner]);$row=$q->fetch();$q->closeCursor();return $row?:null;
}
function genesisDriveBoundConnection(string $owner,string $id): array
{
    $row=genesisDriveConnection($owner);$user=genesisFindUser($owner);
    if (!$row || !$user || (int)$row['active']!==1 || !hash_equals($row['connection_id'],$id)
        || !hash_equals((string)$user['google_sub'],$row['google_sub'])) throw new DomainException('DRIVE_CONNECTION_CHANGED');
    return $row;
}
function genesisDriveStatus(string $owner): array
{
    $row=genesisDriveConnection($owner);
    return ['enabled'=>genesisDriveEnabled(),'connectionId'=>$row&&(int)$row['active']===1?$row['connection_id']:null,'consentVersion'=>GENESIS_DRIVE_CONSENT];
}

/** Bounded HTTPS requests to fixed Google endpoints, with no redirects, provider
 * error bodies, access tokens or upload-session URLs in errors/logs. */
function genesisDriveHttp(string $url,string $method,array $headers,?string $body=null,int $limit=262144): array
{
    $parts=parse_url($url);
    if (($parts['scheme']??'')!=='https' || !in_array($parts['host']??'',['www.googleapis.com','oauth2.googleapis.com','openidconnect.googleapis.com'],true)
        || isset($parts['user']) || isset($parts['pass']) || isset($parts['port']) || isset($parts['fragment'])) throw new LogicException('DRIVE_INVALID_ENDPOINT');
    $result='';$responseHeaders=[];$headerBytes=0;$handle=curl_init($url);
    curl_setopt_array($handle,[CURLOPT_CUSTOMREQUEST=>$method,CURLOPT_HTTPHEADER=>$headers,CURLOPT_FOLLOWLOCATION=>false,
        CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_CONNECTTIMEOUT=>10,CURLOPT_TIMEOUT=>90,CURLOPT_USERAGENT=>'GENESIS-Drive/3.3.6',
        CURLOPT_WRITEFUNCTION=>static function($curl,string $chunk)use(&$result,$limit):int{if(strlen($result)+strlen($chunk)>$limit)return 0;$result.=$chunk;return strlen($chunk);},
        CURLOPT_HEADERFUNCTION=>static function($curl,string $line)use(&$responseHeaders,&$headerBytes):int{
            $headerBytes+=strlen($line);if($headerBytes>16384)return 0;$at=strpos($line,':');if($at!==false)$responseHeaders[strtolower(trim(substr($line,0,$at)))]=trim(substr($line,$at+1));return strlen($line);
        }]);
    if ($body!==null) curl_setopt($handle,CURLOPT_POSTFIELDS,$body);
    try{$ok=curl_exec($handle);$status=(int)curl_getinfo($handle,CURLINFO_RESPONSE_CODE);if($ok===false)throw new RuntimeException('DRIVE_CONNECTION_UNCERTAIN');}
    finally{curl_close($handle);}
    return ['status'=>$status,'body'=>$result,'headers'=>$responseHeaders];
}
function genesisDriveJson(array $response): array
{
    if($response['status']<200||$response['status']>=300)throw new GenesisResourceLimitException(502,'DRIVE_PROVIDER_FAILED');
    try{$value=json_decode($response['body'],true,16,JSON_THROW_ON_ERROR);}catch(Throwable){throw new RuntimeException('DRIVE_INVALID_RESPONSE');}
    if(!is_array($value))throw new RuntimeException('DRIVE_INVALID_RESPONSE');return $value;
}
function genesisDriveTokenRequest(array $fields): array
{
    return genesisDriveJson(genesisDriveHttp('https://oauth2.googleapis.com/token','POST',['Content-Type: application/x-www-form-urlencoded'],http_build_query($fields,'','&',PHP_QUERY_RFC3986)));
}
function genesisDriveBegin(string $owner,array $input,bool $native): array
{
    genesisDriveRequireEnabled();genesisBackupRequirePaid($owner);genesisE2eeExactFields($input,['consentVersion']);
    if($input['consentVersion']!==GENESIS_DRIVE_CONSENT)throw new DomainException('DRIVE_CONSENT_REQUIRED');
    $user=genesisFindUser($owner);$binding=(string)($_SESSION['auth_login_id']??'');
    if(!$user||genesisUserProvider($user)!=='google'||strlen($binding)<16)throw new DomainException('DRIVE_AUTH_REQUIRED');
    $id=genesisUuid();$nonce=genesisBase64Url(random_bytes(32));$verifier=genesisBase64Url(random_bytes(64));$state=genesisBase64Url(random_bytes(32));
    $attempt=['attemptId'=>$id,'user_id'=>$owner,'security_epoch'=>(int)$user['security_epoch'],'login'=>$binding,
        'baseline'=>genesisDriveConnection($owner)['connection_id']??null,'issued_at'=>time(),'nonce'=>$nonce,'native'=>$native];
    $_SESSION['drive_oauth_request']=$attempt;
    if($native)return ['attemptId'=>$id,'serverClientId'=>(string)genesisConfig()['google_client_id'],'scopes'=>['openid','email',GENESIS_DRIVE_SCOPE]];
    $_SESSION['oauth_request']=[...$attempt,'purpose'=>'drive','state'=>$state,'verifier'=>$verifier,'return_to'=>'/'];
    return ['url'=>genesisGoogleAuthUrl($state,genesisBase64Url(hash('sha256',$verifier,true)),'drive',(string)$user['email'],$nonce)];
}
function genesisDriveAuthorize(string $owner,array $attempt,array $tokens,?array $webProfile=null): array
{
    genesisDriveRequireEnabled();$pending=$_SESSION['drive_oauth_request']??null;unset($_SESSION['drive_oauth_request']);
    $user=genesisFindUser($owner);
    if(!$user||!is_array($pending)||$pending!==$attempt||$attempt['user_id']!==$owner||$attempt['security_epoch']!==(int)$user['security_epoch']
        ||$attempt['login']!==($_SESSION['auth_login_id']??null)||$attempt['issued_at']<time()-120||$attempt['issued_at']>time()
        ||!genesisGoogleTokenHasScopes($tokens,[GENESIS_DRIVE_SCOPE])||!is_string($tokens['access_token']??null)||!is_string($tokens['refresh_token']??null)
        ||$tokens['access_token']===''||$tokens['refresh_token']===''||strlen($tokens['access_token'])>16384||strlen($tokens['refresh_token'])>16384)throw new DomainException('DRIVE_AUTH_STALE');
    $profile=$webProfile??genesisDriveJson(genesisDriveHttp('https://openidconnect.googleapis.com/v1/userinfo','GET',['Authorization: Bearer '.$tokens['access_token']]));
    if(!is_string($profile['sub']??null)||!hash_equals((string)$user['google_sub'],$profile['sub']))throw new DomainException('DRIVE_ACCOUNT_MISMATCH');
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        $current=genesisDriveConnection($owner);$live=genesisFindUser($owner);
        if(($current['connection_id']??null)!==$attempt['baseline']||!$live||(int)$live['security_epoch']!==$attempt['security_epoch']||$live['google_sub']!==$profile['sub'])throw new DomainException('DRIVE_CONNECTION_CHANGED');
        $id=genesisUuid();$db->prepare('UPDATE private_drive_operations SET upload_uri_enc=NULL WHERE user_id=?')->execute([$owner]);
        $db->prepare('INSERT INTO private_drive_connections VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET connection_id=excluded.connection_id,google_sub=excluded.google_sub,active=excluded.active,access_token_enc=excluded.access_token_enc,refresh_token_enc=excluded.refresh_token_enc,expires_at=excluded.expires_at,created_at=excluded.created_at')
            ->execute([$owner,$id,$profile['sub'],1,genesisEncrypt($tokens['access_token']),genesisEncrypt($tokens['refresh_token']),time()+max(0,min(3600,(int)($tokens['expires_in']??0))),genesisNow()]);$db->commit();
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
    return genesisDriveStatus($owner);
}
function genesisDriveAccessToken(string $owner,string $id,bool $refresh=false): string
{
    $row=genesisDriveBoundConnection($owner,$id);$token=genesisDecrypt($row['access_token_enc']);
    if(!$refresh&&is_string($token)&&$token!==''&&(int)$row['expires_at']>time()+60)return $token;
    $stored=genesisDecrypt($row['refresh_token_enc']);if(!$stored)throw new DomainException('DRIVE_RECONNECT_REQUIRED');
    $tokens=genesisDriveTokenRequest(['client_id'=>(string)genesisConfig()['google_client_id'],'client_secret'=>(string)genesisConfig()['google_client_secret'],'refresh_token'=>$stored,'grant_type'=>'refresh_token']);
    $token=$tokens['access_token']??null;if(!is_string($token)||$token===''||strlen($token)>16384)throw new DomainException('DRIVE_RECONNECT_REQUIRED');
    genesisDriveBoundConnection($owner,$id);
    $q=genesisDb()->prepare('UPDATE private_drive_connections SET access_token_enc=?,expires_at=? WHERE user_id=? AND connection_id=? AND active=1');
    $q->execute([genesisEncrypt($token),time()+max(0,min(3600,(int)($tokens['expires_in']??0))),$owner,$id]);if($q->rowCount()!==1)throw new DomainException('DRIVE_CONNECTION_CHANGED');return $token;
}
function genesisDriveApi(string $owner,string $id,string $path,string $method='GET',?string $body=null,array $headers=[],int $limit=262144): array
{
    if(!str_starts_with($path,'/drive/v3/files')&&!str_starts_with($path,'/upload/drive/v3/files'))throw new LogicException('DRIVE_INVALID_ENDPOINT');
    $response=genesisDriveHttp('https://www.googleapis.com'.$path,$method,['Authorization: Bearer '.genesisDriveAccessToken($owner,$id),...$headers],$body,$limit);
    if($response['status']===401)$response=genesisDriveHttp('https://www.googleapis.com'.$path,$method,['Authorization: Bearer '.genesisDriveAccessToken($owner,$id,true),...$headers],$body,$limit);
    genesisDriveBoundConnection($owner,$id);return $response;
}
function genesisDriveProperties(string $owner,array $operation): array
{
    return ['format'=>'genesisbackup-v1','owner'=>hash('sha256','genesis-drive-owner-v1:'.$owner),'operation'=>$operation['operation_id'],
        'backup'=>$operation['backup_id'],'sha256'=>$operation['file_hash'],'bytes'=>(string)$operation['file_bytes']];
}
function genesisDriveOperation(string $owner,array $input): array
{
    genesisE2eeExactFields($input,['connectionId','operationId','backupId','sha256','bytes']);
    foreach(['connectionId','operationId','backupId']as$key)genesisDriveUuid($input[$key]);
    if(!is_string($input['sha256'])||!preg_match('/\A[a-f0-9]{64}\z/D',$input['sha256'])||!is_int($input['bytes'])||$input['bytes']<1||$input['bytes']>GENESIS_DRIVE_MAX_FILE)throw new InvalidArgumentException('DRIVE_INVALID');
    genesisDriveBoundConnection($owner,$input['connectionId']);
    $read=static function()use($owner,$input):?array{$q=genesisDb()->prepare('SELECT * FROM private_drive_operations WHERE user_id=? AND operation_id=?');$q->execute([$owner,$input['operationId']]);$row=$q->fetch();$q->closeCursor();return $row?:null;};
    $row=$read();if(!$row){
        $ids=genesisDriveJson(genesisDriveApi($owner,$input['connectionId'],'/drive/v3/files/generateIds?count=1&space=appDataFolder&type=files'));$file=genesisDriveFileId($ids['ids'][0]??null);
        $db=genesisDb();genesisBeginWriteTransaction($db);try{
            genesisDriveBoundConnection($owner,$input['connectionId']);$row=$read();if(!$row){
                $q=$db->prepare('SELECT COUNT(*) FROM private_drive_operations WHERE user_id=?');$q->execute([$owner]);$count=(int)$q->fetchColumn();$q->closeCursor();if($count>=10000)throw new GenesisResourceLimitException(413,'DRIVE_HISTORY_LIMIT');
                $db->prepare('INSERT INTO private_drive_operations VALUES(?,?,?,?,?,?,?,?,?,?)')->execute([$owner,$input['operationId'],$input['connectionId'],$file,$input['backupId'],$input['sha256'],$input['bytes'],null,null,genesisNow()]);$row=$read();
            }$db->commit();
        }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
    }
    foreach(['connection_id'=>'connectionId','backup_id'=>'backupId','file_hash'=>'sha256','file_bytes'=>'bytes']as$column=>$key)
        if((string)$row[$column]!== (string)$input[$key])throw new DomainException('DRIVE_IDEMPOTENCY_CONFLICT');
    return $row;
}
function genesisDriveValidateFile(string $file,string $backupId): void
{
    if(strlen($file)<1||strlen($file)>GENESIS_DRIVE_MAX_FILE)throw new InvalidArgumentException('DRIVE_INVALID_FILE');
    try{$header=json_decode($file,true,8,JSON_THROW_ON_ERROR);}catch(Throwable){throw new InvalidArgumentException('DRIVE_INVALID_FILE');}
    genesisE2eeExactFields($header,['format','schema','backupId','algorithm','wrappedKey','iv','ciphertext','sha256']);
    // json_decode alone accepts duplicate (including escaped) field names.
    // This portable header is flat; reject projections that hide extra bytes.
    $names=[];$length=strlen($file);
    for($at=0;$at<$length;$at++)if($file[$at]==='"'){
        $start=$at++;while($at<$length&&$file[$at]!=='"'){if($file[$at]==='\\')$at++;$at++;}
        $next=$at+1;while($next<$length&&str_contains(" \t\r\n",$file[$next]))$next++;
        if($next<$length&&$file[$next]===':'){
            if($at-$start>64)throw new InvalidArgumentException('DRIVE_INVALID_FILE');$name=json_decode(substr($file,$start,$at-$start+1),true,2,JSON_THROW_ON_ERROR);
            if(!is_string($name)||isset($names[$name]))throw new InvalidArgumentException('DRIVE_INVALID_FILE');$names[$name]=true;
        }
    }
    if($header['format']!=='genesisbackup'||$header['schema']!==1||$header['backupId']!==$backupId||$header['algorithm']!=='A256GCM+A256KW')throw new InvalidArgumentException('DRIVE_INVALID_FILE');
    foreach(['wrappedKey'=>40,'iv'=>12,'ciphertext'=>16*1024*1024+16]as$field=>$limit){
        if(!is_string($header[$field])||strlen($header[$field])>4*(int)ceil($limit/3))throw new InvalidArgumentException('DRIVE_INVALID_FILE');$decoded=base64_decode($header[$field],true);
        if($decoded===false||base64_encode($decoded)!==$header[$field]||strlen($decoded)>$limit||($field==='ciphertext'?strlen($decoded)<16:strlen($decoded)!==$limit))throw new InvalidArgumentException('DRIVE_INVALID_FILE');
        if($field==='ciphertext'&&(!is_string($header['sha256'])||!hash_equals(hash('sha256',$decoded),$header['sha256'])))throw new InvalidArgumentException('DRIVE_INVALID_FILE');
    }
}
function genesisDriveMetadata(string $owner,string $connection,string $fileId,bool $allowIncomplete=false): ?array
{
    $response=genesisDriveApi($owner,$connection,'/drive/v3/files/'.rawurlencode(genesisDriveFileId($fileId)).'?fields=id,size,spaces,appProperties,createdTime,trashed');
    if($response['status']===404)return null;$value=genesisDriveJson($response);
    $props=$value['appProperties']??null;
    if(($value['id']??null)!==$fileId||($value['trashed']??true)!==false||!in_array('appDataFolder',$value['spaces']??[],true)||!is_array($props)
        ||($props['owner']??null)!==hash('sha256','genesis-drive-owner-v1:'.$owner)||($props['format']??null)!=='genesisbackup-v1')throw new DomainException('DRIVE_FILE_CHANGED');
    genesisDriveUuid($props['operation']??null);genesisDriveUuid($props['backup']??null);
    if(!is_string($props['sha256']??null)||!preg_match('/\A[a-f0-9]{64}\z/D',$props['sha256'])||!is_string($props['bytes']??null)||!ctype_digit($props['bytes'])
        ||(int)$props['bytes']<1||(int)$props['bytes']>GENESIS_DRIVE_MAX_FILE||(!$allowIncomplete&&(string)($value['size']??'')!==$props['bytes']))throw new DomainException('DRIVE_FILE_CHANGED');
    return $value;
}
function genesisDriveReadFile(string $owner,string $connection,array $metadata): string
{
    genesisConsumeApiBudget($owner,'private-drive-readback',100,256*1024*1024,(int)$metadata['size']);
    $response=genesisDriveApi($owner,$connection,'/drive/v3/files/'.rawurlencode($metadata['id']).'?alt=media','GET',null,[],GENESIS_DRIVE_MAX_FILE);
    if($response['status']!==200)throw new GenesisResourceLimitException(502,'DRIVE_READBACK_FAILED');$file=$response['body'];$props=$metadata['appProperties'];
    if(strlen($file)!==(int)$props['bytes']||!hash_equals($props['sha256'],hash('sha256',$file)))throw new DomainException('DRIVE_READBACK_FAILED');
    genesisDriveValidateFile($file,$props['backup']);return $file;
}
function genesisDriveUploadPath(string $uri): string
{
    if(strlen($uri)>8192)throw new RuntimeException('DRIVE_INVALID_UPLOAD_SESSION');$parts=parse_url($uri);$query=[];parse_str($parts['query']??'',$query);
    if(($parts['scheme']??'')!=='https'||($parts['host']??'')!=='www.googleapis.com'||($parts['path']??'')!=='/upload/drive/v3/files'
        ||isset($parts['port'])||isset($parts['user'])||isset($parts['pass'])||isset($parts['fragment'])||($query['uploadType']??null)!=='resumable'
        ||!is_string($query['upload_id']??null)||strlen($query['upload_id'])<1)throw new RuntimeException('DRIVE_INVALID_UPLOAD_SESSION');
    return $parts['path'].'?'.$parts['query'];
}
/** Large archives use a durable provider session for this SAME immutable file
 * ID. The URI is a provider credential, encrypted separately from user content.
 * Interrupted requests ask Google for the accepted offset before sending more. */
function genesisDriveResumable(string $owner,string $connection,array $row,string $file,string $metadata): void
{
    $db=genesisDb();$read=static function()use($db,$owner,$row):?string{$q=$db->prepare('SELECT upload_uri_enc FROM private_drive_operations WHERE user_id=? AND operation_id=?');$q->execute([$owner,$row['operation_id']]);$value=$q->fetchColumn();$q->closeCursor();return is_string($value)?$value:null;};
    for($attempt=0;$attempt<2;$attempt++){
        $stored=$read();$uri=$stored===null?null:genesisDecrypt($stored);
        if($stored!==null&&(!is_string($uri)||$uri===''))throw new DomainException('DRIVE_UPLOAD_SESSION_UNVERIFIED');
        if($uri===null){
            $start=genesisDriveApi($owner,$connection,'/upload/drive/v3/files?uploadType=resumable&fields=id','POST',$metadata,['Content-Type: application/json; charset=UTF-8','X-Upload-Content-Type: application/octet-stream','X-Upload-Content-Length: '.strlen($file)]);
            if($start['status']===409)return;
            if(!in_array($start['status'],[200,201],true)||!is_string($start['headers']['location']??null))throw new GenesisResourceLimitException(502,'DRIVE_UPLOAD_UNCERTAIN');
            $proposed=$start['headers']['location'];genesisDriveUploadPath($proposed);genesisDriveBoundConnection($owner,$connection);
            $q=$db->prepare('UPDATE private_drive_operations SET upload_uri_enc=? WHERE user_id=? AND operation_id=? AND connection_id=? AND upload_uri_enc IS NULL AND EXISTS(SELECT 1 FROM private_drive_connections c WHERE c.user_id=? AND c.connection_id=? AND c.active=1)');
            $q->execute([genesisEncrypt($proposed),$owner,$row['operation_id'],$connection,$owner,$connection]);genesisDriveBoundConnection($owner,$connection);$stored=$read();$uri=$stored===null?null:genesisDecrypt($stored);if(!is_string($uri)||$uri==='')throw new DomainException('DRIVE_UPLOAD_SESSION_UNVERIFIED');
        }
        $path=genesisDriveUploadPath($uri);$total=strlen($file);
        $state=genesisDriveApi($owner,$connection,$path,'PUT','',['Content-Length: 0','Content-Range: bytes */'.$total]);
        if(in_array($state['status'],[200,201],true))return;
        if(in_array($state['status'],[404,410],true)){
            // A completed file may outlive its session. Never replace it.
            if(genesisDriveMetadata($owner,$connection,$row['file_id'])!==null)return;
            $db->prepare('UPDATE private_drive_operations SET upload_uri_enc=NULL WHERE user_id=? AND operation_id=? AND upload_uri_enc=?')->execute([$owner,$row['operation_id'],$stored]);continue;
        }
        if($state['status']!==308)throw new GenesisResourceLimitException(502,'DRIVE_UPLOAD_UNCERTAIN');
        $range=$state['headers']['range']??null;$offset=0;
        if($range!==null){if(!preg_match('/\Abytes=0-([0-9]{1,12})\z/D',$range,$match))throw new DomainException('DRIVE_UPLOAD_SESSION_UNVERIFIED');$offset=(int)$match[1]+1;}
        if($offset<0||$offset>=$total)throw new DomainException('DRIVE_UPLOAD_UNCERTAIN');
        $result=genesisDriveApi($owner,$connection,$path,'PUT',$offset===0?$file:substr($file,$offset),['Content-Type: application/octet-stream','Content-Range: bytes '.$offset.'-'.($total-1).'/'.$total]);
        if(!in_array($result['status'],[200,201,409],true))throw new GenesisResourceLimitException(502,'DRIVE_UPLOAD_UNCERTAIN');return;
    }
    throw new GenesisResourceLimitException(502,'DRIVE_UPLOAD_UNCERTAIN');
}
function genesisDriveCommit(string $owner,array $input): array
{
    genesisE2eeExactFields($input,['connectionId','operationId','backupId','sha256','bytes','file']);$file=$input['file'];unset($input['file']);
    if(!is_string($file)||strlen($file)!==$input['bytes']||hash('sha256',$file)!==$input['sha256'])throw new InvalidArgumentException('DRIVE_INVALID_FILE');
    genesisDriveValidateFile($file,genesisDriveUuid($input['backupId']));$row=genesisDriveOperation($owner,$input);$id=$input['connectionId'];
    $meta=genesisDriveMetadata($owner,$id,$row['file_id'],$row['upload_uri_enc']!==null);
    if($meta&&(string)($meta['size']??'')!==(string)$row['file_bytes']){
        if($row['upload_uri_enc']===null||count($meta['appProperties'])!==count(genesisDriveProperties($owner,$row))||array_diff_assoc($meta['appProperties'],genesisDriveProperties($owner,$row)))throw new DomainException('DRIVE_FILE_CHANGED');$meta=null;
    }
    if(!$meta){
        // One immutable create with a preallocated, durably stored ID. A lost
        // reply retries only this ID; it never overwrites or creates a new file.
        $metadata=json_encode(['id'=>$row['file_id'],'name'=>'genesis-'.$row['backup_id'].'.genesisbackup','mimeType'=>'application/octet-stream','parents'=>['appDataFolder'],'appProperties'=>genesisDriveProperties($owner,$row)],JSON_THROW_ON_ERROR|JSON_UNESCAPED_SLASHES);
        if(strlen($file)>5*1024*1024)genesisDriveResumable($owner,$id,$row,$file,$metadata);
        else{
            $boundary='genesis_'.bin2hex(random_bytes(24));$body='--'.$boundary."\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n".$metadata."\r\n--".$boundary."\r\nContent-Type: application/octet-stream\r\n\r\n".$file."\r\n--".$boundary."--\r\n";
            $response=genesisDriveApi($owner,$id,'/upload/drive/v3/files?uploadType=multipart&fields=id','POST',$body,['Content-Type: multipart/related; boundary='.$boundary]);
            if(!in_array($response['status'],[200,201,409],true))throw new GenesisResourceLimitException(502,'DRIVE_UPLOAD_UNCERTAIN');
        }
        $meta=genesisDriveMetadata($owner,$id,$row['file_id']);
    }
    if(!$meta||$meta['appProperties']!==genesisDriveProperties($owner,$row)){
        // Object key order is not a provider guarantee.
        if(!$meta||count($meta['appProperties'])!==count(genesisDriveProperties($owner,$row))||array_diff_assoc($meta['appProperties'],genesisDriveProperties($owner,$row)))throw new DomainException('DRIVE_FILE_CHANGED');
    }
    $readback=genesisDriveReadFile($owner,$id,$meta);if(!hash_equals($file,$readback))throw new DomainException('DRIVE_READBACK_FAILED');
    genesisDriveBoundConnection($owner,$id);genesisDb()->prepare('UPDATE private_drive_operations SET verified_at=?,upload_uri_enc=NULL WHERE user_id=? AND operation_id=? AND connection_id=?')->execute([genesisNow(),$owner,$row['operation_id'],$id]);
    return ['operationId'=>$row['operation_id'],'fileId'=>$row['file_id'],'sha256'=>$row['file_hash'],'bytes'=>(int)$row['file_bytes'],'verified'=>true];
}
function genesisDriveList(string $owner,string $id,?string $pageToken): array
{
    genesisDriveBoundConnection($owner,$id);if($pageToken!==null&&(!preg_match('/\A[A-Za-z0-9_+=\/-]{1,2048}\z/D',$pageToken)))throw new InvalidArgumentException('DRIVE_INVALID');
    $query=['spaces'=>'appDataFolder','q'=>"trashed = false and appProperties has { key='format' and value='genesisbackup-v1' } and appProperties has { key='owner' and value='".hash('sha256','genesis-drive-owner-v1:'.$owner)."' }",'pageSize'=>100,'fields'=>'nextPageToken,files(id,size,spaces,appProperties,createdTime,trashed)','orderBy'=>'createdTime desc'];if($pageToken!==null)$query['pageToken']=$pageToken;
    $result=genesisDriveJson(genesisDriveApi($owner,$id,'/drive/v3/files?'.http_build_query($query,'','&',PHP_QUERY_RFC3986),limit:524288));$files=$result['files']??[];
    if(!is_array($files)||count($files)>100)throw new RuntimeException('DRIVE_INVALID_RESPONSE');
    $rows=[];$seen=[];foreach($files as$file){$props=$file['appProperties']??[];$fileId=genesisDriveFileId($file['id']??null);
        if(isset($seen[$fileId])||!in_array('appDataFolder',$file['spaces']??[],true)||($file['trashed']??true)!==false||($props['owner']??null)!==hash('sha256','genesis-drive-owner-v1:'.$owner)
            ||($props['format']??null)!=='genesisbackup-v1'||!is_string($props['sha256']??null)||!preg_match('/\A[a-f0-9]{64}\z/D',$props['sha256'])
            ||!is_string($props['bytes']??null)||!ctype_digit($props['bytes'])||(int)$props['bytes']<1||(int)$props['bytes']>GENESIS_DRIVE_MAX_FILE||(string)($file['size']??'')!==$props['bytes']
            ||!is_string($file['createdTime']??null)||strlen($file['createdTime'])>64||strtotime($file['createdTime'])===false)throw new DomainException('DRIVE_FILE_CHANGED');
        $seen[$fileId]=true;genesisDriveUuid($props['operation']??null);$rows[]=['fileId'=>$fileId,'backupId'=>genesisDriveUuid($props['backup']??null),'sha256'=>$props['sha256'],'bytes'=>(int)$file['size'],'createdAt'=>$file['createdTime']];}
    $next=$result['nextPageToken']??null;if($next!==null&&(!is_string($next)||strlen($next)>2048))throw new RuntimeException('DRIVE_INVALID_RESPONSE');return ['files'=>$rows,'nextPageToken'=>$next];
}
function genesisDriveRoute(string $method,string $path): never
{
    $owner=genesisRequireUserId();if(($_SERVER['HTTP_X_GENESIS_ACCOUNT_ID']??null)!==$owner)throw new DomainException('E2EE_ACCOUNT_CHANGED');
    header('Cache-Control: no-store');genesisConsumeApiBudget($owner,'private-drive',60,128*1024*1024,(int)($_SERVER['CONTENT_LENGTH']??0));
    if($method==='GET'&&$path==='private-drive/v1/status')genesisJson(genesisDriveStatus($owner));
    if($method!=='POST')genesisJson(['error'=>'METHOD_NOT_ALLOWED'],405);genesisRequireCsrf();$body=genesisReadJson();
    // Disconnect remains available after rollout is disabled. It drops only the
    // separate credentials; Google's combined app grant and files stay intact.
    if($path==='private-drive/v1/disconnect'){
        genesisE2eeExactFields($body,['connectionId']);$id=genesisDriveUuid($body['connectionId']);
        genesisDb()->prepare('UPDATE private_drive_operations SET upload_uri_enc=NULL WHERE user_id=? AND connection_id=?')->execute([$owner,$id]);
        genesisDb()->prepare('UPDATE private_drive_connections SET active=0,connection_id=?,access_token_enc=NULL,refresh_token_enc=NULL,expires_at=0 WHERE user_id=? AND connection_id=?')->execute([genesisUuid(),$owner,$id]);unset($_SESSION['drive_oauth_request']);genesisJson(genesisDriveStatus($owner));
    }
    genesisDriveRequireEnabled();genesisBackupRequirePaid($owner);
    if($path==='private-drive/v1/connect')genesisJson(genesisDriveBegin($owner,$body,true));
    if($path==='private-drive/v1/web-connect')genesisJson(genesisDriveBegin($owner,$body,false));
    if($path==='private-drive/v1/authorize'){
        genesisE2eeExactFields($body,['attemptId','serverAuthCode']);$pending=$_SESSION['drive_oauth_request']??null;
        if(!is_array($pending)||!$pending['native']||($pending['attemptId']??null)!==genesisDriveUuid($body['attemptId'])||!is_string($body['serverAuthCode'])||strlen($body['serverAuthCode'])<1||strlen($body['serverAuthCode'])>8192)throw new DomainException('DRIVE_AUTH_STALE');
        $tokens=genesisDriveTokenRequest(['code'=>$body['serverAuthCode'],'client_id'=>(string)genesisConfig()['google_client_id'],'client_secret'=>(string)genesisConfig()['google_client_secret'],'redirect_uri'=>'','grant_type'=>'authorization_code']);genesisJson(genesisDriveAuthorize($owner,$pending,$tokens));
    }
    if($path==='private-drive/v1/prepare'){$row=genesisDriveOperation($owner,$body);genesisJson(['fileId'=>$row['file_id'],'operationId'=>$row['operation_id']]);}
    if($path==='private-drive/v1/commit')genesisJson(genesisDriveCommit($owner,$body));
    if($path==='private-drive/v1/list'){
        genesisE2eeExactFields($body,['connectionId','pageToken']);if($body['pageToken']!==null&&!is_string($body['pageToken']))throw new InvalidArgumentException('DRIVE_INVALID');genesisJson(genesisDriveList($owner,genesisDriveUuid($body['connectionId']),$body['pageToken']));
    }
    if($path==='private-drive/v1/download'){
        genesisE2eeExactFields($body,['connectionId','fileId']);$id=genesisDriveUuid($body['connectionId']);$meta=genesisDriveMetadata($owner,$id,genesisDriveFileId($body['fileId']));if(!$meta)throw new DomainException('DRIVE_FILE_MISSING');
        genesisJson(['fileId'=>$meta['id'],'sha256'=>$meta['appProperties']['sha256'],'bytes'=>(int)$meta['size'],'file'=>genesisDriveReadFile($owner,$id,$meta)]);
    }
    genesisJson(['error'=>'NOT_FOUND'],404);
}
