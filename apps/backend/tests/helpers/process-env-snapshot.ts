import { afterEach, beforeEach } from 'vitest';

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
