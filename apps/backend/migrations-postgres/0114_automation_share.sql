CREATE TABLE "automation_share" (
	"id" text PRIMARY KEY NOT NULL,
	"automation_id" text NOT NULL,
	"user_id" text,
	"group_id" text,
	"role" text DEFAULT 'viewer' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation_share" ADD CONSTRAINT "automation_share_automation_id_automation_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_share" ADD CONSTRAINT "automation_share_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_share" ADD CONSTRAINT "automation_share_group_id_user_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_share_automationId_idx" ON "automation_share" USING btree ("automation_id");--> statement-breakpoint
CREATE INDEX "automation_share_userId_idx" ON "automation_share" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "automation_share_groupId_idx" ON "automation_share" USING btree ("group_id");