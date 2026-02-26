import { displayChart, executeSql } from '@nao/shared/tools';
import { eq, sql } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import { takeFirstOrThrow } from '../utils/queries';

export const getChartById = async (id: string): Promise<string> => {
	const result = await takeFirstOrThrow(
		db
			.select({ data: s.message_part_chart_image.data })
			.from(s.message_part_chart_image)
			.where(eq(s.message_part_chart_image.id, id))
			.execute(),
	);
	return result.data;
};

export const getChartConfigByToolCallId = async (toolCallId: string): Promise<displayChart.Input> => {
	const result = await takeFirstOrThrow(
		db
			.select({ toolInput: s.messagePart.toolInput })
			.from(s.messagePart)
			.where(eq(s.messagePart.toolCallId, toolCallId))
			.execute(),
	);
	return result.toolInput as displayChart.Input;
};

export const getChartDataByQueryId = async (queryId: string): Promise<executeSql.Output['data']> => {
	const jsonIdFilter =
		dbConfig.dialect === Dialect.Postgres
			? sql`${s.messagePart.toolOutput}->>'id' = ${queryId}`
			: sql`json_extract(${s.messagePart.toolOutput}, '$.id') = ${queryId}`;

	const result = await takeFirstOrThrow(
		db.select({ toolOutput: s.messagePart.toolOutput }).from(s.messagePart).where(jsonIdFilter).execute(),
	);
	return (result.toolOutput as executeSql.Output).data;
};

export const saveChart = async (toolCallId: string, data: string): Promise<string> => {
	const row = await takeFirstOrThrow(
		db
			.insert(s.message_part_chart_image)
			.values({ toolCallId, data })
			.onConflictDoUpdate({ target: s.message_part_chart_image.toolCallId, set: { data } })
			.returning({ id: s.message_part_chart_image.id })
			.execute(),
	);
	return row.id;
};
