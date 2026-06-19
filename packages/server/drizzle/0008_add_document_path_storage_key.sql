ALTER TABLE `documents` ADD COLUMN `path` text NOT NULL DEFAULT '';
ALTER TABLE `documents` ADD COLUMN `storage_key` text;
CREATE INDEX `idx_documents_kb_path` ON `documents` (`kb_id`, `path`);
