ALTER TABLE `project` ADD `default_models` text;--> statement-breakpoint
UPDATE `project`
SET `default_models` = json_object(
	'mode', 'perCategory',
	'categories', json_object(
		'context_recommendation', json_object(
			'provider', (SELECT `model_provider` FROM `context_recommendation_config` WHERE `project_id` = `project`.`id`),
			'modelId', (SELECT `model_id` FROM `context_recommendation_config` WHERE `project_id` = `project`.`id`)
		)
	)
)
WHERE EXISTS (
	SELECT 1 FROM `context_recommendation_config` `c`
	WHERE `c`.`project_id` = `project`.`id`
		AND `c`.`model_provider` IS NOT NULL
		AND `c`.`model_id` IS NOT NULL
);--> statement-breakpoint
ALTER TABLE `context_recommendation_config` DROP COLUMN `model_provider`;--> statement-breakpoint
ALTER TABLE `context_recommendation_config` DROP COLUMN `model_id`;
