UPDATE "chat"
SET "fork_metadata" = jsonb_set("chat"."fork_metadata", '{id}', to_jsonb("shared_story"."story_id"))
FROM "shared_story"
WHERE "chat"."fork_metadata"->>'type' = 'story_selection'
	AND "chat"."fork_metadata"->>'id' = "shared_story"."id";
