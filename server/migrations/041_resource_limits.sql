-- Additive guardrails: no existing records are deleted or rewritten.
-- Counts include archived data. Existing over-limit data can be read/deleted; growth is refused.
CREATE TABLE api_rate_budgets (subject TEXT NOT NULL, bucket TEXT NOT NULL, window_start INTEGER NOT NULL,
 request_count INTEGER NOT NULL, input_bytes INTEGER NOT NULL, PRIMARY KEY(subject,bucket));
CREATE INDEX api_rate_budgets_expiry ON api_rate_budgets(window_start);
CREATE TABLE resource_quota_limits (name TEXT PRIMARY KEY, amount INTEGER NOT NULL CHECK(amount > 0));
INSERT INTO resource_quota_limits(name,amount) VALUES
 ('spaces_per_user',100),
 ('projects_per_space',500),
 ('projects_per_user',2000),
 ('tasks_per_project',10000),
 ('tasks_per_user',50000),
 ('comments_per_task',1000),
 ('comments_per_user',100000),
 ('categories_per_user',1000),
 ('invitations_per_project',10000),
 ('invitations_per_space',10000),
 ('media_bytes_per_user',536870912);
CREATE INDEX shared_spaces_creator ON shared_spaces(created_by);

-- Attribute shared storage to the current first owner; retain creator attribution during creation.
CREATE VIEW resource_space_owners AS SELECT s.id AS space_id,
 COALESCE((SELECT user_id FROM shared_space_members WHERE space_id=s.id AND role='owner'
 ORDER BY joined_at,user_id LIMIT 1),s.created_by) AS user_id FROM shared_spaces s;
CREATE VIEW resource_space_media_usage AS SELECT s.id AS space_id,
 length(s.cover_image)*3/4 +
 COALESCE((SELECT SUM(a.byte_size) FROM shared_task_attachments a JOIN shared_tasks t ON t.id=a.task_id
 JOIN shared_projects p ON p.id=t.project_id WHERE p.space_id=s.id),0) +
 COALESCE((SELECT SUM(i.byte_size) FROM shared_task_images i JOIN shared_tasks t ON t.id=i.task_id
 JOIN shared_projects p ON p.id=t.project_id WHERE p.space_id=s.id),0) AS byte_size FROM shared_spaces s;


CREATE TRIGGER quota_spaces_insert BEFORE INSERT ON shared_spaces
WHEN NOT EXISTS (SELECT 1 FROM shared_spaces WHERE id = NEW.id)
BEGIN
  SELECT CASE WHEN (SELECT COUNT(*) FROM shared_spaces WHERE created_by = NEW.created_by AND id <> NEW.id) >= (SELECT amount FROM resource_quota_limits WHERE name = 'spaces_per_user') THEN RAISE(ABORT, 'GENESIS_QUOTA_EXCEEDED') END;
END;

CREATE TRIGGER quota_spaces_update BEFORE UPDATE ON shared_spaces
WHEN OLD.created_by IS NOT NEW.created_by
BEGIN
  SELECT CASE WHEN (SELECT COUNT(*) FROM shared_spaces WHERE created_by = NEW.created_by AND id <> NEW.id) >= (SELECT amount FROM resource_quota_limits WHERE name = 'spaces_per_user') THEN RAISE(ABORT, 'GENESIS_QUOTA_EXCEEDED') END;
END;

CREATE TRIGGER quota_projects_insert BEFORE INSERT ON shared_projects
WHEN NOT EXISTS (SELECT 1 FROM shared_projects WHERE id = NEW.id)
BEGIN
  SELECT CASE WHEN (SELECT COUNT(*) FROM shared_projects WHERE space_id = NEW.space_id AND id <> NEW.id) >= (SELECT amount FROM resource_quota_limits WHERE name = 'projects_per_space') THEN RAISE(ABORT, 'GENESIS_QUOTA_EXCEEDED') END;
END;

CREATE TRIGGER quota_projects_update BEFORE UPDATE ON shared_projects
WHEN OLD.space_id IS NOT NEW.space_id
BEGIN
  SELECT CASE WHEN (SELECT COUNT(*) FROM shared_projects WHERE space_id = NEW.space_id AND id <> NEW.id) >= (SELECT amount FROM resource_quota_limits WHERE name = 'projects_per_space') THEN RAISE(ABORT, 'GENESIS_QUOTA_EXCEEDED') END;
END;

