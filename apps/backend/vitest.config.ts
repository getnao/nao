import { fileURLToPath } from 'node:url';

import { configDefaults, defineConfig } from 'vitest/config';

/**
 * These files write to the same ./db.sqlite through better-sqlite3. Running them in
 * parallel workers makes SQLite's busy timeout expire ("database is locked"), so each
 * one gets its own sequence group: groups run one after another, after the default group.
 */
const sharedSqliteTestFiles = [
	'tests/agents/query-app-db.test.ts',
	'tests/db/context-recommendation-schema.test.ts',
	'tests/db/readonly-app-db.test.ts',
	'tests/db/sqlite.test.ts',
	'tests/queries/project-accessible-users.test.ts',
	'tests/queries/project-selection.test.ts',
	'tests/queries/story-title-persistence.test.ts',
];

export default defineConfig({
	resolve: {
		alias: {
			'bun:sqlite': fileURLToPath(new URL('./tests/stubs/bun-sqlite.ts', import.meta.url)),
		},
	},
	test: {
		server: {
			deps: {
				inline: [/drizzle-orm\/bun-sqlite/],
			},
		},
		projects: [
			{
				extends: true,
				test: {
					name: 'parallel',
					include: ['tests/**/*.test.{ts,tsx}'],
					exclude: [...configDefaults.exclude, ...sharedSqliteTestFiles],
				},
			},
			...sharedSqliteTestFiles.map((file, index) => ({
				extends: true as const,
				test: { name: `shared-sqlite-${index + 1}`, include: [file], sequence: { groupOrder: index + 1 } },
			})),
		],
	},
});
