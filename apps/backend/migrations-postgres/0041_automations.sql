CREATE TABLE "automation" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"scheduled_job_id" text,
	"title" text NOT NULL,
	"prompt" text NOT NULL,
	"schedule_description" text,
	"timezone" text,
	"model_provider" text,
	"model_id" text,
	"mcp_enabled" boolean DEFAULT true NOT NULL,
	"mcp_servers" jsonb,
	"integrations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_run" (
	"id" text PRIMARY KEY NOT NULL,
	"automation_id" text NOT NULL,
	"chat_id" text,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"error_message" text,
	"integration_results" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation" ADD CONSTRAINT "automation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation" ADD CONSTRAINT "automation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation" ADD CONSTRAINT "automation_scheduled_job_id_scheduled_job_id_fk" FOREIGN KEY ("scheduled_job_id") REFERENCES "public"."scheduled_job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_automation_id_automation_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_chat_id_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chat"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_projectId_idx" ON "automation" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "automation_userId_idx" ON "automation" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "automation_scheduledJobId_idx" ON "automation" USING btree ("scheduled_job_id");--> statement-breakpoint
CREATE INDEX "automation_run_automationId_idx" ON "automation_run" USING btree ("automation_id");--> statement-breakpoint
CREATE INDEX "automation_run_chatId_idx" ON "automation_run" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "automation_run_status_idx" ON "automation_run" USING btree ("status");