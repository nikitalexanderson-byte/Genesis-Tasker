<?php
declare(strict_types=1);
require_once __DIR__ . '/calendar.php';

/** Shared wire rules mirror task-recurrence.ts; invalid input never becomes an unrestricted rule. */
function genesisRecurrenceRule(mixed $value): array
{
    if (!is_array($value)) throw new InvalidArgumentException('SERIES_INVALID');
    $patterns = ['classic'=>['daily','weekdays','monthly','yearly'],
        'genesis'=>['pyata-days','month-days'],
        'lunar'=>['lunar-days','lunar-decades','lunar-decade-days','lunar-phases','lunar-yearly']];
    $mode = $value['mode'] ?? ''; $pattern = $value['pattern'] ?? '';
    if (!is_string($mode) || !isset($patterns[$mode]) || !in_array($pattern,$patterns[$mode],true)) throw new InvalidArgumentException('SERIES_INVALID');
    $interval = $value['interval'] ?? 1;
    if (!is_int($interval) || $interval<1 || $interval>99) throw new InvalidArgumentException('SERIES_INVALID');
    $start = $value['rangeStart'] ?? ''; $end = $value['rangeEnd'] ?? '';
    foreach ([$start,$end] as $date) if ($date!=='' && (!is_string($date) || $date<'1900-01-01' || $date>'2100-12-31' || genesisCalendarDate($date)->format('Y-m-d')!==$date)) throw new InvalidArgumentException('SERIES_INVALID');
    if ($start==='' || $end!=='' && $end<$start) throw new InvalidArgumentException('SERIES_INVALID');
    $limits = ['days'=>$mode==='classic'?7:($pattern==='pyata-days'?5:($pattern==='lunar-decades'?3:($pattern==='lunar-decade-days'?10:($pattern==='lunar-phases'?2:30)))),
        'months'=>$pattern==='lunar-yearly'?13:72, 'pyatas'=>$pattern==='lunar-decade-days'?3:6];
    $lists=[];
    foreach($limits as $key=>$max) {
        $list=$value[$key]??[];
        if(!is_array($list)||!array_is_list($list)||count($list)>$max||array_filter($list,static fn($v)=>!is_int($v)||$v<1||$v>$max)) throw new InvalidArgumentException('SERIES_INVALID');
        $lists[$key]=array_values(array_unique($list)); sort($lists[$key]);
    }
    if(!$lists['days'] || $pattern==='lunar-yearly' && !$lists['months']) throw new InvalidArgumentException('SERIES_INVALID');
    return ['enabled'=>true,'mode'=>$mode,'pattern'=>$pattern,'interval'=>$interval,
        'rangeStart'=>$start,'rangeEnd'=>$end,'invalidDayPolicy'=>'skip',
        'calendarContext'=>genesisCalendarContext($value['calendarContext']??null,'Europe/Moscow',2)]+$lists;
}

function genesisRecurrenceMatches(string $anchor, array $rule, string $date): bool
{
    if($date<$anchor||$date<$rule['rangeStart']||$date>'2100-12-31'||($rule['rangeEnd']!==''&&$date>$rule['rangeEnd']))return false;
    $start=max($anchor,$rule['rangeStart']); $candidate=genesisCalendarDate($date); $base=genesisCalendarDate($start);
    $context=$rule['calendarContext']; $pattern=$rule['pattern']; $interval=$rule['interval'];
    $selected=static fn($v)=>in_array($v,$rule['days'],true);
    if($rule['mode']==='classic') {
        if($pattern==='daily')return (genesisCalendarDayNumber($date)-genesisCalendarDayNumber($start))%$interval===0;
        if($pattern==='weekdays') {
            $a=genesisCalendarDayNumber($start)-(int)$base->format('N')+1;
            $b=genesisCalendarDayNumber($date)-(int)$candidate->format('N')+1;
            return intdiv($b-$a,7)%$interval===0 && $selected((int)$candidate->format('N'));
        }
        if($pattern==='monthly')return (((int)$candidate->format('Y')-(int)$base->format('Y'))*12+(int)$candidate->format('n')-(int)$base->format('n'))%$interval===0 && substr($date,8)===substr($anchor,8);
        return ((int)$candidate->format('Y')-(int)$base->format('Y'))%$interval===0 && substr($date,5)===substr($anchor,5);
    }
    if($rule['mode']==='genesis') {
        $s=genesisSacredDate($date,$context);
        if($s['monthIndex']===12 || $rule['months'] && !in_array($s['monthIndex']+1,$rule['months'],true))return false;
        return $pattern==='month-days' ? $selected($s['day']) : (!$rule['pyatas']||in_array(intdiv($s['day']-1,5)+1,$rule['pyatas'],true)) && $selected(($s['day']-1)%5+1);
    }
    $l=genesisLunarDate($date,$context);
    $matches=match($pattern) {
        'lunar-decades'=>$selected(intdiv($l['day']-1,10)+1),
        'lunar-decade-days'=>(!$rule['pyatas']||in_array(intdiv($l['day']-1,10)+1,$rule['pyatas'],true))&&$selected(($l['day']-1)%10+1),
        'lunar-phases'=>($selected(1)&&$l['day']===1)||($selected(2)&&genesisCalendarEventDate(genesisCalendarEphemeris()['fullMoons'][$l['monthIndex']-genesisCalendarEphemeris()['firstMoonIndex']],$context)===$date),
        default=>$selected($l['day']),
    };
    if(!$matches)return false;
    if($pattern==='lunar-yearly')return in_array($l['monthOrdinal'],$rule['months'],true);
    return !$rule['months'] || in_array($l['monthIndex']-genesisLunarDate($start,$context)['monthIndex']+1,$rule['months'],true);
}
