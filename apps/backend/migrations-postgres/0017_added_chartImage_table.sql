CREATE TABLE "chart_image" (
	"tool_call_id" text PRIMARY KEY NOT NULL,
	"data" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
