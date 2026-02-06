import { executePython as schemas } from '@nao/shared/tools';
import {
	Monty,
	MontyComplete,
	MontyRuntimeError,
	MontySnapshot,
	MontySyntaxError,
	MontyTypingError,
} from '@pydantic/monty';
import { tool } from 'ai';
import fs from 'fs';
import path from 'path';

import { getProjectFolder, isWithinProjectFolder, toVirtualPath } from '../../utils/tools';

const RESOURCE_LIMITS = {
	maxDurationSecs: 30,
	maxMemory: 64 * 1024 * 1024, // 64 MB
	maxAllocations: 1_000_000,
	maxRecursionDepth: 500,
};

function findAllFiles(dir: string, projectFolder: string): schemas.VirtualFile[] {
	const files: schemas.VirtualFile[] = [];

	try {
		const entries = fs.readdirSync(dir, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);

			if (!isWithinProjectFolder(fullPath, projectFolder)) {
				continue;
			}

			if (entry.isDirectory()) {
				// Recursively search subdirectories
				files.push(...findAllFiles(fullPath, projectFolder));
			} else if (entry.isFile()) {
				try {
					const content = fs.readFileSync(fullPath, 'utf-8');
					const virtualPath = toVirtualPath(fullPath, projectFolder);
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

function loadProjectFiles(): schemas.VirtualFile[] {
	const projectFolder = getProjectFolder();
	return findAllFiles(projectFolder, projectFolder);
}

function createVirtualFS(): Map<string, string> {
	const vfs = new Map<string, string>();

	// Load all files from the project folder
	const projectFiles = loadProjectFiles();
	for (const file of projectFiles) {
		vfs.set(file.path, file.content);
	}

	return vfs;
}

const EXTERNAL_FUNCTION_MAP = new Map(schemas.EXTERNAL_FUNCTIONS.map((f) => [f.name, f]));
const EXTERNAL_FUNCTION_NAMES = schemas.EXTERNAL_FUNCTIONS.map((f) => f.name);

export const execute = async ({ code, inputs }: schemas.Input): Promise<schemas.Output> => {
	const inputNames = inputs ? Object.keys(inputs) : [];
	const virtualFS = createVirtualFS();

	let monty: Monty;
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

	let state: MontySnapshot | MontyComplete;
	const ctx: schemas.Ctx = { virtualFS };

	try {
		state = monty.start({
			...(inputNames.length > 0 && { inputs }),
			limits: RESOURCE_LIMITS,
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
};

export default tool({
	description: 'Execute Python code in a sandboxed interpreter and return the result.',
	inputSchema: schemas.inputSchema,
	outputSchema: schemas.outputSchema,
	execute: execute,
});
