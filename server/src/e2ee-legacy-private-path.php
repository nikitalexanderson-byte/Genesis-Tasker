<?php
declare(strict_types=1);
require_once __DIR__.'/e2ee-legacy-personal.php';
require_once __DIR__.'/e2ee-legacy-shared-mindmaps.php';

function genesisE2eePrivateSourceEncode(string $bytes):string{return rtrim(strtr(base64_encode($bytes),'+/','-_'),'=');}

/** Deployable, fixed schema/path catalogue. Request strings never supply SQL. */
function genesisE2eePrivatePathCatalogue():array
{
    static $catalogue=null;
    if($catalogue!==null)return$catalogue;
    $raw=file_get_contents(__DIR__.'/../resources/e2ee-private-path-sources-v1.json');
    if(!is_string($raw)||strlen($raw)>256*1024)throw new RuntimeException('E2EE_SOURCE_CATALOGUE_UNAVAILABLE');
    $value=json_decode($raw,true,32,JSON_THROW_ON_ERROR);
    if(($value['version']??null)!==1||!is_array($value['paths']??null)||!is_array($value['tables']??null))throw new RuntimeException('E2EE_SOURCE_CATALOGUE_UNAVAILABLE');
    return$catalogue=$value;
}

/** Exact read grants, independent of the conservative write-fence predicates.
 * Author copies are read in personal.local-work. A scope-specific copy must have
 * explicit resource lineage; current membership alone never grants its body. */
