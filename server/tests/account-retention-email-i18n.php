<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit(1);

/** Also required by account-retention.php, which is already run by deployment CI. */
(static function(): void {
    $fixture=null;
    if(!defined('GENESIS_LOCAL_TEST_CONFIG')){
        $fixture=sys_get_temp_dir().'/genesis-retention-email-i18n-'.bin2hex(random_bytes(8));mkdir($fixture,0700);mkdir($fixture.'/sessions',0700);
        $config=['app_url'=>'https://localhost.invalid','session_path'=>$fixture.'/sessions','cookie_secure'=>false,
            'timezone'=>'UTC','notifications'=>['email'=>['transport'=>'disabled']]];
        file_put_contents($fixture.'/config.php','<?php return '.var_export($config,true).';');
        define('GENESIS_LOCAL_TEST_CONFIG',$fixture.'/config.php');
    }
    $previousZone=date_default_timezone_get();
    try{
        foreach(['bootstrap','repository']as$module)require_once dirname(__DIR__).'/src/'.$module.'.php';
        $expect=static function(bool $ok,string $reason): void {if(!$ok)throw new RuntimeException($reason);};
        $json=(string)file_get_contents(dirname(__DIR__).'/resources/account-retention-email-copy.json');
        $catalog=genesisRetentionEmailCopy($json);
        $languages=['ru','en','el','de','fr','es','it','pt','pl','sr','uk','zh','tr','ja'];
        $rules=['free-unreturned','free-inactive','former-paid-inactive','complimentary-elite-inactive','complimentary-elite-year'];
        $fields=['subject','deadline','actionsInactive','actionsYear','data','footer','action'];
        $actualLanguages=array_keys($catalog);$expectedLanguages=$languages;sort($actualLanguages);sort($expectedLanguages);
        $expect($actualLanguages===$expectedLanguages,'Mandatory warning does not cover exactly fourteen supported languages');
        $flatten=static function(array $copy): array {
            $result=$copy;unset($result['reasons']);
            foreach($copy['reasons']as$key=>$value)$result['reasons.'.$key]=$value;
            return $result;
        };
        $source=$flatten($catalog['ru']);
        foreach($languages as$language){
            $copy=$catalog[$language];$flat=$flatten($copy);$keys=array_keys($flat);$sourceKeys=array_keys($source);sort($keys);sort($sourceKeys);
            $expect($keys===$sourceKeys,$language.': incomplete email fields or rules');
            $expect(count(array_unique($copy['reasons']))===5,$language.': deletion grounds are not distinct');
            foreach($flat as$key=>$value){
                preg_match_all('/\{[^{}]+\}/u',$value,$actual);preg_match_all('/\{[^{}]+\}/u',$source[$key],$expected);
                $expect($actual[0]===$expected[0],$language.': placeholder mismatch in '.$key);
                $expect(!preg_match('/[\x00-\x1F\x7F]|<\/?[a-z][^>]*>/iu',$value),$language.': markup or control characters in plain copy');
                if($language!=='ru')$expect($value!==$source[$key],$language.': Russian fallback in '.$key);
                if(!in_array($language,['ru','en'],true))$expect($value!==$flatten($catalog['en'])[$key],$language.': English fallback in '.$key);
                if(!in_array($language,['ru','sr','uk'],true))$expect(!preg_match('/[А-Яа-яЁё]/u',$value),$language.': Russian text leaked');
            }
            $expect(str_contains($copy['reasons']['complimentary-elite-year'],'365')&&str_contains($copy['actionsYear'],'365'),$language.': missing fixed-year rule distinction');
            foreach(['free-unreturned','free-inactive','former-paid-inactive']as$rule)$expect(str_contains($copy['reasons'][$rule],'FREE'),$language.': missing FREE plan');
            foreach(['complimentary-elite-inactive','complimentary-elite-year']as$rule)$expect(str_contains($copy['reasons'][$rule],'ELITE'),$language.': missing complimentary ELITE plan');
            foreach(['free-unreturned'=>3,'free-inactive'=>6,'former-paid-inactive'=>12,'complimentary-elite-inactive'=>3]as$rule=>$months){
                $marker=match($language){'ru'=>[3=>'трёх календарных месяцев',6=>'шести календарных месяцев',12=>'двенадцати календарных месяцев'][$months],
                    'en'=>[3=>'three calendar months',6=>'six calendar months',12=>'twelve calendar months'][$months],default=>(string)$months};
                $expect(str_contains($copy['reasons'][$rule],$marker),$language.': wrong inactivity period for '.$rule);
            }
        }

        $url=rtrim((string)genesisConfig()['app_url'],'/').'/';
        // The output must stay UTC even when the process is far from UTC.
        date_default_timezone_set('Pacific/Honolulu');
        $cases=[
            ['now'=>'2027-01-31T12:34:56Z','deadline'=>'2027-01-01T00:00:00Z','promise'=>'2027-01-15T00:00:00Z','expected'=>'2027-02-28T12:34:56Z'],
            ['now'=>'2028-01-31T12:34:56Z','deadline'=>'2028-01-01T00:00:00Z','promise'=>'2028-01-15T00:00:00Z','expected'=>'2028-02-29T12:34:56Z'],
            ['now'=>'2027-01-31T12:34:56Z','deadline'=>'2027-03-15T18:00:00Z','promise'=>'2027-02-01T00:00:00Z','expected'=>'2027-03-15T18:00:00Z'],
            ['now'=>'2027-01-31T12:34:56Z','deadline'=>'2027-02-01T00:00:00Z','promise'=>'2027-04-30T23:59:59Z','expected'=>'2027-04-30T23:59:59Z'],
        ];
        $recipient='retention-recipient@example.invalid';
        $private=['fixture-raw-access-token','fixture-raw-refresh-token','fixture-raw-lease-token','fixture-private-message-id','<script>fixture-private-profile</script>'];
        $rendered=0;
        foreach($languages as$language)foreach($rules as$rule){
            $copy=$catalog[$language];
            foreach($cases as$case){
                $notice=['rule'=>$rule,'promised_delete_at'=>$case['promise'],'lease_token'=>$private[2],'id'=>$private[3]];
                $snapshot=['user'=>['language'=>$language,'access_token'=>$private[0],'refresh_token'=>$private[1],'display_name'=>$private[4]],
                    'recipientEmail'=>$recipient,'deadline'=>strtotime($case['deadline'])];
                $message=genesisRetentionEmailMessage($notice,$snapshot,strtotime($case['now']));$rendered++;
                $context=$language.':'.$rule.':'.$case['expected'];
                $expect($message['to']===$recipient&&$message['subject']===$copy['subject'],$context.': recipient or localized subject changed');
                $expect($message['promisedDeleteAt']===$case['expected'],$context.': full month/rule deadline/previous promise was shortened or shifted from UTC');
                $expect(substr_count($message['text'],$case['expected'])===1&&str_contains($message['text'],'UTC'),$context.': UTC deadline missing from plain text');
                $expect(substr_count($message['html'],$case['expected'])===1,$context.': UTC deadline missing from HTML');
                $actions=$copy[$rule==='complimentary-elite-year'?'actionsYear':'actionsInactive'];
                $otherActions=$copy[$rule==='complimentary-elite-year'?'actionsInactive':'actionsYear'];
                foreach([$copy['reasons'][$rule],str_replace('{date}',$case['expected'],$copy['deadline']),$actions,$copy['data'],$copy['footer'],$url]as$part)
                    $expect(str_contains($message['text'],$part),$context.': missing localized reason, deadline, action, data, service footer or URL');
                $expect(!str_contains($message['text'],$otherActions),$context.': 365-day and inactivity rescue actions were confused');
                foreach($copy['reasons']as$otherRule=>$reason)if($otherRule!==$rule)$expect(!str_contains($message['text'],$reason),$context.': another deletion reason leaked');
                foreach($private as$marker)$expect(!str_contains($message['subject'].$message['text'].$message['html'],$marker),$context.': private marker leaked');
                $expect(!preg_match('/\{[^{}]+\}/u',$message['text']),$context.': unresolved placeholder');
                $expect(iconv_mime_decode(genesisEmailEncodeHeader($message['subject']),ICONV_MIME_DECODE_CONTINUE_ON_ERROR,'UTF-8')===$message['subject'],$context.': localized SMTP subject did not round-trip');
                $document=new DOMDocument();$oldErrors=libxml_use_internal_errors(true);
                try{$expect($document->loadHTML($message['html'],LIBXML_NONET),$context.': invalid email HTML');}
                finally{libxml_clear_errors();libxml_use_internal_errors($oldErrors);}
                $expect($document->getElementsByTagName('h1')->item(0)?->textContent===$copy['subject'],$context.': subject was lost or not escaped');
                $button=$document->getElementsByTagName('a')->item(0);
                $expect($button?->textContent===$copy['action']&&$button?->getAttribute('href')===$url,$context.': localized action or destination missing');
                $htmlText=$document->textContent;
                foreach([$copy['reasons'][$rule],$actions,$copy['data'],$copy['footer']]as$part)$expect(str_contains($htmlText,$part),$context.': HTML lost localized paragraphs');
            }
        }

        // Unsupported, absent or malformed locale values all use complete English.
        foreach($rules as$rule){
            $notice=['rule'=>$rule,'promised_delete_at'=>'2027-01-01T00:00:00Z'];
            $snapshot=['user'=>['language'=>'en'],'recipientEmail'=>$recipient,'deadline'=>strtotime('2027-01-01T00:00:00Z')];
            $expected=genesisRetentionEmailMessage($notice,$snapshot,strtotime('2027-01-31T12:34:56Z'));
            foreach(['unknown','__proto__','constructor','EN','en-US','',null,[],123]as$language){
                $snapshot['user']['language']=$language;
                $expect(genesisRetentionEmailMessage($notice,$snapshot,strtotime('2027-01-31T12:34:56Z'))===$expected,'Unknown locale did not fall back safely to complete English');
            }
            unset($snapshot['user']['language']);
            $expect(genesisRetentionEmailMessage($notice,$snapshot,strtotime('2027-01-31T12:34:56Z'))===$expected,'Absent locale did not fall back to English');
        }

        $invalid=['malformed-json'=>'{'];
        foreach(['missing-language','missing-reason','blank-footer','bad-field-type','missing-date','duplicate-date','foreign-placeholder','subject-newline']as$kind){
            $broken=$catalog;
            switch($kind){
                case 'missing-language':unset($broken['el']);break;
                case 'missing-reason':unset($broken['fr']['reasons']['complimentary-elite-year']);break;
                case 'blank-footer':$broken['ja']['footer']=' ';break;
                case 'bad-field-type':$broken['de']['data']=[];break;
                case 'missing-date':$broken['en']['deadline']=str_replace('{date}','',$broken['en']['deadline']);break;
                case 'duplicate-date':$broken['ru']['deadline'].=' {date}';break;
                case 'foreign-placeholder':$broken['pt']['actionsYear'].=' {access_token}';break;
                case 'subject-newline':$broken['es']['subject'].="\r\nBcc: fixture@example.invalid";break;
            }
            $invalid[$kind]=json_encode($broken,JSON_THROW_ON_ERROR|JSON_UNESCAPED_UNICODE);
        }
        foreach($invalid as$kind=>$broken){
            $rejected=false;
            try{genesisRetentionEmailCopy($broken);}catch(JsonException|DomainException){$rejected=true;}
            $expect($rejected,'Broken copy was accepted: '.$kind);
        }
        $rejected=false;
        try{genesisRetentionEmailMessage(['rule'=>'unknown','promised_delete_at'=>'2027-01-01T00:00:00Z'],['user'=>['language'=>'en'],'recipientEmail'=>$recipient,'deadline'=>0],0);}
        catch(DomainException $error){$rejected=$error->getMessage()==='RETENTION_RULE_UNKNOWN';}
        $expect($rejected,'Unknown rule prepared a misleading mandatory warning');
        $escaped=genesisEmailHtml('<img src=x onerror="fixture">','<script>fixture</script> & text','https://localhost.invalid/?a=1&b="fixture"','<b>Open</b>','<i>Mandatory</i>');
        $expect(!str_contains($escaped,'<script>')&&!str_contains($escaped,'<img ')&&str_contains($escaped,'&lt;script&gt;')&&str_contains($escaped,'&amp;b=&quot;fixture&quot;'),'Shared HTML renderer stopped escaping plain content or URLs');
        echo 'Account retention email i18n: 14 languages x 5 rules, '.$rendered." UTC/calendar-month renders, localized rescue/data/service/action text, safe English fallback, private-field exclusion, HTML/header escaping and corrupt-catalog rejection passed.\n";
    }finally{
        date_default_timezone_set($previousZone);
        if($fixture!==null){
            $sessionFile=$fixture.'/sessions/sess_'.session_id();
            if(session_status()===PHP_SESSION_ACTIVE)session_write_close();
            if(is_file($sessionFile))unlink($sessionFile);
            rmdir($fixture.'/sessions');unlink($fixture.'/config.php');rmdir($fixture);
        }
    }
})();
