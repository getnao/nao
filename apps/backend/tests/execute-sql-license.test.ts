import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/license.service', () => ({
	hasFeature: vi.fn(),
	LICENSE_FEATURES: { excludeColumns: 'exclude-columns' },
}));
vi.mock('../src/queries/execute-sql.queries', () => ({
	getExecuteSqlPartByQueryIdInChat: vi.fn(),
	updateExecuteSqlPart: vi.fn(),
}));
vi.mock('../src/queries/project.queries', () => ({
	getAgentSettings: vi.fn(),
}));
vi.mock('../src/agents/tools/query-app-db', () => ({
	queryAppDb: vi.fn(),
}));

import { executeQuery } from '../src/agents/tools/execute-sql';
import { hasFeature, LICENSE_FEATURES } from '../src/services/license.service';
import type { ToolContext } from '../src/types/tools';

const cases = [
	{ licensed: false, storedSetting: true, expected: false },
	{ licensed: true, storedSetting: undefined, expected: true },
	{ licensed: true, storedSetting: false, expected: false },
	{ licensed: true, storedSetting: true, expected: true },
] as const;

describe('execute_sql excluded-column enforcement', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it.each(cases)(
		'sends $expected when licensed=$licensed and stored setting=$storedSetting',
		async ({ licensed, storedSetting, expected }) => {
			vi.mocked(hasFeature).mockResolvedValue(licensed);
			const fetch = vi.fn(async () =>
				Response.json({
					data: [],
					row_count: 0,
					columns: [],
				}),
			);
			vi.stubGlobal('fetch', fetch);

			await executeQuery({ sql_query: 'SELECT 1' }, createContext(storedSetting));

			expect(hasFeature).toHaveBeenCalledWith(LICENSE_FEATURES.excludeColumns);
			const [, init] = fetch.mock.calls[0] as [string, RequestInit];
			expect(JSON.parse(String(init.body))).toMatchObject({
				enforce_excluded_columns: expected,
			});
		},
	);
});

function createContext(storedSetting: boolean | undefined): ToolContext {
	return {
		projectFolder: '/tmp/project',
		chatId: 'chat-1',
		userId: 'user-1',
		projectId: 'project-1',
		supportsCustomCharts: false,
		agentSettings:
			storedSetting === undefined
				? {}
				: {
						sql: {
							enforceExcludedColumns: storedSetting,
						},
					},
		envVars: {},
		azureAccessToken: null,
		queryResults: new Map(),
		generatedArtifacts: { charts: [], maps: [], stories: [] },
	};
}
