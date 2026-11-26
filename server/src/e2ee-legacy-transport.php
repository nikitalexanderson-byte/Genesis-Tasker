<?php
declare(strict_types=1);

function genesisE2eeLegacyTransportPolicy(): array
{
    static $policy=null;
    if($policy!==null)return$policy;
    // deploy.yml ships server/ as a unit; repository-root contracts are absent
    // on Hostinger. The canonical contract and this byte copy are checked in QA.
    $value=json_decode((string)file_get_contents(dirname(__DIR__).'/resources/e2ee-legacy-transport-v1.json'),true,32,JSON_THROW_ON_ERROR);
    if(($value['version']??null)!==1)throw new RuntimeException('E2EE_INVALID_TRANSPORT_POLICY');
    foreach(['personalPrefixes','personalExact','metadataPreferenceKeys','privatePreferenceKeys'] as $field) {
        if(!is_array($value[$field]??null)||array_filter($value[$field],static fn($part):bool=>!is_string($part)||!preg_match('~\A[A-Za-z][A-Za-z0-9/-]{0,100}\z~D',$part)))
            throw new RuntimeException('E2EE_INVALID_TRANSPORT_POLICY');
    }
    if(!is_string($value['preferencesPath']??null)||!preg_match('~\A[a-z]+/[a-z-]+\z~D',$value['preferencesPath']))
        throw new RuntimeException('E2EE_INVALID_TRANSPORT_POLICY');
    return$policy=$value;
}
/** Classification only. Never a read/export grant, session or consent proof. */
function genesisE2eePersonalTransportProtected(string $method,string $path,?array $body=null): bool
{
    $policy=genesisE2eeLegacyTransportPolicy();$path=explode('?',ltrim($path,'/'),2)[0];$method=strtoupper($method);
    foreach($policy['personalPrefixes'] as $prefix)if($path===$prefix||str_starts_with($path,$prefix.'/')||str_starts_with($path,$prefix.'-'))return true;
    if(in_array($path,$policy['personalExact'],true))return true;
    return $path===$policy['preferencesPath']&&!in_array($method,['GET','HEAD','OPTIONS'],true)&&$body!==null
        &&array_diff(array_keys($body),$policy['metadataPreferenceKeys'])!==[];
}
