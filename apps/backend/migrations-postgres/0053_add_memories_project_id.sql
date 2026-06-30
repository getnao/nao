ALTER TABLE "memories" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memories_projectId_idx" ON "memories" USING btree ("project_id");