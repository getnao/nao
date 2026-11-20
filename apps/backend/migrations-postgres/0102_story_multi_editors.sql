CREATE TABLE "shared_chat_group_access" (
	"shared_chat_id" text NOT NULL,
	"group_id" text NOT NULL,
	CONSTRAINT "shared_chat_group_access_shared_chat_id_group_id_pk" PRIMARY KEY("shared_chat_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "story_edit_lock" (
	"story_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"chat_id" text,
	"session_id" text,
	"expires_at" timestamp NOT NULL,
	"acquired_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shared_story" ADD COLUMN "project_role" text DEFAULT 'viewer' NOT NULL;--> statement-breakpoint
ALTER TABLE "shared_story_access" ADD COLUMN "role" text DEFAULT 'viewer' NOT NULL;--> statement-breakpoint
ALTER TABLE "shared_story_group_access" ADD COLUMN "role" text DEFAULT 'viewer' NOT NULL;--> statement-breakpoint
ALTER TABLE "shared_chat_group_access" ADD CONSTRAINT "shared_chat_group_access_shared_chat_id_shared_chat_id_fk" FOREIGN KEY ("shared_chat_id") REFERENCES "public"."shared_chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_chat_group_access" ADD CONSTRAINT "shared_chat_group_access_group_id_user_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_edit_lock" ADD CONSTRAINT "story_edit_lock_story_id_story_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."story"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_edit_lock" ADD CONSTRAINT "story_edit_lock_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_edit_lock" ADD CONSTRAINT "story_edit_lock_chat_id_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shared_chat_group_access_groupId_idx" ON "shared_chat_group_access" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "story_edit_lock_userId_idx" ON "story_edit_lock" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "story_edit_lock_chatId_idx" ON "story_edit_lock" USING btree ("chat_id");