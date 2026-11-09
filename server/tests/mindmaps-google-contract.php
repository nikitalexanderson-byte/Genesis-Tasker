<?php
declare(strict_types=1);
// Provider CONTRACT tests with an injected fake, NOT evidence of live Google integration.
if (PHP_SAPI !== 'cli') exit;
$contractDirectory = sys_get_temp_dir() . '/genesis-map-contract-' . bin2hex(random_bytes(8));
if (!mkdir($contractDirectory, 0700)) throw new RuntimeException('Cannot create provider contract fixture');
$GLOBALS['contractDirectory'] = $contractDirectory;
register_shutdown_function(static function () use ($contractDirectory): void {
    foreach (glob($contractDirectory . '/map-create-*.lock') ?: [] as $lock) unlink($lock);
    rmdir($contractDirectory);
});
require __DIR__ . '/../src/mindmaps.php';
class GenesisGoogleHttpException extends RuntimeException { public function __construct(public int $status) { parent::__construct('simulated HTTP ' . $status); } }
class GenesisResourceLimitException extends RuntimeException { public function __construct(public int $status, string $message) { parent::__construct($message); } }
function genesisConfig(): array { return ['db_path' => $GLOBALS['contractDirectory'] . '/memory.sqlite']; }
function genesisDb(): PDO { return $GLOBALS['db']; }
function genesisTaskWasDeleted(string $owner, string $id, array $task): bool { return !empty($GLOBALS['deleteDuringCreate']) && ++$GLOBALS['deletionChecks'] > 1; }
function genesisDeleteGoogleTaskEvent(string $owner, string $id, array $task): void { $GLOBALS['deletionCleanup'] = $task['googleLinks']; }
function genesisUserProvider(array $user): string { return 'google'; }
function genesisResolveTaskTargetAccounts(array $user, array $task): array { return $GLOBALS['targets']; }
function genesisTaskPayloadForGoogle(string $id, array $task): array { return [...$task, 'taskId' => $id]; }
function genesisEnsureGoogleCalendar(array $user): array { return $user; }
function genesisGoogleEventForClient(array $event): array { return ['id' => $event['taskId'], 'title' => $event['title'], 'googleEventId' => $event['id'], 'updatedAt' => 1]; }
function genesisGoogleSnapshotTaskSaved(array $user, array $task): void {}
function genesisTouchUser(string $owner): void {}
function genesisGoogleApi(string $method, string $path, array $user, ?array $payload = null): array {
    $key = $method === 'POST' ? $path . '/' . $payload['id'] : $path;
    $GLOBALS['calls'][] = [$method, $key];
    if ($method === 'GET') {
        if (!isset($GLOBALS['events'][$key])) throw new GenesisGoogleHttpException(404);
        return $GLOBALS['events'][$key];
    }
    if (isset($GLOBALS['events'][$key])) throw new GenesisGoogleHttpException(409);
    $GLOBALS['events'][$key] = $payload;
    if ($GLOBALS['lose']) { $GLOBALS['lose'] = false; throw new RuntimeException('simulated lost response after commit'); }
    return $payload;
}
function expectContract(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
$GLOBALS['db'] = new PDO('sqlite::memory:');
genesisDb()->exec('CREATE TABLE personal_task_creations(user_id TEXT, task_id TEXT, state TEXT, PRIMARY KEY(user_id,task_id))');
$GLOBALS['targets'] = [['id'=>'a','email'=>'a@example.invalid','google_calendar_id'=>'calendar-a'],['id'=>'b','email'=>'b@example.invalid','google_calendar_id'=>'calendar-b']];
$GLOBALS['events'] = []; $GLOBALS['calls'] = []; $GLOBALS['lose'] = true;
$user = ['id'=>'contract-owner']; $task = ['title'=>'First title'];
try { genesisCreatePersonalTaskOnce($user,'stable-task',$task); throw new LogicException('Failure injection did not run'); }
catch (RuntimeException $error) { expectContract($error->getMessage()==='simulated lost response after commit','Unexpected error'); }
$saved = genesisCreatePersonalTaskOnce($user,'stable-task',$task);
expectContract(count($GLOBALS['events'])===2 && count($saved['googleLinks'])===2, 'Partial multi-account attempt lost a target');
expectContract(count(array_filter($GLOBALS['calls'],fn($call)=>$call[0]==='POST'))===2, 'Retry duplicated external creation');
foreach ($GLOBALS['events'] as &$event) $event['title']='Edited in ordinary tasks'; unset($event);
$retried = genesisCreatePersonalTaskOnce($user,'stable-task',['title'=>'Stale conversion form']);
expectContract($retried['title']==='Edited in ordinary tasks','Creation retry overwrote a later edit');
expectContract(count(array_filter($GLOBALS['calls'],fn($call)=>$call[0]==='POST'))===2,'Repeated submit posted another event');
$GLOBALS['targets'] = [$GLOBALS['targets'][0]];
try { genesisCreatePersonalTaskOnce($user,'stable-task',$task); throw new LogicException('Routing change accepted'); } catch(GenesisResourceLimitException $error) { expectContract($error->status===409,'Routing conflict status'); }
$GLOBALS['deleteDuringCreate'] = true; $GLOBALS['deletionChecks'] = 0;
try { genesisCreatePersonalTaskOnce($user,'deleted-during-create',$task); throw new LogicException('Concurrent deletion ignored'); }
catch (DomainException $error) { expectContract($error->getMessage()==='TASK_DELETED' && count($GLOBALS['deletionCleanup'])===1,'Concurrent deletion did not clean up created links'); }
echo "PASS Calendar provider contract simulation: stable event ID, lost response, repeated submit, partial multi-account recovery, no overwrite, routing freeze, concurrent deletion cleanup. Live Google NOT tested.\n";
