<?php
declare(strict_types=1);

/** Secrets are read only from the private runtime configuration. */
function genesisEmailConfiguration(): array
{
    $mail=genesisConfig()['notifications']['email']??[];
    $valid=is_array($mail)&&filter_var($mail['from']??'',FILTER_VALIDATE_EMAIL);
    $transport=$mail['transport']??'';
    if($transport==='mail')$valid=$valid&&function_exists('mail');
    elseif($transport==='smtp')$valid=$valid&&extension_loaded('curl')
        &&in_array('smtps',curl_version()['protocols'],true)
        &&is_string($mail['host']??null)&&preg_match('/\A[a-zA-Z0-9.-]+\z/D',$mail['host'])
        &&in_array($mail['encryption']??'',['ssl','starttls'],true)
        &&in_array($mail['port']??0,[465,587],true)
        &&is_string($mail['username']??null)&&$mail['username']!==''
        &&is_string($mail['password']??null)&&$mail['password']!=='';
    else $valid=false;
    return ['available'=>(bool)$valid,'settings'=>is_array($mail)?$mail:[]];
}

function genesisEmailHtml(string $title,string $text,string $url,string $action,string $footer): string
{
    $escape=static fn(string $value):string=>htmlspecialchars($value,ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8');
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>'
        .'<body style="margin:0;background:#eee9dc;color:#132426;font:16px/1.6 Arial,sans-serif"><main style="max-width:560px;margin:32px auto;padding:32px;background:#fffdf8;border-radius:12px">'
        .'<p style="color:#255b59;font:28px Georgia,serif;margin:0 0 24px">GENESIS</p><h1 style="font:28px/1.3 Georgia,serif">'.$escape($title).'</h1><p>'.nl2br($escape($text)).'</p>'
        .'<p style="margin:28px 0"><a style="display:inline-block;padding:12px 20px;background:#255b59;color:#fffdf8;text-decoration:none;border-radius:8px" href="'.$escape($url).'">'.$escape($action).'</a></p>'
        .'<p style="font-size:13px;color:#526263">'.$escape($footer).'</p></main></body></html>';
}

/** RFC 2047 words stay below 75 bytes without splitting a UTF-8 character. */
function genesisEmailEncodeHeader(string $value): string
{
    if(preg_match('/[\x00-\x1F\x7F]/',$value))throw new InvalidArgumentException('INVALID_EMAIL_MESSAGE');
    $characters=preg_split('//u',$value,-1,PREG_SPLIT_NO_EMPTY);
    if($characters===false)throw new InvalidArgumentException('INVALID_EMAIL_MESSAGE');
    $words=[];$chunk='';
    foreach($characters as $character){
        // 42 bytes produce a 68-byte word, leaving room for the Subject prefix.
        if(strlen($chunk)+strlen($character)>42){
            $words[]='=?UTF-8?B?'.base64_encode($chunk).'?=';$chunk='';
        }
        $chunk.=$character;
    }
    if($chunk!=='')$words[]='=?UTF-8?B?'.base64_encode($chunk).'?=';
    return implode("\r\n ",$words);
}

/** Stable Message-ID permits provider deduplication after an ambiguous network failure. */
function genesisEmailSend(string $to,string $subject,string $text,string $id,?string $html=null): string
{
    if(!filter_var($to,FILTER_VALIDATE_EMAIL)||preg_match('/[\r\n]/',$to.$subject.$id))throw new InvalidArgumentException('INVALID_EMAIL_MESSAGE');
    $encodedSubject=genesisEmailEncodeHeader($subject);
    $configuration=genesisEmailConfiguration();if(!$configuration['available'])throw new RuntimeException('EMAIL_TRANSPORT_UNCONFIGURED');
    $mail=$configuration['settings'];
    if(!filter_var($to,FILTER_VALIDATE_EMAIL)||preg_match('/[\r\n]/',$to.$subject.$id.$mail['from']))throw new InvalidArgumentException('INVALID_EMAIL_MESSAGE');
    $host=(string)parse_url(genesisConfig()['app_url'],PHP_URL_HOST);
    if(!preg_match('/\A[a-zA-Z0-9.-]+\z/D',$host))throw new RuntimeException('EMAIL_ORIGIN_INVALID');
    $messageId='<genesis-'.hash('sha256',$id).'@'.$host.'>';
    $from=genesisEmailEncodeHeader((string)($mail['from_name']??'GENESIS')).' <'.$mail['from'].'>';
    $headers=['From'=>$from,'MIME-Version'=>'1.0','Date'=>gmdate('D, d M Y H:i:s').' +0000','Message-ID'=>$messageId,'Auto-Submitted'=>'auto-generated'];
    if($html!==null){
        $boundary='genesis-'.bin2hex(random_bytes(18));$headers['Content-Type']='multipart/alternative; boundary="'.$boundary.'"';
        $body='--'.$boundary."\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n".quoted_printable_encode($text)
            ."\r\n--".$boundary."\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n".quoted_printable_encode($html)."\r\n--".$boundary."--\r\n";
    }else{$headers['Content-Type']='text/plain; charset=UTF-8';$headers['Content-Transfer-Encoding']='quoted-printable';$body=quoted_printable_encode($text);}
    if($mail['transport']==='mail'){
        if(!mail($to,$encodedSubject,$body,$headers))throw new RuntimeException('EMAIL_RETRY');return 'accepted';
    }
    $lines=['To: <'.$to.'>','Subject: '.$encodedSubject];foreach($headers as$key=>$value)$lines[]=$key.': '.$value;
    $wire=implode("\r\n",$lines)."\r\n\r\n".$body;
    $stream=fopen('php://temp','w+');fwrite($stream,$wire);rewind($stream);
    $curl=curl_init(($mail['encryption']==='ssl'?'smtps':'smtp').'://'.$mail['host'].':'.$mail['port']);
    try{
        curl_setopt_array($curl,[CURLOPT_USERNAME=>$mail['username'],CURLOPT_PASSWORD=>$mail['password'],
            CURLOPT_MAIL_FROM=>'<'.$mail['from'].'>',CURLOPT_MAIL_RCPT=>['<'.$to.'>'],CURLOPT_UPLOAD=>true,
            CURLOPT_INFILE=>$stream,CURLOPT_INFILESIZE=>strlen($wire),CURLOPT_USE_SSL=>CURLUSESSL_ALL,
            CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_SSL_VERIFYHOST=>2,CURLOPT_CONNECTTIMEOUT=>12,
            CURLOPT_TIMEOUT=>30,CURLOPT_RETURNTRANSFER=>true]);
        if(curl_exec($curl)===false)throw new RuntimeException('EMAIL_RETRY');
        $status=(int)curl_getinfo($curl,CURLINFO_RESPONSE_CODE);
        if($status<200||$status>=300)throw new RuntimeException('EMAIL_RETRY');
        return 'accepted';
    }finally{curl_close($curl);fclose($stream);}
}
