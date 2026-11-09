<?php
declare(strict_types=1);
require_once __DIR__.'/shared-data-format.php';

/** RFC4180 state machine, including multiline quoted fields; malformed input never becomes a partial import. */
function genesisDataCsvRows(string $text,string $delimiter):array{
    if(!in_array($delimiter,[',',';',"\t"],true)||!mb_check_encoding($text,'UTF-8'))genesisDataInvalid('DATA_CSV_INVALID');
    $text=preg_replace('/^\xEF\xBB\xBF/','',$text);$rows=[];$row=[];$field='';$state='start';$length=strlen($text);
    $finish=static function()use(&$rows,&$row,&$field,&$state):void{
        $row[]=$field;if(count($row)>500)genesisDataInvalid('DATA_CSV_INVALID');if(count($row)!==1||$row[0]!=='')$rows[]=$row;
        if(count($rows)>100001)throw new GenesisResourceLimitException(413,'DATA_FILE_TOO_LARGE');$row=[];$field='';$state='start';
    };
    for($i=0;$i<$length;$i++){$char=$text[$i];
        if($state==='quoted'){if($char==='"'){if(($text[$i+1]??'')==='"'){$field.='"';$i++;}else $state='after';}else $field.=$char;}
        elseif($char===$delimiter){$row[]=$field;if(count($row)>500)genesisDataInvalid('DATA_CSV_INVALID');$field='';$state='start';}
        elseif($char==="\r"||$char==="\n"){if($char==="\r"&&($text[$i+1]??'')==="\n")$i++;$finish();}
        elseif($state==='after')genesisDataInvalid('DATA_CSV_INVALID');
        elseif($char==='"'){if($state!=='start')genesisDataInvalid('DATA_CSV_INVALID');$state='quoted';}
        else{$field.=$char;$state='plain';}
        if(strlen($field)>200000)throw new GenesisResourceLimitException(413,'DATA_FILE_TOO_LARGE');
    }
    if($state==='quoted')genesisDataInvalid('DATA_CSV_INVALID');if($row||$field!==''||$state!=='start')$finish();
    if(!$rows)genesisDataInvalid('DATA_EMPTY');$width=count($rows[0]);foreach($rows as $row)if(count($row)!==$width)genesisDataInvalid('DATA_CSV_INVALID');return $rows;
}
function genesisDataCsvCell(string $text):string{
    if(preg_match('/^[\s\p{Z}\p{C}]*[=+\-@]/u',$text)||preg_match('/^[\t\r\n\x00]/',$text)||str_starts_with($text,"'"))$text="'".$text;
    return '"'.str_replace('"','""',$text).'"';
}
function genesisDataCsvBoolean(string $value):?bool{
    $value=strtolower(trim($value));if($value==='')return null;if(in_array($value,['1','true'],true))return true;if(in_array($value,['0','false'],true))return false;genesisDataInvalid('DATA_CSV_BOOLEAN_INVALID');
}
function genesisDataCsvDate(string $value,string $format):?string{
    if(trim($value)==='')return null;$value=trim($value);if($format==='iso')return genesisDataDate($value);
    if(!in_array($format,['dmy','mdy'],true)||!preg_match('/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/D',$value,$parts))genesisDataInvalid('DATA_DATE_INVALID');
    return genesisDataDate(sprintf('%04d-%02d-%02d',(int)$parts[3],(int)$parts[$format==='dmy'?2:1],(int)$parts[$format==='dmy'?1:2]));
}
function genesisDataCsvColumnKeys():array{return ['key','title','description','project','status','done','assignee','priority','labels','dueDate','startDate','startTime','endTime','parentKey','storyPoints','estimateHours'];}

