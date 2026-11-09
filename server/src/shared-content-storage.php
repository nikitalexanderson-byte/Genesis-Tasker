<?php
declare(strict_types=1);

// ACLs still apply in the repositories. Content is encrypted at rest with the server key;
// membership, dates, positions and revisions remain indexed relational metadata.
const GENESIS_SHARED_CONTENT_FIELDS = [
    'shared_tasks' => ['title', 'description', 'tags_json', 'checklists_json'],
    'shared_comments' => ['body'],
    'shared_audit_events' => ['details_json'],
];
const GENESIS_SHARED_CONTENT_PREFIX = 'genesis-content-v1:';

function genesisSharedContentDecrypt(?string $value): ?string
{
    if ($value === null || !str_starts_with($value, GENESIS_SHARED_CONTENT_PREFIX)) return $value;
    $plain = genesisDecrypt(substr($value, strlen(GENESIS_SHARED_CONTENT_PREFIX)));
    if ($plain === null) throw new RuntimeException('Shared content authentication failed.');
    return $plain;
}

function genesisSharedContentEncrypt(?string $value): ?string
{
    if ($value === null || $value === '') return $value;
    if (str_starts_with($value, GENESIS_SHARED_CONTENT_PREFIX)) {
        try { if (genesisSharedContentDecrypt($value) !== null) return $value; } catch (Throwable) { /* Literal user text. */ }
    }
    return GENESIS_SHARED_CONTENT_PREFIX . genesisEncrypt($value);
}

function genesisRegisterSharedContentFunctions(PDO $db): void
{
    $db->sqliteCreateFunction('genesis_content_encrypt', 'genesisSharedContentEncrypt', 1);
    $db->sqliteCreateFunction('genesis_content_decrypt', 'genesisSharedContentDecrypt', 1);
    $db->sqliteCreateFunction('genesis_fold', static fn(?string $value): string => str_replace('ё', 'е', mb_strtolower($value ?? '', 'UTF-8')), 1);
}

/** Runs once after migration 043, inside one transaction; CI saves a consistent pre-deploy DB. */
function genesisInitializeSharedContentStorage(PDO $db): void
{
    if ($db->query('SELECT 1 FROM shared_content_storage WHERE version = 1')->fetchColumn() !== false) return;
    $db->beginTransaction();
    try {
        // Serialize first-use initialization across PHP workers.
        $db->exec('INSERT OR IGNORE INTO shared_content_storage (version, initialized_at) VALUES (1, CURRENT_TIMESTAMP)');
        if ((int)$db->query('SELECT changes()')->fetchColumn() === 0) { $db->commit(); return; }
        foreach (GENESIS_SHARED_CONTENT_FIELDS as $table => $fields) {
            $available = array_column($db->query('PRAGMA table_info(' . $table . ')')->fetchAll(PDO::FETCH_ASSOC), 'name');
            $fields = array_values(array_intersect($fields, $available));
            $db->exec('UPDATE ' . $table . ' SET ' . implode(', ', array_map(
                static fn(string $field): string => $field . ' = genesis_content_encrypt(' . $field . ')', $fields)));
            $columns = $db->query('PRAGMA table_info(' . $table . ')')->fetchAll(PDO::FETCH_ASSOC);
            $projection = array_map(static fn(array $column): string => in_array($column['name'], $fields, true)
                ? 'genesis_content_decrypt("' . $column['name'] . '") AS "' . $column['name'] . '"' : '"' . $column['name'] . '"', $columns);
            $db->exec('CREATE VIEW ' . $table . '_read AS SELECT ' . implode(', ', $projection) . ' FROM ' . $table);
            $assignments = implode(', ', array_map(static fn(string $field): string =>
                $field . ' = genesis_content_encrypt(NEW.' . $field . ')', $fields));
            foreach (['INSERT', 'UPDATE OF ' . implode(', ', $fields)] as $index => $event) {
                $db->exec('CREATE TRIGGER ' . $table . '_content_' . $index . ' AFTER ' . $event . ' ON ' . $table
                    . ' BEGIN UPDATE ' . $table . ' SET ' . $assignments . ' WHERE id = NEW.id; END');
            }
        }
        $db->commit();
    } catch (Throwable $error) { if ($db->inTransaction()) $db->rollBack(); throw $error; }
}

/** Explicit, tested forward rollback. Never run automatically against production. */
function genesisRollbackSharedContentStorage(PDO $db): void
{
    $db->beginTransaction();
    try {
        foreach (GENESIS_SHARED_CONTENT_FIELDS as $table => $fields) {
            $available = array_column($db->query('PRAGMA table_info(' . $table . ')')->fetchAll(PDO::FETCH_ASSOC), 'name');
            $fields = array_values(array_intersect($fields, $available));
            foreach ([0, 1] as $index) $db->exec('DROP TRIGGER IF EXISTS ' . $table . '_content_' . $index);
            $db->exec('DROP VIEW IF EXISTS ' . $table . '_read');
            $db->exec('UPDATE ' . $table . ' SET ' . implode(', ', array_map(
                static fn(string $field): string => $field . ' = genesis_content_decrypt(' . $field . ')', $fields)));
        }
        $db->exec('DROP VIEW IF EXISTS shared_tasks_history_read');
        $db->exec('DELETE FROM shared_content_storage');
        $db->commit();
    } catch (Throwable $error) { if ($db->inTransaction()) $db->rollBack(); throw $error; }
}

