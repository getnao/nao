ALTER TABLE "story_version" ADD COLUMN "cache_schedule" text;--> statement-breakpoint
-- Migrate existing TTL values to cron expressions
UPDATE "story_version" SET "cache_schedule" = '*/5 * * * *' WHERE "cache_ttl_minutes" = 5;--> statement-breakpoint
UPDATE "story_version" SET "cache_schedule" = '*/15 * * * *' WHERE "cache_ttl_minutes" = 15;--> statement-breakpoint
UPDATE "story_version" SET "cache_schedule" = '*/30 * * * *' WHERE "cache_ttl_minutes" = 30;--> statement-breakpoint
UPDATE "story_version" SET "cache_schedule" = '0 * * * *' WHERE "cache_ttl_minutes" = 60;--> statement-breakpoint
UPDATE "story_version" SET "cache_schedule" = '0 */6 * * *' WHERE "cache_ttl_minutes" = 360;--> statement-breakpoint
UPDATE "story_version" SET "cache_schedule" = '0 0 * * *' WHERE "cache_ttl_minutes" = 1440;--> statement-breakpoint
ALTER TABLE "story_version" DROP COLUMN "cache_ttl_minutes";