/** CSV keeps a flat editable subset. Its marker reverses our own spreadsheet escaping only. */
function genesisDataFromCsv(string $content,array $options):array{
    $delimiter=$options['delimiter']??null;if($delimiter===null){$line=strtok($content,"\r\n")?:'';$counts=[];foreach([',',';',"\t"] as $candidate)$counts[$candidate]=count(str_getcsv($line,$candidate,'"',''));arsort($counts);$delimiter=array_key_first($counts);}
    if(!is_string($delimiter))genesisDataInvalid('DATA_CSV_INVALID');$rows=genesisDataCsvRows($content,$delimiter);$headers=array_shift($rows);$columns=$options['columns']??[];
    if($columns instanceof stdClass)$columns=(array)$columns;if(!is_array($columns)||$columns&&array_is_list($columns))genesisDataInvalid('DATA_CSV_MAPPING_REQUIRED');
    $allowed=genesisDataCsvColumnKeys();$known=array_fill_keys($allowed,true);$generated=in_array('GENESIS CSV v1',$headers,true);
    foreach($headers as $index=>$title){if(preg_match('/\[([a-zA-Z]+)\]$/D',$title,$m)&&isset($known[$m[1]])&&!array_key_exists($m[1],$columns))$columns[$m[1]]=$index;elseif(isset($known[$title])&&!array_key_exists($title,$columns))$columns[$title]=$index;}
    foreach($columns as $key=>$index)if(!isset($known[$key])||!is_int($index)||!array_key_exists($index,$headers))genesisDataInvalid('DATA_CSV_MAPPING_REQUIRED');
    if(!isset($columns['title']))genesisDataInvalid('DATA_CSV_MAPPING_REQUIRED');
    $read=static function(array $row,string $key)use($columns,$generated):string{$value=isset($columns[$key])?$row[$columns[$key]]:'';return $generated&&str_starts_with($value,"'")?substr($value,1):$value;};
    $out=genesisDataEmpty(genesisSharedTitle($options['title']??null));$out['calendarMode']=$options['calendarMode']??'profane';$out['calendarContext']=genesisCalendarContext($options['calendarContext']??null,'Europe/Moscow',2);
    $defaultOpen=genesisSharedTitle($options['openTitle']??null,80);$defaultDone=genesisSharedTitle($options['doneTitle']??null,80);$dateFormat=$options['dateFormat']??'iso';$projects=[];$statuses=[];$tasks=[];$members=[];$labels=[];$fields=[];
    $customColumns=$options['customColumns']??[];if(!is_array($customColumns)||!array_is_list($customColumns)||count($customColumns)>200)genesisDataInvalid();
    if($generated)foreach($headers as $index=>$title)if(preg_match('/\[custom:(text|number|date|select|multi|checkbox|url):([a-zA-Z0-9:_-]+)\]$/D',$title,$m)&&!array_filter($customColumns,static fn($field)=>($field['column']??null)===$index))$customColumns[]=['column'=>$index,'title'=>trim(substr($title,0,strrpos($title,'['))),'type'=>$m[1]];
    foreach($customColumns as $index=>$field){$field=genesisDataObject($field,['column','title','type']);if(!is_int($field['column']??null)||!array_key_exists($field['column'],$headers)||!in_array($field['type']??null,['text','number','date','select','multi','checkbox','url'],true))genesisDataInvalid('DATA_CSV_MAPPING_REQUIRED');$id='csv-field:'.$index;$fields[$id]=['key'=>$id,'projectKey'=>null,'title'=>genesisSharedTitle($field['title']??null),'type'=>$field['type'],'options'=>[],'required'=>false,'showCard'=>true,'showList'=>true,'archived'=>false,'position'=>$index];}
    foreach($rows as $index=>$row){
        $name=$read($row,'project')?:$out['space']['title'];$project='csv-project:'.substr(hash('sha256',$name),0,32);if(!isset($projects[$project]))$projects[$project]=['key'=>$project,'parentKey'=>null,'title'=>$name,'description'=>'','kind'=>'project','layout'=>'list','statuses'=>[],'categories'=>[]];
        $explicitDone=genesisDataCsvBoolean($read($row,'done'));$done=$explicitDone??false;$statusTitle=$read($row,'status')?:($done?$defaultDone:$defaultOpen);$status='csv-status:'.substr(hash('sha256',$project.'|'.$statusTitle),0,32);
        if($explicitDone===null&&isset($statuses[$status]))$done=$statuses[$status]['isDone'];
        if(isset($statuses[$status])&&$statuses[$status]['isDone']!==$done&&$read($row,'done')!=='')genesisDataInvalid('DATA_CSV_STATUS_CONFLICT');$statuses[$status]=['key'=>$status,'projectKey'=>$project,'title'=>$statusTitle,'isDone'=>$done];
        $assignee=$read($row,'assignee');$member=$assignee===''?null:'csv-member:'.substr(hash('sha256',$assignee),0,32);if($member)$members[$member]=['key'=>$member,'title'=>$assignee];
        $taskLabels=[];foreach(array_filter(array_map('trim',explode('|',$read($row,'labels'))),'strlen') as $label){$id='csv-label:'.substr(hash('sha256',$label),0,32);$labels[$id]=['key'=>$id,'title'=>$label,'color'=>'#2d6c68'];$taskLabels[]=$id;}
        $source=$read($row,'key');$key=$source===''?'csv-task:'.$index:'csv-task:'.hash('sha256',$source);if(isset($tasks[$key]))genesisDataInvalid('DATA_REFERENCE_INVALID');
        $priority=$read($row,'priority');if($priority!==''&&!preg_match('/^[0-3]$/D',$priority))genesisDataInvalid('DATA_CSV_PRIORITY_INVALID');$values=[];
        foreach($customColumns as $fieldIndex=>$definition){$fieldId='csv-field:'.$fieldIndex;$raw=$row[$definition['column']];if($generated&&str_starts_with($raw,"'"))$raw=substr($raw,1);if($raw==='')continue;$type=$definition['type'];
            if($type==='number'){if(!preg_match('/^[+-]?\d+(?:[.,]\d+)?$/D',trim($raw)))genesisDataInvalid('DATA_CSV_NUMBER_INVALID');$value=(float)str_replace(',','.',trim($raw));}
            elseif($type==='checkbox')$value=genesisDataCsvBoolean($raw);
            elseif($type==='date')$value=genesisDataCsvDate($raw,$dateFormat);
            elseif(in_array($type,['select','multi'],true)){$items=$type==='multi'?explode('|',$raw):[$raw];$optionIds=[];foreach($items as $title){$id='option:'.substr(hash('sha256',$fieldId.'|'.$title),0,32);$fields[$fieldId]['options'][$id]=['id'=>$id,'title'=>$title,'archived'=>false];$optionIds[]=$id;}$value=$type==='select'?$optionIds[0]:$optionIds;}
            else $value=$raw;$values[$fieldId]=$value;
        }
        $parent=$read($row,'parentKey');$tasks[$key]=['key'=>$key,'projectKey'=>$project,'parentKey'=>$parent===''?null:'csv-task:'.hash('sha256',$parent),'statusKey'=>$status,'title'=>$read($row,'title'),'description'=>$read($row,'description'),
            'priority'=>(int)($priority?:0),'assigneeKey'=>$member,'labelKeys'=>$taskLabels,'dueDate'=>genesisDataCsvDate($read($row,'dueDate'),$dateFormat),'startDate'=>genesisDataCsvDate($read($row,'startDate'),$dateFormat),
            'startTime'=>$read($row,'startTime')?:null,'endTime'=>$read($row,'endTime')?:null,'customValues'=>(object)$values];
        foreach(['storyPoints','estimateHours'] as $field){$raw=trim($read($row,$field));if($raw!==''&&!preg_match('/^\d+(?:[.,]\d{1,2})?$/D',$raw))genesisDataInvalid('DATA_CSV_NUMBER_INVALID');$tasks[$key][$field]=$raw===''?null:genesisPlanningEstimate((float)str_replace(',','.',$raw));}
    }
    foreach($projects as &$project){$project['statuses']=array_values(array_filter($statuses,static fn($status)=>$status['projectKey']===$project['key']));foreach($project['statuses'] as &$status)unset($status['projectKey']);unset($status);
        foreach([false,true] as $done)if(!array_filter($project['statuses'],static fn($status)=>$status['isDone']===$done))$project['statuses'][]=['key'=>$project['key'].($done?':done':':open'),'title'=>$done?$defaultDone:$defaultOpen,'isDone'=>$done];
    }unset($project);foreach($fields as &$field)$field['options']=array_values($field['options']);unset($field);
    $out['projects']=array_values($projects);$out['members']=array_values($members);$out['labels']=array_values($labels);$out['fields']=array_values($fields);$out['tasks']=array_values($tasks);
    $out['notices'][]=['code'=>'DATA_CSV_LIMITATIONS','field'=>''];$used=array_values($columns);foreach($customColumns as $field)$used[]=$field['column'];
    foreach($headers as $index=>$title)if(!in_array($index,$used,true)&&$title!=='GENESIS CSV v1')$out['notices'][]=['code'=>'DATA_COLUMN_IGNORED','field'=>mb_substr($title,0,200)];
    return genesisDataManifest($out);
}

