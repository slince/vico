ALTER TABLE `documents` ADD COLUMN `parent_id` text REFERENCES `documents`(`id`);
CREATE INDEX `idx_documents_parent_id` ON `documents` (`parent_id`);
