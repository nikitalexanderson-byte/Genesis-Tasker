<?php
declare(strict_types=1);

/** Presentation only: the full plan and its fingerprint still authorize every imported row. */
function genesisDataNativePreview(array $plan):array{
    $data=$plan['data'];
    $keep=static fn(array $value,array $keys):array=>array_intersect_key($value,array_fill_keys($keys,true));
    $source=$keep($data,['format','version','calendarMode','calendarContext','members','fields']);
    $source['projects']=array_map(static function(array $project)use($keep):array{
        $value=$keep($project,['key','title','parentKey']);
        $value['statuses']=array_map(static fn(array $status):array=>$keep($status,['key','title','isDone']),$project['statuses']);
        return $value;
    },$data['projects']);
    $source['labels']=array_map(static fn(array $label):array=>$keep($label,['key','title']),$data['labels']);
    $source['tasks']=array_map(static fn(array $task):array=>$keep($task,['key','title','projectKey','dueDate']),array_slice($data['tasks'],0,100));
    $result=$keep($plan,['fingerprint','canApply','projectCount','taskCount','memberMap','statusMap','labelMap','fieldMap','optionMap',
        'destinationFields','destinationMembers','destinationStatuses','destinationLabels','blockers','notices']);
    $result['previewVersion']=1;$result['data']=$source;$result['sampleLimit']=100;$result['sourceCounts']=[];
    foreach(['projects','tasks','comments','history','attachments','series','templates'] as $kind)$result['sourceCounts'][$kind]=count($data[$kind]);
    $titles=[];foreach(['projects','members','labels','fields','tasks'] as $kind)foreach($data[$kind] as $row){$titles[$row['key']]=$row['title'];if($kind==='projects')foreach($row['statuses'] as $status)$titles[$status['key']]=$status['title'];}
    $issueKeys=array_column(array_merge($plan['blockers'],$plan['notices']),'field');$result['issueTitles']=(object)array_intersect_key($titles,array_fill_keys($issueKeys,true));
    // Never truncate mapping catalogs or blockers to fit the native transport budget.
    if(strlen(genesisDataJson($result))>30_000_000)throw new GenesisResourceLimitException(413,'DATA_RESOURCE_LIMIT');
    return $result;
}

function genesisDataNativeReceipt(array $receipt):array{
    $result=array_intersect_key($receipt,array_fill_keys(['importId','operationId','spaceId','rootProjectId','projectCount','taskCount',
        'notices','duplicate','state','canUndo','createdAt'],true));
    $result['noticeCount']=count($receipt['notices']);$result['notices']=array_slice($receipt['notices'],0,100);
    return $result;
}

/** Unknown representations fail before any write instead of quietly applying a differently shaped request. */
function genesisDataNativeView(mixed $view):bool{
    if($view===null)return false;
    if($view!=='native-v1')genesisDataInvalid('DATA_VIEW_INVALID');
    return true;
}
