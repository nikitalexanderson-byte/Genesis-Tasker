<?php
declare(strict_types=1);

/** Cross-process exclusion for a personal legacy request and migration boundary.
 * A lock grants no identity/content access. Every caller still checks SQL policy.
 * All acquisitions are nonblocking: never wait for a file gate under a writer.
 */
final class GenesisE2eePersonalIoPermit
{
    /** @var array<string,array{handle:resource,exclusive:bool,count:int}> */
    private static array $held=[];
    private bool $open=true;
    private function __construct(private readonly string $identity) {}
    public static function acquire(string $owner,bool $exclusive): self
    {
        if($owner===''||strlen($owner)>256)throw new InvalidArgumentException('E2EE_SCOPE_BINDING_MISMATCH');
        $base=realpath(dirname((string)genesisConfig()['db_path']));
        if(!is_string($base))throw new RuntimeException('E2EE_OPERATION_STORAGE_UNAVAILABLE');
        $identity=$base."\0".$owner;
        if(isset(self::$held[$identity])) {
            $held=self::$held[$identity];
            // Neither an in-place upgrade nor legacy IO under migration may
            // silently borrow the other mode. Same-mode nesting borrows safely.
            if($held['exclusive']!==$exclusive)throw new DomainException('E2EE_OPERATION_MODE_CONFLICT');
            self::$held[$identity]['count']++;
            return new self($identity);
        }
        $directory=$base.'/e2ee-io-gates';
        if(is_link($directory)||!is_dir($directory)&&!@mkdir($directory,0700)&&!is_dir($directory))throw new RuntimeException('E2EE_OPERATION_STORAGE_UNAVAILABLE');
        $path=$directory.'/'.hash('sha256',$owner).'.lock';
        if(is_link($path))throw new RuntimeException('E2EE_OPERATION_STORAGE_UNAVAILABLE');
        $handle=@fopen($path,'c+b');
        if($handle===false)throw new RuntimeException('E2EE_OPERATION_STORAGE_UNAVAILABLE');
        try {
            if(is_link($path)||!chmod($path,0600))throw new RuntimeException('E2EE_OPERATION_STORAGE_UNAVAILABLE');
            if(!flock($handle,($exclusive?LOCK_EX:LOCK_SH)|LOCK_NB))throw new DomainException('E2EE_OPERATION_BUSY');
            self::$held[$identity]=['handle'=>$handle,'exclusive'=>$exclusive,'count'=>1];
            return new self($identity);
        } catch(Throwable $error) {fclose($handle);throw $error;}
    }
    public function close(): void
    {
        if(!$this->open)return;$this->open=false;
        if(!isset(self::$held[$this->identity]))throw new LogicException('E2EE_INVALID_OPERATION_PERMIT');
        if(--self::$held[$this->identity]['count']===0) {
            $handle=self::$held[$this->identity]['handle'];unset(self::$held[$this->identity]);
            flock($handle,LOCK_UN);fclose($handle);
        }
    }
    public function __destruct() { $this->close(); }
    public function __debugInfo(): array { return ['type'=>'GenesisE2eePersonalIoPermit']; }
    public function __serialize(): array { throw new LogicException('E2EE_INVALID_OPERATION_PERMIT'); }
    public function __clone() { $this->open=false;throw new LogicException('E2EE_INVALID_OPERATION_PERMIT'); }
    public function __unserialize(array $data): void { $this->open=false;throw new LogicException('E2EE_INVALID_OPERATION_PERMIT'); }
}

function genesisE2eeWithPersonalIo(string $owner,bool $exclusive,callable $operation): mixed
{
    $permit=GenesisE2eePersonalIoPermit::acquire($owner,$exclusive);
    try{return $operation();}finally{$permit->close();}
}

/** Hold the returned capability until the HTTP response/exit. New E2EE routes
 * use their own migration gate; metadata preferences may still be edited after
 * cutover, while their private fields retain the existing SQL write fences. */
function genesisE2eeLegacyRequestGate(string $method,string $path,?string $owner): ?GenesisE2eePersonalIoPermit
{
    if($owner===null||str_starts_with($path,'e2ee/v1/'))return null;
    require_once __DIR__.'/e2ee-legacy-transport.php';
    $private=genesisE2eePersonalTransportProtected($method,$path);
    $preferences=$path===genesisE2eeLegacyTransportPolicy()['preferencesPath']&&!in_array($method,['GET','HEAD','OPTIONS'],true);
    if(!$private&&!$preferences)return null;
    $permit=GenesisE2eePersonalIoPermit::acquire($owner,false);
    try {
        // Recheck after acquisition: a request that waited for its PHP session
        // cannot continue using a policy decision made before a completed cutover.
        genesisE2eeEnforceLegacyRoute($method,$path,$owner);
        if($private&&genesisE2eeLegacyScopeBlocked('personal',$owner))throw new DomainException('E2EE_MIGRATION_FENCED');
        return $permit;
    } catch(Throwable $error) {$permit->close();throw $error;}
}
