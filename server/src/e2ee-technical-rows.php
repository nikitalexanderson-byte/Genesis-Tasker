<?php
declare(strict_types=1);

/** Exact, transaction-local technical row capability. This is not a route or
 * an input boolean. Callers must first verify the signed business operation.
 * Membership tables deliberately retain their separate all-scope protocol. */
function genesisE2eeTechnicalBindings(): WeakMap {static $bindings;return $bindings??=new WeakMap();}
function genesisE2eeTechnicalTable(string $table): void
{
    if(!in_array($table,['shared_projects','shared_project_statuses'],true))throw new LogicException('E2EE_TECHNICAL_TABLE_FORBIDDEN');
}
function genesisE2eeTechnicalColumns(PDO $db,string $table): array
{
    genesisE2eeTechnicalTable($table);$columns=$db->query('PRAGMA table_info("'.$table.'")')->fetchAll();
    if(!$columns)throw new LogicException('E2EE_TECHNICAL_ROW_INVALID');
    foreach($columns as $column)if(!preg_match('/\A[a-z_]+\z/D',$column['name']))throw new LogicException('E2EE_TECHNICAL_ROW_INVALID');
    return $columns;
}
function genesisE2eeTechnicalTriggerJson(PDO $db,string $table,string $row): string
{
    if(!in_array($row,['OLD','NEW'],true))throw new LogicException('E2EE_TECHNICAL_ROW_INVALID');$pairs=[];
    foreach(genesisE2eeTechnicalColumns($db,$table) as $column){$pairs[]="'".$column['name']."'";$pairs[]=$row.'."'.$column['name'].'"';}
    return 'json_object('.implode(',',$pairs).')';
}
function genesisE2eeRegisterTechnicalGuard(PDO $db): void
{
    $bindings=genesisE2eeTechnicalBindings();
    $db->sqliteCreateFunction('genesis_e2ee_technical_allowed',static function(string $table,string $verb,?string $before,?string $after)use($db,$bindings):int{
        $permitted=$bindings[$db]??null;if(!$permitted)return 0;
        $key=genesisE2eeAclPermitKey($table,$verb,$before===null?null:json_decode($before,true,32,JSON_THROW_ON_ERROR),$after===null?null:json_decode($after,true,32,JSON_THROW_ON_ERROR));
        return hash_equals($permitted,$key)?1:0;
    },4);
}
function genesisE2eeWithTechnicalRowWrite(PDO $db,string $table,?array $before,array $after,Closure $write): mixed
{
    if(!$db->inTransaction())throw new LogicException('E2EE_TRANSACTION_CONTEXT_INVALID');
    $columns=array_column(genesisE2eeTechnicalColumns($db,$table),'name');$actual=array_keys($after);sort($columns,SORT_STRING);sort($actual,SORT_STRING);
    if($columns!==$actual||$before!==null&&array_diff_key($before,$after)!==[])throw new LogicException('E2EE_TECHNICAL_ROW_INVALID');
    if($before!==null){$old=array_keys($before);sort($old,SORT_STRING);if($old!==$columns)throw new LogicException('E2EE_TECHNICAL_ROW_INVALID');}
    foreach([$before,$after] as $row)if($row!==null)foreach($row as $value)if($value!==null&&!is_string($value)&&!is_int($value)&&!is_float($value))throw new LogicException('E2EE_TECHNICAL_ROW_INVALID');
    $bindings=genesisE2eeTechnicalBindings();if(isset($bindings[$db]))throw new LogicException('E2EE_TECHNICAL_CONTEXT_NESTED');
    $bindings[$db]=genesisE2eeAclPermitKey($table,$before===null?'INSERT':'UPDATE',$before,$after);
    try{return $write();}finally{unset($bindings[$db]);}
}
/** Complete the physical row before admission, including actual schema
 * defaults/affinity. The SQL callback itself never queries the database.
 * The signed resource factory supplies only technical IDs/placeholders. */
function genesisE2eeInsertTechnicalRow(PDO $db,string $table,array $values): array
{
    $columns=genesisE2eeTechnicalColumns($db,$table);if(array_diff(array_keys($values),array_column($columns,'name')))throw new LogicException('E2EE_TECHNICAL_ROW_INVALID');$after=[];
    foreach($columns as $column){
        $name=$column['name'];$value=array_key_exists($name,$values)?$values[$name]:
            ($column['dflt_value']===null?null:$db->query('SELECT '.$column['dflt_value'])->fetchColumn());
        if($value!==null){$type=strtoupper($column['type']);if(str_contains($type,'INT'))$value=(int)$value;elseif(str_contains($type,'CHAR')||str_contains($type,'TEXT')||str_contains($type,'CLOB'))$value=(string)$value;elseif(str_contains($type,'REAL')||str_contains($type,'FLOA')||str_contains($type,'DOUB'))$value=(float)$value;else throw new LogicException('E2EE_TECHNICAL_ROW_INVALID');}
        if($value===null&&(int)$column['notnull']===1)throw new LogicException('E2EE_TECHNICAL_ROW_INVALID');$after[$name]=$value;
    }
    genesisE2eeWithTechnicalRowWrite($db,$table,null,$after,static function()use($db,$table,$after):void{
        $names=array_keys($after);$db->prepare('INSERT INTO "'.$table.'"("'.implode('","',$names).'") VALUES('.implode(',',array_fill(0,count($names),'?')).')')->execute(array_values($after));
    });
    return $after;
}
