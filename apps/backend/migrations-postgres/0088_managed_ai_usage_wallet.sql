CREATE TABLE "credit_grant_candidate" (
	"id" text PRIMARY KEY NOT NULL,
	"grant_type" text NOT NULL,
	"org_id" text,
	"user_id" text,
	"project_id" text,
	"source_key" text NOT NULL,
	"activated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credit_grant_candidate_source_key_unique" UNIQUE("source_key")
);
--> statement-breakpoint
CREATE TABLE "credit_grant_policy" (
	"grant_type" text PRIMARY KEY NOT NULL,
	"amount_micro_usd" bigint NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "credit_grant_policy" ("grant_type", "amount_micro_usd") VALUES
	('organization_setup', 20000000),
	('user_join', 5000000);
--> statement-breakpoint
INSERT INTO "credit_grant_candidate" (
	"id",
	"grant_type",
	"org_id",
	"project_id",
	"source_key",
	"created_at"
)
SELECT
	'legacy-project-setup:' || "project"."id",
	'organization_setup',
	"project"."org_id",
	"project"."id",
	'project:' || "project"."id",
	"project"."created_at"
FROM "project"
WHERE "project"."org_id" IS NOT NULL
ON CONFLICT ("source_key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "credit_grant_candidate" (
	"id",
	"grant_type",
	"org_id",
	"user_id",
	"source_key",
	"activated_at",
	"created_at"
)
SELECT
	'legacy-org-member:' || "org_member"."org_id" || ':' || "org_member"."user_id",
	'user_join',
	"org_member"."org_id",
	"org_member"."user_id",
	'org-member:' || "org_member"."org_id" || ':' || "org_member"."user_id",
	CASE
		WHEN NOT "user"."requires_password_reset"
			OR EXISTS (SELECT 1 FROM "session" WHERE "session"."user_id" = "org_member"."user_id")
		THEN now()
		ELSE NULL
	END,
	"org_member"."created_at"
FROM "org_member"
INNER JOIN "user" ON "user"."id" = "org_member"."user_id"
ON CONFLICT ("source_key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "credit_grant_candidate" (
	"id",
	"grant_type",
	"org_id",
	"user_id",
	"project_id",
	"source_key",
	"activated_at",
	"created_at"
)
SELECT
	'legacy-project-member:' || "project_member"."project_id" || ':' || "project_member"."user_id",
	'user_join',
	"project"."org_id",
	"project_member"."user_id",
	"project_member"."project_id",
	'project-member:' || "project_member"."project_id" || ':' || "project_member"."user_id",
	CASE
		WHEN NOT "user"."requires_password_reset"
			OR EXISTS (SELECT 1 FROM "session" WHERE "session"."user_id" = "project_member"."user_id")
		THEN now()
		ELSE NULL
	END,
	"project_member"."created_at"
FROM "project_member"
INNER JOIN "project" ON "project"."id" = "project_member"."project_id"
INNER JOIN "user" ON "user"."id" = "project_member"."user_id"
WHERE "project"."org_id" IS NOT NULL
ON CONFLICT ("source_key") DO NOTHING;
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet_id" text,
	"usage_id" text,
	"entry_type" text NOT NULL,
	"delta_micro_usd" bigint NOT NULL,
	"balance_after_micro_usd" bigint NOT NULL,
	"transaction_sequence" bigint DEFAULT 0 NOT NULL,
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
	"ledger_sequence" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "managed_ai_usage" (
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
	"input_no_cache_rate_micro_usd_per_million_tokens" bigint,
	"input_cache_read_rate_micro_usd_per_million_tokens" bigint,
	"input_cache_write_rate_micro_usd_per_million_tokens" bigint,
	"output_rate_micro_usd_per_million_tokens" bigint,
	"input_no_cache_cost_micro_usd" bigint,
	"input_cache_read_cost_micro_usd" bigint,
	"input_cache_write_cost_micro_usd" bigint,
	"output_cost_micro_usd" bigint,
	"upstream_cost_micro_usd" bigint,
	"customer_charge_micro_usd" bigint DEFAULT 0 NOT NULL,
	"cost_source" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "managed_ai_usage_operation_id_unique" UNIQUE("operation_id")
);
--> statement-breakpoint
ALTER TABLE "credit_grant_candidate" ADD CONSTRAINT "credit_grant_candidate_grant_type_credit_grant_policy_grant_type_fk" FOREIGN KEY ("grant_type") REFERENCES "public"."credit_grant_policy"("grant_type") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_grant_candidate" ADD CONSTRAINT "credit_grant_candidate_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_grant_candidate" ADD CONSTRAINT "credit_grant_candidate_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_grant_candidate" ADD CONSTRAINT "credit_grant_candidate_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_wallet_id_credit_wallet_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."credit_wallet"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_usage_id_managed_ai_usage_id_fk" FOREIGN KEY ("usage_id") REFERENCES "public"."managed_ai_usage"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_wallet" ADD CONSTRAINT "credit_wallet_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_ai_usage" ADD CONSTRAINT "managed_ai_usage_wallet_id_credit_wallet_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."credit_wallet"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_ai_usage" ADD CONSTRAINT "managed_ai_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_ai_usage" ADD CONSTRAINT "managed_ai_usage_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_ai_usage" ADD CONSTRAINT "managed_ai_usage_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_ai_usage" ADD CONSTRAINT "managed_ai_usage_chat_id_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chat"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_grant_candidate_orgId_grantType_idx" ON "credit_grant_candidate" USING btree ("org_id","grant_type");--> statement-breakpoint
CREATE INDEX "credit_grant_candidate_userId_grantType_idx" ON "credit_grant_candidate" USING btree ("user_id","grant_type");--> statement-breakpoint
CREATE INDEX "credit_grant_candidate_projectId_grantType_idx" ON "credit_grant_candidate" USING btree ("project_id","grant_type");--> statement-breakpoint
CREATE INDEX "credit_ledger_walletId_createdAt_idx" ON "credit_ledger" USING btree ("wallet_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_wallet_orgId_idx" ON "credit_wallet" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "managed_ai_usage_orgId_startedAt_idx" ON "managed_ai_usage" USING btree ("org_id","started_at","id");--> statement-breakpoint
CREATE INDEX "managed_ai_usage_userId_startedAt_idx" ON "managed_ai_usage" USING btree ("user_id","started_at","id");--> statement-breakpoint
CREATE INDEX "managed_ai_usage_userId_runId_idx" ON "managed_ai_usage" USING btree ("user_id","run_id");--> statement-breakpoint
CREATE INDEX "managed_ai_usage_projectId_startedAt_idx" ON "managed_ai_usage" USING btree ("project_id","started_at","id");--> statement-breakpoint
CREATE INDEX "managed_ai_usage_chatId_idx" ON "managed_ai_usage" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "managed_ai_usage_chatMessageId_idx" ON "managed_ai_usage" USING btree ("chat_message_id");--> statement-breakpoint
CREATE INDEX "managed_ai_usage_status_idx" ON "managed_ai_usage" USING btree ("status");