function genesisE2eePrivatePathWhere(string $kind,string $table):string
{
    if($kind==='personal'){
        $owners=['shared_saved_views'=>"r.owner_id=:actor AND r.visibility='personal'",'shared_space_ui'=>'r.user_id=:actor',
            'shared_project_imports'=>'r.source_user_id=:actor','shared_task_transfers'=>'r.source_user_id=:actor',
            'shared_bulk_operations'=>'r.actor_id=:actor','shared_automation_operations'=>'r.actor_id=:actor','shared_template_operations'=>'r.actor_id=:actor',
            'shared_custom_field_receipts'=>'r.actor_id=:actor','shared_planning_receipts'=>'r.actor_id=:actor','shared_mutation_receipts'=>'r.user_id=:actor'];
        return$owners[$table]??throw new DomainException('E2EE_SOURCE_PATH_FORBIDDEN');
    }
    $project=$kind==='project';
    if(!$project&&$kind!=='space')throw new DomainException('E2EE_SOURCE_PATH_FORBIDDEN');
    if($table==='shared_projects')return$project?'r.id=:resource':throw new DomainException('E2EE_SOURCE_PATH_FORBIDDEN');
    if($table==='shared_spaces')return!$project?'r.id=:resource':throw new DomainException('E2EE_SOURCE_PATH_FORBIDDEN');
    if(in_array($table,['shared_templates','shared_custom_fields'],true))return$project?'r.project_id=:resource':'r.space_id=:resource AND r.project_id IS NULL';
    if($table==='shared_custom_field_versions')return'EXISTS(SELECT 1 FROM shared_custom_fields f WHERE f.id=r.field_id AND '.($project?'f.project_id=:resource':'f.space_id=:resource AND f.project_id IS NULL').')';
    if($table==='shared_template_sources')return$project?'r.project_id=:resource':
        'EXISTS(SELECT 1 FROM shared_templates t WHERE t.id=r.template_id AND t.space_id=:resource AND t.project_id IS NULL)';
    if(in_array($table,['shared_mindmaps','shared_mindmap_versions'],true))return$project?'r.project_id=:resource':'r.space_id=:resource AND r.project_id IS NULL';
    if(in_array($table,['shared_mindmap_deletions','shared_mindmap_deletion_scopes','shared_mindmap_receipts','shared_mindmap_conversions'],true))
        throw new DomainException('E2EE_SHARED_MAP_LINEAGE_READER_REQUIRED');
    if($table==='shared_saved_views')return!$project?"r.space_id=:resource AND r.visibility='shared'":throw new DomainException('E2EE_SOURCE_PATH_FORBIDDEN');
    if($table==='shared_space_ui')return!$project?'r.space_id=:resource AND r.user_id=:actor':throw new DomainException('E2EE_SOURCE_PATH_FORBIDDEN');
    if($table==='shared_data_imports')return!$project?'r.space_id=:resource AND r.actor_id=:actor':throw new DomainException('E2EE_SOURCE_PATH_FORBIDDEN');
    if($table==='shared_data_import_records')return$project?'r.project_id=:resource':
        'r.project_id IS NULL AND EXISTS(SELECT 1 FROM shared_data_imports i WHERE i.id=r.import_id AND i.space_id=:resource AND i.actor_id=:actor)';
    if(in_array($table,['shared_space_labels','shared_space_project_categories','shared_member_categories'],true))return!$project?'r.space_id=:resource':throw new DomainException('E2EE_SOURCE_PATH_FORBIDDEN');
    if($table==='shared_custom_field_receipts')return!$project?'r.space_id=:resource AND r.actor_id=:actor':
        "r.actor_id=:actor AND (json_extract(genesis_content_decrypt(r.receipt_json),'$.projectId')=:resource OR EXISTS(SELECT 1 FROM shared_custom_fields f WHERE f.id=json_extract(genesis_content_decrypt(r.receipt_json),'$.id') AND f.project_id=:resource))";
    if($table==='shared_mutation_receipts')return$project?
        'r.user_id=:actor AND (r.resource_id=:resource OR EXISTS(SELECT 1 FROM shared_tasks t WHERE t.id=r.resource_id AND t.project_id=:resource))':
        'r.user_id=:actor AND r.resource_id=:resource';
    if($table==='shared_bulk_operations')return$project?
        'r.actor_id=:actor AND EXISTS(SELECT 1 FROM shared_bulk_items b WHERE b.operation_id=r.id AND b.project_id=:resource) AND NOT EXISTS(SELECT 1 FROM shared_bulk_items b WHERE b.operation_id=r.id AND b.project_id<>:resource)':
        "r.actor_id=:actor AND json_extract(genesis_content_decrypt(r.payload),'$.spaceId')=:resource AND json_type(genesis_content_decrypt(r.payload),'$.projectIds') IS NULL";
    if($table==='shared_automation_operations')return$project?
        "r.actor_id=:actor AND (json_extract(genesis_content_decrypt(r.result_json),'$.projectId')=:resource OR EXISTS(SELECT 1 FROM shared_automation_rules a WHERE a.id=json_extract(genesis_content_decrypt(r.result_json),'$.id') AND a.project_id=:resource))":
        "r.actor_id=:actor AND json_extract(genesis_content_decrypt(r.result_json),'$.spaceId')=:resource AND json_extract(genesis_content_decrypt(r.result_json),'$.projectId') IS NULL";
    if($table==='shared_template_operations')return$project?
        "r.actor_id=:actor AND (json_extract(genesis_content_decrypt(r.result_json),'$.projectId')=:resource OR EXISTS(SELECT 1 FROM shared_templates t WHERE t.id=json_extract(genesis_content_decrypt(r.result_json),'$.id') AND t.project_id=:resource))":
        "r.actor_id=:actor AND EXISTS(SELECT 1 FROM shared_templates t WHERE t.id=json_extract(genesis_content_decrypt(r.result_json),'$.id') AND t.space_id=:resource AND t.project_id IS NULL)";
    if(!$project)throw new DomainException('E2EE_SOURCE_PATH_FORBIDDEN');
    $direct=['shared_project_statuses','shared_project_categories','shared_tasks','shared_project_comments','shared_project_labels',
        'shared_task_series','shared_project_workflows','shared_project_workflow_versions','shared_automation_rules','shared_audit_events',
        'shared_project_planning','shared_project_review_policies','shared_sprints','shared_trash','shared_bulk_items','shared_task_query_versions','shared_planning_receipts'];
    if(in_array($table,$direct,true))return'r.project_id=:resource';
    $task=['shared_comments','shared_task_labels','shared_task_dependencies','shared_task_planning','shared_task_approvals','shared_task_reviews',
        'shared_custom_field_values','shared_task_watchers','shared_notification_task_state','shared_google_projection_links','shared_task_attachments','shared_task_images'];
    if(in_array($table,$task,true))return'EXISTS(SELECT 1 FROM shared_tasks t WHERE t.id=r.task_id AND t.project_id=:resource)';
    if($table==='shared_comment_mentions')return'EXISTS(SELECT 1 FROM shared_comments c JOIN shared_tasks t ON t.id=c.task_id WHERE c.id=r.comment_id AND t.project_id=:resource)';
    if($table==='shared_series_instances')return'EXISTS(SELECT 1 FROM shared_task_series s WHERE s.id=r.series_id AND s.project_id=:resource)';
    if($table==='shared_automation_runs')return'EXISTS(SELECT 1 FROM shared_automation_rules a WHERE a.id=r.rule_id AND a.project_id=:resource)';
    if($table==='shared_project_imports')return'r.root_project_id=:resource';
    if($table==='shared_task_transfers')return'r.target_project_id=:resource';
    if($table==='shared_workspace_inbox_relocations')return'r.inbox_project_id=:resource OR r.destination_project_id=:resource';
    if($table==='shared_workspace_list_relocations')return'r.project_id=:resource OR r.original_parent_id=:resource OR r.destination_parent_id=:resource';
    if(in_array($table,['shared_workspace_scope_relocations','shared_workspace_task_relocations'],true))return'r.original_project_id=:resource OR r.destination_project_id=:resource';
    throw new DomainException('E2EE_SOURCE_PATH_FORBIDDEN');
}
function genesisE2eePrivatePathParameters(string $where,string $actor,string $resource):array
{
    $parameters=[];if(str_contains($where,':actor'))$parameters['actor']=$actor;if(str_contains($where,':resource'))$parameters['resource']=$resource;return$parameters;
}

