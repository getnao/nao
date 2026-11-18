ALTER TABLE "story" ADD COLUMN "certified_at" timestamp;--> statement-breakpoint
ALTER TABLE "story" ADD COLUMN "certified_by" text;--> statement-breakpoint
ALTER TABLE "story" ADD CONSTRAINT "story_certified_by_user_id_fk" FOREIGN KEY ("certified_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;