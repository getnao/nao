ALTER TABLE "log" ADD COLUMN "object_type" text;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "object_id" text;--> statement-breakpoint
CREATE INDEX "log_object_idx" ON "log" USING btree ("object_type","object_id","created_at");