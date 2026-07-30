CREATE TABLE "context_file_edit" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"path" text NOT NULL,
	"user_id" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "context_file_edit_project_path_unique" UNIQUE("project_id","path")
);
--> statement-breakpoint
ALTER TABLE "context_file_edit" ADD CONSTRAINT "context_file_edit_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_file_edit" ADD CONSTRAINT "context_file_edit_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "context_file_edit_projectId_idx" ON "context_file_edit" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "context_file_edit_userId_idx" ON "context_file_edit" USING btree ("user_id");