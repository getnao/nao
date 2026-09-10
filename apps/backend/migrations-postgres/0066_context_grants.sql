ALTER TABLE "user_group" ADD COLUMN "context_grants" jsonb;--> statement-breakpoint
ALTER TABLE "story_data_cache" ADD COLUMN "query_sources" jsonb;--> statement-breakpoint
UPDATE "user_group"
SET "context_grants" = CASE
	WHEN "is_default" = true THEN '{"version":1,"access":{"mode":"all"}}'::jsonb
	ELSE '{"version":1,"access":{"mode":"restricted","grants":[]}}'::jsonb
END;