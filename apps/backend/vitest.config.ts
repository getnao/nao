import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: {
			'bun:sqlite': fileURLToPath(new URL('./tests/stubs/bun-sqlite.ts', import.meta.url)),
		},
	},
	test: {
		include: ['tests/**/*.test.{ts,tsx}'],
		server: {
			deps: {
				inline: [/drizzle-orm\/bun-sqlite/],
			},
		},
	},
});
