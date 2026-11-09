<?php
declare(strict_types=1);

function genesisTemplateLanguage(mixed $language):string
{
    if(!is_string($language)||!in_array($language,['ru','en','de','el','es','fr','it','ja','pl','pt','sr','tr','uk','zh'],true))throw new InvalidArgumentException('TEMPLATE_LANGUAGE_INVALID');return $language;
}

function genesisSharedStarterTemplates(string $language):array
{
    genesisTemplateLanguage($language);$data=json_decode((string)file_get_contents(__DIR__.'/../resources/template-starters.json'),true,32,JSON_THROW_ON_ERROR);
    $t=static fn(string $source):string=>$language==='ru'?$source:($data[$language][$source]??throw new RuntimeException('TEMPLATE_TRANSLATION_MISSING'));
    $definitions=[
        'event'=>['title'=>'Мероприятие','description'=>'Программа, участники и проверка готовности.','kind'=>'project','tasks'=>['Подготовить программу','Пригласить участников','Провести мероприятие']],
        'publication'=>['title'=>'Публикация','description'=>'От замысла до опубликованного материала.','kind'=>'task','tasks'=>['Подготовить публикацию','Написать текст','Опубликовать материал']],
        'launch'=>['title'=>'Запуск проекта','description'=>'План, подготовка и запуск проекта.','kind'=>'project','tasks'=>['Согласовать план','Подготовить запуск','Проверить результат']],
        'control'=>['title'=>'Проверка и контроль','description'=>'Проверьте критерии и зафиксируйте результат.','kind'=>'task','tasks'=>['Провести проверку','Проверить критерии','Зафиксировать результат']],
    ];$result=[];
    foreach($definitions as $key=>$definition){
        $project=['key'=>'project','parentKey'=>null,'title'=>$t($definition['title']),'description'=>$t($definition['description']),'layout'=>'list','kind'=>'project',
            'statuses'=>[['key'=>'open','title'=>$t('Подготовка'),'isDone'=>false],['key'=>'progress','title'=>$t('В работе'),'isDone'=>false],['key'=>'done','title'=>$t('Готово'),'isDone'=>true]]];
        $tasks=[];foreach($definition['tasks'] as $i=>$title)$tasks[]=['key'=>'task-'.$i,'projectKey'=>'project','parentKey'=>$definition['kind']==='task'&&$i>0?'task-0':null,
            'title'=>$t($title),'statusKey'=>'open','due'=>['amount'=>$definition['kind']==='task'&&$i===0?2:$i,'unit'=>'day'],
            'checklists'=>$i===0?[['key'=>'checklist','title'=>$t('Готовность'),'items'=>[['key'=>'criteria','title'=>$t('Согласовать критерии готовности')],['key'=>'materials','title'=>$t('Проверить материалы')]]]]:[]];
        $manifest=genesisTemplateManifest(['schemaVersion'=>1,'kind'=>$definition['kind'],'calendarMode'=>'profane',
            'calendarContext'=>['version'=>2,'timeZone'=>'Europe/Moscow','gregorianYearStart'=>'january'],'projects'=>[$project],'labels'=>[],'fields'=>[],'tasks'=>$tasks]);
        $result[]=['id'=>'system:'.$key,'title'=>$t($definition['title']),'kind'=>$definition['kind'],'revision'=>1,'deleted'=>false,'system'=>true,'canEdit'=>false,'spaceId'=>null,'projectId'=>null,'ownerId'=>null,
            'projectCount'=>1,'taskCount'=>count($tasks),'updatedAt'=>null,'manifest'=>$manifest,'notices'=>[]];
    }
    return $result;
}

function genesisSharedTemplateSource(string $actor,string $id,string $language='ru',bool $deleted=false):array
{
    genesisSharedRequireEnabled($actor);genesisTemplateLanguage($language);
    if(str_starts_with($id,'system:')){
        foreach(genesisSharedStarterTemplates($language) as $record)if($record['id']===$id)return $record;
        throw new GenesisSharedAccessException('TEMPLATE_UNAVAILABLE',404);
    }
    return genesisSharedTemplateRecord(genesisSharedTemplateAccess($actor,$id,false,$deleted));
}
