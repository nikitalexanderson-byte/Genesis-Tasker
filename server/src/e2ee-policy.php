<?php
declare(strict_types=1);

/** Fixed inventory of legacy private storage. No billing/identity/session tables. */
const GENESIS_E2EE_LEGACY_TABLES = [
    'workspace_blobs'=>['personal','user_id'], 'categories'=>['personal','user_id'], 'projects'=>['personal','user_id'],
    'tasks'=>['personal','user_id'], 'task_deletions'=>['personal','user_id'],
    'task_links'=>['personal','user_id'], 'user_metrics'=>['personal','user_id'],
    'daily_advice_days'=>['personal','user_id'], 'daily_advice_entries'=>['personal','user_id'], 'daily_advice_extra_entries'=>['personal','user_id'],
    'personal_diary_advice_references'=>['personal','user_id'],
    'habit_reminder_profiles'=>['personal','user_id'], 'habit_reminder_devices'=>['personal','user_id'], 'habit_reminder_deliveries'=>['personal','user_id'],
    'stoicheion_timeline_sessions'=>['personal','user_id'], 'stoicheion_timeline_card_windows'=>['personal','user_id'], 'stoicheion_spread_cards'=>['personal','user_id'],
    'personal_mindmap_receipts'=>['personal','user_id'], 'personal_task_creations'=>['personal','user_id'], 'personal_task_creation_targets'=>['personal','user_id'],
    'personal_mindmaps'=>['personal','user_id'], 'personal_mindmap_versions'=>['personal','user_id'], 'personal_mindmap_deletions'=>['personal','user_id'],
    'personal_diary_notes'=>['personal','user_id'], 'personal_diary_deletions'=>['personal','user_id'], 'personal_diary_settings'=>['personal','user_id'],
    'personal_diary_dreams'=>['personal','user_id'], 'dream_journal_preferences'=>['personal','user_id'],
    'stoicheion_workspaces'=>['personal','user_id'], 'stoicheion_draws'=>['personal','user_id'], 'stoicheion_timeline_draws'=>['personal','user_id'],
    'aurora_workspaces'=>['personal','user_id'], 'physis_owners'=>['personal','owner_id'], 'physis_records'=>['personal','owner_id'],
    'physis_used_ids'=>['personal','owner_id'], 'physis_receipts'=>['personal','owner_id'],
    'future_modeling_results'=>['personal','user_id'],
    'backup_stages'=>['personal','user_id'], 'backup_safety_snapshots'=>['personal','user_id'], 'backup_receipts'=>['personal','user_id'],
    'advice_notification_days'=>['personal','user_id'], 'advice_notification_deliveries'=>['personal','user_id'],
    'shared_notification_preferences'=>['personal','user_id'],
    'shared_mutation_receipts'=>['personal','user_id'], 'shared_bulk_operations'=>['personal','actor_id'],
    'shared_automation_operations'=>['personal','actor_id'], 'shared_template_operations'=>['personal','actor_id'],
    'personal_recovered_tasks'=>['personal','user_id'], 'personal_recovered_task_deletions'=>['personal','user_id'],
    'shared_projects'=>['project','id'], 'shared_project_statuses'=>['project','project_id'], 'shared_project_categories'=>['project','project_id'],
    'shared_tasks'=>['project','project_id'], 'shared_audit_events'=>['project','project_id'], 'shared_project_comments'=>['project','project_id'],
    'shared_task_attachments'=>['project','project_id'], 'shared_task_images'=>['project','project_id'],
    'shared_project_planning'=>['project','project_id'], 'shared_project_workflows'=>['project','project_id'],
    'shared_project_labels'=>['project','project_id'], 'shared_project_review_policies'=>['project','project_id'],
    'shared_task_series'=>['project','project_id'], 'shared_sprints'=>['project','project_id'], 'shared_trash'=>['project','project_id'],
    'shared_project_workflow_versions'=>['project','project_id'], 'shared_bulk_items'=>['project','project_id'],
    'shared_data_import_records'=>['project','project_id'], 'shared_automation_rules'=>['project','project_id'],
    'shared_spaces'=>['space','id'], 'shared_space_labels'=>['space','space_id'], 'shared_space_project_categories'=>['space','space_id'],
    'shared_templates'=>['space','space_id'], 'shared_custom_fields'=>['space','space_id'],
    'shared_space_ui'=>['space','space_id'], 'shared_data_imports'=>['space','space_id'],
    'shared_mindmap_deletions'=>['space','space_id'], 'shared_mindmap_deletion_scopes'=>['space','space_id'],
    'shared_mindmap_conversions'=>['space','space_id'], 'shared_mindmap_receipts'=>['space','space_id'],
    'shared_custom_field_receipts'=>['space','space_id'], 'shared_planning_receipts'=>['project','project_id'],
];

