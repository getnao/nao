CREATE TABLE "story_favorite" (
	"user_id" text NOT NULL,
	"story_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "story_favorite_user_id_story_id_pk" PRIMARY KEY("user_id","story_id")
);
--> statement-breakpoint
CREATE TABLE "story_folder" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"favorited_at" timestamp,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_folder_item" (
	"user_id" text NOT NULL,
	"story_id" text NOT NULL,
	"folder_id" text NOT NULL,
	CONSTRAINT "story_folder_item_user_id_story_id_pk" PRIMARY KEY("user_id","story_id")
);
--> statement-breakpoint
ALTER TABLE "shared_story" ADD COLUMN "is_pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "story_favorite" ADD CONSTRAINT "story_favorite_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_favorite" ADD CONSTRAINT "story_favorite_story_id_story_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."story"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_folder" ADD CONSTRAINT "story_folder_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_folder" ADD CONSTRAINT "story_folder_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_folder_item" ADD CONSTRAINT "story_folder_item_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_folder_item" ADD CONSTRAINT "story_folder_item_story_id_story_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."story"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_folder_item" ADD CONSTRAINT "story_folder_item_folder_id_story_folder_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."story_folder"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "story_favorite_userId_idx" ON "story_favorite" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "story_favorite_storyId_idx" ON "story_favorite" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "story_folder_userId_projectId_parentId_idx" ON "story_folder" USING btree ("user_id","project_id","parent_id");--> statement-breakpoint
CREATE INDEX "story_folder_projectId_idx" ON "story_folder" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "story_folder_item_folderId_idx" ON "story_folder_item" USING btree ("folder_id");