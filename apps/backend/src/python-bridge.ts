'use strict';

import { dirname, resolve } from 'path';
import pkg from 'python-bridge';
import { fileURLToPath } from 'url';

const { pythonBridge } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface ExecuteSQLRequest {
	sql: string;
	project_id: string;
	dataset_id?: string | null;
	credentials_path?: string | null;
}

interface ExecuteSQLResponse {
	data: Array<Record<string, unknown>>;
	row_count: number;
	columns: string[];
}

export class PythonBridge {
	private python: any;
	private isInitialized = false;

	constructor() {
		const uvVenvPython = resolve(__dirname, '../../../cli/.venv/bin/python');
		this.python = pythonBridge({
			python: uvVenvPython,
		});
	}

	async initialize(): Promise<void> {
		if (this.isInitialized) {
			return;
		}

		const cliPath = resolve(__dirname, '../../../cli');
		await this.python.ex`
			import json
			import sys
			sys.path.insert(0, ${cliPath})
			from nao_core.config import BigQueryConfig
		`;
		this.isInitialized = true;
	}

	async executeSql(request: ExecuteSQLRequest): Promise<ExecuteSQLResponse> {
		await this.initialize();

		if (!this.python) {
			throw new Error('Python bridge not initialized');
		}

		try {
			await this.python.ex`
bq_config = BigQueryConfig(
	name="bigquery_connection",
	project_id=${request.project_id},
	dataset_id=${request.dataset_id},
	credentials_path=${request.credentials_path}
)

connection = bq_config.connect()
result = connection.sql(${request.sql})

df = result.to_pandas()
data = df.to_dict(orient="records")

json_data = json.loads(df.to_json(orient="records", date_format="iso"))
`;

			const result = await this.python`{
	"data": json_data,
	"row_count": len(json_data),
	"columns": df.columns.tolist()
}`;

			return result as ExecuteSQLResponse;
		} catch (error) {
			throw new Error(`BigQuery execution failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	async close() {
		if (this.python) {
			await this.python.end();
			this.isInitialized = false;
		}
	}
}
