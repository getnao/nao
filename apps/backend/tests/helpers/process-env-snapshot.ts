import { afterEach, beforeEach } from 'vitest';

/**
 * Snapshots `process.env` before each test, unsetting `unset`, and restores it after each test before
 * calling `afterRestore` (typically `__reloadEnvForTesting`, so the parsed env matches again).
 */
export function restoreProcessEnvAfterEach({
	unset = [],
	afterRestore,
}: { unset?: string[]; afterRestore?: () => void } = {}): void {
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(() => {
		originalEnv = { ...process.env };
		for (const name of unset) {
			delete process.env[name];
		}
	});

	afterEach(() => {
		process.env = originalEnv;
		afterRestore?.();
	});
}
