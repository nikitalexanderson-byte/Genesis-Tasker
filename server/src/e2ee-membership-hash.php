<?php
declare(strict_types=1);

/** A domain-specific projection; the established canonical encoding, signatures
 * and existing packets keep their strict technical object-key grammar. */
function genesisE2eeMembershipFields(array $fields):array
{
    ksort($fields,SORT_STRING);$result=[];
    foreach($fields as $name=>$value){if(!is_string($name)||!preg_match('/\A[a-z_]{1,64}\z/D',$name))throw new InvalidArgumentException('E2EE_ACL_ROW_INVALID');
        if(is_string($value))$value=['utf8'=>rtrim(strtr(base64_encode($value),'+/','-_'),'=')];
        elseif($value!==null&&!is_bool($value)&&(!is_int($value)||$value<0))throw new InvalidArgumentException('E2EE_ACL_ROW_INVALID');
        $result[]=['name'=>$name,'value'=>$value];
    }return$result;
}
function genesisE2eeMembershipChangesProjection(array $changes):array
{
    $result=[];foreach($changes as $row){genesisE2eeExactFields($row,['table','key','expectedHash','after']);$spec=genesisE2eeAclSpec($row['table']);genesisE2eeExactFields($row['key'],$spec['keys']);
        if($row['after']!==null)genesisE2eeExactFields($row['after'],$spec['fields']);
        $result[]=['table'=>$row['table'],'key'=>genesisE2eeMembershipFields($row['key']),'expectedHash'=>$row['expectedHash'],'after'=>$row['after']===null?null:genesisE2eeMembershipFields($row['after'])];
    }return$result;
}
function genesisE2eeMembershipChangeHash(string $actor,string $intent,array $changes,array $scopes):string
{
    $value=['protocol'=>1,'hashFormat'=>'acl-name-value-v1','actorId'=>$actor,'intentId'=>$intent,'changes'=>genesisE2eeMembershipChangesProjection($changes),'scopeIds'=>$scopes];
    return rtrim(strtr(base64_encode(hash('sha256',genesisE2eeCanonical($value),true)),'+/','-_'),'=');
}
