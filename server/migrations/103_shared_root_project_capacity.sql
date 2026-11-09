-- Preserve all existing rows. Shared project storage guards now count only roots,
-- so nested projects/task lists have no total-node ceiling. Per-request/rate/task
-- limits are unchanged. Subscription limits remain authoritative in writer transactions.
CREATE INDEX shared_projects_owner_roots ON shared_projects(space_id)
 WHERE parent_id IS NULL AND is_inbox=0 AND kind='project';

DROP TRIGGER quota_projects_insert;
DROP TRIGGER quota_projects_update;
DROP TRIGGER quota_owner_projects_insert;
DROP TRIGGER quota_owner_projects_update;

CREATE TRIGGER quota_projects_insert BEFORE INSERT ON shared_projects
WHEN NEW.parent_id IS NULL AND NEW.is_inbox=0 AND NEW.kind='project'
 AND NOT EXISTS (SELECT 1 FROM shared_projects WHERE id=NEW.id)
BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM shared_projects WHERE space_id=NEW.space_id
  AND parent_id IS NULL AND is_inbox=0 AND kind='project' AND id<>NEW.id)
  >= (SELECT amount FROM resource_quota_limits WHERE name='projects_per_space')
  THEN RAISE(ABORT,'GENESIS_QUOTA_EXCEEDED') END;
END;

CREATE TRIGGER quota_projects_update BEFORE UPDATE ON shared_projects
WHEN NEW.parent_id IS NULL AND NEW.is_inbox=0 AND NEW.kind='project'
 AND (OLD.space_id IS NOT NEW.space_id OR OLD.parent_id IS NOT NULL OR OLD.is_inbox<>0 OR OLD.kind<>'project')
 -- ON DELETE SET NULL runs after the parent row is gone. Do not block a cascade
 -- or discard retained collaborator data; explicit promotions still have a parent.
 AND (OLD.parent_id IS NULL OR EXISTS (SELECT 1 FROM shared_projects WHERE id=OLD.parent_id))
BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM shared_projects WHERE space_id=NEW.space_id
  AND parent_id IS NULL AND is_inbox=0 AND kind='project' AND id<>NEW.id)
  >= (SELECT amount FROM resource_quota_limits WHERE name='projects_per_space')
  THEN RAISE(ABORT,'GENESIS_QUOTA_EXCEEDED') END;
END;

CREATE TRIGGER quota_owner_projects_insert BEFORE INSERT ON shared_projects
WHEN NEW.parent_id IS NULL AND NEW.is_inbox=0 AND NEW.kind='project'
 AND NOT EXISTS (SELECT 1 FROM shared_projects WHERE id=NEW.id)
BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM shared_projects p JOIN resource_space_owners o ON o.space_id=p.space_id
  WHERE o.user_id=(SELECT user_id FROM resource_space_owners WHERE space_id=NEW.space_id)
  AND p.parent_id IS NULL AND p.is_inbox=0 AND p.kind='project' AND p.id<>NEW.id)
  >= (SELECT amount FROM resource_quota_limits WHERE name='projects_per_user')
  THEN RAISE(ABORT,'GENESIS_QUOTA_EXCEEDED') END;
END;

CREATE TRIGGER quota_owner_projects_update BEFORE UPDATE ON shared_projects
WHEN NEW.parent_id IS NULL AND NEW.is_inbox=0 AND NEW.kind='project'
 AND (OLD.space_id IS NOT NEW.space_id OR OLD.parent_id IS NOT NULL OR OLD.is_inbox<>0 OR OLD.kind<>'project')
 AND (OLD.parent_id IS NULL OR EXISTS (SELECT 1 FROM shared_projects WHERE id=OLD.parent_id))
BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM shared_projects p JOIN resource_space_owners o ON o.space_id=p.space_id
  WHERE o.user_id=(SELECT user_id FROM resource_space_owners WHERE space_id=NEW.space_id)
  AND p.parent_id IS NULL AND p.is_inbox=0 AND p.kind='project' AND p.id<>NEW.id)
  >= (SELECT amount FROM resource_quota_limits WHERE name='projects_per_user')
  THEN RAISE(ABORT,'GENESIS_QUOTA_EXCEEDED') END;
END;
