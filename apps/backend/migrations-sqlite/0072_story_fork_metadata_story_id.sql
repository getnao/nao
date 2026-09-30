UPDATE `chat`
SET `fork_metadata` = json_set(
	`fork_metadata`,
	'$.id',
	(SELECT `story_id` FROM `shared_story` WHERE `shared_story`.`id` = json_extract(`chat`.`fork_metadata`, '$.id'))
)
WHERE json_extract(`fork_metadata`, '$.type') = 'story_selection'
	AND EXISTS (
		SELECT 1 FROM `shared_story` WHERE `shared_story`.`id` = json_extract(`chat`.`fork_metadata`, '$.id')
	);
