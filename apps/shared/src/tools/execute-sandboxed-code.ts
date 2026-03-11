import z from 'zod/v3';

export const SANDBOX_IMAGES = ['python:3.12-slim', 'python:3.12', 'node:22-slim', 'node:22', 'ubuntu:24.04'] as const;

export const VM_SIZE_SPECS = {
	xxs: { memoryMib: 256, cpus: 1, diskSizeGb: 1 },
	xs: { memoryMib: 512, cpus: 1, diskSizeGb: 2 },
	s: { memoryMib: 1024, cpus: 2, diskSizeGb: 4 },
	m: { memoryMib: 2048, cpus: 4, diskSizeGb: 8 },
	l: { memoryMib: 4096, cpus: 8, diskSizeGb: 16 },
} as const;

export type VmSize = keyof typeof VM_SIZE_SPECS;

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
	'When using a sandbox the project context files are automatically mounted so code can read them directly (e.g. `open("context/RULES.md") or list("context/databases")`).',
	'You can pre-install Python packages via `packages` and mount previous SQL query results as CSV files via `data_files`.',
	'Data files are written to the working directory `/root/` so code can read them directly by filename (e.g. `pd.read_csv("sales.csv")`).',
	'Choose `image` based on the language/tools needed and `vm_size` based on workload intensity (default: "s").',
	'To reuse a running sandbox (keeping installed packages, files, and state), pass the `sandbox_id` from a previous call. Sandboxes stay alive for 5 minutes after last use.',
].join(' ');

export const inputSchema = z.object({
	sandbox_id: z
		.string()
		.optional()
		.describe(
			'ID of a previously created sandbox to reuse. Omit to create a new sandbox. When reusing, `image` and `vm_size` are ignored.',
		),
	code: z.string().describe('The code to execute inside the sandbox.'),
	language: z
		.enum(['python', 'shell'])
		.default('python')
		.describe('The language/runtime to use. "python" runs via `python -c`, "shell" runs via `sh -c`.'),
	image: z
		.enum(SANDBOX_IMAGES)
		.default('python:3.12-slim')
		.describe('Container image for the sandbox. Pick based on the language and system tools you need.'),
	vm_size: z
		.enum(['xxs', 'xs', 's', 'm', 'l'] as const)
		.default('xxs')
		.describe(
			'VM resource bundle. xxs=256MB/1cpu, xs=512MB/1cpu, s=1GB/2cpu, m=2GB/4cpu, l=4GB/8cpu. Use "xxs" for most tasks, "m" or "l" for heavy data processing.',
		),
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
	sandbox_id: z.string().describe('ID of the sandbox. Pass this to a subsequent call to reuse it.'),
	stdout: z.string().describe('Standard output from the execution.'),
	stderr: z.string().describe('Standard error from the execution.'),
	exitCode: z.number().describe('Process exit code (0 = success).'),
});

export type DataFile = z.infer<typeof dataFileSchema>;
export type Input = z.infer<typeof inputSchema>;
export type Output = z.infer<typeof outputSchema>;