function genesisE2eePrivatePathRow(string $table,array $row):array
{
    $opened=$row;
    foreach($opened as$name=>$value)if(is_string($value)&&str_starts_with($value,GENESIS_SHARED_CONTENT_PREFIX)){
        try{$opened[$name]=genesisSharedContentDecrypt($value);}catch(Throwable){throw new DomainException('E2EE_SHARED_SOURCE_CONTENT_UNAVAILABLE');}
    }
    if(in_array($table,['shared_task_attachments','shared_task_images'],true)){
        try{$bytes=genesisDecrypt($row['ciphertext']);$filename=$table==='shared_task_attachments'?genesisDecrypt($row['filename_ciphertext']):'task-image';}
        catch(Throwable){throw new DomainException('E2EE_SHARED_SOURCE_CONTENT_UNAVAILABLE');}
        if(!is_string($bytes)||!is_string($filename)||strlen($bytes)!==(int)$row['byte_size']||strlen($bytes)>64*1024*1024)throw new DomainException('E2EE_SHARED_SOURCE_CONTENT_UNAVAILABLE');
        unset($opened['ciphertext'],$opened['filename_ciphertext']);
        $opened['file']=['encoding'=>'base64url','bytes'=>genesisE2eePrivateSourceEncode($bytes),'length'=>strlen($bytes),'sha256'=>genesisE2eePrivateSourceEncode(hash('sha256',$bytes,true)),
            'filename'=>$filename,'mediaType'=>$row['mime_type']];
    }
    return['original'=>$row,'content'=>$opened,'execution'=>'history-only'];
}

/** One original row is fragmented into bounded responses. Every fragment is
 * reauthorized against the same device, directory, lease and source hash.
 * This is read-only and never restores ACL/billing/sessions or executes jobs. */
