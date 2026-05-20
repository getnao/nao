CREATE TABLE "mcp_chart_embed" (
	"chart_embed_id" text PRIMARY KEY NOT NULL,
	"query_id" text NOT NULL,
	"chart_config" jsonb NOT NULL,
	"source_chat_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_query_data" (
	"query_id" text PRIMARY KEY NOT NULL,
	"call_log_id" text,
	"project_id" text NOT NULL,
	"source_chat_id" text,
	"columns" jsonb NOT NULL,
	"data" jsonb NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_chart_embed" ADD CONSTRAINT "mcp_chart_embed_query_id_mcp_query_data_query_id_fk" FOREIGN KEY ("query_id") REFERENCES "public"."mcp_query_data"("query_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_query_data" ADD CONSTRAINT "mcp_query_data_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_chart_embed_query_id_idx" ON "mcp_chart_embed" USING btree ("query_id");--> statement-breakpoint
CREATE INDEX "mcp_query_data_project_id_idx" ON "mcp_query_data" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "mcp_query_data_callLogId_idx" ON "mcp_query_data" USING btree ("call_log_id");