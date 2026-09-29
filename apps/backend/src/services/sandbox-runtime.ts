import fs from 'fs';

/**
 * The sandbox runtime is an optional native dependency, so whether a deployment can run code at
 * all is decided here, once, at startup. It lives apart from the tool that uses it because other
 * parts of a run need the answer without pulling the tool in: guidance that offers a sandbox to
 * an instance without one is worse than no guidance.
 */
let boxlite: typeof import('@boxlite-ai/boxlite') | null = null;

if (isSandboxHostSupported()) {
	try {
		boxlite = await import('@boxlite-ai/boxlite');
	} catch {
		console.warn(
			'⚠ sandbox runtime not installed — execute_sandboxed_code tool disabled (run `nao chat --sandbox`)',
		);
	}
} else {
	console.warn('⚠ sandbox runtime unavailable on this host; execute_sandboxed_code tool disabled');
}

export const sandboxRuntime = boxlite;

export const isSandboxAvailable = boxlite !== null;

function isSandboxHostSupported(): boolean {
	if (process.platform !== 'linux') {
		return true;
	}

	try {
		fs.accessSync('/dev/kvm', fs.constants.R_OK | fs.constants.W_OK);
		return true;
	} catch {
		return false;
	}
}
