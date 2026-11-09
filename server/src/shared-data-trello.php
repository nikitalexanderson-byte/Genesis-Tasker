<?php
declare(strict_types=1);
require_once __DIR__.'/shared-data-format.php';

function genesisDataTrelloKey(string $kind,mixed $id):string{
    if(!is_string($id)||$id===''||strlen($id)>200)genesisDataInvalid('DATA_TRELLO_INVALID');return 'trello-'.$kind.':'.substr(hash('sha256',$id),0,40);
}
function genesisDataTrelloDate(mixed $value,array $context):?string{
    if($value===null||$value==='')return null;$instant=genesisDataInstant($value);return genesisDataDate((new DateTimeImmutable($instant))->setTimezone(new DateTimeZone($context['timeZone']))->format('Y-m-d'));
}
/** Content adapters never evaluate plugins, fetch attachments or trust Trello membership as a grant. */
function genesisDataFromTrello(mixed $input,array $options):array{
    if(!is_array($input)||!isset($input['lists'],$input['cards'])||!is_array($input['lists'])||!is_array($input['cards']))genesisDataInvalid('DATA_TRELLO_INVALID');
    $out=genesisDataEmpty(genesisSharedTitle($input['name']??null));$out['calendarMode']=$options['calendarMode']??'profane';$out['calendarContext']=genesisCalendarContext($options['calendarContext']??null,'Europe/Moscow',2);
    $project=genesisDataTrelloKey('board',$input['id']??null);$columns=[];$doneKeys=$options['doneStatusKeys']??[];genesisDataList($doneKeys,30);
    foreach(genesisDataList($input['lists'],30) as $list){$key=genesisDataTrelloKey('list',$list['id']??null);$columns[$key]=['key'=>$key,'title'=>genesisSharedTitle($list['name']??null,80),'isDone'=>in_array($key,$doneKeys,true)];if(!empty($list['closed']))$out['notices'][]=['code'=>'DATA_TRELLO_ARCHIVED_LIST','field'=>$columns[$key]['title']];}
    foreach([false,true] as $done)if(!array_filter($columns,static fn($column)=>$column['isDone']===$done)){$key=$project.($done?':done':':open');$columns[$key]=['key'=>$key,'title'=>genesisSharedTitle($options[$done?'doneTitle':'openTitle']??null,80),'isDone'=>$done];}
    $out['projects'][]=['key'=>$project,'title'=>$out['space']['title'],'description'=>genesisSharedText($input['desc']??'',5000),'kind'=>'project','layout'=>'board','statuses'=>array_values($columns),'categories'=>[],'archivedAt'=>!empty($input['closed'])?($input['dateLastActivity']??null):null];
    $members=[];foreach(genesisDataList($input['members']??[],20000) as $member){$key=genesisDataTrelloKey('member',$member['id']??null);$members[$key]=['key'=>$key,'title'=>genesisSharedTitle($member['fullName']?:($member['username']??''))];}$out['members']=array_values($members);
    $labels=[];foreach(genesisDataList($input['labels']??[],2000) as $label){$key=genesisDataTrelloKey('label',$label['id']??null);$labels[$key]=['key'=>$key,'title'=>genesisSharedTitle($label['name']?:($label['color']??''),40),'color'=>'#2d6c68'];}$out['labels']=array_values($labels);
    $fields=[];$typeMap=['text'=>'text','number'=>'number','date'=>'date','list'=>'select','checkbox'=>'checkbox'];
    foreach(genesisDataList($input['customFields']??[],2000) as $field){$key=genesisDataTrelloKey('field',$field['id']??null);$type=$typeMap[$field['type']??'']??null;if($type===null){$out['notices'][]=['code'=>'DATA_FIELD_UNSUPPORTED','field'=>genesisSharedText($field['name']??'',160)];continue;}$choices=[];foreach($field['options']??[] as $choice)$choices[]=['id'=>genesisDataTrelloKey('option',$choice['id']??null),'title'=>genesisSharedTitle($choice['value']['text']??null),'archived'=>false];$fields[$key]=['key'=>$key,'projectKey'=>$project,'title'=>genesisSharedTitle($field['name']??null),'type'=>$type,'options'=>$choices];}$out['fields']=array_values($fields);
    $checklists=[];foreach(genesisDataList($input['checklists']??[],100000) as $list)$checklists[$list['id']??'']=$list;
    $cards=[];foreach(genesisDataList($input['cards'],100000) as $card){$key=genesisDataTrelloKey('card',$card['id']??null);if(isset($cards[$key]))genesisDataInvalid('DATA_REFERENCE_INVALID');$cards[$key]=$card;}
    foreach($cards as $key=>$card){
        $status=genesisDataTrelloKey('list',$card['idList']??null);if(!isset($columns[$status]))genesisDataInvalid('DATA_REFERENCE_INVALID');$assigned=[];
        foreach($card['idMembers']??[] as $id){$member=genesisDataTrelloKey('member',$id);if(!isset($members[$member]))genesisDataInvalid('DATA_REFERENCE_INVALID');$assigned[]=$member;}
        if(count($assigned)>1)$out['notices'][]=['code'=>'DATA_MULTIPLE_ASSIGNEES','field'=>genesisSharedText($card['name']??'',160)];
        $lists=[];foreach($card['idChecklists']??[] as $id){if(!isset($checklists[$id]))genesisDataInvalid('DATA_REFERENCE_INVALID');$list=$checklists[$id];$items=[];
            foreach($list['checkItems']??[] as $item){$member=isset($item['idMember'])?genesisDataTrelloKey('member',$item['idMember']):null;$items[]=['key'=>genesisDataTrelloKey('item',$item['id']??null),'title'=>$item['name']??null,'done'=>($item['state']??'')==='complete','assigneeKey'=>$member,'dueDate'=>genesisDataTrelloDate($item['due']??null,$out['calendarContext'])];}
            $lists[]=['key'=>genesisDataTrelloKey('checklist',$id),'title'=>$list['name']??null,'items'=>$items];
        }
        $values=[];foreach($card['customFieldItems']??[] as $item){$field=genesisDataTrelloKey('field',$item['idCustomField']??null);if(!isset($fields[$field])){$out['notices'][]=['code'=>'DATA_FIELD_UNSUPPORTED','field'=>$field];continue;}$value=$item['value']??[];
            $values[$field]=match($fields[$field]['type']){'select'=>isset($item['idValue'])?genesisDataTrelloKey('option',$item['idValue']):null,'number'=>isset($value['number'])&&is_numeric($value['number'])?(float)$value['number']:null,'date'=>genesisDataTrelloDate($value['date']??null,$out['calendarContext']),'checkbox'=>isset($value['checked'])?genesisDataCsvBoolean((string)$value['checked']):null,default=>$value['text']??null};
        }
        $taskLabels=[];foreach($card['idLabels']??[] as $id)$taskLabels[]=genesisDataTrelloKey('label',$id);
        $out['tasks'][]=['key'=>$key,'projectKey'=>$project,'statusKey'=>$status,'title'=>$card['name']??null,'description'=>$card['desc']??'','assigneeKey'=>$assigned[0]??null,'labelKeys'=>$taskLabels,'checklists'=>$lists,'customValues'=>(object)$values,
            'dueDate'=>genesisDataTrelloDate($card['due']??null,$out['calendarContext']),'startDate'=>genesisDataTrelloDate($card['start']??null,$out['calendarContext']),'archivedAt'=>!empty($card['closed'])?($card['dateLastActivity']??null):null,'updatedAt'=>$card['dateLastActivity']??null];
        if(!empty($card['due'])||!empty($card['start'])){$out['notices'][]=['code'=>'DATA_TRELLO_DATE_ONLY','field'=>genesisSharedText($card['name']??'',160)];$out['history'][]=['key'=>$key.':dates','projectKey'=>$project,'taskKey'=>$key,'action'=>'trello.dates','details'=>['due'=>$card['due']??null,'start'=>$card['start']??null,'dueComplete'=>(bool)($card['dueComplete']??false)]];}
        foreach($card['attachments']??[] as $attachment){$url=$attachment['url']??null;try{$url=genesisDataUrl($url);if($url!==null){$parts=parse_url($url);if(isset($parts['query'])||isset($parts['fragment'])){$url=explode('?',explode('#',$url)[0])[0];$out['notices'][]=['code'=>'DATA_URL_QUERY_REMOVED','field'=>genesisSharedText($attachment['name']??'',160)];}}}catch(InvalidArgumentException){$url=null;$out['notices'][]=['code'=>'DATA_URL_REMOVED','field'=>genesisSharedText($attachment['name']??'',160)];}
            $out['attachments'][]=['key'=>genesisDataTrelloKey('attachment',$attachment['id']??null),'projectKey'=>$project,'taskKey'=>$key,'name'=>$attachment['name']??'attachment','mimeType'=>$attachment['mimeType']??'','size'=>is_int($attachment['bytes']??null)?$attachment['bytes']:0,'url'=>$url];
        }
    }
    $unsupported=0;foreach(genesisDataList($input['actions']??[],200000) as $action){$task=isset($action['data']['card']['id'])?genesisDataTrelloKey('card',$action['data']['card']['id']):null;if($task!==null&&!isset($cards[$task])){$unsupported++;continue;}$actor=$action['memberCreator']['fullName']??($action['memberCreator']['username']??'');$key=genesisDataTrelloKey('action',$action['id']??null);
        if(($action['type']??'')==='commentCard'&&$task!==null)$out['comments'][]=['key'=>$key,'taskKey'=>$task,'authorTitle'=>$actor,'body'=>$action['data']['text']??'','createdAt'=>$action['date']??null];
        elseif(in_array($action['type']??'',['createCard','updateCard','moveCardToBoard','moveCardFromBoard'],true)){$details=[];foreach(['listBefore','listAfter'] as $part)if(isset($action['data'][$part]['name']))$details[$part]=genesisSharedText($action['data'][$part]['name'],160);$out['history'][]=['key'=>$key,'projectKey'=>$project,'taskKey'=>$task,'actorTitle'=>$actor,'action'=>'trello.'.$action['type'],'createdAt'=>$action['date']??null,'details'=>$details];}else $unsupported++;
    }
    if($unsupported)$out['notices'][]=['code'=>'DATA_TRELLO_ACTIONS_UNSUPPORTED','field'=>(string)$unsupported];$out['notices'][]=['code'=>'DATA_TRELLO_LIMITATIONS','field'=>''];
    if($out['attachments'])$out['notices'][]=['code'=>'DATA_ATTACHMENTS_METADATA_ONLY','field'=>''];return genesisDataManifest($out);
}
