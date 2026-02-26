import { executeSandboxedCode as schemas } from '@nao/shared/tools';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { QueryResult } from '../../types/tools';
import { createTool } from '../../utils/tools';

let boxliteModule: typeof import('@boxlite-ai/boxlite') | null = null;
try {
	boxliteModule = await import('@boxlite-ai/boxlite');
} catch {
	console.warn('⚠ @boxlite-ai/boxlite native binding not available — execute_sandboxed_code tool disabled');
}

const WORKING_DIR = '/root';

function queryResultToCsv({ columns, data }: QueryResult): string {
	const escapeCsvValue = (val: unknown): string => {
		if (val === null || val === undefined) {
			return '';
		}
		const str = String(val);
		if (str.includes(',') || str.includes('"') || str.includes('\n')) {
			return `"${str.replace(/"/g, '""')}"`;
		}
		return str;
	};

	const header = columns.map(escapeCsvValue).join(',');
	const rows = data.map((row) => columns.map((col) => escapeCsvValue(row[col])).join(','));
	return [header, ...rows].join('\n');
}

async function executeSandboxedCode(
	{ code, language, packages, data_files }: schemas.Input,
	queryResults: Map<string, QueryResult>,
): Promise<schemas.Output> {
	if (!boxliteModule) {
		throw new Error('Sandbox execution is not available on this platform');
	}

	const { CodeBox, ExecError, TimeoutError } = boxliteModule;

	const box = new CodeBox({
		memoryMib: 512,
		cpus: 1,
		diskSizeGb: 2,
		workingDir: WORKING_DIR,
		security: {
			networkEnabled: true,
		},
	});

	let tmpDir: string | null = null;

	try {
		if (packages?.length) {
			try {
				await box.installPackages(...packages);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					stdout: '',
					stderr: `Failed to install packages: ${message}`,
					exitCode: 1,
				};
			}
		}

		if (data_files?.length) {
			tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-sandbox-'));

			for (const { query_id, filename } of data_files) {
				const result = queryResults.get(query_id);
				if (!result) {
					return {
						stdout: '',
						stderr: `Query result not found for id "${query_id}". Make sure to run execute_sql first and use the returned id.`,
						exitCode: 1,
					};
				}

				const csvContent = queryResultToCsv(result);
				const hostPath = path.join(tmpDir, filename);
				fs.writeFileSync(hostPath, csvContent, 'utf-8');
				await box.copyIn(hostPath, `${WORKING_DIR}/${filename}`);
			}
		}

		if (language === 'python') {
			const stdout = await box.run(code);
			return { stdout, stderr: '', exitCode: 0 };
		}

		const result = await box.exec('sh', '-c', code);
		return {
			stdout: result.stdout,
			stderr: result.stderr,
			exitCode: result.exitCode,
		};
	} catch (err) {
		if (err instanceof ExecError) {
			return { stdout: '', stderr: err.message, exitCode: 1 };
		}
		if (err instanceof TimeoutError) {
			return { stdout: '', stderr: 'Execution timed out', exitCode: 124 };
		}
		throw err;
	} finally {
		await box.stop().catch(() => {});
		if (tmpDir) {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	}
}

export const isSandboxAvailable = boxliteModule !== null;

export default boxliteModule
	? createTool<schemas.Input, schemas.Output>({
			description: schemas.description,
			inputSchema: schemas.inputSchema,
			outputSchema: schemas.outputSchema,
			execute: async (input, context) => {
				return executeSandboxedCode(input, context.queryResults);
			},
		})
	: null;
