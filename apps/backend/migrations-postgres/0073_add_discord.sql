CREATE TABLE "project_discord_link" (
	"project_id" text NOT NULL,
	"discord_user_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_discord_link_project_id_discord_user_id_pk" PRIMARY KEY("project_id","discord_user_id")
);
--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "discord_thread_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "discord_settings" jsonb;--> statement-breakpoint
ALTER TABLE "project_discord_link" ADD CONSTRAINT "project_discord_link_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_discord_link" ADD CONSTRAINT "project_discord_link_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_discord_link_userId_idx" ON "project_discord_link" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chat_discord_thread_idx" ON "chat" USING btree ("discord_thread_id");