import type { executeSql } from '@nao/shared/tools';
import { executeSql as schemas } from '@nao/shared/tools';

import { ExecuteSqlOutput, renderToModelOutput } from '../../components/tool-outputs';
import { env } from '../../env';
import { ToolContext } from '../../types/tools';
import { isReadOnlySqlQuery } from '../../utils/sql-filter';
import { createTool } from '../../utils/tools';

export async function executeQuery(
	{ sql_query, database_id }: executeSql.Input,
	context: ToolContext,
): Promise<executeSql.Output> {
	const naoProjectFolder = context.projectFolder;

	const writePermEnabled = context.agentSettings?.sql?.dangerouslyWritePermEnabled ?? false;
	if (!writePermEnabled && !(await isReadOnlySqlQuery(sql_query))) {
		throw new Error(
			'Write SQL operations are disabled. Only SELECT queries are allowed. ' +
				'Enable "Dangerous write permissions" in the admin panel to allow INSERT, UPDATE, DELETE and DDL queries.',
		);
	}

	const response = await fetch(`http://localhost:${env.FASTAPI_PORT}/execute_sql`, {
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
		_version: '1',
		...data,
		id: `query_${crypto.randomUUID().slice(0, 8)}`,
	};
}

export default createTool<executeSql.Input, executeSql.Output>({
	description:
		'Execute a SQL query against the connected database and return the results. If multiple databases are configured, specify the database_id.',
	inputSchema: schemas.InputSchema,
	outputSchema: schemas.OutputSchema,
	execute: executeQuery,
	toModelOutput: ({ output }) => renderToModelOutput(ExecuteSqlOutput({ output }), output),
});
