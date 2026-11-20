<?php
declare(strict_types=1);
// Isolated synthetic SQLite only. Never load production config or execute old
// backup operations; use the ACTUAL current snapshot exporter and schema.
if(PHP_SAPI!=='cli'||$argc!==3)exit(1);
$root=realpath(dirname(__DIR__,2));$boundary=realpath($root.'/output/release-3.3.6/runtime');
$input=realpath($argv[1]);$directory=realpath($argv[2]);
function fixtureInside(string $path,string $boundary):bool{
    $path=str_replace('\\','/',$path);$boundary=str_replace('\\','/',$boundary);
    if(PHP_OS_FAMILY==='Windows'){$path=strtolower($path);$boundary=strtolower($boundary);}
    return str_starts_with($path,rtrim($boundary,'/').'/');
}
if(!$boundary||!$input||!$directory||!fixtureInside($input,$boundary)||!fixtureInside($directory,$boundary)
    ||preg_match('/\Aarchive-content-qa-[A-Za-z0-9_-]{6,32}\z/D',basename($directory))!==1||count(scandir($directory))!==2)exit(2);
$fixture=json_decode(file_get_contents($input),true,48,JSON_THROW_ON_ERROR);
if(($fixture['ownerId']??null)!=='server-archive-owner'||!is_array($fixture['tables']??null)||!is_array($fixture['operations']??null))exit(3);
mkdir($directory.'/sessions',0700);
$config=['app_url'=>'https://localhost.invalid','db_path'=>$directory.'/db.sqlite','session_path'=>$directory.'/sessions',
    'crypto_key'=>base64_encode(random_bytes(32)),'cookie_secure'=>false,'timezone'=>'UTC'];
file_put_contents($directory.'/config.php','<?php return '.var_export($config,true).';');
define('GENESIS_LOCAL_TEST_CONFIG',$directory.'/config.php');
require $root.'/server/src/bootstrap.php';require $root.'/server/src/repository.php';require $root.'/server/src/backups.php';
if((genesisConfig()['db_path']??null)!==$directory.'/db.sqlite'||(genesisConfig()['app_url']??null)!=='https://localhost.invalid')exit(6);
$db=genesisDb();$owner=$fixture['ownerId'];$now=genesisNow();
$db->prepare('INSERT INTO users(id,google_sub,email,display_name,created_at,updated_at,subscription_plan) VALUES(?,?,?,?,?,?,?)')
    ->execute([$owner,'synthetic-archive-sub','archive@example.invalid','Synthetic archive',$now,$now,'premium4life']);
$allowed=['workspace_blobs','personal_mindmaps','personal_mindmap_versions','personal_mindmap_deletions',
    'personal_diary_notes','personal_diary_deletions','personal_diary_settings','personal_diary_dreams','dream_journal_preferences',
    'stoicheion_workspaces','aurora_workspaces','personal_recovered_tasks','personal_recovered_task_deletions','physis_records'];
if(array_diff(array_keys($fixture['tables']),$allowed)||array_diff($allowed,array_keys($fixture['tables'])))exit(4);
$db->prepare('INSERT INTO physis_owners(owner_id,key_version) VALUES(?,?)')->execute([$owner,3]);
foreach($allowed as $table){
    $columns=array_column($db->query('PRAGMA table_info('.$table.')')->fetchAll(PDO::FETCH_ASSOC),'name');
    foreach($fixture['tables'][$table] as $row){
        if(!is_array($row)||isset($row['user_id'])||isset($row['owner_id'])||array_diff(array_keys($row),$columns))exit(5);
        if($table==='physis_records')$db->prepare('INSERT INTO physis_used_ids(owner_id,id) VALUES(?,?)')->execute([$owner,$row['id']]);
        $row=[$table==='physis_records'?'owner_id':'user_id'=>$owner]+$row;
        $db->prepare('INSERT INTO '.$table.'('.implode(',',array_keys($row)).') VALUES('.implode(',',array_fill(0,count($row),'?')).')')->execute(array_values($row));
    }
}
$snapshot=genesisBackupPersonalRows($owner);
$payload=json_encode($fixture['operations'],JSON_THROW_ON_ERROR|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
// The original server-at-rest wrapper also survives a real encrypt/decrypt
// round trip. No preview/apply/restore/entitlement function is called.
$opened=genesisDecrypt(genesisEncrypt($payload));
echo json_encode(['synthetic'=>true,'ownerId'=>$owner,'tables'=>json_encode($snapshot,JSON_THROW_ON_ERROR|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES),
    'operations'=>$opened],JSON_THROW_ON_ERROR|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
