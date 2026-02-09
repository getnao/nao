import type { executeSql } from '@nao/shared/tools';
import { executeSql as schemas } from '@nao/shared/tools';
import { tool } from 'ai';

import { env } from '../../env';
import { getProjectFolder } from '../../utils/tools';

export async function executeQuery({ sql_query, database_id }: executeSql.Input): Promise<executeSql.Output> {
	const naoProjectFolder = getProjectFolder();

	const fastApiBaseUrl =
		env.FASTAPI_URL || `http://127.0.0.1:${process.env.FASTAPI_PORT ?? '8005'}`;
	const executeSqlUrl = new URL('/execute_sql', fastApiBaseUrl).toString();

	const response = await fetch(executeSqlUrl, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			sql: sql_query,
			nao_project_folder: naoProjectFolder,
			...(database_id && { database_id }),
		}),
	});

	if (!response.ok) {
		const errorData = await response.json().catch(() => ({ detail: response.statusText }));
		throw new Error(`Error executing SQL query: ${JSON.stringify(errorData.detail)}`);
	}

	const data = await response.json();
	return {
		...data,
		id: `query_${crypto.randomUUID().slice(0, 8)}`,
	};
}

export default tool({
	description:
		'Execute a SQL query against the connected database and return the results. If multiple databases are configured, specify the database_id.',
	inputSchema: schemas.InputSchema,
	outputSchema: schemas.OutputSchema,
	execute: executeQuery,
});
