-- A workspace contains projects. Its historical inbox remains for membership compatibility,
-- but tasks are relocated once, in place, into a real project's hidden inbox status.
ALTER TABLE shared_project_statuses ADD COLUMN is_chaos INTEGER NOT NULL DEFAULT 0 CHECK(is_chaos IN (0,1));
CREATE UNIQUE INDEX shared_project_chaos_status ON shared_project_statuses(project_id,is_done) WHERE is_chaos=1;

-- These journals keep the original container references for a deliberate data rollback.
CREATE TABLE shared_workspace_inbox_relocations (
    inbox_project_id TEXT PRIMARY KEY,
    destination_project_id TEXT NOT NULL,
    recovery_project_created INTEGER NOT NULL,
    relocated_at TEXT NOT NULL
);
CREATE TABLE shared_workspace_task_relocations (
    task_id TEXT PRIMARY KEY,
    original_project_id TEXT NOT NULL,
    original_status_id TEXT NOT NULL,
    destination_project_id TEXT NOT NULL,
    original_revision INTEGER NOT NULL,
    original_updated_at TEXT NOT NULL
);
CREATE TABLE shared_workspace_list_relocations (
    project_id TEXT PRIMARY KEY,
    original_parent_id TEXT,
    original_board_status_id TEXT,
    destination_parent_id TEXT NOT NULL
);
CREATE TABLE shared_workspace_scope_relocations (
    kind TEXT NOT NULL, object_id TEXT NOT NULL, original_project_id TEXT NOT NULL,
    destination_project_id TEXT NOT NULL, original_revision INTEGER NOT NULL, original_required INTEGER,
    PRIMARY KEY(kind,object_id)
);

INSERT INTO shared_workspace_inbox_relocations
SELECT inbox.id,
    COALESCE((SELECT p.id FROM shared_projects p WHERE p.space_id=inbox.space_id
        AND p.is_inbox=0 AND p.kind='project' AND p.archived_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM shared_trash tr WHERE tr.kind='project' AND tr.object_id=p.id)
        ORDER BY p.created_at,p.id LIMIT 1), 'recovered-project:' || inbox.space_id),
    NOT EXISTS(SELECT 1 FROM shared_projects p WHERE p.space_id=inbox.space_id AND p.is_inbox=0
        AND p.kind='project' AND p.archived_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM shared_trash tr WHERE tr.kind='project' AND tr.object_id=p.id)),
    strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM shared_projects inbox WHERE inbox.is_inbox=1 AND (
    EXISTS(SELECT 1 FROM shared_tasks t WHERE t.project_id=inbox.id)
    OR EXISTS(SELECT 1 FROM shared_task_series series WHERE series.project_id=inbox.id)
    OR EXISTS(SELECT 1 FROM shared_projects child WHERE child.space_id=inbox.space_id AND child.kind='task-list'
        AND child.is_inbox=0 AND (child.parent_id IS NULL OR child.parent_id=inbox.id))
);

INSERT INTO shared_projects(id,space_id,title,description,layout,kind,created_by,created_at,updated_at)
SELECT r.destination_project_id,p.space_id,'Перенесённые задачи','', 'board','project',p.created_by,r.relocated_at,r.relocated_at
FROM shared_workspace_inbox_relocations r JOIN shared_projects p ON p.id=r.inbox_project_id
WHERE r.recovery_project_created=1;
-- A new recovery project keeps the former inbox's audience; existing project ACLs never change.
INSERT INTO shared_project_members(project_id,user_id,role,joined_at)
SELECT r.destination_project_id,m.user_id,m.role,m.joined_at
FROM shared_workspace_inbox_relocations r JOIN shared_project_members m ON m.project_id=r.inbox_project_id
WHERE r.recovery_project_created=1;
INSERT INTO shared_project_statuses(id,project_id,title,position,is_done)
SELECT 'recovered-open:'||destination_project_id,destination_project_id,'К выполнению',0,0
FROM shared_workspace_inbox_relocations WHERE recovery_project_created=1;
INSERT INTO shared_project_statuses(id,project_id,title,position,is_done)
SELECT 'recovered-progress:'||destination_project_id,destination_project_id,'В работе',1,0
FROM shared_workspace_inbox_relocations WHERE recovery_project_created=1;
INSERT INTO shared_project_statuses(id,project_id,title,position,is_done)
SELECT 'recovered-done:'||destination_project_id,destination_project_id,'Готово',2,1
FROM shared_workspace_inbox_relocations WHERE recovery_project_created=1;

INSERT INTO shared_project_statuses(id,project_id,title,position,is_done,is_chaos)
SELECT 'chaos-open:'||destination_project_id,destination_project_id,'Хаос-бокс',-2,0,1
FROM shared_workspace_inbox_relocations;
INSERT INTO shared_project_statuses(id,project_id,title,position,is_done,is_chaos)
SELECT 'chaos-done:'||destination_project_id,destination_project_id,'Хаос-бокс',-1,1,1
FROM shared_workspace_inbox_relocations;

