ALTER TABLE "message_part" ADD COLUMN "query_id" text;--> statement-breakpoint
ALTER TABLE "message_part" ADD COLUMN "tool_output_preview" jsonb;--> statement-breakpoint
CREATE INDEX "parts_query_id_idx" ON "message_part" USING btree ("query_id");--> statement-breakpoint
UPDATE "message_part"
SET
	"query_id" = "tool_output"->>'id',
	"tool_output_preview" = CASE
		WHEN jsonb_typeof("tool_output"->'data') = 'array' AND jsonb_array_length("tool_output"->'data') > 100 THEN
			jsonb_set(
				"tool_output",
				'{data}',
				(
					SELECT jsonb_agg("preview_rows"."row" ORDER BY "preview_rows"."position")
					FROM jsonb_array_elements("tool_output"->'data') WITH ORDINALITY AS "preview_rows"("row", "position")
					WHERE "preview_rows"."position" <= 100
				)
			) || '{"is_preview": true}'::jsonb
	END
WHERE "tool_name" IN ('execute_sql', 'execute_semantic_query') AND jsonb_typeof("tool_output") = 'object';
