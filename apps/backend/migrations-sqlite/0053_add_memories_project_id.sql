ALTER TABLE `memories` ADD `project_id` text REFERENCES project(id);--> statement-breakpoint
CREATE INDEX `memories_projectId_idx` ON `memories` (`project_id`);