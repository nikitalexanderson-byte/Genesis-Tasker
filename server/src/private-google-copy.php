<?php
declare(strict_types=1);

/** Explicit external copies are readable by GENESIS/Google. This service has
 * no vault/table decrypt, private-content lookup, background sync or key API.
 * Its input is the exact content the unlocked client displayed for consent. */
function genesisPrivateGoogleCopyInput(array $input):array
{
    genesisE2eeExactFields($input,['operationId','provider','accountId','copy','consentVersion']);
    if($input['consentVersion']!=='external-copy-336-v1'||!in_array($input['provider'],['google-tasks','google-calendar'],true))throw new DomainException('E2EE_EXTERNAL_COPY_CONSENT_REQUIRED');
    $id=genesisE2eeIdentifier($input['operationId']);if(preg_match('/\A[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\z/D',$id)!==1)throw new InvalidArgumentException('E2EE_EXTERNAL_COPY_INVALID');genesisE2eeIdentifier($input['accountId']);
    $copy=genesisE2eeExactFields($input['copy'],['title','description','dueDate','startDate','startTime','endTime','timeZone','completedAt']);
    foreach(['title'=>2000,'description'=>100000]as$field=>$limit)if(!is_string($copy[$field])||mb_strlen($copy[$field])>$limit||$field==='title'&&trim($copy[$field])==='')throw new InvalidArgumentException('E2EE_EXTERNAL_COPY_INVALID');
    foreach(['dueDate','startDate']as$field)if($copy[$field]!==null&&(!is_string($copy[$field])||!preg_match('/\A\d{4}-\d{2}-\d{2}\z/D',$copy[$field])||!checkdate((int)substr($copy[$field],5,2),(int)substr($copy[$field],8,2),(int)substr($copy[$field],0,4))))throw new InvalidArgumentException('E2EE_EXTERNAL_COPY_INVALID');
    foreach(['startTime','endTime']as$field)if($copy[$field]!==null&&(!is_string($copy[$field])||!preg_match('/\A(?:[01]\d|2[0-3]):[0-5]\d\z/D',$copy[$field])))throw new InvalidArgumentException('E2EE_EXTERNAL_COPY_INVALID');
    if(!is_string($copy['timeZone'])||!in_array($copy['timeZone'],DateTimeZone::listIdentifiers(DateTimeZone::ALL_WITH_BC),true))throw new InvalidArgumentException('E2EE_EXTERNAL_COPY_INVALID');
    if($copy['completedAt']!==null&&(!is_string($copy['completedAt'])||strlen($copy['completedAt'])>64||strtotime($copy['completedAt'])===false))throw new InvalidArgumentException('E2EE_EXTERNAL_COPY_INVALID');
    if($input['provider']==='google-calendar'&&$copy['dueDate']===null)throw new InvalidArgumentException('E2EE_EXTERNAL_COPY_DATE_REQUIRED');
    return $input;
}
function genesisPrivateGoogleCopyApi(string $owner,string $accountId,string $provider,string $method,string $path,?array $payload=null):array
{
    $account=genesisGoogleAccountForUser($owner,$accountId);if($account===null)throw new DomainException('E2EE_ACCOUNT_CHANGED');
    $calendar=$provider==='google-calendar';$scope=$calendar?GENESIS_GOOGLE_CALENDAR_SCOPE:GENESIS_GOOGLE_TASKS_SCOPE;
    if(!genesisGoogleScopeGranted($account,$scope))throw new DomainException('E2EE_EXTERNAL_COPY_GOOGLE_PERMISSION');
    if($calendar){if(!preg_match('~\A/calendars/primary/events(?:/[a-f0-9]{64})?\z~D',$path)||!in_array($method,['GET','POST'],true))throw new LogicException('E2EE_EXTERNAL_COPY_INVALID');}
    elseif(!preg_match('~\A/lists/@default/tasks(?:\?maxResults=100&showCompleted=true&showHidden=true&fields=items%28id%2Cnotes%29%2CnextPageToken(?:&pageToken=[A-Za-z0-9%_.~-]+)?)?\z~D',$path)||!in_array($method,['GET','POST'],true))throw new LogicException('E2EE_EXTERNAL_COPY_INVALID');
    $kind=$calendar?'calendar':'tasks';genesisGoogleQuotaCheck($kind);
    $url=($calendar?'https://www.googleapis.com/calendar/v3':'https://tasks.googleapis.com/tasks/v1').$path.(str_contains($path,'?')?'&':'?').'quotaUser='.substr(genesisGoogleCacheKey($account),0,40);
    $options=[CURLOPT_CUSTOMREQUEST=>$method,CURLOPT_HTTPHEADER=>['Authorization: Bearer '.genesisGoogleStoredAccessToken($account),'Accept: application/json']];
    if($payload!==null){$options[CURLOPT_HTTPHEADER][]='Content-Type: application/json';$options[CURLOPT_POSTFIELDS]=json_encode($payload,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);}
    try{return genesisCurl($url,$options);}catch(GenesisGoogleHttpException $error){
        // A definite 401 did not create a copy. Never retry an ambiguous POST.
        if($error->status===401){$options[CURLOPT_HTTPHEADER][0]='Authorization: Bearer '.genesisGoogleStoredAccessToken($account,true);try{return genesisCurl($url,$options);}catch(GenesisGoogleHttpException $retry){$error=$retry;}}
        genesisGoogleRecordQuotaError($kind,$error);throw $error;
    }
}
function genesisPrivateGoogleCopyPayload(array $input):array
{
    $copy=$input['copy'];$marker='GENESIS external copy '.$input['operationId'];
    if($input['provider']==='google-tasks')return ['title'=>$copy['title'],'notes'=>$copy['description']."\n\n".implode("\n",array_map(static fn(string $key):string=>$key.': '.($copy[$key]??''),['startDate','dueDate','startTime','endTime','timeZone']))."\n".$marker,'status'=>$copy['completedAt']===null?'needsAction':'completed',
        ...($copy['dueDate']!==null?['due'=>$copy['dueDate'].'T00:00:00.000Z']:[]),...($copy['completedAt']!==null?['completed'=>$copy['completedAt']]:[])];
    $zone=new DateTimeZone($copy['timeZone']);$day=new DateTimeImmutable($copy['dueDate'].' 12:00:00',$zone);
    if($copy['startDate']!==null&&$copy['startDate']>$copy['dueDate'])throw new InvalidArgumentException('E2EE_EXTERNAL_COPY_INVALID');
    $result=['id'=>hash('sha256','genesis-external-copy-v1:'.$input['operationId']),'summary'=>$copy['title'],'description'=>$copy['description'],
        'start'=>['date'=>$copy['startDate']??$copy['dueDate']],'end'=>['date'=>$day->modify('+1 day')->format('Y-m-d')],
        'extendedProperties'=>['private'=>['genesisExternalCopyId'=>$input['operationId']]],'reminders'=>['useDefault'=>false]];
    if($copy['startTime']!==null||$copy['endTime']!==null){
        if($copy['startTime']===null||$copy['endTime']===null)throw new InvalidArgumentException('E2EE_EXTERNAL_COPY_INVALID');$startDay=$copy['startDate']??$copy['dueDate'];
        $start=new DateTimeImmutable($startDay.' '.$copy['startTime'],$zone);$end=new DateTimeImmutable($copy['dueDate'].' '.$copy['endTime'],$zone);
        if($end<=$start||$start->format('Y-m-d H:i')!==$startDay.' '.$copy['startTime']||$end->format('Y-m-d H:i')!==$copy['dueDate'].' '.$copy['endTime'])throw new InvalidArgumentException('E2EE_EXTERNAL_COPY_INVALID');
        $result['start']=['dateTime'=>$start->format(DateTimeInterface::RFC3339),'timeZone'=>$copy['timeZone']];$result['end']=['dateTime'=>$end->format(DateTimeInterface::RFC3339),'timeZone'=>$copy['timeZone']];
    }return $result;
}
function genesisPrivateGoogleCopy(string $owner,array $raw):array
{
    $input=genesisPrivateGoogleCopyInput($raw);$personal=genesisE2eeUserState($owner);if(!$personal||$personal['state']!=='active')throw new DomainException('E2EE_NOT_ACTIVE');
    $payload=genesisPrivateGoogleCopyPayload($input);$account=genesisGoogleAccountForUser($owner,$input['accountId']);if(!$account)throw new DomainException('E2EE_ACCOUNT_CHANGED');
    $required=$input['provider']==='google-calendar'?GENESIS_GOOGLE_CALENDAR_SCOPE:GENESIS_GOOGLE_TASKS_SCOPE;if(!genesisGoogleScopeGranted($account,$required))throw new DomainException('E2EE_EXTERNAL_COPY_GOOGLE_PERMISSION');
    $hash=hash('sha256',genesisE2eeCanonical($input));$db=genesisDb();genesisBeginWriteTransaction($db);$first=false;
    try{$q=$db->prepare('SELECT * FROM private_external_copies WHERE user_id=? AND operation_id=?');$q->execute([$owner,$input['operationId']]);$saved=$q->fetch();$q->closeCursor();
        if(!$saved){$count=$db->prepare('SELECT COUNT(*) FROM private_external_copies WHERE user_id=?');$count->execute([$owner]);if((int)$count->fetchColumn()>=10000)throw new GenesisResourceLimitException(413,'E2EE_EXTERNAL_COPY_LIMIT');$count->closeCursor();
            $now=genesisNow();$db->prepare('INSERT INTO private_external_copies VALUES(?,?,?,?,?,?,?,?,?)')->execute([$owner,$input['operationId'],$input['provider'],$input['accountId'],$hash,'attempted',null,$now,$now]);$first=true;
        }elseif(!hash_equals($saved['payload_hash'],$hash))throw new DomainException('E2EE_IDEMPOTENCY_CONFLICT');
        $db->commit();
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
    if($saved&&$saved['state']==='complete')return ['operationId'=>$input['operationId'],'provider'=>$input['provider'],'state'=>'complete','externalId'=>$saved['external_id']];
    $external=null;
    try{
        if($input['provider']==='google-calendar'){
            // Google accepts a caller-chosen event ID. Unknown HTTP outcomes
            // repeat only that same ID, and an existing foreign event refuses.
            try{$existing=genesisPrivateGoogleCopyApi($owner,$input['accountId'],$input['provider'],'GET','/calendars/primary/events/'.$payload['id']);
                if(($existing['extendedProperties']['private']['genesisExternalCopyId']??null)!==$input['operationId'])throw new DomainException('E2EE_EXTERNAL_COPY_CHANGED');$external=$payload['id'];
            }catch(GenesisGoogleHttpException $error){if($error->status!==404)throw $error;try{$created=genesisPrivateGoogleCopyApi($owner,$input['accountId'],$input['provider'],'POST','/calendars/primary/events',$payload);$external=$created['id']??null;}catch(GenesisGoogleHttpException $insertError){if($insertError->status!==409)throw $insertError;}}
        }elseif($first){$created=genesisPrivateGoogleCopyApi($owner,$input['accountId'],$input['provider'],'POST','/lists/@default/tasks',$payload);$external=$created['id']??null;}
        else{
            // Tasks has no caller-chosen idempotency key. After an attempted
            // POST we only reconcile; absence is UNCERTAIN, never permission to
            // blindly create again after a network failure or process death.
            $token=null;$seen=[];for($page=0;$page<100;$page++){$path='/lists/@default/tasks?maxResults=100&showCompleted=true&showHidden=true&fields=items%28id%2Cnotes%29%2CnextPageToken'.($token!==null?'&pageToken='.rawurlencode($token):'');
                $result=genesisPrivateGoogleCopyApi($owner,$input['accountId'],$input['provider'],'GET',$path);foreach($result['items']??[]as$item)if(str_ends_with((string)($item['notes']??''),'GENESIS external copy '.$input['operationId'])){if($external!==null)throw new DomainException('E2EE_EXTERNAL_COPY_AMBIGUOUS');$external=$item['id']??null;}
                $token=$result['nextPageToken']??null;if($token===null)break;if(!is_string($token)||strlen($token)>2048||isset($seen[$token]))throw new DomainException('E2EE_EXTERNAL_COPY_UNCERTAIN');$seen[$token]=true;if($page===99)throw new DomainException('E2EE_EXTERNAL_COPY_UNCERTAIN');}
        }
    }catch(DomainException $error){throw $error;}catch(Throwable){return ['operationId'=>$input['operationId'],'provider'=>$input['provider'],'state'=>'uncertain','externalId'=>null];}
    if(!is_string($external)||$external===''||strlen($external)>2048)return ['operationId'=>$input['operationId'],'provider'=>$input['provider'],'state'=>'uncertain','externalId'=>null];
    $db->prepare('UPDATE private_external_copies SET state=?,external_id=?,updated_at=? WHERE user_id=? AND operation_id=? AND payload_hash=?')->execute(['complete',$external,genesisNow(),$owner,$input['operationId'],$hash]);
    return ['operationId'=>$input['operationId'],'provider'=>$input['provider'],'state'=>'complete','externalId'=>$external];
}
