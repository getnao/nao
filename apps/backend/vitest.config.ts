import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts', '../../ee/backend/**/*.test.ts'],
	},
});
