<?php
declare(strict_types=1);
// One real competing process; it sees only a synthetic DB path and owner ID.
if(PHP_SAPI!=='cli'||getenv('GENESIS_FULL_QA')!=='isolated'||count($argv)!==4)exit(97);
function genesisConfig():array{return ['db_path'=>$GLOBALS['argv'][1]];}
require dirname(__DIR__,2).'/server/src/e2ee-personal-io-gate.php';
try {
    $permit=GenesisE2eePersonalIoPermit::acquire($argv[2],$argv[3]==='exclusive');
    echo "ACQUIRED\n";$permit->close();
} catch(DomainException $error) {echo $error->getMessage()."\n";}
