CREATE TABLE "story_folder_group" (
	"folder_id" text NOT NULL,
	"group_id" text NOT NULL,
	CONSTRAINT "story_folder_group_folder_id_group_id_pk" PRIMARY KEY("folder_id","group_id")
);
--> statement-breakpoint
ALTER TABLE "story_folder_group" ADD CONSTRAINT "story_folder_group_folder_id_story_folder_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."story_folder"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_folder_group" ADD CONSTRAINT "story_folder_group_group_id_user_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "story_folder_group_groupId_idx" ON "story_folder_group" USING btree ("group_id");