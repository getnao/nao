CREATE TABLE `agent_stream_chunk` (
	`stream_id` text NOT NULL,
	`seq` integer NOT NULL,
	`chunks` text NOT NULL,
	`is_final` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`stream_id`, `seq`)
);
--> statement-breakpoint
CREATE INDEX `agent_stream_chunk_createdAt_idx` ON `agent_stream_chunk` (`created_at`);--> statement-breakpoint
CREATE TABLE `agent_stream_run` (
	`chat_id` text PRIMARY KEY NOT NULL,
	`stream_id` text NOT NULL,
	`heartbeat_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chat`(`id`) ON UPDATE no action ON DELETE cascade
);
