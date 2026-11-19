import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	env: {
		NAO_DEFAULT_PROJECT_PATH: undefined as string | undefined,
		NAO_PROJECT_PATHS: [] as string[],
	},
	isCloud: false,
	hasFeature: vi.fn<() => Promise<boolean>>(),
}));

vi.mock('../../src/env', () => ({
	env: mocks.env,
	get isCloud() {
		return mocks.isCloud;
	},
}));

vi.mock('../../src/services/license.service', () => ({
	LICENSE_FEATURES: { multiProject: 'multi-project' },
	hasFeature: mocks.hasFeature,
}));

import { getActiveProjectPaths, isSelfHostedMultiProjectEnabled } from '../../src/services/multi-project.service';

const SALES_PATH = '/app/projects/sales';
const FINANCE_PATH = '/app/projects/finance';

describe('multi-project service', () => {
	afterEach(() => {
		mocks.env.NAO_DEFAULT_PROJECT_PATH = undefined;
		mocks.env.NAO_PROJECT_PATHS = [];
		mocks.isCloud = false;
		mocks.hasFeature.mockReset();
	});

	it.each([
		{ licensed: true, enabled: true, activePaths: [SALES_PATH, FINANCE_PATH] },
		{ licensed: false, enabled: false, activePaths: [SALES_PATH] },
	])(
		'serves $activePaths.length project(s) when licensed is $licensed',
		async ({ licensed, enabled, activePaths }) => {
			mocks.env.NAO_PROJECT_PATHS = [SALES_PATH, FINANCE_PATH];
			mocks.hasFeature.mockResolvedValue(licensed);

			expect(await isSelfHostedMultiProjectEnabled()).toBe(enabled);
			expect(await getActiveProjectPaths()).toEqual(activePaths);
		},
	);

	it('puts NAO_DEFAULT_PROJECT_PATH first and drops duplicates', async () => {
		mocks.env.NAO_DEFAULT_PROJECT_PATH = FINANCE_PATH;
		mocks.env.NAO_PROJECT_PATHS = [SALES_PATH, FINANCE_PATH];
		mocks.hasFeature.mockResolvedValue(true);

		expect(await getActiveProjectPaths()).toEqual([FINANCE_PATH, SALES_PATH]);
	});

	it.each([
		{ mode: 'a single configured project', isCloud: false, paths: [SALES_PATH] },
		{ mode: 'cloud mode', isCloud: true, paths: [] },
	])('skips the license check for $mode', async ({ isCloud, paths }) => {
		mocks.isCloud = isCloud;
		mocks.env.NAO_PROJECT_PATHS = paths;

		expect(await isSelfHostedMultiProjectEnabled()).toBe(false);
		expect(mocks.hasFeature).not.toHaveBeenCalled();
	});
});
