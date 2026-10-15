-- Preserve each original master while a corrected batch becomes current.
ALTER TABLE registration_archive_batches
 ADD COLUMN supersedes_batch_id text UNIQUE
 REFERENCES registration_archive_batches(id) ON DELETE RESTRICT;
ALTER TABLE registration_archive_batches
 ADD CONSTRAINT registration_archive_no_self_revision
 CHECK (supersedes_batch_id IS NULL OR supersedes_batch_id <> id);
