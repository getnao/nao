ALTER TABLE `story` ADD `certified_at` integer;--> statement-breakpoint
ALTER TABLE `story` ADD `certified_by` text REFERENCES user(id) ON UPDATE no action ON DELETE set null;