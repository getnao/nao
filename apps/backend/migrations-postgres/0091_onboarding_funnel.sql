CREATE TABLE "warehouse_connection_check" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"outcome" text NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "warehouse_provisioning_job" ADD COLUMN "failed_status" text;--> statement-breakpoint
ALTER TABLE "warehouse_connection_check" ADD CONSTRAINT "warehouse_connection_check_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "warehouse_connection_check_userId_idx" ON "warehouse_connection_check" USING btree ("user_id");