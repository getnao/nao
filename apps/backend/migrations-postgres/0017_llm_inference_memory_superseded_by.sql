CREATE TABLE "llm_inference" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"chat_id" text,
	"type" text NOT NULL,
	"llm_provider" text NOT NULL,
	"llm_model_id" text NOT NULL,
	"input_total_tokens" integer,
	"input_no_cache_tokens" integer,
	"input_cache_read_tokens" integer,
	"input_cache_write_tokens" integer,
	"output_total_tokens" integer,
	"output_text_tokens" integer,
	"output_reasoning_tokens" integer,
	"total_tokens" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "superseded_by" text;--> statement-breakpoint
ALTER TABLE "llm_inference" ADD CONSTRAINT "llm_inference_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_inference" ADD CONSTRAINT "llm_inference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_inference" ADD CONSTRAINT "llm_inference_chat_id_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chat"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "llm_inference_projectId_idx" ON "llm_inference" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "llm_inference_userId_idx" ON "llm_inference" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "llm_inference_type_idx" ON "llm_inference" USING btree ("type");--> statement-breakpoint
CREATE INDEX "memories_supersededBy_idx" ON "memories" USING btree ("superseded_by");