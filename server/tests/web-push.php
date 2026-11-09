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
$jwt='header.claims';$sig='';if(!openssl_sign($jwt,$sig,$key,OPENSSL_ALGO_SHA256)||strlen(genesisPushJwtSignature($sig))!==64)throw new RuntimeException('JWT signature conversion failed');
foreach(['https://127.0.0.1/test','https://fcm.googleapis.com.evil.invalid/a','http://fcm.googleapis.com/a','https://fcm.googleapis.com:444/a','https://a:f@fcm.googleapis.com/a']as$bad){try{genesisPushEndpoint($bad);throw new RuntimeException('Unsafe push endpoint accepted');}catch(InvalidArgumentException){}}
echo "Web Push: RFC8291 Appendix A exact ciphertext/header, JWT signature and endpoint boundaries passed; no external messages sent.\n";
