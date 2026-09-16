CREATE TABLE "sandbox_secret" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"encrypted_value" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sandbox_secret" ADD CONSTRAINT "sandbox_secret_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_secret" ADD CONSTRAINT "sandbox_secret_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_secret_user_project_name_idx" ON "sandbox_secret" USING btree ("user_id","project_id","name");--> statement-breakpoint
CREATE INDEX "sandbox_secret_user_project_idx" ON "sandbox_secret" USING btree ("user_id","project_id");