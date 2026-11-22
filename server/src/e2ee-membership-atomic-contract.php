<?php
declare(strict_types=1);
require_once __DIR__.'/e2ee-membership.php';
require_once __DIR__.'/e2ee-product.php';

const GENESIS_MEMBERSHIP_PLAN_KINDS=['acl','anchors','clear-assignments','revoke-invitations','role-events','product-operations'];
const GENESIS_MEMBERSHIP_PACKET_KINDS=['rotation-packets','product-packets'];

function genesisMembershipAtomicDigest(mixed $value):string
{
    return rtrim(strtr(base64_encode(hash('sha256',genesisE2eeCanonical($value),true)),'+/','-_'),'=');
}
function genesisMembershipAtomicInteger(mixed $value,int $minimum=0):int
{
    $number=genesisE2eeInteger($value,$minimum);
    if($number>=9007199254740991)throw new InvalidArgumentException('E2EE_MEMBERSHIP_ATOMIC_INVALID');
    return $number;
}
function genesisMembershipAtomicAnchor(mixed $input):array
{
    $row=genesisE2eeExactFields($input,['scopeId','ownerId','kind','resourceId','generation','directoryRevision','checkpointHash','entityId','revision','payloadHash']);
    foreach(['scopeId','ownerId','resourceId','entityId'] as $key)genesisE2eeIdentifier($row[$key]);
    if(!in_array($row['kind'],['space','project'],true)||$row['entityId']!==$row['kind'].':'.$row['resourceId'])throw new InvalidArgumentException('E2EE_MEMBERSHIP_ATOMIC_INVALID');
    foreach(['generation','directoryRevision','revision'] as $key)genesisMembershipAtomicInteger($row[$key],1);
    genesisE2eeDecode($row['checkpointHash'],32);genesisE2eeDecode($row['payloadHash'],32);return $row;
}
/** Structural validation only. Applying a page still requires complete graph,
 * fresh ACL/root anchors and owner-authorized bound commands in the final lock. */
