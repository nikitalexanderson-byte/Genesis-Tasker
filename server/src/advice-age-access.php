<?php
declare(strict_types=1);

/** Shared with web/native. These are conservative app access rules, not an online-reading statute. */
function genesisAdviceAgePolicy(): array
{
    static $policy;
    return $policy ??= json_decode(file_get_contents(dirname(__DIR__).'/resources/advice-age-access-policy.json'),true,32,JSON_THROW_ON_ERROR);
}

function genesisAdviceAlcoholJurisdiction(string $country,string $subdivision='',?array $policy=null): array
{
    $policy ??= genesisAdviceAgePolicy();
    $rule=$policy['jurisdictions'][$country]??null;
    if (!is_array($rule)) return ['state'=>'unknown','minimumAge'=>null];
    if (($rule['status']??null)==='subdivision-required') {
        if ($subdivision==='') return ['state'=>'subdivision-required','minimumAge'=>null];
        $rule=$rule['subdivisions'][$subdivision]??null;
    } elseif ($subdivision!=='') return ['state'=>'unknown','minimumAge'=>null];
    if (!is_array($rule)) return ['state'=>'unknown','minimumAge'=>null];
    if (($rule['status']??null)==='blocked') return ['state'=>'blocked','minimumAge'=>null];
    if (($rule['status']??null)!=='verified'||!is_int($rule['minimumAge']??null)) return ['state'=>'unknown','minimumAge'=>null];
    return ['state'=>'verified','minimumAge'=>max(18,$rule['minimumAge'])];
}

function genesisPsychopompiaPreferences(mixed $value): array
{
    $value=is_string($value)?json_decode($value,true,16,JSON_THROW_ON_ERROR):$value;
    $policy=genesisAdviceAgePolicy();$ids=array_column($policy['subcategories'],'id');
    if (!is_array($value)||array_diff(array_keys($value),['adultConfirmed','subcategories','alcohol'])) throw new InvalidArgumentException('INVALID_PSYCHOPOMPIA_PREFERENCES');
    $result=array_replace(['adultConfirmed'=>false,'subcategories'=>$ids,'alcohol'=>[]],$value);
    if (!is_bool($result['adultConfirmed'])||!is_array($result['subcategories'])||!array_is_list($result['subcategories'])||array_filter($result['subcategories'],static fn($id)=>!is_string($id))||array_diff($result['subcategories'],$ids)
        ||!is_array($result['alcohol'])||array_diff(array_keys($result['alcohol']),['consent','countryCode','subdivisionCode','ageAtLeast','policyVersion'])) throw new InvalidArgumentException('INVALID_PSYCHOPOMPIA_PREFERENCES');
    $alcohol=array_replace(['consent'=>false,'countryCode'=>'','subdivisionCode'=>'','ageAtLeast'=>null,'policyVersion'=>$policy['policyVersion']],$result['alcohol']);
    if (!is_bool($alcohol['consent'])||!is_string($alcohol['countryCode'])||preg_match('/\A(?:[A-Z]{2})?\z/D',$alcohol['countryCode'])!==1
        ||!is_string($alcohol['subdivisionCode'])||preg_match('/\A(?:[A-Z]{2}-[A-Z0-9]{1,4})?\z/D',$alcohol['subdivisionCode'])!==1
        ||($alcohol['subdivisionCode']!==''&&!str_starts_with($alcohol['subdivisionCode'],$alcohol['countryCode'].'-'))
        ||($alcohol['ageAtLeast']!==null&&(!is_int($alcohol['ageAtLeast'])||!in_array($alcohol['ageAtLeast'],[18,19,20,21,25],true)))
        ||!is_string($alcohol['policyVersion'])||preg_match('/\A[0-9]{4}-[0-9]{2}-[0-9]{2}\z/D',$alcohol['policyVersion'])!==1) throw new InvalidArgumentException('INVALID_ADVICE_ALCOHOL_DECLARATION');
    $result['subcategories']=array_values(array_intersect($ids,$result['subcategories']));$result['alcohol']=$alcohol;
    return $result;
}

function genesisAdviceAlcoholAllowed(array $preferences,?array $policy=null): bool
{
    $policy??=genesisAdviceAgePolicy();$alcohol=$preferences['alcohol'];
    $rule=genesisAdviceAlcoholJurisdiction($alcohol['countryCode'],$alcohol['subdivisionCode'],$policy);
    return $preferences['adultConfirmed']&&$alcohol['consent']&&$alcohol['policyVersion']===$policy['policyVersion']
        &&$rule['state']==='verified'&&$alcohol['ageAtLeast']===$rule['minimumAge'];
}

function genesisPsychopompiaAllowed(array $entry,array $preferences,?array $policy=null): bool
{
    $policy??=genesisAdviceAgePolicy();$psych=$preferences['psychopompia']??genesisPsychopompiaPreferences([]);
    $tags=$entry['subcategories']??null;
    return ($policy['corpusEnabled']??false)===true&&in_array('psychopompia',$entry['categories']??[],true)&&in_array('psychopompia',$preferences['categories'],true)&&$psych['adultConfirmed']
        &&($entry['requiresAdult']??null)===true&&is_bool($entry['containsAlcohol']??null)
        &&($entry['status']??null)==='published'&&($entry['review']['status']??null)==='cleared'
        &&is_array($tags)&&array_is_list($tags)&&$tags!==[]&&array_filter($tags,static fn($id)=>!is_string($id))===[]&&array_diff($tags,array_column($policy['subcategories'],'id'))===[]
        &&array_intersect($tags,$psych['subcategories'])!==[]&&(!$entry['containsAlcohol']||genesisAdviceAlcoholAllowed($psych,$policy));
}

function genesisAdviceNotificationSafe(array $entry): bool
{
    return ($entry['requiresAdult']??false)!==true&&($entry['containsAlcohol']??false)!==true
        &&array_intersect($entry['categories']??[],['aphrodisia','psychopompia'])===[];
}
