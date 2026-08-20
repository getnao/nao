CREATE TABLE "budget_notification" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"provider" text NOT NULL,
	"scope" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "budget_notification_project_provider_scope_period" UNIQUE("project_id","provider","scope","period_start")
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link_url" text,
	"payload" jsonb,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_unsubscribe" (
	"user_id" text NOT NULL,
	"scope" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_unsubscribe_user_id_scope_pk" PRIMARY KEY("user_id","scope")
);
--> statement-breakpoint
CREATE TABLE "story_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"story_id" text NOT NULL,
	"project_id" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"cron" text,
	"schedule_description" text,
	"channels" jsonb NOT NULL,
	"recipient_mode" text DEFAULT 'specific' NOT NULL,
	"recipient_user_ids" jsonb NOT NULL,
	"scheduled_job_id" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "story_delivery_story_id_unique" UNIQUE("story_id")
);
--> statement-breakpoint
ALTER TABLE "automation_run" ADD COLUMN "read_at" timestamp;--> statement-breakpoint
ALTER TABLE "budget_notification" ADD CONSTRAINT "budget_notification_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_unsubscribe" ADD CONSTRAINT "notification_unsubscribe_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_delivery" ADD CONSTRAINT "story_delivery_story_id_story_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."story"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_delivery" ADD CONSTRAINT "story_delivery_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_delivery" ADD CONSTRAINT "story_delivery_scheduled_job_id_scheduled_job_id_fk" FOREIGN KEY ("scheduled_job_id") REFERENCES "public"."scheduled_job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_delivery" ADD CONSTRAINT "story_delivery_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_notification_projectId_idx" ON "budget_notification" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "notification_userId_idx" ON "notification" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notification_user_read_idx" ON "notification" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "notification_user_project_read_idx" ON "notification" USING btree ("user_id","project_id","read_at");--> statement-breakpoint
CREATE INDEX "notification_createdAt_idx" ON "notification" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notification_unsubscribe_userId_idx" ON "notification_unsubscribe" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notification_unsubscribe_scope_idx" ON "notification_unsubscribe" USING btree ("scope");--> statement-breakpoint
INSERT INTO "notification" ("id", "user_id", "project_id", "category", "title", "body", "link_url", "payload", "read_at", "created_at")
SELECT
	'activity-' || a."id" || '-' || pm."user_id",
	pm."user_id",
	a."project_id",
	'shared',
	u."name" || ' shared a story with you',
	'"' || st."title" || '"',
	'/stories/shared/' || ss."id",
	jsonb_build_object('kind', 'shared', 'sharerName', u."name", 'itemLabel', 'story', 'itemTitle', st."title", 'visibility', ss."visibility"),
	a."started_at",
	a."started_at"
FROM "activity" a
JOIN "shared_story" ss ON ss."id" = a."shared_story_id"
JOIN "story" st ON st."id" = a."story_id"
JOIN "user" u ON u."id" = a."user_id"
JOIN "project_member" pm ON pm."project_id" = a."project_id" AND pm."user_id" <> a."user_id"
WHERE a."type" = 'story.shared'
	AND ss."visibility" = 'project'
	AND a."started_at" >= now() - interval '90 days'
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "notification" ("id", "user_id", "project_id", "category", "title", "body", "link_url", "payload", "read_at", "created_at")
SELECT
	'activity-' || a."id" || '-' || ssa."user_id",
	ssa."user_id",
	a."project_id",
	'shared',
	u."name" || ' shared a story with you',
	'"' || st."title" || '"',
	'/stories/shared/' || ss."id",
	jsonb_build_object('kind', 'shared', 'sharerName', u."name", 'itemLabel', 'story', 'itemTitle', st."title", 'visibility', ss."visibility"),
	a."started_at",
	a."started_at"
FROM "activity" a
JOIN "shared_story" ss ON ss."id" = a."shared_story_id"
JOIN "shared_story_access" ssa ON ssa."shared_story_id" = ss."id" AND ssa."user_id" <> a."user_id"
JOIN "story" st ON st."id" = a."story_id"
JOIN "user" u ON u."id" = a."user_id"
WHERE a."type" = 'story.shared'
	AND ss."visibility" = 'specific'
	AND a."started_at" >= now() - interval '90 days'
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "notification" ("id", "user_id", "project_id", "category", "title", "body", "link_url", "payload", "read_at", "created_at")
SELECT
	'activity-' || a."id" || '-' || pm."user_id",
	pm."user_id",
	a."project_id",
	'shared',
	u."name" || ' shared a chat with you',
	'"' || ch."title" || '"',
	'/shared-chat/' || sc."id",
	jsonb_build_object('kind', 'shared', 'sharerName', u."name", 'itemLabel', 'chat', 'itemTitle', ch."title", 'visibility', sc."visibility"),
	a."started_at",
	a."started_at"
FROM "activity" a
JOIN "shared_chat" sc ON sc."id" = a."shared_chat_id"
JOIN "chat" ch ON ch."id" = a."chat_id"
JOIN "user" u ON u."id" = a."user_id"
JOIN "project_member" pm ON pm."project_id" = a."project_id" AND pm."user_id" <> a."user_id"
WHERE a."type" = 'chat.shared'
	AND sc."visibility" = 'project'
	AND a."started_at" >= now() - interval '90 days'
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "notification" ("id", "user_id", "project_id", "category", "title", "body", "link_url", "payload", "read_at", "created_at")
SELECT
	'activity-' || a."id" || '-' || sca."user_id",
	sca."user_id",
	a."project_id",
	'shared',
	u."name" || ' shared a chat with you',
	'"' || ch."title" || '"',
	'/shared-chat/' || sc."id",
	jsonb_build_object('kind', 'shared', 'sharerName', u."name", 'itemLabel', 'chat', 'itemTitle', ch."title", 'visibility', sc."visibility"),
	a."started_at",
	a."started_at"