function genesisMembershipAtomicPage(mixed $input):array
{
    $page=genesisE2eeExactFields($input,['kind','items']);
    if(!in_array($page['kind'],[...GENESIS_MEMBERSHIP_PLAN_KINDS,...GENESIS_MEMBERSHIP_PACKET_KINDS],true)
        ||!is_array($page['items'])||!array_is_list($page['items'])||count($page['items'])<1||count($page['items'])>200)throw new InvalidArgumentException('E2EE_MEMBERSHIP_ATOMIC_INVALID');
    $seen=[];
    foreach($page['items'] as $row){
        $key=null;
        switch($page['kind']){
            case 'acl':
                genesisE2eeExactFields($row,['table','key','expectedHash','after']);$spec=genesisE2eeAclSpec($row['table']);genesisE2eeExactFields($row['key'],$spec['keys']);
                foreach($row['key'] as $id)genesisE2eeIdentifier($id);
                if($row['expectedHash']!=='absent')genesisE2eeDecode($row['expectedHash'],32);
                if($row['after']!==null){
                    $fields=genesisE2eeExactFields($row['after'],$spec['fields']);
                    foreach(['can_organize_tasks','all_projects','project_access_restricted','include_descendants','excluded'] as $field)
                        if(array_key_exists($field,$fields)&&genesisE2eeInteger($fields[$field])>1)throw new InvalidArgumentException('E2EE_MEMBERSHIP_PERMISSION_INVALID');
                    foreach(['revision','project_access_revision'] as $field)if(array_key_exists($field,$fields))genesisE2eeInteger($fields[$field],1);
                    if(isset($fields['member_category_id']))genesisE2eeIdentifier($fields['member_category_id']);
                    if(isset($fields['role'])&&!in_array($fields['role'],$row['table']==='shared_space_members'?['owner','admin','member','guest']:
                        ($row['table']==='shared_project_members'?['owner','manager','member','commenter','viewer']:['member','commenter','viewer']),true))throw new InvalidArgumentException('E2EE_MEMBERSHIP_ROLE_INVALID');
                    if(array_key_exists('permissions_json',$fields)){
                        if($fields['permissions_json']===null){if($row['table']==='shared_member_categories')throw new InvalidArgumentException('E2EE_MEMBERSHIP_PERMISSION_INVALID');}
                        else{
                            if(!is_string($fields['permissions_json'])||strlen($fields['permissions_json'])>16384)throw new InvalidArgumentException('E2EE_MEMBERSHIP_PERMISSION_INVALID');
                            $permissions=json_decode($fields['permissions_json'],true,16,JSON_THROW_ON_ERROR);genesisE2eeExactFields($permissions,['createProjects','editTasks','organizeTasks','comment','manageProjects','inviteMembers']);
                            foreach($permissions as $allowed)if(!is_bool($allowed))throw new InvalidArgumentException('E2EE_MEMBERSHIP_PERMISSION_INVALID');
                        }
                    }
                    genesisE2eeMembershipFields($fields);
                }
                $key=genesisMembershipAtomicDigest([$row['table'],genesisE2eeMembershipFields($row['key'])]);break;
            case 'anchors':$row=genesisMembershipAtomicAnchor($row);$key=$row['scopeId'];break;
            case 'clear-assignments':
                genesisE2eeExactFields($row,['projectId','userId']);foreach($row as $id)genesisE2eeIdentifier($id);$key=$row['projectId']."\0".$row['userId'];break;
            case 'revoke-invitations':
                genesisE2eeExactFields($row,['kind','resourceId','userId']);if(!in_array($row['kind'],['space','project'],true))throw new InvalidArgumentException('E2EE_MEMBERSHIP_ATOMIC_INVALID');
                genesisE2eeIdentifier($row['resourceId']);genesisE2eeIdentifier($row['userId']);$key=$row['kind']."\0".$row['resourceId']."\0".$row['userId'];break;
            case 'role-events':
                genesisE2eeExactFields($row,['projectId','userId','from','to']);genesisE2eeIdentifier($row['projectId']);genesisE2eeIdentifier($row['userId']);
                foreach(['from','to'] as $field)if($row[$field]!==null&&!in_array($row[$field],['manager','member','commenter','viewer'],true))throw new InvalidArgumentException('E2EE_MEMBERSHIP_ATOMIC_INVALID');
                $key=$row['projectId']."\0".$row['userId'];break;
            case 'product-operations':
                genesisE2eeExactFields($row,['scopeId','intentId','operations']);genesisE2eeIdentifier($row['scopeId']);genesisE2eeIdentifier($row['intentId']);$key=$row['scopeId']."\0".$row['intentId'];
                if(!is_array($row['operations'])||!array_is_list($row['operations'])||count($row['operations'])<1||count($row['operations'])>100)throw new InvalidArgumentException('E2EE_PRODUCT_BATCH_INVALID');
                $entities=[];foreach($row['operations'] as $operation){
                    genesisE2eeExactFields($operation,['action','entityId','kind','expectedRevision','domain','objectId','payloadHash','parentId','metadata','proposalId']);
                    genesisE2eeIdentifier($operation['entityId']);genesisE2eeIdentifier($operation['objectId']);genesisE2eeDecode($operation['payloadHash'],32);genesisMembershipAtomicInteger($operation['expectedRevision']);
                    if(isset($entities[$operation['entityId']])||!in_array($operation['kind'],GENESIS_E2EE_PRODUCT_KINDS,true)
                        ||!in_array($operation['action'],['create','update','delete','restore'],true)||$operation['proposalId']!==null
                        ||$operation['domain']!==genesisE2eeProductDomain($operation['kind'])||!preg_match('/\Aproduct-version:[a-f0-9-]{36}\z/D',$operation['objectId']))throw new InvalidArgumentException('E2EE_PRODUCT_BATCH_INVALID');
                    $entities[$operation['entityId']]=true;if($operation['parentId']!==null)genesisE2eeIdentifier($operation['parentId']);genesisE2eeProductMetadata($operation['kind'],$operation['metadata']);
                }break;
            case 'rotation-packets':case 'product-packets':
                genesisE2eeExactFields($row,['command','signature']);$command=genesisE2eeCommand($row['command']);genesisE2eeCommandBytes($command);genesisE2eeDecode($row['signature'],64);
                if($command['action']!==($page['kind']==='rotation-packets'?'rotate-membership':'product-commit-bound'))throw new InvalidArgumentException('E2EE_MEMBERSHIP_ATOMIC_INVALID');
                $key=$command['scopeId']."\0".$command['operationId'];break;
        }
        if($key===null||isset($seen[$key]))throw new InvalidArgumentException('E2EE_MEMBERSHIP_ATOMIC_INVALID');$seen[$key]=true;
    }
    $value=['format'=>'genesis-membership-page-v2','kind'=>$page['kind'],'items'=>$page['kind']==='acl'?genesisE2eeMembershipChangesProjection($page['items']):$page['items']];
    if(strlen(genesisE2eeCanonical($value))>512*1024)throw new InvalidArgumentException('E2EE_MEMBERSHIP_PAGE_TOO_LARGE');
    return $page;
}
function genesisMembershipAtomicPageRef(int $index,mixed $input):array
{
    genesisMembershipAtomicInteger($index);$page=genesisMembershipAtomicPage($input);
    return ['index'=>$index,'kind'=>$page['kind'],'count'=>count($page['items']),'pageHash'=>genesisMembershipAtomicDigest([
        'format'=>'genesis-membership-page-v2','kind'=>$page['kind'],'items'=>$page['kind']==='acl'?genesisE2eeMembershipChangesProjection($page['items']):$page['items']])];
}
function genesisMembershipAtomicRefs(mixed $input,bool $packets):array
{
    if(!is_array($input)||!array_is_list($input)||count($input)>10000||(!$packets&&count($input)<1))throw new InvalidArgumentException('E2EE_MEMBERSHIP_ATOMIC_INVALID');
    foreach($input as $index=>$row){genesisE2eeExactFields($row,['index','kind','count','pageHash']);
        if(genesisMembershipAtomicInteger($row['index'])!==$index||!in_array($row['kind'],$packets?GENESIS_MEMBERSHIP_PACKET_KINDS:GENESIS_MEMBERSHIP_PLAN_KINDS,true)||genesisMembershipAtomicInteger($row['count'],1)>200)throw new InvalidArgumentException('E2EE_MEMBERSHIP_ATOMIC_INVALID');genesisE2eeDecode($row['pageHash'],32);
    }return $input;
}
function genesisMembershipAtomicPlan(mixed $input):array
{
    $plan=genesisE2eeExactFields($input,['format','actorId','intentId','spaceId','reviewFingerprint','scopeIds','pages']);
    if($plan['format']!=='genesis-membership-atomic-plan-v2')throw new InvalidArgumentException('E2EE_MEMBERSHIP_ATOMIC_INVALID');
    foreach(['actorId','intentId','spaceId'] as $key)genesisE2eeIdentifier($plan[$key]);genesisE2eeDecode($plan['reviewFingerprint'],32);
    $scopes=genesisE2eeProductIds($plan['scopeIds'],5001);if(!$scopes)throw new InvalidArgumentException('E2EE_MEMBERSHIP_ATOMIC_INVALID');sort($scopes,SORT_STRING);
    if($scopes!==$plan['scopeIds'])throw new InvalidArgumentException('E2EE_MEMBERSHIP_ATOMIC_INVALID');genesisMembershipAtomicRefs($plan['pages'],false);return $plan;
}
function genesisMembershipAtomicChangeHash(array $input):string
{
    $plan=genesisMembershipAtomicPlan($input);return genesisMembershipAtomicDigest(['protocol'=>2,'actorId'=>$plan['actorId'],'intentId'=>$plan['intentId'],
        'planHash'=>genesisMembershipAtomicDigest($plan),'scopeIds'=>$plan['scopeIds']]);
}
function genesisMembershipAtomicBatchHash(array $plan,array $pages):string
{
    return genesisMembershipAtomicDigest(['protocol'=>2,'planHash'=>genesisMembershipAtomicDigest(genesisMembershipAtomicPlan($plan)),'packetPages'=>genesisMembershipAtomicRefs($pages,true)]);
}
