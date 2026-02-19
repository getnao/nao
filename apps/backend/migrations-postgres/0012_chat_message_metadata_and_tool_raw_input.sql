ALTER TABLE "chat_message" ADD COLUMN "input_total_tokens" integer;--> statement-breakpoint
ALTER TABLE "chat_message" ADD COLUMN "input_no_cache_tokens" integer;--> statement-breakpoint
ALTER TABLE "chat_message" ADD COLUMN "input_cache_read_tokens" integer;--> statement-breakpoint
ALTER TABLE "chat_message" ADD COLUMN "input_cache_write_tokens" integer;--> statement-breakpoint
ALTER TABLE "chat_message" ADD COLUMN "output_total_tokens" integer;--> statement-breakpoint
ALTER TABLE "chat_message" ADD COLUMN "output_text_tokens" integer;--> statement-breakpoint
ALTER TABLE "chat_message" ADD COLUMN "output_reasoning_tokens" integer;--> statement-breakpoint
ALTER TABLE "chat_message" ADD COLUMN "total_tokens" integer;--> statement-breakpoint
ALTER TABLE "message_part" ADD COLUMN "tool_raw_input" jsonb;--> statement-breakpoint
ALTER TABLE "message_part" ADD COLUMN "tool_provider_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "message_part" ADD COLUMN "provider_metadata" jsonb;--> statement-breakpoint
UPDATE "chat_message" SET
  "input_total_tokens" = sub."input_total_tokens",
  "input_no_cache_tokens" = sub."input_no_cache_tokens",
  "input_cache_read_tokens" = sub."input_cache_read_tokens",
  "input_cache_write_tokens" = sub."input_cache_write_tokens",
  "output_total_tokens" = sub."output_total_tokens",
  "output_text_tokens" = sub."output_text_tokens",
  "output_reasoning_tokens" = sub."output_reasoning_tokens",
  "total_tokens" = sub."total_tokens"
FROM (
  SELECT "message_id",
    MAX("input_total_tokens") AS "input_total_tokens",
    MAX("input_no_cache_tokens") AS "input_no_cache_tokens",
    MAX("input_cache_read_tokens") AS "input_cache_read_tokens",
    MAX("input_cache_write_tokens") AS "input_cache_write_tokens",
    MAX("output_total_tokens") AS "output_total_tokens",
    MAX("output_text_tokens") AS "output_text_tokens",
    MAX("output_reasoning_tokens") AS "output_reasoning_tokens",
    MAX("total_tokens") AS "total_tokens"
  FROM "message_part"
  GROUP BY "message_id"
) sub
WHERE "chat_message"."id" = sub."message_id";--> statement-breakpoint
ALTER TABLE "message_part" DROP COLUMN "input_total_tokens";--> statement-breakpoint
ALTER TABLE "message_part" DROP COLUMN "input_no_cache_tokens";--> statement-breakpoint
ALTER TABLE "message_part" DROP COLUMN "input_cache_read_tokens";--> statement-breakpoint
ALTER TABLE "message_part" DROP COLUMN "input_cache_write_tokens";--> statement-breakpoint
ALTER TABLE "message_part" DROP COLUMN "output_total_tokens";--> statement-breakpoint
ALTER TABLE "message_part" DROP COLUMN "output_text_tokens";--> statement-breakpoint
ALTER TABLE "message_part" DROP COLUMN "output_reasoning_tokens";--> statement-breakpoint
ALTER TABLE "message_part" DROP COLUMN "total_tokens";