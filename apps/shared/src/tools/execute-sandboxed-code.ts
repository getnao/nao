import z from 'zod/v3';

export const dataFileSchema = z.object({
	query_id: z
		.string()
		.describe(
			'The id of a previous `execute_sql` tool call output (e.g. "query_abc123"). The query result data will be written as a CSV file into the sandbox.',
		),
	filename: z.string().describe('Filename to write inside the sandbox working directory (e.g. "sales.csv").'),
});

export const description = [
	'Execute code inside an isolated sandbox (micro-VM) and return stdout/stderr.',
	'Supports any language available in the container image (Python by default).',
	'Use this for data analysis, visualisations, or anything that needs pip packages or a full OS environment.',
	'You can pre-install Python packages via `packages` and mount previous SQL query results as CSV files via `data_files`.',
	'Data files are written to the working directory `/root/` so code can read them directly by filename (e.g. `pd.read_csv("sales.csv")`).',
].join(' ');

export const inputSchema = z.object({
	code: z.string().describe('The code to execute inside the sandbox.'),
	language: z
		.enum(['python', 'shell'])
		.default('python')
		.describe('The language/runtime to use. "python" runs via `python -c`, "shell" runs via `sh -c`.'),
	packages: z
		.array(z.string())
		.optional()
		.describe('Python packages to attach to the sandbox (e.g. ["pandas", "matplotlib"]).'),
	data_files: z
		.array(dataFileSchema)
		.optional()
		.describe(
			'SQL query results to mount as CSV files in the sandbox. Each references a previous `execute_sql` output by its id.',
		),
});

export const outputSchema = z.object({
	stdout: z.string().describe('Standard output from the execution.'),
	stderr: z.string().describe('Standard error from the execution.'),
	exitCode: z.number().describe('Process exit code (0 = success).'),
});

export type DataFile = z.infer<typeof dataFileSchema>;
export type Input = z.infer<typeof inputSchema>;
export type Output = z.infer<typeof outputSchema>;