// These fields contain private preferences/references, while the same users row
// also contains independent identity/billing authority which must keep working.
const GENESIS_E2EE_PRIVATE_USER_FIELDS = ['advice_preferences_json','advice_collections_json','advice_notifications_json',
    'advice_psychopompia_json','category_sync_map','ui_visibility_json'];

/** SQL expressions are compile-time constants from the inventory, not requests.
 * A many-valued reference never chooses an arbitrary first project. */
function genesisE2eeLegacyResourceMatch(array $predicate,string $row,string $resource): string
{
    $expression=str_replace('{row}',$row,$predicate[1]);
    return ($predicate[2]??null)==='many'
        ?"EXISTS(SELECT 1 FROM json_each($expression) e2ee_resource WHERE e2ee_resource.type='text' AND e2ee_resource.value=$resource)"
        :"$expression=$resource";
}

/** Old receipts can hold copies of several projects and sometimes have no
 * durable source ID after purge. Preserve the author's personal copy and
 * conservatively fence ALL current project memberships, plus explicit historical
 * references. This is a deny/source-revision superset, never an export grant. */
function genesisE2eeLegacyCopyProjects(string $actor,array $references=[]): string
{
    $selects=["SELECT project_id AS resource FROM shared_project_members WHERE user_id=$actor",...$references];
    return '(SELECT json_group_array(resource) FROM ('.implode(' UNION ',$selects).') WHERE resource IS NOT NULL)';
}

/** Shared by persistent row fences and scope-aware legacy housekeeping. */
function genesisE2eeLegacyFenceCondition(array $predicates,array $rows): string
{
    $checks=[];
    foreach($predicates as $predicate)foreach($rows as $row) {
        $kind=$predicate[0];$match=genesisE2eeLegacyResourceMatch($predicate,$row,'s.resource_id');
        $checks[]="EXISTS(SELECT 1 FROM e2ee_scopes s WHERE s.kind='$kind' AND ($match)
          AND EXISTS(SELECT 1 FROM users WHERE id=s.owner_id)
          AND (s.state IN ('active','retirement') OR EXISTS(SELECT 1 FROM e2ee_migrations m
            WHERE m.scope_id=s.scope_id AND m.lease_until>=CAST(strftime('%s','now') AS INTEGER))))";
    }
    return implode(' OR ',$checks);
}
function genesisE2eeLegacyRowsAvailableSql(string $table,string $alias): string
{
    if(!preg_match('/\A[a-z_][a-z0-9_]*\z/D',$alias))throw new InvalidArgumentException('E2EE_INVALID_SCOPE_FILTER');
    $inventory=genesisE2eeLegacyInventory(genesisDb());
    if(!isset($inventory[$table]))throw new InvalidArgumentException('E2EE_INVALID_SCOPE_FILTER');
    return 'NOT ('.genesisE2eeLegacyFenceCondition($inventory[$table],[$alias]).')';
}
function genesisE2eeLegacyFenceError(Throwable $error): bool
{
    return $error instanceof PDOException && (str_contains($error->getMessage(),'E2EE_LEGACY_WRITE_FORBIDDEN')
        || str_contains($error->getMessage(),'E2EE_ACL_ROTATION_REQUIRED') || str_contains($error->getMessage(),'E2EE_DOWNGRADE_FORBIDDEN'));
}

