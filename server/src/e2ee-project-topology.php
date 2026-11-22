<?php
declare(strict_types=1);
require_once __DIR__.'/e2ee-technical-rows.php';

function genesisE2eeProjectTechnicalTuple(array $row): array
{
    return ['protocol'=>2,'spaceId'=>$row['space_id'],'parentProjectId'=>$row['parent_id'],'projectCategoryId'=>$row['category_id'],
        'boardStatusId'=>$row['board_status_id'],'projectType'=>$row['kind'],'layout'=>$row['layout'],'isInbox'=>(int)$row['is_inbox']===1,'archived'=>$row['archived_at']!==null];
}
function genesisE2eeSameProjectTopology(array $left,array $right): bool
{
    return genesisE2eeCanonical($left)===genesisE2eeCanonical($right);
}
/** A current private root is mandatory authority for technical child placement.
 * A legacy row or old metadata1 content header is never substituted for it. */
function genesisE2eeLiveProjectTopology(PDO $db,string $actor,string $projectId): array
{
    $project=genesisSharedProjectAccess($projectId,$actor,'read',true);
    $scope=genesisE2eeRow($db,"SELECT * FROM e2ee_scopes WHERE kind='project' AND resource_id=?",[$projectId]);
    if(!$scope||$scope['state']!=='active')throw new DomainException('E2EE_PROJECT_TOPOLOGY_REQUIRED');
    require_once __DIR__.'/e2ee-product-bootstrap.php';genesisE2eeProductBootstrapReady($db,$scope);
    $root=genesisE2eeProductRow($db,$scope,'project:'.$projectId);
    if(!$root||$root['kind']!=='project'||$root['deleted']||$root['parent_id']!==null)throw new DomainException('E2EE_PRODUCT_DELETED');
    $metadata=genesisE2eeProductMetadata('project',json_decode($root['metadata_json'],true,32,JSON_THROW_ON_ERROR));
    if($metadata['protocol']!==2||!genesisE2eeSameProjectTopology($metadata,genesisE2eeProjectTechnicalTuple($project)))
        throw new DomainException('E2EE_PROJECT_TOPOLOGY_REQUIRED');
    return ['scope'=>$scope,'root'=>$root,'metadata'=>$metadata,'project'=>$project];
}
/** Mirror only signed technical business fields. Private user text remains in
 * immutable ciphertext. Reparent/kind/owner-inbox changes need the separate
 * complete affected-scope ACL/rotation operation, never a one-scope edit. */
function genesisE2eeProjectRootMutation(PDO $db,string $actor,array $scope,array $operation,array|false $old): void
{
    if($scope['kind']!=='project'||$operation['entityId']!=='project:'.$scope['resource_id']||$operation['parentId']!==null)
        throw new DomainException('E2EE_SCOPE_BINDING_MISMATCH');
    $metadata=genesisE2eeProductMetadata('project',$operation['metadata']);
    if($metadata['protocol']!==2)throw new DomainException('E2EE_PROJECT_TOPOLOGY_REQUIRED');
    $before=genesisE2eeRow($db,'SELECT * FROM shared_projects WHERE id=?',[$scope['resource_id']]);
    if(!$before)throw new DomainException('E2EE_SOURCE_UNAVAILABLE');$current=genesisE2eeProjectTechnicalTuple($before);
    if($old){$previous=genesisE2eeProductMetadata('project',json_decode($old['metadata_json'],true,32,JSON_THROW_ON_ERROR));
        if($previous['protocol']===2&&!genesisE2eeSameProjectTopology($previous,$current))throw new DomainException('E2EE_PROJECT_TOPOLOGY_REQUIRED');}
    if($metadata['spaceId']!==$current['spaceId'])throw new DomainException('E2EE_SCOPE_BINDING_MISMATCH');
    foreach(['parentProjectId','projectType','isInbox'] as $key)if($metadata[$key]!==$current[$key])throw new DomainException('E2EE_RESOURCE_TOPOLOGY_BATCH_REQUIRED');
    if($metadata['projectCategoryId']!==$current['projectCategoryId']&&$metadata['projectCategoryId']!==null){
        $space=genesisE2eeRow($db,"SELECT * FROM e2ee_scopes WHERE kind='space' AND resource_id=?",[$current['spaceId']]);
        if($space&&$space['state']==='active'){
            require_once __DIR__.'/e2ee-product-bootstrap.php';genesisE2eeProductBootstrapReady($db,$space);
            $category=genesisE2eeProductRow($db,$space,'category:'.$metadata['projectCategoryId']);
            if(!$category||$category['deleted']||$category['kind']!=='category'||$category['parent_id']!=='space:'.$current['spaceId'])throw new DomainException('E2EE_PRODUCT_PARENT_INVALID');
            genesisSharedSpaceAccess($current['spaceId'],$actor);
        }else genesisSharedValidateProjectCategory($current['spaceId'],$metadata['projectCategoryId'],$current['projectType']);
    }
    if($metadata['boardStatusId']!==$current['boardStatusId']&&$metadata['boardStatusId']!==null){
        $parent=genesisSharedProjectAccess($current['parentProjectId'],$actor,'write');
        if($parent['space_id']!==$current['spaceId']||(int)$parent['is_inbox']===1)throw new DomainException('E2EE_SCOPE_BINDING_MISMATCH');
        $parentScope=genesisE2eeRow($db,"SELECT * FROM e2ee_scopes WHERE kind='project' AND resource_id=?",[$current['parentProjectId']]);
        if($parentScope&&$parentScope['state']==='active'){
            $authority=genesisE2eeLiveProjectTopology($db,$actor,$current['parentProjectId']);
            $status=genesisE2eeProductRow($db,$authority['scope'],'status:'.$metadata['boardStatusId']);
            if(!$status||$status['deleted']||$status['kind']!=='status'||$status['parent_id']!=='project:'.$current['parentProjectId']
                ||str_starts_with($metadata['boardStatusId'],'chaos-open:')||str_starts_with($metadata['boardStatusId'],'chaos-done:'))
                throw new DomainException('E2EE_PRODUCT_PARENT_INVALID');
        }else genesisSharedBoardPlacement($actor,$current['spaceId'],$current['parentProjectId'],$metadata['boardStatusId']);
    }
    if($metadata['archived']!==$current['archived']){
        if($current['isInbox'])throw new DomainException('SHARED_PROJECT_REQUIRED');
        if(!$metadata['archived']&&$current['projectType']==='project'&&$current['parentProjectId']===null)genesisRequireSharedOwnerQuota($current['spaceId'],'shared-projects');
    }
    if(genesisE2eeSameProjectTopology($metadata,$current))return;
    $after=$before;$after['category_id']=$metadata['projectCategoryId'];$after['board_status_id']=$metadata['boardStatusId'];$after['layout']=$metadata['layout'];
    $after['archived_at']=$metadata['archived']?($before['archived_at']??genesisNow()):null;
    $after['revision']=genesisE2eeInteger((int)$before['revision']+1,1);$after['updated_at']=genesisNow();
    genesisE2eeWithTechnicalRowWrite($db,'shared_projects',$before,$after,static function()use($db,$after):void{
        $fields=array_values(array_diff(array_keys($after),['id']));
        $db->prepare('UPDATE shared_projects SET '.implode(',',array_map(static fn(string $field):string=>'"'.$field.'"=?',$fields)).' WHERE id=?')
            ->execute([...array_map(static fn(string $field)=>$after[$field],$fields),$after['id']]);
    });
}
