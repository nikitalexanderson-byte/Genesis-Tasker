<?php
declare(strict_types=1);

function genesisE2eeStoicheionOwner(string $actor,array $scope): array
{
    if($scope['kind']!=='personal'||$scope['owner_id']!==$actor||$scope['resource_id']!==$actor||$scope['state']!=='active')throw new GenesisResourceLimitException(403,'E2EE_SCOPE_FORBIDDEN');
    $user=genesisFindUser($actor);if(!$user)throw new DomainException('E2EE_SCOPE_FORBIDDEN');return$user;
}
function genesisE2eeStoicheionPeriod(string $kind,array $user): string
{
    return $kind==='timeline'?genesisTimelinePeriod()[0]:genesisStoicheionPeriodStart(genesisClientDayKey(),$kind,genesisForecastTestingOwner($user));
}
/** Legacy rows supply existing technical limits only. Never copy or return a
 * server-known seed/cards, and never mutate the fenced legacy tables. */
function genesisE2eeStoicheionHead(PDO $db,string $actor,array $scope,string $kind,array $user): ?array
{
    $period=genesisE2eeStoicheionPeriod($kind,$user);$stored=genesisE2eeRow($db,'SELECT state_json FROM e2ee_stoicheion_heads WHERE scope_id=? AND kind=? AND period_key=?',[$scope['scope_id'],$kind,$period]);
    if($stored)return json_decode($stored['state_json'],true,32,JSON_THROW_ON_ERROR);
    if($kind==='timeline'){
        $legacy=genesisE2eeRow($db,'SELECT * FROM stoicheion_timeline_sessions WHERE user_id=? AND period_key=?',[$actor,$period]);
        if($legacy){$windows=[];$q=$db->prepare('SELECT position,first_revealed_at,rerolled_at FROM stoicheion_timeline_card_windows WHERE user_id=? AND period_key=? ORDER BY position');$q->execute([$actor,$period]);
            foreach($q->fetchAll() as $row)$windows[]=['position'=>(int)$row['position'],'firstRevealedAt'=>$row['first_revealed_at'],'rerolled'=>$row['rerolled_at']!==null];$q->closeCursor();
            return ['kind'=>$kind,'dayKey'=>$legacy['source_day_key'],'periodKey'=>$period,'revision'=>max(1,(int)$legacy['revision']),'firstDrawAt'=>$legacy['created_at'],'windows'=>$windows,'reference'=>null,'legacy'=>true];}
    }
    $table=$kind==='timeline'?'stoicheion_timeline_draws':'stoicheion_draws';$legacy=genesisE2eeRow($db,"SELECT day_key,attempt_count,first_draw_at FROM $table WHERE user_id=? AND draw_kind=? AND day_key>=? AND day_key<=? ORDER BY day_key DESC LIMIT 1",[$actor,$kind,$period,genesisClientDayKey()]);
    if(!$legacy)return null;
    $head=['kind'=>$kind,'dayKey'=>$legacy['day_key'],'periodKey'=>$period,'revision'=>1,'firstDrawAt'=>$legacy['first_draw_at'],'reference'=>null,'legacy'=>true];
    if($kind==='timeline'){$head['windows']=[];foreach([0,1,2] as $position)$head['windows'][]=['position'=>$position,'firstRevealedAt'=>$legacy['first_draw_at'],'rerolled'=>(int)$legacy['attempt_count']>=2];}
    else{$head['attempts']=(int)$legacy['attempt_count'];$head['cardRevision']=0;
        if($kind==='spread'){$cards=genesisE2eeRow($db,'SELECT revision FROM stoicheion_spread_cards WHERE user_id=? AND day_key=?',[$actor,$legacy['day_key']]);$head['cardRevision']=$cards?(int)$cards['revision']:0;}}
    return$head;
}
function genesisE2eeStoicheionDisplay(?array $head,bool $unlimited): ?array
{
    if(!$head)return null;$first=strtotime($head['firstDrawAt']);$deadline=$first===false?0:$first+180;
    if($head['kind']==='timeline'){
        $head['cards']=array_map(static function(array $row)use($unlimited):array{$first=strtotime($row['firstRevealedAt']);$deadline=$first===false?0:$first+180;$remaining=$row['rerolled']?0:max(0,$deadline-time());
            return $row+['rerollDeadline'=>gmdate('Y-m-d\TH:i:s\Z',$deadline),'remainingSeconds'=>$remaining,'canReroll'=>$unlimited||$remaining>0,'unlimited'=>$unlimited];},$head['windows']);unset($head['windows']);
    }else{$head['rerollDeadline']=gmdate('Y-m-d\TH:i:s\Z',$deadline);$head['remainingSeconds']=max(0,$deadline-time());$head['unlimited']=$unlimited;
        $head['canReroll']=$unlimited||$head['kind']==='daily'&&$head['attempts']===1&&$head['remainingSeconds']>0;}
    return$head;
}
function genesisE2eeStoicheionState(PDO $db,string $actor,array $scope): array
{
    $user=genesisE2eeStoicheionOwner($actor,$scope);$unlimited=genesisForecastUnlimitedDraws($user);$draws=[];
    foreach(['daily','spread'] as $kind)if($row=genesisE2eeStoicheionHead($db,$actor,$scope,$kind,$user))$draws[$kind]=genesisE2eeStoicheionDisplay($row,$unlimited);
    return ['dayKey'=>genesisClientDayKey(),'serverNow'=>genesisNow(),'draws'=>$draws?:new stdClass(),'timeline'=>genesisE2eeStoicheionDisplay(genesisE2eeStoicheionHead($db,$actor,$scope,'timeline',$user),$unlimited),
        'testingAccess'=>genesisForecastTestingOwner($user),'unlimitedDraws'=>$unlimited,'periods'=>['daily'=>genesisE2eeStoicheionPeriod('daily',$user),'spread'=>genesisE2eeStoicheionPeriod('spread',$user),'timeline'=>genesisE2eeStoicheionPeriod('timeline',$user)],
        'checkpointHash'=>$scope['checkpoint_hash'],'directoryRevision'=>(int)$scope['directory_revision']];
}
/** Uploading is not a draw. This single signed business commit checks billing,
 * deadlines and CAS independently, then activates that exact ciphertext. */
