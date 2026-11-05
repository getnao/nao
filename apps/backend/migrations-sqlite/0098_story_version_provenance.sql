ALTER TABLE `story_version` ADD `origin` text;--> statement-breakpoint
ALTER TABLE `story_version` ADD `author_id` text REFERENCES user(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `story_version` ADD `source_chat_id` text REFERENCES chat(id) ON DELETE set null;--> statement-breakpoint
UPDATE `story_version`
SET `author_id` = (
	SELECT coalesce(`chat`.`user_id`, `story`.`user_id`)
	FROM `story`
	LEFT JOIN `chat` ON `chat`.`id` = `story`.`chat_id`
	WHERE `story`.`id` = `story_version`.`story_id`
);
--> statement-breakpoint
WITH `story_tool_part` AS MATERIALIZED (
	SELECT `message_part`.`created_at`, `message_part`.`tool_output`, `chat`.`id` AS `chat_id`, `chat`.`fork_metadata`
	FROM `message_part`
	INNER JOIN `chat_message` ON `chat_message`.`id` = `message_part`.`message_id`
	INNER JOIN `chat` ON `chat`.`id` = `chat_message`.`chat_id`
	WHERE `message_part`.`type` = 'tool-story'
		AND `message_part`.`tool_state` = 'output-available'
		AND json_valid(`message_part`.`tool_output`)
		AND json_extract(`message_part`.`tool_output`, '$.success') = 1
),
`version_source_chat` AS (
	SELECT `story_version`.`id` AS `version_id`, `story_tool_part`.`chat_id`,
		row_number() OVER (PARTITION BY `story_version`.`id` ORDER BY `story_tool_part`.`created_at`) AS `rank`
	FROM `story_version`
	INNER JOIN `story` ON `story`.`id` = `story_version`.`story_id`
	INNER JOIN `story_tool_part` ON json_extract(`story_tool_part`.`tool_output`, '$.version') = `story_version`.`version`
		AND `story_tool_part`.`created_at` >= `story_version`.`created_at`
	WHERE `story_version`.`origin` IS NULL
		AND `story_version`.`source` = 'assistant'
		AND (
			json_extract(`story_tool_part`.`tool_output`, '$.story_id') = `story`.`id`
			OR (
				json_extract(`story_tool_part`.`tool_output`, '$.story_id') IS NULL
				AND json_extract(`story_tool_part`.`tool_output`, '$.id') = `story`.`slug`
				AND (
					`story_tool_part`.`chat_id` = `story`.`chat_id`
					OR (json_extract(`story_tool_part`.`fork_metadata`, '$.type') IN ('story_question', 'story_selection') AND json_extract(`story_tool_part`.`fork_metadata`, '$.id') = `story`.`id`)
					OR (json_extract(`story_tool_part`.`fork_metadata`, '$.type') IN ('chat_question', 'chat_selection') AND json_extract(`story_tool_part`.`fork_metadata`, '$.id') = `story`.`chat_id`)
				)
			)
		)
)
UPDATE `story_version`
SET `source_chat_id` = `version_source_chat`.`chat_id`
FROM `version_source_chat`
WHERE `story_version`.`id` = `version_source_chat`.`version_id` AND `version_source_chat`.`rank` = 1;--> statement-breakpoint
UPDATE `story_version`
SET
	`origin` = 'agent',
	`author_id` = (SELECT `chat`.`user_id` FROM `chat` WHERE `chat`.`id` = `story_version`.`source_chat_id`)
WHERE `origin` IS NULL AND `source_chat_id` IS NOT NULL;
