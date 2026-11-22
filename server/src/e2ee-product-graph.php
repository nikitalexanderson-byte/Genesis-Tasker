<?php
declare(strict_types=1);

/** Technical dependency validation with bounded PHP memory. SQLite keeps the
 * graph; only one metadata row and a small ready page are held by the worker.
 * The surrounding product transaction owns every content write/rollback. */
function genesisE2eeProductValidateGraph(PDO $db,array $scope,bool $includeDeleted=false):void
{
    $drop=static function()use($db):void{
        $db->exec('DROP TABLE IF EXISTS temp.genesis_e2ee_graph_ready');
        $db->exec('DROP TABLE IF EXISTS temp.genesis_e2ee_graph_edges');
        $db->exec('DROP TABLE IF EXISTS temp.genesis_e2ee_graph_nodes');
    };
    $drop();
    try{
        $db->exec('CREATE TEMP TABLE genesis_e2ee_graph_nodes(entity TEXT PRIMARY KEY,remaining INTEGER NOT NULL) WITHOUT ROWID');
        $db->exec('CREATE TEMP TABLE genesis_e2ee_graph_edges(entity TEXT NOT NULL,dependency TEXT NOT NULL,PRIMARY KEY(entity,dependency)) WITHOUT ROWID');
        $db->exec('CREATE INDEX temp.genesis_e2ee_graph_by_dependency ON genesis_e2ee_graph_edges(dependency,entity)');
        $db->exec('CREATE TEMP TABLE genesis_e2ee_graph_ready(entity TEXT PRIMARY KEY,processed INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID');
        $db->exec('CREATE INDEX temp.genesis_e2ee_graph_ready_pending ON genesis_e2ee_graph_ready(processed,entity)');
        $query=$db->prepare('SELECT entity_id,parent_id,metadata_json FROM e2ee_product_entities WHERE scope_id=? AND generation=?'.($includeDeleted?'':" AND deleted=0 AND kind<>'history'"));
        $query->execute([$scope['scope_id'],$scope['generation']]);
        $node=$db->prepare('INSERT INTO genesis_e2ee_graph_nodes VALUES(?,?)');$edge=$db->prepare('INSERT INTO genesis_e2ee_graph_edges VALUES(?,?)');$count=0;
        while($row=$query->fetch(PDO::FETCH_ASSOC)){
            if(++$count>100000)throw new GenesisResourceLimitException(413,'E2EE_SCOPE_OBJECT_LIMIT');
            $metadata=json_decode($row['metadata_json'],true,32,JSON_THROW_ON_ERROR);$links=array_values(array_unique(array_merge($row['parent_id']===null?[]:[$row['parent_id']],$metadata['dependsOnIds']??[])));
            $node->execute([$row['entity_id'],count($links)]);foreach($links as $dependency)$edge->execute([$row['entity_id'],$dependency]);
        }
        $query->closeCursor();
        if($db->query('SELECT 1 FROM genesis_e2ee_graph_edges e LEFT JOIN genesis_e2ee_graph_nodes n ON n.entity=e.dependency WHERE n.entity IS NULL LIMIT 1')->fetchColumn()!==false)throw new DomainException('E2EE_PRODUCT_DEPENDENCY_INVALID');
        $db->exec('INSERT INTO genesis_e2ee_graph_ready(entity) SELECT entity FROM genesis_e2ee_graph_nodes WHERE remaining=0');
        $decrement=$db->prepare('UPDATE genesis_e2ee_graph_nodes SET remaining=remaining-1 WHERE entity IN(SELECT entity FROM genesis_e2ee_graph_edges WHERE dependency=?)');
        $ready=$db->prepare('INSERT OR IGNORE INTO genesis_e2ee_graph_ready(entity) SELECT n.entity FROM genesis_e2ee_graph_nodes n JOIN genesis_e2ee_graph_edges e ON e.entity=n.entity WHERE e.dependency=? AND n.remaining=0');
        $processed=$db->prepare('UPDATE genesis_e2ee_graph_ready SET processed=1 WHERE entity=?');$visited=0;
        while(true){$page=$db->query('SELECT entity FROM genesis_e2ee_graph_ready WHERE processed=0 ORDER BY entity LIMIT 256')->fetchAll(PDO::FETCH_COLUMN);if(!$page)break;
            foreach($page as $entity){$decrement->execute([$entity]);$ready->execute([$entity]);$processed->execute([$entity]);$visited++;}
        }
        if($visited!==$count)throw new DomainException('E2EE_PRODUCT_DEPENDENCY_CYCLE');
    }finally{$drop();}
}
