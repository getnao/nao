import type { Tool } from '@ai-sdk/provider-utils';
import { debounce } from '@nao/shared';
import { jsonSchema } from 'ai';
import { execFile } from 'child_process';
import { existsSync, readdirSync, readFileSync, statSync, watch } from 'fs';
import { join } from 'path';

import * as projectQueries from '../queries/project.queries';
import { logger } from '../utils/logger';
import { sanitizeTools } from '../utils/tools';

export interface CustomToolSpec {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	command: string;
	args: string[];
	input: 'stdin' | 'args';
	env?: Record<string, string>;
}

class CustomToolService {
	private _projectPath: string = '';
	private _toolsFolderPath: string = '';
	private _tools: Record<string, Tool> = {};
	private _fileWatcher: ReturnType<typeof watch> | null = null;
	private _debouncedReload: () => void;
	private _initialized = false;

	constructor() {
		this._debouncedReload = debounce(() => {
			this._loadTools();
		}, 2000);
	}

	public async initialize(projectId: string): Promise<void> {
		if (this._initialized) {
			return;
		}
		this._initialized = true;

		const project = await projectQueries.retrieveProjectById(projectId);
		this._projectPath = project.path || '';
		this._toolsFolderPath = join(this._projectPath, 'agent', 'tools');

		this._loadTools();
		this._setupFileWatcher();
	}

	public getTools(): Record<string, Tool> {
		return this._tools;
	}

	private _loadTools(): void {
		try {
			if (!existsSync(this._toolsFolderPath)) {
				this._tools = {};
				return;
			}

			if (!statSync(this._toolsFolderPath).isDirectory()) {
				logger.error(`Custom tools path is not a directory: ${this._toolsFolderPath}`, { source: 'tool' });
				this._tools = {};
				return;
			}

			const files = readdirSync(this._toolsFolderPath).filter((f) => f.endsWith('.json'));
			const tools: Record<string, Tool> = {};

			for (const file of files) {
				const spec = this._readSpec(file);
				if (!spec) continue;

				tools[spec.name] = this._buildTool(spec);
			}

			this._tools = tools;
			logger.info(`Loaded ${Object.keys(tools).length} custom tool(s)`, { source: 'tool' });
		} catch (error) {
			logger.error(`Failed to load custom tools: ${String(error)}`, { source: 'tool' });
			this._tools = {};
		}
	}

	private _readSpec(filename: string): CustomToolSpec | null {
		const filePath = join(this._toolsFolderPath, filename);
		try {
			const raw = readFileSync(filePath, 'utf8');
			const parsed = JSON.parse(raw);

			if (!parsed.name || !parsed.command) {
				logger.warn(`Custom tool spec missing required fields (name, command): ${filename}`, { source: 'tool' });
				return null;
			}

			return {
				name: parsed.name,
				description: parsed.description || '',
				inputSchema: parsed.inputSchema || { type: 'object', properties: {} },
				command: parsed.command,
				args: parsed.args || [],
				input: parsed.input === 'args' ? 'args' : 'stdin',
				env: parsed.env || {},
			};
		} catch (error) {
			logger.error(`Failed to parse custom tool spec ${filename}: ${String(error)}`, { source: 'tool' });
			return null;
		}
	}

	private _buildTool(spec: CustomToolSpec): Tool {
		return {
			description: spec.description,
			inputSchema: jsonSchema(sanitizeTools(spec.inputSchema)),
			execute: async (input: unknown) => {
				return this._executeTool(spec, input);
			},
		} as Tool;
	}

	private _executeTool(spec: CustomToolSpec, input: unknown): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const inputJson = JSON.stringify(input);
			const args = spec.input === 'args' ? [...spec.args, inputJson] : [...spec.args];

			const child = execFile(
				spec.command,
				args,
				{
					cwd: this._projectPath,
					env: { ...process.env, ...spec.env },
					timeout: 30_000,
					maxBuffer: 10 * 1024 * 1024,
				},
				(error, stdout, stderr) => {
					if (error) {
						const message = stderr.trim() || error.message;
						reject(new Error(`Custom tool "${spec.name}" failed: ${message}`));
						return;
					}

					try {
						resolve(JSON.parse(stdout));
					} catch {
						resolve({ output: stdout.trim() });
					}
				},
			);

			if (spec.input === 'stdin' && child.stdin) {
				child.stdin.write(inputJson);
				child.stdin.end();
			}
		});
	}

	private _setupFileWatcher(): void {
		if (!this._toolsFolderPath || !existsSync(this._toolsFolderPath)) {
			return;
		}

		try {
			this._fileWatcher = watch(this._toolsFolderPath, { recursive: true }, (eventType) => {
				if (eventType === 'change' || eventType === 'rename') {
					this._debouncedReload();
				}
			});
		} catch (error) {
			logger.error(`Custom tools file watcher setup failed: ${String(error)}`, { source: 'tool' });
		}
	}
}

export const customToolService = new CustomToolService();
