ALTER TABLE "org_member" ADD COLUMN "is_deleted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "org_member" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "project_member" ADD COLUMN "is_deleted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project_member" ADD COLUMN "deleted_at" timestamp;