ALTER TABLE "chat_message" ADD COLUMN "llm_provider" text;--> statement-breakpoint
ALTER TABLE "chat_message" ADD COLUMN "llm_model_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "requires_password_reset" boolean DEFAULT false NOT NULL;