import { defineConfig, mergeConfig } from 'vitest/config';

import viteConfig from './vite.config';

const nodeMajorVersion = Number(process.versions.node.split('.')[0]);

export default mergeConfig(
	viteConfig,
	defineConfig({
		test: {
			execArgv: nodeMajorVersion >= 25 ? ['--no-experimental-webstorage'] : [],
			isolate: false,
			maxWorkers: 3,
			setupFiles: ['./tests/setup/shared-worker.ts'],
		},
	}),
);
