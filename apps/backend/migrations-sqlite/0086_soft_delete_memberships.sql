ALTER TABLE `org_member` ADD `is_deleted` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `org_member` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `project_member` ADD `is_deleted` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `project_member` ADD `deleted_at` integer;