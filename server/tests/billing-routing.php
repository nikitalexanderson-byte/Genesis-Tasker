<?php
declare(strict_types=1);
require_once dirname(__DIR__).'/src/billing-routing.php';
function checkRoute(bool $condition,string $message):void{if(!$condition)throw new RuntimeException($message);}
foreach(['213.180.193.3','77.88.8.8','2a02:6b8::1','::ffff:77.88.8.8'] as $ip){
    $route=genesisBillingRouting(['REMOTE_ADDR'=>$ip]);
    checkRoute($route['region']==='RU'&&$route['preferredProvider']==='yookassa','RU IPv4/IPv6/mapped routing');
    checkRoute(!isset($route['ip']),'IP must not enter public response');
}
foreach(['8.8.8.8','1.1.1.1','2001:4860:4860::8888'] as $ip){
    $route=genesisBillingRouting(['REMOTE_ADDR'=>$ip,'HTTP_CF_IPCOUNTRY'=>'RU','HTTP_X_FORWARDED_FOR'=>'77.88.8.8']);
    checkRoute($route['region']==='outside-RU'&&$route['preferredProvider']==='lemon-squeezy','Public outside IP; ignore spoofed proxy headers');
}
foreach(['','invalid','127.0.0.1','::1','192.168.1.1','10.0.0.1','100.64.0.1','203.0.113.4','198.51.100.9','2001:db8::1','ff02::1','224.0.0.1'] as $ip)
    checkRoute(genesisBillingRouting(['REMOTE_ADDR'=>$ip])['region']==='unknown','Private/reserved IP is not a location: '.$ip);
checkRoute(genesisBillingIpInCidr(inet_pton('77.88.0.0'),'77.88.0.0/18'),'Range first address');
checkRoute(genesisBillingIpInCidr(inet_pton('77.88.63.255'),'77.88.0.0/18'),'Range last address');
checkRoute(!genesisBillingIpInCidr(inet_pton('77.88.64.0'),'77.88.0.0/18'),'Range next address');
checkRoute(!genesisBillingIpInCidr(inet_pton('8.8.8.8'),'::/0'),'IPv4 never matches IPv6');
checkRoute(!genesisBillingIpInCidr(inet_pton('8.8.8.8'),'8.8.8.0/33'),'Invalid prefix');
$data=dirname(__DIR__).'/resources/billing-location/';$manifest=json_decode(file_get_contents($data.'source.json'),true,32,JSON_THROW_ON_ERROR);
foreach($manifest['sources'] as $name=>$source)checkRoute(hash_file('sha256',$data.$name)===$source['sha256'],'Source dataset integrity');
echo "Billing location ordering: PASS (offline IPv4/IPv6, spoof resistance, reserved ranges, CIDR edges, source integrity)\n";
