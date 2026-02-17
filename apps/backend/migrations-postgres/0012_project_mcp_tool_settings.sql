CREATE TABLE "project_mcp_tool_setting" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL,
  "server_name" text NOT NULL,
  "tool_name" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "project_mcp_tool_setting_project_server_tool_unique" UNIQUE("project_id","server_name","tool_name")
);
--> statement-breakpoint
ALTER TABLE "project_mcp_tool_setting" ADD CONSTRAINT "project_mcp_tool_setting_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "project_mcp_tool_setting_projectId_idx" ON "project_mcp_tool_setting" USING btree ("project_id");
