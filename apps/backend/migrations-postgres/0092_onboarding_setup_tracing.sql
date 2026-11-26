ALTER TABLE "warehouse_provisioning_job" ADD COLUMN "steps" jsonb;--> statement-breakpoint
ALTER TABLE "warehouse_provisioning_job" ADD COLUMN "error_detail" text;