/** A separate marker upgrades existing encrypted readers without touching their contents. */
function genesisInitializeSharedTrashReadView(PDO $db):void {
 if(!$db->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='shared_trash'")->fetchColumn()||$db->query('SELECT 1 FROM shared_content_storage WHERE version=2')->fetchColumn())return;
 $db->beginTransaction();try{
  $db->exec('INSERT OR IGNORE INTO shared_content_storage VALUES(2,CURRENT_TIMESTAMP)');if((int)$db->query('SELECT changes()')->fetchColumn()===0){$db->commit();return;}
  $columns=$db->query('PRAGMA table_info(shared_tasks)')->fetchAll(PDO::FETCH_ASSOC);
  $projection=array_map(static fn(array $c):string=>in_array($c['name'],GENESIS_SHARED_CONTENT_FIELDS['shared_tasks'],true)?'genesis_content_decrypt("'.$c['name'].'") AS "'.$c['name'].'"':'"'.$c['name'].'"',$columns);
  $db->exec('DROP VIEW shared_tasks_read');$db->exec('CREATE VIEW shared_tasks_read AS SELECT '.implode(', ',$projection)." FROM shared_tasks WHERE NOT EXISTS(SELECT 1 FROM shared_trash tr WHERE tr.kind='task' AND tr.object_id=shared_tasks.id)");
  $db->commit();
 }catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
}

function genesisInitializeSharedMapProjectIndex(PDO $db):void {
 if(!$db->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='shared_mindmaps'")->fetchColumn()||$db->query('SELECT 1 FROM shared_content_storage WHERE version=3')->fetchColumn())return;
 $db->beginTransaction();try{
  $db->exec('INSERT OR IGNORE INTO shared_content_storage VALUES(3,CURRENT_TIMESTAMP)');if((int)$db->query('SELECT changes()')->fetchColumn()===0){$db->commit();return;}
  foreach(['shared_mindmaps','shared_mindmap_versions'] as $table)$db->exec('UPDATE '.$table." SET project_id=(SELECT id FROM shared_projects WHERE id=json_extract(genesis_content_decrypt(content),'$.projectId'))");
  $db->commit();
 }catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
}

/** Additive task fields need refreshed encrypted readers/triggers on already initialized databases. */
function genesisInitializeSharedTaskDetails(PDO $db): void
{
    if ($db->query('SELECT 1 FROM shared_content_storage WHERE version=4')->fetchColumn()) return;
    $db->beginTransaction();
    try {
        $db->exec('INSERT OR IGNORE INTO shared_content_storage VALUES(4,CURRENT_TIMESTAMP)');
        if ((int)$db->query('SELECT changes()')->fetchColumn()===0) { $db->commit(); return; }
        $fields = GENESIS_SHARED_CONTENT_FIELDS['shared_tasks'];
        $db->exec('UPDATE shared_tasks SET checklists_json=genesis_content_encrypt(checklists_json)');
        $columns = $db->query('PRAGMA table_info(shared_tasks)')->fetchAll(PDO::FETCH_ASSOC);
        $projection = array_map(static fn(array $c): string => in_array($c['name'], $fields, true)
            ? 'genesis_content_decrypt("'.$c['name'].'") AS "'.$c['name'].'"' : '"'.$c['name'].'"', $columns);
        $select = 'SELECT '.implode(', ', $projection)." FROM shared_tasks WHERE NOT EXISTS(SELECT 1 FROM shared_trash tr WHERE tr.kind='task' AND tr.object_id=shared_tasks.id)";
        $db->exec('DROP VIEW shared_tasks_read');
        $db->exec('CREATE VIEW shared_tasks_read AS '.$select.' AND archived_at IS NULL');
        $db->exec('CREATE VIEW shared_tasks_history_read AS '.$select);
        $assignments = implode(', ', array_map(static fn(string $field): string => $field.'=genesis_content_encrypt(NEW.'.$field.')', $fields));
        foreach (['INSERT', 'UPDATE OF '.implode(', ', $fields)] as $index=>$event) {
            $db->exec('DROP TRIGGER shared_tasks_content_'.$index);
            $db->exec('CREATE TRIGGER shared_tasks_content_'.$index.' AFTER '.$event.' ON shared_tasks BEGIN UPDATE shared_tasks SET '.$assignments.' WHERE id=NEW.id; END');
        }
        $db->commit();
    } catch (Throwable $error) { if ($db->inTransaction()) $db->rollBack(); throw $error; }
}
