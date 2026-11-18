CREATE UNLOGGED TABLE "agent_stream_chunk" (
	"stream_id" text NOT NULL,
	"seq" integer NOT NULL,
	"chunks" jsonb NOT NULL,
	"is_final" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_stream_chunk_stream_id_seq_pk" PRIMARY KEY("stream_id","seq")
);
--> statement-breakpoint
CREATE UNLOGGED TABLE "agent_stream_run" (
	"chat_id" text PRIMARY KEY NOT NULL,
	"stream_id" text NOT NULL,
	"heartbeat_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_stream_run" ADD CONSTRAINT "agent_stream_run_chat_id_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_stream_chunk_createdAt_idx" ON "agent_stream_chunk" USING btree ("created_at");