<?php
declare(strict_types=1);
require dirname(__DIR__).'/src/daily-advice.php';
function philosopherCheck(bool $ok,string $reason):void {if(!$ok)throw new RuntimeException($reason);}
$catalog=genesisAdviceCatalog();$philosophers=array_values(array_filter($catalog,static fn($entry)=>$entry['collection']==='philosophers'));
$complete=json_decode((string)file_get_contents(dirname(__DIR__).'/content/philosopher-aphorisms.json'),true,32,JSON_THROW_ON_ERROR)['items'];
philosopherCheck(count($complete)===2602,'Missing retained aphorisms');
philosopherCheck(count($philosophers)===count(genesisPhilosopherArtwork()),'Publication does not match ready artwork');
foreach($philosophers as $entry) philosopherCheck(isset(genesisPhilosopherArtwork()[$entry['id']]),'Unillustrated aphorism was published');
$unready=array_values(array_filter($complete,static fn($entry)=>!isset(genesisPhilosopherArtwork()[$entry['id']])));
$onlyPhilosophers=genesisAdvicePreferences(['collections'=>['philosophers']]);
foreach($unready as $entry) philosopherCheck(!genesisAdviceCollectionAllowed([...$entry,'collection'=>'philosophers'],$onlyPhilosophers),'Historical unillustrated aphorism is still visible');
$version=$philosophers[0]['translationVersion'];$seen=[];
foreach(GENESIS_ADVICE_LANGUAGES as $language){
    $locale=json_decode((string)file_get_contents(dirname(__DIR__).'/content/philosopher-aphorisms-locales/'.$version.'/'.$language.'.json'),true,32,JSON_THROW_ON_ERROR);
    foreach($philosophers as $entry){
        $card=genesisAdviceForClient(['entry_json'=>json_encode($entry,JSON_THROW_ON_ERROR),'day_key'=>'2026-11-01','dismissed_at'=>null],$language);
        philosopherCheck($card['body']===$locale[$entry['id']]['body'] && $card['sources']===$locale[$entry['id']]['sources'],'Locale/source mismatch');
        philosopherCheck($card['id']===$entry['id'] && $card['collection']==='philosophers' && $card['language']===$language,'Lost identity/language');
        if (isset(genesisPhilosopherArtwork()[$entry['id']])) {
            $path = genesisPhilosopherArtwork()[$entry['id']];
            philosopherCheck(($card['image'] ?? null) === $path && is_file(dirname(__DIR__, 2) . '/public' . $path), 'Missing individual aphorism artwork');
            $snapshot = $entry; unset($snapshot['image']);
            $oldCard = genesisAdviceForClient(['entry_json' => json_encode($snapshot, JSON_THROW_ON_ERROR), 'day_key' => '2026-10-31', 'dismissed_at' => null], $language);
            philosopherCheck(($oldCard['image'] ?? null) === $path && $oldCard['body'] === $card['body'] && $oldCard['dayKey'] === '2026-10-31', 'Historical aphorism lost its own artwork, text or day');
        }
        philosopherCheck(!isset($card['translationVersion']) && !isset($card['sourceId']) && !isset($card['translationStatus']),'Internal path or draft label exposed');
    }
}
$preferences=genesisAdvicePreferences(['collections'=>['philosophers']]);
$first=genesisChooseAdvice($catalog,$preferences,[],[],'collection-test',[],[],['day'=>'2026-11-01','hour'=>12]);
philosopherCheck($first!==null && $first['collection']==='philosophers','Philosophers-only selected another collection');
$next=genesisChooseAdvice($catalog,$preferences,[],[],'collection-test',[],[],['day'=>'2026-11-01','hour'=>12,'excluded'=>[$first['id']]]);
philosopherCheck($next!==null && $next['id']!==$first['id'],'Already drawn quote repeated');
echo "PASS retained 2602-record corpus, ready-only publication and historical eligibility, exact localized projections, stable artwork, attributed signatures and collection isolation.\n";
