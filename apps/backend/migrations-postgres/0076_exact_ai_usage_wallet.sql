CREATE TABLE "ai_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"operation_id" text NOT NULL,
	"run_id" text NOT NULL,
	"wallet_id" text,
	"user_id" text,
	"org_id" text,
	"project_id" text,
	"chat_id" text,
	"chat_message_id" text,
	"category" text NOT NULL,
	"llm_provider" text NOT NULL,
	"llm_model_id" text NOT NULL,
	"is_managed" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"finish_reason" text,
	"provider_request_id" text,
	"input_total_tokens" integer,
	"input_no_cache_tokens" integer DEFAULT 0 NOT NULL,
	"input_cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"input_cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"output_total_tokens" integer DEFAULT 0 NOT NULL,
	"output_text_tokens" integer,
	"output_reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer,
	"input_no_cache_rate_micro_usd" bigint,
	"input_cache_read_rate_micro_usd" bigint,
	"input_cache_write_rate_micro_usd" bigint,
	"output_rate_micro_usd" bigint,
	"input_no_cache_cost_micro_usd" bigint,
	"input_cache_read_cost_micro_usd" bigint,
	"input_cache_write_cost_micro_usd" bigint,
	"output_cost_micro_usd" bigint,
	"upstream_cost_micro_usd" bigint,
	"customer_charge_micro_usd" bigint DEFAULT 0 NOT NULL,
	"cost_source" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_usage_operation_id_unique" UNIQUE("operation_id")
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet_id" text,
	"usage_id" text,
	"entry_type" text NOT NULL,
	"delta_micro_usd" bigint NOT NULL,
	"balance_after_micro_usd" bigint NOT NULL,
	"idempotency_key" text NOT NULL,
	"external_reference" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credit_ledger_usage_id_unique" UNIQUE("usage_id"),
	CONSTRAINT "credit_ledger_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "credit_wallet" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"balance_micro_usd" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_wallet_id_credit_wallet_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."credit_wallet"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_chat_id_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chat"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_wallet_id_credit_wallet_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."credit_wallet"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_usage_id_ai_usage_id_fk" FOREIGN KEY ("usage_id") REFERENCES "public"."ai_usage"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_wallet" ADD CONSTRAINT "credit_wallet_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_orgId_createdAt_idx" ON "ai_usage" USING btree ("org_id","started_at","id");--> statement-breakpoint
CREATE INDEX "ai_usage_userId_createdAt_idx" ON "ai_usage" USING btree ("user_id","started_at","id");--> statement-breakpoint
CREATE INDEX "ai_usage_userId_runId_idx" ON "ai_usage" USING btree ("user_id","run_id");--> statement-breakpoint
CREATE INDEX "ai_usage_projectId_createdAt_idx" ON "ai_usage" USING btree ("project_id","started_at","id");--> statement-breakpoint
CREATE INDEX "ai_usage_chatMessageId_idx" ON "ai_usage" USING btree ("chat_message_id");--> statement-breakpoint
CREATE INDEX "ai_usage_status_idx" ON "ai_usage" USING btree ("status");--> statement-breakpoint
CREATE INDEX "credit_ledger_walletId_createdAt_idx" ON "credit_ledger" USING btree ("wallet_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_wallet_orgId_idx" ON "credit_wallet" USING btree ("org_id");