<?php
declare(strict_types=1);
require_once __DIR__.'/e2ee-project-topology.php';

/** Minted only after the signed preparation's current topology/recipient review
 * is verified under its SQLite writer lock. No API boolean can construct it.
 * It authorizes technical fresh rows, never existing ACL rotation or capsules. */
final class GenesisE2eeProjectCreation
{
    private bool $consumed=false;
    private function __construct(private readonly PDO $db,public readonly string $actor,public readonly string $resourceId,public readonly array $topology,private readonly array $members) {}
    private static function same(mixed $left,mixed $right): bool {return genesisE2eeCanonical($left)===genesisE2eeCanonical($right);}
    private static function anchor(mixed $input,array $scope,array $root): void
    {
        $value=genesisE2eeExactFields($input,['scopeId','entityId','generation','directoryRevision','checkpointHash','revision','payloadHash']);
        $expected=['scopeId'=>$scope['scope_id'],'entityId'=>$root['entity_id'],'generation'=>(int)$scope['generation'],'directoryRevision'=>(int)$scope['directory_revision'],
            'checkpointHash'=>$scope['checkpoint_hash'],'revision'=>(int)$root['revision'],'payloadHash'=>$root['payload_hash']];
        if(!self::same($value,$expected))throw new DomainException('E2EE_PROJECT_TOPOLOGY_CHANGED');
    }
    public static function verify(PDO $db,string $actor,string $resourceId,mixed $input): self
    {
        if(!$db->inTransaction())throw new LogicException('E2EE_TRANSACTION_CONTEXT_INVALID');
        genesisE2eeIdentifier($resourceId);
        $value=genesisE2eeExactFields($input,['spaceId','parentId','categoryId','boardStatusId','kind','layout','spaceAnchor','parentAnchor','categoryAnchor','statusAnchor','reviewedMembers']);
        genesisE2eeIdentifier($value['spaceId']);foreach(['parentId','categoryId','boardStatusId'] as $key)if($value[$key]!==null)genesisE2eeIdentifier($value[$key]);
        if(!in_array($value['kind'],['project','task-list'],true)||!in_array($value['layout'],['list','board'],true)||$value['kind']==='task-list'&&($value['parentId']===null||$value['categoryId']!==null)
          ||$value['boardStatusId']!==null&&$value['parentId']===null)throw new InvalidArgumentException('E2EE_PRODUCT_METADATA_INVALID');
        genesisSharedRequireEnabled($actor);$access=genesisSharedSpaceAccess($value['spaceId'],$actor);
        if(!genesisSharedSpacePermission($access,'createProjects'))throw new GenesisSharedAccessException('SHARED_SPACE_FORBIDDEN',403);
        require_once __DIR__.'/e2ee-product-bootstrap.php';
        $space=genesisE2eeRow($db,"SELECT * FROM e2ee_scopes WHERE kind='space' AND resource_id=?",[$value['spaceId']]);
        if(!$space||$space['state']!=='active')throw new DomainException('E2EE_PROJECT_TOPOLOGY_REQUIRED');
        genesisE2eeProductBootstrapReady($db,$space);$spaceRoot=genesisE2eeProductRow($db,$space,'space:'.$value['spaceId']);
        if(!$spaceRoot||$spaceRoot['deleted']||$spaceRoot['kind']!=='space'||$spaceRoot['parent_id']!==null)throw new DomainException('E2EE_PRODUCT_DELETED');self::anchor($value['spaceAnchor'],$space,$spaceRoot);
        if(genesisE2eeRow($db,'SELECT 1 FROM shared_projects WHERE id=?',[$resourceId])||genesisE2eeRow($db,'SELECT 1 FROM e2ee_scopes WHERE resource_id=?',[$resourceId]))
            throw new DomainException('E2EE_SCOPE_ALREADY_INITIALIZED');
        $chain=[];$cursor=$value['parentId'];$parent=null;
        while($cursor!==null){
            if(count($chain)>=256||in_array($cursor,$chain,true)||$cursor===$resourceId)throw new DomainException('E2EE_PRODUCT_DEPENDENCY_CYCLE');
            $current=genesisE2eeProjectTopologyAt($db,$cursor);
            if($current['metadata']['spaceId']!==$value['spaceId']||$current['metadata']['isInbox']||$current['metadata']['archived'])throw new DomainException('E2EE_SCOPE_BINDING_MISMATCH');
            if($parent===null){$parent=$current;genesisSharedProjectAccess($cursor,$actor,'write');self::anchor($value['parentAnchor'],$current['scope'],$current['root']);}
            $chain[]=$cursor;$cursor=$current['metadata']['parentProjectId'];
        }
        if($parent===null&&$value['parentAnchor']!==null)throw new DomainException('E2EE_CONTEXT_MISMATCH');
        if($value['categoryId']!==null){
            $category=genesisE2eeProductRow($db,$space,'category:'.$value['categoryId']);
            if(!$category||$category['deleted']||$category['kind']!=='category'||$category['parent_id']!=='space:'.$value['spaceId'])throw new DomainException('E2EE_PRODUCT_PARENT_INVALID');
            self::anchor($value['categoryAnchor'],$space,$category);
            genesisE2eeEnsurePrivateProjectReference($db,$space,'category',$value['categoryId'],$category);
        }elseif($value['categoryAnchor']!==null)throw new DomainException('E2EE_CONTEXT_MISMATCH');
        if($value['boardStatusId']!==null){
            $status=genesisE2eeProductRow($db,$parent['scope'],'status:'.$value['boardStatusId']);
            if(!$status||$status['deleted']||$status['kind']!=='status'||$status['parent_id']!=='project:'.$value['parentId']
                ||str_starts_with($value['boardStatusId'],'chaos-open:')||str_starts_with($value['boardStatusId'],'chaos-done:'))throw new DomainException('E2EE_PRODUCT_PARENT_INVALID');
            self::anchor($value['statusAnchor'],$parent['scope'],$status);
            genesisE2eeEnsurePrivateProjectReference($db,$parent['scope'],'status',$value['boardStatusId'],$status);
        }elseif($value['statusAnchor']!==null)throw new DomainException('E2EE_CONTEXT_MISMATCH');
        // Reuse nearest-explicit-grant semantics, scoped to this new child only.
        // No old project memberships/assignments/projections are rewritten.
        $q=$db->prepare('SELECT user_id,role,all_projects,project_access_restricted FROM shared_space_members WHERE space_id=? ORDER BY user_id LIMIT 201');$q->execute([$value['spaceId']]);
        try{$spaceMembers=$q->fetchAll();}finally{$q->closeCursor();}if(count($spaceMembers)>200)throw new GenesisResourceLimitException(413,'E2EE_PRODUCT_CONTEXT_TOO_LARGE');
        $members=[$actor=>'owner'];
        foreach($spaceMembers as $member){
            $user=$member['user_id'];if($user===$actor)continue;
            $role=in_array($member['role'],['owner','admin'],true)?'manager':((int)$member['all_projects']===1?($member['role']==='member'?'member':'viewer'):null);
            if((int)$member['project_access_restricted']===1&&!in_array($member['role'],['owner','admin'],true)){
                $q=$db->prepare('SELECT project_id,role,excluded,include_descendants FROM shared_member_project_grants WHERE space_id=? AND user_id=?');$q->execute([$value['spaceId'],$user]);
                try{$grants=array_column($q->fetchAll(),null,'project_id');}finally{$q->closeCursor();}$role=null;
                foreach($chain as $ancestor)if(isset($grants[$ancestor])&&(int)$grants[$ancestor]['include_descendants']===1){$role=(int)$grants[$ancestor]['excluded']===1?null:$grants[$ancestor]['role'];break;}
            }
            if($role!==null)$members[$user]=$role;
        }
        ksort($members,SORT_STRING);$review=[];foreach($members as $user=>$role)$review[]=['userId'=>(string)$user,'role'=>$role];
        if(!is_array($value['reviewedMembers'])||!array_is_list($value['reviewedMembers'])||!self::same($review,$value['reviewedMembers']))throw new DomainException('E2EE_PROJECT_RECIPIENT_REVIEW_REQUIRED');
        return new self($db,$actor,$resourceId,$value,$members);
    }
    public function assertFactory(string $actor,string $spaceId,array $input): void
    {
        if($actor!==$this->actor||$spaceId!==$this->topology['spaceId']||($input['title']??null)!=='[encrypted:'.$this->resourceId.']'||($input['description']??'')!==''
          ||($input['tags']??[])!==[]||($input['labelIds']??[])!==[])throw new DomainException('E2EE_CONTEXT_MISMATCH');
        foreach(['parentId','categoryId','boardStatusId','kind','layout'] as $key)if(($input[$key]??null)!==$this->topology[$key])throw new DomainException('E2EE_PROJECT_TOPOLOGY_CHANGED');
    }
    public function insert(PDO $db,string $table,array $values): void
    {
        if($db!==$this->db||!$db->inTransaction()||$this->consumed)throw new LogicException('E2EE_TRANSACTION_CONTEXT_INVALID');
        if($table==='shared_projects'){
            if($values['id']!==$this->resourceId||$values['space_id']!==$this->topology['spaceId']||$values['parent_id']!==$this->topology['parentId']
              ||$values['category_id']!==$this->topology['categoryId']||$values['board_status_id']!==$this->topology['boardStatusId']||$values['kind']!==$this->topology['kind']
              ||$values['layout']!==$this->topology['layout']||$values['created_by']!==$this->actor||$values['title']!=='[encrypted:'.$this->resourceId.']'
              ||$values['description']!==''||$values['tags_json']!=='[]')throw new DomainException('E2EE_CONTEXT_MISMATCH');
        }elseif($table==='shared_project_statuses'){
            if($values['project_id']!==$this->resourceId)throw new DomainException('E2EE_CONTEXT_MISMATCH');
            $values['title']='[encrypted:'.$values['id'].']';
        }else throw new LogicException('E2EE_TECHNICAL_TABLE_FORBIDDEN');
        genesisE2eeInsertTechnicalRow($db,$table,$values);
    }
    public function inherit(PDO $db,string $now): void
    {
        if($db!==$this->db||!$db->inTransaction()||$this->consumed||genesisE2eeRow($db,'SELECT 1 FROM e2ee_scopes WHERE resource_id=?',[$this->resourceId]))throw new LogicException('E2EE_TRANSACTION_CONTEXT_INVALID');
        $q=$db->prepare('SELECT user_id,role FROM shared_project_members WHERE project_id=?');$q->execute([$this->resourceId]);try{$current=array_column($q->fetchAll(),null,'user_id');}finally{$q->closeCursor();}
        foreach($current as $user=>$row)if(!isset($this->members[$user]))$db->prepare('DELETE FROM shared_project_members WHERE project_id=? AND user_id=?')->execute([$this->resourceId,$user]);
        foreach($this->members as $user=>$role){
            if(isset($current[$user])){if($current[$user]['role']!==$role)$db->prepare('UPDATE shared_project_members SET role=? WHERE project_id=? AND user_id=?')->execute([$role,$this->resourceId,$user]);}
            else $db->prepare('INSERT INTO shared_project_members VALUES(?,?,?,?)')->execute([$this->resourceId,$user,$role,$now]);
        }
        $this->consumed=true;
    }
}