function genesisDataToCsv(array $data,array $titles=[]):string{
    $fields=$data['fields'];$projects=array_column($data['projects'],null,'key');$members=array_column($data['members'],null,'key');$labels=array_column($data['labels'],null,'key');$statuses=[];
    foreach($data['projects'] as $project)foreach($project['statuses'] as $status)$statuses[$status['key']]=$status;
    $keys=genesisDataCsvColumnKeys();$header=['GENESIS CSV v1'];foreach($keys as $key)$header[]=genesisSharedText($titles[$key]??$key,160).' ['.$key.']';foreach($fields as $field)$header[]=$field['title'].' [custom:'.$field['type'].':'.$field['key'].']';
    $lines=[implode(',',array_map('genesisDataCsvCell',$header))];
    foreach($data['tasks'] as $task){$values=['key'=>$task['key'],'title'=>$task['title'],'description'=>$task['description'],'project'=>$projects[$task['projectKey']]['title'],'status'=>$statuses[$task['statusKey']]['title'],'done'=>$statuses[$task['statusKey']]['isDone']?'true':'false',
        'assignee'=>$members[$task['assigneeKey']??'']['title']??'','priority'=>(string)$task['priority'],'labels'=>implode('|',array_map(static fn($key)=>$labels[$key]['title'],$task['labelKeys'])),'dueDate'=>$task['dueDate']??'','startDate'=>$task['startDate']??'','startTime'=>$task['startTime']??'','endTime'=>$task['endTime']??'','parentKey'=>$task['parentKey']??''];
        foreach(['storyPoints','estimateHours'] as $field)$values[$field]=$task[$field]===null?'':(string)$task[$field];
        $cells=['1'];foreach($keys as $key)$cells[]=$values[$key];$custom=(array)$task['customValues'];
        foreach($fields as $field){$value=$custom[$field['key']]??null;if($value===null){$cells[]='';continue;}$options=array_column($field['options'],null,'id');$cells[]=is_bool($value)?($value?'true':'false'):(is_array($value)?implode('|',array_map(static fn($id)=>$options[$id]['title']??$id,$value)):($field['type']==='select'?($options[$value]['title']??$value):(string)$value));}
        $lines[]=implode(',',array_map('genesisDataCsvCell',$cells));
    }
    $csv="\xEF\xBB\xBF".implode("\r\n",$lines)."\r\n";if(strlen($csv)>GENESIS_DATA_FILE_LIMIT)throw new GenesisResourceLimitException(413,'DATA_FILE_TOO_LARGE');return $csv;
}
