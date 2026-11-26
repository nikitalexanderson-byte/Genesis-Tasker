<?php
declare(strict_types=1);
require dirname(__DIR__).'/src/web-push.php';
// Published RFC 8291 Appendix A test material, not application credentials.
$public = genesisPushDecode('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
$private = genesisPushDecode('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw');
$der = hex2bin('30770201010420').$private.hex2bin('a00a06082a8648ce3d030107a144034200').$public;
$key = openssl_pkey_get_private("-----BEGIN EC PRIVATE KEY-----\n".chunk_split(base64_encode($der),64,"\n")."-----END EC PRIVATE KEY-----\n");
if (!$key) throw new RuntimeException('RFC test key failed');
$subscription = ['endpoint'=>'https://fcm.googleapis.com/example','keys'=>['p256dh'=>'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4','auth'=>'BTBZMqHH6r4Tts7J_aSIgg']];
$subscription = genesisPushSubscription($subscription);
$record=genesisPushEncrypt($subscription, genesisPushDecode('V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24'),$key,genesisPushDecode('DGv6ra1nlYgDCS1FRnbzlw'));
$expected=genesisPushDecode('DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8').genesisPushDecode('8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ');
if($record!==$expected)throw new RuntimeException('RFC 8291 output differs');
// SEC1 scalar 43 is deliberately public synthetic test material. Its P-256 Y
// coordinate begins with zero; OpenSSL returns only 31 octets for that field.
$shortDer=hex2bin('30310201010420').str_repeat("\0",31).chr(43).hex2bin('a00a06082a8648ce3d030107');
$shortKey=openssl_pkey_get_private("-----BEGIN EC PRIVATE KEY-----\n".chunk_split(base64_encode($shortDer),64,"\n")."-----END EC PRIVATE KEY-----\n");
if(!$shortKey)throw new RuntimeException('Leading-zero fixture key failed');
$shortDetails=openssl_pkey_get_details($shortKey);$shortPoint=genesisPushPublicPoint($shortDetails);
if(strlen($shortPoint)!==65||$shortPoint[33]!=="\0"||!openssl_pkey_get_public(genesisPushPublicPem($shortPoint)))throw new RuntimeException('Leading-zero SEC1 point malformed');
$shortRecord=genesisPushEncrypt($subscription,'synthetic leading-zero regression',$shortKey,str_repeat("\x01",16));
if(substr($shortRecord,21,65)!==$shortPoint)throw new RuntimeException('Leading-zero Web Push record header malformed');
// This peer derives the same shared secret from the encoded server point.
$shortPeer=openssl_pkey_get_public(genesisPushPublicPem(genesisPushDecode($subscription['keys']['p256dh'])));
if(!$shortPeer||strlen(openssl_pkey_derive($shortPeer,$shortKey,32))!==32)throw new RuntimeException('Leading-zero point derive failed');
foreach([['ec'=>['curve_name'=>'secp384r1','x'=>'x','y'=>'y']],['ec'=>['curve_name'=>'prime256v1','x'=>str_repeat('x',33),'y'=>'y']]]as $badDetails){
    try{genesisPushPublicPoint($badDetails);throw new LogicException('Invalid point details accepted');}catch(RuntimeException $error){if($error->getMessage()!=='PUSH_CRYPTO_FAILED')throw $error;}
}
$jwt='header.claims';$sig='';if(!openssl_sign($jwt,$sig,$key,OPENSSL_ALGO_SHA256)||strlen(genesisPushJwtSignature($sig))!==64)throw new RuntimeException('JWT signature conversion failed');
foreach(['https://127.0.0.1/test','https://fcm.googleapis.com.evil.invalid/a','http://fcm.googleapis.com/a','https://fcm.googleapis.com:444/a','https://a:f@fcm.googleapis.com/a']as$bad){try{genesisPushEndpoint($bad);throw new RuntimeException('Unsafe push endpoint accepted');}catch(InvalidArgumentException){}}
echo "Web Push: RFC8291 Appendix A exact ciphertext/header, JWT signature and endpoint boundaries passed; no external messages sent.\n";