CREATE TRIGGER quota_tasks_insert BEFORE INSERT ON shared_tasks
WHEN NOT EXISTS (SELECT 1 FROM shared_tasks WHERE id = NEW.id)
BEGIN
  SELECT CASE WHEN (SELECT COUNT(*) FROM shared_tasks WHERE project_id = NEW.project_id AND id <> NEW.id) >= (SELECT amount FROM resource_quota_limits WHERE name = 'tasks_per_project') THEN RAISE(ABORT, 'GENESIS_QUOTA_EXCEEDED') END;
END;

CREATE TRIGGER quota_tasks_update BEFORE UPDATE ON shared_tasks
WHEN OLD.project_id IS NOT NEW.project_id
BEGIN
  SELECT CASE WHEN (SELECT COUNT(*) FROM shared_tasks WHERE project_id = NEW.project_id AND id <> NEW.id) >= (SELECT amount FROM resource_quota_limits WHERE name = 'tasks_per_project') THEN RAISE(ABORT, 'GENESIS_QUOTA_EXCEEDED') END;
END;

CREATE TRIGGER quota_comments_insert BEFORE INSERT ON shared_comments
WHEN NOT EXISTS (SELECT 1 FROM shared_comments WHERE id = NEW.id)
BEGIN
  SELECT CASE WHEN (SELECT COUNT(*) FROM shared_comments WHERE task_id = NEW.task_id AND id <> NEW.id) >= (SELECT amount FROM resource_quota_limits WHERE name = 'comments_per_task') THEN RAISE(ABORT, 'GENESIS_QUOTA_EXCEEDED') END;
END;

CREATE TRIGGER quota_comments_update BEFORE UPDATE ON shared_comments
WHEN OLD.task_id IS NOT NEW.task_id
BEGIN
  SELECT CASE WHEN (SELECT COUNT(*) FROM shared_comments WHERE task_id = NEW.task_id AND id <> NEW.id) >= (SELECT amount FROM resource_quota_limits WHERE name = 'comments_per_task') THEN RAISE(ABORT, 'GENESIS_QUOTA_EXCEEDED') END;
END;

CREATE TRIGGER quota_private_tasks_insert BEFORE INSERT ON tasks
WHEN NOT EXISTS (SELECT 1 FROM tasks WHERE id = NEW.id)
BEGIN
  SELECT CASE WHEN (SELECT COUNT(*) FROM tasks WHERE user_id = NEW.user_id AND id <> NEW.id) >= (SELECT amount FROM resource_quota_limits WHERE name = 'tasks_per_user') THEN RAISE(ABORT, 'GENESIS_QUOTA_EXCEEDED') END;
END;

CREATE TRIGGER quota_private_tasks_update BEFORE UPDATE ON tasks
WHEN OLD.user_id IS NOT NEW.user_id
BEGIN
  SELECT CASE WHEN (SELECT COUNT(*) FROM tasks WHERE user_id = NEW.user_id AND id <> NEW.id) >= (SELECT amount FROM resource_quota_limits WHERE name = 'tasks_per_user') THEN RAISE(ABORT, 'GENESIS_QUOTA_EXCEEDED') END;
END;

CREATE TRIGGER quota_private_projects_insert BEFORE INSERT ON projects
WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.id)
BEGIN
  SELECT CASE WHEN (SELECT COUNT(*) FROM projects WHERE user_id = NEW.user_id AND id <> NEW.id) >= (SELECT amount FROM resource_quota_limits WHERE name = 'projects_per_user') THEN RAISE(ABORT, 'GENESIS_QUOTA_EXCEEDED') END;
END;

CREATE TRIGGER quota_private_projects_update BEFORE UPDATE ON projects
WHEN OLD.user_id IS NOT NEW.user_id
BEGIN
  SELECT CASE WHEN (SELECT COUNT(*) FROM projects WHERE user_id = NEW.user_id AND id <> NEW.id) >= (SELECT amount FROM resource_quota_limits WHERE name = 'projects_per_user') THEN RAISE(ABORT, 'GENESIS_QUOTA_EXCEEDED') END;
END;

CREATE TRIGGER quota_private_categories_insert BEFORE INSERT ON categories
WHEN NOT EXISTS (SELECT 1 FROM categories WHERE id = NEW.id)
BEGIN
  SELECT CASE WHEN (SELECT COUNT(*) FROM categories WHERE user_id = NEW.user_id AND id <> NEW.id) >= (SELECT amount FROM resource_quota_limits WHERE name = 'categories_per_user') THEN RAISE(ABORT, 'GENESIS_QUOTA_EXCEEDED') END;
END;

