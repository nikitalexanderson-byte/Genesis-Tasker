<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli'||getenv('GENESIS_FULL_QA')!=='isolated'||count($argv)!==2)exit(97);
// Only the isolated suite passes an already-created synthetic lock path.
$handle=fopen($argv[1],'r+b');
if($handle===false||!flock($handle,LOCK_EX|LOCK_NB))exit(98);
echo "LOCKED\n";fflush(STDOUT);fgets(STDIN);
flock($handle,LOCK_UN);fclose($handle);
