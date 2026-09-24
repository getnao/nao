CREATE TABLE "story_row_review" (
	"story_id" text NOT NULL,
	"row_id" text NOT NULL,
	"decision" text NOT NULL,
	"reason" text,
	"reviewer_id" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "story_row_review_story_id_row_id_pk" PRIMARY KEY("story_id","row_id")
);
--> statement-breakpoint
ALTER TABLE "story_row_review" ADD CONSTRAINT "story_row_review_story_id_story_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."story"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_row_review" ADD CONSTRAINT "story_row_review_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "story_row_review_reviewer_idx" ON "story_row_review" USING btree ("reviewer_id");