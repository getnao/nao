CREATE TABLE "story_query" (
	"story_id" text NOT NULL,
	"query_id" text NOT NULL,
	"sql_query" text NOT NULL,
	"database_id" text,
	"dialect" text,
	"admin_mode" boolean DEFAULT false NOT NULL,
	"semantic_query" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "story_query_story_id_query_id_pk" PRIMARY KEY("story_id","query_id")
);
--> statement-breakpoint
ALTER TABLE "story_query" ADD CONSTRAINT "story_query_story_id_story_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."story"("id") ON DELETE cascade ON UPDATE no action;