<?php
declare(strict_types=1);

const GENESIS_SPREAD_CARD_IDS=['alpha','beta','gamma','delta','epsilon','zeta','eta','theta','iota','kappa','lambda','mu','nu','xi','omicron','pi','rho','sigma','tau','upsilon','phi','chi','psi','omega'];

function genesisSpreadBaseCards(int $seed): array
{
    return array_map(static fn(array $card):array=>['cardId'=>GENESIS_SPREAD_CARD_IDS[$card['letter']],'reversed'=>$card['reversed']],genesisTimelineCards($seed,9));
}

/** This is the exact current nine-card draw, not a newly generated modeling spread. */
function genesisSpreadDrawForClient(array $row,bool $unlimited=false): array
{
    $draw=genesisStoicheionDrawForClient($row,$unlimited);
    if($row['draw_kind']!=='spread')return $draw;
    if(!$unlimited){$draw['canReroll']=false;$draw['remainingSeconds']=0;}
    $q=genesisDb()->prepare('SELECT * FROM stoicheion_spread_cards WHERE user_id=? AND day_key=? AND source_seed=?');
    $q->execute([$row['user_id'],$row['day_key'],$row['seed_value']]);$state=$q->fetch();
    $cards=$state?json_decode($state['cards_json'],true,16,JSON_THROW_ON_ERROR):[];
    return [...$draw,'cardRevision'=>$state?(int)$state['revision']:0,'cards'=>$cards?:genesisSpreadBaseCards((int)$row['seed_value'])];
}

function genesisSpreadResetCards(array $row,string $now): void
{
    if($row['draw_kind']!=='spread')return;
    genesisDb()->prepare('INSERT INTO stoicheion_spread_cards VALUES(?,?,?,1,?,?) ON CONFLICT(user_id,day_key)
        DO UPDATE SET source_seed=excluded.source_seed,revision=stoicheion_spread_cards.revision+1,cards_json=excluded.cards_json,updated_at=excluded.updated_at')
        ->execute([$row['user_id'],$row['day_key'],$row['seed_value'],'[]',$now]);
}

/** An Elite+ card replacement is server-owned and serialized with whole-draw changes. */
function genesisChangeSpreadCard(string $userId,array $input): array
{
    if(array_diff(array_keys($input),['position','revision','seed','dayKey'])
        ||!is_int($input['position']??null)||$input['position']<0||$input['position']>8
        ||!is_int($input['revision']??null)||$input['revision']<0
        ||!is_int($input['seed']??null)||!is_string($input['dayKey']??null))throw new InvalidArgumentException('SPREAD_CARD_REQUEST_INVALID');
    $db=genesisDb();$db->exec('BEGIN IMMEDIATE');
    try{
        $user=genesisFindUser($userId);
        if(!$user||!genesisForecastUnlimitedDraws($user))throw new GenesisResourceLimitException(403,'SPREAD_CARD_ELITE_PLUS_REQUIRED');
        if(!empty($user['stoicheion_divination_disabled']))throw new DomainException('SPREAD_DISABLED');
        $day=genesisClientDayKey();$q=$db->prepare("SELECT * FROM stoicheion_draws WHERE user_id=? AND draw_kind='spread' AND day_key>=? AND day_key<=? ORDER BY day_key DESC LIMIT 1");
        $q->execute([$userId,genesisStoicheionPeriodStart($day,'spread',genesisForecastTestingOwner($user)),$day]);$row=$q->fetch();$q->closeCursor();
        if(!$row)throw new DomainException('SPREAD_DRAW_REQUIRED');
        $current=genesisSpreadDrawForClient($row,true);
        if($current['cardRevision']!==$input['revision']||$current['seed']!==$input['seed']||$current['dayKey']!==$input['dayKey'])throw new GenesisResourceLimitException(409,'SPREAD_CARD_STALE');
        $cards=$current['cards'];$held=array_column($cards,'cardId');
        $pool=array_values(array_diff(GENESIS_SPREAD_CARD_IDS,$held));
        $cards[$input['position']]=['cardId'=>$pool[random_int(0,count($pool)-1)],'reversed'=>random_int(0,1)===1];
        $now=genesisNow();$revision=$current['cardRevision']+1;
        $db->prepare('INSERT INTO stoicheion_spread_cards VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,day_key)
            DO UPDATE SET source_seed=excluded.source_seed,revision=excluded.revision,cards_json=excluded.cards_json,updated_at=excluded.updated_at')
            ->execute([$userId,$row['day_key'],$row['seed_value'],$revision,json_encode($cards,JSON_THROW_ON_ERROR),$now]);
        // Keep activity bookkeeping under the same writer. A second redraw
        // may acquire SQLite immediately after COMMIT; a later UPDATE here
        // could then fail despite the card having already been committed.
        $result=genesisSpreadDrawForClient($row,true);genesisTouchUser($userId);$db->exec('COMMIT');return $result;
    }catch(Throwable $error){$db->exec('ROLLBACK');throw $error;}
}
