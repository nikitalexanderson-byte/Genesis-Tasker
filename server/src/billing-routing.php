<?php
declare(strict_types=1);

/** Payment ordering is a convenience hint, never an authorization or compliance decision. */
function genesisBillingIpInCidr(string $packed, string $cidr): bool
{
    [$network,$prefix]=array_pad(explode('/',$cidr,2),2,null);
    $bytes=@inet_pton($network);$bits=filter_var($prefix,FILTER_VALIDATE_INT);
    if($bytes===false||strlen($bytes)!==strlen($packed)||$bits===false||$bits<0||$bits>strlen($bytes)*8)return false;
    $whole=intdiv($bits,8);$rest=$bits%8;
    return substr($packed,0,$whole)===substr($bytes,0,$whole)
        &&($rest===0||((ord($packed[$whole])^ord($bytes[$whole]))&(255<<(8-$rest)))===0);
}

function genesisBillingPublicIp(string $ip): ?string
{
    $packed=@inet_pton($ip);if($packed===false)return null;
    if(strlen($packed)===16&&substr($packed,0,12)===str_repeat("\0",10)."\xff\xff")$ip=inet_ntop(substr($packed,12));
    if(!filter_var($ip,FILTER_VALIDATE_IP,FILTER_FLAG_NO_PRIV_RANGE|FILTER_FLAG_NO_RES_RANGE))return null;
    $packed=inet_pton($ip);
    foreach(['100.64.0.0/10','192.0.0.0/24','192.0.2.0/24','198.18.0.0/15','198.51.100.0/24','203.0.113.0/24','224.0.0.0/4','240.0.0.0/4','2001:db8::/32','ff00::/8'] as $range)
        if(genesisBillingIpInCidr($packed,$range))return null;
    return $ip;
}

/** Offline allocation data. No user's IP is sent to a geolocation service or stored here. */
function genesisBillingRussianIp(string $ip): bool
{
    static $buckets=null;
    if($buckets===null){
        $buckets=[];
        foreach(['ru-ipv4.zone','ru-ipv6.zone'] as $file){
            $rows=file(dirname(__DIR__).'/resources/billing-location/'.$file,FILE_IGNORE_NEW_LINES|FILE_SKIP_EMPTY_LINES);
            if($rows===false)continue;
            foreach($rows as $row){
                [$network,$prefix]=explode('/',$row,2);$packed=@inet_pton($network);
                if($packed===false)continue;
                $key=strlen($packed).':'.((int)$prefix>=8?ord($packed[0]):'*');
                $buckets[$key][]=$row;
            }
        }
    }
    $packed=inet_pton($ip);$family=strlen($packed).':';
    foreach([...($buckets[$family.ord($packed[0])]??[]),...($buckets[$family.'*']??[])] as $cidr)
        if(genesisBillingIpInCidr($packed,$cidr))return true;
    return false;
}

function genesisBillingRouting(array $server): array
{
    // HTTP_X_FORWARDED_FOR, HTTP_CF_IPCOUNTRY and other client-supplied headers are deliberately ignored.
    $ip=genesisBillingPublicIp(is_string($server['REMOTE_ADDR']??null)?$server['REMOTE_ADDR']:'');
    $region=$ip===null?'unknown':(genesisBillingRussianIp($ip)?'RU':'outside-RU');
    return ['region'=>$region,'source'=>$ip===null?'unknown':'ip',
        'preferredProvider'=>$region==='RU'?'yookassa':'lemon-squeezy','dataRevision'=>'2026-11-01'];
}