function genesisE2eeStoicheionGrant(PDO $db,string $actor,array $scope,array $payload): array
{
    genesisE2eeExactFields($payload,['intentId','kind','action','position','expectedRevision','periodKey','objectId','payloadHash']);$user=genesisE2eeStoicheionOwner($actor,$scope);
    $id=genesisE2eeIdentifier($payload['intentId']);$hash=rtrim(strtr(base64_encode(hash('sha256',genesisE2eeCanonical($payload),true)),'+/','-_'),'=');
    $old=genesisE2eeRow($db,"SELECT payload_hash,result_json FROM e2ee_service_intents WHERE scope_id=? AND actor_id=? AND action='stoicheion-grant' AND intent_id=?",[$scope['scope_id'],$actor,$id]);
    if($old){if($old['payload_hash']!==$hash)throw new DomainException('E2EE_IDEMPOTENCY_CONFLICT');return json_decode($old['result_json'],true,32,JSON_THROW_ON_ERROR);}
    $kind=$payload['kind'];$action=$payload['action'];if(!in_array($kind,['daily','spread','timeline'],true)||!in_array($action,['draw','spread-card','reveal','reroll'],true))throw new InvalidArgumentException('E2EE_STOICHEION_REQUEST_INVALID');
    if(!empty($user['stoicheion_divination_disabled']))throw new DomainException('E2EE_STOICHEION_DISABLED');
    genesisRequireFeature($actor,match($kind){'daily'=>'stoicheion','spread'=>'stoicheion-spread','timeline'=>'stoicheion-timeline'});
    $period=genesisE2eeStoicheionPeriod($kind,$user);if($payload['periodKey']!==$period)throw new DomainException('E2EE_STOICHEION_STALE');
    $head=genesisE2eeStoicheionHead($db,$actor,$scope,$kind,$user);$revision=$head['revision']??0;
    if(genesisE2eeInteger($payload['expectedRevision'])!==$revision)throw new DomainException('E2EE_STOICHEION_STALE');
    if($payload['objectId']!=='stoicheion-live:'.$id)throw new DomainException('E2EE_OBJECT_REFERENCE_MISMATCH');genesisE2eeDecode($payload['payloadHash'],32);
    $object=genesisE2eeRow($db,"SELECT revision,payload_hash FROM e2ee_objects WHERE scope_id=? AND generation=? AND domain='stoicheion' AND object_id=?",[$scope['scope_id'],$scope['generation'],$payload['objectId']]);
    if(!$object||(int)$object['revision']!==1||$object['payload_hash']!==$payload['payloadHash'])throw new DomainException('E2EE_OBJECT_REFERENCE_MISMATCH');
    $now=genesisNow();$unlimited=genesisForecastUnlimitedDraws($user);
    if($kind==='timeline'){
        if(!in_array($action,['reveal','reroll'],true)||!is_int($payload['position'])||$payload['position']<0||$payload['position']>2)throw new InvalidArgumentException('E2EE_STOICHEION_REQUEST_INVALID');
        $head??=['kind'=>$kind,'dayKey'=>genesisTimelinePeriod()[1],'periodKey'=>$period,'revision'=>0,'firstDrawAt'=>$now,'windows'=>[]];$position=$payload['position'];
        if($action==='reveal'){if($position!==count($head['windows']))throw new DomainException('E2EE_STOICHEION_ORDER');$head['windows'][]=['position'=>$position,'firstRevealedAt'=>$now,'rerolled'=>false];}
        else{$window=$head['windows'][$position]??null;$first=$window?strtotime($window['firstRevealedAt']):false;
            if(!$window)throw new DomainException('E2EE_STOICHEION_ORDER');if(!$unlimited&&($window['rerolled']||$first===false||time()>=$first+180))throw new DomainException('E2EE_STOICHEION_REROLL_EXPIRED');$head['windows'][$position]['rerolled']=true;}
    }else{
        if($action==='spread-card'){if($kind!=='spread'||!$head||!$unlimited||!is_int($payload['position'])||$payload['position']<0||$payload['position']>8)throw new DomainException('E2EE_STOICHEION_ELITE_REQUIRED');$head['cardRevision']++;}
        elseif($action==='draw'&&$payload['position']===null){
            if($head&&!$unlimited){$first=strtotime($head['firstDrawAt']);if($kind==='spread'||$head['attempts']!==1||$first===false||time()>=$first+180)throw new DomainException('E2EE_STOICHEION_REROLL_EXPIRED');$head['attempts']=2;}
            else{$head=['kind'=>$kind,'dayKey'=>$head['dayKey']??genesisClientDayKey(),'periodKey'=>$period,'revision'=>$revision,'firstDrawAt'=>$now,'attempts'=>1,'cardRevision'=>$kind==='spread'?($head['cardRevision']??0)+1:0];}
        }else throw new InvalidArgumentException('E2EE_STOICHEION_REQUEST_INVALID');
    }
    $head['revision']=$revision+1;$head['legacy']=false;$head['reference']=['objectId'=>$payload['objectId'],'payloadHash'=>$payload['payloadHash']];
    $db->prepare('INSERT INTO e2ee_stoicheion_heads VALUES(?,?,?,?) ON CONFLICT(scope_id,kind,period_key) DO UPDATE SET state_json=excluded.state_json')->execute([$scope['scope_id'],$kind,$period,genesisE2eeJson($head)]);
    $result=['intentId'=>$id,'kind'=>$kind,'head'=>genesisE2eeStoicheionDisplay($head,$unlimited),'serverNow'=>$now];
    $db->prepare("INSERT INTO e2ee_service_intents VALUES(?,?,'stoicheion-grant',?,?,?)")->execute([$scope['scope_id'],$actor,$id,$hash,genesisE2eeJson($result)]);return$result;
}
