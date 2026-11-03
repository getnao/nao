ALTER TABLE "story_version" ADD COLUMN "origin" text;--> statement-breakpoint
ALTER TABLE "story_version" ADD COLUMN "author_id" text;--> statement-breakpoint
ALTER TABLE "story_version" ADD COLUMN "source_chat_id" text;--> statement-breakpoint
ALTER TABLE "story_version" ADD CONSTRAINT "story_version_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_version" ADD CONSTRAINT "story_version_source_chat_id_chat_id_fk" FOREIGN KEY ("source_chat_id") REFERENCES "public"."chat"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "story_version"
SET "author_id" = coalesce("chat"."user_id", "story"."user_id")
FROM "story"
LEFT JOIN "chat" ON "chat"."id" = "story"."chat_id"
WHERE "story"."id" = "story_version"."story_id";
--> statement-breakpoint
WITH "story_tool_part" AS MATERIALIZED (
	SELECT "message_part"."created_at", "message_part"."tool_output", "chat"."id" AS "chat_id", "chat"."fork_metadata"
	FROM "message_part"
	INNER JOIN "chat_message" ON "chat_message"."id" = "message_part"."message_id"
	INNER JOIN "chat" ON "chat"."id" = "chat_message"."chat_id"
	WHERE "message_part"."type" = 'tool-story'
		AND "message_part"."tool_state" = 'output-available'
		AND jsonb_typeof("message_part"."tool_output") = 'object'
		AND "message_part"."tool_output"->>'success' = 'true'
),
"version_source_chat" AS (
	SELECT DISTINCT ON ("story_version"."id") "story_version"."id" AS "version_id", "story_tool_part"."chat_id"
	FROM "story_version"
	INNER JOIN "story" ON "story"."id" = "story_version"."story_id"
	INNER JOIN "story_tool_part" ON "story_tool_part"."tool_output"->>'version' = "story_version"."version"::text
		AND "story_tool_part"."created_at" BETWEEN "story_version"."created_at" AND "story_version"."created_at" + interval '2 minutes'
	WHERE "story_version"."origin" IS NULL
		AND "story_version"."source" = 'assistant'
		AND (
			"story_tool_part"."tool_output"->>'story_id' = "story"."id"
			OR (
				"story_tool_part"."tool_output"->>'story_id' IS NULL
				AND "story_tool_part"."tool_output"->>'id' = "story"."slug"
				AND (
					"story_tool_part"."chat_id" = "story"."chat_id"
					OR ("story_tool_part"."fork_metadata"->>'type' IN ('story_question', 'story_selection') AND "story_tool_part"."fork_metadata"->>'id' = "story"."id")
					OR ("story_tool_part"."fork_metadata"->>'type' IN ('chat_question', 'chat_selection') AND "story_tool_part"."fork_metadata"->>'id' = "story"."chat_id")
				)
			)
		)
	ORDER BY "story_version"."id", "story_tool_part"."created_at"
)
UPDATE "story_version"
SET "source_chat_id" = "version_source_chat"."chat_id"
FROM "version_source_chat"
WHERE "story_version"."id" = "version_source_chat"."version_id";--> statement-breakpoint
UPDATE "story_version"
SET
	"origin" = 'agent',
	"author_id" = "chat"."user_id"
FROM "chat"
WHERE "chat"."id" = "story_version"."source_chat_id" AND "story_version"."origin" IS NULL;
