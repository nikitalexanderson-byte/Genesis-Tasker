<?php
declare(strict_types=1);
require_once __DIR__.'/billing-gateways.php';

/** Transport diagnostics only. This boundary cannot create orders or grant access. */
function genesisBillingLemonTestProof(string $raw, string $signature, array $configuration, int $now): array
{
    $expires=$configuration['expires_at']??null;
    if (($configuration['enabled']??null)!==true || ($configuration['test_mode']??null)!==true
        || !is_string($configuration['api_key']??null) || trim($configuration['api_key'])===''
        || !is_string($configuration['store_id']??null) || !ctype_digit($configuration['store_id'])
        || !is_string($configuration['webhook_secret']??null) || strlen($configuration['webhook_secret'])<32
        || !is_string($expires) || preg_match('/\A\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\z/D',$expires)!==1
        || strtotime($expires)===false || strtotime($expires)<=$now)
        throw new GenesisResourceLimitException(503,'BILLING_TEST_NOT_CONFIGURED');
    $event=genesisBillingLemonEvent($raw,$signature,$configuration);
    $name=$event['meta']['event_name']??null;$row=$event['data']['attributes']??[];$id=$event['data']['id']??null;
    if (!in_array($name,['order_created','order_refunded'],true) || !is_string($id) || !ctype_digit($id)
        || ($row['test_mode']??null)!==true
        || (array_key_exists('test_mode',$event['meta']) && $event['meta']['test_mode']!==true)
        || (string)($row['store_id']??'')!==$configuration['store_id'])
        throw new DomainException('BILLING_TEST_EVENT_INVALID');
    // Keep a bounded diagnostic, never customer fields, raw payloads, signatures or secrets.
    return ['testMode'=>true,'signatureVerified'=>true,'eventName'=>$name,
        'payloadSha256'=>hash('sha256',$raw),'providerReferenceSha256'=>hash('sha256',$id),
        'receivedAt'=>gmdate('Y-m-d\TH:i:s\Z',$now),'entitlementsChanged'=>false];
}

function genesisBillingLemonTestWebhook(string $raw, string $signature): void
{
    $path=genesisRoot().'/var/billing-test/credentials.php';
    $configuration=is_file($path)?require $path:[];
    $proof=genesisBillingLemonTestProof($raw,$signature,is_array($configuration)?$configuration:[],time());
    $directory=genesisRoot().'/var/billing-test';genesisEnsureDirectory($directory);
    $temporary=$directory.'/'.bin2hex(random_bytes(16)).'.tmp';
    try {
        if (file_put_contents($temporary,json_encode($proof,JSON_THROW_ON_ERROR)."\n",LOCK_EX)===false)
            throw new RuntimeException('Cannot save billing test diagnostic.');
        chmod($temporary,0600);
        if (!rename($temporary,$directory.'/lemon-latest.json')) throw new RuntimeException('Cannot apply billing test diagnostic.');
    } finally { if (is_file($temporary)) unlink($temporary); }
}
