<?php
declare(strict_types=1);
require __DIR__.'/../src/template-dates.php';
function templateDateCheck(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);}
$context=['version'=>2,'timeZone'=>'Europe/Moscow','gregorianYearStart'=>'march'];
foreach([['2024-01-31',1,'month','2024-02-29',true],['2024-02-29',1,'year','2025-02-28',true],['2026-01-31',-1,'month','2025-12-31',false]] as [$from,$amount,$unit,$expected,$clamped]){
    $result=genesisTemplateDate($from,compact('amount','unit'),'profane',$context);
    templateDateCheck($result['date']===$expected&&$result['clamped']===$clamped,'Gregorian relative period lost its day/clamp');
}
$sacred=false;$lunarMonth=false;$lunarYear=false;
for($year=2000;$year<2040;$year++){
    $length=genesisCalendarDayNumber(genesisSacredYearStart($year+1,$context))-genesisCalendarDayNumber(genesisSacredYearStart($year,$context))-360;
    $next=genesisCalendarDayNumber(genesisSacredYearStart($year+2,$context))-genesisCalendarDayNumber(genesisSacredYearStart($year+1,$context))-360;
    if($length>$next){$from=genesisSacredToCivil($year,12,$length,$context);$result=genesisTemplateDate($from,['amount'=>1,'unit'=>'year'],'sacred',$context);
        templateDateCheck($result['date']===genesisSacredToCivil($year+1,12,$next,$context)&&$result['clamped'],'Apeiron day was silently rolled into a different period');$sacred=true;}
    $a=genesisLunarYear($year,$context);$b=genesisLunarYear($year+1,$context);
    if($a['monthCount']===13&&$b['monthCount']===12){$from=genesisLunarMonthStart($a['startMonthIndex']+12,$context);$result=genesisTemplateDate($from,['amount'=>1,'unit'=>'year'],'lunar',$context);
        templateDateCheck($result['date']===genesisLunarMonthStart($b['endMonthIndex']-1,$context)&&$result['clamped'],'Lunar intercalary month did not explicitly clamp');$lunarYear=true;}
    for($month=$a['startMonthIndex'];$month<$a['endMonthIndex']-1;$month++){
        $first=genesisLunarMonthStart($month,$context);$second=genesisLunarMonthStart($month+1,$context);$third=genesisLunarMonthStart($month+2,$context);
        if(genesisCalendarDayNumber($second)-genesisCalendarDayNumber($first)===30&&genesisCalendarDayNumber($third)-genesisCalendarDayNumber($second)===29){
            $result=genesisTemplateDate(genesisCalendarAddDays($second,-1),['amount'=>1,'unit'=>'month'],'lunar',$context);
            templateDateCheck($result['date']===genesisCalendarAddDays($third,-1)&&$result['clamped'],'Lunar month used Gregorian or fixed day count');$lunarMonth=true;break;
        }
    }
    if($sacred&&$lunarMonth&&$lunarYear)break;
}
templateDateCheck($sacred&&$lunarMonth&&$lunarYear,'Boundary fixtures were not exercised');
$from=genesisSacredToCivil(2026,11,30,$context);$result=genesisTemplateDate($from,['amount'=>1,'unit'=>'month'],'sacred',$context);
templateDateCheck(genesisSacredDate($result['date'],$context)['monthIndex']===12&&$result['clamped'],'Apeiron was skipped as a month');
echo "Template dates: Gregorian leap/negative, sacred Apeiron and lunar 30/29 and 13/12 periods passed.\n";