CREATE TRIGGER quota_private_categories_update BEFORE UPDATE ON categories
WHEN OLD.user_id IS NOT NEW.user_id
BEGIN
  SELECT CASE WHEN (SELECT COUNT(*) FROM categories WHERE user_id = NEW.user_id AND id <> NEW.id) >= (SELECT amount FROM resource_quota_limits WHERE name = 'categories_per_user') THEN RAISE(ABORT, 'GENESIS_QUOTA_EXCEEDED') END;
END;

CREATE TRIGGER quota_invitations_insert BEFORE INSERT ON shared_invitations
WHEN NOT EXISTS (SELECT 1 FROM shared_invitations WHERE id = NEW.id)
BEGIN
  SELECT CASE WHEN (SELECT COUNT(*) FROM shared_invitations WHERE project_id = NEW.project_id AND id <> NEW.id) >= (SELECT amount FROM resource_quota_limits WHERE name = 'invitations_per_project') THEN RAISE(ABORT, 'GENESIS_QUOTA_EXCEEDED') END;
END;

CREATE TRIGGER quota_invitations_update BEFORE UPDATE ON shared_invitations
WHEN OLD.project_id IS NOT NEW.project_id
BEGIN
  SELECT CASE WHEN (SELECT COUNT(*) FROM shared_invitations WHERE project_id = NEW.project_id AND id <> NEW.id) >= (SELECT amount FROM resource_quota_limits WHERE name = 'invitations_per_project') THEN RAISE(ABORT, 'GENESIS_QUOTA_EXCEEDED') END;
END;

CREATE TRIGGER quota_space_invitations_insert BEFORE INSERT ON shared_space_invitations
WHEN NOT EXISTS (SELECT 1 FROM shared_space_invitations WHERE id = NEW.id)
BEGIN
  SELECT CASE WHEN (SELECT COUNT(*) FROM shared_space_invitations WHERE space_id = NEW.space_id AND id <> NEW.id) >= (SELECT amount FROM resource_quota_limits WHERE name = 'invitations_per_space') THEN RAISE(ABORT, 'GENESIS_QUOTA_EXCEEDED') END;
END;

CREATE TRIGGER quota_space_invitations_update BEFORE UPDATE ON shared_space_invitations
WHEN OLD.space_id IS NOT NEW.space_id
BEGIN
  SELECT CASE WHEN (SELECT COUNT(*) FROM shared_space_invitations WHERE space_id = NEW.space_id AND id <> NEW.id) >= (SELECT amount FROM resource_quota_limits WHERE name = 'invitations_per_space') THEN RAISE(ABORT, 'GENESIS_QUOTA_EXCEEDED') END;
END;

CREATE TRIGGER quota_owner_projects_insert BEFORE INSERT ON shared_projects
WHEN NOT EXISTS (SELECT 1 FROM shared_projects WHERE id=NEW.id)
BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM shared_projects p JOIN shared_spaces s ON s.id=p.space_id WHERE (SELECT user_id FROM resource_space_owners WHERE space_id=s.id)=(SELECT user_id FROM resource_space_owners WHERE space_id=NEW.space_id) AND p.id<>NEW.id) >= (SELECT amount FROM resource_quota_limits WHERE name = 'projects_per_user') THEN RAISE(ABORT, 'GENESIS_QUOTA_EXCEEDED') END;
END;

CREATE TRIGGER quota_owner_projects_update BEFORE UPDATE ON shared_projects
WHEN OLD.space_id IS NOT NEW.space_id
BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM shared_projects p JOIN shared_spaces s ON s.id=p.space_id WHERE (SELECT user_id FROM resource_space_owners WHERE space_id=s.id)=(SELECT user_id FROM resource_space_owners WHERE space_id=NEW.space_id) AND p.id<>NEW.id) >= (SELECT amount FROM resource_quota_limits WHERE name = 'projects_per_user') THEN RAISE(ABORT, 'GENESIS_QUOTA_EXCEEDED') END;
END;

CREATE TRIGGER quota_owner_tasks_insert BEFORE INSERT ON shared_tasks
WHEN NOT EXISTS (SELECT 1 FROM shared_tasks WHERE id=NEW.id)
BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM shared_tasks t JOIN shared_projects p ON p.id=t.project_id JOIN shared_spaces s ON s.id=p.space_id WHERE (SELECT user_id FROM resource_space_owners WHERE space_id=s.id)=(SELECT (SELECT user_id FROM resource_space_owners WHERE space_id=s.id) FROM shared_spaces s JOIN shared_projects p ON p.space_id=s.id WHERE p.id=NEW.project_id) AND t.id<>NEW.id) >= (SELECT amount FROM resource_quota_limits WHERE name = 'tasks_per_user') THEN RAISE(ABORT, 'GENESIS_QUOTA_EXCEEDED') END;
END;

