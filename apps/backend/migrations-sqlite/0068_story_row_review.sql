CREATE TABLE `story_row_review` (
	`story_id` text NOT NULL,
	`row_id` text NOT NULL,
	`decision` text NOT NULL,
	`reason` text,
	`reviewer_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`story_id`, `row_id`),
	FOREIGN KEY (`story_id`) REFERENCES `story`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewer_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `story_row_review_reviewer_idx` ON `story_row_review` (`reviewer_id`);