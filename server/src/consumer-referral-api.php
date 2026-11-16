<?php
declare(strict_types=1);
require_once __DIR__.'/consumer-referrals.php';

function genesisReferralRoute(string $method,string $path): never
{
    header('Cache-Control: no-store');
    if($path==='referrals/invitation'){
        if($method==='GET')genesisJson(['accepted'=>genesisReferralInvitation()!==null]);
        if($method==='POST'){
            genesisRequireCsrf();genesisConsumeApiBudget('ip:'.($_SERVER['REMOTE_ADDR']??'unknown'),'consumer-invitation',60,65536,(int)($_SERVER['CONTENT_LENGTH']??0));
            $input=genesisReadJson();if(array_diff(array_keys($input),['code'])||!is_string($input['code']??null))throw new InvalidArgumentException('REFERRAL_CODE_INVALID');
            genesisJson(genesisReferralCapture($input['code']));
        }
    }
    $userId=genesisRequireUserId();
    if($method==='GET'&&$path==='referrals/me')genesisJson(genesisReferralDashboard($userId));
    if($method==='POST'){
        genesisRequireCsrf();genesisConsumeApiBudget('user:'.$userId,'consumer-referral',60,65536,(int)($_SERVER['CONTENT_LENGTH']??0));
        if(genesisReadJson()!==[])throw new InvalidArgumentException('REFERRAL_REQUEST_INVALID');
        if($path==='referrals/code')genesisJson(genesisReferralCreateCode($userId));
        if($path==='referrals/redeem')genesisJson(genesisReferralRedeemFreeMonth($userId));
    }
    genesisJson(['error'=>'NOT_FOUND'],404);
}
