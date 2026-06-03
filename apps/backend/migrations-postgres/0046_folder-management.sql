CREATE TABLE "favorite" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"story_id" text,
	"folder_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "favorite_user_id_story_id_unique" UNIQUE("user_id","story_id"),
	CONSTRAINT "favorite_user_id_folder_id_unique" UNIQUE("user_id","folder_id"),
	CONSTRAINT "favorite_xor_target" CHECK (("favorite"."story_id" IS NOT NULL)::int + ("favorite"."folder_id" IS NOT NULL)::int = 1)
);
--> statement-breakpoint
CREATE TABLE "story_folder" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"project_id" text NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"system_type" text,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_folder_item" (
	"story_id" text PRIMARY KEY NOT NULL,
	"folder_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shared_story" ADD COLUMN "is_pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_story_id_story_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."story"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_folder_id_story_folder_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."story_folder"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_folder" ADD CONSTRAINT "story_folder_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_folder" ADD CONSTRAINT "story_folder_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_folder" ADD CONSTRAINT "story_folder_parent_id_story_folder_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."story_folder"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_folder_item" ADD CONSTRAINT "story_folder_item_story_id_story_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."story"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_folder_item" ADD CONSTRAINT "story_folder_item_folder_id_story_folder_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."story_folder"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "favorite_user_id_idx" ON "favorite" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "story_folder_private_root_unique" ON "story_folder" USING btree ("project_id","owner_id") WHERE "story_folder"."system_type" = 'private_folder';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "story_folder_ownerProjectParent_idx" ON "story_folder" USING btree ("owner_id","project_id","parent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "story_folder_projectId_idx" ON "story_folder" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "story_folder_item_folderId_idx" ON "story_folder_item" USING btree ("folder_id");--> statement-breakpoint
-- Enforce a single publication per (project, story).
-- First, deduplicate existing rows: keep the most "promoted" one
-- (pinned > unpinned, then project visibility > specific, then most recent).
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
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shared_story_project_story_unique" ON "shared_story" USING btree ("project_id","story_id");

-- Backfill: create "My private folder" for each (user, project) that owns stories,
-- then place all non-project-shared stories inside it.
-- Stories may be chat-linked (owner via chat.user_id/project_id) or standalone (owner via story.user_id/project_id).
WITH user_projects AS (
	SELECT DISTINCT
		COALESCE(st.user_id, c.user_id) AS user_id,
		COALESCE(st.project_id, c.project_id) AS project_id
	FROM story st
	LEFT JOIN chat c ON c.id = st.chat_id
	WHERE COALESCE(st.user_id, c.user_id) IS NOT NULL
		AND COALESCE(st.project_id, c.project_id) IS NOT NULL
), inserted_roots AS (
	INSERT INTO story_folder (id, owner_id, project_id, name, visibility, system_type)
	SELECT gen_random_uuid()::text, up.user_id, up.project_id, 'My private folder', 'private', 'private_folder'
	FROM user_projects up
	RETURNING id, owner_id, project_id
)
INSERT INTO story_folder_item (story_id, folder_id)
SELECT st.id, r.id
FROM story st
LEFT JOIN chat c ON c.id = st.chat_id
JOIN inserted_roots r
	ON r.owner_id = COALESCE(st.user_id, c.user_id)
	AND r.project_id = COALESCE(st.project_id, c.project_id)
LEFT JOIN shared_story ss ON ss.story_id = st.id AND ss.visibility = 'project'
WHERE ss.id IS NULL;