ALTER TABLE `message_part` ADD `query_id` text;--> statement-breakpoint
ALTER TABLE `message_part` ADD `tool_output_preview` text;--> statement-breakpoint
CREATE INDEX `parts_query_id_idx` ON `message_part` (`query_id`);--> statement-breakpoint
UPDATE `message_part`
SET
	`query_id` = json_extract(`tool_output`, '$.id'),
	`tool_output_preview` = CASE
		WHEN json_type(`tool_output`, '$.data') = 'array' AND json_array_length(`tool_output`, '$.data') > 100 THEN
			json_set(
				`tool_output`,
				'$.data',
				json((
					SELECT json_group_array(CASE WHEN `type` IN ('object', 'array') THEN json(`value`) ELSE `value` END)
					FROM (
						SELECT `value`, `type`
						FROM json_each(`message_part`.`tool_output`, '$.data')
						ORDER BY `key`
						LIMIT 100
					)
				)),
				'$.is_preview',
				json('true')
			)
	END
WHERE `tool_name` IN ('execute_sql', 'execute_semantic_query') AND json_valid(`tool_output`) AND json_type(`tool_output`) = 'object';
