ALTER TABLE "automation" ADD COLUMN "paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "automation" SET "paused" = true WHERE "scheduled_job_id" IN (SELECT "id" FROM "scheduled_job" WHERE "status" = 'paused');
