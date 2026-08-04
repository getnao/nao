ALTER TABLE "context_recommendation" ADD COLUMN "fix_target" text;--> statement-breakpoint
ALTER TABLE "context_recommendation" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "context_recommendation" ADD COLUMN "root_cause" text;--> statement-breakpoint
ALTER TABLE "context_recommendation" ADD COLUMN "root_cause_kind" text;--> statement-breakpoint
ALTER TABLE "context_recommendation" DROP COLUMN "severity";