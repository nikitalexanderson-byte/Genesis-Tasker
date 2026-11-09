<?php
declare(strict_types=1);

/** Only operation data enters a receipt digest; transport/authentication fields are never included. */
function genesisSharedMutationPayloadHash(string $action,array $input,array $scope=[]):string
{
    $fields=match($action){
        'status.create'=>['title','isDone'],
        'task.create','task.update'=>['expectedRevision','title','description','entryType','tags','statusId','assigneeId','categoryId','dueDate','startDate','startTime','endTime','dependsOnIds','labelIds','priority','parentTaskId','checklists','customFields','storyPoints','estimateHours','sprintId','approvalRequired','approverIds','imageData','attachments','removeAttachmentIds','sourceTaskId','mindmapSource'],
        'task.move'=>['destinationProjectId','statusId','expectedRevision','position','dueDate','startDate','startTime','endTime'],
        'checklist.convert'=>['itemId','expectedRevision'],
        'series.create','series.update'=>['expectedRevision','taskRevision','settings','paused','refreshTemplate'],
        'series.skip'=>['seriesId','expectedRevision','taskRevision'],
        'task.archive','task.unarchive'=>['archived','expectedRevision'],
        'task.trash'=>['expectedRevision','retentionDays'],
        'task.purge'=>['confirmPermanent','expectedExpiresAt'],
        'trash.restore','trash.retention'=>['expectedExpiresAt','retentionDays'],
        'view.create','view.update'=>['spaceId','visibility','definition','expectedRevision'],
        'view.delete'=>['expectedRevision'],
        default=>throw new LogicException('Unknown shared receipt action'),
    };
    $canonical=static function(mixed $value)use(&$canonical):mixed{
        if($value instanceof stdClass){$items=(array)$value;ksort($items,SORT_STRING);return (object)array_map($canonical,$items);}
        if(!is_array($value))return $value;
        if(!array_is_list($value))ksort($value,SORT_STRING);
        return array_map($canonical,$value);
    };
    // Omitted values remain distinct from null/false/zero; list order remains significant.
    $payload=array_intersect_key($input,array_fill_keys($fields,true));
    return hash('sha256',json_encode($canonical([$action,$scope,$payload]),JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR));
}
