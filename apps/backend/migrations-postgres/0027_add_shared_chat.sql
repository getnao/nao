CREATE TABLE "shared_chat" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"visibility" text DEFAULT 'project' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "shared_chat_chatId_unique" UNIQUE("chat_id")
);
--> statement-breakpoint
CREATE TABLE "shared_chat_access" (
	"shared_chat_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "shared_chat_access_shared_chat_id_user_id_pk" PRIMARY KEY("shared_chat_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "shared_chat" ADD CONSTRAINT "shared_chat_chat_id_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_chat_access" ADD CONSTRAINT "shared_chat_access_shared_chat_id_shared_chat_id_fk" FOREIGN KEY ("shared_chat_id") REFERENCES "public"."shared_chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_chat_access" ADD CONSTRAINT "shared_chat_access_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;