CREATE TABLE "user_group" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"feature_grants" jsonb DEFAULT '{"version":2,"features":[],"toolCallDensity":{"defaultDensity":"detailed","canChange":true}}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_group_project_name_unique" UNIQUE("project_id","name")
);
--> statement-breakpoint
CREATE TABLE "user_group_member" (
	"group_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_group_member_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "user_group" ADD CONSTRAINT "user_group_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_group_member" ADD CONSTRAINT "user_group_member_group_id_user_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_group_member" ADD CONSTRAINT "user_group_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_group_projectId_idx" ON "user_group" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_group_project_default_unique" ON "user_group" USING btree ("project_id") WHERE "user_group"."is_default" = true;--> statement-breakpoint
INSERT INTO "user_group" ("id", "project_id", "name", "is_default", "feature_grants")
SELECT
	gen_random_uuid()::text,
	"id",
	'All Users',
	true,
	'{"version":2,"features":["story-creation","automation-creation"],"toolCallDensity":{"defaultDensity":"detailed","canChange":true}}'::jsonb
FROM "project";--> statement-breakpoint
CREATE INDEX "user_group_member_userId_idx" ON "user_group_member" USING btree ("user_id");