CREATE TABLE "context_branch_ownership" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"branch" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "context_branch_ownership_project_branch_unique" UNIQUE("project_id","branch")
);
--> statement-breakpoint
ALTER TABLE "context_branch_ownership" ADD CONSTRAINT "context_branch_ownership_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_branch_ownership" ADD CONSTRAINT "context_branch_ownership_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "context_branch_ownership_userId_idx" ON "context_branch_ownership" USING btree ("user_id");