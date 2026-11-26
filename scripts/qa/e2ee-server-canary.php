<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') exit(1);
$options=getopt('',['dir:','canary:']);
$directory=realpath((string)($options['dir']??''));
$boundary=realpath(getcwd().'/output');
$canary=(string)($options['canary']??'');
if (!$directory || !$boundary || !str_starts_with(strtolower(str_replace('\\','/',$directory)),strtolower(str_replace('\\','/',$boundary)).'/')
    || !preg_match('/\APRIVATE-PRODUCT-[a-f0-9-]{36}\z/D',$canary)) throw new RuntimeException('Explicit owned synthetic runtime required');
$directory=str_replace('\\','/',$directory);
$owner=json_decode(file_get_contents($directory.'/owner.json'),true,16,JSON_THROW_ON_ERROR);
if (($owner['synthetic']??null)!==true || ($owner['directory']??null)!==$directory
    || !hash_equals((string)($owner['configSha256']??''),hash_file('sha256',$directory.'/config.php'))) throw new RuntimeException('Synthetic ownership check failed');
$config=require $directory.'/config.php';
if (str_replace('\\','/',(string)realpath($config['db_path']))!==$directory.'/genesis.sqlite') throw new RuntimeException('Synthetic database boundary failed');
$db=new PDO('sqlite:'.$config['db_path'],null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
$db->exec('PRAGMA query_only=ON');
$tables=$db->query("SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 'e2ee_*' ORDER BY name")->fetchAll(PDO::FETCH_COLUMN);
if (!$tables) throw new RuntimeException('No new-generation tables');
$report=['synthetic'=>true,'status'=>'PASS','scope'=>'Raw values in new-generation e2ee_* SQL tables; no legacy table or private client-state read','tables'=>[],'rows'=>0,'bytes'=>0];
foreach ($tables as $table) {
    if (!preg_match('/\Ae2ee_[a-z0-9_]+\z/D',$table)) throw new RuntimeException('Unexpected SQL identifier');
    $query=$db->query('SELECT * FROM "'.$table.'"');$count=0;
    while ($row=$query->fetch(PDO::FETCH_ASSOC)) {
        $count++;$report['rows']++;
        foreach ($row as $column=>$value) if (is_string($value)) {
            $report['bytes']+=strlen($value);
            if ($report['bytes']>512*1024*1024 || $report['rows']>1_000_000) throw new RuntimeException('Synthetic scan limit; incomplete scans are not accepted');
            if (str_contains($value,$canary)) throw new RuntimeException('PRIVATE_CANARY_IN_NEW_TABLE:'.$table.':'.$column);
        }
    }
    $report['tables'][]=['table'=>$table,'rows'=>$count];
}
$report['limitations']=['Presence scan of the exact synthetic marker, not a proof of arbitrary plaintext absence or cryptanalysis.','Old server-readable legacy copies and approved retention are outside this scan.'];
echo json_encode($report,JSON_PRETTY_PRINT|JSON_THROW_ON_ERROR),PHP_EOL;
