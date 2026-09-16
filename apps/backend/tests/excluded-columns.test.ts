import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/license.service', () => ({
	hasFeature: vi.fn(),
	LICENSE_FEATURES: { excludeColumns: 'exclude-columns' },
}));

vi.mock('../src/queries/project.queries', () => ({
	getAgentSettings: vi.fn(),
}));

import { getAgentSettings } from '../src/queries/project.queries';
import {
	resolveExcludedColumnEnforcement,
	resolveExcludedColumnEnforcementForProject,
} from '../src/services/excluded-columns.service';
import { hasFeature, LICENSE_FEATURES } from '../src/services/license.service';
import type { AgentSettings } from '../src/types/agent-settings';

const cases = [
	{ licensed: false, setting: undefined, expected: false },
	{ licensed: false, setting: false, expected: false },
	{ licensed: false, setting: true, expected: false },
	{ licensed: true, setting: undefined, expected: true },
	{ licensed: true, setting: false, expected: false },
	{ licensed: true, setting: true, expected: true },
] as const;

describe('resolveExcludedColumnEnforcement', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it.each(cases)(
		'returns $expected when licensed=$licensed and setting=$setting',
		async ({ licensed, setting, expected }) => {
			vi.mocked(hasFeature).mockResolvedValue(licensed);

			await expect(resolveExcludedColumnEnforcement(createAgentSettings(setting))).resolves.toBe(expected);
			expect(hasFeature).toHaveBeenCalledWith(LICENSE_FEATURES.excludeColumns);
		},
	);
});

describe('resolveExcludedColumnEnforcementForProject', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it.each([
		{ licensed: true, setting: undefined, expected: true },
		{ licensed: true, setting: false, expected: false },
		{ licensed: false, setting: true, expected: false },
	] as const)(
		'returns $expected when licensed=$licensed and setting=$setting',
		async ({ licensed, setting, expected }) => {
			vi.mocked(getAgentSettings).mockResolvedValue(createAgentSettings(setting));
			vi.mocked(hasFeature).mockResolvedValue(licensed);

			await expect(resolveExcludedColumnEnforcementForProject('project-id')).resolves.toBe(expected);
			expect(getAgentSettings).toHaveBeenCalledWith('project-id');
			expect(hasFeature).toHaveBeenCalledWith(LICENSE_FEATURES.excludeColumns);
		},
	);
});

function createAgentSettings(setting: boolean | undefined): AgentSettings {
	return setting === undefined ? {} : { sql: { enforceExcludedColumns: setting } };
}
