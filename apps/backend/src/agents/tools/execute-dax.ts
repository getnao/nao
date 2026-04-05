import type { executeDax } from '@nao/shared/tools';
import { executeDax as schemas } from '@nao/shared/tools';

import { ExecuteSqlOutput, renderToModelOutput } from '../../components/tool-outputs';
import { env } from '../../env';
import { ToolContext } from '../../types/tools';
import { createTool } from '../../utils/tools';

export async function executeDaxQuery(
	{ dax_query, database_id }: executeDax.Input,
	context: ToolContext,
): Promise<executeDax.Output> {
	const naoProjectFolder = context.projectFolder;

	const response = await fetch(`http://localhost:${env.FASTAPI_PORT}/execute_dax`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			dax: dax_query,
			nao_project_folder: naoProjectFolder,
			...(database_id && { database_id }),
		}),
	});

	if (!response.ok) {
		const errorData = await response.json().catch(() => ({ detail: response.statusText }));
		throw new Error(`Error executing DAX query: ${JSON.stringify(errorData.detail)}`);
	}

	const data = await response.json();
	const id = `query_${crypto.randomUUID().slice(0, 8)}` as const;

	context.queryResults.set(id, { columns: data.columns, data: data.data });

	return {
		_version: '1',
		...data,
		id,
	};
}

export default createTool<executeDax.Input, executeDax.Output>({
	description:
		'Execute a DAX EVALUATE query against a Power BI Semantic Model (XMLA) and return tabular results. ' +
		'Always start the query with EVALUATE. Use execute_sql for SQL databases instead.',
	inputSchema: schemas.InputSchema,
	outputSchema: schemas.OutputSchema,
	execute: executeDaxQuery,
	toModelOutput: ({ output }) => renderToModelOutput(ExecuteSqlOutput({ output }), output),
});
