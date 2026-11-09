<?php
declare(strict_types=1);
require_once dirname(__DIR__).'/src/recurrence.php';
$vectors=json_decode(file_get_contents(dirname(__DIR__).'/resources/recurrence-vectors-v2.json'),true,512,JSON_THROW_ON_ERROR);
foreach($vectors as $i=>$vector){
    $rule=genesisRecurrenceRule($vector['rule']);$actual=[];
    for($date=$rule['rangeStart'];$date<=$rule['rangeEnd'];$date=genesisCalendarAddDays($date,1)){
        if(genesisRecurrenceMatches($vector['anchor'],$rule,$date))$actual[]=$date;
    }
    if($actual!==$vector['expected'])throw new RuntimeException('Recurrence vector mismatch: '.$i);
}
foreach([['interval'=>0],['pattern'=>'invalid'],['days'=>[]],['rangeEnd'=>'2101-01-01'],['calendarContext'=>['timeZone'=>'MSK']]] as $override){
    try{genesisRecurrenceRule(array_merge($vectors[0]['rule'],$override));throw new RuntimeException('Invalid rule accepted');}
    catch(InvalidArgumentException){}
}
echo 'Recurrence PHP: '.count($vectors)." shared web/native vectors, three calendars, lunar 13, lunar phases, zone boundaries and validation passed.\n";
