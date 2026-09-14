import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
	preferences: {} as Record<string, unknown>,
}));

vi.mock('../src/auth', () => ({ getAuth: vi.fn() }));

vi.mock('../src/queries/project.queries', () => ({
	getProjectByUserId: vi.fn(async () => ({
		id: 'project-id',
		name: 'Test project',
		path: '/tmp/nao-project',
		envVars: {},
	})),
	getUserRoleInProject: vi.fn(async () => 'admin'),
}));

vi.mock('../src/queries/usage.queries', () => ({
	getMessagesUsage: vi.fn(),
	getTotalUsage: vi.fn(),
	getUsedProviders: vi.fn(),
}));

vi.mock('../src/queries/user-preference.queries', () => ({
	getUserPreferences: vi.fn(async () => ({
		projectPreferences: { 'project-id': state.preferences },
	})),
	mutateUserPreferences: vi.fn(
		async (_userId, transform: (current: Record<string, unknown>) => Record<string, unknown>) => {
			const updated = transform({
				projectPreferences: { 'project-id': state.preferences },
			});
			state.preferences =
				(updated.projectPreferences as Record<string, Record<string, unknown>> | undefined)?.['project-id'] ??
				{};
			return updated;
		},
	),
}));

vi.mock('../src/services/sso-group-mapping.service', () => ({
	isGroupRoleMappingActive: vi.fn(async () => false),
}));

import { router } from '../src/trpc/trpc';
import { usageRoutes } from '../src/trpc/usage.routes';
import {
	DEFAULT_USAGE_PERIOD_SELECTION,
	MAX_SAVED_USAGE_PERIODS,
	SAVED_USAGE_PERIOD_LIMIT_MESSAGE,
} from '../src/types/usage';

const testRouter = router(usageRoutes);

