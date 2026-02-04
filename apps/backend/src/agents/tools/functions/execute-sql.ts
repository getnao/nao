import { env } from '../../../env';
import { getProjectFolder } from '../../../utils/tools';
import type { Input, Output } from '../schema/execute-sql';

export const execute = async ({ sql_query, database_id }: Input): Promise<Output> => {
	const naoProjectFolder = getProjectFolder();

	const response = await fetch(`${env.FASTAPI_URL}/execute_sql`, {
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
};