INSERT INTO shared_workspace_task_relocations
SELECT t.id,t.project_id,t.status_id,r.destination_project_id,t.revision,t.updated_at
FROM shared_tasks t JOIN shared_workspace_inbox_relocations r ON r.inbox_project_id=t.project_id;
INSERT INTO shared_workspace_list_relocations
SELECT child.id,child.parent_id,child.board_status_id,r.destination_project_id
FROM shared_projects child JOIN shared_projects inbox ON inbox.space_id=child.space_id AND inbox.is_inbox=1
JOIN shared_workspace_inbox_relocations r ON r.inbox_project_id=inbox.id
WHERE child.is_inbox=0 AND child.kind='task-list' AND (child.parent_id IS NULL OR child.parent_id=inbox.id);
UPDATE shared_projects SET parent_id=(SELECT destination_parent_id FROM shared_workspace_list_relocations r WHERE r.project_id=shared_projects.id),
    board_status_id=NULL,revision=revision+1
WHERE id IN (SELECT project_id FROM shared_workspace_list_relocations);

-- Category and custom-field IDs stay stable together with their values.
INSERT INTO shared_workspace_scope_relocations
SELECT 'category',c.id,c.project_id,r.destination_project_id,c.revision,NULL
FROM shared_project_categories c JOIN shared_workspace_inbox_relocations r ON r.inbox_project_id=c.project_id;
INSERT INTO shared_workspace_scope_relocations
SELECT 'field',f.id,f.project_id,r.destination_project_id,f.revision,f.required
FROM shared_custom_fields f JOIN shared_workspace_inbox_relocations r ON r.inbox_project_id=f.project_id;
UPDATE shared_project_categories SET project_id=(SELECT destination_project_id FROM shared_workspace_inbox_relocations r
    WHERE r.inbox_project_id=shared_project_categories.project_id),revision=revision+1
WHERE project_id IN(SELECT inbox_project_id FROM shared_workspace_inbox_relocations);

-- Covers old clients, imports and workers as well as the ordinary API.
CREATE TRIGGER shared_task_project_required_insert BEFORE INSERT ON shared_tasks
WHEN EXISTS(SELECT 1 FROM shared_projects p WHERE p.id=NEW.project_id AND p.is_inbox=1)
BEGIN SELECT RAISE(ABORT,'SHARED_PROJECT_REQUIRED'); END;
CREATE TRIGGER shared_task_project_required_move BEFORE UPDATE OF project_id ON shared_tasks
WHEN EXISTS(SELECT 1 FROM shared_projects p WHERE p.id=NEW.project_id AND p.is_inbox=1)
BEGIN SELECT RAISE(ABORT,'SHARED_PROJECT_REQUIRED'); END;
UPDATE shared_custom_fields SET project_id=(SELECT destination_project_id FROM shared_workspace_inbox_relocations r
    WHERE r.inbox_project_id=shared_custom_fields.project_id),required=0,revision=revision+1
WHERE project_id IN(SELECT inbox_project_id FROM shared_workspace_inbox_relocations);

-- Old Google projections are retired by the existing per-user cleanup worker.
INSERT INTO shared_google_projection_cleanup(id,user_id,destination,google_id,google_list_id,created_at)
SELECT 'root-move:'||l.task_id||':'||l.user_id||':'||l.destination,l.user_id,l.destination,l.google_id,
    COALESCE(l.google_list_id,p.google_task_list_id),r.relocated_at
FROM shared_google_projection_links l JOIN shared_tasks t ON t.id=l.task_id
JOIN shared_workspace_inbox_relocations r ON r.inbox_project_id=t.project_id
LEFT JOIN shared_google_preferences p ON p.project_id=t.project_id AND p.user_id=l.user_id;
DELETE FROM shared_google_projection_links WHERE task_id IN(SELECT task_id FROM shared_workspace_task_relocations);

UPDATE shared_tasks SET project_id=(SELECT destination_project_id FROM shared_workspace_task_relocations r WHERE r.task_id=shared_tasks.id),
    status_id=(CASE WHEN completed_at IS NULL THEN 'chaos-open:' ELSE 'chaos-done:' END)||
        (SELECT destination_project_id FROM shared_workspace_task_relocations r WHERE r.task_id=shared_tasks.id),
    revision=revision+1,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id IN(SELECT task_id FROM shared_workspace_task_relocations);
UPDATE shared_trash SET project_id=(SELECT destination_project_id FROM shared_workspace_task_relocations r WHERE r.task_id=shared_trash.object_id)
WHERE kind='task' AND object_id IN(SELECT task_id FROM shared_workspace_task_relocations);
UPDATE shared_task_series SET project_id=(SELECT destination_project_id FROM shared_workspace_inbox_relocations r WHERE r.inbox_project_id=shared_task_series.project_id),
    revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE project_id IN(SELECT inbox_project_id FROM shared_workspace_inbox_relocations);

-- Every project owns an open/done inbox pair; these rows are never boards.
INSERT OR IGNORE INTO shared_project_statuses(id,project_id,title,position,is_done,is_chaos)
SELECT 'chaos-open:'||id,id,'Хаос-бокс',-2,0,1 FROM shared_projects WHERE is_inbox=0;
INSERT OR IGNORE INTO shared_project_statuses(id,project_id,title,position,is_done,is_chaos)
SELECT 'chaos-done:'||id,id,'Хаос-бокс · Выполнено',-1,1,1 FROM shared_projects WHERE is_inbox=0;