/** Resolves only constant schema expressions, never a request-controlled identifier. */
function genesisE2eeLegacyInventory(PDO $db): array
{
    $inventory=[];
    foreach(GENESIS_E2EE_LEGACY_TABLES as $table=>[$kind,$column]) {
        $columns=array_column($db->query('PRAGMA table_info("'.$table.'")')->fetchAll(),'name');
        if(in_array($column,$columns,true))$inventory[$table][]=[$kind,'{row}."'.$column.'"'];
    }
    // Tables whose ownership is inherited from a private parent.
    $indirect=[
        'shared_task_attachments'=>[['project','(SELECT project_id FROM shared_tasks WHERE id={row}.task_id)']],
        'shared_task_images'=>[['project','(SELECT project_id FROM shared_tasks WHERE id={row}.task_id)']],
        'shared_comments'=>[['project','(SELECT project_id FROM shared_tasks WHERE id={row}.task_id)']],
        'shared_task_labels'=>[['project','(SELECT project_id FROM shared_tasks WHERE id={row}.task_id)']],
        'shared_task_dependencies'=>[['project','(SELECT project_id FROM shared_tasks WHERE id={row}.task_id)']],
        'shared_custom_field_values'=>[['project','(SELECT project_id FROM shared_tasks WHERE id={row}.task_id)']],
        'shared_task_approvals'=>[['project','(SELECT project_id FROM shared_tasks WHERE id={row}.task_id)']],
        'shared_task_reviews'=>[['project','(SELECT project_id FROM shared_tasks WHERE id={row}.task_id)']],
        'shared_task_planning'=>[['project','(SELECT project_id FROM shared_tasks WHERE id={row}.task_id)']],
        'shared_task_watchers'=>[['project','(SELECT project_id FROM shared_tasks WHERE id={row}.task_id)']],
        'shared_notification_task_state'=>[['project','(SELECT project_id FROM shared_tasks WHERE id={row}.task_id)']],
        'shared_task_query_versions'=>[['project','{row}.project_id']],
        'shared_google_projection_links'=>[['project','(SELECT project_id FROM shared_tasks WHERE id={row}.task_id)']],
        'shared_comment_mentions'=>[['project','(SELECT t.project_id FROM shared_comments c JOIN shared_tasks t ON t.id=c.task_id WHERE c.id={row}.comment_id)']],
        'shared_series_instances'=>[['project','(SELECT project_id FROM shared_task_series WHERE id={row}.series_id)']],
        'shared_automation_runs'=>[['project','(SELECT project_id FROM shared_automation_rules WHERE id={row}.rule_id)']],
        'shared_mindmaps'=>[['space','{row}.space_id'],['project','{row}.project_id']],
        'shared_mindmap_versions'=>[['space','{row}.space_id'],['project','{row}.project_id']],
        'shared_custom_fields'=>[['project','{row}.project_id']], 'shared_templates'=>[['project','{row}.project_id']],
        'shared_custom_field_versions'=>[['space','(SELECT space_id FROM shared_custom_fields WHERE id={row}.field_id)'],['project','(SELECT project_id FROM shared_custom_fields WHERE id={row}.field_id)']],
        'shared_space_ui'=>[['personal','{row}.user_id']],
        'shared_saved_views'=>[['personal',"CASE WHEN {row}.visibility='personal' THEN {row}.owner_id END"],['space',"CASE WHEN {row}.visibility='shared' THEN {row}.space_id END"]],
        'shared_data_import_records'=>[['space','(SELECT space_id FROM shared_data_imports WHERE id={row}.import_id)']],
        'shared_template_sources'=>[['project','{row}.project_id'],['space','(SELECT space_id FROM shared_templates WHERE id={row}.template_id)']],
        'shared_project_imports'=>[['project','{row}.root_project_id'],['personal','{row}.source_user_id']],
        'shared_task_transfers'=>[['project','{row}.target_project_id'],['personal','{row}.source_user_id']],
        'shared_mindmap_deletion_scopes'=>[['project','{row}.project_id']],
        'shared_mindmap_conversions'=>[['project','{row}.project_id']],
        'shared_mindmap_deletions'=>[['project','COALESCE((SELECT project_id FROM shared_mindmaps WHERE space_id={row}.space_id AND id={row}.map_id),(SELECT project_id FROM shared_mindmap_deletion_scopes WHERE space_id={row}.space_id AND map_id={row}.map_id))']],
        'shared_mindmap_receipts'=>[['project','COALESCE((SELECT project_id FROM shared_mindmaps WHERE space_id={row}.space_id AND id={row}.map_id),(SELECT project_id FROM shared_mindmap_deletion_scopes WHERE space_id={row}.space_id AND map_id={row}.map_id))']],
        'shared_bulk_operations'=>[['project',genesisE2eeLegacyCopyProjects('{row}.actor_id',[
            'SELECT project_id FROM shared_bulk_items WHERE operation_id={row}.id',
            "SELECT json_extract(genesis_content_decrypt({row}.payload),'$.action.projectId')",
            "SELECT json_extract(value,'$.projectId') FROM json_each(genesis_content_decrypt({row}.payload),'$.selection.items')",
            "SELECT value FROM json_each(genesis_content_decrypt({row}.payload),'$.selection.filter.projectIds')",
        ]),'many']],
        'shared_automation_operations'=>[['project',genesisE2eeLegacyCopyProjects('{row}.actor_id',[
            "SELECT json_extract(genesis_content_decrypt({row}.result_json),'$.projectId')",
            "SELECT r.project_id FROM shared_automation_runs run JOIN shared_automation_rules r ON r.id=run.rule_id WHERE run.id=json_extract(genesis_content_decrypt({row}.result_json),'$.id')",
        ]),'many']],
        'shared_template_operations'=>[['project',genesisE2eeLegacyCopyProjects('{row}.actor_id',[
            "SELECT value FROM json_each(genesis_content_decrypt({row}.result_json),'$.projectIds')",
            "SELECT json_extract(genesis_content_decrypt({row}.result_json),'$.rootProjectId')",
            "SELECT t.project_id FROM shared_templates t WHERE t.id=COALESCE(json_extract(genesis_content_decrypt({row}.result_json),'$.templateId'),json_extract(genesis_content_decrypt({row}.result_json),'$.id'))",
            "SELECT project_id FROM shared_template_sources WHERE template_id=COALESCE(json_extract(genesis_content_decrypt({row}.result_json),'$.templateId'),json_extract(genesis_content_decrypt({row}.result_json),'$.id'))",
        ]),'many']],
        'shared_mutation_receipts'=>[['project',genesisE2eeLegacyCopyProjects('{row}.user_id',[
            "SELECT json_extract({row}.response_json,'$.projectId')",
            "SELECT json_extract({row}.response_json,'$.project_id')",
            "SELECT {row}.resource_id WHERE {row}.action='status.create' OR {row}.action LIKE 'project.%'",
            'SELECT project_id FROM shared_tasks WHERE id={row}.resource_id',
        ]),'many'],['space',"(SELECT json_group_array(space_id) FROM shared_space_members WHERE user_id={row}.user_id)",'many']],
        'shared_custom_field_receipts'=>[['project','(SELECT json_group_array(id) FROM shared_projects WHERE space_id={row}.space_id)','many'],['personal','{row}.actor_id']],
        'shared_planning_receipts'=>[['personal','{row}.actor_id']],
        'shared_workspace_inbox_relocations'=>[['project','json_array({row}.inbox_project_id,{row}.destination_project_id)','many']],
        'shared_workspace_list_relocations'=>[['project','json_array({row}.project_id,{row}.original_parent_id,{row}.destination_parent_id)','many']],
        'shared_workspace_scope_relocations'=>[['project','json_array({row}.original_project_id,{row}.destination_project_id)','many']],
        'shared_workspace_task_relocations'=>[['project','json_array({row}.original_project_id,{row}.destination_project_id)','many']],
    ];
    $indirect['shared_task_dependencies'][]=['project','(SELECT project_id FROM shared_tasks WHERE id={row}.predecessor_id)'];
    $copiedProjects=$indirect['shared_mutation_receipts'][0][1];
    $indirect['shared_mutation_receipts'][1]=['space',"(SELECT json_group_array(resource) FROM (
      SELECT space_id AS resource FROM shared_space_members WHERE user_id={row}.user_id
      UNION SELECT json_extract({row}.response_json,'$.spaceId')
      UNION SELECT json_extract({row}.response_json,'$.space_id')
      UNION SELECT space_id FROM shared_projects WHERE id IN (SELECT value FROM json_each($copiedProjects))
    ) WHERE resource IS NOT NULL)",'many'];
    // A space migration sees copied child content too. Its source token must not
    // omit multi-project receipt changes during the migration window.
    foreach(['shared_bulk_operations','shared_automation_operations','shared_template_operations'] as $table) {
        $projects=$indirect[$table][0][1];
        $indirect[$table][]=['space',"(SELECT json_group_array(space_id) FROM shared_projects WHERE id IN (SELECT value FROM json_each($projects)))",'many'];
    }
    foreach($indirect as $table=>$definition) {
        $columns=array_column($db->query('PRAGMA table_info("'.$table.'")')->fetchAll(),'name');
        if($columns!==[])foreach($definition as $predicate)$inventory[$table][]=$predicate;
    }
    return $inventory;
}
function genesisE2eeInitializeGuards(PDO $db): void
{
    // Persistent triggers protect CLI/jobs and an older server binary too. Replacing these
    // guards is an additive schema operation; this version marker avoids per-request DDL.
    $marker='e2ee-fence-v3';
    $q=$db->prepare('SELECT 1 FROM schema_migrations WHERE name=?');$q->execute([$marker]);$exists=$q->fetchColumn();$q->closeCursor();if($exists)return;
    genesisBeginWriteTransaction($db);
    try {
        foreach(genesisE2eeLegacyInventory($db) as $table=>$predicates) {
            foreach(['INSERT'=>['NEW'],'UPDATE'=>['OLD','NEW'],'DELETE'=>['OLD']] as $verb=>$rows) {
                $condition=genesisE2eeLegacyFenceCondition($predicates,$rows);
                $name='e2ee_fence_'.$table.'_'.strtolower($verb);
                $db->exec('DROP TRIGGER IF EXISTS "'.$name.'"');
                $db->exec('CREATE TRIGGER "'.$name.'" BEFORE '.$verb.' ON "'.$table.'" WHEN '.$condition." BEGIN SELECT RAISE(ABORT,'E2EE_LEGACY_WRITE_FORBIDDEN'); END");
            }
        }
        // Legacy raw-key and restore generation changes cannot bypass the per-object guards.
        $db->exec('DROP TRIGGER IF EXISTS e2ee_fence_user_keys');
        $db->exec("CREATE TRIGGER e2ee_fence_user_keys BEFORE UPDATE OF workspace_key_mode,workspace_key_enc,workspace_key_wrapped,workspace_key_iv,data_generation ON users
          WHEN EXISTS(SELECT 1 FROM e2ee_scopes s WHERE s.kind='personal' AND s.resource_id=OLD.id AND
            (s.state IN ('active','retirement') OR EXISTS(SELECT 1 FROM e2ee_migrations m WHERE m.scope_id=s.scope_id AND m.lease_until>=CAST(strftime('%s','now') AS INTEGER))))
          AND (NEW.workspace_key_mode IS NOT OLD.workspace_key_mode OR NEW.workspace_key_enc IS NOT OLD.workspace_key_enc
            OR NEW.workspace_key_wrapped IS NOT OLD.workspace_key_wrapped OR NEW.workspace_key_iv IS NOT OLD.workspace_key_iv OR NEW.data_generation IS NOT OLD.data_generation)
          BEGIN SELECT RAISE(ABORT,'E2EE_LEGACY_WRITE_FORBIDDEN'); END");
        $db->exec("CREATE TRIGGER IF NOT EXISTS e2ee_fence_scope_delete BEFORE DELETE ON e2ee_scopes WHEN OLD.state IN ('active','retirement') AND EXISTS(SELECT 1 FROM users WHERE id=OLD.owner_id)
          BEGIN SELECT RAISE(ABORT,'E2EE_DOWNGRADE_FORBIDDEN'); END");
        $db->exec('DROP TRIGGER IF EXISTS e2ee_fence_user_private_preferences');
        $changed=implode(' OR ',array_map(static fn(string $field):string=>"NEW.$field IS NOT OLD.$field",GENESIS_E2EE_PRIVATE_USER_FIELDS));
        $db->exec('CREATE TRIGGER e2ee_fence_user_private_preferences BEFORE UPDATE OF '.implode(',',GENESIS_E2EE_PRIVATE_USER_FIELDS)." ON users
          WHEN ($changed) AND EXISTS(SELECT 1 FROM e2ee_scopes s WHERE s.kind='personal' AND s.resource_id=OLD.id AND
            (s.state IN ('active','retirement') OR EXISTS(SELECT 1 FROM e2ee_migrations m WHERE m.scope_id=s.scope_id AND m.lease_until>=CAST(strftime('%s','now') AS INTEGER))))
          BEGIN SELECT RAISE(ABORT,'E2EE_LEGACY_WRITE_FORBIDDEN'); END");
        // Old invitations, permission editors, jobs and owner succession must not
        // change membership without the matching signed key rotation transaction.
        $acl=['shared_project_members'=>'project_id','shared_space_members'=>'space_id',
          'shared_member_project_grants'=>'space_id','shared_member_categories'=>'space_id'];
        foreach($acl as $table=>$column)foreach(['INSERT'=>['NEW'],'UPDATE'=>['OLD','NEW'],'DELETE'=>['OLD']] as $verb=>$rows) {
            $checks=[];
            foreach($rows as $row) {
                $resource=$row.'.'.$column;
                $affected=$column==='project_id'?"s.kind='project' AND s.resource_id=$resource":
                  "(s.kind='space' AND s.resource_id=$resource OR s.kind='project' AND s.resource_id IN (SELECT id FROM shared_projects WHERE space_id=$resource))";
                $checks[]="EXISTS(SELECT 1 FROM e2ee_scopes s WHERE ($affected) AND EXISTS(SELECT 1 FROM users WHERE id=s.owner_id)
                  AND (s.state IN ('active','retirement') OR EXISTS(SELECT 1 FROM e2ee_migrations m WHERE m.scope_id=s.scope_id AND m.lease_until>=CAST(strftime('%s','now') AS INTEGER))))";
            }
            $name='e2ee_acl_'.$table.'_'.strtolower($verb);$db->exec('DROP TRIGGER IF EXISTS "'.$name.'"');
            $db->exec('CREATE TRIGGER "'.$name.'" BEFORE '.$verb.' ON "'.$table.'" WHEN '.implode(' OR ',$checks)." BEGIN SELECT RAISE(ABORT,'E2EE_ACL_ROTATION_REQUIRED'); END");
        }
        $db->prepare('INSERT OR IGNORE INTO schema_migrations VALUES(?,?)')->execute([$marker,genesisNow()]);
        $db->commit();
    } catch(Throwable $error) {if($db->inTransaction())$db->rollBack();throw$error;}
}

function genesisE2eeSourceHash(PDO $db,array $scope): string
{
    // This is a server-authenticated opaque revision token for LEGACY data, not a public
    // plaintext hash. It never serves as a client key or signs/decrypts E2EE content.
    $hash=hash_init('sha256',HASH_HMAC,(string)genesisConfig()['crypto_key']);$bytes=0;
    if($scope['kind']==='personal') {
        $q=$db->prepare('SELECT workspace_key_mode,workspace_key_enc,workspace_key_wrapped,workspace_key_iv,data_generation,'.implode(',',GENESIS_E2EE_PRIVATE_USER_FIELDS).' FROM users WHERE id=?');
        $q->execute([$scope['resource_id']]);hash_update($hash,'users-legacy-key'."\0".serialize($q->fetch()));$q->closeCursor();
    } else {
        $space=$scope['resource_id'];
        if($scope['kind']==='project') {
            $q=$db->prepare('SELECT space_id FROM shared_projects WHERE id=?');$q->execute([$scope['resource_id']]);$space=$q->fetchColumn();$q->closeCursor();
            $q=$db->prepare('SELECT * FROM shared_project_members WHERE project_id=? ORDER BY user_id');$q->execute([$scope['resource_id']]);
            hash_update($hash,'project-acl'."\0".serialize($q->fetchAll()));$q->closeCursor();
        }
        foreach(['shared_space_members','shared_member_project_grants','shared_member_categories'] as $table) {
            $q=$db->prepare('SELECT * FROM "'.$table.'" WHERE space_id=?');$q->execute([$space]);
            $acl=array_map('serialize',$q->fetchAll());sort($acl,SORT_STRING);$q->closeCursor();
            hash_update($hash,$table."\0".serialize($acl));
        }
    }
    foreach(genesisE2eeLegacyInventory($db) as $table=>$predicates) {
        $matching=array_values(array_filter($predicates,static fn(array $p):bool=>$p[0]===$scope['kind']));if($matching===[])continue;
        $where=implode(' OR ',array_map(static fn(array $p):string=>genesisE2eeLegacyResourceMatch($p,'row','?'),$matching));
        $q=$db->prepare('SELECT * FROM "'.$table.'" AS row WHERE '.$where);$q->execute(array_fill(0,count($matching),$scope['resource_id']));$rows=[];
        while($row=$q->fetch()) {
            $encoded=serialize($row);$bytes+=strlen($encoded);
            if($bytes>128*1024*1024)throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
            $rows[]=$encoded;
        }
        $q->closeCursor();sort($rows,SORT_STRING);hash_update($hash,$table."\0");
        foreach($rows as $encoded)hash_update($hash,pack('N',strlen($encoded)).$encoded);
    }
    return rtrim(strtr(base64_encode(hash_final($hash,true)),'+/','-_'),'=');
}

function genesisE2eeUserState(string $userId): array|false
{
    $q=genesisDb()->prepare("SELECT scope_id,state,directory_revision,crypto_epoch,security_epoch,generation FROM e2ee_scopes WHERE kind='personal' AND resource_id=?");
    $q->execute([$userId]);$row=$q->fetch();$q->closeCursor();return$row;
}
function genesisE2eeRequireLegacyUser(string $userId): void
{
    $scope=genesisE2eeUserState($userId);
    if($scope && in_array($scope['state'],['active','retirement'],true))throw new DomainException('E2EE_UPGRADE_REQUIRED');
}

/** Constant qualified SQL identifiers only; callers never pass request fragments.
 * Filter before LIMIT so protected rows cannot starve unrelated legacy work. */
function genesisE2eeLegacyAvailableSql(string $kind,string $resource): string
{
    if(!in_array($kind,['personal','project','space'],true)||!preg_match('/\A[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*\z/D',$resource))
        throw new InvalidArgumentException('E2EE_INVALID_SCOPE_FILTER');
    $target="s.kind='$kind' AND s.resource_id=$resource";
    if($kind==='project')$target="(($target) OR (s.kind='space' AND s.resource_id=(SELECT e2ee_parent.space_id FROM shared_projects e2ee_parent WHERE e2ee_parent.id=$resource)))";
    return "NOT EXISTS(SELECT 1 FROM e2ee_scopes s WHERE ($target) AND EXISTS(SELECT 1 FROM users WHERE id=s.owner_id)
      AND (s.state IN ('active','retirement') OR EXISTS(SELECT 1 FROM e2ee_migrations m WHERE m.scope_id=s.scope_id AND m.lease_until>=CAST(strftime('%s','now') AS INTEGER))))";
}
function genesisE2eeLegacyScopeBlocked(string $kind,string $resource): bool
{
    $sql=genesisE2eeLegacyAvailableSql($kind,'e2ee_source.resource');
    $q=genesisDb()->prepare('SELECT '.$sql.' FROM (SELECT ? AS resource) e2ee_source');$q->execute([$resource]);$available=$q->fetchColumn();$q->closeCursor();return !$available;
}

/** One deny boundary runs BEFORE route-specific handlers, including early restore routes. */
function genesisE2eeEnforceLegacyRoute(string $method,string $path,?string $userId): void
{
    if($userId===null || str_starts_with($path,'e2ee/v1/'))return;
    // The existing messenger has a separate ciphertext protocol and history.
    // Keep both read and write routes, including its scoped conversation creation.
    if(preg_match('~^shared/(?:private-conversations|messenger|messaging)(?:/|$)|^shared/spaces/[^/]+/private-conversations$~D',$path))return;
    $personal=genesisE2eeUserState($userId);
    $private=preg_match('~^(?:workspace(?:/|$)|bootstrap$|tasks(?:/|$)|task-lists(?:/|$)|diary(?:/|$)|mindmaps(?:/|$)|stoicheion(?:-|/|$)|aurora(?:-|/|$)|physis(?:/|$)|modeling(?:/|$)|habit-reminders(?:/|$)|backup/v1/(?:preview|commit|server-snapshot)$|recovered-tasks(?:/|$))~D',$path);
    if($personal && in_array($personal['state'],['active','retirement'],true) && $private)throw new DomainException('E2EE_UPGRADE_REQUIRED');
    // Future legacy mutation routes fail closed too. These namespaces contain only
    // independently authoritative identity/payment/consent/public metadata operations.
    if($personal && in_array($personal['state'],['active','retirement'],true) && !in_array($method,['GET','HEAD','OPTIONS'],true)
      && !preg_match('~^(?:auth|account|account-recovery|billing|donations|partners|referrals|admin|weather|session)(?:/|$)~D',$path))
        throw new DomainException('E2EE_UPGRADE_REQUIRED');
    // Broad namespace guard includes future bulk/import/restore/private-document routes.
    // Existing messenger ciphertext/history is a separate protocol and remains readable.
    if(str_starts_with($path,'shared/') && !preg_match('~^shared/(?:private-conversations|messenger|messaging)(?:/|$)~D',$path)) {
        $q=genesisDb()->prepare("SELECT 1 FROM e2ee_scopes s WHERE s.state IN ('active','retirement') AND
          (s.kind='project' AND EXISTS(SELECT 1 FROM shared_project_members m WHERE m.project_id=s.resource_id AND m.user_id=?)
           OR s.kind='space' AND EXISTS(SELECT 1 FROM shared_space_members m WHERE m.space_id=s.resource_id AND m.user_id=?)) LIMIT 1");
        $q->execute([$userId,$userId]);$active=$q->fetchColumn();$q->closeCursor();
        if($active)throw new DomainException('E2EE_UPGRADE_REQUIRED');
    }
}
