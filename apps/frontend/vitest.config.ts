import { defineConfig, mergeConfig } from 'vitest/config';

import viteConfig from './vite.config';

export default mergeConfig(
	viteConfig,
	defineConfig({
		test: {
			isolate: false,
			maxWorkers: 3,
			setupFiles: ['./tests/setup/shared-worker.ts'],
		},
	}),
);
