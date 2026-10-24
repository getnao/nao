import { startBackend, stopBackend } from './support/backend';
import { saveFailureArtifacts } from './support/failure-artifacts';
import { desktopBinaryPath } from './support/paths';
import { startTauriDriver, stopTauriDriver, TAURI_DRIVER_PORT } from './support/tauri-driver';

/**
 * Smoke test of the built debug app through tauri-driver (Linux and Windows only).
 * Build it first with `npm run build:e2e`, then run `npm run test:e2e` (under xvfb-run on headless Linux).
 */
export const config: WebdriverIO.Config = {
	runner: 'local',
	hostname: '127.0.0.1',
	port: TAURI_DRIVER_PORT,
	specs: ['./specs/**/*.e2e.ts'],
	maxInstances: 1,
	capabilities: [
		{
			// @ts-expect-error tauri-driver's vendor capability is not part of the WebdriverIO types.
			'tauri:options': { application: desktopBinaryPath },
			pageLoadStrategy: 'none',
		},
	],
	logLevel: 'warn',
	waitforTimeout: 30_000,
	connectionRetryTimeout: 120_000,
	connectionRetryCount: 3,
	framework: 'mocha',
	reporters: ['spec'],
	mochaOpts: { ui: 'bdd', timeout: 90_000 },

	onPrepare: startBackend,
	onComplete: stopBackend,
	beforeSession: startTauriDriver,
	afterSession: stopTauriDriver,
	afterTest: async (test, _context, { passed }) => {
		if (!passed) {
			await saveFailureArtifacts(test.title);
		}
	},
};
