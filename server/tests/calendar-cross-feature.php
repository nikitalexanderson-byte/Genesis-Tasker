<?php
declare(strict_types=1);
foreach (['calendar','template-dates','shared-views'] as $module) require_once __DIR__.'/../src/'.$module.'.php';
function featureCalendarExpect(bool $ok,string $case):void {if(!$ok)throw new RuntimeException($case);}
$count=0;
foreach (['UTC','Europe/Moscow','America/New_York','Pacific/Auckland'] as $zone) {
    foreach ([['profane','january'],['profane','march'],['sacred','january'],['lunar','january']] as [$mode,$start]) {
        $context=genesisCalendarContext(['version'=>2,'timeZone'=>$zone,'gregorianYearStart'=>$start]);
        foreach (['2024-01-01','2024-02-28','2024-02-29','2024-03-01','2024-03-19','2024-03-20','2025-03-29','2026-03-08','2026-04-16','2026-11-01'] as $date) {
            $instant=new DateTimeImmutable($date.'T12:00:00',new DateTimeZone($zone));
            $definition=['filter'=>['priority'=>[0]],'relative'=>'this-month','calendarMode'=>$mode,'calendarContext'=>$context];
            $before=$definition;$month=genesisCalendarPeriod($date,$mode,'month',$context);
            $view=genesisSharedViewResolve($definition,$instant);
            featureCalendarExpect($view['dueFrom']===$month['start']&&$view['dueTo']===genesisCalendarAddDays($month['end'],-1),'View/report month disagreement');
            featureCalendarExpect($definition===$before&&$view['priority']===[0],'Resolving a view mutated its saved conditions');
            featureCalendarExpect(genesisTemplateDate($month['start'],['amount'=>1,'unit'=>'month'],$mode,$context)['date']===$month['end'],'Template month ignored its own calendar');
            featureCalendarExpect(genesisTemplateDate($date,['amount'=>0,'unit'=>'year'],$mode,$context)['date']===$date,'Template changed its anchor');
            featureCalendarExpect(genesisTemplateDate($date,['amount'=>1,'unit'=>'day'],$mode,$context)['date']===genesisCalendarAddDays($date,1),'Date-only offset became an elapsed duration');
            $year=genesisCalendarPeriod($date,$mode,'year',$context);
            featureCalendarExpect($year['start']<=$date&&$date<$year['end'],'Reporting year lost the boundary date');
            $count++;
        }
    }
}
$utc=genesisCalendarContext(['version'=>2,'timeZone'=>'UTC']);$long=genesisLunarYear(2025,$utc);
featureCalendarExpect($long['monthCount']===13&&genesisCalendarDayNumber($long['end'])-genesisCalendarDayNumber($long['start'])>370,'Real long lunar year missing');
$last=genesisCalendarAddDays($long['end'],-1);
featureCalendarExpect(genesisCalendarPeriod($last,'lunar','year',$utc)['end']===$long['end'],'Last long-year report date excluded');
echo "Calendar cross-feature: $count zone/configuration/boundary cases; saved views, relative templates and half-open reports passed.\n";
