CREATE TABLE "mcp_map_embed" (
	"map_embed_id" text PRIMARY KEY NOT NULL,
	"query_id" text NOT NULL,
	"map_config" jsonb NOT NULL,
	"source_chat_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "map_settings" jsonb;--> statement-breakpoint
ALTER TABLE "mcp_map_embed" ADD CONSTRAINT "mcp_map_embed_query_id_mcp_query_data_query_id_fk" FOREIGN KEY ("query_id") REFERENCES "public"."mcp_query_data"("query_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_map_embed_query_id_idx" ON "mcp_map_embed" USING btree ("query_id");--> statement-breakpoint
UPDATE "project" SET "agent_settings" = jsonb_set("agent_settings", '{mapEnabled}', 'true'::jsonb) WHERE "agent_settings" IS NOT NULL AND ("agent_settings" #> '{experimental,displayMap}') = 'true'::jsonb AND (NOT ("agent_settings" ? 'mapEnabled') OR jsonb_typeof("agent_settings" -> 'mapEnabled') = 'null');--> statement-breakpoint
UPDATE "project" SET "agent_settings" = "agent_settings" #- '{experimental,displayMap}' WHERE "agent_settings" IS NOT NULL AND "agent_settings" #> '{experimental,displayMap}' IS NOT NULL;