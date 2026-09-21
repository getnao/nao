ALTER TABLE "project" ADD COLUMN "default_models" jsonb;--> statement-breakpoint
UPDATE "project" p
SET "default_models" = jsonb_build_object(
	'mode', 'perCategory',
	'categories', jsonb_build_object(
		'context_recommendation', jsonb_build_object('provider', c."model_provider", 'modelId', c."model_id")
	)
)
FROM "context_recommendation_config" c
WHERE c."project_id" = p."id"
	AND c."model_provider" IS NOT NULL
	AND c."model_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "context_recommendation_config" DROP COLUMN "model_provider";--> statement-breakpoint
ALTER TABLE "context_recommendation_config" DROP COLUMN "model_id";
