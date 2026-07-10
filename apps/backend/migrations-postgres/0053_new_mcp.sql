CREATE TABLE "mcp_oauth_client" (
	"project_id" text NOT NULL,
	"server_name" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text,
	"client_data" text,
	"discovery_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_oauth_client_project_id_server_name_pk" PRIMARY KEY("project_id","server_name")
);
--> statement-breakpoint
CREATE TABLE "mcp_user_token" (
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"server_name" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"expires_at" timestamp,
	"scope" text,
	"code_verifier" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_user_token_user_id_project_id_server_name_pk" PRIMARY KEY("user_id","project_id","server_name")
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "disabled_mcp_servers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "disabled_mcp_tools" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_oauth_client" ADD CONSTRAINT "mcp_oauth_client_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_oauth_client" ADD CONSTRAINT "mcp_oauth_client_discovery_user_id_user_id_fk" FOREIGN KEY ("discovery_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_user_token" ADD CONSTRAINT "mcp_user_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_user_token" ADD CONSTRAINT "mcp_user_token_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_user_token_project_server_idx" ON "mcp_user_token" USING btree ("project_id","server_name");