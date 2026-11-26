CREATE TABLE "user_group_impersonation" (
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"group_ids" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_group_impersonation_user_id_project_id_pk" PRIMARY KEY("user_id","project_id")
);
--> statement-breakpoint
ALTER TABLE "user_group_impersonation" ADD CONSTRAINT "user_group_impersonation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_group_impersonation" ADD CONSTRAINT "user_group_impersonation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;