-- Additive guard for encrypted optional fields that legacy normalizers would discard.
-- The marker also protects data if an older server binary is rolled back in place.
ALTER TABLE workspace_blobs ADD COLUMN minimum_writer_protocol INTEGER NOT NULL DEFAULT 1;
ALTER TABLE workspace_blobs ADD COLUMN writer_protocol_version INTEGER NOT NULL DEFAULT 0;
CREATE TRIGGER workspace_writer_protocol_guard BEFORE UPDATE ON workspace_blobs
WHEN (OLD.minimum_writer_protocol >= 2 OR NEW.minimum_writer_protocol >= 2)
 AND (NEW.minimum_writer_protocol < OLD.minimum_writer_protocol OR NEW.writer_protocol_version != NEW.version)
BEGIN
  SELECT RAISE(ABORT, 'WORKSPACE_UPGRADE_REQUIRED');
END;