FROM "activity" a
JOIN "shared_chat" sc ON sc."id" = a."shared_chat_id"
JOIN "shared_chat_access" sca ON sca."shared_chat_id" = sc."id" AND sca."user_id" <> a."user_id"
JOIN "chat" ch ON ch."id" = a."chat_id"
JOIN "user" u ON u."id" = a."user_id"
WHERE a."type" = 'chat.shared'
	AND sc."visibility" = 'specific'
	AND a."started_at" >= now() - interval '90 days'
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "notification" ("id", "user_id", "project_id", "category", "title", "body", "link_url", "payload", "read_at", "created_at")
SELECT
	'activity-' || a."id" || '-' || COALESCE(st."user_id", ch."user_id"),
	COALESCE(st."user_id", ch."user_id"),
	a."project_id",
	'story_refresh',
	st."title",
	'Re-ran ' || COALESCE((a."payload"->>'queriesRefreshed')::int, 0) || ' ' || CASE WHEN COALESCE((a."payload"->>'queriesRefreshed')::int, 0) = 1 THEN 'query' ELSE 'queries' END || ' against the latest data.',
	COALESCE('/stories/shared/' || ss."id", '/stories/standalone/' || st."id"),
	jsonb_build_object('kind', 'story_refresh', 'storyId', st."id", 'status', 'refreshed', 'queriesRefreshed', COALESCE((a."payload"->>'queriesRefreshed')::int, 0), 'trigger', CASE WHEN a."trigger" = 'manual' THEN 'manual' ELSE 'schedule' END),
	a."started_at",
	a."started_at"
FROM "activity" a
JOIN "story" st ON st."id" = a."story_id"
LEFT JOIN "chat" ch ON ch."id" = st."chat_id"
LEFT JOIN "shared_story" ss ON ss."story_id" = st."id" AND ss."project_id" = a."project_id"
WHERE a."type" = 'story.refreshed'
	AND a."status" = 'completed'
	AND COALESCE(st."user_id", ch."user_id") IS NOT NULL
	AND a."started_at" >= now() - interval '90 days'
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "notification" ("id", "user_id", "project_id", "category", "title", "body", "link_url", "payload", "read_at", "created_at")
SELECT
	'activity-' || a."id" || '-' || pm."user_id",
	pm."user_id",
	a."project_id",
	'story_refresh',
	st."title",
	'Re-ran ' || COALESCE((a."payload"->>'queriesRefreshed')::int, 0) || ' ' || CASE WHEN COALESCE((a."payload"->>'queriesRefreshed')::int, 0) = 1 THEN 'query' ELSE 'queries' END || ' against the latest data.',
	'/stories/shared/' || ss."id",
	jsonb_build_object('kind', 'story_refresh', 'storyId', st."id", 'status', 'refreshed', 'queriesRefreshed', COALESCE((a."payload"->>'queriesRefreshed')::int, 0), 'trigger', CASE WHEN a."trigger" = 'manual' THEN 'manual' ELSE 'schedule' END),
	a."started_at",
	a."started_at"
FROM "activity" a
JOIN "story" st ON st."id" = a."story_id"
JOIN "shared_story" ss ON ss."story_id" = st."id" AND ss."project_id" = a."project_id" AND ss."visibility" = 'project'
JOIN "project_member" pm ON pm."project_id" = a."project_id"
WHERE a."type" = 'story.refreshed'
	AND a."status" = 'completed'
	AND a."started_at" >= now() - interval '90 days'
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "notification" ("id", "user_id", "project_id", "category", "title", "body", "link_url", "payload", "read_at", "created_at")
SELECT
	'activity-' || a."id" || '-' || ssa."user_id",
	ssa."user_id",
	a."project_id",
	'story_refresh',
	st."title",
	'Re-ran ' || COALESCE((a."payload"->>'queriesRefreshed')::int, 0) || ' ' || CASE WHEN COALESCE((a."payload"->>'queriesRefreshed')::int, 0) = 1 THEN 'query' ELSE 'queries' END || ' against the latest data.',
	'/stories/shared/' || ss."id",
	jsonb_build_object('kind', 'story_refresh', 'storyId', st."id", 'status', 'refreshed', 'queriesRefreshed', COALESCE((a."payload"->>'queriesRefreshed')::int, 0), 'trigger', CASE WHEN a."trigger" = 'manual' THEN 'manual' ELSE 'schedule' END),
	a."started_at",
	a."started_at"
FROM "activity" a
JOIN "story" st ON st."id" = a."story_id"
JOIN "shared_story" ss ON ss."story_id" = st."id" AND ss."project_id" = a."project_id" AND ss."visibility" = 'specific'
JOIN "shared_story_access" ssa ON ssa."shared_story_id" = ss."id"
WHERE a."type" = 'story.refreshed'
	AND a."status" = 'completed'
	AND a."started_at" >= now() - interval '90 days'
ON CONFLICT DO NOTHING;