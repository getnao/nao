CREATE TABLE "mcp_oauth_flow" (
	"state" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"server_name" text NOT NULL,
	"code_verifier" text NOT NULL,
	"return_to" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_oauth_flow" ADD CONSTRAINT "mcp_oauth_flow_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_oauth_flow" ADD CONSTRAINT "mcp_oauth_flow_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_oauth_flow_expiresAt_idx" ON "mcp_oauth_flow" USING btree ("expires_at");