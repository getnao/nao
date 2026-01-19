ALTER TABLE "message_part" ADD COLUMN "input_total_tokens" integer;--> statement-breakpoint
ALTER TABLE "message_part" ADD COLUMN "input_no_cache_tokens" integer;--> statement-breakpoint
ALTER TABLE "message_part" ADD COLUMN "input_cache_read_tokens" integer;--> statement-breakpoint
ALTER TABLE "message_part" ADD COLUMN "input_cache_write_tokens" integer;--> statement-breakpoint
ALTER TABLE "message_part" ADD COLUMN "output_total_tokens" integer;--> statement-breakpoint
ALTER TABLE "message_part" ADD COLUMN "output_text_tokens" integer;--> statement-breakpoint
ALTER TABLE "message_part" ADD COLUMN "output_reasoning_tokens" integer;--> statement-breakpoint
ALTER TABLE "message_part" ADD COLUMN "total_tokens" integer;