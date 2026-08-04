CREATE TABLE "recommendation_feedback" (
	"recommendation_id" text NOT NULL,
	"message_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "recommendation_feedback_recommendation_id_message_id_pk" PRIMARY KEY("recommendation_id","message_id")
);
--> statement-breakpoint
ALTER TABLE "context_recommendation" ADD COLUMN "fix_target" text;--> statement-breakpoint
ALTER TABLE "context_recommendation" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "context_recommendation" ADD COLUMN "root_cause" text;--> statement-breakpoint
ALTER TABLE "context_recommendation" ADD COLUMN "root_cause_kind" text;--> statement-breakpoint
ALTER TABLE "recommendation_feedback" ADD CONSTRAINT "recommendation_feedback_recommendation_id_context_recommendation_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."context_recommendation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_feedback" ADD CONSTRAINT "recommendation_feedback_message_id_chat_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_recommendation" DROP COLUMN "snoozed_until";--> statement-breakpoint
ALTER TABLE "context_recommendation" DROP COLUMN "severity";