CREATE TABLE `message_image` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`media_type` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_message_part` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`order` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`type` text NOT NULL,
	`text` text,
	`reasoning_text` text,
	`tool_call_id` text,
	`tool_name` text,
	`tool_state` text,
	`tool_error_text` text,
	`tool_input` text,
	`tool_raw_input` text,
	`tool_output` text,
	`tool_approval_id` text,
	`tool_approval_approved` integer,
	`tool_approval_reason` text,
	`tool_provider_metadata` text,
	`provider_metadata` text,
	`media_type` text,
	`image_id` text,
	FOREIGN KEY (`message_id`) REFERENCES `chat_message`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`image_id`) REFERENCES `message_image`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "text_required_if_type_is_text" CHECK(CASE WHEN type = 'text' THEN text IS NOT NULL ELSE TRUE END),
	CONSTRAINT "reasoning_text_required_if_type_is_reasoning" CHECK(CASE WHEN type = 'reasoning' THEN reasoning_text IS NOT NULL ELSE TRUE END),
	CONSTRAINT "tool_call_fields_required" CHECK(CASE WHEN type LIKE 'tool-%' THEN tool_call_id IS NOT NULL AND tool_state IS NOT NULL ELSE TRUE END),
	CONSTRAINT "file_fields_required" CHECK(CASE WHEN type = 'file' THEN media_type IS NOT NULL ELSE TRUE END)
);
--> statement-breakpoint
INSERT INTO `__new_message_part`("id", "message_id", "order", "created_at", "type", "text", "reasoning_text", "tool_call_id", "tool_name", "tool_state", "tool_error_text", "tool_input", "tool_raw_input", "tool_output", "tool_approval_id", "tool_approval_approved", "tool_approval_reason", "tool_provider_metadata", "provider_metadata", "media_type", "image_id") SELECT "id", "message_id", "order", "created_at", "type", "text", "reasoning_text", "tool_call_id", "tool_name", "tool_state", "tool_error_text", "tool_input", "tool_raw_input", "tool_output", "tool_approval_id", "tool_approval_approved", "tool_approval_reason", "tool_provider_metadata", "provider_metadata", "media_type", "image_id" FROM `message_part`;--> statement-breakpoint
DROP TABLE `message_part`;--> statement-breakpoint
ALTER TABLE `__new_message_part` RENAME TO `message_part`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `message_part_tool_call_id_unique` ON `message_part` (`tool_call_id`);--> statement-breakpoint
CREATE INDEX `parts_message_id_idx` ON `message_part` (`message_id`);--> statement-breakpoint
CREATE INDEX `parts_message_id_order_idx` ON `message_part` (`message_id`,`order`);--> statement-breakpoint
CREATE TABLE `__new_project` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`path` text,
	`agent_settings` text,
	`enabled_tools` text DEFAULT '[]' NOT NULL,
	`known_mcp_servers` text DEFAULT '[]' NOT NULL,
	`slack_settings` text,
	`teams_settings` text,
	`telegram_settings` text,
	`whatsapp_settings` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "local_project_path_required" CHECK(CASE WHEN "type" = 'local' THEN "path" IS NOT NULL ELSE TRUE END)
);
--> statement-breakpoint
INSERT INTO `__new_project`("id", "org_id", "name", "type", "path", "agent_settings", "enabled_tools", "known_mcp_servers", "slack_settings", "teams_settings", "telegram_settings", "whatsapp_settings", "created_at", "updated_at") SELECT "id", "org_id", "name", "type", "path", "agent_settings", "enabled_tools", "known_mcp_servers", "slack_settings", "teams_settings", "telegram_settings", "whatsapp_settings", "created_at", "updated_at" FROM `project`;--> statement-breakpoint
DROP TABLE `project`;--> statement-breakpoint
ALTER TABLE `__new_project` RENAME TO `project`;--> statement-breakpoint
CREATE INDEX `project_orgId_idx` ON `project` (`org_id`);--> statement-breakpoint
CREATE TABLE `__new_story` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`is_live` integer DEFAULT false NOT NULL,
	`is_live_text_dynamic` integer DEFAULT true NOT NULL,
	`cache_schedule` text,
	`cache_schedule_description` text,
	`archived_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chat`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_story`("id", "chat_id", "slug", "title", "is_live", "is_live_text_dynamic", "cache_schedule", "cache_schedule_description", "archived_at", "created_at", "updated_at") SELECT "id", "chat_id", "slug", "title", "is_live", "is_live_text_dynamic", "cache_schedule", "cache_schedule_description", "archived_at", "created_at", "updated_at" FROM `story`;--> statement-breakpoint
DROP TABLE `story`;--> statement-breakpoint
ALTER TABLE `__new_story` RENAME TO `story`;--> statement-breakpoint
CREATE INDEX `story_chatId_idx` ON `story` (`chat_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `story_chat_slug_unique` ON `story` (`chat_id`,`slug`);