function genesisE2eeLegacyPrivatePath(PDO $db,string $actor,array $scope,array $c):array
{
    $p=genesisE2eeExactFields($c['payload'],['migrationId','fence','sourceHash','pathId','table','offset','byteOffset']);
    $catalogue=genesisE2eePrivatePathCatalogue();$path=null;
    foreach($catalogue['paths']as$candidate)if($candidate['id']===$p['pathId']&&$candidate['scope']===$scope['kind'])$path=$candidate;
    if(!$path||!is_string($p['table'])||!in_array($p['table'],$path['server'],true))throw new DomainException('E2EE_SOURCE_PATH_FORBIDDEN');
    $offset=genesisE2eeInteger($p['offset']);$byteOffset=genesisE2eeInteger($p['byteOffset']);if($byteOffset>64*1024*1024)genesisE2eeInvalid();
    $base=$c;$base['payload']=array_intersect_key($p,array_flip(['migrationId','fence','sourceHash']));
    $context=$scope['kind']==='personal'?genesisE2eeLegacyPersonalContext($db,$actor,$scope,$base):genesisE2eeLegacySharedContext($db,$actor,$scope,$base);
    $queries=[];$totals=[];
    foreach($path['server']as$table){
        $schema=null;foreach($catalogue['tables']as$row)if($row['table']===$table)$schema=$row['columns'];
        if(!is_array($schema)||!preg_match('/\A[a-z][a-z_]*\z/D',$table))throw new RuntimeException('E2EE_SOURCE_CATALOGUE_UNAVAILABLE');
        $actual=array_column($db->query('PRAGMA table_info("'.$table.'")')->fetchAll(),'name');
        if($actual!==$schema)throw new DomainException('E2EE_SOURCE_SCHEMA_REVIEW_REQUIRED');
        if(str_contains($p['pathId'],'.mindmaps')){
            $space=$context['spaceId'];genesisE2eeLegacySharedMapLineage($db,$space);$maps=genesisE2eeLegacySharedMapQueries($scope,$space);
            $roles=['shared_mindmaps'=>'maps','shared_mindmap_versions'=>'versions','shared_mindmap_receipts'=>'receipts','shared_mindmap_deletions'=>'deletions','shared_mindmap_deletion_scopes'=>'deletionScopes','shared_mindmap_conversions'=>'conversions'];
            [$sqlTable,,$where,$values,,$integers]=$maps[$roles[$table]];
            $parameters=$values;$positional=true;
        }else{$sqlTable=$table;$where=genesisE2eePrivatePathWhere($scope['kind'],$table);$parameters=genesisE2eePrivatePathParameters($where,$actor,$scope['resource_id']);$positional=false;}
        $columns=implode(',',array_map(static fn(string$name):string=>'r."'.$name.'"',$schema));
        $queries[$table]=[$sqlTable,$columns,$where,$parameters,$positional];
        $q=$db->prepare('SELECT COUNT(*) FROM '.$sqlTable.' r WHERE '.$where);$q->execute($parameters);
        try{$totals[$table]=(int)$q->fetchColumn();}finally{$q->closeCursor();}
    }
    if(array_sum($totals)>1000000||$offset>$totals[$p['table']])throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
    $lease=$context['lease'];$result=['protocol'=>1,'ownerId'=>$actor,'scopeId'=>$scope['scope_id'],'kind'=>$scope['kind'],'resourceId'=>$scope['resource_id'],
        'migrationId'=>$lease['migration_id'],'fence'=>(int)$lease['fence'],'sourceHash'=>$lease['source_hash'],'checkpointHash'=>$scope['checkpoint_hash'],'directoryRevision'=>(int)$scope['directory_revision'],
        'pathId'=>$p['pathId'],'table'=>$p['table'],'offset'=>$offset,'byteOffset'=>$byteOffset,'totals'=>$totals,'rowBytes'=>0,'rowHash'=>null,'chunk'=>'','nextByteOffset'=>null,'nextOffset'=>null];
    if($totals[$p['table']]===0){if($offset!==0||$byteOffset!==0)genesisE2eeInvalid();return$result;}
    if($offset===$totals[$p['table']])genesisE2eeInvalid();
    [$table,$columns,$where,$parameters,$positional]=$queries[$p['table']];
    $q=$db->prepare('SELECT '.$columns.' FROM '.$table.' r WHERE '.$where.' ORDER BY r.rowid LIMIT 1 OFFSET '.(string)$offset);$q->execute($parameters);
    try{$row=$q->fetch();}finally{$q->closeCursor();}if(!$row)throw new DomainException('E2EE_SOURCE_CHANGED');
    $bytes=genesisE2eeJson(genesisE2eePrivatePathRow($table,$row));$length=strlen($bytes);
    if($length<1||$length>64*1024*1024)throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
    if($byteOffset>=$length)genesisE2eeInvalid();$chunk=substr($bytes,$byteOffset,1024*1024);$next=$byteOffset+strlen($chunk);
    return array_replace($result,['rowBytes'=>$length,'rowHash'=>genesisE2eePrivateSourceEncode(hash('sha256',$bytes,true)),'chunk'=>genesisE2eePrivateSourceEncode($chunk),
        'nextByteOffset'=>$next<$length?$next:null,'nextOffset'=>$next<$length?$offset:($offset+1<$totals[$p['table']]?$offset+1:null)]);
}
