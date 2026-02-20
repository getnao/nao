ALTER TABLE "project" ADD COLUMN "enabled_tools" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "known_mcp_servers" jsonb DEFAULT '[]'::jsonb NOT NULL;