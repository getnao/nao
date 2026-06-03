CREATE TABLE `favorite` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`story_id` text,
	`folder_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`story_id`) REFERENCES `story`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `story_folder`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "favorite_xor_target" CHECK(("favorite"."story_id" IS NOT NULL) + ("favorite"."folder_id" IS NOT NULL) = 1)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `favorite_user_id_idx` ON `favorite` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `favorite_user_id_story_id_unique` ON `favorite` (`user_id`,`story_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `favorite_user_id_folder_id_unique` ON `favorite` (`user_id`,`folder_id`);--> statement-breakpoint
CREATE TABLE `story_folder` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`visibility` text DEFAULT 'public' NOT NULL,
	`system_type` text,
	`archived_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `story_folder`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `story_folder_private_root_unique` ON `story_folder` (`project_id`,`owner_id`) WHERE "story_folder"."system_type" = 'private_folder';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `story_folder_ownerProjectParent_idx` ON `story_folder` (`owner_id`,`project_id`,`parent_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `story_folder_projectId_idx` ON `story_folder` (`project_id`);--> statement-breakpoint
CREATE TABLE `story_folder_item` (
	`story_id` text PRIMARY KEY NOT NULL,
	`folder_id` text NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `story`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `story_folder`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `story_folder_item_folderId_idx` ON `story_folder_item` (`folder_id`);--> statement-breakpoint
ALTER TABLE `shared_story` ADD `is_pinned` integer DEFAULT false NOT NULL;

-- Enforce a single publication per (project, story).
-- Deduplicate existing rows: keep the most "promoted" one
-- (pinned > unpinned, then project visibility > specific, then most recent).
-- Collapsing duplicates must never silently revoke a share, so first migrate the
-- access grants of the losing rows onto the kept row (shared_story_access cascades
-- on delete), then promote the kept row to project-wide visibility if any duplicate
-- was project-wide. Only after that do we delete the duplicates.
INSERT OR IGNORE INTO shared_story_access (shared_story_id, user_id)
SELECT DISTINCT m.keeper_id, ssa.user_id
FROM shared_story_access ssa
JOIN (
	SELECT
		id AS loser_id,
		first_value(id) OVER w AS keeper_id,
		row_number() OVER w AS rn
	FROM shared_story
	WINDOW w AS (
		PARTITION BY project_id, story_id
		ORDER BY
			is_pinned DESC,
			CASE WHEN visibility = 'project' THEN 0 ELSE 1 END,
			created_at DESC,
			id
	)
) m ON m.loser_id = ssa.shared_story_id AND m.rn > 1;
--> statement-breakpoint
UPDATE shared_story
SET visibility = 'project'
WHERE visibility <> 'project'
	AND id IN (
		SELECT id FROM (
			SELECT
				id,
				ROW_NUMBER() OVER (
					PARTITION BY project_id, story_id
					ORDER BY
						is_pinned DESC,
						CASE WHEN visibility = 'project' THEN 0 ELSE 1 END,
						created_at DESC,
						id
				) AS rn,
				MAX(CASE WHEN visibility = 'project' THEN 1 ELSE 0 END) OVER (
					PARTITION BY project_id, story_id
				) AS has_project
			FROM shared_story
		)
		WHERE rn = 1 AND has_project = 1
	);
--> statement-breakpoint
DELETE FROM shared_story
WHERE id IN (
	SELECT id FROM (
		SELECT
			id,
			ROW_NUMBER() OVER (
				PARTITION BY project_id, story_id
				ORDER BY
					is_pinned DESC,
					CASE WHEN visibility = 'project' THEN 0 ELSE 1 END,
					created_at DESC,
					id
			) AS rn
		FROM shared_story
	) ranked
	WHERE rn > 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `shared_story_project_story_unique` ON `shared_story` (`project_id`,`story_id`);

-- Backfill: create "My private folder" for each (user, project) that owns stories,
-- then place all non-project-shared stories inside it.
-- Stories may be chat-linked (owner via chat.user_id/project_id) or standalone (owner via story.user_id/project_id).
INSERT INTO story_folder (id, owner_id, project_id, name, visibility, system_type)
SELECT
	lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
	s.owner_id,
	s.project_id,
	'My private folder',
	'private',
	'private_folder'
FROM (
	SELECT DISTINCT
		COALESCE(st.user_id, c.user_id) AS owner_id,
		COALESCE(st.project_id, c.project_id) AS project_id
	FROM story st
	LEFT JOIN chat c ON c.id = st.chat_id
	WHERE COALESCE(st.user_id, c.user_id) IS NOT NULL
		AND COALESCE(st.project_id, c.project_id) IS NOT NULL
) s
WHERE NOT EXISTS (
	SELECT 1 FROM story_folder f
	WHERE f.owner_id = s.owner_id AND f.project_id = s.project_id AND f.system_type = 'private_folder'
);

INSERT INTO story_folder_item (story_id, folder_id)
SELECT st.id, f.id
FROM story st
LEFT JOIN chat c ON c.id = st.chat_id
JOIN story_folder f
	ON f.owner_id = COALESCE(st.user_id, c.user_id)
	AND f.project_id = COALESCE(st.project_id, c.project_id)
	AND f.system_type = 'private_folder'
WHERE NOT EXISTS (
		SELECT 1 FROM shared_story ss WHERE ss.story_id = st.id AND ss.visibility = 'project'
	)
	AND NOT EXISTS (
		SELECT 1 FROM story_folder_item sfi WHERE sfi.story_id = st.id
	);