describe('saved usage period routes', () => {
	beforeEach(() => {
		state.preferences = {};
	});

	it('creates, updates, selects, and deletes saved periods', async () => {
		const caller = createCaller();
		const created = await caller.createSavedPeriod({
			projectId: 'project-id',
			savedPeriod: { days: 5000, granularity: 'month' },
		});

		expect(created.id).toEqual(expect.any(String));
		await expect(caller.getPeriodSettings({ projectId: 'project-id' })).resolves.toEqual({
			selection: { mode: 'saved', savedPeriodId: created.id },
			savedPeriods: [created],
		});

		const updated = await caller.updateSavedPeriod({
			projectId: 'project-id',
			savedPeriod: { ...created, days: 730, granularity: 'day' },
		});
		await expect(caller.getPeriodSettings({ projectId: 'project-id' })).resolves.toEqual({
			selection: { mode: 'saved', savedPeriodId: created.id },
			savedPeriods: [updated],
		});

		await caller.updatePeriodSelection({
			projectId: 'project-id',
			selection: { mode: 'saved', savedPeriodId: created.id },
		});
		await expect(caller.getPeriodSettings({ projectId: 'project-id' })).resolves.toEqual({
			selection: { mode: 'saved', savedPeriodId: created.id },
			savedPeriods: [updated],
		});

		await expect(caller.deleteSavedPeriod({ projectId: 'project-id', id: created.id })).resolves.toEqual({
			id: created.id,
			selection: DEFAULT_USAGE_PERIOD_SELECTION,
		});
		await expect(caller.getPeriodSettings({ projectId: 'project-id' })).resolves.toEqual({
			selection: DEFAULT_USAGE_PERIOD_SELECTION,
			savedPeriods: [],
		});
	});

	it('rejects creating more than the saved period limit', async () => {
		const savedPeriods = Array.from({ length: MAX_SAVED_USAGE_PERIODS }, (_, index) => ({
			id: `saved-period-${index}`,
			days: index + 1,
			granularity: 'day',
		}));
		state.preferences = { savedUsagePeriods: savedPeriods };

		await expect(
			createCaller().createSavedPeriod({
				projectId: 'project-id',
				savedPeriod: { days: 30, granularity: 'day' },
			}),
		).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: SAVED_USAGE_PERIOD_LIMIT_MESSAGE,
		});
		expect(state.preferences).toEqual({ savedUsagePeriods: savedPeriods });
	});

	it('repairs stored periods above the saved period limit', async () => {
		const savedPeriods = Array.from({ length: MAX_SAVED_USAGE_PERIODS + 1 }, (_, index) => ({
			id: `saved-period-${index}`,
			days: index + 1,
			granularity: 'day' as const,
		}));
		const retainedSavedPeriods = savedPeriods.slice(0, MAX_SAVED_USAGE_PERIODS);
		state.preferences = {
			usagePeriod: { mode: 'saved', savedPeriodId: savedPeriods.at(-1)?.id ?? '' },
			savedUsagePeriods: savedPeriods,
		};

		await expect(createCaller().getPeriodSettings({ projectId: 'project-id' })).resolves.toEqual({
			selection: DEFAULT_USAGE_PERIOD_SELECTION,
			savedPeriods: retainedSavedPeriods,
		});
		expect(state.preferences).toEqual({
			usagePeriod: DEFAULT_USAGE_PERIOD_SELECTION,
			savedUsagePeriods: retainedSavedPeriods,
		});
	});

	it('rejects unknown saved periods', async () => {
		const caller = createCaller();

		await expect(
			caller.updatePeriodSelection({
				projectId: 'project-id',
				selection: { mode: 'saved', savedPeriodId: 'missing' },
			}),
		).rejects.toMatchObject({ code: 'NOT_FOUND' });
		await expect(caller.deleteSavedPeriod({ projectId: 'project-id', id: 'missing' })).rejects.toMatchObject({
			code: 'NOT_FOUND',
		});
	});

	it('preserves valid saved periods when stored data contains a malformed item', async () => {
		state.preferences = {
			savedUsagePeriods: [
				{ id: 'valid', days: 30, granularity: 'day' },
				{ id: 'invalid', days: 0, granularity: 'day' },
			],
		};
		const caller = createCaller();

		const created = await caller.createSavedPeriod({
			projectId: 'project-id',
			savedPeriod: { days: 365, granularity: 'month' },
		});

		await expect(caller.getPeriodSettings({ projectId: 'project-id' })).resolves.toEqual({
			selection: { mode: 'saved', savedPeriodId: created.id },
			savedPeriods: [{ id: 'valid', days: 30, granularity: 'day' }, created],
		});
	});

	it('repairs an orphaned saved selection', async () => {
		state.preferences = {
			usagePeriod: { mode: 'saved', savedPeriodId: 'invalid' },
			savedUsagePeriods: [{ id: 'invalid', days: 0, granularity: 'day' }],
		};

		await expect(createCaller().getPeriodSettings({ projectId: 'project-id' })).resolves.toEqual({
			selection: DEFAULT_USAGE_PERIOD_SELECTION,
			savedPeriods: [],
		});
		expect(state.preferences).toEqual({
			usagePeriod: DEFAULT_USAGE_PERIOD_SELECTION,
			savedUsagePeriods: [],
		});
	});

	it('migrates a legacy saved selection', async () => {
		const savedPeriod = { id: 'year', days: 365, granularity: 'month' };
		state.preferences = {
			usagePeriod: { mode: 'saved', entryId: savedPeriod.id },
			savedUsagePeriods: [savedPeriod],
		};

		await expect(createCaller().getPeriodSettings({ projectId: 'project-id' })).resolves.toEqual({
			selection: { mode: 'saved', savedPeriodId: savedPeriod.id },
			savedPeriods: [savedPeriod],
		});
		expect(state.preferences).toEqual({
			usagePeriod: { mode: 'saved', savedPeriodId: savedPeriod.id },
			savedUsagePeriods: [savedPeriod],
		});
	});

	it('removes legacy custom selections and malformed saved periods from storage', async () => {
		const validSavedPeriod = { id: 'valid', days: 365, granularity: 'month' };
		state.preferences = {
			usagePeriod: { mode: 'custom', customPeriod: { value: 30, unit: 'day' } },
			savedUsagePeriods: [validSavedPeriod, { id: 'invalid', days: 0, granularity: 'day' }],
		};

		await expect(createCaller().getPeriodSettings({ projectId: 'project-id' })).resolves.toEqual({
			selection: DEFAULT_USAGE_PERIOD_SELECTION,
			savedPeriods: [validSavedPeriod],
		});
		expect(state.preferences).toEqual({
			usagePeriod: DEFAULT_USAGE_PERIOD_SELECTION,
			savedUsagePeriods: [validSavedPeriod],
		});
	});

	it('rejects preference requests for a stale project', async () => {
		await expect(createCaller().getPeriodSettings({ projectId: 'other-project' })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
		});
	});
});

function createCaller() {
	return testRouter.createCaller({
		session: {
			user: {
				id: 'user-id',
				name: 'Test User',
				email: 'test@example.com',
			},
		},
		selectedProjectId: 'project-id',
	} as never);
}
