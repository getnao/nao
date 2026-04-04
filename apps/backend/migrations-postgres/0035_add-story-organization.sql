CREATE TABLE "story_folder" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "story_folder_userId_name_unique" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "story_organization" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"story_id" text NOT NULL,
	"is_starred" boolean DEFAULT false NOT NULL,
	"folder_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "story_org_userId_chatId_storyId_unique" UNIQUE("user_id","chat_id","story_id")
);
--> statement-breakpoint
ALTER TABLE "story_folder" ADD CONSTRAINT "story_folder_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_organization" ADD CONSTRAINT "story_organization_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_organization" ADD CONSTRAINT "story_organization_chat_id_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_organization" ADD CONSTRAINT "story_organization_folder_id_story_folder_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."story_folder"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "story_folder_userId_idx" ON "story_folder" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "story_org_userId_idx" ON "story_organization" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "story_org_folderId_idx" ON "story_organization" USING btree ("folder_id");