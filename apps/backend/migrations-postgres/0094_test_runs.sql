CREATE TABLE "test_run" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"triggered_by_user_id" text,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"context_ref" text,
	"context_commit" text,
	"models" jsonb NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"selection" jsonb,
	"total_attempts" integer DEFAULT 0 NOT NULL,
	"completed_attempts" integer DEFAULT 0 NOT NULL,
	"passed_attempts" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"total_cost" double precision,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "test_run_result" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"test_path" text NOT NULL,
	"test_name" text NOT NULL,
	"test_hash" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"llm_provider" text NOT NULL,
	"llm_model_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"passed" boolean NOT NULL,
	"message" text NOT NULL,
	"error_message" text,
	"chat_id" text,
	"total_tokens" integer,
	"total_cost" double precision,
	"duration_ms" integer,
	"tool_call_count" integer,
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "test_run" ADD CONSTRAINT "test_run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_run" ADD CONSTRAINT "test_run_triggered_by_user_id_user_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_run_result" ADD CONSTRAINT "test_run_result_run_id_test_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."test_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_run_result" ADD CONSTRAINT "test_run_result_chat_id_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chat"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "test_run_projectId_idx" ON "test_run" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "test_run_status_idx" ON "test_run" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "test_run_active_project_idx" ON "test_run" USING btree ("project_id") WHERE "test_run"."status" IN ('queued', 'running');--> statement-breakpoint
CREATE INDEX "test_run_result_runId_idx" ON "test_run_result" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "test_run_result_chatId_idx" ON "test_run_result" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "test_run_result_testPath_idx" ON "test_run_result" USING btree ("test_path");