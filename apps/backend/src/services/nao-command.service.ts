import { spawn } from 'node:child_process';

import { logger } from '../utils/logger';

const COMMAND_OUTPUT_LIMIT = 8000;
const COMMAND_LOG_UPDATE_MS = 300;
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');

export class NaoCommandExitError extends Error {}

export function createNaoCommandEnvironment(projectEnvVars: Record<string, string>): NodeJS.ProcessEnv {
	return {
		PATH: process.env.PATH,
		HOME: process.env.HOME,
		TMPDIR: process.env.TMPDIR,
		VIRTUAL_ENV: process.env.VIRTUAL_ENV,
		LANG: process.env.LANG,
		LC_ALL: process.env.LC_ALL,
		SSL_CERT_FILE: process.env.SSL_CERT_FILE,
		REQUESTS_CA_BUNDLE: process.env.REQUESTS_CA_BUNDLE,
		HTTPS_PROXY: process.env.HTTPS_PROXY,
		HTTP_PROXY: process.env.HTTP_PROXY,
		NO_PROXY: process.env.NO_PROXY,
		...projectEnvVars,
	};
}

export function runNaoCommand(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv,
	timeoutMs: number,
	onOutput?: (output: string) => Promise<unknown>,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn('nao', args, {
			cwd,
			env,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let settled = false;
		let output = '';
		let logUpdate: ReturnType<typeof setTimeout> | undefined;
		let pendingLogUpdate = Promise.resolve<unknown>(undefined);
		const publishOutput = () => {
			if (!onOutput) {
				return;
			}
			const visibleOutput = toVisibleOutput(output);
			pendingLogUpdate = pendingLogUpdate
				.then(() => onOutput(visibleOutput))
				.catch((error) =>
					logger.warn(`Could not publish nao command logs: ${String(error)}`, { source: 'system' }),
				);
		};
		const flushOutput = async () => {
			if (logUpdate) {
				clearTimeout(logUpdate);
				logUpdate = undefined;
			}
			publishOutput();
			await pendingLogUpdate;
		};
		const captureOutput = (chunk: Buffer) => {
			output = `${output}${chunk.toString('utf8')}`.slice(-COMMAND_OUTPUT_LIMIT);
			if (onOutput && !logUpdate) {
				logUpdate = setTimeout(() => {
					logUpdate = undefined;
					publishOutput();
				}, COMMAND_LOG_UPDATE_MS);
			}
		};
		child.stdout.on('data', captureOutput);
		child.stderr.on('data', captureOutput);
		const timeout = setTimeout(() => {
			if (settled) {
				return;
			}
			settled = true;
			child.kill('SIGTERM');
			void flushOutput().finally(() => reject(new Error('nao command timed out')));
		}, timeoutMs);

		child.once('error', async (error) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeout);
			await flushOutput();
			reject(new Error(`Could not start nao ${args[0]}: ${error.message}`));
		});
		child.once('close', async (code) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeout);
			await flushOutput();
			if (code === 0) {
				resolve();
			} else {
				const details = toVisibleOutput(output).trim();
				reject(new NaoCommandExitError(`nao ${args[0]} failed${details ? `: ${details}` : ''}`));
			}
		});
	});
}

function toVisibleOutput(output: string): string {
	return output.replace(ANSI_ESCAPE_PATTERN, '').replaceAll('\r', '\n');
}
