<?php
declare(strict_types=1);
if(getenv('GENESIS_IMPROVEMENTS_TEST')!=='isolated')throw new RuntimeException('Isolated synthetic environment required.');
require dirname(__DIR__).'/src/bootstrap.php';
require dirname(__DIR__).'/src/repository.php';
require_once dirname(__DIR__).'/src/e2ee-policy.php';

/** Acceptance compares the entire actual schema, not only the declared fences. */
function schemaDisposition(PDO $db,array $contract): array
{
    if($contract['version']!==1||$contract['schemaThrough']!==141||$contract['productionEnabled']!==false)throw new RuntimeException('E2EE_INVALID_SCHEMA_CONTRACT');
    $groups=array_column($contract['groups'],'id');$declared=[];$private=0;
    foreach($contract['tables'] as $table) {
        if(isset($declared[$table['table']])||!in_array($table['disposition'],$groups,true))throw new RuntimeException('E2EE_INVALID_SCHEMA_CONTRACT');
        $declared[$table['table']]=$table;
    }
    $tables=$db->query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")->fetchAll(PDO::FETCH_COLUMN);
    $expected=array_keys($declared);sort($expected,SORT_STRING);
    if($tables!==$expected)throw new RuntimeException('E2EE_UNCLASSIFIED_SCHEMA_TABLE: new='.implode(',',array_diff($tables,$expected)).'; missing='.implode(',',array_diff($expected,$tables)));
    $inventory=genesisE2eeLegacyInventory($db);
    foreach($declared as $name=>$table) {
        $columns=array_column($db->query('PRAGMA table_info("'.$name.'")')->fetchAll(),'name');
        if($columns!==$table['columns'])throw new RuntimeException('E2EE_UNCLASSIFIED_SCHEMA_COLUMN');
        if(array_diff($table['privateColumns']??[],$columns))throw new RuntimeException('E2EE_INVALID_SCHEMA_CONTRACT');
        if($table['disposition']==='legacy-private') {
            if(!isset($inventory[$name]))throw new RuntimeException('E2EE_UNFENCED_PRIVATE_TABLE: '.$name);
            foreach(['insert','update','delete'] as $verb) {
                $q=$db->prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?");$q->execute(['e2ee_fence_'.$name.'_'.$verb]);$sql=$q->fetchColumn();$q->closeCursor();
                if(!is_string($sql)||!str_contains($sql,'E2EE_LEGACY_WRITE_FORBIDDEN'))throw new RuntimeException('E2EE_MISSING_PRIVATE_FENCE');
            }
            $private++;
        }
    }
    // A private table cannot be relabeled technical merely to bypass this check.
    foreach(array_keys($inventory) as $name)if($declared[$name]['disposition']!=='legacy-private')throw new RuntimeException('E2EE_PRIVATE_SCHEMA_MISCLASSIFIED');
    if($declared['users']['privateColumns']!==GENESIS_E2EE_PRIVATE_USER_FIELDS)throw new RuntimeException('E2EE_PRIVATE_USER_FIELDS_MISMATCH');
    return ['tables'=>count($tables),'privateTables'=>$private];
}
function schemaMustReject(callable $action,string $code): void
{
    try{$action();}catch(RuntimeException $error){if($error->getMessage()===$code||str_starts_with($error->getMessage(),$code.':'))return;throw $error;}
    throw new RuntimeException('Unclassified schema was accepted');
}
$contract=json_decode((string)file_get_contents(dirname(__DIR__,2).'/contracts/e2ee/server-schema-v1.json'),true,128,JSON_THROW_ON_ERROR);
$db=genesisDb();$result=schemaDisposition($db,$contract);
$db->beginTransaction();
try {
    $db->exec('CREATE TABLE synthetic_unclassified_private_copy (id TEXT,payload TEXT)');
    schemaMustReject(fn()=>schemaDisposition($db,$contract),'E2EE_UNCLASSIFIED_SCHEMA_TABLE');
}finally{$db->rollBack();}
$db->beginTransaction();
try {
    $db->exec('ALTER TABLE today_ads ADD COLUMN synthetic_unclassified_private_copy TEXT');
    schemaMustReject(fn()=>schemaDisposition($db,$contract),'E2EE_UNCLASSIFIED_SCHEMA_COLUMN');
}finally{$db->rollBack();}
echo 'PASS e2ee-schema '.$result['tables'].' actual tables classified, '.$result['privateTables'].' private tables fenced; new table/column drift rejected. Product integration/independent crypto review remain pending.'.PHP_EOL;
