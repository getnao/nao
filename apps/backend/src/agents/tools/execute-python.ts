import { executePython as schemas } from '@nao/shared/tools';
import {
	DEFAULT_PYTHON_EXECUTION_DURATION_SECS,
	MAX_PYTHON_EXECUTION_DURATION_SECS,
	MIN_PYTHON_EXECUTION_DURATION_SECS,
} from '@nao/shared/types';
import fs from 'fs';
import path from 'path';

import { isProjectContextPathAllowed } from '../../services/project-context-path-access.service';
import type { AgentSettings } from '../../types/agent-settings';
import type { ToolContext } from '../../types/tools';
import { isWithinProjectFolder, resolveCanonicalProjectPath, toVirtualPath } from '../../utils/tools';
import { createTool } from '../../utils/tools';

// @pydantic/monty uses native bindings that aren't available on all platforms
// (e.g. no Linux ARM64 binary). Load lazily so the server can still start.
let montyModule: typeof import('@pydantic/monty') | null = null;
try {
	montyModule = await import('@pydantic/monty');
} catch {
	console.warn('⚠ @pydantic/monty native binding not available — execute_python tool disabled');
}

const RESOURCE_LIMITS = {
	maxDurationSecs: DEFAULT_PYTHON_EXECUTION_DURATION_SECS,
	maxMemory: 64 * 1024 * 1024, // 64 MB
	maxAllocations: 1_000_000,
	maxRecursionDepth: 500,
};

async function executePython({ code, inputs }: schemas.Input, context: ToolContext): Promise<schemas.Output> {
	if (!montyModule) {
		throw new Error('Python execution is not available on this platform');
	}

	const { Monty, MontyRuntimeError, MontySnapshot, MontySyntaxError, MontyTypingError } = montyModule;
	const inputNames = inputs ? Object.keys(inputs) : [];
	const virtualFS = createVirtualFS(context);

	let monty: InstanceType<typeof Monty>;
	try {
		monty = new Monty(code, {
			scriptName: 'agent.py',
			inputs: inputNames,
			externalFunctions: EXTERNAL_FUNCTION_NAMES,
		});
	} catch (err) {
		if (err instanceof MontySyntaxError) {
			throw new Error(`Python syntax error: ${err.display('type-msg')}`);
		}
		if (err instanceof MontyTypingError) {
			throw new Error(`Python type error: ${err.displayDiagnostics('full')}`);
		}
		throw err;
	}

	let state: InstanceType<typeof MontySnapshot> | InstanceType<(typeof montyModule)['MontyComplete']>;
	const ctx: schemas.Ctx = { virtualFS };

	try {
		state = monty.start({
			...(inputNames.length > 0 && { inputs }),
			limits: getResourceLimits(context.agentSettings),
		});

		while (state instanceof MontySnapshot) {
			const fn = EXTERNAL_FUNCTION_MAP.get(state.functionName);

			if (!fn) {
				state = state.resume({
					exception: {
						type: 'NotImplementedError',
						message: `Unknown function: ${state.functionName}`,
					},
				});
				continue;
			}

			const positionalArgs = state.args;
			const args = Object.fromEntries(fn.paramNames.map((name, i) => [name, positionalArgs[i]]));
			const result = fn.execute(args, ctx);

			if ('exception' in result) {
				state = state.resume({ exception: result.exception });
			} else {
				state = state.resume({ returnValue: result.value });
			}
		}
	} catch (err) {
		if (err instanceof MontyRuntimeError) {
			throw new Error(`Python runtime error: ${err.display('traceback')}`);
		}
		throw err;
	}

	return {
		output: state.output,
	};
}

function getResourceLimits(agentSettings: AgentSettings | null): typeof RESOURCE_LIMITS {
	return {
		...RESOURCE_LIMITS,
		maxDurationSecs: resolveMaxDurationSecs(agentSettings),
	};
}

function resolveMaxDurationSecs(agentSettings: AgentSettings | null): number {
	const value = agentSettings?.pythonExecution?.maxDurationSecs;
	if (value === undefined || !Number.isInteger(value)) {
		return DEFAULT_PYTHON_EXECUTION_DURATION_SECS;
	}
	return Math.min(MAX_PYTHON_EXECUTION_DURATION_SECS, Math.max(MIN_PYTHON_EXECUTION_DURATION_SECS, value));
}

function findAllFiles(dir: string, context: ToolContext): schemas.VirtualFile[] {
	const files: schemas.VirtualFile[] = [];

	try {
		const entries = fs.readdirSync(dir, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);

			if (!isWithinProjectFolder(fullPath, context.projectFolder) || entry.isSymbolicLink()) {
				continue;
			}

			if (entry.isDirectory()) {
				const virtualPath = toVirtualPath(fullPath, context.projectFolder);
				const canonical = resolveCanonicalProjectPath(virtualPath, context.projectFolder);
				if (isProjectContextPathAllowed(context, virtualPath, canonical.virtualPath, 'directory')) {
					files.push(...findAllFiles(fullPath, context));
				}
			} else if (entry.isFile()) {
				try {
					const virtualPath = toVirtualPath(fullPath, context.projectFolder);
					const canonical = resolveCanonicalProjectPath(virtualPath, context.projectFolder);
					if (!isProjectContextPathAllowed(context, virtualPath, canonical.virtualPath, 'file')) {
						continue;
					}
					const content = fs.readFileSync(fullPath, 'utf-8');
					files.push({ path: virtualPath, content });
				} catch {
					// Skip files that can't be read (binary files, permission issues, etc.)
				}
			}
		}
	} catch {
		// Skip directories that can't be read
	}

	return files;
}

export function createVirtualFS(context: ToolContext): Map<string, string> {
	const vfs = new Map<string, string>();

	const projectFiles = findAllFiles(context.projectFolder, context);
	for (const file of projectFiles) {
		vfs.set(file.path, file.content);
	}

	return vfs;
}

const EXTERNAL_FUNCTION_MAP = new Map(schemas.EXTERNAL_FUNCTIONS.map((f) => [f.name, f]));
const EXTERNAL_FUNCTION_NAMES = schemas.EXTERNAL_FUNCTIONS.map((f) => f.name);

export const isPythonAvailable = montyModule !== null;

export default montyModule
	? createTool<schemas.Input, schemas.Output>({
			description: schemas.description,
			inputSchema: schemas.inputSchema,
			outputSchema: schemas.outputSchema,
			execute: async (input, context) => {
				return executePython(input, context);
			},
		})
	: null;
