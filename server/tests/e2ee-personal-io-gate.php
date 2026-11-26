<?php
declare(strict_types=1);
require __DIR__.'/e2ee-legacy-workspace.php';

function ioGateProbe(string $id,bool $exclusive):string
{
    $process=proc_open([PHP_BINARY,dirname(__DIR__,2).'/scripts/qa/e2ee-io-gate-probe.php',(string)genesisConfig()['db_path'],$id,$exclusive?'exclusive':'shared'],
        [0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes,null,null,['bypass_shell'=>true]);
    if(!is_resource($process))throw new RuntimeException('Synthetic gate probe did not start');
    fclose($pipes[0]);$out=stream_get_contents($pipes[1]);fclose($pipes[1]);$err=stream_get_contents($pipes[2]);fclose($pipes[2]);
    storeCheck(proc_close($process)===0&&$err==='');return trim($out);
}
$id='synthetic-owner-io-gate';$foreign='synthetic-other-owner-io-gate';
$outer=GenesisE2eePersonalIoPermit::acquire($id,false);$nested=GenesisE2eePersonalIoPermit::acquire($id,false);
storeCheck(ioGateProbe($id,true)==='E2EE_OPERATION_BUSY');
storeCheck(ioGateProbe($id,false)==='ACQUIRED');
storeCheck(ioGateProbe($foreign,true)==='ACQUIRED');
storeReject(fn()=>GenesisE2eePersonalIoPermit::acquire($id,true),'E2EE_OPERATION_MODE_CONFLICT');
storeReject(fn()=>clone $outer,'E2EE_INVALID_OPERATION_PERMIT');
storeReject(fn()=>serialize($outer),'E2EE_INVALID_OPERATION_PERMIT');
$outer->close();$outer->close();storeCheck(ioGateProbe($id,true)==='E2EE_OPERATION_BUSY');
$nested->close();storeCheck(ioGateProbe($id,true)==='ACQUIRED');
$exclusive=GenesisE2eePersonalIoPermit::acquire($id,true);$borrowed=GenesisE2eePersonalIoPermit::acquire($id,true);
storeCheck(ioGateProbe($id,false)==='E2EE_OPERATION_BUSY');storeCheck(ioGateProbe($id,true)==='E2EE_OPERATION_BUSY');
storeReject(fn()=>GenesisE2eePersonalIoPermit::acquire($id,false),'E2EE_OPERATION_MODE_CONFLICT');
$exclusive->close();storeCheck(ioGateProbe($id,false)==='E2EE_OPERATION_BUSY');$borrowed->close();storeCheck(ioGateProbe($id,false)==='ACQUIRED');
storeReject(static fn()=>genesisE2eeWithPersonalIo($id,true,static fn()=>throw new DomainException('SYNTHETIC_CRASH')),'SYNTHETIC_CRASH');
storeCheck(ioGateProbe($id,true)==='ACQUIRED');
storeReject(fn()=>GenesisE2eePersonalIoPermit::acquire('',true),'E2EE_SCOPE_BINDING_MISMATCH');
storeReject(fn()=>GenesisE2eePersonalIoPermit::acquire(str_repeat('a',257),false),'E2EE_SCOPE_BINDING_MISMATCH');
// Redacted object inspection carries neither owner nor a filesystem path.
$held=GenesisE2eePersonalIoPermit::acquire($id,false);ob_start();var_dump($held);$debug=ob_get_clean();storeCheck(!str_contains($debug,$id)&&!str_contains($debug,(string)genesisConfig()['db_path']));$held->close();

// Actual signed command/read wrappers take the gate before their SQLite writer.
$f=legacyWorkspaceFixture();$packet=storeCommand('legacy-workspace',$f['payload']);
$held=GenesisE2eePersonalIoPermit::acquire($owner,false);
storeReject(fn()=>genesisE2eeRead($owner,$packet,$session),'E2EE_OPERATION_MODE_CONFLICT');storeCheck(!$db->inTransaction());
storeReject(fn()=>genesisE2eeExecute($owner,storeCommand('migration-resume',$f['payload']),$session),'E2EE_OPERATION_MODE_CONFLICT');storeCheck(!$db->inTransaction());
storeReject(fn()=>genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId)),'E2EE_OPERATION_MODE_CONFLICT');$held->close();
storeCheck(genesisE2eeRead($owner,$packet,$session)['ownerId']===$owner);
foreach(['bootstrap','tasks/one','sync/tasks','diary','mindmaps','assistant/plan']as $path)
    storeReject(fn()=>genesisE2eeLegacyRequestGate('GET',$path,$owner),'E2EE_MIGRATION_FENCED');
storeCheck(ioGateProbe($owner,true)==='ACQUIRED');
storeCheck(genesisE2eeLegacyRequestGate('POST','billing/orders',$owner)===null);
storeCheck(genesisE2eeLegacyRequestGate('POST','e2ee/v1/command',$owner)===null);
storeCheck(genesisE2eeLegacyRequestGate('GET','bootstrap',null)===null);
$db->prepare("UPDATE e2ee_scopes SET state='active' WHERE scope_id=?")->execute([$scopeId]);
storeReject(fn()=>genesisE2eeLegacyRequestGate('GET','sync/tasks',$owner),'E2EE_UPGRADE_REQUIRED');
$metadata=genesisE2eeLegacyRequestGate('PUT','account/preferences',$owner);storeCheck($metadata instanceof GenesisE2eePersonalIoPermit);$metadata->close();
storeCheck(ioGateProbe($owner,true)==='ACQUIRED');

// Ordinary legacy requests retain their operation capability until explicit
// response teardown; their nested owner work cannot release the outer gate.
$legacy='io-legacy-'.bin2hex(random_bytes(5));$now=genesisNow();
$db->prepare('INSERT INTO users(id,google_sub,email,created_at,updated_at) VALUES(?,?,?,?,?)')->execute([$legacy,$legacy,$legacy.'@example.invalid',$now,$now]);
$request=genesisE2eeLegacyRequestGate('GET','sync/tasks',$legacy);storeCheck($request instanceof GenesisE2eePersonalIoPermit);
genesisE2eeWithPersonalIo($legacy,false,static function()use($legacy):void{storeCheck(ioGateProbe($legacy,true)==='E2EE_OPERATION_BUSY');});
storeCheck(ioGateProbe($legacy,true)==='E2EE_OPERATION_BUSY');$request->close();storeCheck(ioGateProbe($legacy,true)==='ACQUIRED');

echo 'PASS e2ee-personal-io-gate '.$checks.' cumulative assertions; real process locks, owner separation, same-mode borrowing, no self-upgrade, before-writer denial and request/cutover lifetime'.PHP_EOL;
