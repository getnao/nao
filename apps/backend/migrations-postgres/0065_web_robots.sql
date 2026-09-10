CREATE TABLE "web_robot" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"scheduled_job_id" text,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"definition" jsonb NOT NULL,
	"definition_version" integer DEFAULT 1 NOT NULL,
	"definition_hash" text NOT NULL,
	"archived_at" timestamp,
	"last_successful_run_id" text,
	"last_successful_run_at" timestamp,
	"last_published_product_count" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "web_robot_project_slug_unique" UNIQUE("project_id","slug")
);
--> statement-breakpoint
CREATE TABLE "web_robot_run" (
	"id" text PRIMARY KEY NOT NULL,
	"robot_id" text NOT NULL,
	"scheduled_job_id" text,
	"triggered_by_user_id" text,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"definition" jsonb NOT NULL,
	"definition_hash" text NOT NULL,
	"stats" jsonb NOT NULL,
	"artifact_prefix" text,
	"error_message" text,
	"cancel_requested_at" timestamp,
	"queued_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "web_robot" ADD CONSTRAINT "web_robot_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_robot" ADD CONSTRAINT "web_robot_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_robot" ADD CONSTRAINT "web_robot_scheduled_job_id_scheduled_job_id_fk" FOREIGN KEY ("scheduled_job_id") REFERENCES "public"."scheduled_job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_robot_run" ADD CONSTRAINT "web_robot_run_robot_id_web_robot_id_fk" FOREIGN KEY ("robot_id") REFERENCES "public"."web_robot"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_robot_run" ADD CONSTRAINT "web_robot_run_scheduled_job_id_scheduled_job_id_fk" FOREIGN KEY ("scheduled_job_id") REFERENCES "public"."scheduled_job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_robot_run" ADD CONSTRAINT "web_robot_run_triggered_by_user_id_user_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "web_robot_projectId_idx" ON "web_robot" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "web_robot_userId_idx" ON "web_robot" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "web_robot_scheduledJobId_idx" ON "web_robot" USING btree ("scheduled_job_id");--> statement-breakpoint
CREATE INDEX "web_robot_archivedAt_idx" ON "web_robot" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "web_robot_run_robotId_idx" ON "web_robot_run" USING btree ("robot_id");--> statement-breakpoint
CREATE INDEX "web_robot_run_robotId_queuedAt_idx" ON "web_robot_run" USING btree ("robot_id","queued_at");--> statement-breakpoint
CREATE INDEX "web_robot_run_status_idx" ON "web_robot_run" USING btree ("status");--> statement-breakpoint
CREATE INDEX "web_robot_run_scheduledJobId_idx" ON "web_robot_run" USING btree ("scheduled_job_id");