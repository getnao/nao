ALTER TABLE "story_version" ADD COLUMN "is_live" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "story_version" ADD COLUMN "cache_schedule" text;--> statement-breakpoint
ALTER TABLE "story_version" ADD COLUMN "refresh_text" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE "story_data_cache" (
	"chat_id" text NOT NULL,
	"story_id" text NOT NULL,
	"query_data" jsonb NOT NULL,
	"regenerated_code" text,
	"cached_at" timestamp DEFAULT now() NOT NULL,
	PRIMARY KEY("chat_id","story_id"),
	CONSTRAINT "story_data_cache_chat_id_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chat"("id") ON DELETE cascade ON UPDATE no action
);
