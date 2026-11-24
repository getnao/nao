CREATE TABLE "user_skill" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"share_status" text DEFAULT 'private' NOT NULL,
	"share_note" text,
	"share_requested_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_skill" ADD CONSTRAINT "user_skill_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_skill" ADD CONSTRAINT "user_skill_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_skill_project_user_name_unique" ON "user_skill" USING btree ("project_id","user_id","name");--> statement-breakpoint
CREATE INDEX "user_skill_project_share_status_idx" ON "user_skill" USING btree ("project_id","share_status");