import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

export const QUICKJS_WASM_FILENAME = 'quickjs.wasm';

let compiledModule: Promise<WebAssembly.Module> | null = null;

/** Compiles the QuickJS wasm once; every run instantiates its own VM from the shared module. */
export function loadQuickJsWasm(): Promise<WebAssembly.Module> {
	compiledModule ??= Promise.resolve()
		.then(() => readFile(resolveQuickJsWasmPath()))
		.then((bytes) => WebAssembly.compile(bytes))
		.catch((error: unknown) => {
			compiledModule = null;
			throw error;
		});
	return compiledModule;
}

/** The standalone build ships the wasm next to the binary, where no node_modules exists. */
function resolveQuickJsWasmPath(): string {
	const besideExecutable = join(dirname(process.execPath), QUICKJS_WASM_FILENAME);
	if (existsSync(besideExecutable)) {
		return besideExecutable;
	}
	return createRequire(import.meta.url).resolve(`quickjs-wasi/${QUICKJS_WASM_FILENAME}`);
}