CREATE TRIGGER quota_owner_tasks_update BEFORE UPDATE ON shared_tasks
WHEN OLD.project_id IS NOT NEW.project_id
BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM shared_tasks t JOIN shared_projects p ON p.id=t.project_id JOIN shared_spaces s ON s.id=p.space_id WHERE (SELECT user_id FROM resource_space_owners WHERE space_id=s.id)=(SELECT (SELECT user_id FROM resource_space_owners WHERE space_id=s.id) FROM shared_spaces s JOIN shared_projects p ON p.space_id=s.id WHERE p.id=NEW.project_id) AND t.id<>NEW.id) >= (SELECT amount FROM resource_quota_limits WHERE name = 'tasks_per_user') THEN RAISE(ABORT, 'GENESIS_QUOTA_EXCEEDED') END;
END;

CREATE TRIGGER quota_owner_comments_insert BEFORE INSERT ON shared_comments
WHEN NOT EXISTS (SELECT 1 FROM shared_comments WHERE id=NEW.id)
BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM shared_comments c JOIN shared_tasks t ON t.id=c.task_id JOIN shared_projects p ON p.id=t.project_id JOIN shared_spaces s ON s.id=p.space_id WHERE (SELECT user_id FROM resource_space_owners WHERE space_id=s.id)=(SELECT (SELECT user_id FROM resource_space_owners WHERE space_id=s.id) FROM shared_spaces s JOIN shared_projects p ON p.space_id=s.id JOIN shared_tasks t ON t.project_id=p.id WHERE t.id=NEW.task_id) AND c.id<>NEW.id) >= (SELECT amount FROM resource_quota_limits WHERE name = 'comments_per_user') THEN RAISE(ABORT, 'GENESIS_QUOTA_EXCEEDED') END;
END;

CREATE TRIGGER quota_owner_comments_update BEFORE UPDATE ON shared_comments
WHEN OLD.task_id IS NOT NEW.task_id
BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM shared_comments c JOIN shared_tasks t ON t.id=c.task_id JOIN shared_projects p ON p.id=t.project_id JOIN shared_spaces s ON s.id=p.space_id WHERE (SELECT user_id FROM resource_space_owners WHERE space_id=s.id)=(SELECT (SELECT user_id FROM resource_space_owners WHERE space_id=s.id) FROM shared_spaces s JOIN shared_projects p ON p.space_id=s.id JOIN shared_tasks t ON t.project_id=p.id WHERE t.id=NEW.task_id) AND c.id<>NEW.id) >= (SELECT amount FROM resource_quota_limits WHERE name = 'comments_per_user') THEN RAISE(ABORT, 'GENESIS_QUOTA_EXCEEDED') END;
END;

CREATE TRIGGER quota_shared_task_attachments_bytes_insert BEFORE INSERT ON shared_task_attachments
WHEN NEW.byte_size > COALESCE((SELECT byte_size FROM shared_task_attachments WHERE id=NEW.id),0)
BEGIN
 SELECT CASE WHEN COALESCE((SELECT SUM(u.byte_size) FROM resource_space_media_usage u
 JOIN resource_space_owners o ON o.space_id=u.space_id WHERE o.user_id=(SELECT o.user_id FROM resource_space_owners o JOIN shared_projects p ON p.space_id=o.space_id JOIN shared_tasks t ON t.project_id=p.id WHERE t.id=NEW.task_id)),0)
 + NEW.byte_size - COALESCE((SELECT byte_size FROM shared_task_attachments WHERE id=NEW.id),0) > (SELECT amount FROM resource_quota_limits WHERE name='media_bytes_per_user')
 THEN RAISE(ABORT, 'GENESIS_QUOTA_EXCEEDED') END;
END;

