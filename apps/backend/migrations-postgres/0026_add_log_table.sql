CREATE TABLE "log" (
	"id" text PRIMARY KEY NOT NULL,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"context" jsonb,
	"source" text NOT NULL,
	"project_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "log" ADD CONSTRAINT "log_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "log_createdAt_idx" ON "log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "log_level_idx" ON "log" USING btree ("level");--> statement-breakpoint
CREATE INDEX "log_projectId_idx" ON "log" USING btree ("project_id");