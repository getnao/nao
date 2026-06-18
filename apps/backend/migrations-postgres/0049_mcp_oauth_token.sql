CREATE TABLE "mcp_oauth_token" (
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"server_name" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"client_info" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_oauth_token_user_id_project_id_server_name_pk" PRIMARY KEY("user_id","project_id","server_name")
);
--> statement-breakpoint
ALTER TABLE "mcp_oauth_token" ADD CONSTRAINT "mcp_oauth_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_oauth_token" ADD CONSTRAINT "mcp_oauth_token_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_oauth_token_projectId_idx" ON "mcp_oauth_token" USING btree ("project_id");