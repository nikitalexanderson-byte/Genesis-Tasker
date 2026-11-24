<?php
declare(strict_types=1);

// Pure differential acceptance only: no configuration, database, network or keys.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once dirname(__DIR__, 2).'/server/src/e2ee-envelope.php';
require_once dirname(__DIR__, 2).'/server/src/e2ee-commands.php';
require_once dirname(__DIR__, 2).'/server/src/e2ee-store.php';
require_once dirname(__DIR__, 2).'/server/src/e2ee-membership-atomic-contract.php';
$raw=stream_get_contents(STDIN,16*1024*1024+1);
if(!is_string($raw)||strlen($raw)>16*1024*1024)throw new RuntimeException('SYNTHETIC_INPUT_LIMIT');
$input=json_decode($raw,true,64,JSON_THROW_ON_ERROR);
try{
    if(($input['kind']??null)==='atomic'){
        $plan=genesisMembershipAtomicPlan($input['plan']);$refs=[];
        foreach($input['pages'] as $index=>$page)$refs[]=genesisMembershipAtomicPageRef($index,$page);
        echo json_encode(['ok'=>true,'planHash'=>genesisMembershipAtomicDigest($plan),
            'changeHash'=>genesisMembershipAtomicChangeHash($plan),'refs'=>$refs],JSON_THROW_ON_ERROR);
        exit;
    }
    $plan=genesisMembershipOperationPlan($input['snapshot'],$input['operation']);
    $fingerprint=genesisMembershipOperationFingerprint($input['snapshot'],$input['operation']);
    echo json_encode(['ok'=>true,'plan'=>$plan,'fingerprint'=>$fingerprint],JSON_THROW_ON_ERROR|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
}catch(Throwable $error){
    $code=$error->getMessage();
    if(preg_match('/\A[A-Z][A-Z0-9_]{1,100}\z/D',$code)!==1)throw $error;
    echo json_encode(['ok'=>false,'error'=>$code],JSON_THROW_ON_ERROR);
}
