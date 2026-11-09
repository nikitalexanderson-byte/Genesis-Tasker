<?php
declare(strict_types=1);
require_once __DIR__.'/calendar.php';

/** Relative template dates retain the template calendar; clamping is explicit preview data. */
function genesisTemplateDate(string $anchor,array $offset,string $mode,array $context):array
{
    genesisCalendarDate($anchor);$amount=$offset['amount']??null;$unit=$offset['unit']??null;
    $limit=match($unit){'day'=>74000,'month'=>2400,'year'=>200,default=>0};
    if(array_diff(array_keys($offset),['amount','unit'])||!is_int($amount)||abs($amount)>$limit||!in_array($unit,['day','month','year'],true)
        ||!in_array($mode,['profane','sacred','lunar'],true))throw new InvalidArgumentException('TEMPLATE_DATE_INVALID');
    $context=genesisCalendarContext($context,'Europe/Moscow',2);$clamped=false;
    if($unit==='day')$date=genesisCalendarAddDays($anchor,$amount);
    elseif($mode==='profane'){
        $source=genesisCalendarDate($anchor);$months=$amount*($unit==='year'?12:1);
        $start=$source->modify('first day of this month')->modify(($months>=0?'+':'').$months.' months');
        $day=min((int)$source->format('j'),(int)$start->format('t'));$clamped=$day!==(int)$source->format('j');
        $date=$start->setDate((int)$start->format('Y'),(int)$start->format('n'),$day)->format('Y-m-d');
    }elseif($mode==='sacred'){
        $source=genesisSacredDate($anchor,$context);$year=$source['sacredYear'];$month=$source['monthIndex'];
        if($unit==='year')$year+=$amount;
        else{$index=$year*13+$month+$amount;$year=(int)floor($index/13);$month=$index-$year*13;}
        $length=$month===12?genesisCalendarDayNumber(genesisSacredYearStart($year+1,$context))-genesisCalendarDayNumber(genesisSacredYearStart($year,$context))-360:30;
        $day=min($source['day'],$length);$clamped=$day!==$source['day'];$date=genesisSacredToCivil($year,$month,$day,$context);
    }else{
        $source=genesisLunarDate($anchor,$context);$month=$source['monthIndex'];
        if($unit==='month')$month+=$amount;
        else{$year=genesisLunarYear($source['year']['sacredYear']+$amount,$context);$ordinal=min($source['monthOrdinal'],$year['monthCount']);
            $clamped=$ordinal!==$source['monthOrdinal'];$month=$year['startMonthIndex']+$ordinal-1;}
        $start=genesisLunarMonthStart($month,$context);$length=genesisCalendarDayNumber(genesisLunarMonthStart($month+1,$context))-genesisCalendarDayNumber($start);
        $day=min($source['day'],$length);$clamped=$clamped||$day!==$source['day'];$date=genesisCalendarAddDays($start,$day-1);
    }
    if($date<'1900-01-01'||$date>'2100-12-31')throw new RangeException('TEMPLATE_DATE_OUTSIDE_RANGE');
    return ['date'=>$date,'clamped'=>$clamped,'calendarMode'=>$mode,'calendarContext'=>$context];
}
