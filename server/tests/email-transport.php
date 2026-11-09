<?php
declare(strict_types=1);

// Standalone: no private configuration, database or external delivery.
require_once __DIR__.'/../src/email-transport.php';

$assertions=0;
function transportExpect(bool $condition,string $message):void
{
    global $assertions;
    $assertions++;
    if(!$condition)throw new RuntimeException($message);
}

$values=[
    '',
    'GENESIS',
    'Подтвердите регистрацию в GENESIS',
    'Επιβεβαιώστε την εγγραφή σας στο GENESIS',
    'Bestätigen Sie Ihre Registrierung bei GENESIS',
    'Підтвердьте реєстрацію в GENESIS',
    'GENESIS への登録を確認してください',
    '确认您在 GENESIS 的注册',
    str_repeat('A',41).'👋'.str_repeat('B',43),
    str_repeat('GENESIS · Проверка 👋 ',30),
    '  '.str_repeat('имя отправителя с пробелами ',20).'  ',
    str_repeat('a',42)."e\u{0301}".str_repeat('b',42),
];
foreach($values as $value){
    $encoded=genesisEmailEncodeHeader($value);
    if($value===''){
        transportExpect($encoded==='','Empty header gained an invalid encoded word');
        continue;
    }
    $words=explode("\r\n ",$encoded);$decoded='';
    foreach($words as $word){
        transportExpect(strlen($word)<=75,'RFC 2047 word exceeds 75 bytes');
        transportExpect(preg_match('/\A=\?UTF-8\?B\?([A-Za-z0-9+\/]+=*)\?=\z/D',$word,$matches)===1,'Invalid encoded-word syntax or folding');
        $chunk=base64_decode($matches[1],true);
        transportExpect($chunk!==false&&preg_match('//u',$chunk)===1,'A UTF-8 character was split');
        $decoded.=$chunk;
    }
    transportExpect($decoded===$value,'Header lost characters or meaningful whitespace');
    foreach(explode("\r\n",'Subject: '.$encoded) as $line){
        transportExpect(strlen($line)<=78,'Subject line exceeds the recommended 78 bytes');
    }
}

foreach(["title\r\nBcc: another@example.invalid","title\nnext","title\0tail","title\ttail","title\x7Ftail","invalid\xC3\x28"] as $invalid){
    foreach(['encoder','send'] as $entry){
        $rejected=false;
        try{
            if($entry==='encoder')genesisEmailEncodeHeader($invalid);
            else genesisEmailSend('recipient@example.invalid',$invalid,'Fixture','fixture');
        }catch(InvalidArgumentException){$rejected=true;}
        transportExpect($rejected,'Invalid header accepted by '.$entry);
    }
}

$html=genesisEmailHtml('<script>','A&B', 'https://genesis.test/?x="&y=1','<Confirm>','<Footer>');
transportExpect(str_contains($html,'&lt;script&gt;')&&!str_contains($html,'<script>'),'Title HTML was not escaped');
transportExpect(str_contains($html,'A&amp;B')&&str_contains($html,'&lt;Confirm&gt;')&&str_contains($html,'&lt;Footer&gt;'),'HTML text was not escaped');
transportExpect(str_contains($html,'href="https://genesis.test/?x=&quot;&amp;y=1"'),'HTML action URL was not escaped');

echo "Email transport: $assertions assertions PASS; no network/config/database used\n";