CREATE TRIGGER quota_shared_task_attachments_bytes_update BEFORE UPDATE ON shared_task_attachments
WHEN NEW.byte_size > COALESCE((SELECT byte_size FROM shared_task_attachments WHERE id=NEW.id),0)
BEGIN
 SELECT CASE WHEN COALESCE((SELECT SUM(u.byte_size) FROM resource_space_media_usage u
 JOIN resource_space_owners o ON o.space_id=u.space_id WHERE o.user_id=(SELECT o.user_id FROM resource_space_owners o JOIN shared_projects p ON p.space_id=o.space_id JOIN shared_tasks t ON t.project_id=p.id WHERE t.id=NEW.task_id)),0)
 + NEW.byte_size - COALESCE((SELECT byte_size FROM shared_task_attachments WHERE id=NEW.id),0) > (SELECT amount FROM resource_quota_limits WHERE name='media_bytes_per_user')
 THEN RAISE(ABORT, 'GENESIS_QUOTA_EXCEEDED') END;
END;

CREATE TRIGGER quota_shared_task_images_bytes_insert BEFORE INSERT ON shared_task_images
WHEN NEW.byte_size > COALESCE((SELECT byte_size FROM shared_task_images WHERE task_id=NEW.task_id),0)
BEGIN
 SELECT CASE WHEN COALESCE((SELECT SUM(u.byte_size) FROM resource_space_media_usage u
 JOIN resource_space_owners o ON o.space_id=u.space_id WHERE o.user_id=(SELECT o.user_id FROM resource_space_owners o JOIN shared_projects p ON p.space_id=o.space_id JOIN shared_tasks t ON t.project_id=p.id WHERE t.id=NEW.task_id)),0)
 + NEW.byte_size - COALESCE((SELECT byte_size FROM shared_task_images WHERE task_id=NEW.task_id),0) > (SELECT amount FROM resource_quota_limits WHERE name='media_bytes_per_user')
 THEN RAISE(ABORT, 'GENESIS_QUOTA_EXCEEDED') END;
END;

CREATE TRIGGER quota_shared_task_images_bytes_update BEFORE UPDATE ON shared_task_images
WHEN NEW.byte_size > COALESCE((SELECT byte_size FROM shared_task_images WHERE task_id=NEW.task_id),0)
BEGIN
 SELECT CASE WHEN COALESCE((SELECT SUM(u.byte_size) FROM resource_space_media_usage u
 JOIN resource_space_owners o ON o.space_id=u.space_id WHERE o.user_id=(SELECT o.user_id FROM resource_space_owners o JOIN shared_projects p ON p.space_id=o.space_id JOIN shared_tasks t ON t.project_id=p.id WHERE t.id=NEW.task_id)),0)
 + NEW.byte_size - COALESCE((SELECT byte_size FROM shared_task_images WHERE task_id=NEW.task_id),0) > (SELECT amount FROM resource_quota_limits WHERE name='media_bytes_per_user')
 THEN RAISE(ABORT, 'GENESIS_QUOTA_EXCEEDED') END;
END;

CREATE TRIGGER quota_cover_bytes_insert BEFORE INSERT ON shared_spaces
WHEN length(NEW.cover_image)*3/4 > COALESCE((SELECT length(cover_image)*3/4 FROM shared_spaces WHERE id=NEW.id),0)
BEGIN
 SELECT CASE WHEN COALESCE((SELECT SUM(u.byte_size) FROM resource_space_media_usage u
 JOIN resource_space_owners o ON o.space_id=u.space_id WHERE o.user_id=COALESCE((SELECT user_id FROM resource_space_owners WHERE space_id=NEW.id),NEW.created_by)),0)
 + length(NEW.cover_image)*3/4 - COALESCE((SELECT length(cover_image)*3/4 FROM shared_spaces WHERE id=NEW.id),0) > (SELECT amount FROM resource_quota_limits WHERE name='media_bytes_per_user')
 THEN RAISE(ABORT, 'GENESIS_QUOTA_EXCEEDED') END;
END;

CREATE TRIGGER quota_cover_bytes_update BEFORE UPDATE ON shared_spaces
WHEN length(NEW.cover_image)*3/4 > COALESCE((SELECT length(cover_image)*3/4 FROM shared_spaces WHERE id=NEW.id),0)
BEGIN
 SELECT CASE WHEN COALESCE((SELECT SUM(u.byte_size) FROM resource_space_media_usage u
 JOIN resource_space_owners o ON o.space_id=u.space_id WHERE o.user_id=COALESCE((SELECT user_id FROM resource_space_owners WHERE space_id=NEW.id),NEW.created_by)),0)
 + length(NEW.cover_image)*3/4 - COALESCE((SELECT length(cover_image)*3/4 FROM shared_spaces WHERE id=NEW.id),0) > (SELECT amount FROM resource_quota_limits WHERE name='media_bytes_per_user')
 THEN RAISE(ABORT, 'GENESIS_QUOTA_EXCEEDED') END;
END;
