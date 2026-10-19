CREATE TABLE "project_warehouse_credentials" (
	"project_id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"encrypted_credentials" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouse_provisioning_job" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"org_id" text NOT NULL,
	"onboarding_chat_id" text,
	"project_id" text,
	"project_name" text NOT NULL,
	"provider" text NOT NULL,
	"encrypted_credentials" text,
	"business_context" jsonb,
	"model_selection" jsonb,
	"model_project_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"temporary_directory" text,
	"locked_by" text,
	"locked_at" timestamp,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "project_warehouse_credentials" ADD CONSTRAINT "project_warehouse_credentials_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_provisioning_job" ADD CONSTRAINT "warehouse_provisioning_job_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_provisioning_job" ADD CONSTRAINT "warehouse_provisioning_job_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_provisioning_job" ADD CONSTRAINT "warehouse_provisioning_job_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "warehouse_provisioning_job_userId_idx" ON "warehouse_provisioning_job" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "warehouse_provisioning_job_status_idx" ON "warehouse_provisioning_job" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "warehouse_provisioning_job_active_user_idx" ON "warehouse_provisioning_job" USING btree ("user_id") WHERE "warehouse_provisioning_job"."status" NOT IN ('ready', 'failed', 'cancelled');