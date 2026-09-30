CREATE TABLE "shared_story_group_access" (
	"shared_story_id" text NOT NULL,
	"group_id" text NOT NULL,
	CONSTRAINT "shared_story_group_access_shared_story_id_group_id_pk" PRIMARY KEY("shared_story_id","group_id")
);
--> statement-breakpoint
ALTER TABLE "shared_story_group_access" ADD CONSTRAINT "shared_story_group_access_shared_story_id_shared_story_id_fk" FOREIGN KEY ("shared_story_id") REFERENCES "public"."shared_story"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_story_group_access" ADD CONSTRAINT "shared_story_group_access_group_id_user_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shared_story_group_access_groupId_idx" ON "shared_story_group_access" USING btree ("group_id");