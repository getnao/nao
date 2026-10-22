CREATE TABLE "example_chat_allowance" (
	"user_id" text NOT NULL,
	"scope" text NOT NULL,
	"used_runs" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "example_chat_allowance_user_id_scope_pk" PRIMARY KEY("user_id","scope")
);
--> statement-breakpoint
ALTER TABLE "example_chat_allowance" ADD CONSTRAINT "example_chat_allowance_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;