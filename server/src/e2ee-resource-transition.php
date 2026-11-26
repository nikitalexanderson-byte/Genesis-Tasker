<?php

declare(strict_types=1);

/** Technical owner inventory, never legacy titles/content, keys or a trust
 * decision. Called under the signed personal read's existing transaction. */
function genesisE2eeResourceTransitionCandidates(PDO $db,string $actor,array $scope,array $device,array $payload):array
{
    genesisE2eeReadPayload($payload);
    if($scope['kind']!=='personal'||$scope['owner_id']!==$actor||$scope['resource_id']!==$actor||$scope['state']!=='active'
        ||$device['user_id']!==$actor||$device['role']!=='owner')throw new GenesisResourceLimitException(403,'E2EE_OWNER_REQUIRED');
    $result=[];
    foreach(['space'=>['shared_spaces','shared_space_members','space_id'],'project'=>['shared_projects','shared_project_members','project_id']] as $kind=>[$table,$members,$foreign]){
        $q=$db->prepare("SELECT r.id,s.scope_id,s.state FROM $table r JOIN $members m ON m.$foreign=r.id AND m.user_id=? AND m.role='owner'
            LEFT JOIN e2ee_scopes s ON s.kind=? AND s.resource_id=r.id ORDER BY r.id LIMIT 4097");$q->execute([$actor,$kind]);
        try{while($row=$q->fetch()){
            if(count($result)>=4096)throw new GenesisResourceLimitException(413,'E2EE_RESOURCE_INVENTORY_TOO_LARGE');
            $result[]=['kind'=>$kind,'resourceId'=>$row['id'],'scopeId'=>$row['scope_id'],'state'=>$row['state']];
        }}finally{$q->closeCursor();}
    }
    return['resources'=>$result,'checkpointHash'=>$scope['checkpoint_hash'],'directoryRevision'=>(int)$scope['directory_revision']];
}
