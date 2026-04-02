CREATE TABLE "project_whatsapp_link" (
	"project_id" text NOT NULL,
	"whatsapp_user_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_whatsapp_link_project_id_whatsapp_user_id_pk" PRIMARY KEY("project_id","whatsapp_user_id")
);
--> statement-breakpoint
ALTER TABLE "project_whatsapp_link" ADD CONSTRAINT "project_whatsapp_link_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_whatsapp_link" ADD CONSTRAINT "project_whatsapp_link_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_whatsapp_link_userId_idx" ON "project_whatsapp_link" USING btree ("user_id");