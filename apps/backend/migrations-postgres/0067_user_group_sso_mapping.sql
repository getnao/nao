CREATE TABLE "user_group_sso_member" (
	"group_id" text NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_group_sso_member_group_id_user_id_provider_pk" PRIMARY KEY("group_id","user_id","provider")
);
--> statement-breakpoint
ALTER TABLE "user_group" ADD COLUMN "sso_mappings" jsonb;--> statement-breakpoint
ALTER TABLE "user_group_sso_member" ADD CONSTRAINT "user_group_sso_member_group_id_user_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_group_sso_member" ADD CONSTRAINT "user_group_sso_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_group_sso_member_user_provider_idx" ON "user_group_sso_member" USING btree ("user_id","provider");