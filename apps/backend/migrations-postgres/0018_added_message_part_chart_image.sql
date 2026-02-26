CREATE TABLE "chart_image" (
	"id" text PRIMARY KEY NOT NULL,
	"tool_call_id" text NOT NULL,
	"data" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chart_image_tool_call_id_unique" UNIQUE("tool_call_id")
);
--> statement-breakpoint
ALTER TABLE "message_part" ADD CONSTRAINT "message_part_tool_call_id_unique" UNIQUE("tool_call_id");