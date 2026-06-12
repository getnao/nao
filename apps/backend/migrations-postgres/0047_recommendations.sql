CREATE TABLE "context_recommendation" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"run_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"suggested_file" text NOT NULL,
	"subject_key" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"snoozed_until" timestamp,
	"severity" text DEFAULT 'medium' NOT NULL,
	"impact_score" integer DEFAULT 0 NOT NULL,
	"impact" jsonb,
	"insights" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"suggested_action" text NOT NULL,
	"fix_kind" text,
	"proposed_edits" jsonb,
	"fix_guidance" text,
	"fix_prompt" text,
	"pr_url" text,
	"pr_branch" text,
	"pr_created_at" timestamp,
	"llm_provider" text,
	"llm_model_id" text,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"status_changed_at" timestamp,
	"status_changed_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "context_recommendation_config" (
	"project_id" text PRIMARY KEY NOT NULL,
	"model_provider" text,
	"model_id" text,
	"frequency" text,
	"custom_system_prompt_instructions" text,
	"repo_full_name" text,
	"auto_create_prs" boolean,
	"max_auto_prs_per_run" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "context_recommendation_run" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"chat_id" text,
	"trigger" text DEFAULT 'schedule' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"window_start" timestamp,
	"window_end" timestamp,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"error_message" text,
	"llm_provider" text,
	"llm_model_id" text,
	"input_total_tokens" integer,
	"output_total_tokens" integer,
	"total_tokens" integer,
	CONSTRAINT "context_recommendation_run_id_project_unique" UNIQUE("id","project_id")
);
--> statement-breakpoint
ALTER TABLE "context_recommendation" ADD CONSTRAINT "context_recommendation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_recommendation" ADD CONSTRAINT "context_recommendation_status_changed_by_user_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_recommendation" ADD CONSTRAINT "context_recommendation_run_fk" FOREIGN KEY ("run_id","project_id") REFERENCES "public"."context_recommendation_run"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_recommendation_config" ADD CONSTRAINT "context_recommendation_config_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_recommendation_run" ADD CONSTRAINT "context_recommendation_run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_recommendation_run" ADD CONSTRAINT "context_recommendation_run_chat_id_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chat"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "context_recommendation_project_fingerprint_unique" ON "context_recommendation" USING btree ("project_id","fingerprint");--> statement-breakpoint
CREATE INDEX "context_recommendation_projectId_status_idx" ON "context_recommendation" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "context_recommendation_runId_idx" ON "context_recommendation" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "context_recommendation_run_projectId_idx" ON "context_recommendation_run" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "context_recommendation_run_chatId_idx" ON "context_recommendation_run" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "context_recommendation_run_status_idx" ON "context_recommendation_run" USING btree ("status");